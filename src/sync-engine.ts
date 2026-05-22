/**
 * sync-engine.ts
 * Core sync decision engine for Secure-Smart-Sync (SSS).
 */

import type {
  ConflictResolution,
  FileEntity,
  MixedEntity,
  PluginSettings,
  SyncDecision,
  SyncDirection,
  SyncStats,
} from "./types";
import PQueue from "p-queue";
import type { StorageBase } from "./storage-base";
import { copyFileOrFolder } from "./sync-copy";
import type { PluginLogger } from "./logger";
import { delay } from "./utils";

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 500;

// ─── Sync task ────────────────────────────────────────────────────────────────

export type TaskKind =
  | "push"
  | "pull"
  | "delete_remote"
  | "delete_local"
  | "mkdir_local"
  | "mkdir_remote"
  | "keep_both"    // write remote as _conflict_NN locally; push local to remote
  | "skip";

export interface SyncTask {
  key: string;
  kind: TaskKind;
  decision: SyncDecision;
  entity: MixedEntity;
}

// ─── ignorePaths matching ─────────────────────────────────────────────────────

export function matchesIgnorePath(key: string, patterns: string[]): boolean {
  if (!patterns.length) return false;
  for (const raw of patterns) {
    const p = raw.trim();
    if (!p || p.startsWith("#")) continue;
    if (p === key) return true;
    if (p.endsWith("/") && key.startsWith(p)) return true;
    const regexStr = p
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, "<GLOBSTAR>")
      .replace(/\*/g, "[^/]*")
      .replace(/<GLOBSTAR>/g, ".*");
    if (new RegExp(`^${regexStr}$`).test(key)) return true;
  }
  return false;
}

// ─── Decision engine ──────────────────────────────────────────────────────────

export function buildMixedEntities(
  localEntities: FileEntity[],
  prevSyncEntities: FileEntity[],
  remoteEntities: FileEntity[],
  ignorePaths: string[] = []
): MixedEntity[] {
  const map = new Map<string, MixedEntity>();

  const add = (side: "local" | "prevSync" | "remote", entity: FileEntity) => {
    const key = entity.key ?? entity.keyRaw;
    if (matchesIgnorePath(key, ignorePaths)) return;
    if (!map.has(key)) map.set(key, { key });
    map.get(key)![side] = entity;
  };

  for (const e of localEntities)    add("local",    e);
  for (const e of prevSyncEntities) add("prevSync", e);
  for (const e of remoteEntities)   add("remote",   e);

  return Array.from(map.values());
}

export function decideAction(
  entity: MixedEntity,
  direction: SyncDirection,
  conflict: ConflictResolution,
  maxFileSizeBytes: number,
  alwaysAsk = false
): SyncDecision {
  const { local, prevSync, remote } = entity;
  const key = entity.key;
  const isFolder = key.endsWith("/");

  if (isFolder) {
    if (local && remote) return "no_change";
    if (local && !remote) return direction === "pull_only" ? "no_change" : "mkdir_remote";
    if (!local && remote) return direction === "push_only" ? "no_change" : "mkdir_local";
    return "no_change";
  }

  const tooLarge = (e: FileEntity | undefined) =>
    maxFileSizeBytes > 0 && e?.size !== undefined && e.size > maxFileSizeBytes;
  if (tooLarge(local) || tooLarge(remote)) return "skip_too_large";

  if (!local && !remote) return "no_change";

  if (!prevSync) {
    if (local && !remote) return direction === "pull_only" ? "no_change" : "push_local";
    if (!local && remote) return direction === "push_only" ? "no_change" : "pull_remote";
    return resolveConflict(local!, remote!, conflict, direction, alwaysAsk);
  }

  const localDeleted  = !local  && !!prevSync;
  const remoteDeleted = !remote && !!prevSync;

  if (localDeleted && remoteDeleted) return "no_change";

  if (localDeleted && !remoteDeleted) {
    return isChanged(remote!, prevSync)
      ? (direction !== "push_only" ? "pull_remote" : "no_change")
      : (direction !== "pull_only" ? "delete_remote" : "no_change");
  }

  if (remoteDeleted && !localDeleted) {
    return isChanged(local!, prevSync)
      ? (direction !== "pull_only" ? "push_local" : "no_change")
      : (direction !== "push_only" ? "delete_local" : "no_change");
  }

  const localChanged  = isChanged(local!,  prevSync);
  const remoteChanged = isChanged(remote!, prevSync);

  if (!localChanged && !remoteChanged) return "no_change";
  if ( localChanged && !remoteChanged) return direction !== "pull_only" ? "push_local"  : "no_change";
  if (!localChanged &&  remoteChanged) return direction !== "push_only" ? "pull_remote" : "no_change";

  return resolveConflict(local!, remote!, conflict, direction, alwaysAsk);
}

