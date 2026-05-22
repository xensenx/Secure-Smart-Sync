/**
 * pairing-relay.ts
 *
 * Client-side logic for SSS device pairing via the sss-relay Cloudflare Worker.
 *
 * Flow (sender — desktop):
 *   1. exportCredentialBundle() → JSON string of all credentials
 *   2. generatePin()            → 6-character random PIN
 *   3. encryptBundle()          → AES-GCM encrypt with PIN-derived key → base64url blob
 *   4. storeBlob()              → POST /store → get token from Worker
 *   5. Show user: PIN + token combined as one 14-char pairing code
 *      Format: <6-char PIN>-<8-char token>   e.g.  "mK7pQA-X3Bv9nRw"
 *
 * Flow (receiver — mobile):
 *   1. User enters pairing code
 *   2. splitPairingCode()  → { pin, token }
 *   3. retrieveBlob()      → GET /retrieve/:token → blob (one-time, auto-deleted)
 *   4. decryptBundle()     → AES-GCM decrypt with PIN-derived key → JSON string
 *   5. importCredentialBundle() → populate settings
 *
 * Crypto details:
 *   Key derivation : PBKDF2-SHA256, 100 000 iterations, 256-bit key
 *   Encryption     : AES-GCM, 128-bit IV (random per session)
 *   Encoding       : standard base64 for the blob (safe for JSON transport)
 *   Salt           : fixed public constant — the PIN is the secret, not the salt.
 *                    PBKDF2 with 100k iterations makes brute-force expensive even
 *                    for a 6-char PIN over a 10-minute window.
 */

import { requestUrl } from "obsidian";

// ─── Constants ────────────────────────────────────────────────────────────────

// Unambiguous characters for PIN generation (no 0/O, 1/l/I).
const PIN_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz";
const PIN_LENGTH = 6;

// Public salt — not secret, just needs to be unique to this application so keys
// derived here can't be reused in an unrelated context.
const PBKDF2_SALT = new TextEncoder().encode("sss-relay-pairing-v1");

const PBKDF2_ITERATIONS = 100_000;

// Separator between PIN and token in the displayed pairing code.
const CODE_SEPARATOR = "-";

// Expected total length of a pairing code: PIN + separator + token
// PIN_LENGTH(6) + 1 + TOKEN_LENGTH(8) = 15
const PAIRING_CODE_LENGTH = PIN_LENGTH + 1 + 8;

// ─── Public API ───────────────────────────────────────────────────────────────

export interface PairingCodeResult {
  /** Full pairing code shown to the user, e.g. "mK7pQA-X3Bv9nRw" */
  pairingCode: string;
  /** Seconds until the slot expires (mirrors the relay TTL). */
  expiresInSeconds: number;
}

export interface RelayConfig {
  /** Base URL of the deployed sss-relay Worker, no trailing slash. */
  relayUrl: string;
}

/**
 * Sender side: encrypt the credential bundle and post it to the relay.
 * Returns the pairing code to display to the user.
 */
export async function createPairingSlot(
  credentialJson: string,
  config: RelayConfig
): Promise<PairingCodeResult> {
  const pin   = generatePin();
  const blob  = await encryptBundle(credentialJson, pin);
  const token = await storeBlob(blob, config.relayUrl);

  return {
    pairingCode:      `${pin}${CODE_SEPARATOR}${token}`,
    expiresInSeconds: 600,
  };
}

/**
 * Receiver side: retrieve and decrypt the credential bundle from the relay.
 * Returns the raw credential JSON string for importCredentialBundle().
 *
 * Throws a descriptive Error if the code is malformed, the token is not found
 * (expired / already used), or decryption fails (wrong PIN).
 */
export async function consumePairingSlot(
  pairingCode: string,
  config: RelayConfig
): Promise<string> {
  const { pin, token } = splitPairingCode(pairingCode);
  const blob           = await retrieveBlob(token, config.relayUrl);
  return decryptBundle(blob, pin);
}

/**
 * Sends a GET /health request to the relay and returns true if it responds ok.
 * Used by the settings tab to let users verify their relay URL.
 */
export async function checkRelayHealth(relayUrl: string): Promise<boolean> {
  try {
    const rsp = await requestUrl({
      url:    `${normaliseUrl(relayUrl)}/health`,
      method: "GET",
    });
    if (rsp.status < 200 || rsp.status >= 300) return false;
    const json = rsp.json as { ok?: boolean };
    return json.ok === true;
  } catch {
    return false;
  }
}

// ─── PIN ──────────────────────────────────────────────────────────────────────

/**
 * Generates a cryptographically random PIN_LENGTH-character PIN using only
 * characters from PIN_CHARS (unambiguous alphanumeric set).
 * Uses rejection sampling to avoid modulo bias.
 */
