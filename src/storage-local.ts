/**
 * storage-local.ts
 * Obsidian vault as a local storage backend.
 */

import { TFile, TFolder, type Vault } from "obsidian";
import { StorageBase } from "./storage-base";
import type { FileEntity } from "./types";
import { mkdirpInVault, statFix, unixTimeToStr } from "./utils";
import { listObsidianConfigFiles } from "./obsidian-config-lister";
import type { PluginLogger } from "./logger";

const DEBUG_FOLDER = "_r2sync_debug/";

export class StorageLocal extends StorageBase {
  readonly kind = "local";

  private readonly vault: Vault;
  private readonly pluginId: string;
  private readonly configDir: string;
  private readonly syncConfigDir: boolean;
  private readonly deleteToWhere: "obsidian" | "system" | "permanent";
  private readonly logger?: PluginLogger;

  constructor(opts: {
    vault: Vault;
    pluginId: string;
    configDir: string;
    syncConfigDir: boolean;
    deleteToWhere: "obsidian" | "system" | "permanent";
    logger?: PluginLogger;
  }) {
    super();
    this.vault = opts.vault;
    this.pluginId = opts.pluginId;
    this.configDir = opts.configDir;
    this.syncConfigDir = opts.syncConfigDir;
    this.deleteToWhere = opts.deleteToWhere;
    this.logger = opts.logger;
  }

  // ── Listing ─────────────────────────────────────────────────────────────────

  async walk(): Promise<FileEntity[]> {
    const entities: FileEntity[] = [];

    for (const abstract of this.vault.getAllLoadedFiles()) {
      let key = abstract.path;
      if (key.startsWith("/")) key = key.slice(1);
      if (!key || key === "/") continue;
      // Skip the internal debug folder
      if (key.startsWith(DEBUG_FOLDER)) continue;

      if (abstract instanceof TFile) {
        let mtime = abstract.stat.mtime;
        if (mtime <= 0) mtime = abstract.stat.ctime;
        if (!mtime) {
          // Both mtime and ctime are 0 — seen on some platforms for brand-new
          // or empty files. Use current time so the file is not silently
          // excluded from the sync; worst case it gets re-uploaded once.
          mtime = Date.now();
          this.logger?.warn(`File has mtime=0, using current time: ${key}`);
        }
        entities.push({
          key,
          keyRaw: key,
          mtimeCli: mtime,
          mtimeSvr: mtime,
          size: abstract.stat.size,
          sizeRaw: abstract.stat.size,
        });
      } else if (abstract instanceof TFolder) {
        const folderKey = `${key}/`;
        entities.push({
          key: folderKey,
          keyRaw: folderKey,
          size: 0,
          sizeRaw: 0,
        });
      }
    }

    if (this.syncConfigDir) {
      const configFiles = await listObsidianConfigFiles(
        this.configDir,
        this.vault,
        this.pluginId
      );
      entities.push(...configFiles);
    }

    return entities;
  }

  async walkPartial(): Promise<FileEntity[]> {
    return this.walk();
  }

  // ── stat ─────────────────────────────────────────────────────────────────────

  async stat(key: string): Promise<FileEntity> {
    const s = await statFix(this.vault, key);
    if (!s) throw new Error(`stat: "${key}" not found`);
    const isFolder = s.type === "folder";
    const k = isFolder ? `${key}/` : key;
    return {
      key: k,
      keyRaw: k,
      ctimeCli: s.ctime,
      mtimeCli: s.mtime,
      mtimeSvr: s.mtime,
      size: s.size,
      sizeRaw: s.size,
    };
  }

  // ── mkdir ────────────────────────────────────────────────────────────────────

  async mkdir(key: string, _mtime?: number, _ctime?: number): Promise<FileEntity> {
    await mkdirpInVault(key, this.vault);
    return this.stat(key);
  }

  // ── writeFile ────────────────────────────────────────────────────────────────

  async writeFile(
    key: string,
    content: ArrayBuffer,
    mtime: number,
    ctime: number
  ): Promise<FileEntity> {
    // Ensure parent directories exist before writing.
    // Without this, pulling a file into a path like "a/b/c/file.md"
    // would fail if "a/b/c/" doesn't exist locally.
    await mkdirpInVault(key, this.vault);
    await this.vault.adapter.writeBinary(key, content, { mtime, ctime });
    return this.stat(key);
  }

  // ── readFile ─────────────────────────────────────────────────────────────────

  async readFile(key: string): Promise<ArrayBuffer> {
    return this.vault.adapter.readBinary(key);
  }

  // ── rename ───────────────────────────────────────────────────────────────────

  async rename(src: string, dst: string): Promise<void> {
    return this.vault.adapter.rename(src, dst);
  }

  // ── rm ───────────────────────────────────────────────────────────────────────

  async rm(key: string): Promise<void> {
    // Guard: if the file is already absent (deleted externally, race condition
    // between the sync decision and execution), treat as success rather than
    // throwing.  A file that is already gone is already in the desired state.
    const exists = await this.vault.adapter.exists(key);
    if (!exists) {
      this.logger?.debug(`[SSS] rm: "${key}" already absent, skipping`);
      return;
    }

    if (this.deleteToWhere === "permanent") {
      await this.vault.adapter.remove(key);
    } else if (this.deleteToWhere === "system") {
      const moved = await this.vault.adapter.trashSystem(key);
      if (!moved) await this.vault.adapter.trashLocal(key);
    } else {
      await this.vault.adapter.trashLocal(key);
    }
  }

  // ── connectivity ─────────────────────────────────────────────────────────────

  checkConnection(_onError?: (err: unknown) => void): Promise<boolean> {
    return Promise.resolve(true); // local vault is always available
  }

  getUserDisplayName(): Promise<string> {
    return Promise.resolve(this.vault.getName());
  }
}
