import { expect, test } from "vitest";
import { verifyArgon2Phc, verifyLegacyScrypt } from "../src/compat";
import { PASSWORD, ARGON2_DEFAULT, SCRYPT_LEGACY } from "./password-fixtures";

test("Python Argon2 default-profile hash accepts correct password (64 MiB, t=3, p=4)", () => {
  expect(verifyArgon2Phc(PASSWORD, ARGON2_DEFAULT)).toBe(true);
}, 30_000);

test("Python Argon2 default-profile hash rejects wrong password", () => {
  expect(verifyArgon2Phc("incorrect-fixture-password", ARGON2_DEFAULT)).toBe(false);
}, 30_000);

test("legacy Python scrypt hash accepts both unpadded and padded base64url", () => {
  expect(verifyLegacyScrypt(PASSWORD, SCRYPT_LEGACY)).toBe(true);
  expect(verifyLegacyScrypt(PASSWORD, SCRYPT_LEGACY + "==")).toBe(true);
}, 30_000);

test("legacy scrypt rejects wrong password and malformed format", () => {
  expect(verifyLegacyScrypt("incorrect-fixture-password", SCRYPT_LEGACY)).toBe(false);
  expect(verifyLegacyScrypt(PASSWORD, "scrypt$bad")).toBe(false);
  expect(verifyLegacyScrypt(PASSWORD, SCRYPT_LEGACY + "$extra")).toBe(false);
  expect(verifyLegacyScrypt(PASSWORD, "scrypt$salt$invalid")).toBe(false);
}, 30_000);

test("reject malformed and excessive Argon2 costs before KDF work", () => {
  for (const value of [
    "$argon2id$bad",
    ARGON2_DEFAULT.replace("m=65536", "m=131072"),
    ARGON2_DEFAULT.replace("t=3", "t=1000"),
    ARGON2_DEFAULT.replace("p=4", "p=1000"),
    ARGON2_DEFAULT.replace("m=65536", "m=1"),
    ARGON2_DEFAULT.replace("v=19", "v=16"),
  ]) expect(verifyArgon2Phc(PASSWORD, value)).toBe(false);
});
