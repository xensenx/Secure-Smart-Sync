/**
 * database.ts
 * IndexedDB persistence layer via localforage for Secure-Smart-Sync (SSS).
 *
 * Stores:
 *  - prevSyncRecords  – file entity state from the last successful sync (used for 3-way diff)
 *  - syncHistory      – log of recent sync plans for debugging
 *  - miscKV           – arbitrary key-value pairs (last sync time, plugin version, etc.)
 *
 * All keys are namespaced by vaultId to support multiple vaults on the same device.
 */

import localforage from "localforage";
import { extendPrototype as extendGetItems } from "localforage-getitems";
import { extendPrototype as extendRemoveItems } from "localforage-removeitems";
import { nanoid } from "nanoid";

import type { FileEntity } from "./types";

extendGetItems(localforage);
extendRemoveItems(localforage);

type LF = typeof localforage;

// ─── Table names ─────────────────────────────────────────────────────────────

const DB_NAME = "sss_db";
const TBL_VERSIONS      = "schema_versions";
const TBL_PREV_SYNC     = "prev_sync_records";
const TBL_SYNC_HISTORY  = "sync_history";
const TBL_MISC_KV       = "misc_kv";
const TBL_VAULT_ID_MAP  = "vault_id_map";

const CURRENT_SCHEMA_VERSION = 1;

// ─── Internal DB handle ───────────────────────────────────────────────────────

export interface InternalDB {
  versions: LF;
  prevSync: LF;
  syncHistory: LF;
  miscKV: LF;
  vaultIdMap: LF;
}

// ─── Initialisation ───────────────────────────────────────────────────────────

export interface PrepareDBResult {
  db: InternalDB;
  vaultId: string;
}

/**
 * Open (or create) the database and return a handle + the stable vault ID.
 *
 * @param vaultBasePath  Obsidian vault path on disk (used to identify the vault).
 * @param legacyVaultId  ID from old config file, if migrating from a previous version.
 */
export async function prepareDB(
  vaultBasePath: string,
  legacyVaultId?: string
): Promise<PrepareDBResult> {
  const db: InternalDB = {
    versions:   lf(TBL_VERSIONS),
    prevSync:   lf(TBL_PREV_SYNC),
    syncHistory: lf(TBL_SYNC_HISTORY),
    miscKV:     lf(TBL_MISC_KV),
    vaultIdMap: lf(TBL_VAULT_ID_MAP),
  };

  // Resolve or create a stable vault ID
  const pathKey = `path2id\t${vaultBasePath}`;
  let vaultId: string | null = await db.vaultIdMap.getItem(pathKey);

  if (!vaultId) {
    vaultId = legacyVaultId?.trim() || nanoid();
    await db.vaultIdMap.setItem(pathKey, vaultId);
    await db.vaultIdMap.setItem(`id2path\t${vaultId}`, vaultBasePath);
  }

  // Run schema migrations if needed
  const versionKey = `${vaultId}\tschema_version`;
  const storedVersion: number | null = await db.versions.getItem(versionKey);
  if (storedVersion === null) {
    await db.versions.setItem(versionKey, CURRENT_SCHEMA_VERSION);
  } else if (storedVersion < CURRENT_SCHEMA_VERSION) {
    await migrateSchema(db, storedVersion, CURRENT_SCHEMA_VERSION, vaultId);
    await db.versions.setItem(versionKey, CURRENT_SCHEMA_VERSION);
  }

  return { db, vaultId };
}

function lf(storeName: string): LF {
  return localforage.createInstance({ name: DB_NAME, storeName });
}

async function migrateSchema(
  _db: InternalDB,
  from: number,
  to: number,
  vaultId: string
): Promise<void> {
  console.warn(`[SSS] Migrating DB schema ${from}→${to} for vault ${vaultId}`);
  // Future migrations go here
}

export async function destroyDB(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror  = () => reject(req.error);
    req.onblocked = () => console.warn("[SSS] DB deletion blocked");
  });
}

// ─── Prev-sync records ────────────────────────────────────────────────────────

const prevSyncKey = (vaultId: string, fileKey: string) =>
  `${vaultId}\t${fileKey}`;

export async function getAllPrevSyncRecords(
  db: InternalDB,
  vaultId: string
): Promise<FileEntity[]> {
  const prefix = `${vaultId}\t`;
  const all: Record<string, FileEntity | null> = await (db.prevSync as any).getItems();
  return Object.entries(all)
    .filter(([k]) => k.startsWith(prefix))
    .map(([, v]) => v!)
    .filter(Boolean);
}

