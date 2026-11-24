import { beforeAll, expect, test } from "vitest";
import { env } from "cloudflare:workers";
import { hashToken, stableUid, verifyArgon2Phc } from "../src/compat";
import { resolveCalendarToken } from "../src/lookup";
import worker from "../src/index";

const pepper = new Uint8Array(32).fill(120);
const secret = new Uint8Array(32).fill(121);
const raw = "sl_cal_fixture_please_do_not_use_as_secret";

test("HMAC token hashes equal the Flask compatibility vectors", async () => {
  expect(await hashToken(pepper, "calendar", raw))
    .toBe("6476eb6b120207962d91aca225a38bc4dc2efa68b2621f6c393494f7c4be63f0");
  expect(await hashToken(pepper, "device", "sl_dvc_fixture"))
    .toBe("abe94f4d7ac51798148861957e78336b032bf6e85c7d85a8c9ff849c97080086");
});

test("UID generation matches the current Flask format", async () => {
  expect(await stableUid(secret, "cal-fixed-01", "evt-fixed-01"))
    .toBe("TU3ivCe5WD3fTmf9vAprFaHSm5WszzJ_qOufOht6yPs@seqta.link");
});

test("Pure JS Argon2 verifies an independently generated Python argon2-cffi PHC hash", () => {
  // Python argon2-cffi Type.ID, m=1024 KiB, t=2, p=1, salt="fixed-salt-12345"
  const hash = "$argon2id$v=19$m=1024,t=2,p=1$Zml4ZWQtc2FsdC0xMjM0NQ$yFodBUXp5pQtNAKVrFlxRqmiL23Qo02yBhPRo3I7p0Q";
  expect(verifyArgon2Phc("fixture-secret", hash)).toBe(true);
  expect(verifyArgon2Phc("wrong-secret", hash)).toBe(false);
  expect(verifyArgon2Phc("fixture-secret", "$argon2id$bad")).toBe(false);
  expect(verifyArgon2Phc("fixture-secret", hash.replace("m=1024", "m=262144"))).toBe(false);
});

beforeAll(async () => {
  await env.DATABASE.prepare("CREATE TABLE users (id TEXT PRIMARY KEY, account_status TEXT NOT NULL, feed_enabled INTEGER NOT NULL)").run();
  await env.DATABASE.prepare("CREATE TABLE calendars (id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, revision INTEGER NOT NULL)").run();
  await env.DATABASE.prepare("CREATE TABLE calendar_tokens (token_hash TEXT PRIMARY KEY, calendar_id TEXT NOT NULL, status TEXT NOT NULL)").run();
  await env.DATABASE.prepare(
    "INSERT INTO users (id, account_status, feed_enabled) VALUES (?, ?, ?)"
  ).bind("u1", "active", 1).run();
  await env.DATABASE.prepare(
    "INSERT INTO calendars (id, owner_user_id, revision) VALUES (?, ?, ?)"
  ).bind("c1", "u1", 5).run();
  await env.DATABASE.prepare(
    "INSERT INTO calendar_tokens (token_hash, calendar_id, status) VALUES (?, ?, ?)"
  ).bind(await hashToken(pepper, "calendar", raw), "c1", "active").run();
});

test("D1 lookup preserves active subscription and ETag contract", async () => {
  expect(await resolveCalendarToken(env.DATABASE, pepper, raw))
    .toEqual({ status: 200, revision: 5, etag: '"calendar-5"' });
  expect(await resolveCalendarToken(env.DATABASE, pepper, "sl_cal_invalid"))
    .toEqual({ status: 404 });
  expect(await resolveCalendarToken(env.DATABASE, pepper, "wrong-format"))
    .toEqual({ status: 404 });
});

test("D1 disabled/revoked tokens fail closed without returning event data", async () => {
  await env.DATABASE.prepare("UPDATE users SET feed_enabled = 0 WHERE id = 'u1'").run();
  expect(await resolveCalendarToken(env.DATABASE, pepper, raw)).toEqual({ status: 410 });
  await env.DATABASE.prepare("UPDATE users SET feed_enabled = 1 WHERE id = 'u1'").run();
  await env.DATABASE.prepare("UPDATE calendar_tokens SET status = 'revoked'").run();
  expect(await resolveCalendarToken(env.DATABASE, pepper, raw)).toEqual({ status: 404 });
});

test("experimental Worker exposes no production business routes", async () => {
  const response = worker.fetch(new Request("https://example.invalid/calendar/" + raw + ".ics"));
  expect(response.status).toBe(404);
});
