# Usage Guidelines & Setup Instructions

Welcome to Secure-Smart-Sync (SSS)! Because this plugin handles your data using your own private infrastructure, the initial setup takes a few minutes. Please read these guidelines carefully to ensure a smooth, zero-cost experience.

## 1. Installation

Currently, Secure-Smart-Sync is **not yet available on the official Obsidian Community Plugins store**. Until the review process is complete and it is officially listed, you will need to install the plugin manually.

**Manual Installation Steps:**
1. Go to the **Releases** page on this GitHub repository and download the latest release files (`main.js`, `manifest.json`, and `styles.css`).
2. Open your Obsidian vault's hidden configuration folder. 
   * *Tip: On most systems, this is `.obsidian` located at the root of your vault.*
3. Navigate to the `plugins` folder (i.e., `YourVault/.obsidian/plugins/`). If the `plugins` folder does not exist, create it.
4. Create a new folder inside `plugins` named exactly `Secure-Smart-Sync`.
5. Extract/move the downloaded files into this new folder.
6. Open Obsidian, go to **Settings > Community Plugins**, refresh your installed plugins, and toggle Secure-Smart-Sync to **On**.

## 2. Cloudflare R2 Setup & Prerequisites

SSS uses Cloudflare R2 as its remote storage backend. To use this plugin, you will need to set up your own Cloudflare account. 

If you haven't already, you must enable the **R2 Subscription** in your Cloudflare dashboard to unlock their highly generous free tier. To do this, Cloudflare requires you to add a valid payment method, such as an international credit/debit card (Visa, Mastercard, etc.). For a full list of supported payment methods, please check out the [Cloudflare Billing Documentation](https://developers.cloudflare.com/billing/).

> [!IMPORTANT]
> Adding a billing method is strictly an industry-standard measure by Cloudflare to prevent bot abuse and spam. **It actually costs $0.00 to set up.** You will not be charged to activate R2, and as long as you stay within the free tier, you will never pay a cent.

## 3. Will I exceed the Free Tier?

The short answer is: **Almost certainly not.** 

Secure-Smart-Sync is heavily optimized to minimize API calls. The plugin is designed to work perfectly well within the R2 free tier plan for the vast majority of users. 

To put it in perspective: the plugin can comfortably handle a setup with **up to 5 devices** syncing a decently large vault, even with highly aggressive use (e.g., actively typing and triggering syncs for 8 solid hours a day, every single day). This level of activity is well above what an average user will ever hit.

**Uncertain if your workflow fits?**
If you have an exceptionally massive vault, or if you just like seeing the math for peace of mind, please check out the [Token Usage Scenarios](./docs/Token_usage_scenarios.md) page in our repository. It provides precise calculations, edge-cases, and breakdowns of API usage against Cloudflare's limits.

## 4. Creating Your Cloudflare R2 Bucket

Once your Cloudflare account is active and the R2 subscription is enabled, you need to create the actual storage container (bucket) for your vault.

1. In the Cloudflare dashboard, navigate to **R2 > Overview** in the left sidebar.
2. Click the **Create bucket** button.
3. Choose a unique name for your bucket (e.g., `my-obsidian-vault-sync`). *Note: Bucket names must be globally unique across Cloudflare.*
4. Leave the location hint as "Automatic" for the best global performance.
5. Click **Create bucket**.

## 5. Generating API Credentials

Secure-Smart-Sync needs permission to talk to your new bucket. You will generate an API token specifically for this purpose.

1. In the Cloudflare dashboard, go back to the **R2 > Overview** page.
2. Look for the "Manage R2 API Tokens" link on the right side of the screen and click it.
3. Click **Create API token**.
4. Give your token a recognizable name (e.g., "Obsidian Sync Key").
5. Under **Permissions**, select **Object Read & Write**.
6. Under **Specify bucket(s)**, select **Apply to specific buckets only** and choose the bucket you just created.
7. Click **Create API Token**.

> [!IMPORTANT]
> The next screen will show your **Secret Access Key**. This will only be shown *once*. Do not close the window until you have copied these credentials into the plugin.

