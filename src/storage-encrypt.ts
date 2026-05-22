/**
 * storage-encrypt.ts
 * Transparent encryption layer that wraps any StorageBase backend.
 *
 * Encryption pipeline:
 *   File names → encrypted using chosen cipher → stored on remote
 *   File content → encrypted using chosen cipher → stored on remote
 *
 * openssl-base64 specifics:
 *   - File CONTENT is always encrypted.
 *   - File NAMES are encrypted (prefixed with magic prefix).
 *   - Folder paths are stored PLAINTEXT on the remote because S3 folder
 *     objects are synthetic (derived from key prefixes) and the openssl
 *     cipher has no concept of folder-level name encryption.
 *   → During walk/decrypt, any key ending with "/" is passed through as-is.
 *
 * rclone-base64:
 *   - Both file names AND folder names are encrypted.
 *
 * IMPORTANT — ETag passthrough:
 *   S3 ETags are the MD5 of the encrypted blob. They don't change unless the
 *   file content changes. The sync engine uses ETags as its primary
 *   "has this file changed?" signal. Every entity returned by walk() and stat()
 *   MUST carry the etag field; without it the engine falls back to mtime
 *   comparison, and S3 server timestamps never match local file mtimes →
 *   every file gets re-synced on every run.
 */

import cloneDeep from "lodash/cloneDeep";
import { StorageBase } from "./storage-base";
import type { EncryptionMethod, FileEntity } from "./types";
import * as openssl from "./encrypt-openssl";
import * as rclone from "./encrypt-rclone";
import { isSpecialFolderNameToSkip, isValidText } from "./utils";

// ─── Password check result ────────────────────────────────────────────────────

export type PasswordCheckReason =
  | "empty_remote"
  | "no_password_both_sides"
  | "password_matched"
  | "unknown_method"
  | "remote_encrypted_no_local_password"
  | "method_mismatch"
  | "wrong_password_or_not_encrypted";

export interface PasswordCheckResult {
  ok: boolean;
  reason: PasswordCheckReason;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isLikelyOpenSSLName(name: string): boolean {
  return (
    name.startsWith(openssl.MAGIC_PREFIX_BASE32) ||
    name.startsWith(openssl.MAGIC_PREFIX_BASE64URL)
  );
}

function isLikelyEncrypted(name: string): boolean {
  return isLikelyOpenSSLName(name);
}

/**
 * NOTE: Only call this on file entries (not folders).
 * In openssl-base64 mode, folder names are stored plaintext.
 */
function methodMismatch(name: string, method: EncryptionMethod): boolean {
  if (isLikelyOpenSSLName(name) && method !== "openssl-base64") return true;
  if (!isLikelyOpenSSLName(name) && method === "openssl-base64") return true;
  return false;
}

function cloneWithEnc(entity: FileEntity): FileEntity {
  const c = cloneDeep(entity);
  c.keyEnc = c.keyRaw;
  c.sizeEnc = c.sizeRaw;
  return c;
}

/**
 * For openssl-base64, folder names are stored plaintext on the remote.
 * Returns true when a key should bypass name encryption/decryption.
 */
function isPlaintextPassthrough(key: string, method: EncryptionMethod): boolean {
  return method === "openssl-base64" && key.endsWith("/");
}

// ─── StorageEncrypt ───────────────────────────────────────────────────────────

export class StorageEncrypt extends StorageBase {
  readonly kind: string;
  private readonly inner: StorageBase;
  private readonly password: string;
  private readonly method: EncryptionMethod;
  private readonly rcloneCipher?: rclone.CipherRclone;

  /** plaintext key → encrypted key (populated during walk) */
  private cacheEncKeys: Record<string, string> = {};
  private cacheBuilt = false;

  constructor(inner: StorageBase, password: string, method: EncryptionMethod) {
    super();
    this.inner = inner;
    this.password = password ?? "";
    this.method = method;
    this.kind = `encrypt(${inner.kind}, ${password ? method : "no-password"})`;

    if (password && method === "rclone-base64") {
      this.rcloneCipher = new rclone.CipherRclone(password, 5);
    }
  }

