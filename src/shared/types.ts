export interface FeedRecord {
  id: string;
  name: string;
  schoolHost: string;
  studentRef: string;
  timezone: string;
  revision: number;
  lastChangedAt: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EventRecord {
  id: string;
  feedId: string;
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

export type TokenType = 'upload' | 'calendar';
