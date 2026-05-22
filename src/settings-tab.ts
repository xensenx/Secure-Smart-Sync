/**
 * settings-tab.ts
 * Obsidian settings UI for Secure-Smart-Sync (SSS).
 */

import { App, Modal, Notice, PluginSettingTab, Setting } from "obsidian";
import type SSSPlugin from "./main";
import { StorageR2 } from "./storage-r2";
import { exportCredentialBundle, importCredentialBundle } from "./credentials-transfer";
import { createPairingSlot, consumePairingSlot, checkRelayHealth } from "./pairing-relay";
import type { SyncTask } from "./sync-engine";
import { DEFAULT_RELAY_URL } from "./types";
import type { ConflictResolution, DeleteBehaviour, EncryptionMethod, PluginSettings, SyncDirection } from "./types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatSyncDate(ms: number): string {
  const d    = new Date(ms);
  const dd   = String(d.getDate()).padStart(2, "0");
  const mm   = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh   = String(d.getHours()).padStart(2, "0");
  const min  = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

function activeRelayUrl(plugin: SSSPlugin): string {
  return plugin.settings.useCustomRelay && plugin.settings.customRelayUrl
    ? plugin.settings.customRelayUrl
    : DEFAULT_RELAY_URL;
}

/** Open a URL in the system browser — works on Obsidian mobile and desktop. */
function openUrl(url: string): void {
  window.open(url, "_blank");
}

// ─── Inline SVG icons ────────────────────────────────────────────────────────

const SSS_HEADER_SVG = `<svg xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 2048 2048" width="40" height="40" aria-hidden="true">
  <g fill="currentColor">
    <path d="M955 1921.80 c-153.40 -11.80 -301.40 -63.40 -431 -150.40 -78.40 -52.60 -152.20 -121.60 -212.20 -198.40 -93.80 -120.20 -157.60 -273.40 -176.60 -425 -8.20 -64.40 -9.20 -160 -2.40 -221 11.40 -100.60 41 -203 84.80 -292 114.40 -232.20 319 -403.80 563.40 -472.80 108.80 -30.60 220.60 -40.40 335 -29 426.20 42.20 769.60 393.60 802.20 821 3.40 46.80 1.40 148.20 -4 187.80 -18.20 133.20 -54.40 238.40 -120 347 -43.40 72 -99.40 140.80 -158.20 194.60 -152.80 139.80 -341.40 222.80 -541.80 238.40 -30.20 2.20 -108.80 2.20 -139.20 -0.20z m138.40 -326.80 c180.40 -23.80 350.80 -139.60 419.60 -286 23.20 -49 35.20 -104.80 32.20 -148.60 -8.80 -124.60 -94 -237.60 -207.80 -275.40 -51.20 -17 -92.40 -19 -140.20 -6.80 -17.60 4.60 -41.20 13.40 -41.20 15.80 0 0.80 2 3 4.20 5.20 7.60 6.80 39 49.80 49.80 68.20 23.60 39.80 30 53.40 30 64 0 23.60 -5 23.20 -145 -12.80 -60.40 -15.60 -142.80 -36.60 -183 -46.60 -40.20 -10.20 -75.40 -19.60 -78.20 -21.20 -6.60 -3.20 -7.80 -6.40 -7.80 -18.80 0 -12 2.60 -15.40 30.80 -39.60 103.80 -89.80 232.60 -143.80 371.20 -156.40 34 -3 110.40 -2.40 142 1 50.60 5.60 98 15.80 139.60 29.80 11.20 3.80 20.40 6.60 20.40 6 0 -0.40 -4.60 -10 -10.20 -21 -36.40 -72.80 -100.60 -147.40 -168 -195 -91 -64.60 -186.60 -98.80 -297.80 -106.80 -59.20 -4.20 -134.20 5.80 -198 26.40 -136.40 44.20 -249 137.20 -311.80 257.80 -38.40 73.80 -54 156.20 -42.40 224.20 14.80 85.80 59 156.80 128.60 206.60 55.80 40 134 62 195.20 55.20 19.60 -2.20 47.20 -7.40 51 -9.60 0.80 -0.40 -1.60 -4.60 -5.40 -9.20 -14.60 -18 -33.80 -48.80 -47.20 -75.40 -12.60 -25 -14 -29.20 -14 -39.60 0 -6.40 1 -12.60 2.40 -14 6.20 -6.20 25.40 -2.80 137.60 25.60 61 15.40 140.20 35.20 176 44 35.80 8.80 67 17 69.60 18 3.80 1.60 4.40 3.40 4.40 14.60 0 12 -0.40 13 -7.40 19.80 -23 21.80 -73.20 56.20 -111.40 76.60 -76.80 40.60 -159.20 65.40 -242.80 73 -34.80 3.20 -125 1.60 -156.40 -2.80 -36.20 -5.20 -84.20 -16.60 -119 -28.20 -17.60 -6 -32.20 -10.60 -32.40 -10.20 -1.40 1.40 22 39.80 37.20 60.80 94.40 132.20 250.20 219.40 418.20 234.20 26.80 2.40 77.20 1 107.40 -2.80z"/>
  </g>
</svg>`;

const GITHUB_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
  <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
