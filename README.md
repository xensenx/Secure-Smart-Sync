<div align="center">

<picture>
  <source
    media="(prefers-color-scheme: light)"
    srcset="https://cdn.jsdelivr.net/gh/Secure-Smart-Sync/Secure-Smart-Sync-assets/Icons/SVG/icon_black_transparent.svg">

  <source
    media="(prefers-color-scheme: dark)"
    srcset="https://cdn.jsdelivr.net/gh/Secure-Smart-Sync/Secure-Smart-Sync-assets/Icons/SVG/icon_white_transparent.svg">

  <img
    src="https://cdn.jsdelivr.net/gh/Secure-Smart-Sync/Secure-Smart-Sync-assets/Icons/SVG/icon_white_transparent.svg"
    width="150"
    alt="Secure Smart Sync">
</picture>

</div>

<div align="center">
  <h1>Secure Smart Sync</h1>
</div>

**Not affiliated with [Obsidian Sync](https://obsidian.md/sync).** SSS runs entirely on your own Cloudflare R2 bucket. You own the storage, the keys, and the data.

**Smart Move :** Secure-Smart-Sync has been tested across multiple devices and typical workflows. As with any sync system, edge cases can occur in complex scenarios — offline conflicts, unusual file structures, or interrupted syncs. **Keeping a local backup of your vault is always a smart habit.**

## Overview

<p align="center">
  <img
    src="https://cdn.jsdelivr.net/gh/Secure-Smart-Sync/Secure-Smart-Sync-assets/Banners/sss_banner_adjusted_Color.png"
    alt="Secure Smart Sync Banner"
    width="100%">
</p>

## Features in breif:

1. Private Cloud Storage: Syncs notes across all devices via your personal storage, keeping third parties out.
2. Total Privacy: Locks your files with a password before they leave your device, making them completely unreadable to outsiders.
3. Smart Automation: Quietly saves your work in the background a few seconds after you stop typing or open the app.
4. Quick Device Linking: Connects new phones or computers instantly using a short, temporary pairing code.
5. Conflict Protection: Safely preserves both versions if you edit the exact same note on two devices simultaneously.
6. Distraction-Free: Runs silently using a tiny visual indicator instead of annoying pop-up alerts.
7. Settings Backup: Syncs your custom themes, layouts, and plugins alongside your regular writing.
8. Selective Syncing: Lets you easily ignore specific folders or skip massive files to save storage space.
9. Safe Deletion: Sends deleted notes directly to your system trash so you can easily recover accidental mistakes.
+more 

## Getting Started

Note : Read the **[Usage Guidelines](./Usage_Guidelines.md)** for a complete and comprehensive setup guide, including:

* **Installation** & **Setup**
* **Settings-Configuration**
* **Critical Security Information**

<p align="left">
  <img
    src="https://cdn.jsdelivr.net/gh/Secure-Smart-Sync/Secure-Smart-Sync-assets/Banners/Site_QR.svg"
    alt="Secure Smart Sync Banner"
    width="240">
</p>

**Prefer a visual guide?** Visit our **[official site Secure Smart Sync](https://secure-smart-sync.pages.dev)** or **Scan the QR code from your phone** to get started in 5-minute walkthrough along with comprehensive documentations and token calculations.

### Quick-Start 

Before you start! 

> [!NOTE]
> It is highly recommended you either refer to the [Usage Guidelines](./Usage_Guidelines.md) or visit our [official site Secure Smart Sync](https://pages.dev) for proper one-time setup. This Quick-start covers only the bare-bones setup version and excludes technical caveats and details, especially for beginners.

**Prequisites**

1. Cloudflare account + billing method for activating R2 Subscription.(Free)

**NOTE:** Adding a billing method is strictly an industry-standard measure by Cloudflare to prevent bot abuse and spam. **It actually costs $0.00 to set up.** You will not be charged to activate R2, You'll only be charged if you exceed free tier, which majority of users will never hit. Read more about [R2_free_tier](https://developers.cloudflare.com/r2/pricing/#:~:text=for%202%20GB.-,Free%20tier,Free,-1)

**Set-up**

1. In the Cloudflare dashboard, navigate to **R2 > Overview** in the left sidebar.
2. Click the **Create bucket** button.
3. Choose a unique name for your bucket (e.g., `my-obsidian-vault-sync`). *Note: Bucket names must be globally unique across Cloudflare.*
4. Leave the location hint as "Automatic" for the best global performance.
5. Click **Create bucket**.

**Generating API Credentials**

Secure-Smart-Sync needs permission to talk to your new bucket. You will generate an API token specifically for this purpose.

1. In the Cloudflare dashboard, go back to the **R2 > Overview** page.
2. Look for the "Manage R2 API Tokens" link on the right side of the screen and click it.
3. Click **Create API token**.
4. Give your token a recognizable name (e.g., "Obsidian Sync Key").
5. Under **Permissions**, select **Object Read & Write**.
6. Under **Specify bucket(s)**, select **Apply to specific buckets only** and choose the bucket you just created.
7. Click **Create API Token**.

**NOTE:** The next screen will show your **Secret Access Key**. This will only be shown *once*. Do not close the window until you have copied these credentials into the plugin.

**Entering Credentials in Obsidian**

Open your Obsidian settings and navigate to the Secure-Smart-Sync plugin options. The plugin requires the following four pieces of information, all visible on the Cloudflare token page you just generated:

*   **Endpoint:** The URL formatted as `https://<your-account-id>.r2.cloudflarestorage.com`.
*   **Bucket Name:** The exact name of the bucket you created in Step 4.
*   **Access Key ID:** Copied from your Cloudflare API token page.
*   **Secret Access Key:** Copied from your Cloudflare API token page.

**NOTE:** All of these credentials are saved locally on your device in plain text at `.obsidian/plugins/secure-smart-sync/data.json`. They are never transmitted anywhere except directly to Cloudflare.

You can click the **Test** button at the bottom of this section to verify that the plugin can successfully connect to your bucket.

**Encryption (Highly Recommended)**

Without a password, your files will be uploaded directly to Cloudflare. While Cloudflare is secure, to maintain true zero-knowledge privacy where *only you* can read your data, you must set an encryption password.

**Device Pairing**

Entering long API keys and passwords on a mobile device is frustrating. We have built an **encrypted relay mechanism** to make this seamless.
1. Scroll to the **Pair Devices** section in the SSS settings.
2. Click **Generate Code**. This will package your R2 credentials and encryption settings into a secure, temporary code.

<p align="center">
  <img
    src="https://cdn.jsdelivr.net/gh/Secure-Smart-Sync/Secure-Smart-Sync-assets/Banners/Pairing_code.png"
    alt="Pairing Code"
    width="75%">
</p>

**On your Secondary Device (Mobile/Laptop):**

1. Install the SSS plugin using the manual steps from Section 1.
2. Open the SSS settings and scroll to **Pair Devices**.
3. Enter the code generated by your primary device and click **Import Code**.
4. Test the connection.

*Note: Pairing codes are single-use and expire after 10 minutes. If you are setting up three devices, you must generate a fresh code on the primary device for each new setup.*


## Architecture

<br>

<table width="100%">
<tr>
<td width="50%" valign="top" align="left" style="padding: 20px;">

<h3>Zero-Knowledge Encryption</h3>

Every file is encrypted on your device before it is uploaded.

Choose between:
- AES-256-CBC (OpenSSL)
- Salsa20 + Poly1305 (rclone-compatible)

Your password never leaves your device — storage providers only see ciphertext.

</td>

<td width="50%" valign="top" align="left" style="padding: 20px;">

<h3>Three-Way Diff Engine</h3>

Compares:

- Local state  
- Remote state  
- Last sync snapshot  

ETags prevent unnecessary uploads.  
Conflicts follow your rules and are backed up automatically.

</td>
</tr>

<tr>
<td width="50%" valign="top" align="left" style="padding: 20px;">

<h3>Smart Sync</h3>

A few seconds after you stop typing:

- Device A syncs silently  
- Signals Device B  
- Device B pulls changes automatically  

No manual triggering.  
No intrusive popups.

</td>

<td width="50%" valign="top" align="left" style="padding: 20px;">

<h3>Instant Device Pairing</h3>

Generate a short pairing code on one device.

Enter it on another device to securely transfer:

- R2 credentials  
- Encryption configuration  

Transferred through AES-GCM encrypted relay.  
Self-destructs after 10 minutes.

</td>
</tr>
</table>

<br>


## Resources

| | |
|---|---|
| [Official Website](https://secure-smart-sync.pages.dev/) | Visual set-up and beginner's guide and Documentations |
| [Token calculator](https://secure-smart-sync.pages.dev/token-calculator) | Calculate your R2 Monthly usage |
| [Usage Guidelines](./Usage_Guidelines.md) | Initial setup, configuration reference, and day-to-day usage |
| [Core Architecture](./docs/Core_architecture.md) | Architectural outline | 
| [Core philosophy](./docs/Core_philosophy.md) | Guiding principles of the project | 
| [Troubleshooting](./docs/TROUBLESHOOTING.md) | Common errors and troubleshooting guide | 
| [Security](./SECURITY.md) | Cryptographic methods, architecture, and threat model |
| [R2 Usage & Limits](./docs/token_usage_scenarios.md) | Free-tier op analysis across vault sizes and device counts |
| [Contributing](./CONTRIBUTING.md) | Bug reports, pull requests, and documentation |
| [About](./docs/About.md) | About Secure Smart Sync | 



## Security

SSS ships with no analytics, telemetry, or tracking. Encryption keys are generated and stored locally and are never transmitted. The ephemeral pairing relay is open-source, uses AES-GCM end-to-end encryption, and stores nothing after the payload is consumed.

Full cryptographic detail is in [SECURITY.md](./SECURITY.md).

The relay source is at [Secure-Smart-Sync-relay](https://github.com/Secure-Smart-Sync/Secure-Smart-Sync-relay). You can self-host it if you prefer not to use the default instance.



## Credits

[Remotely Save](https://github.com/remotely-save/remotely-save) provided an early reference for S3-compatible storage that helped accelerate the initial prototyping phase. SSS has since been independently rewritten into a different architecture. The portions of Remotely Save that informed this project are licensed under Apache 2.0.


## License

Code is released under the **MIT License** — see [LICENSE](./LICENSE).

The **Secure-Smart-Sync** name, logos, icons, embedded SVG branding elements, and overall visual identity remain the intellectual property of &copy; Sen and are not covered under the MIT License.

These branding elements are included in the source code solely for functional product use. Public forks, redistributions, or derivative projects must remove or replace original branding unless explicit permission is granted.

see — [LICENSE_BRANDING](./LICENSE_BRANDING.md) 

## Support
<div align="left">
  <a href="https://ko-fi.com/xensenx" target="_blank">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://cdn.jsdelivr.net/gh/Secure-Smart-Sync/Secure-Smart-Sync-assets/Icons/SVG/Ko-fi_white.svg">
      <source media="(prefers-color-scheme: light)" srcset="https://cdn.jsdelivr.net/gh/Secure-Smart-Sync/Secure-Smart-Sync-assets/Icons/SVG/Ko-fi_black.svg">
      <img align="left" src="https://cdn.jsdelivr.net/gh/Secure-Smart-Sync/Secure-Smart-Sync-assets/Icons/SVG/Ko-fi_white.svg" width="90" alt="Support on Ko-fi">
    </picture>
  </a>
  
  <br>
  <strong>&nbsp;&nbsp;If the plugin has helped you and saved your time,</strong><br>
  <strong>&nbsp;&nbsp;consider supporting the developer.</strong>
</div>

<br clear="all" />

## Contact & help

Have a question or a suggestion? Here is how to get in touch:

* **Bug Reports:** Please **[open an issue on GitHub]((https://github.com/Secure-Smart-Sync/Secure-Smart-Sync/issues))** so we can track and fix it.
* **General Inquiries:** For all other genuine inquiries, feel free to email us at **securesmartsync@gmail.com**

We aim to respond to all non-technical messages within 48 hours.