## 6. Entering Credentials in Obsidian

Open your Obsidian settings and navigate to the Secure-Smart-Sync plugin options. The plugin requires the following four pieces of information, all visible on the Cloudflare token page you just generated:

*   **Endpoint:** The URL formatted as `https://<your-account-id>.r2.cloudflarestorage.com`.
*   **Bucket Name:** The exact name of the bucket you created in Step 4.
*   **Access Key ID:** Copied from your Cloudflare API token page.
*   **Secret Access Key:** Copied from your Cloudflare API token page.

*Optional Settings:*
*   **Remote Prefix:** If you want to store your vault inside a specific folder within the bucket, enter the folder name here (e.g., `DesktopVault/`).
*   **Sync .obsidian Config Directory:** Toggle this on if you want to sync your themes, snippets, and plugin settings alongside your markdown files.

> [!NOTE]
> All of these credentials are saved locally on your device in plain text at `.obsidian/plugins/secure-smart-sync/data.json`. They are never transmitted anywhere except directly to Cloudflare.

You can click the **Test** button at the bottom of this section to verify that the plugin can successfully connect to your bucket.

## 7. Encryption (Highly Recommended)

Without a password, your files will be uploaded directly to Cloudflare. While Cloudflare is secure, to maintain true zero-knowledge privacy where *only you* can read your data, you must set an encryption password.

1. Enter a strong **Password** in the Encryption section.
2. Select an **Encryption Method**. Either `openssl-base64` (encrypts content only) or `rclone-base64` (encrypts content *and* file names) is fine. 

> [!CAUTION]
> **Do not change your encryption password or method after your first sync.** Doing so will make all existing files on the remote server unreadable to your local device. If you ever must change it, you will need to completely wipe your remote bucket and perform a full re-sync from scratch.

## 8. Device Pairing (Setting up Mobile / Other Devices)

Entering long API keys and passwords on a mobile device is frustrating. We have built an encrypted relay mechanism to make this seamless.

**On your Primary Device (Desktop):**
1. Scroll to the **Pair Devices** section in the SSS settings.
2. Click **Generate Code**. This will package your R2 credentials and encryption settings into a secure, temporary code.

**On your Secondary Device (Mobile/Laptop):**
1. Install the SSS plugin using the manual steps from Section 1.
2. Open the SSS settings and scroll to **Pair Devices**.
3. Enter the code generated by your primary device and click **Import Code**.
4. Test the connection.

*Note: Pairing codes are single-use and expire after 10 minutes. If you are setting up three devices, you must generate a fresh code on the primary device for each new setup.*

> [!IMPORTANT]
> It is absolutely critical that the **Password** and **Encryption Method** remain perfectly identical across all devices. If there is a mismatch, the devices will not be able to read each other's files, and the sync engine will likely create conflicting duplicate folders.

## 9. The First Sync

Once your credentials are in and your connection is tested, you are ready to push your files to the cloud.

**Do not use the main sync button in the ribbon for your very first run.** 

Instead, open the Obsidian Command Palette (`Ctrl/Cmd + P`) and run the command: 
**`Secure-Smart-Sync: Dry run (show what would change)`**

This will safely scan your vault and the remote bucket (which should be empty) without moving any files. Open the Obsidian Developer Console (`Ctrl/Cmd + Shift + I`) to view the exact plan the sync engine generated. 

If everything looks correct (it should plan to push all your local files to the remote), open the Command Palette again and run:
**`Secure-Smart-Sync: Sync now`**

Once this completes successfully on your primary device, you can trigger a "Sync now" on your secondary devices to pull the encrypted files down and complete the setup!

## 10. Sync Settings & Usage Notes

Once your initial setup is complete, you can customize how the sync engine handles your files. Navigate to the **Sync** section in the plugin settings to adjust these preferences.

### Sync Direction
For a standard multi-device setup, leave this set to **Bidirectional**. This ensures changes from any device are pushed to the cloud, and cloud changes are pulled down to your local vault. 

