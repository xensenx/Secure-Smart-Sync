/**
 * credentials-transfer.ts
 * Serialise / deserialise the settings bundle used for QR-code device setup.
 *
 * Bundle v1 — legacy (R2 + encryption only).
 * Bundle v2 — full structural parity bundle:
 *   Transfers all settings that ensure 1:1 vault parity between devices,
 *   while intentionally excluding per-device performance / UX preferences.
 *
 * Excluded from relay (per-device):
 *   _deviceId, _vaultId, _acceptedSyncNotice, lastSyncedAt, encryptionLocked
 *   (receiver determines its own lock state from its own sync history),
 *   activePollIntervalMs, idlePollIntervalMs, postSyncRePollMs,
 *   autoSyncIntervalMs, initSyncDelayMs, syncOnSaveDebounceMs, syncOnIdleMs,
 *   syncOnOpen, showStatusBar, useToastForAutoSync, logLevel.
 *
 * Format: JSON → UTF-8 base64, embedded in a QR code or pasted as plain text.
 */

import type { PluginSettings } from "./types";

const BUNDLE_VERSION = 2;

// ─── v1 legacy shape ─────────────────────────────────────────────────────────

interface CredentialBundleV1 {
  v:         1;
  endpoint:  string;
  region:    string;
  bucket:    string;
  key:       string;   // accessKeyId
  secret:    string;   // secretAccessKey
  prefix:    string;   // remotePrefix
  encPass:   string;   // encryptionPassword
  encMethod: string;   // encryptionMethod
}

// ─── v2 full-parity shape ────────────────────────────────────────────────────

interface CredentialBundleV2 {
  v: 2;
  // R2
  endpoint:  string;
  region:    string;
  bucket:    string;
  key:       string;
  secret:    string;
  prefix:    string;
  // Encryption
  encPass:   string;
  encMethod: string;
  // Sync rules (structural — prevent vault fragmentation)
  syncDir:          string;
  conflictRes:      string;
  conflictAsk:      boolean;
  deleteBehaviour:  string;
  maxFileSize:      number;
  ignorePaths:      string[];
  syncConfigDir:    boolean;
  // Smart Sync strategy flag (not timing values — those are per-device)
  smartSync:             boolean;
  smartSyncIdleSecs:     number;
  // Relay
  useCustomRelay:   boolean;
  customRelayUrl:   string;
}

type CredentialBundle = CredentialBundleV1 | CredentialBundleV2;

// ─── Export ──────────────────────────────────────────────────────────────────

/**
 * Serialise the full structural settings into a compact base64 string
 * suitable for embedding in a QR code or pasting as text.
 */
