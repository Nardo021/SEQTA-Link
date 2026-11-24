import { argon2id, argon2i, argon2d } from "@noble/hashes/argon2.js";
import { scrypt } from "@noble/hashes/scrypt.js";

const encoder = new TextEncoder();
type Purpose = "calendar" | "device";

async function hmacSha256(keyBytes: Uint8Array, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw", Uint8Array.from(keyBytes).buffer, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

export async function hashToken(pepper: Uint8Array, purpose: Purpose, raw: string): Promise<string> {
  const digest = await hmacSha256(pepper, purpose + ":" + raw);
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function stableUid(secret: Uint8Array, calendarId: string, eventId: string): Promise<string> {
  const bytes = await hmacSha256(secret, `event:v1:${calendarId}:${eventId}`);
  const binary = String.fromCharCode(...bytes);
  const b64url = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return b64url + "@seqta.link";
}

/** Pure-JS Argon2 PHC verifier experiment; cap untrusted costs before allocation. */
export function verifyArgon2Phc(password: string, phc: string): boolean {
  if (phc.length > 512) return false;
  const match = /^\$(argon2id|argon2i|argon2d)\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(phc);
  if (!match) return false;
  const [, algorithm, mRaw, tRaw, pRaw, saltRaw, keyRaw] = match;
  const m = Number(mRaw), t = Number(tRaw), p = Number(pRaw);
  if (m < 8 * p || m > 65536 || t < 1 || t > 10 || p < 1 || p > 8) return false;
  const parse = (value: string): Uint8Array =>
    Uint8Array.from(atob(value + "=".repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0));
  try {
    const salt = parse(saltRaw);
    const expected = parse(keyRaw);
    if (expected.length < 16 || expected.length > 64 || salt.length < 8) return false;
    const opts = { m, t, p, dkLen: expected.length, version: 0x13, maxmem: 128 * 1024 * 1024 };
    const actual = algorithm === "argon2id" ? argon2id(password, salt, opts)
      : algorithm === "argon2i" ? argon2i(password, salt, opts)
      : argon2d(password, salt, opts);
    return compareDerived(actual, expected);
  } catch {
    return false;
  }
}

/** Compare derived bytes without early exit, then wipe the derived buffer. */
function compareDerived(actual: Uint8Array, expected: Uint8Array): boolean {
  try {
    if (actual.length !== expected.length) return false;
    let difference = 0;
    for (let i = 0; i < actual.length; i++) difference |= actual[i] ^ expected[i];
    return difference === 0;
  } finally {
    actual.fill(0);
  }
}

/** Mirrors Python hashlib.scrypt(password UTF-8, textual salt UTF-8,
 * n=16384, r=8, p=1, dklen=64). No parameters supplied by clients.
 * Experimental helper, not a production login handler.
 */
export function verifyLegacyScrypt(password: string, stored: string): boolean {
  if (stored.length > 1024) return false;
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, encoded] = parts;
  if (!/^[A-Za-z0-9_-]{86}(?:==)?$/.test(encoded)) return false;
  try {
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
    const expected = Uint8Array.from(atob(normalized + "=="), c => c.charCodeAt(0));
    if (expected.length !== 64) return false;
    const actual = scrypt(password, salt, {
      N: 2 ** 14, r: 8, p: 1, dkLen: 64, maxmem: 32 * 1024 * 1024,
    });
    return compareDerived(actual, expected);
  } catch {
    return false;
  }
}