### Conflict Resolution
A "conflict" happens if you edit the exact same file on two different devices before they have a chance to sync. This setting determines which version "wins" and overwrites the other:
*   **Keep newer:** Keeps the file that was modified most recently (Recommended).
*   **Keep larger:** Keeps the file with the largest file size.
*   **Always keep local:** The device performing the sync always overrides the cloud version.
*   **Always keep remote:** The cloud version always overrides the local device.

> [!NOTE]
> More advanced conflict resolution features, such as "Always ask" and "Keep both (create a copy)", are currently in development.

### Delete Behaviour
When a file is deleted on one device, the sync engine will delete it on your other devices to keep everything matched. This setting determines where that deleted local file goes:
*   **System trash:** Moves the file to your OS Recycle Bin/Trash (Recommended).
*   **Obsidian trash (.trash):** Moves the file to the hidden `.trash` folder inside your vault.
*   **Delete permanently:** Completely wipes the file from your local disk.

### Skip Files Larger Than (MB)
You can set a maximum size limit to prevent massive files (like large videos or PDFs) from clogging up your sync or consuming your cloud storage. 
* Setting this to `0` means all files will be synced regardless of size. 
* If you set it to `5`, any single file that exceeds 5 MB will be entirely skipped by the sync engine.

### Ignore Paths
If there are specific folders, file types, or individual files you deliberately do not want to sync (e.g., a local-only scratchpad or temporary files), you can add them here. Enter one file path or glob pattern per line.

## 11. Automation

Secure-Smart-Sync is designed to stay out of your way while keeping your files safe. There are two primary ways to handle automation: **Smart Sync** (Recommended) and **Manual Configuration**. 

Regardless of which automation method you choose, you can always trigger a sync manually at any time using the ribbon icon or the Command Palette.

### Method A: Smart Sync (Recommended)
This is the default and highly recommended way to run the plugin. It is designed to be a "set-and-forget", highly reliable, long-term solution with dynamic conflict resolution baked in.

If you toggle **Smart Sync** to **On**, all manual automation options are disabled. While Smart Sync works perfectly out-of-the-box, it now exposes fine-grained timing controls so you can dictate exactly how much network activity occurs.

* **How it works:** Smart Sync watches your activity. When you stop typing, it waits a short period before silently pushing your changes to the cloud. It also automatically handles catching up when you first open the Obsidian app on any device.
* **Cross-Device Awareness:** When Device A finishes a sync, it relays a state change via the cloud. Device B (if open) actively polls for this state and will automatically pull the changes down within seconds.

**Smart Sync Timing Controls:**
* **Idle time before sync (seconds):** How long to wait after you stop typing before triggering a sync. Lower values mean faster syncs after you stop writing, while higher values mean fewer syncs during rapid editing sessions. Default: `4`.
* **Active poll interval (ms):** How frequently the plugin checks the cloud for changes from other devices while you are actively editing. Lower values provide near-instant cross-device detection, while higher values conserve Cloudflare R2 Class B (read) operations. Default: `2000`.
* **Idle poll interval (ms):** How frequently to check for cloud changes after 2 minutes of local inactivity. This is kept high by default to save network requests when you aren't actively working. Default: `30000`.
* **Post-sync re-poll delay (ms):** How long to wait before checking the state sentinel immediately after a sync completes. This allows the newly written state to settle across Cloudflare's network before the next read. Default: `500`.

### Method B: Manual Configuration
This method is for power users who need exact, granular control over when network requests are made. 

If you turn Smart Sync **Off**, you can individually configure the following triggers:
*   **Sync on App Open:** Triggers a sync 5 seconds after Obsidian launches.
*   **Auto-Sync Interval (minutes):** Forces a sync every X minutes (0 to disable).
*   **Sync on Save Debounce (seconds):** Triggers a sync X seconds after a file save is detected by the OS.
*   **Sync on Idle (seconds):** Triggers a sync X seconds after you stop typing.

> [!NOTE]
> Manual configuration does not feature the full, real-time cross-device awareness that Smart Sync provides. Unless you configure an "Auto-Sync Interval", your other devices will not automatically know if this device has synced. 