export function exportCredentialBundle(settings: PluginSettings): string {
  const bundle: CredentialBundleV2 = {
    v:               BUNDLE_VERSION as 2,
    endpoint:        settings.r2.endpoint,
    region:          settings.r2.region,
    bucket:          settings.r2.bucketName,
    key:             settings.r2.accessKeyId,
    secret:          settings.r2.secretAccessKey,
    prefix:          settings.r2.remotePrefix ?? "",
    encPass:         settings.encryptionPassword,
    encMethod:       settings.encryptionMethod,
    syncDir:         settings.syncDirection,
    conflictRes:     settings.conflictResolution,
    conflictAsk:     settings.conflictAlwaysAsk,
    deleteBehaviour: settings.deleteBehaviour,
    maxFileSize:     settings.maxFileSizeBytes,
    ignorePaths:     settings.ignorePaths ?? [],
    syncConfigDir:   settings.syncConfigDir,
    smartSync:            settings.smartSync,
    smartSyncIdleSecs:    settings.smartSyncIdleSeconds ?? 4,
    useCustomRelay:  settings.useCustomRelay,
    customRelayUrl:  settings.customRelayUrl,
  };
  const json = JSON.stringify(bundle);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// ─── Import ──────────────────────────────────────────────────────────────────

/**
 * Deserialise a base64 credential bundle.
 * Returns a `Partial<PluginSettings>` to be merged into the current settings.
 *
 * v1 bundles apply only R2 + encryption fields (backward compatible).
 * v2 bundles apply the full structural settings overlay.
 *
 * Throws a descriptive Error if the bundle is malformed or an unsupported version.
 */
export function importCredentialBundle(raw: string): Partial<PluginSettings> {
  let bundle: CredentialBundle;
  try {
    const binary = atob(raw.trim());
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const json = new TextDecoder().decode(bytes);
    bundle = JSON.parse(json) as CredentialBundle;
  } catch {
    throw new Error(
      "Not a valid credential bundle. Make sure you copied the complete text without any extra characters."
    );
  }

  if (typeof bundle !== "object" || bundle === null) {
    throw new Error("Bundle is not a valid JSON object.");
  }

  if (bundle.v === 1) {
    return importV1(bundle as CredentialBundleV1);
  }
  if (bundle.v === 2) {
    return importV2(bundle as CredentialBundleV2);
  }

  throw new Error(
    `Unsupported bundle version (${(bundle as any).v}). ` +
    "Update the SSS plugin on both devices to the same version."
  );
}

// ─── v1 import (legacy) ──────────────────────────────────────────────────────

function importV1(bundle: CredentialBundleV1): Partial<PluginSettings> {
  validateV1(bundle);
  return {
    r2: {
      endpoint:             bundle.endpoint,
      region:               bundle.region  ?? "auto",
      bucketName:           bundle.bucket,
      accessKeyId:          bundle.key,
      secretAccessKey:      bundle.secret,
      remotePrefix:         bundle.prefix  ?? "",
      forcePathStyle:       true,
      partsConcurrency:     5,
      useAccurateMTime:     false,
      generateFolderObject: false,
    },
    encryptionPassword: bundle.encPass   ?? "",
    encryptionMethod:  (bundle.encMethod ?? "openssl-base64") as PluginSettings["encryptionMethod"],
  };
}

function validateV1(bundle: CredentialBundleV1): void {
  if (!bundle.endpoint || !bundle.bucket || !bundle.key || !bundle.secret) {
    throw new Error(
      "Bundle is missing required fields (endpoint, bucket, key, secret). It may be truncated or corrupted."
    );
  }
}

// ─── v2 import (full parity) ─────────────────────────────────────────────────

function importV2(bundle: CredentialBundleV2): Partial<PluginSettings> {
  validateV2(bundle);
  return {
    // R2
    r2: {
      endpoint:             bundle.endpoint,
      region:               bundle.region  ?? "auto",
      bucketName:           bundle.bucket,
      accessKeyId:          bundle.key,
      secretAccessKey:      bundle.secret,
      remotePrefix:         bundle.prefix  ?? "",
      forcePathStyle:       true,
      partsConcurrency:     5,
      useAccurateMTime:     false,
      generateFolderObject: false,
    },
    // Encryption
    encryptionPassword: bundle.encPass   ?? "",
    encryptionMethod:  (bundle.encMethod ?? "openssl-base64") as PluginSettings["encryptionMethod"],
    // Sync rules
    syncDirection:      (bundle.syncDir      ?? "bidirectional") as PluginSettings["syncDirection"],
    conflictResolution: (bundle.conflictRes  ?? "keep_newer")    as PluginSettings["conflictResolution"],
    conflictAlwaysAsk:  bundle.conflictAsk   ?? false,
    deleteBehaviour:   (bundle.deleteBehaviour ?? "trash_system") as PluginSettings["deleteBehaviour"],
    maxFileSizeBytes:   bundle.maxFileSize   ?? -1,
    ignorePaths:        Array.isArray(bundle.ignorePaths) ? bundle.ignorePaths : [],
    syncConfigDir:      bundle.syncConfigDir ?? false,
    // Smart Sync strategy (not timing — those remain per-device)
    smartSync:              bundle.smartSync          ?? false,
    smartSyncIdleSeconds:   bundle.smartSyncIdleSecs  ?? 4,
    // Relay
    useCustomRelay:  bundle.useCustomRelay ?? false,
    customRelayUrl:  bundle.customRelayUrl ?? "",
  };
}

function validateV2(bundle: CredentialBundleV2): void {
  if (!bundle.endpoint || !bundle.bucket || !bundle.key || !bundle.secret) {
    throw new Error(
      "Bundle is missing required R2 fields (endpoint, bucket, key, secret). It may be truncated or corrupted."
    );
  }
}