/**
 * Determine whether a file has changed since the last sync.
 *
 * Priority of comparisons (most reliable first):
 *
 * 1. ETag  — S3 always returns one. If both sides have an ETag, it is
 *            definitive: match → unchanged, differ → changed.
 *            This is the key fix for encrypted remotes and repeated syncs:
 *            - Encrypted remote entities have size=undefined (plaintext
 *              unknown) and mtimeCli=upload-time (not original mtime), so
 *            both size and mtime comparisons would give wrong results.
 *            - With ETag, we bypass both those unreliable fields entirely.
 *
 * 2. Plaintext size — only compared when both entities have a defined `size`
 *            (not sizeRaw which may be the encrypted-blob size).
 *
 * 3. Mtime  — last resort, 1-second tolerance for FAT32 / S3 rounding.
 */
function isChanged(current: FileEntity, prev: FileEntity): boolean {
  // ── ETag (definitive) ─────────────────────────────────────────────────────
  if (current.etag && prev.etag) {
    return current.etag !== prev.etag;
  }

  // ── Plaintext size ────────────────────────────────────────────────────────
  // Use `.size`, not `.sizeRaw`, to avoid comparing encrypted vs plaintext.
  if (current.size !== undefined && prev.size !== undefined && current.size !== prev.size) {
    return true;
  }

  // ── Mtime (1-second tolerance) ────────────────────────────────────────────
  const curTime  = current.mtimeCli ?? 0;
  const prevTime = prev.mtimeCli    ?? 0;
  if (curTime === 0 && prevTime === 0) return false;
  return Math.abs(curTime - prevTime) > 1000;
}

function resolveConflict(
  local: FileEntity,
  remote: FileEntity,
  resolution: ConflictResolution,
  direction: SyncDirection,
  alwaysAsk: boolean
): SyncDecision {
  if (alwaysAsk) return "conflict_ask";
  if (direction === "push_only") return "conflict_keep_local";
  if (direction === "pull_only") return "conflict_keep_remote";
  switch (resolution) {
    case "keep_local":  return "conflict_keep_local";
    case "keep_remote": return "conflict_keep_remote";
    case "keep_both":   return "conflict_keep_both";
    case "ask":         return "conflict_ask";
    case "keep_newer": {
      const lt = local.mtimeCli ?? 0;
      const rt = remote.mtimeCli ?? remote.mtimeSvr ?? 0;
      return lt >= rt ? "conflict_keep_local" : "conflict_keep_remote";
    }
    case "keep_larger": {
      const ls = local.size ?? 0;
      const rs = remote.size ?? 0;
      return ls >= rs ? "conflict_keep_local" : "conflict_keep_remote";
    }
  }
}

// ─── Task builder ─────────────────────────────────────────────────────────────