While manual configuration can provide a highly stable system if configured correctly, it requires careful tuning. For more information on exact recommended manual configurations, please refer to the `docs` folder in the repository.

## 12. Device-Specific Status Indication

Because Secure-Smart-Sync is a platform-independent plugin, and the user interface differs significantly between desktop and mobile versions of Obsidian, we designed custom status indicators tailored to each environment. 

To keep your writing experience perfectly uninterrupted, **standard pop-up toasts will only appear when you manually trigger a sync**. All automatic syncs happen silently in the background using visual colour cues instead.

> [!TIP]
> You can force the plugin to always use pop-ups by turning on **"Use toast notifications for auto-sync"** in the Automation settings. However, this is NOT recommended as it becomes very intrusive during active writing sessions.

### The Mobile Experience
On mobile, Obsidian hides the ribbon menu inside a drawer and lacks a persistent bottom status bar. To solve this, SSS adds a small, aesthetic custom icon directly to the main dashboard (sitting comfortably next to the sidebar toggle button) designed to feel completely native.

This floating indicator uses colour states to communicate:
* **Idle (Gray):** The sync engine is resting. Tapping the icon in this state will trigger a manual sync.
* **In Progress (Blue/Purple):** A sync is currently running. If you tap the icon during this state, it will expand into a small message box showing you the exact file progress.
* **Success (Green):** The sync completed successfully. Tapping it will show the success summary.
* **Error (Red):** The sync encountered an issue (e.g., network failure). Tapping it will display the specific error message so you know what went wrong.

### The Desktop (PC) Experience
On desktop, we avoid adding unnecessary UI elements by embedding these exact same colour indicators directly into the existing Obsidian interface:
* **Ribbon Icon:** The SSS logo in your left-hand ribbon will dynamically change colour (Blue for syncing, Green for success, Red for error, Orange for conflicts) without interrupting your workflow.
* **Status Bar:** The bottom-right status bar provides continuous, live text updates (e.g., "Syncing 5 / 100...") so you can always glance down to see exactly what the engine is doing.

## 13. Advanced Settings

The Advanced section provides additional controls for power users and troubleshooting.

* **Use custom pairing relay:** By default, the "Pair Devices" feature uses a free relay hosted by the plugin developer (which is open-source and end-to-end encrypted). Enable this only if you have deployed your own custom `sss-relay` instance and need to enter your own URL.
* **Log Level:** Controls how much diagnostic information the plugin writes to the Obsidian Developer Console. Options are Error only, Warn, Info (default), and Debug (verbose). Switch this to "Debug" if you are actively troubleshooting a sync issue.
* **Sync .obsidian Config Directory:** Toggle this on to include Obsidian configuration files in the sync. This allows you to synchronize your active themes, CSS snippets, and other plugin settings alongside your notes.
* **Show Status Bar:** Toggles the visibility of the live text updates (e.g., "Syncing...") in Obsidian's bottom-right status bar.

## 14. Danger Zone

* **Reset Sync History:** Clears the local database record of what was last synced. The plugin uses an internal database to track file states (like ETags and modification times) to optimize differential syncing. Clicking "Reset" wipes this memory, forcing the engine to perform a full, deep comparison of all local and remote files on the next run.

> [!WARNING]
> Resetting the sync history does not delete any of your actual markdown files or remote data. It only deletes the plugin's tracking memory. Use this feature to force a clean slate if you suspect your sync state has become confused or corrupted.

## 15. Documentation & Additional Resources

If you have any further questions or want to dive deeper into how the plugin works, you have two great resources available:

* **The Official Website (Recommended):** For the absolute best setup experience, please visit our official website at **[secure-smart-sync.pages.dev](https://secure-smart-sync.pages.dev/)**. There you will find this complete setup guide enhanced with visual animations, detailed step-by-step instructions, and plenty of other helpful resources to get the most out of Secure-Smart-Sync.
* **The Docs Folder:** For highly technical information, precise configurations, or deep dives into the plugin's architecture, please check out the `docs` directory right here in the GitHub repository. You can find answers to almost everything regarding the inner workings of the sync engine there.
