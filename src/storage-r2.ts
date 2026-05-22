/**
 * storage-r2.ts
 * Cloudflare R2 (S3-compatible API) storage backend.
 *
 * Key design decisions for R2:
 * - forcePathStyle must be true (R2 doesn't support virtual-hosted buckets via SDK).
 * - R2 has no real folder objects; we synthesise them from object key prefixes.
 * - mtime is stored in object metadata as seconds (float) under the "MTime" key
 *   for rclone compatibility.
 * - We use Obsidian's requestUrl() to bypass CORS restrictions on mobile/desktop.
 */


import type { PutObjectCommandInput, _Object } from "@aws-sdk/client-s3";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  type HeadObjectCommandOutput,
  ListObjectsV2Command,
  type ListObjectsV2CommandInput,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import type { HttpHandlerOptions } from "@aws-sdk/types";
import {
  FetchHttpHandler,
  type FetchHttpHandlerOptions,
} from "@smithy/fetch-http-handler";
// @ts-ignore – internal function not exported in type defs
import { requestTimeout } from "@smithy/fetch-http-handler/dist-es/request-timeout";
import { type HttpRequest, HttpResponse } from "@smithy/protocol-http";
import { buildQueryString } from "@smithy/querystring-builder";
import AggregateError from "aggregate-error";
import * as mime from "mime-types";
import { Platform, type RequestUrlParam, requestUrl } from "obsidian";
import PQueue from "p-queue";

import { StorageBase } from "./storage-base";
import type { FileEntity, R2Config } from "./types";
import { VALID_OBSIDIAN_REQURL } from "./obsidian-compat";
import { bufferToArrayBuffer, getFolderLevels } from "./utils";

// ─── Obsidian-aware HTTP handler ──────────────────────────────────────────────

/**
 * Drop-in replacement for FetchHttpHandler that routes requests through
 * Obsidian's requestUrl().  This avoids CORS issues on desktop and is the
 * only way to make authenticated S3 calls work on mobile.
 */
class ObsidianHttpHandler extends FetchHttpHandler {
  private timeoutMs?: number;

  constructor(options?: FetchHttpHandlerOptions) {
    super(options);
    this.timeoutMs = options?.requestTimeout;
  }

  async handle(
    request: HttpRequest,
    { abortSignal }: HttpHandlerOptions = {}
  ): Promise<{ response: HttpResponse }> {
    if (abortSignal?.aborted) {
      const err = new Error("Request aborted");
      err.name = "AbortError";
      return Promise.reject(err);
    }

    // Build full URL including query string
    let reqPath = request.path;
    if (request.query) {
      const qs = buildQueryString(request.query);
      if (qs) reqPath += `?${qs}`;
    }
    const { port, method } = request;
    const url = `${request.protocol}//${request.hostname}${port ? `:${port}` : ""}${reqPath}`;

    // Strip headers that cause Obsidian's fetch to fail
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(request.headers)) {
      const lower = k.toLowerCase();
      if (lower === "host" || lower === "content-length") continue;
      headers[lower] = v;
    }

    const body = method === "GET" || method === "HEAD" ? undefined : request.body;
    let transformedBody: any = body;
    if (ArrayBuffer.isView(body)) {
      transformedBody = bufferToArrayBuffer(body);
    }

    const param: RequestUrlParam = {
      url,
      method,
      headers,
      body: transformedBody,
      contentType: headers["content-type"],
    };

