import type { DbClient } from './client.js';
import type { CalendarRecord, DeviceRecord, SyncContext } from '../shared/types.js';
import { AppError } from '../shared/errors.js';

interface UploadTokenRow {
  device_id: string;
  owner_user_id: string;
  calendar_id: string;
  device_name: string;
  device_token_prefix: string;
  device_status: 'active' | 'revoked';
  device_created_at: string;
  device_last_seen_at: string | null;
  device_last_synced_at: string | null;
  calendar_name: string;
  timezone: string;
  revision: string | number;
  school_host: string | null;
  student_ref: string | null;
  calendar_last_synced_at: string | null;
  calendar_last_changed_at: string | null;
  calendar_created_at: string;
  calendar_updated_at: string;
  account_status: 'active' | 'suspended' | 'deleted';
  sync_enabled: boolean;
  feed_enabled: boolean;
}

interface CalendarTokenRow {
  owner_user_id: string;
  calendar_id: string;
  calendar_name: string;
  timezone: string;
  revision: string | number;
  school_host: string | null;
  student_ref: string | null;
  calendar_last_synced_at: string | null;
  calendar_last_changed_at: string | null;
  calendar_created_at: string;
  calendar_updated_at: string;
  account_status: 'active' | 'suspended' | 'deleted';
  sync_enabled: boolean;
  feed_enabled: boolean;
}

export interface PairingResolveRow {
  pairingId: string;
  ownerUserId: string;
  calendarId: string;
  expiresAt: string;
  usedAt: string | null;
  accountStatus: 'active' | 'suspended' | 'deleted';
  syncEnabled: boolean;
  maxDevices: number;
  calendarName: string;
}

function mapCalendar(row: {
  calendar_id: string;
  owner_user_id: string;
  calendar_name: string;
  timezone: string;
  revision: string | number;
  school_host: string | null;
  student_ref: string | null;
  calendar_last_synced_at: string | null;
  calendar_last_changed_at: string | null;
  calendar_created_at: string;
  calendar_updated_at: string;
}): CalendarRecord {
  return {
    id: row.calendar_id,
    ownerUserId: row.owner_user_id,
    name: row.calendar_name,
    timezone: row.timezone,
    schoolHost: row.school_host ?? '',
    studentRef: row.student_ref ?? '',
    revision: Number(row.revision),
    lastSyncedAt: row.calendar_last_synced_at,
    lastChangedAt: row.calendar_last_changed_at,
    createdAt: row.calendar_created_at,
    updatedAt: row.calendar_updated_at,
  };
}

function mapDevice(row: UploadTokenRow): DeviceRecord {
  return {
    id: row.device_id,
    ownerUserId: row.owner_user_id,
    calendarId: row.calendar_id,
    name: row.device_name,
    tokenPrefix: row.device_token_prefix,
    status: row.device_status,
    createdAt: row.device_created_at,
    lastSeenAt: row.device_last_seen_at,
    lastSyncedAt: row.device_last_synced_at,
  };
}

export async function resolveUploadTokenContext(
  db: DbClient,
  tokenHash: string,
  options: { requireSyncEnabled?: boolean } = {},
): Promise<SyncContext> {
  const row = await db.queryOne<UploadTokenRow>(
    'SELECT * FROM resolve_upload_token($1)',
    [tokenHash],
  );
  if (!row) {
    throw new AppError('INVALID_TOKEN', 'Invalid upload token.', 401);
  }
  if (row.account_status !== 'active') {
    throw new AppError('ACCOUNT_SUSPENDED', 'Account is not active.', 403);
  }
  if (options.requireSyncEnabled !== false && !row.sync_enabled) {
    throw new AppError('SYNC_DISABLED', 'Sync is disabled for this account.', 403);
  }
  const device = mapDevice(row);
  const calendar = mapCalendar(row);
  return {
    calendar,
    device,
    ownerUserId: row.owner_user_id,
  };
}

export async function resolveCalendarTokenRecord(
  db: DbClient,
  tokenHash: string,
): Promise<CalendarRecord> {
  const row = await db.queryOne<CalendarTokenRow>(
    'SELECT * FROM resolve_calendar_token($1)',
    [tokenHash],
  );
  if (!row) {
    throw new AppError('INVALID_TOKEN', 'Calendar feed not found.', 404);
  }
  if (row.account_status !== 'active') {
    throw new AppError('ACCOUNT_SUSPENDED', 'Account is not active.', 403);
  }
  if (!row.feed_enabled) {
    throw new AppError(
      'FEED_DISABLED',
      'Calendar subscription disabled by administrator.',
      410,
    );
  }
  return mapCalendar(row);
}

export async function resolvePairingCodeRow(
  db: DbClient,
  codeHash: string,
): Promise<PairingResolveRow | null> {
  const row = await db.queryOne<{
    pairing_id: string;
    owner_user_id: string;
    calendar_id: string;
    expires_at: string;
    used_at: string | null;
    account_status: 'active' | 'suspended' | 'deleted';
    sync_enabled: boolean;
    max_devices: number;
    calendar_name: string;
  }>('SELECT * FROM resolve_pairing_code($1)', [codeHash]);
  if (!row) {
    return null;
  }
  return {
    pairingId: row.pairing_id,
    ownerUserId: row.owner_user_id,
    calendarId: row.calendar_id,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    accountStatus: row.account_status,
    syncEnabled: row.sync_enabled,
    maxDevices: Number(row.max_devices),
    calendarName: row.calendar_name,
  };
}