export function buildTasks(
  mixed: MixedEntity[],
  settings: Pick<PluginSettings, "syncDirection" | "conflictResolution" | "conflictAlwaysAsk" | "maxFileSizeBytes" | "ignorePaths">
): SyncTask[] {
  const tasks: SyncTask[] = [];
  const { syncDirection, conflictResolution, conflictAlwaysAsk, maxFileSizeBytes } = settings;

  for (const entity of mixed) {
    const decision = decideAction(entity, syncDirection, conflictResolution, maxFileSizeBytes, conflictAlwaysAsk);
    entity.decision = decision;
    entity.changed = decision !== "no_change" && decision !== "skip_too_large" && decision !== "equal";
    tasks.push({ key: entity.key, kind: decisionToTaskKind(decision), decision, entity });
  }

  tasks.sort((a, b) => {
    const af = a.key.endsWith("/") ? 0 : 1;
    const bf = b.key.endsWith("/") ? 0 : 1;
    if (af !== bf) return af - bf;
    return a.key.localeCompare(b.key);
  });

  return tasks;
}

function decisionToTaskKind(d: SyncDecision): TaskKind {
  switch (d) {
    case "push_local":
    case "conflict_keep_local":  return "push";
    case "pull_remote":
    case "conflict_keep_remote": return "pull";
    case "conflict_keep_both":   return "keep_both";
    case "conflict_ask":         return "skip";  // deferred — handled post-queue via onConflictAsk
    case "delete_remote":        return "delete_remote";
    case "delete_local":         return "delete_local";
    case "mkdir_local":          return "mkdir_local";
    case "mkdir_remote":         return "mkdir_remote";
    default:                     return "skip";
  }
}

// ─── Conflict copy helpers ────────────────────────────────────────────────────

/**
 * Derive the path for the `_conflict_NN` copy of a file.
 *
 * The counter is NOT stored anywhere — it is computed by scanning existing
 * local files at write-time. This gives automatic "reset on rename" behaviour:
 * a renamed file's stem never has existing conflict slots, so the counter
 * always starts at 01 for a fresh stem.
 *
 * Convention: remote content always becomes the `_conflict_NN` copy.
 * The local file stays at its canonical path (user's work is never displaced).
 *
 * Examples:
 *   notes.md              →  notes._conflict_01.md
 *   docs/api/intro.md     →  docs/api/intro._conflict_01.md
 *   README (no ext)       →  README._conflict_01
 *   .gitignore (no stem)  →  .gitignore._conflict_01
 */
export async function conflictCopyKey(
  key: string,
  local: StorageBase,
  logger?: PluginLogger
): Promise<string> {
  // Split path into directory prefix, stem, and extension.
  const lastSlash = key.lastIndexOf("/");
  const dir       = lastSlash >= 0 ? key.slice(0, lastSlash + 1) : "";
  const fileName  = lastSlash >= 0 ? key.slice(lastSlash + 1)    : key;

  // Extension: everything from the LAST dot that is NOT at position 0
  // (handles .gitignore, .env, etc. — those have no extension).
  const dotIdx  = fileName.lastIndexOf(".");
  const hasDot  = dotIdx > 0;  // > 0 so leading-dot files are treated as no-extension
  const stem    = hasDot ? fileName.slice(0, dotIdx) : fileName;
  const ext     = hasDot ? fileName.slice(dotIdx)    : "";

  // Scan slots 01–99 for the first free path.
  for (let n = 1; n <= 99; n++) {
    const nn        = String(n).padStart(2, "0");
    const candidate = `${dir}${stem}._conflict_${nn}${ext}`;
    try {
      await local.stat(candidate);
      // stat succeeded — slot is occupied, try next
    } catch (err) {
      const msg = (err as Error).message ?? "";
      // Any "not found" flavour means the slot is free.
      if (
        msg.includes("not found") ||
        msg.includes("ENOENT")    ||
        msg.includes("does not exist")
      ) {
        return candidate;
      }
      // Unexpected error (permissions, I/O) — abort cleanly.
      throw new Error(
        `conflictCopyKey: could not stat "${candidate}": ${msg}`
      );
    }
  }

  // All 99 slots occupied — overwrite slot 99 with a warning.
  const fallback = `${dir}${stem}._conflict_99${ext}`;
  logger?.warn(`[SSS] All conflict slots occupied for "${key}", overwriting ${fallback}`);
  return fallback;
}