    const fetcher = requestUrl(param).then((rsp) => {
      const lowerHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(rsp.headers)) {
        lowerHeaders[k.toLowerCase()] = v;
      }
      const stream = new ReadableStream<Uint8Array>({
        start(ctrl) {
          ctrl.enqueue(new Uint8Array(rsp.arrayBuffer));
          ctrl.close();
        },
      });
      return {
        response: new HttpResponse({
          headers: lowerHeaders,
          statusCode: rsp.status,
          body: stream,
        }),
      };
    });

    const promises: Promise<any>[] = [fetcher, requestTimeout(this.timeoutMs)];
    if (abortSignal) {
      promises.push(
        new Promise<never>((_, reject) => {
          abortSignal.onabort = () => {
            const err = new Error("Request aborted");
            err.name = "AbortError";
            reject(err);
          };
        })
      );
    }
    return Promise.race(promises);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export const normaliseRemotePrefix = (raw: string | undefined): string => {
  if (!raw) return "";
  // Inline posix-style normalisation (no Node "path" import needed).
  let p = raw.trim().replace(/\/+/g, "/").replace(/\/$/, "");
  if (!p || p === ".") return "";
  if (p.startsWith("/")) p = p.slice(1);
  if (!p.endsWith("/")) p = `${p}/`;
  return p;
};

const stripPrefix = (fullKey: string, prefix: string): string => {
  if (!fullKey.startsWith(prefix)) {
    throw new Error(`"${fullKey}" does not start with prefix "${prefix}"`);
  }
  return fullKey.slice(prefix.length);
};

const addPrefix = (key: string, prefix: string): string => {
  if (!prefix) return key;
  if (key === "" || key === "/") return prefix;
  return `${prefix}${key}`;
};

/**
 * Read an S3 response body as ArrayBuffer regardless of SDK version quirks.
 * Note: the Readable (Node.js stream) branch is intentionally omitted — all
 * responses in the Obsidian runtime flow through ObsidianHttpHandler which
 * returns a Web ReadableStream, never a Node Readable.
 */
const bodyToArrayBuffer = async (
  body: ReadableStream | Blob | undefined
): Promise<ArrayBuffer> => {
  if (body === undefined) throw new Error("S3 response body is undefined");
  if (body instanceof ReadableStream) {
    return new Response(body).arrayBuffer();
  }
  if (body instanceof Blob) {
    return body.arrayBuffer();
  }
  throw new TypeError(`Unknown body type: ${typeof body}`);
};

/**
 * Parse the "MTime" / "mtime" metadata field stored as a float (seconds).
 * Returns milliseconds, or undefined if not present / zero.
 */
const parseMTimeMetadata = (raw: string | undefined): number | undefined => {
  if (!raw) return undefined;
  const seconds = parseFloat(raw);
  if (!seconds || isNaN(seconds)) return undefined;
  // Old plugin versions stored milliseconds; new stores seconds.
  return seconds >= 1_000_000_000_000 ? seconds : seconds * 1000;
};

const mtimeToMetaString = (ms: number): string => `${ms / 1000.0}`;

// ─── Entity constructors ─────────────────────────────────────────────────────

const entityFromListObject = (
  obj: _Object,
  prefix: string,
  mtimeOverrides: Record<string, number>
): FileEntity => {
  if (!obj.LastModified) {
    throw new Error(`S3 object ${obj.Key} has no LastModified`);
  }
  const mtimeSvr = Math.floor(obj.LastModified.valueOf() / 1000) * 1000;
  const mtimeCli = mtimeOverrides[obj.Key!] ?? mtimeSvr;
  const key = stripPrefix(obj.Key!, prefix);
  return {
    key,
    keyRaw: key,
    mtimeSvr,
    mtimeCli,
    sizeRaw: obj.Size ?? 0,
    size: obj.Size ?? 0,
    etag: obj.ETag,
    synthesizedFolder: false,
  };
};

const entityFromHeadObject = (
  fullKey: string,
  head: HeadObjectCommandOutput,
  prefix: string,
  useAccurateMTime: boolean
): FileEntity => {
  if (!head.LastModified) {
    throw new Error(`S3 HEAD ${fullKey} has no LastModified`);
  }
  const mtimeSvr = Math.floor(head.LastModified.valueOf() / 1000) * 1000;
  let mtimeCli = mtimeSvr;
  if (useAccurateMTime && head.Metadata) {
    const override = parseMTimeMetadata(
      head.Metadata.mtime ?? head.Metadata.MTime
    );
    if (override) mtimeCli = override;
  }
  const key = stripPrefix(fullKey, prefix);
  return {
    key,
    keyRaw: key,
    mtimeSvr,
    mtimeCli,
    sizeRaw: head.ContentLength ?? 0,
    size: head.ContentLength ?? 0,
    etag: head.ETag,
    synthesizedFolder: false,
  };
};

