import { argon2Verify } from "hash-wasm";

const encoder = new TextEncoder();
type Purpose = "calendar" | "device";

async function hmacSha256(keyBytes: Uint8Array, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
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

/** Workerd experimental verifier. Never accept arbitrary unbounded PHC memory work. */
export async function verifyArgon2Phc(password: string, phc: string): Promise<boolean> {
  const match = /^\$argon2(?:id|i|d)\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/.exec(phc);
  if (!match) return false;
  const [, mRaw, tRaw, pRaw] = match;
  const m = Number(mRaw), t = Number(tRaw), p = Number(pRaw);
  if (m < 8 || m > 65536 || t < 1 || t > 10 || p < 1 || p > 8) return false;
  try {
    return await argon2Verify({ password, hash: phc });
  } catch {
    return false;
  }
}
