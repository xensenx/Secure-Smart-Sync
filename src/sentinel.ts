/**
 * sentinel.ts
 * Manages the state-awareness sentinel file in R2.
 *
 * The sentinel is a tiny JSON file written to R2 after every successful sync.
 * Other devices poll it on an adaptive interval to detect foreign writes and
 * trigger a reactive state_aware sync.
 *
 * Extracted from main.ts to keep sentinel logic separate from plugin lifecycle.
 */

import { StorageR2 } from "./storage-r2";
import type { PluginLogger } from "./logger";
import type { PluginSettings } from "./types";

const SENTINEL_KEY = "__sss_state__/sync.json";

// ─── Public state managed by the caller (SSSPlugin) ─────────────────────────

export interface SentinelState {
  sentinelPollTimer:       ReturnType<typeof setTimeout> | undefined;
  smartSyncPostPollTimer:  ReturnType<typeof setTimeout> | undefined;
  lastSeenSentinelAt:      number;
  _pendingStateAwareSync:  boolean;
}

// ─── writeSentinel ────────────────────────────────────────────────────────────

/**
 * Write the sentinel to R2 after a real sync so other devices detect the change.
 * Non-fatal on failure — the sync already succeeded.
 */
export async function writeSentinel(
  settings: PluginSettings,
  deviceId: string,
  vaultId: string,
  logger: PluginLogger
): Promise<void> {
  if (!settings.r2.endpoint || !settings.r2.bucketName) return;
  try {
    const payload = JSON.stringify({ deviceId, syncedAt: Date.now(), vaultId });
    const content = new TextEncoder().encode(payload).buffer as ArrayBuffer;
    const remote  = new StorageR2(settings.r2);
    const now     = Date.now();
    await remote.writeFile(SENTINEL_KEY, content, now, now);
  } catch (err) {
    logger.warn("[SSS] Failed to write state sentinel:", (err as Error).message);
  }
}

// ─── pollSentinel ─────────────────────────────────────────────────────────────

export interface PollSentinelDeps {
  settings:             PluginSettings;
  deviceId:             string;
  isSyncing:            boolean;
  state:                SentinelState;
  logger:               PluginLogger;
  triggerStateAwareSync: () => void;
}

/**
 * Read the sentinel and fire a state_aware sync if a foreign write is detected.
 */
export async function pollSentinel(deps: PollSentinelDeps): Promise<void> {
  const { settings, deviceId, isSyncing, state, logger, triggerStateAwareSync } = deps;
  if (!settings.r2.endpoint || !settings.r2.bucketName) return;
  if (isSyncing) return;

  try {
    const remote   = new StorageR2(settings.r2);
    const stat     = await remote.stat(SENTINEL_KEY);
    if (!stat || !stat.mtimeSvr) return;

    const remoteTs = stat.mtimeSvr;
    if (remoteTs <= state.lastSeenSentinelAt) return;

    const raw = await remote.readFile(SENTINEL_KEY);
    let data: { deviceId?: string; syncedAt?: number };
    try {
      data = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      logger.warn("[SSS] Sentinel has invalid JSON — ignoring this version.");
      state.lastSeenSentinelAt = remoteTs;
      return;
    }

    // Our own write — mark seen, no action.
    if (data.deviceId === deviceId) {
      state.lastSeenSentinelAt = remoteTs;
      return;
    }

    if (isSyncing) {
      state._pendingStateAwareSync = true;
      return;
    }

    state.lastSeenSentinelAt = remoteTs;
    logger.info(`[SSS] State change from device ${data.deviceId}, triggering sync`);
    triggerStateAwareSync();
  } catch (err) {
    const msg        = (err as Error).message ?? "";
    const meta       = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata;
    const statusCode = meta?.httpStatusCode as number | undefined;
    const errName    = (err as { name?: string })?.name as string | undefined;
    const isNotFound =
      statusCode === 404 ||
      msg.includes("404") ||
      msg.includes("NoSuchKey") ||
      errName === "NotFound" ||
      errName === "NoSuchKey";
    if (!isNotFound) {
      logger.warn("[SSS] Sentinel poll error:", msg);
    }
  }
}

// ─── _adaptivePollIntervalMs ──────────────────────────────────────────────────

export function adaptivePollIntervalMs(
  settings: PluginSettings,
  lastEditAt: number,
  lastForegroundAt: number
): number {
  if (!settings.smartSync) return 60_000;
  const mostRecentActivity = Math.max(lastEditAt, lastForegroundAt);
  const msSinceActivity    = Date.now() - mostRecentActivity;
  const active = settings.activePollIntervalMs ?? 2_000;
  const idle   = settings.idlePollIntervalMs   ?? 30_000;
  return msSinceActivity < 2 * 60 * 1000 ? active : idle;
}

// ─── scheduleSentinelPoll ─────────────────────────────────────────────────────

export interface SchedulePollDeps {
  settings:             PluginSettings;
  state:                SentinelState;
  /** Live getter — evaluated on every tick so the interval adapts dynamically. */
  getLastEditAt:        () => number;
  /** Live getter — evaluated on every tick so foreground burst survives _scheduleAll re-calls. */
  getLastForegroundAt:  () => number;
  doPoll:               () => Promise<void>;
}

/**
 * Start (or restart) the adaptive sentinel poll loop.
 * Uses a self-rescheduling setTimeout so the delay is re-evaluated every tick.
 */
export function scheduleSentinelPoll(deps: SchedulePollDeps): void {
  const { settings, state, getLastEditAt, getLastForegroundAt, doPoll } = deps;

  if (state.sentinelPollTimer !== undefined) {
    window.clearTimeout(state.sentinelPollTimer);
    state.sentinelPollTimer = undefined;
  }
  if (!settings.r2.endpoint || !settings.r2.bucketName) return;

  const tick = () => {
    if (state.sentinelPollTimer === undefined) return;
    void doPoll().finally(() => {
      if (state.sentinelPollTimer === undefined) return;
      // Re-read live activity timestamps on every tick — this is what makes
      // the interval truly adaptive rather than stuck at the call-time value.
      state.sentinelPollTimer = window.setTimeout(
        tick,
        adaptivePollIntervalMs(settings, getLastEditAt(), getLastForegroundAt())
      );
    });
  };

  state.sentinelPollTimer = window.setTimeout(
    tick,
    adaptivePollIntervalMs(settings, getLastEditAt(), getLastForegroundAt())
  );
}