// ─── S3 client factory ───────────────────────────────────────────────────────

const buildS3Client = (cfg: R2Config): S3Client => {
  let endpoint = cfg.endpoint;
  if (!endpoint.startsWith("http://") && !endpoint.startsWith("https://")) {
    endpoint = `https://${endpoint}`;
  }

  const baseOptions = {
    region: cfg.region || "auto",
    endpoint,
    forcePathStyle: cfg.forcePathStyle ?? true,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  };

  const client = VALID_OBSIDIAN_REQURL
    ? new S3Client({ ...baseOptions, requestHandler: new ObsidianHttpHandler() })
    : new S3Client(baseOptions);

  // Always send Cache-Control: no-cache to avoid stale reads from CDN caches.
  client.middlewareStack.add(
    (next) => (args) => {
      (args.request as any).headers["cache-control"] = "no-cache";
      return next(args);
    },
    { step: "build" }
  );

  return client;
};

// ─── StorageR2 ───────────────────────────────────────────────────────────────

export class StorageR2 extends StorageBase {
  readonly kind = "r2";
  private readonly cfg: R2Config;
  private readonly client: S3Client;
  private readonly prefix: string;
  /**
   * Cache of synthesised folder entries built during walk().
   * Keyed by the folder's local (prefix-stripped) path.
   */
  private synthFolders: Record<string, FileEntity> = {};

  constructor(cfg: R2Config) {
    super();
    this.cfg = cfg;
    this.prefix = normaliseRemotePrefix(cfg.remotePrefix);
    this.client = buildS3Client(cfg);
  }

  // ── Listing ─────────────────────────────────────────────────────────────────

  async walk(): Promise<FileEntity[]> {
    const all = await this._listFromRoot(false);
    return all.filter((e) => e.key !== "" && e.key !== "/");
  }

  async walkPartial(): Promise<FileEntity[]> {
    const some = await this._listFromRoot(true);
    return some.filter((e) => e.key !== "" && e.key !== "/");
  }