function generatePin(): string {
  const result: string[] = [];
  const charCount = PIN_CHARS.length;
  const ACCEPT_THRESHOLD = Math.floor(256 / charCount) * charCount;

  while (result.length < PIN_LENGTH) {
    const bytes = crypto.getRandomValues(new Uint8Array(PIN_LENGTH * 2));
    for (const byte of bytes) {
      if (result.length >= PIN_LENGTH) break;
      if (byte < ACCEPT_THRESHOLD) {
        result.push(PIN_CHARS[byte % charCount]);
      }
    }
  }

  return result.join("");
}

// ─── Pairing code parsing ─────────────────────────────────────────────────────

function splitPairingCode(code: string): { pin: string; token: string } {
  const trimmed = code.trim();
  const sepIdx  = trimmed.indexOf(CODE_SEPARATOR);

  if (sepIdx !== PIN_LENGTH) {
    throw new Error(
      `Invalid pairing code format. Expected ${PIN_LENGTH} characters, a dash, then the token.`
    );
  }

  const pin   = trimmed.slice(0, PIN_LENGTH);
  const token = trimmed.slice(PIN_LENGTH + 1);

  if (token.length !== 8) {
    throw new Error("Invalid pairing code: token portion must be 8 characters.");
  }

  return { pin, token };
}

// ─── Crypto ───────────────────────────────────────────────────────────────────

/**
 * Derives an AES-GCM CryptoKey from a PIN using PBKDF2-SHA256.
 */
async function deriveKey(pin: string): Promise<CryptoKey> {
  const pinBytes = new TextEncoder().encode(pin);

  const baseKey = await crypto.subtle.importKey(
    "raw", pinBytes, "PBKDF2", false, ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name:       "PBKDF2",
      salt:       PBKDF2_SALT,
      iterations: PBKDF2_ITERATIONS,
      hash:       "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypts a plaintext string with AES-GCM using a PIN-derived key.
 * Returns a base64-encoded string: <12-byte IV> || <ciphertext>.
 */
async function encryptBundle(plaintext: string, pin: string): Promise<string> {
  const key       = await deriveKey(pin);
  const iv        = crypto.getRandomValues(new Uint8Array(12));
  const encoded   = new TextEncoder().encode(plaintext);

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded
  );

  // Concatenate IV + ciphertext into one buffer, then base64-encode.
  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.byteLength);

  return uint8ToBase64(combined);
}

/**
 * Decrypts a base64-encoded AES-GCM blob produced by encryptBundle().
 * Throws if decryption fails (wrong PIN, tampered blob).
 */
async function decryptBundle(blob: string, pin: string): Promise<string> {
  let combined: Uint8Array;
  try {
    combined = base64ToUint8(blob);
  } catch {
    throw new Error("Pairing code is invalid or the blob is corrupted.");
  }

  if (combined.byteLength < 13) {
    throw new Error("Blob is too short to be valid.");
  }

  const iv         = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const key        = await deriveKey(pin);

  let plainBytes: ArrayBuffer;
  try {
    plainBytes = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext
    );
  } catch {
    // AES-GCM authentication failure — almost always a wrong PIN.
    throw new Error(
      "Decryption failed. The PIN may be incorrect, or the pairing code has expired."
    );
  }

  return new TextDecoder().decode(plainBytes);
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function normaliseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

async function storeBlob(blob: string, relayUrl: string): Promise<string> {
  let rsp: Awaited<ReturnType<typeof requestUrl>>;
  try {
    rsp = await requestUrl({
      url:         `${normaliseUrl(relayUrl)}/store`,
      method:      "POST",
      headers:     { "Content-Type": "application/json" },
      body:        JSON.stringify({ blob }),
      contentType: "application/json",
    });
  } catch (e) {
    throw new Error(`Could not reach the pairing relay: ${(e as Error).message}`);
  }

  if (rsp.status === 429) {
    throw new Error("Relay rate limit hit. Wait a minute and try again.");
  }
  if (rsp.status < 200 || rsp.status >= 300) {
    throw new Error(`Relay error ${rsp.status}: ${rsp.text}`);
  }

  const json = rsp.json as { token?: string; error?: string };
  if (!json.token) {
    throw new Error("Relay returned no token. Response: " + JSON.stringify(json));
  }

  return json.token;
}

async function retrieveBlob(token: string, relayUrl: string): Promise<string> {
  let rsp: Awaited<ReturnType<typeof requestUrl>>;
  try {
    rsp = await requestUrl({
      url:    `${normaliseUrl(relayUrl)}/retrieve/${encodeURIComponent(token)}`,
      method: "GET",
    });
  } catch (e) {
    throw new Error(`Could not reach the pairing relay: ${(e as Error).message}`);
  }

  if (rsp.status === 404) {
    throw new Error("Pairing code not found. It may have expired or already been used.");
  }
  if (rsp.status < 200 || rsp.status >= 300) {
    throw new Error(`Relay error ${rsp.status}: ${rsp.text}`);
  }

  const json = rsp.json as { blob?: string; error?: string };
  if (!json.blob) {
    throw new Error("Relay returned no blob. Response: " + JSON.stringify(json));
  }

  return json.blob;
}

// ─── Base64 utilities ─────────────────────────────────────────────────────────

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
