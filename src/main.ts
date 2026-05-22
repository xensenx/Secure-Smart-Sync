/**
 * main.ts
 * Obsidian plugin entry point for Secure-Smart-Sync (SSS).
 *
 * This file is intentionally kept thin — it owns only:
 *   • Plugin lifecycle (onload / onunload)
 *   • Settings load / save
 *   • triggerSync() orchestration
 *   • Wiring between the focused sub-modules
 *
 * Heavy logic lives in dedicated modules:
 *   sync-runner.ts    — runSync, prevSync DB updates, conflict handler
 *   sentinel.ts       — writeSentinel, pollSentinel, adaptive scheduling
 *   auto-sync.ts      — interval, on-save, idle debounce, visibility flush
 *   ui-indicator.ts   — ribbon, status pill, mobile indicator
 *   settings-tab.ts   — Obsidian settings UI
 *   sync-engine.ts    — decision engine, task execution
 *   credentials-transfer.ts — device pairing bundles
 */

import { Notice, Platform, Plugin, addIcon } from "obsidian";

import {
  type InternalDB,
  prepareDB,
  setLastFailedSync,
  setLastSuccessSync,
  setPluginVersion,
  insertSyncHistoryEntry,
} from "./database";
import { PluginLogger } from "./logger";

// ── Sub-modules ───────────────────────────────────────────────────────────────
import { runSync, buildSummary, resetSyncHistory } from "./sync-runner";
import {
  writeSentinel,
  pollSentinel,
  scheduleSentinelPoll,
  type SentinelState,
} from "./sentinel";
import {
  scheduleAutoSync,
  clearAutoSync,
  buildOnSaveHandler,
  buildIdleDebounce,
  runSmartSyncOnOpen,
  registerVisibilityFlush,
  type AutoSyncHandle,
  type IdleDebounce,
} from "./auto-sync";
import {
  setRibbonStatus,
  setStatusText,
  showStatusPill,
  dismissStatusPill,
  mountMobileIndicator,
  updateMobileIndicator,
  expandMobilePill,
  collapseMobilePill,
  teardownMobileIndicator,
  refreshMobileIndicatorVisibility,
  type RibbonState,
  type MobileState,
} from "./ui-indicator";

import { decodeSettings, encodeSettings } from "./settings-persist";
import { SSSSettingTab } from "./settings-tab";
import {
  DEFAULT_SETTINGS,
  type PluginSettings,
  type SyncStats,
  type SyncTrigger,
} from "./types";
import { toText } from "./utils";

// ─── Constants ────────────────────────────────────────────────────────────────

const SYNC_ICON_ID = "sss-sync-icon";