  private async _listFromRoot(partial: boolean): Promise<FileEntity[]> {
    const cmd: ListObjectsV2CommandInput = {
      Bucket: this.cfg.bucketName,
    };
    if (this.prefix) cmd.Prefix = this.prefix;
    if (partial) cmd.MaxKeys = 20;

    const objects: _Object[] = [];
    const mtimeOverrides: Record<string, number> = {};

    // Queue HEAD requests for accurate mtime (expensive but optional)
    let headQueueError: Error | undefined;
    const headQueue = new PQueue({
      concurrency: partial ? 1 : (this.cfg.partsConcurrency ?? 5),
      autoStart: true,
    });
    headQueue.on("error", (err) => {
      headQueueError = err as Error;
      headQueue.pause();
      headQueue.clear();
    });

    let isTruncated = true;
    while (isTruncated) {
      const rsp = await this.client.send(new ListObjectsV2Command(cmd));
      if (rsp.$metadata.httpStatusCode !== 200) {
        throw new Error("R2 ListObjectsV2 returned non-200");
      }
      if (!rsp.Contents?.length) break;

      objects.push(...rsp.Contents);

      if (this.cfg.useAccurateMTime) {
        for (const obj of rsp.Contents) {
          headQueue.add(async () => {
            const head = await this.client.send(
              new HeadObjectCommand({ Bucket: this.cfg.bucketName, Key: obj.Key })
            );
            if (head.Metadata) {
              const t = parseMTimeMetadata(
                head.Metadata.mtime ?? head.Metadata.MTime
              );
              if (t) mtimeOverrides[obj.Key!] = t;
            }
          });
        }
      }

      isTruncated = partial ? false : (rsp.IsTruncated ?? false);
      if (isTruncated) {
        if (!rsp.NextContinuationToken) {
          throw new Error("R2 listing is truncated but no continuation token");
        }
        cmd.ContinuationToken = rsp.NextContinuationToken;
      }
    }

    await headQueue.onIdle();
    if (headQueueError) throw headQueueError;

    // Build entity list and synthesise folder entries from key prefixes
    const entities: FileEntity[] = [];
    const realKeys = new Set<string>();

    for (const obj of objects) {
      const entity = entityFromListObject(obj, this.prefix, mtimeOverrides);
      // Never expose the internal sentinel directory to the sync engine.
      if (entity.key!.startsWith("__sss_state__/")) continue;
      realKeys.add(entity.key!);
      entities.push(entity);

      for (const folderKey of getFolderLevels(entity.key!, true)) {
        if (realKeys.has(folderKey)) {
          // Real folder object exists; remove synthesised duplicate
          delete this.synthFolders[folderKey];
          continue;
        }
        const existing = this.synthFolders[folderKey];
        if (!existing || entity.mtimeSvr! >= (existing.mtimeSvr ?? 0)) {
          this.synthFolders[folderKey] = {
            key: folderKey,
            keyRaw: folderKey,
            size: 0,
            sizeRaw: 0,
            mtimeSvr: entity.mtimeSvr,
            mtimeCli: entity.mtimeCli,
            synthesizedFolder: true,
          };
        }
      }
    }

    for (const synth of Object.values(this.synthFolders)) {
      entities.push(synth);
    }
    return entities;
  }

  // ── stat ─────────────────────────────────────────────────────────────────────

  async stat(key: string): Promise<FileEntity> {
    if (this.synthFolders[key]) return this.synthFolders[key];
    const fullKey = addPrefix(key, this.prefix);
    return this._headObject(fullKey);
  }

  private async _headObject(fullKey: string): Promise<FileEntity> {
    const head = await this.client.send(
      new HeadObjectCommand({ Bucket: this.cfg.bucketName, Key: fullKey })
    );
    return entityFromHeadObject(
      fullKey,
      head,
      this.prefix,
      this.cfg.useAccurateMTime ?? false
    );
  }

  // ── mkdir ────────────────────────────────────────────────────────────────────

  async mkdir(key: string, mtime?: number, _ctime?: number): Promise<FileEntity> {
    if (!key.endsWith("/")) throw new Error(`mkdir called with non-folder key: ${key}`);

    if (!this.cfg.generateFolderObject) {
      // R2 is a flat key-value store; we just track the folder in memory.
      const synth: FileEntity = {
        key,
        keyRaw: key,
        size: 0,
        sizeRaw: 0,
        mtimeSvr: mtime,
        mtimeCli: mtime,
        synthesizedFolder: true,
      };
      this.synthFolders[key] = synth;
      return synth;
    }

    const fullKey = addPrefix(key, this.prefix);
    return this._putFolderObject(fullKey, mtime, _ctime);
  }

  private async _putFolderObject(
    fullKey: string,
    mtime?: number,
    ctime?: number
  ): Promise<FileEntity> {
    const metadata: Record<string, string> = {};
    if (mtime) metadata["MTime"] = mtimeToMetaString(mtime);
    if (ctime) metadata["CTime"] = mtimeToMetaString(ctime);

    const params: PutObjectCommandInput = {
      Bucket: this.cfg.bucketName,
      Key: fullKey,
      Body: "",
      ContentType: "application/octet-stream",
      ContentLength: 0,
      ...(Object.keys(metadata).length ? { Metadata: metadata } : {}),
    };
    await this.client.send(new PutObjectCommand(params));
    return this._headObject(fullKey);
  }

  // ── writeFile ────────────────────────────────────────────────────────────────