  get hasPassword(): boolean {
    return this.password !== "";
  }

  /** rclone-base64 encrypts folder names; openssl-base64 does not. */
  get isFolderAware(): boolean {
    if (this.method === "rclone-base64") return true;
    if (this.method === "openssl-base64") return false;
    throw new Error(`isFolderAware unknown for method=${this.method}`);
  }

  // ── Password validation ───────────────────────────────────────────────────────

  async validatePassword(): Promise<PasswordCheckResult> {
    // Use inner.walkPartial() directly — going through _processWalk would
    // attempt decryption and throw on bad passwords instead of returning a result.
    const rawPartial = await this.inner.walkPartial();

    if (!rawPartial.length) {
      return { ok: true, reason: "empty_remote" };
    }

    if (!this.hasPassword) {
      const anySample = rawPartial[0].keyRaw;
      return isLikelyEncrypted(anySample)
        ? { ok: false, reason: "remote_encrypted_no_local_password" }
        : { ok: true, reason: "no_password_both_sides" };
    }

    if (this.method === "none") {
      return { ok: false, reason: "unknown_method" };
    }

    // openssl-base64: folder names are plaintext — find a file entry to sample
    const fileEntries = rawPartial.filter((e) => !e.keyRaw.endsWith("/"));
    if (!fileEntries.length) {
      return { ok: true, reason: "empty_remote" };
    }

    const sample = fileEntries[0].keyRaw;

    if (methodMismatch(sample, this.method)) {
      return { ok: false, reason: "method_mismatch" };
    }

    try {
      const decrypted = await this._decryptName(sample);
      if (!decrypted) throw new Error("empty result");
      return { ok: true, reason: "password_matched" };
    } catch {
      return { ok: false, reason: "wrong_password_or_not_encrypted" };
    }
  }

  // ── Listing ─────────────────────────────────────────────────────────────────

  async walk(): Promise<FileEntity[]> {
    return this._processWalk(await this.inner.walk());
  }

  async walkPartial(): Promise<FileEntity[]> {
    return this._processWalk(await this.inner.walkPartial());
  }

  private async _processWalk(raw: FileEntity[]): Promise<FileEntity[]> {
    const result: FileEntity[] = [];

    for (const e of raw) {
      if (isSpecialFolderNameToSkip(e.keyRaw, [])) continue;

      const entityKey = e.key ?? e.keyRaw;

      if (!this.hasPassword) {
        const copy = cloneWithEnc(e);
        copy.key = entityKey;
        this.cacheEncKeys[entityKey] = entityKey;
        result.push(copy);
        continue;
      }

      // openssl-base64: folders are stored plaintext — pass through unchanged
      if (isPlaintextPassthrough(e.keyRaw, this.method)) {
        const copy = cloneWithEnc(e);
        copy.key = e.keyRaw;
        this.cacheEncKeys[e.keyRaw] = e.keyRaw;
        result.push(copy);
        continue;
      }

      let plainKey: string;
      try {
        plainKey = await this._decryptName(e.keyRaw);
      } catch (err) {
        console.warn(
          `[SSS] Skipping unreadable remote entry (decryption failed): ${e.keyRaw}`,
          (err as Error).message
        );
        continue;
      }

      result.push({
        key:             plainKey,
        keyRaw:          e.keyRaw,
        keyEnc:          entityKey,
        mtimeCli:        e.mtimeCli,
        mtimeSvr:        e.mtimeSvr,
        size:            plainKey.endsWith("/") ? 0 : undefined,
        sizeEnc:         e.size,
        sizeRaw:         e.sizeRaw,
        // ↓ CRITICAL: carry the S3 ETag through the encryption layer.
        // Without this, isChanged() can never do ETag comparison and falls
        // back to mtime, where S3 server time ≠ local file time → every
        // file appears "changed" on every sync.
        etag:            e.etag,
        synthesizedFolder: e.synthesizedFolder,
      });
      this.cacheEncKeys[plainKey] = e.keyRaw;
    }

    this.cacheBuilt = true;
    return result;
  }