// SSS logo — normalised to the 0–100 coordinate space Obsidian's addIcon() expects.
const SSS_LOGO_SVG = `<path fill="currentColor" d="
M46.63 93.84 c-7.49 -0.58 -14.72 -3.10 -21.04 -7.34 c-3.83 -2.57 -7.43 -5.94 -10.36 -9.69
c-4.58 -5.87 -7.70 -13.35 -8.63 -20.75 c-0.40 -3.15 -0.45 -7.81 -0.12 -10.79
c0.56 -4.91 2.00 -9.91 4.14 -14.26 c5.59 -11.34 15.58 -19.72 27.51 -23.10
c5.31 -1.49 10.77 -1.97 16.36 -1.42 c20.81 2.06 37.58 19.22 39.17 40.09
c0.17 2.29 0.07 7.24 -0.20 9.17 c-0.89 6.50 -2.66 11.64 -5.86 16.94
c-2.12 3.52 -4.85 6.88 -7.73 9.50 c-7.46 6.83 -16.67 10.88 -26.46 11.64
c-1.48 0.11 -5.31 0.11 -6.80 -0.01z
m6.76 -15.96 c8.81 -1.16 17.13 -6.82 20.49 -13.97 c1.13 -2.39 1.72 -5.12 1.57 -7.26
c-0.43 -6.08 -4.59 -11.60 -10.15 -13.45 c-2.50 -0.83 -4.51 -0.93 -6.85 -0.33
c-0.86 0.22 -2.01 0.65 -2.01 0.77 c0 0.04 0.10 0.15 0.21 0.25
c0.37 0.33 1.90 2.43 2.43 3.33 c1.15 1.95 1.46 2.61 1.46 3.13
c0 1.15 -0.24 1.13 -7.08 -0.63 c-2.95 -0.76 -6.97 -1.79 -8.94 -2.28
c-1.96 -0.50 -3.68 -0.96 -3.82 -1.04 c-0.32 -0.16 -0.38 -0.31 -0.38 -0.92
c0 -0.59 0.13 -0.75 1.50 -1.93 c5.07 -4.39 11.36 -7.02 18.13 -7.64
c1.66 -0.15 5.39 -0.12 6.94 0.05 c2.47 0.27 4.79 0.77 6.82 1.46
c0.55 0.19 1.00 0.32 1.00 0.29 c0 -0.02 -0.22 -0.49 -0.50 -1.02
c-1.78 -3.56 -4.91 -7.20 -8.20 -9.52 c-4.44 -3.15 -9.11 -4.82 -14.54 -5.21
c-2.89 -0.21 -6.55 0.28 -9.67 1.29 c-6.66 2.16 -12.16 6.70 -15.23 12.59
c-1.88 3.60 -2.64 7.63 -2.07 10.95 c0.72 4.19 2.88 7.66 6.28 10.09
c2.73 1.95 6.54 3.03 9.53 2.70 c0.96 -0.11 2.31 -0.36 2.49 -0.47
c0.04 -0.02 -0.08 -0.22 -0.26 -0.45 c-0.71 -0.88 -1.65 -2.38 -2.31 -3.68
c-0.62 -1.22 -0.68 -1.43 -0.68 -1.93 c0 -0.31 0.05 -0.62 0.12 -0.68
c0.30 -0.30 1.24 -0.14 6.72 1.25 c2.98 0.75 6.85 1.72 8.59 2.15
c1.75 0.43 3.27 0.83 3.40 0.88 c0.19 0.08 0.21 0.17 0.21 0.71
c0 0.59 -0.02 0.63 -0.36 0.97 c-1.12 1.06 -3.58 2.74 -5.44 3.74
c-3.75 1.98 -7.77 3.20 -11.86 3.57 c-1.70 0.16 -6.10 0.08 -7.64 -0.14
c-1.77 -0.25 -4.11 -0.81 -5.81 -1.38 c-0.86 -0.29 -1.57 -0.52 -1.58 -0.50
c-0.07 0.07 1.07 1.94 1.82 2.97 c4.61 6.46 12.22 10.72 20.42 11.44
c1.31 0.12 3.77 0.05 5.25 -0.14z
"/>`;

// ─── Plugin class ─────────────────────────────────────────────────────────────

export default class SSSPlugin extends Plugin {
  // ── Status bar icons ───────────────────────────────────────────────────
  private static readonly STATUS_ICONS: Record<"idle" | "syncing" | "error", string> = {
    idle:    `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>`,
    syncing: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="sss-spin"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`,
    error:   `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  };

  // ── Public settings (accessed by settings-tab) ─────────────────────────
  settings!: PluginSettings;

  // ── Internal DB + identity ─────────────────────────────────────────────
  private db!: InternalDB;
  private vaultId!: string;
  private logger!: PluginLogger;

  // ── UI indicator state ─────────────────────────────────────────────────
  private ribbonState: RibbonState = {
    lastStatusText: "",
    syncProgress:   { done: 0, total: 0 },
  };
  private mobileState: MobileState = {
    mobilePillExpanded: false,
  };

  // ── Sync state ─────────────────────────────────────────────────────────
  private isSyncing = false;

  // ── Auto-sync scheduling ───────────────────────────────────────────────
  private autoSyncHandle: AutoSyncHandle = { timer: undefined };
  private idleDebounce?: IdleDebounce;

  // ── Sentinel state ─────────────────────────────────────────────────────
  private sentinelState: SentinelState = {
    sentinelPollTimer:      undefined,
    smartSyncPostPollTimer: undefined,
    lastSeenSentinelAt:     0,
    _pendingStateAwareSync: false,
  };

  // ── Per-device activity tracking (for adaptive poll interval) ──────────
  private _lastEditAt       = 0;
  private _lastForegroundAt = 0;

  // ── Visibility flush cleanup ───────────────────────────────────────────
  private _visibilityHandler?: () => void;

  // ─────────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────────