  async writeFile(
    key: string,
    content: ArrayBuffer,
    mtime: number,
    ctime: number
  ): Promise<FileEntity> {
    const fullKey = addPrefix(key, this.prefix);
    const body = new Uint8Array(content);
    const contentType =
      mime.contentType(mime.lookup(key) || "application/octet-stream") ||
      "application/octet-stream";

    const upload = new Upload({
      client: this.client,
      queueSize: this.cfg.partsConcurrency ?? 5,
      partSize: 5 * 1024 * 1024, // 5 MB minimum for multipart
      leavePartsOnError: false,
      params: {
        Bucket: this.cfg.bucketName,
        Key: fullKey,
        Body: body,
        ContentType: contentType,
        Metadata: {
          MTime: mtimeToMetaString(mtime),
          CTime: mtimeToMetaString(ctime),
        },
      },
    });

    await upload.done();
    return this._headObject(fullKey);
  }

  // ── readFile ─────────────────────────────────────────────────────────────────

  async readFile(key: string): Promise<ArrayBuffer> {
    if (key.endsWith("/")) throw new Error(`readFile called on folder: ${key}`);
    const fullKey = addPrefix(key, this.prefix);
    const rsp = await this.client.send(
      new GetObjectCommand({ Bucket: this.cfg.bucketName, Key: fullKey })
    );
    return bodyToArrayBuffer(rsp.Body as ReadableStream | Blob | undefined);
  }

  // ── rename ───────────────────────────────────────────────────────────────────

  rename(_src: string, _dst: string): Promise<void> {
    // R2/S3 has no server-side rename; copy + delete would require reading the whole file.
    // The sync engine never calls rename directly – it pushes a new version and the
    // old one gets cleaned up on the next pass.
    return Promise.reject(new Error("rename is not supported for R2 storage"));
  }

  // ── rm ───────────────────────────────────────────────────────────────────────

  async rm(key: string): Promise<void> {
    if (key === "/" || key === "") return;

    if (key.endsWith("/")) {
      // Remove from synthesised folder cache first
      delete this.synthFolders[key];
      // Best-effort delete of any real folder object
      try {
        await this.client.send(
          new DeleteObjectCommand({
            Bucket: this.cfg.bucketName,
            Key: addPrefix(key, this.prefix),
          })
        );
      } catch {
        // Ignore; folder may not exist as a real object
      }
      return;
    }

    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.cfg.bucketName,
        Key: addPrefix(key, this.prefix),
      })
    );
  }

  // ── connectivity ─────────────────────────────────────────────────────────────

  async checkConnection(onError?: (err: unknown) => void): Promise<boolean> {
    // Fail fast before the SDK tries to resolve an empty/malformed URL, which
    // can hang for the full request-timeout instead of rejecting immediately.
    if (!this.cfg.endpoint || !this.cfg.bucketName || !this.cfg.accessKeyId) {
      const err = new Error("R2 endpoint, bucket name, and access key are required.");
      onError?.(err);
      return false;
    }
    try {
      const rsp = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.cfg.bucketName,
          MaxKeys: 1,
        })
      );
      if (!rsp.$metadata.httpStatusCode || rsp.$metadata.httpStatusCode !== 200) {
        throw new Error(`Unexpected HTTP status: ${rsp.$metadata.httpStatusCode}`);
      }
    } catch (err) {
      if (onError) {
        // Helpful hint: bucket name included in endpoint is a common mistake
        const errWithHint =
          this.cfg.endpoint.includes(this.cfg.bucketName)
            ? new AggregateError([
                err as Error,
                new Error(
                  "Your endpoint appears to include the bucket name. " +
                    "Remove it from the endpoint field and put it in Bucket Name only."
                ),
              ])
            : err;
        onError(errWithHint);
      }
      return false;
    }
    return true;
  }

  getUserDisplayName(): Promise<string> {
    return Promise.resolve(`${this.cfg.bucketName}${this.prefix ? ` / ${this.prefix}` : ""}`);
  }
}

// re-export config default for convenience
export { DEFAULT_R2_CONFIG } from "./types";
