# In Development

Secure Smart Sync has reached a stable foundational stage, but several areas still require improvement before the system can be considered fully mature at scale.

These are not experimental ideas or vague roadmap concepts — they are active engineering problems identified through real-world usage and development.

---

## Tablet UI Sync Indicator Stability

The sync status indicator currently behaves correctly on mobile devices, but tablet layouts introduce additional UI inconsistencies.

In landscape mode, the icon positioning can become misaligned due to differences in Obsidian’s tablet layout behavior.

This issue is more complex than simple positioning adjustments.

The indicator must behave like a native Obsidian UI element and properly respond to:

- sidebar transitions  
- modal openings  
- settings panels  
- overlay interactions  
- responsive layout changes  

Multiple iterations were required to make this work properly on mobile, and tablet-specific behavior still needs refinement.

---

## Block-Level Syncing

Currently, when a file changes, the entire file is re-uploaded.

This works well for smaller markdown files, but becomes highly inefficient for larger files.

For example:

- correcting a typo in a large note should not require re-uploading the full file  
- modifying a large PDF or media file should not trigger full file replacement  

Future versions of Secure Smart Sync aim to introduce block-level syncing, where only modified portions of a file are uploaded.

This would significantly improve sync efficiency for larger vaults and large individual files.

---

## Large File Streaming Encryption

Large files currently need to be loaded into memory during encryption.

This creates serious problems for devices with limited RAM, especially mobile devices.

Very large files can cause:

- excessive memory usage  
- crashes  
- failed uploads  

The current system needs to be replaced with a streaming-based pipeline where files are processed in smaller chunks and directly streamed during encryption and upload.

This would allow Secure Smart Sync to handle significantly larger files more reliably.

---

## Large Vault Queue Optimization

The current sync queue performs well for normal vault sizes.

However, extremely large vaults containing thousands of files may trigger Cloudflare API rate limiting due to continuous upload requests.

Future improvements will introduce adaptive queue behavior.

The system will first detect vault scale and determine whether slower batching mechanisms are required.

For larger vaults, Secure Smart Sync may:

- reduce request frequency  
- batch uploads more intelligently  
- display clearer progress indicators  
- prevent unnecessary API throttling  

This ensures large vaults remain reliable without affecting normal users.

---

## Active Editing During Sync

Secure Smart Sync already handles most cases where users continue editing files during active sync operations.

In most situations:

- sync integrity remains intact  
- partial sync issues are avoided  
- automatic retries recover safely after idle periods  

However, rapid consecutive edits can still create edge cases involving timing conflicts between active file changes and sync operations.

These edge cases require additional hardening to ensure sync behavior remains fully reliable even during heavy real-time editing.
