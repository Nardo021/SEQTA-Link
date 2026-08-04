export interface UserRecord {
  id: string;
  oidcIssuer: string;
  oidcSubject: string;
  displayName: string;
  email: string | null;
  role: 'owner' | 'admin' | 'user';
  accountStatus: 'active' | 'suspended' | 'deleted';
  syncEnabled: boolean;
  feedEnabled: boolean;
  maxDevices: number;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarRecord {
  id: string;
  ownerUserId: string;
  name: string;
  timezone: string;
  schoolHost: string;
  studentRef: string;
  revision: number;
  lastChangedAt: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeviceRecord {
  id: string;
  ownerUserId: string;
  calendarId: string;
  name: string;
  tokenPrefix: string;
  status: 'active' | 'revoked';
  createdAt: string;
  lastSeenAt: string | null;
  lastSyncedAt: string | null;
}

export interface EventRecord {
  id: string;
  ownerUserId: string;
  calendarId: string;
  naturalKey: string;
  icalUid: string;
  localDate: string;
  periodKey: string;
  courseCode: string | null;
  title: string;
  startsAtUtc: string;
  endsAtUtc: string;
  timezone: string;
  teacher: string | null;
  room: string | null;
  description: string | null;
  eventType: string;
  contentHash: string;
  sequence: number;
  status: 'confirmed' | 'cancelled';
  active: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface SyncResultCounts {
  received: number;
  normalized: number;
  duplicatesRemoved: number;
  inserted: number;
  updated: number;
  removed: number;
  restored: number;
  unchanged: number;
}

export interface SyncSuccessResponse {
  syncId: string;
  revision: number;
  changed: boolean;
  result: SyncResultCounts;
  lastSyncedAt?: string;
  replayed?: boolean;
}

export type TokenType = 'upload' | 'calendar' | 'device';

export interface SyncContext {
  calendar: CalendarRecord;
  device: DeviceRecord;
  ownerUserId: string;
}