/**
 * Execute the keep_both resolution:
 *   1. Read the remote version.
 *   2. Compute the next available _conflict_NN path.
 *   3. Write the remote content locally under the conflict path.
 *   4. Push the local (canonical) version to remote.
 *
 * Returns the conflict copy key so the caller can log it.
 * Throws only for the local-write; remote-push failure is caught and surfaced
 * in stats to avoid a half-saved state being counted as a full failure.
 */
async function executeKeepBoth(
  task: SyncTask,
  local: StorageBase,
  remote: StorageBase,
  stats: SyncStats,
  logger?: PluginLogger
): Promise<string | undefined> {
  const { key } = task;

  // Step 1: read remote version.
  const remoteContent = await remote.readFile(key);
  const remoteMtime   = task.entity.remote?.mtimeCli ?? task.entity.remote?.mtimeSvr ?? Date.now();

  // Step 2: find a free conflict slot.
  const conflictKey = await conflictCopyKey(key, local, logger);

  // Step 3: write remote content as the conflict copy locally.
  await local.writeFile(conflictKey, remoteContent, remoteMtime, remoteMtime);
  logger?.info(`[SSS] Conflict copy saved: ${conflictKey}`);

  // Step 4: push local canonical version to remote.
  try {
    await copyFileOrFolder(key, local, remote);
  } catch (err) {
    const msg = `[keep_both push] ${key}: ${(err as Error).message}`;
    stats.errors.push(msg);
    logger?.error(msg);
    // The local conflict copy was already written successfully — do not
    // re-throw; the canonical key is partially resolved.
  }

  return conflictKey;
}

// ─── Task executor ────────────────────────────────────────────────────────────

export interface ExecuteOptions {
  local: StorageBase;
  remote: StorageBase;
  tasks: SyncTask[];
  concurrency?: number;
  logger?: PluginLogger;
  onProgress?: (done: number, total: number, key: string) => void;
  /**
   * Called for each task with decision `conflict_ask` after the main queue drains.
   * Receives the conflicting SyncTask; must return the resolution chosen by the user,
   * or `"skip"` to leave the file untouched for this sync cycle.
   * If undefined, falls back to the effective `conflictResolution` setting.
   */
  onConflictAsk?: (task: SyncTask) => Promise<ConflictResolution | "skip">;
  /** Fallback conflict resolution when onConflictAsk is not provided or unavailable. */
  fallbackConflictResolution?: ConflictResolution;
}

export async function executeTasks(opts: ExecuteOptions): Promise<SyncStats> {
  const {
    local, remote, tasks, concurrency = 8, logger, onProgress,
    onConflictAsk, fallbackConflictResolution = "keep_newer",
  } = opts;
  const stats: SyncStats = {
    filesUploaded: 0, filesDownloaded: 0, filesDeleted: 0,
    filesSkipped: 0, conflictsResolved: 0, errors: [], startedAt: Date.now(),
  };

  // Separate deferred (always-ask) tasks from the main queue.
  const deferred: SyncTask[] = [];
  const actionable = tasks.filter((t) => {
    if (t.decision === "conflict_ask") {
      deferred.push(t);
      return false;
    }
    return t.kind !== "skip";
  });
  let done = 0;

  // A proper concurrency pool keeps exactly `concurrency` tasks in flight at
  // all times, unlike the old batch approach that waited for the slowest task
  // in each group before starting the next.
  const queue = new PQueue({ concurrency });

  for (const task of actionable) {
    queue.add(async () => {
      let lastErr: Error | undefined;
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          if (attempt > 0) {
            logger?.warn(`[SSS] Retrying ${task.kind} ${task.key} (attempt ${attempt + 1})…`);
            await delay(RETRY_BASE_MS * Math.pow(2, attempt - 1));
          }
          await executeTask(task, local, remote, stats, logger);
          recordTaskStats(task, stats);
          lastErr = undefined;
          break;
        } catch (err) {
          lastErr = err as Error;
        }
      }
      if (lastErr) {
        const msg = `[${task.kind}] ${task.key}: ${lastErr.message}`;
        stats.errors.push(msg);
        logger?.error(msg);
      }
      done++;
      onProgress?.(done, actionable.length, task.key);
    });
  }

  await queue.onIdle();

  // ── Deferred conflicts (always-ask) ────────────────────────────────────────
  // Process after the main queue drains so the user isn’t interrupted mid-sync.
  for (const task of deferred) {
    try {
      let resolution: ConflictResolution | "skip";
      if (onConflictAsk) {
        resolution = await onConflictAsk(task);
      } else {
        logger?.warn(`[SSS] No conflict resolver provided for "${task.key}", using fallback: ${fallbackConflictResolution}`);
        resolution = fallbackConflictResolution;
      }

      if (resolution === "skip") {
        logger?.info(`[SSS] User skipped conflict for "${task.key}"`);
        stats.filesSkipped++;
        continue;
      }

      // Re-resolve the task with the user’s chosen resolution.
      const resolvedTask: SyncTask = {
        ...task,
        decision: resolutionToDecision(resolution, task),
        kind: resolution === "keep_both" ? "keep_both"
              : resolution === "keep_local" || resolution === "keep_newer" || resolution === "keep_larger"
                ? "push"
                : "pull",
      };

      await executeTask(resolvedTask, local, remote, stats, logger);
      recordTaskStats(resolvedTask, stats);
    } catch (err) {
      const msg = `[conflict_ask] ${task.key}: ${(err as Error).message}`;
      stats.errors.push(msg);
      logger?.error(msg);
    }
  }

  stats.filesSkipped += tasks.length - actionable.length - deferred.length;
  stats.finishedAt = Date.now();
  return stats;
}