</svg>`;

const KOFI_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
  <path d="M23.881 8.948c-.773-4.085-4.859-4.593-4.859-4.593H.723c-.604 0-.679.798-.679.798s-.082 7.324-.022 11.822c.164 2.424 2.586 2.672 2.586 2.672s8.267-.023 11.966-.049c2.438-.426 2.683-2.566 2.658-3.734 4.352.24 7.422-2.831 6.649-6.916zm-11.062 3.511c-1.246 1.453-4.011 3.976-4.011 3.976s-.121.119-.31.023c-.076-.057-.108-.09-.108-.09-.443-.441-3.368-3.049-4.034-3.954-.709-.965-1.041-2.7-.091-3.71.951-1.01 3.005-1.086 4.363.407 0 0 1.565-1.782 3.468-.963 1.904.82 1.832 3.011.723 4.311zm6.173.478c-.928.116-1.682.028-1.682.028V7.284h1.77s1.971.551 1.971 2.638c0 1.913-.985 2.659-2.059 3.015z"/>
</svg>`;

const GLOBE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="12" cy="12" r="10"/>
  <line x1="2" y1="12" x2="22" y2="12"/>
  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
</svg>`;

const CHEVRON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="sss-chevron">
  <polyline points="9 18 15 12 9 6"/>
</svg>`;

const EXTLINK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
  <polyline points="15 3 21 3 21 9"/>
  <line x1="10" y1="14" x2="21" y2="3"/>
</svg>`;

const LOCK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
</svg>`;

// ─── Conflict Resolution Modal ───────────────────────────────────────────────

/**
 * A minimal, dark-mode-native modal that presents a conflicting file to the
 * user and collects their resolution choice.
 *
 * Design principles:
 *  - No bright warning colors — uses vault CSS variables only.
 *  - Typographic hierarchy conveys the diff; no noisy icons.
 *  - Presented sequentially for each deferred conflict after the queue drains.
 */
export class ConflictResolutionModal extends Modal {
  private readonly task: SyncTask;
  private readonly index: number;
  private readonly total: number;
  private resolve!: (value: ConflictResolution | "skip") => void;
  readonly result: Promise<ConflictResolution | "skip">;

