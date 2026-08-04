import { createHmac, createHash, randomBytes } from 'node:crypto';
import type { SecretHashPurpose, TokenType } from './types.js';

const UPLOAD_PREFIX = 'scu_';
const CALENDAR_PREFIX = 'scc_';
const DEVICE_PREFIX = 'dvc_';
const TOKEN_RANDOM_BYTES = 32;
const PAIRING_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ICAL_UID_DOMAIN = 'timetable.leoze.top';

export function generateRawToken(type: TokenType): string {
  let prefix: string;
  switch (type) {
    case 'upload':
      prefix = UPLOAD_PREFIX;
      break;
    case 'calendar':
      prefix = CALENDAR_PREFIX;
      break;
    case 'device':
      prefix = DEVICE_PREFIX;
      break;
    default: {
      const _exhaustive: never = type;
      throw new Error(`Unsupported token type: ${String(_exhaustive)}`);
    }
  }
  const randomPart = randomBytes(TOKEN_RANDOM_BYTES).toString('base64url');
  return `${prefix}${randomPart}`;
}

export function generatePairingCode(): string {
  let raw = '';
  for (let i = 0; i < 8; i++) {
    raw += PAIRING_CODE_CHARS[randomBytes(1)[0]! % PAIRING_CODE_CHARS.length];
  }
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export function normalizePairingCode(code: string): string {
  return code.replace(/-/g, '').toUpperCase();
}

export function hashToken(
  tokenPepper: Buffer,
  purpose: SecretHashPurpose,
  rawToken: string,
): string {
  return createHmac('sha256', tokenPepper)
    .update(`${purpose}:${rawToken}`)
    .digest('hex');
}

export function hashInviteToken(tokenPepper: Buffer, rawToken: string): string {
  return hashToken(tokenPepper, 'invite', rawToken);
}

export function detectTokenType(rawToken: string): TokenType | null {
  if (rawToken.startsWith(UPLOAD_PREFIX)) {
    return 'upload';
  }
  if (rawToken.startsWith(CALENDAR_PREFIX)) {
    return 'calendar';
  }
  if (rawToken.startsWith(DEVICE_PREFIX)) {
    return 'device';
  }
  return null;
}

export function generateIcalUid(uidSecret: Buffer, feedId: string, eventId: string): string {
  const digest = createHmac('sha256', uidSecret)
    .update(`event:v1:${feedId}:${eventId}`)
    .digest('base64url');
  return `${digest}@${ICAL_UID_DOMAIN}`;
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function canonicalJsonHash(payload: Record<string, unknown>): string {
  const sorted = sortObjectKeys(payload);
  return sha256Hex(JSON.stringify(sorted));
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeys);
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sortedKeys = Object.keys(obj).sort();
    const result: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      result[key] = sortObjectKeys(obj[key]);
    }
    return result;
  }
  return value;
}