/**
 * Map a user-chosen ConflictResolution back to a concrete SyncDecision,
 * respecting keep_newer / keep_larger comparison on the actual entity.
 */
function resolutionToDecision(res: ConflictResolution, task: SyncTask): SyncDecision {
  const { local, remote } = task.entity;
  switch (res) {
    case "keep_local":  return "conflict_keep_local";
    case "keep_remote": return "conflict_keep_remote";
    case "keep_both":   return "conflict_keep_both";
    case "keep_newer": {
      const lt = local?.mtimeCli ?? 0;
      const rt = remote?.mtimeCli ?? remote?.mtimeSvr ?? 0;
      return lt >= rt ? "conflict_keep_local" : "conflict_keep_remote";
    }
    case "keep_larger": {
      const ls = local?.size ?? 0;
      const rs = remote?.size ?? 0;
      return ls >= rs ? "conflict_keep_local" : "conflict_keep_remote";
    }
    case "ask":
      // 'ask' should never arrive here (it's already been resolved by the modal),
      // but guard defensively — keep_both is the safest non-destructive fallback.
      return "conflict_keep_both";
    default: return "conflict_keep_local";
  }
}

function recordTaskStats(task: SyncTask, stats: SyncStats): void {
  switch (task.kind) {
    case "push":
      if (task.decision.startsWith("conflict")) stats.conflictsResolved++;
      else stats.filesUploaded++;
      break;
    case "pull":
      if (task.decision.startsWith("conflict")) stats.conflictsResolved++;
      else stats.filesDownloaded++;
      break;
    case "keep_both":
      stats.conflictsResolved++;
      break;
    case "delete_remote":
    case "delete_local":
      stats.filesDeleted++;
      break;
  }
}

async function executeTask(
  task: SyncTask,
  local: StorageBase,
  remote: StorageBase,
  stats: SyncStats,
  logger?: PluginLogger
): Promise<void> {
  const { key, kind, decision } = task;
  logger?.debug(`[SSS] ${kind} ${key} (${decision})`);

  switch (kind) {
    case "push":
      await copyFileOrFolder(key, local, remote);
      break;
    case "pull":
      await copyFileOrFolder(key, remote, local);
      break;
    case "keep_both":
      await executeKeepBoth(task, local, remote, stats, logger);
      break;
    case "delete_remote":
      await remote.rm(key);
      break;
    case "delete_local":
      await local.rm(key);
      break;
    case "mkdir_remote":
      await remote.mkdir(key);
      break;
    case "mkdir_local":
      await local.mkdir(key);
      break;
  }
}