  constructor(app: App, task: SyncTask, index: number, total: number) {
    super(app);
    this.task  = task;
    this.index = index;
    this.total = total;
    this.result = new Promise<ConflictResolution | "skip">((res) => {
      this.resolve = res;
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("sss-conflict-modal");

    // ── Header ───────────────────────────────────────────────────────────────
    const header = contentEl.createDiv({ cls: "sss-conflict-header" });
    header.createEl("span", { text: "Sync Conflict", cls: "sss-conflict-title" });
    if (this.total > 1) {
      header.createEl("span", {
        text: `${this.index + 1} of ${this.total}`,
        cls: "sss-conflict-counter",
      });
    }

    // ── File path ────────────────────────────────────────────────────────────
    contentEl.createEl("p", { text: this.task.key, cls: "sss-conflict-path" });

    // ── Diff table ───────────────────────────────────────────────────────────
    const { local, remote } = this.task.entity;
    const table = contentEl.createEl("table", { cls: "sss-conflict-table" });
    const thead = table.createEl("thead");
    const hRow  = thead.createEl("tr");
    hRow.createEl("th", { text: "" });
    hRow.createEl("th", { text: "This device" });
    hRow.createEl("th", { text: "Other device" });

    const tbody = table.createEl("tbody");
    const addRow = (label: string, lVal: string, rVal: string) => {
      const tr = tbody.createEl("tr");
      tr.createEl("td", { text: label,  cls: "sss-conflict-label" });
      tr.createEl("td", { text: lVal });
      tr.createEl("td", { text: rVal });
    };

    const fmtDate  = (ms?: number) => ms ? new Date(ms).toLocaleString() : "unknown";
    const fmtSize  = (b?: number)  => b !== undefined ? `${(b / 1024).toFixed(1)} KB` : "unknown";

    addRow("Modified",
      fmtDate(local?.mtimeCli),
      fmtDate(remote?.mtimeCli ?? remote?.mtimeSvr)
    );
    addRow("Size",
      fmtSize(local?.size),
      fmtSize(remote?.size)
    );

    // ── Action buttons ───────────────────────────────────────────────────────
    const actions = contentEl.createDiv({ cls: "sss-conflict-actions" });

    const btn = (label: string, value: ConflictResolution | "skip", cta = false) => {
      const b = actions.createEl("button", {
        text: label,
        cls: cta ? "mod-cta sss-conflict-btn" : "sss-conflict-btn",
      });
      b.addEventListener("click", () => {
        this.resolve(value);
        this.close();
      });
    };

    btn("Keep this device",  "keep_local",  true);
    btn("Keep other device", "keep_remote");
    btn("Keep both",         "keep_both");
    btn("Skip for now",      "skip");
  }

  onClose(): void {
    // If the user closes the modal without choosing (ESC, backdrop click, etc.),
    // treat as skip. Guard handles the edge case where close is called before
    // onOpen (e.g. programmatic modal.close() before modal.open()).
    this.resolve?.("skip");
    this.contentEl.empty();
  }
}


class PairingSendModal extends Modal {
  private pairingCode: string;
  private expiresInSeconds: number;
  private countdownEl?: HTMLElement;
  private intervalId?: ReturnType<typeof setInterval>;

  constructor(app: App, pairingCode: string, expiresInSeconds: number) {
    super(app);
    this.pairingCode      = pairingCode;
    this.expiresInSeconds = expiresInSeconds;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("sss-pairing-send-modal");

    contentEl.createEl("h2", { text: "Pair Another Device" });
    contentEl.createEl("p", {
      text: "Enter this code in SSS Settings → Pair Devices on the other device.",
      cls: "sss-section-desc",
    });

    const codeWrap = contentEl.createDiv({ cls: "sss-pairing-code-wrap" });
    codeWrap.createEl("span", { text: this.pairingCode, cls: "sss-pairing-code" });

    const copyBtn = codeWrap.createEl("button", { text: "Copy code", cls: "sss-pairing-copy-btn" });
    copyBtn.addEventListener("click", async () => {
      await navigator.clipboard.writeText(this.pairingCode);
      copyBtn.textContent = "Copied!";
      setTimeout(() => { copyBtn.textContent = "Copy code"; }, 2000);
    });

    this.countdownEl = contentEl.createEl("p", { cls: "sss-pairing-countdown" });
    this.updateCountdown();
    this.intervalId = setInterval(() => {
      this.expiresInSeconds--;
      if (this.expiresInSeconds <= 0) { this.close(); }
      else { this.updateCountdown(); }
    }, 1000);

    const note = contentEl.createDiv({ cls: "sss-inline-note" });
    note.createEl("strong", { text: "Keep this private. " });
    note.appendText("Only enter it on a device you own.");

    new Setting(contentEl).addButton((btn) =>
      btn.setButtonText("Done").setCta().onClick(() => this.close())
    );
  }

  private updateCountdown(): void {
    if (!this.countdownEl) return;
    const m = Math.floor(this.expiresInSeconds / 60);
    const s = String(this.expiresInSeconds % 60).padStart(2, "0");
    this.countdownEl.textContent = `Expires in ${m}:${s}`;
  }

  onClose(): void {
    if (this.intervalId !== undefined) clearInterval(this.intervalId);
    this.contentEl.empty();
  }
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────

export class SSSSettingTab extends PluginSettingTab {
  private readonly plugin: SSSPlugin;
  private connectionResultEl?: HTMLElement;
  /** Tracks whether the R2 connection block is expanded. Survives re-renders. */
  private _r2Open = false;

  constructor(app: App, plugin: SSSPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // ═══════════════════════════════════════════════════════════════════
    // HEADER
    // ═══════════════════════════════════════════════════════════════════

    const header = containerEl.createDiv({ cls: "sss-header" });

    const logoWrap = header.createDiv({ cls: "sss-header-logo" });
    logoWrap.innerHTML = SSS_HEADER_SVG;

    const headerText = header.createDiv({ cls: "sss-header-text" });
    headerText.createEl("span", { text: "Secure-Smart-Sync", cls: "sss-header-title" });

    const lastSynced = this.plugin.settings.lastSyncedAt;
    headerText.createEl("span", {
      text: lastSynced ? `Last synced ${formatSyncDate(lastSynced)}` : "Not yet synced",
      cls: "sss-header-subtitle",
    });

    // ═══════════════════════════════════════════════════════════════════
    // 1. DEVICES  — pair + R2 connection (collapsed by default)
    // ═══════════════════════════════════════════════════════════════════

    this._sectionHeading(containerEl, "Devices");

    // ── Pair: generate code ──────────────────────────────────────────
    new Setting(containerEl)
      .setName("Pair to another device")
      .setDesc("Generates a one-time 10-minute code. Enter it in SSS on the other device.")
      .addButton((btn) =>
        btn.setButtonText("Generate code").setCta().onClick(() => void (async () => {
          const { endpoint, bucketName, accessKeyId, secretAccessKey } = this.plugin.settings.r2;
          if (!endpoint || !bucketName || !accessKeyId || !secretAccessKey) {
            new Notice("Configure your R2 connection first.");
            return;
          }
          btn.setDisabled(true);
          btn.setButtonText("Generating…");
          try {
            const credJson = exportCredentialBundle(this.plugin.settings);
            const { pairingCode, expiresInSeconds } = await createPairingSlot(
              credJson, { relayUrl: activeRelayUrl(this.plugin) }
            );
            new PairingSendModal(this.app, pairingCode, expiresInSeconds).open();
          } catch (e) {
            new Notice(`Pairing failed: ${(e as Error).message}`);
          } finally {
            btn.setDisabled(false);
            btn.setButtonText("Generate code");
          }
          })()
        )
      );
    const receiveRow = containerEl.createDiv({ cls: "sss-receive-row" });

    const codeInput = receiveRow.createEl("input", {
      cls: "sss-code-input",
      placeholder: "xxxxxx-xxxxxxxx",
    } as DomElementInfo & { type?: string });
    (codeInput as HTMLInputElement).type         = "text";
    (codeInput as HTMLInputElement).maxLength    = 15;
    (codeInput as HTMLInputElement).spellcheck   = false;
    (codeInput as HTMLInputElement).autocomplete = "off";

    const importBtn = receiveRow.createEl("button", {
      text: "Import code",
      cls: "mod-cta sss-receive-btn",
    });
    const receiveStatus = containerEl.createDiv({ cls: "sss-receive-status" });

    const doImport = async () => {
      const code = (codeInput as HTMLInputElement).value.trim();
      if (!code) {
        receiveStatus.textContent = "Enter the pairing code first.";
        receiveStatus.className   = "sss-receive-status sss-receive-err";
        return;
      }
      importBtn.disabled = true;
      (importBtn as HTMLButtonElement).textContent = "Importing…";
      receiveStatus.textContent = "";
      receiveStatus.className   = "sss-receive-status";
      try {
        const credJson = await consumePairingSlot(code, { relayUrl: activeRelayUrl(this.plugin) });
        const imported = importCredentialBundle(credJson);
        // Apply the full settings overlay — v2 bundles include structural sync
        // prefs; v1 bundles only include r2 + encryption fields.
        Object.assign(this.plugin.settings, imported);
        await this.plugin.saveSettings();
        (codeInput as HTMLInputElement).value = "";
        const isFullBundle = (imported as Partial<PluginSettings>).syncDirection !== undefined;
        receiveStatus.textContent = isFullBundle
          ? "All credentials and sync preferences imported from primary device."
          : "Credentials imported. Test your connection below.";
        receiveStatus.className   = "sss-receive-status sss-receive-ok";
        this._r2Open = true;  // auto-expand so user can verify + test
        this.display();
      } catch (e) {
        receiveStatus.textContent = (e as Error).message;
        receiveStatus.className   = "sss-receive-status sss-receive-err";
      } finally {
        importBtn.disabled = false;
        (importBtn as HTMLButtonElement).textContent = "Import code";
      }
    };

    importBtn.addEventListener("click", () => void doImport());
    (codeInput as HTMLInputElement).addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") void doImport();
    });

    // ── R2 Connection: collapsible ────────────────────────────────────
    const r2Row = containerEl.createDiv({ cls: "sss-configure-row" });

    const r2Info = r2Row.createDiv({ cls: "sss-configure-label" });
    r2Info.createEl("span", { text: "Cloudflare R2 Connection", cls: "sss-configure-title" });

    const hasR2 = !!(this.plugin.settings.r2.endpoint && this.plugin.settings.r2.bucketName);
    r2Info.createEl("span", {
      text: hasR2 ? "Configured" : "Not configured",
      cls: `sss-configure-badge ${hasR2 ? "sss-badge-ok" : "sss-badge-warn"}`,
    });

    const r2Btn = r2Row.createEl("button", {
      cls: `sss-configure-btn${this._r2Open ? " is-open" : ""}`,
    });
    r2Btn.innerHTML = `${this._r2Open ? "Close" : "Configure"}${CHEVRON_SVG}`;
    r2Btn.addEventListener("click", () => {
      this._r2Open = !this._r2Open;
      this.display();
    });

    if (this._r2Open) {
      const r2Block = containerEl.createDiv({ cls: "sss-r2-block" });

      new Setting(r2Block)
        .setName("Endpoint")
        .setDesc("https://<account-id>.r2.cloudflarestorage.com")
        .addText((text) =>
          text
            .setPlaceholder("https://xxxx.r2.cloudflarestorage.com")
            .setValue(this.plugin.settings.r2.endpoint)
            .onChange(async (v) => {
              this.plugin.settings.r2.endpoint = v.trim();
              await this.plugin.saveSettings();
            })
        );

      new Setting(r2Block)
        .setName("Bucket")
        .addText((text) =>
          text
            .setPlaceholder("my-obsidian-vault")
            .setValue(this.plugin.settings.r2.bucketName)
            .onChange(async (v) => {
              this.plugin.settings.r2.bucketName = v.trim();
              await this.plugin.saveSettings();
            })
        );

      new Setting(r2Block)
        .setName("Access Key ID")
        .addText((text) =>
          text
            .setPlaceholder("R2 Access Key ID")
            .setValue(this.plugin.settings.r2.accessKeyId)
            .onChange(async (v) => {
              this.plugin.settings.r2.accessKeyId = v.trim();
              await this.plugin.saveSettings();
            })
        );

      new Setting(r2Block)
        .setName("Secret Access Key")
        .addText((text) => {
          text
            .setPlaceholder("R2 Secret Access Key")
            .setValue(this.plugin.settings.r2.secretAccessKey)
            .onChange(async (v) => {
              this.plugin.settings.r2.secretAccessKey = v.trim();
              await this.plugin.saveSettings();
            });
          text.inputEl.type = "password";
          text.inputEl.id   = "sss-secret-key";
        })
        .addButton((btn) =>
          btn.setButtonText("Show").onClick(() => {
            const input = r2Block.querySelector<HTMLInputElement>("#sss-secret-key");
            if (!input) return;
            const hidden = input.type === "password";
            input.type = hidden ? "text" : "password";
            btn.setButtonText(hidden ? "Hide" : "Show");
          })
        );

      new Setting(r2Block)
        .setName("Remote Prefix")
        .setDesc("Optional sub-folder inside the bucket, e.g. my-vault/")
        .addText((text) =>
          text
            .setPlaceholder("my-vault/")
            .setValue(this.plugin.settings.r2.remotePrefix ?? "")
            .onChange(async (v) => {
              this.plugin.settings.r2.remotePrefix = v.trim();
              await this.plugin.saveSettings();
            })
        );

      const connTestSetting = new Setting(r2Block)
        .setName("Test connection")
        .addButton((btn) =>
          btn.setButtonText("Test").onClick(() => void (async () => {
            btn.setDisabled(true);
            btn.setButtonText("Testing…");
            this._setConnectionResult("", "");
            const r2 = new StorageR2(this.plugin.settings.r2);
            let errorMsg = "";
            const ok = await r2.checkConnection(
              (err) => { errorMsg = (err as Error).message ?? String(err); }
            );
            btn.setDisabled(false);
            btn.setButtonText("Test");
            if (ok) { this._setConnectionResult("Connected successfully", "sss-conn-ok"); }
            else     { this._setConnectionResult(`Failed: ${errorMsg}`, "sss-conn-err"); }
          })())
        );

      this.connectionResultEl = connTestSetting.settingEl.createEl("div", {
        cls: "sss-conn-result",
      });
    }

    // ═══════════════════════════════════════════════════════════════════
    // 2. ENCRYPTION
    // ═══════════════════════════════════════════════════════════════════

    this._sectionHeading(containerEl, "Encryption");

    const isLocked = this.plugin.settings.encryptionLocked;

    // ── Lock / pre-lock banner ────────────────────────────────────────
    if (isLocked) {
      const lockBanner = containerEl.createDiv({ cls: "sss-enc-lock-banner" });
      const lockIcon = lockBanner.createSpan({ cls: "sss-enc-lock-icon" });
      lockIcon.innerHTML = LOCK_SVG;
      lockBanner.createEl("span", {
        text: "Encryption method is locked to prevent vault lockout. A dedicated migration workflow is required to change it.",
      });
    } else if (this.plugin.settings.encryptionPassword) {
      const preNote = containerEl.createDiv({ cls: "sss-enc-pre-note" });
      preNote.createEl("span", {
        text: "Once a sync completes successfully with this password, the method will lock automatically.",
      });
    }

    new Setting(containerEl)
      .setName("Password")
      .setDesc(
        "Files are encrypted client-side before upload. " +
        "Leave blank to disable. Changing this makes existing remote files unreadable."
      )
      .addText((text) => {
        text
          .setPlaceholder("leave blank to disable")
          .setValue(this.plugin.settings.encryptionPassword)
          .onChange(async (v) => {
            this.plugin.settings.encryptionPassword = v;
            await this.plugin.saveSettings();
          });
        text.inputEl.type = "password";
        text.inputEl.id   = "sss-enc-password";
      })
      .addButton((btn) =>
        btn.setButtonText("Show").onClick(() => {
          const input = containerEl.querySelector<HTMLInputElement>("#sss-enc-password");
          if (!input) return;
          const hidden = input.type === "password";
          input.type = hidden ? "text" : "password";
          btn.setButtonText(hidden ? "Hide" : "Show");
        })
      );

    const methodSetting = new Setting(containerEl)
      .setName("Method")
      .setDesc(
        isLocked
          ? "Locked — changing encryption method requires a migration workflow."
          : "OpenSSL encrypts file content only — folder and file names remain readable in R2. " +
            "rclone also encrypts file names for maximum privacy."
      )
      .addDropdown((dd) => {
        dd
          .addOption("openssl-base64", "OpenSSL AES-CBC (content only)")
          .addOption("rclone-base64",  "rclone Salsa20 (names + content)")
          .setValue(this.plugin.settings.encryptionMethod)
          .onChange(async (v: EncryptionMethod) => {
            this.plugin.settings.encryptionMethod = v;
            await this.plugin.saveSettings();
          });
        if (isLocked) {
          dd.selectEl.disabled = true;
          dd.selectEl.addClass("sss-select-locked");
          dd.selectEl.title = "Encryption method is locked";
        }
      });

    if (isLocked) {
      // Append a small inline lock badge to the method setting name.
      const nameEl = methodSetting.nameEl;
      const badge = nameEl.createSpan({ cls: "sss-enc-locked-badge" });
      badge.innerHTML = LOCK_SVG;
      badge.title = "Locked";
    }

    // ═══════════════════════════════════════════════════════════════════
    // 3. SYNC BEHAVIOUR
    // ═══════════════════════════════════════════════════════════════════

    this._sectionHeading(containerEl, "Sync Behaviour");

    new Setting(containerEl)
      .setName("Direction")
      .addDropdown((dd) =>
        dd
          .addOption("bidirectional", "Bidirectional")
          .addOption("push_only",     "Push only  (local → remote)")
          .addOption("pull_only",     "Pull only  (remote → local)")
          .setValue(this.plugin.settings.syncDirection)
          .onChange(async (v: SyncDirection) => {
            this.plugin.settings.syncDirection = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Conflict Resolution")
      .setDesc(
        this.plugin.settings.conflictAlwaysAsk
          ? "\u201CAlways Ask\u201D is active \u2014 the dropdown below is used as the fallback if the modal is skipped."
          : "When the same file changed on both devices. The \u2018loser\u2019 is saved as a _conflict_NN copy."
      )
      .addDropdown((dd) =>
        dd
          .addOption("keep_newer",  "Keep newer")
          .addOption("keep_larger", "Keep larger")
          .addOption("keep_local",  "Always keep local")
          .addOption("keep_remote", "Always keep remote")
          .addOption("keep_both",   "Keep both (save copy)")
          .addOption("ask",         "Always ask")
          .setValue(this.plugin.settings.conflictResolution)
          .onChange(async (v: ConflictResolution) => {
            this.plugin.settings.conflictResolution = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Always ask on conflict")
      .setDesc(
        "When on, every conflict is deferred to a prompt after the sync completes. " +
        "Other files sync uninterrupted. The dropdown above acts as the fallback resolution."
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.conflictAlwaysAsk).onChange(async (v) => {
          this.plugin.settings.conflictAlwaysAsk = v;
          await this.plugin.saveSettings();
          this.display();
        })
      );

    new Setting(containerEl)
      .setName("Delete behaviour")
      .addDropdown((dd) =>
        dd
          .addOption("trash_system", "System trash")
          .addOption("trash_local",  "Obsidian trash (.trash)")
          .addOption("permanent",    "Delete permanently")
          .setValue(this.plugin.settings.deleteBehaviour)
          .onChange(async (v: DeleteBehaviour) => {
            this.plugin.settings.deleteBehaviour = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Skip files larger than (MB)")
      .setDesc("0 = no limit.")
      .addText((text) => {
        const mb = this.plugin.settings.maxFileSizeBytes > 0
          ? String(this.plugin.settings.maxFileSizeBytes / 1024 / 1024) : "0";
        text.setPlaceholder("0").setValue(mb).onChange(async (v) => {
          const n = parseFloat(v);
          this.plugin.settings.maxFileSizeBytes = n > 0 ? Math.floor(n * 1024 * 1024) : -1;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Ignore paths")
      .setDesc("Glob patterns, one per line — e.g. *.tmp  archive/  **/node_modules/**")
      .addTextArea((area) => {
        area
          .setPlaceholder("*.tmp\narchive/")
          .setValue((this.plugin.settings.ignorePaths ?? []).join("\n"))
          .onChange(async (v) => {
            this.plugin.settings.ignorePaths = v.split("\n").map((l) => l.trim()).filter(Boolean);
            await this.plugin.saveSettings();
          });
        area.inputEl.rows = 5;
        area.inputEl.addClass("sss-ignore-paths-input");
      });

    // ═══════════════════════════════════════════════════════════════════
    // 4. AUTOMATION
    // ═══════════════════════════════════════════════════════════════════

    this._sectionHeading(containerEl, "Automation");

    const autoNote = containerEl.createDiv({ cls: "sss-inline-note sss-auto-note" });
    autoNote.createEl("strong", { text: "Non-intrusive by default. " });
    autoNote.appendText(
      "Automatic sync runs silently in the background — no pop-up toasts, no interruptions. " +
      "A small floating indicator on mobile shows sync state instead."
    );

    new Setting(containerEl)
      .setName("Show toast notifications for auto-sync")
      .setDesc("When on, all sync triggers show pop-up toasts and the floating mobile indicator is hidden.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.useToastForAutoSync).onChange(async (v) => {
          this.plugin.settings.useToastForAutoSync = v;
          await this.plugin.saveSettings();
          (this.plugin as SSSPlugin & { teardownMobileIndicator?: () => void; mountMobileIndicator?: () => void }).teardownMobileIndicator?.();
          if (!v) (this.plugin as SSSPlugin & { mountMobileIndicator?: () => void }).mountMobileIndicator?.();
        })
      );

    // Smart Sync ─────────────────────────────────────────────────────
    const smartNote = containerEl.createDiv({ cls: "sss-inline-note sss-auto-note" });
    smartNote.createEl("strong", { text: "Smart Sync — Recommended. " });
    smartNote.appendText(
      "A few seconds after you stop writing, your vault syncs silently. " +
      "Other open devices are notified within seconds. " +
      "On mobile, syncs when you reopen the app. " +
      "Enabling Smart Sync disables the manual options below."
    );

    const smartEnabled = this.plugin.settings.smartSync;

    new Setting(containerEl)
      .setName("Smart Sync")
      .setDesc(smartEnabled
        ? "On — all automation is handled automatically."
        : "Off — configure automation manually below.")
      .addToggle((toggle) =>
        toggle.setValue(smartEnabled).onChange(async (v) => {
          this.plugin.settings.smartSync = v;
          await this.plugin.saveSettings();
          this.display();
        })
      );

    if (smartEnabled) {
      new Setting(containerEl)
        .setName("Idle time before sync (seconds)")
        .setDesc("How long to wait after you stop typing before syncing. Default: 4.")
        .addText((text) =>
          text
            .setPlaceholder("4")
            .setValue(String(this.plugin.settings.smartSyncIdleSeconds ?? 4))
            .onChange(async (v) => {
              const n = parseInt(v, 10);
              this.plugin.settings.smartSyncIdleSeconds = (n > 0 && n <= 300) ? n : 4;
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName("Active poll interval (ms)")
        .setDesc("How often to check for changes while you are actively editing. Default: 2000.")
        .addText((text) =>
          text
            .setPlaceholder("2000")
            .setValue(String(this.plugin.settings.activePollIntervalMs ?? 2000))
            .onChange(async (v) => {
              const n = parseInt(v, 10);
              this.plugin.settings.activePollIntervalMs = (n >= 500 && n <= 30000) ? n : 2000;
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName("Idle poll interval (ms)")
        .setDesc("How often to check for changes after 2 min of inactivity. Default: 30000.")
        .addText((text) =>
          text
            .setPlaceholder("30000")
            .setValue(String(this.plugin.settings.idlePollIntervalMs ?? 30000))
            .onChange(async (v) => {
              const n = parseInt(v, 10);
              this.plugin.settings.idlePollIntervalMs = (n >= 5000 && n <= 300000) ? n : 30000;
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName("Post-sync re-poll delay (ms)")
        .setDesc("Delay before checking the sentinel again after a sync completes. Default: 500.")
        .addText((text) =>
          text
            .setPlaceholder("500")
            .setValue(String(this.plugin.settings.postSyncRePollMs ?? 500))
            .onChange(async (v) => {
              const n = parseInt(v, 10);
              this.plugin.settings.postSyncRePollMs = (n >= 100 && n <= 10000) ? n : 500;
              await this.plugin.saveSettings();
            })
        );
    }

    if (!smartEnabled) {
      new Setting(containerEl)
        .setName("Sync on app open")
        .setDesc("Triggers a sync a few seconds after Obsidian launches.")
        .addToggle((toggle) =>
          toggle.setValue(this.plugin.settings.syncOnOpen).onChange(async (v) => {
            this.plugin.settings.syncOnOpen = v;
            await this.plugin.saveSettings();
          })
        );

      new Setting(containerEl)
        .setName("Auto-sync interval (minutes)")
        .setDesc("0 = disabled.")
        .addText((text) => {
          const minutes = this.plugin.settings.autoSyncIntervalMs > 0
            ? String(this.plugin.settings.autoSyncIntervalMs / 60000) : "0";
          text.setPlaceholder("0").setValue(minutes).onChange(async (v) => {
            const n = parseFloat(v);
            this.plugin.settings.autoSyncIntervalMs = n > 0 ? Math.floor(n * 60000) : -1;
            await this.plugin.saveSettings();
          });
        });

      new Setting(containerEl)
        .setName("Sync on save debounce (seconds)")
        .setDesc("Sync N seconds after a file is saved. 0 = disabled. Requires reload if changed.")
        .addText((text) => {
          const secs = this.plugin.settings.syncOnSaveDebounceMs > 0
            ? String(this.plugin.settings.syncOnSaveDebounceMs / 1000) : "0";
          text.setPlaceholder("0").setValue(secs).onChange(async (v) => {
            const n = parseFloat(v);
            this.plugin.settings.syncOnSaveDebounceMs = n > 0 ? Math.floor(n * 1000) : -1;
            await this.plugin.saveSettings();
          });
        });

      new Setting(containerEl)
        .setName("Sync on idle (seconds)")
        .setDesc("Sync N seconds after you stop typing. 0 = disabled. Requires reload if changed.")
        .addText((text) => {
          const secs = this.plugin.settings.syncOnIdleMs > 0
            ? String(this.plugin.settings.syncOnIdleMs / 1000) : "0";
          text.setPlaceholder("0").setValue(secs).onChange(async (v) => {
            const n = parseFloat(v);
            this.plugin.settings.syncOnIdleMs = n > 0 ? Math.floor(n * 1000) : -1;
            await this.plugin.saveSettings();
          });
        });
    }

    // ═══════════════════════════════════════════════════════════════════
    // 5. ADVANCED
    // ═══════════════════════════════════════════════════════════════════

    this._sectionHeading(containerEl, "Advanced");

    new Setting(containerEl)
      .setName("Use custom pairing relay")
      .setDesc(
        "The default relay is free, open-source, and end-to-end encrypted. " +
        "Enable this only if you have deployed your own sss-relay Worker."
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.useCustomRelay).onChange(async (v) => {
          this.plugin.settings.useCustomRelay = v;
          await this.plugin.saveSettings();
          this.display();
        })
      );

    if (this.plugin.settings.useCustomRelay) {
      new Setting(containerEl)
        .setName("Custom Relay URL")
        .setDesc("Your self-hosted sss-relay Worker URL.")
        .addText((text) =>
          text
            .setPlaceholder("https://sss-relay.yourname.workers.dev")
            .setValue(this.plugin.settings.customRelayUrl)
            .onChange(async (v) => {
              this.plugin.settings.customRelayUrl = v.trim();
              await this.plugin.saveSettings();
            })
        )
        .addButton((btn) =>
          btn.setButtonText("Test").onClick(() => void (async () => {
            if (!this.plugin.settings.customRelayUrl) {
              new Notice("Enter a relay URL first.");
              return;
            }
            btn.setDisabled(true);
            btn.setButtonText("Testing…");
            const ok = await checkRelayHealth(this.plugin.settings.customRelayUrl);
            btn.setDisabled(false);
            btn.setButtonText("Test");
            new Notice(ok ? "Relay is reachable." : "Could not reach relay. Check the URL.");
          })())
        );
    }

    new Setting(containerEl)
      .setName("Log level")
      .addDropdown((dd) =>
        dd
          .addOption("error", "Error only")
          .addOption("warn",  "Warn")
          .addOption("info",  "Info (default)")
          .addOption("debug", "Debug (verbose)")
          .setValue(this.plugin.settings.logLevel)
          .onChange(async (v: PluginSettings["logLevel"]) => {
            this.plugin.settings.logLevel = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Sync Obsidian config directory")
      .setDesc("Include Obsidian configuration files (app.vault.configDir) in the sync.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.syncConfigDir).onChange(async (v) => {
          this.plugin.settings.syncConfigDir = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Show status bar")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showStatusBar).onChange(async (v) => {
          this.plugin.settings.showStatusBar = v;
          await this.plugin.saveSettings();
        })
      );

    // ═══════════════════════════════════════════════════════════════════
    // 6. DANGER ZONE
    // ═══════════════════════════════════════════════════════════════════

    this._sectionHeading(containerEl, "Danger Zone", "sss-danger-heading");

    new Setting(containerEl)
      .setName("Reset sync history")
      .setDesc(
        "Clears the local record of what was last synced. " +
        "The next sync will do a full comparison against remote — no data is deleted."
      )
      .addButton((btn) =>
        btn.setButtonText("Reset").setWarning().onClick(() => {
          void (this.plugin as SSSPlugin & { resetSyncHistory?: () => Promise<void> }).resetSyncHistory?.();
        })
      );

    // ═══════════════════════════════════════════════════════════════════
    // 7. RESOURCES & SUPPORT
    // ═══════════════════════════════════════════════════════════════════

    this._sectionHeading(containerEl, "Resources & Support");

    const resources = containerEl.createDiv({ cls: "sss-resources" });

    this._resourceCard(resources, {
      iconSvg:  GITHUB_SVG,
      label:    "GitHub Repository",
      desc:     "Source code, issues, and changelogs",
      href:     "https://github.com/Secure-Smart-Sync/Secure-Smart-Sync",
    });

    this._resourceCard(resources, {
      iconSvg:  GLOBE_SVG,
      label:    "Official Website",
      desc:     "Visual setup guide and full documentation",
      href:     "https://secure-smart-sync.pages.dev/",
    });

    this._resourceCard(resources, {
      iconSvg:  KOFI_SVG,
      label:    "Support on Ko-fi",
      desc:     "Like the plugin? Buy me a coffee ☕",
      href:     "https://ko-fi.com/xensenx",
      accent:   true,
    });

    this._resourceCard(resources, {
      iconSvg:  GITHUB_SVG,
      label:    "Developer — Sen",
      desc:     "Other projects and work",
      href:     "https://github.com/xensenx",
    });
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  /** Renders a labelled section divider with optional extra CSS class. */
  private _sectionHeading(container: HTMLElement, text: string, extraCls?: string): void {
    const s = new Setting(container).setName(text).setHeading();
    s.settingEl.addClass("sss-section-heading");
    if (extraCls) s.settingEl.addClass(extraCls);
  }

  /**
   * Renders a clickable resource card that opens a URL in the system browser.
   * Works on Obsidian mobile (WebView) and desktop (Electron).
   */
  private _resourceCard(
    container: HTMLElement,
    opts: { iconSvg: string; label: string; desc: string; href: string; accent?: boolean }
  ): void {
    const card = container.createEl("a", {
      cls: `sss-resource-card${opts.accent ? " sss-resource-accent" : ""}`,
    });
    // Use href so the element is keyboard-accessible and renders as a link.
    (card as HTMLAnchorElement).href   = opts.href;
    (card as HTMLAnchorElement).target = "_blank";
    (card as HTMLAnchorElement).rel    = "noopener noreferrer";

    // Override default navigation so it opens in external browser on all platforms.
    card.addEventListener("click", (e) => {
      e.preventDefault();
      openUrl(opts.href);
    });

    const left = card.createDiv({ cls: "sss-resource-left" });
    const iconEl = left.createDiv({ cls: "sss-resource-icon" });
    iconEl.innerHTML = opts.iconSvg;

    const text = left.createDiv({ cls: "sss-resource-text" });
    text.createEl("span", { text: opts.label, cls: "sss-resource-label" });
    text.createEl("span", { text: opts.desc,  cls: "sss-resource-desc"  });

    const arrow = card.createDiv({ cls: "sss-resource-arrow" });
    arrow.innerHTML = EXTLINK_SVG;
  }

  private _setConnectionResult(msg: string, cls: string): void {
    if (!this.connectionResultEl) return;
    this.connectionResultEl.textContent = msg;
    this.connectionResultEl.className   = `sss-conn-result ${cls}`.trim();
  }
}