  async onload(): Promise<void> {
    this.logger = new PluginLogger("[SSS]");

    await this.loadSettings();
    this.logger.setLevel(this.settings.logLevel);

    // Stable per-device ID — stored but never synced.
    if (!this.settings._deviceId) {
      this.settings._deviceId =
        Math.random().toString(36).slice(2, 10) +
        Math.random().toString(36).slice(2, 10);
      await this.saveSettings();
    }

    const { db, vaultId } = await prepareDB(
      this.app.vault.adapter.getBasePath?.() ?? this.app.vault.getName(),
      this.settings._vaultId
    );
    this.db      = db;
    this.vaultId = vaultId;

    await setPluginVersion(db, vaultId, this.manifest.version);
    addIcon(SYNC_ICON_ID, SSS_LOGO_SVG);

    // ── Status bar ──────────────────────────────────────────────────────
    if (this.settings.showStatusBar) {
      this.ribbonState.statusBarEl = this.addStatusBarItem();
      this._setStatusIcon("idle");
    }

    // ── Commands ────────────────────────────────────────────────────────
    this.addCommand({ id: "sss-sync-now",          name: "Sync now",                                callback: () => this.triggerSync("manual") });
    this.addCommand({ id: "sss-sync-dry-run",      name: "Dry run (show what would change)",        callback: () => this.triggerSync("dry_run") });
    this.addCommand({ id: "sss-reset-sync-history",name: "Reset sync history (forces full re-sync)",callback: () => resetSyncHistory(this.db, this.vaultId) });

    // ── Ribbon ──────────────────────────────────────────────────────────
    this.ribbonState.ribbonEl = this.addRibbonIcon(
      SYNC_ICON_ID, "Secure-Smart-Sync", () => this._handleRibbonClick()
    );

    // ── Mobile indicator ────────────────────────────────────────────────
    if (Platform.isMobile && !this.settings.useToastForAutoSync) {
      mountMobileIndicator(
        this.mobileState,
        this.app,
        () => this._handleMobileIndicatorClick(),
        () => refreshMobileIndicatorVisibility(this.mobileState, this.app)
      );
      // layout-change fires when the sidebar opens/closes on mobile.
      // Register via Obsidian's event system so it is automatically
      // cleaned up when the plugin is unloaded.
      this.registerEvent(
        (this.app.workspace as any).on("layout-change", () => {
          refreshMobileIndicatorVisibility(this.mobileState, this.app);
          // 50 ms re-check: by then the CSS transition has started and the
          // bounding rect reliably reflects the drawer's direction of travel.
          window.setTimeout(
            () => refreshMobileIndicatorVisibility(this.mobileState, this.app),
            50
          );
        })
      );
    }

    this.addSettingTab(new SSSSettingTab(this.app, this));

    // ── Scheduling ──────────────────────────────────────────────────────
    this._scheduleAll();

    if (Platform.isMobile) this._lastForegroundAt = Date.now();

    this._registerEditorChangeHandler();

    if (this.settings.smartSync) {
      runSmartSyncOnOpen(
        this.settings,
        () => this.isSyncing,
        () => void this._doPoll(),
        () => void this.triggerSync("init")
      );
    } else if (this.settings.syncOnOpen) {
      window.setTimeout(() => this.triggerSync("init"), 5000);
    }

    this._registerVisibilityFlush();
    this._registerOnSave();

    this.logger.info(`Plugin loaded. Vault ID: ${vaultId}`);
  }