  // ── stat ─────────────────────────────────────────────────────────────────────

  async stat(key: string): Promise<FileEntity> {
    this._requireCache("stat");
    const encKey = this._resolveEncKey(key);
    const e = await this.inner.stat(encKey);
    return this.hasPassword ? {
      key,
      keyRaw:          e.keyRaw,
      keyEnc:          e.key!,
      mtimeCli:        e.mtimeCli,
      mtimeSvr:        e.mtimeSvr,
      size:            undefined, // plaintext size unknown without decrypting
      sizeEnc:         e.size,
      sizeRaw:         e.sizeRaw,
      // ↓ Same as _processWalk: carry ETag through so push post-stat returns
      // it to main.ts for storage in the prevSync record.
      etag:            e.etag,
      synthesizedFolder: e.synthesizedFolder,
    } : cloneWithEnc(e);
  }

  // ── mkdir ────────────────────────────────────────────────────────────────────

  async mkdir(key: string, mtime?: number, ctime?: number): Promise<FileEntity> {
    this._requireCache("mkdir");
    if (!key.endsWith("/")) throw new Error(`mkdir on non-folder: ${key}`);
    const encKey = await this._resolveOrEncryptKey(key);
    const e = await this.inner.mkdir(encKey, mtime, ctime);
    return cloneWithEnc(e);
  }

  // ── writeFile ────────────────────────────────────────────────────────────────

  async writeFile(
    key: string,
    content: ArrayBuffer,
    mtime: number,
    ctime: number
  ): Promise<FileEntity> {
    this._requireCache("writeFile");
    const encKey = await this._resolveOrEncryptKey(key);

    if (!this.hasPassword) {
      const e = await this.inner.writeFile(encKey, content, mtime, ctime);
      return cloneWithEnc(e);
    }

    const encContent = await this._encryptContent(content);
    const e = await this.inner.writeFile(encKey, encContent, mtime, ctime);
    return {
      key,
      keyRaw:   e.keyRaw,
      keyEnc:   e.key!,
      mtimeCli: e.mtimeCli,
      mtimeSvr: e.mtimeSvr,
      size:     undefined,
      sizeEnc:  e.size,
      sizeRaw:  e.sizeRaw,
      etag:     e.etag, // returned by StorageR2.writeFile via _headObject
    };
  }

  // ── readFile ─────────────────────────────────────────────────────────────────

  async readFile(key: string): Promise<ArrayBuffer> {
    this._requireCache("readFile");
    const encKey = this._resolveEncKey(key);
    const encrypted = await this.inner.readFile(encKey);
    return this.hasPassword ? this._decryptContent(encrypted) : encrypted;
  }

  // ── rename ───────────────────────────────────────────────────────────────────

  async rename(key1: string, key2: string): Promise<void> {
    this._requireCache("rename");
    const enc1 = await this._resolveOrEncryptKey(key1);
    const enc2 = await this._resolveOrEncryptKey(key2);
    return this.inner.rename(enc1, enc2);
  }

  // ── rm ───────────────────────────────────────────────────────────────────────

  async rm(key: string): Promise<void> {
    this._requireCache("rm");
    const encKey = this._resolveEncKey(key);
    return this.inner.rm(encKey);
  }

  // ── connectivity ─────────────────────────────────────────────────────────────

  async checkConnection(onError?: (err: unknown) => void): Promise<boolean> {
    return this.inner.checkConnection(onError);
  }

  getUserDisplayName(): Promise<string> {
    return this.inner.getUserDisplayName();
  }

  closeResources(): Promise<void> {
    if (this.method === "rclone-base64" && this.rcloneCipher) {
      this.rcloneCipher.closeResources();
    }
    return Promise.resolve();
  }

  // ── Entity helper ────────────────────────────────────────────────────────────

