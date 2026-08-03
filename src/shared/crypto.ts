import { createHmac, createHash, randomBytes } from 'node:crypto';
import type { TokenType } from './types.js';

const UPLOAD_PREFIX = 'scu_';
const CALENDAR_PREFIX = 'scc_';
const TOKEN_RANDOM_BYTES = 32;
const ICAL_UID_DOMAIN = 'timetable.leoze.top';

export function generateRawToken(type: TokenType): string {
  const prefix = type === 'upload' ? UPLOAD_PREFIX : CALENDAR_PREFIX;
  const randomPart = randomBytes(TOKEN_RANDOM_BYTES).toString('base64url');
  return `${prefix}${randomPart}`;
}

export function hashToken(tokenPepper: Buffer, type: TokenType, rawToken: string): string {
  return createHmac('sha256', tokenPepper)
    .update(`${type}:${rawToken}`)
    .digest('hex');
}

export function detectTokenType(rawToken: string): TokenType | null {
  if (rawToken.startsWith(UPLOAD_PREFIX)) {
    return 'upload';
  }
  if (rawToken.startsWith(CALENDAR_PREFIX)) {
    return 'calendar';
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