export async function upsertPrevSyncRecord(
  db: InternalDB,
  vaultId: string,
  entity: FileEntity
): Promise<void> {
  await db.prevSync.setItem(prevSyncKey(vaultId, entity.key!), entity);
}

export async function deletePrevSyncRecord(
  db: InternalDB,
  vaultId: string,
  fileKey: string
): Promise<void> {
  await db.prevSync.removeItem(prevSyncKey(vaultId, fileKey));
}

export async function clearAllPrevSyncRecords(
  db: InternalDB,
  vaultId: string
): Promise<void> {
  const prefix = `${vaultId}\t`;
  const keys = (await db.prevSync.keys()).filter((k) => k.startsWith(prefix));
  await (db.prevSync as any).removeItems(keys);
}

// ─── Sync history (for debugging) ────────────────────────────────────────────

const MAX_HISTORY_ENTRIES = 20;
const HISTORY_MAX_AGE_MS  = 1000 * 60 * 60 * 24; // 1 day

export interface SyncHistoryEntry {
  ts: number;
  vaultId: string;
  summary: string;
}

export async function insertSyncHistoryEntry(
  db: InternalDB,
  vaultId: string,
  summary: string
): Promise<void> {
  const ts = Date.now();
  await db.syncHistory.setItem(`${vaultId}\t${ts}`, {
    ts,
    vaultId,
    summary,
  } satisfies SyncHistoryEntry);
  // Pruning is best-effort — a failure here must not surface as a
  // history-write failure to the caller.
  try {
    await pruneHistory(db, vaultId);
  } catch (err) {
    console.warn("[SSS] Failed to prune sync history:", (err as Error).message);
  }
}

export async function readSyncHistory(
  db: InternalDB,
  vaultId: string
): Promise<SyncHistoryEntry[]> {
  const prefix = `${vaultId}\t`;
  const entries: SyncHistoryEntry[] = [];
  await db.syncHistory.iterate<SyncHistoryEntry, void>((val, key) => {
    if (key.startsWith(prefix)) entries.push(val);
  });
  return entries.sort((a, b) => b.ts - a.ts);
}

async function pruneHistory(db: InternalDB, vaultId: string): Promise<void> {
  const prefix = `${vaultId}\t`;
  const expiry  = Date.now() - HISTORY_MAX_AGE_MS;
  const allKeys = (await db.syncHistory.keys()).filter((k) => k.startsWith(prefix));
  const toRemove = allKeys.filter((k) => {
    const ts = parseInt(k.split("\t")[1], 10);
    return ts <= expiry;
  });

  const fresh = allKeys.filter((k) => !toRemove.includes(k));
  fresh.sort().reverse();
  if (fresh.length > MAX_HISTORY_ENTRIES) {
    toRemove.push(...fresh.slice(MAX_HISTORY_ENTRIES));
  }

  if (toRemove.length) {
    await (db.syncHistory as any).removeItems(toRemove);
  }
}

// ─── Misc KV helpers ──────────────────────────────────────────────────────────

export async function getLastSuccessSync(
  db: InternalDB,
  vaultId: string
): Promise<number | null> {
  return db.miscKV.getItem(`${vaultId}:lastSuccessSync`);
}

export async function setLastSuccessSync(
  db: InternalDB,
  vaultId: string,
  ts: number
): Promise<void> {
  await db.miscKV.setItem(`${vaultId}:lastSuccessSync`, ts);
}

export async function getLastFailedSync(
  db: InternalDB,
  vaultId: string
): Promise<number | null> {
  return db.miscKV.getItem(`${vaultId}:lastFailedSync`);
}

export async function setLastFailedSync(
  db: InternalDB,
  vaultId: string,
  ts: number
): Promise<void> {
  await db.miscKV.setItem(`${vaultId}:lastFailedSync`, ts);
}

export async function getPluginVersion(
  db: InternalDB,
  vaultId: string
): Promise<string | null> {
  return db.miscKV.getItem(`${vaultId}:pluginVersion`);
}

export async function setPluginVersion(
  db: InternalDB,
  vaultId: string,
  version: string
): Promise<void> {
  await db.miscKV.setItem(`${vaultId}:pluginVersion`, version);
}