  async encryptEntity(input: FileEntity): Promise<FileEntity> {
    if (!input.key) throw new Error(`encryptEntity: entity missing key`);
    if (!this.hasPassword) return cloneWithEnc(input);

    const local = cloneDeep(input);
    if (local.sizeEnc === undefined && local.size !== undefined) {
      local.sizeEnc = this._estimateEncSize(local.size);
    }
    if (!local.keyEnc) {
      const cached = this.cacheEncKeys[input.key];
      if (cached && cached !== local.key) {
        local.keyEnc = cached;
      } else {
        const fresh = await this._encryptName(input.key);
        local.keyEnc = fresh;
        this.cacheEncKeys[input.key] = fresh;
      }
    }
    return local;
  }

  // ── Private: key resolution ──────────────────────────────────────────────────

  private _requireCache(op: string): void {
    if (!this.cacheBuilt) {
      throw new Error(`${op}: walk() must be called before performing operations`);
    }
  }

  private _resolveEncKey(plainKey: string): string {
    const enc = this.cacheEncKeys[plainKey];
    if (!enc) throw new Error(`No cached encrypted key for "${plainKey}"`);
    return enc;
  }

  private async _resolveOrEncryptKey(plainKey: string): Promise<string> {
    const cached = this.cacheEncKeys[plainKey];
    if (cached) return cached;
    const enc = this.hasPassword ? await this._encryptName(plainKey) : plainKey;
    this.cacheEncKeys[plainKey] = enc;
    return enc;
  }

  // ── Private: crypto ──────────────────────────────────────────────────────────

  private async _encryptContent(plain: ArrayBuffer): Promise<ArrayBuffer> {
    if (!this.hasPassword) return plain;
    if (this.method === "openssl-base64") return openssl.encryptArrayBuffer(plain, this.password);
    if (this.method === "rclone-base64")  return this.rcloneCipher!.encryptContentByCallingWorker(plain);
    throw new Error(`Unsupported method: ${this.method}`);
  }

  private async _decryptContent(enc: ArrayBuffer): Promise<ArrayBuffer> {
    if (!this.hasPassword) return enc;
    if (this.method === "openssl-base64") return openssl.decryptArrayBuffer(enc, this.password);
    if (this.method === "rclone-base64")  return this.rcloneCipher!.decryptContentByCallingWorker(enc);
    throw new Error(`Unsupported method: ${this.method}`);
  }

  private async _encryptName(plain: string): Promise<string> {
    if (!this.hasPassword) return plain;
    if (isPlaintextPassthrough(plain, this.method)) return plain;
    if (this.method === "openssl-base64") return openssl.encryptStringToBase64url(plain, this.password);
    if (this.method === "rclone-base64")  return this.rcloneCipher!.encryptNameByCallingWorker(plain);
    throw new Error(`Unsupported method: ${this.method}`);
  }

  private async _decryptName(enc: string): Promise<string> {
    if (!this.hasPassword) return enc;
    if (isPlaintextPassthrough(enc, this.method)) return enc;
    if (this.method === "openssl-base64") {
      if (enc.startsWith(openssl.MAGIC_PREFIX_BASE32)) {
        const result = await openssl.decryptBase32ToString(enc, this.password);
        if (!result || !isValidText(result)) throw new Error(`Bad decryption: ${enc}`);
        return result;
      }
      if (enc.startsWith(openssl.MAGIC_PREFIX_BASE64URL)) {
        const result = await openssl.decryptBase64urlToString(enc, this.password);
        if (!result || !isValidText(result)) throw new Error(`Bad decryption: ${enc}`);
        return result;
      }
      throw new Error(`Not an openssl-encrypted name: ${enc}`);
    }
    if (this.method === "rclone-base64") return this.rcloneCipher!.decryptNameByCallingWorker(enc);
    throw new Error(`Unsupported method: ${this.method}`);
  }

  private _estimateEncSize(plain: number): number {
    if (this.method === "openssl-base64") return openssl.getSizeFromOrigToEnc(plain);
    if (this.method === "rclone-base64")  return rclone.getSizeFromOrigToEnc(plain);
    throw new Error(`Unsupported method: ${this.method}`);
  }
}