  onunload(): void {
    clearAutoSync(this.autoSyncHandle);
    if (this.sentinelState.sentinelPollTimer !== undefined)
      window.clearTimeout(this.sentinelState.sentinelPollTimer);
    if (this.sentinelState.smartSyncPostPollTimer !== undefined)
      window.clearTimeout(this.sentinelState.smartSyncPostPollTimer);
    this.idleDebounce?.cancel();
    dismissStatusPill(this.ribbonState);
    teardownMobileIndicator(this.mobileState);
    if (this.ribbonState.ribbonSuccessTimer !== undefined)
      window.clearTimeout(this.ribbonState.ribbonSuccessTimer);
    if (this._visibilityHandler)
      document.removeEventListener("visibilitychange", this._visibilityHandler);
    this.logger.info("Plugin unloaded.");
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Settings
  // ─────────────────────────────────────────────────────────────────────────────

  async loadSettings(): Promise<void> {
    const raw     = await this.loadData();
    const decoded = decodeSettings(raw);
    this.settings = Object.assign({}, DEFAULT_SETTINGS, decoded ?? {});
  }

  async saveSettings(): Promise<void> {
    await this.saveData(encodeSettings(this.settings));
    this.logger.setLevel(this.settings.logLevel);
    this._scheduleAll();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Sync orchestration
  // ─────────────────────────────────────────────────────────────────────────────

  async triggerSync(trigger: SyncTrigger): Promise<void> {
    if (this.isSyncing) {
      if (trigger === "manual") {
        new Notice("Secure-Smart-Sync: already syncing, please wait\u2026");
      }
      return;
    }

    const isDry     = trigger === "dry_run";
    const isManual  = trigger === "manual" || trigger === "dry_run";
    const useToasts = isManual || this.settings.useToastForAutoSync;

    this.isSyncing = true;
    this.ribbonState.syncProgress = { done: 0, total: 0 };
    setRibbonStatus(this.ribbonState, "syncing");
    updateMobileIndicator(this.mobileState, "syncing");
    this._setStatusIcon("syncing");

    if (useToasts) {
      new Notice(`Secure-Smart-Sync: ${isDry ? "dry run" : "syncing"}\u2026`);
    }

    let stats: SyncStats;
    try {
      stats = await runSync(isDry, {
        app:        this.app,
        db:         this.db,
        vaultId:    this.vaultId,
        settings:   this.settings,
        logger:     this.logger,
        onProgress: (done, total) => {
          this.ribbonState.syncProgress = { done, total };
          setStatusText(this.ribbonState, `Syncing ${done}/${total}\u2026`);
          if (this.ribbonState.statusPillEl) {
            this.ribbonState.statusPillEl.textContent = `Syncing ${done} / ${total}`;
          }
        },
      });

      const summary = buildSummary(stats);
      const hasErr  = stats.errors.length > 0;
      const hasCon  = stats.conflictsResolved > 0;

      this.ribbonState.lastStatusText = summary;
      this._setStatusIcon("idle");

      if (hasErr) {
        setRibbonStatus(this.ribbonState, "error");
        updateMobileIndicator(this.mobileState, "error");
        new Notice(`Secure-Smart-Sync: ${summary}`, 8000);
      } else if (hasCon) {
        setRibbonStatus(this.ribbonState, "conflict");
        updateMobileIndicator(this.mobileState, "conflict");
        if (useToasts) new Notice(`Secure-Smart-Sync: ${summary}`);
      } else {
        setRibbonStatus(this.ribbonState, "success");
        updateMobileIndicator(this.mobileState, "success");
        if (useToasts) new Notice(`Secure-Smart-Sync: ${summary}`);
      }

      if (!isDry) {
        const now = Date.now();
        await setLastSuccessSync(this.db, this.vaultId, now);
        this.settings.lastSyncedAt = now;

        // ── Encryption ratchet lock ───────────────────────────────────────
        if (
          !this.settings.encryptionLocked &&
          this.settings.encryptionPassword !== "" &&
          stats.errors.length === 0 &&
          stats.filesUploaded > 0
        ) {
          this.settings.encryptionLocked = true;
          this.logger.info("[SSS] Encryption method locked after first confirmed encrypted write.");
        }

        await this.saveSettings();
        await insertSyncHistoryEntry(this.db, this.vaultId, JSON.stringify(stats));

        const remoteWasModified = stats.filesUploaded > 0 || stats.conflictsResolved > 0;
        if (trigger !== "state_aware" && remoteWasModified) {
          await writeSentinel(
            this.settings,
            this.settings._deviceId!,
            this.vaultId,
            this.logger
          );
          if (this.settings.smartSync) {
            if (this.sentinelState.smartSyncPostPollTimer !== undefined)
              window.clearTimeout(this.sentinelState.smartSyncPostPollTimer);
            this.sentinelState.smartSyncPostPollTimer = window.setTimeout(() => {
              this.sentinelState.smartSyncPostPollTimer = undefined;
              void this._doPoll();
            }, this.settings.postSyncRePollMs ?? 500);
          }
        }
      }
    } catch (err) {
      const msg = (err as Error).message;
      this.logger.error("Sync failed:", toText(err));
      this.ribbonState.lastStatusText = msg;
      setRibbonStatus(this.ribbonState, "error");
      updateMobileIndicator(this.mobileState, "error");
      this._setStatusIcon("error");
      new Notice(`Secure-Smart-Sync: failed \u2013 ${msg}`);
      await setLastFailedSync(this.db, this.vaultId, Date.now());
    } finally {
      this.isSyncing = false;
      if (this.sentinelState._pendingStateAwareSync) {
        this.sentinelState._pendingStateAwareSync = false;
        window.setTimeout(() => void this.triggerSync("state_aware"), 0);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────────

  /** Update status bar icon (separate from ribbon badge). */
  private _setStatusIcon(state: "idle" | "syncing" | "error"): void {
    if (!this.ribbonState.statusBarEl) return;
    this.ribbonState.statusBarEl.innerHTML =
      `<span class="sss-status-icon">${SSSPlugin.STATUS_ICONS[state]}</span>SSS`;
  }

  /** Restart all scheduling from current settings. Called on load and saveSettings. */
  private _scheduleAll(): void {
    scheduleAutoSync(this.autoSyncHandle, this.settings, () => void this.triggerSync("auto"), this.logger);
    scheduleSentinelPoll({
      settings:            this.settings,
      state:               this.sentinelState,
      getLastEditAt:       () => this._lastEditAt,
      getLastForegroundAt: () => this._lastForegroundAt,
      doPoll:              () => this._doPoll(),
    });
    // Rebuild idle debounce with updated delay.
    this.idleDebounce?.cancel();
    this.idleDebounce = buildIdleDebounce(this.settings, () => void this.triggerSync("on_idle"));
  }

  /** Thin wrapper so sentinel.ts stays free of SSSPlugin references. */
  private async _doPoll(): Promise<void> {
    await pollSentinel({
      settings:              this.settings,
      deviceId:              this.settings._deviceId!,
      isSyncing:             this.isSyncing,
      state:                 this.sentinelState,
      logger:                this.logger,
      triggerStateAwareSync: () => void this.triggerSync("state_aware"),
    });
  }

  /** Shared editor-change registration for idle debounce + activity tracking. */
  private _registerEditorChangeHandler(): void {
    this.registerEvent(
      (this.app.workspace as any).on("editor-change", () => {
        this._lastEditAt = Date.now();
        this.idleDebounce?.();
      })
    );
  }

  /** Register on-save handler if configured. */
  private _registerOnSave(): void {
    const handlers = buildOnSaveHandler(this.settings, () => void this.triggerSync("on_save"));
    if (!handlers) return;
    this.registerEvent(
      this.app.vault.on("modify", handlers.onModify)
    );
    if (Platform.isMobile) {
      this.registerEvent(
        (this.app.workspace as any).on("editor-change", handlers.onEditorChange)
      );
    }
  }

  /** Register visibility change handler and store cleanup ref. */
  private _registerVisibilityFlush(): void {
    this._visibilityHandler = registerVisibilityFlush(
      this.settings,
      () => this.isSyncing,
      () => this.idleDebounce?.flush(),
      // pause poll
      () => {
        if (this.sentinelState.sentinelPollTimer !== undefined) {
          window.clearTimeout(this.sentinelState.sentinelPollTimer);
          this.sentinelState.sentinelPollTimer = undefined;
        }
      },
      // resume poll — getters are closures over `this`, so they read live values
      () => scheduleSentinelPoll({
        settings:            this.settings,
        state:               this.sentinelState,
        getLastEditAt:       () => this._lastEditAt,
        getLastForegroundAt: () => this._lastForegroundAt,
        doPoll:              () => this._doPoll(),
      }),
      () => void this._doPoll(),
      (t) => { this._lastForegroundAt = t; }
    );
  }

  /** Ribbon click: show status pill if busy, else trigger manual sync. */
  private _handleRibbonClick(): void {
    if (this.isSyncing) {
      showStatusPill(this.ribbonState, true);
      return;
    }
    const cls = this.ribbonState.ribbonEl?.className ?? "";
    if (cls.includes("sss-ribbon-error") || cls.includes("sss-ribbon-conflict")) {
      showStatusPill(this.ribbonState, false);
      return;
    }
    this.triggerSync("manual");
  }

  /** Mobile indicator tap: sync if idle, else toggle pill. */
  private _handleMobileIndicatorClick(): void {
    const cls    = this.mobileState.mobileIndicatorEl?.className ?? "";
    const isIdle = cls.includes("sss-mob-idle");

    if (isIdle) {
      this.triggerSync("manual");
      return;
    }

    if (this.mobileState.mobilePillExpanded) {
      collapseMobilePill(this.mobileState);
    } else {
      expandMobilePill(
        this.mobileState,
        this.isSyncing,
        this.ribbonState.lastStatusText,
        this.ribbonState.syncProgress
      );
    }
  }
}
