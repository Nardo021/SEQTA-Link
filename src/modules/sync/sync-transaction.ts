import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../../config.js';
import { generateIcalUid } from '../../shared/crypto.js';
import { nowIso } from '../../shared/dates.js';
import { AppError } from '../../shared/errors.js';
import type { SyncContext, SyncResultCounts, SyncSuccessResponse } from '../../shared/types.js';
import { findActiveEventsInCompleteCoverage } from '../events/event.helpers.js';
import { resolveLessonAction } from './lesson-actions.js';
import { getOverallRange } from './coverage.js';
import type { SyncServiceDeps } from './sync.service.js';
import type { SyncRunRecord } from './sync.repository.js';
import type { normalizeCoverage } from './coverage.js';
import type { deduplicateLessons } from './deduplicator.js';

export interface SyncTransactionInput {
  context: SyncContext;
  idempotencyKey: string;
  payloadHash: string;
  snapshotHash: string;
  coverage: ReturnType<typeof normalizeCoverage>;
  lessons: ReturnType<typeof deduplicateLessons>['lessons'];
  duplicateCount: number;
  receivedCount: number;
  bodySchoolHost: string;
  bodyStudentRef: string;
}

export async function runSyncTransaction(
  deps: SyncServiceDeps,
  config: AppConfig,
  input: SyncTransactionInput,
): Promise<SyncSuccessResponse> {
  const { calendar, device, ownerUserId } = input.context;

  const existingRun = await deps.syncRepo.findSyncRunByIdempotencyKey(
    device.id,
    input.idempotencyKey,
  );

  if (existingRun) {
    if (
      existingRun.payloadHash !== input.payloadHash ||
      existingRun.snapshotHash !== input.snapshotHash
    ) {
      throw new AppError(
        'IDEMPOTENCY_KEY_REUSED',
        'The idempotency key has already been used with another payload.',
        409,
      );
    }
    return buildReplayResponse(deps, existingRun);
  }

  const syncRunId = randomUUID();
  const startedAt = nowIso();
  const overallRange = getOverallRange(input.coverage);

  await deps.syncRepo.createSyncRun({
    id: syncRunId,
    ownerUserId,
    calendarId: calendar.id,
    deviceId: device.id,
    idempotencyKey: input.idempotencyKey,
    payloadHash: input.payloadHash,
    snapshotHash: input.snapshotHash,
    rangeFrom: overallRange.from,
    rangeUntil: overallRange.until,
    receivedCount: input.receivedCount,
    normalizedCount: input.lessons.length,
    duplicateCount: input.duplicateCount,
    startedAt,
  });

  const counts: SyncResultCounts = {
    received: input.receivedCount,
    normalized: input.lessons.length,
    duplicatesRemoved: input.duplicateCount,
    inserted: 0,
    updated: 0,
    removed: 0,
    restored: 0,
    unchanged: 0,
  };

  const eventIndex = await deps.eventRepo.loadCalendarIndex(calendar.id);
  const seenEventIds = new Set<string>();
  const now = nowIso();

  for (const lesson of input.lessons) {
    const existing = deps.eventRepo.resolveEvent(eventIndex, lesson.sourceKey, lesson.naturalKey);
    const action = resolveLessonAction(existing, lesson);

    if (action.kind === 'insert') {
      const eventId = randomUUID();
      const icalUid = generateIcalUid(config.uidSecret, calendar.id, eventId);
      const created = await deps.eventRepo.insertEvent({
        id: eventId,
        ownerUserId,
        calendarId: calendar.id,
        naturalKey: lesson.naturalKey,
        icalUid,
        lesson,
        timezone: calendar.timezone,
        now,
      });
      await deps.eventRepo.upsertAlias(calendar.id, lesson.sourceKey, eventId, now);
      eventIndex.eventsById.set(eventId, created);
      eventIndex.eventsByNaturalKey.set(lesson.naturalKey, created);
      eventIndex.aliasesBySourceKey.set(lesson.sourceKey, eventId);
      seenEventIds.add(eventId);
      counts.inserted++;
      continue;
    }

    const eventId = action.event.id;
    await deps.eventRepo.upsertAlias(calendar.id, lesson.sourceKey, eventId, now);
    eventIndex.aliasesBySourceKey.set(lesson.sourceKey, eventId);
    seenEventIds.add(eventId);

    if (action.kind === 'restore' || action.kind === 'update') {
      const updated = await deps.eventRepo.updateEvent(action.event, lesson, now);
      eventIndex.eventsById.set(eventId, updated);
      eventIndex.eventsByNaturalKey.set(lesson.naturalKey, updated);
      if (action.kind === 'restore') {
        counts.restored++;
      } else {
        counts.updated++;
      }
      continue;
    }

    counts.unchanged++;
  }

  const activeEvents = findActiveEventsInCompleteCoverage(eventIndex, input.coverage);

  for (const event of activeEvents) {
    if (seenEventIds.has(event.id)) {
      continue;
    }
    await deps.eventRepo.cancelEvent(event.id, now);
    counts.removed++;
  }

  const changed = counts.inserted + counts.updated + counts.removed + counts.restored > 0;

  let revision = calendar.revision;
  if (changed) {
    revision = await deps.calendarRepo.incrementRevision(calendar.id, now);
  }

  await deps.calendarRepo.updateLastSynced(calendar.id, now);
  await deps.deviceRepo.touchSync(device.id, now);
  await deps.syncRepo.completeSyncRun(
    syncRunId,
    {
      inserted: counts.inserted,
      updated: counts.updated,
      removed: counts.removed,
      restored: counts.restored,
      unchanged: counts.unchanged,
    },
    now,
  );

  const existingIdentity = await deps.sourceIdentityRepo.findByCalendarId(calendar.id);
  if (!existingIdentity) {
    await deps.sourceIdentityRepo.lockIdentity({
      calendarId: calendar.id,
      schoolHost: input.bodySchoolHost,
      studentRef: input.bodyStudentRef,
      now,
    });
  }

  return {
    syncId: syncRunId,
    revision,
    changed,
    result: counts,
    lastSyncedAt: now,
  };
}

async function buildReplayResponse(
  deps: SyncServiceDeps,
  existingRun: SyncRunRecord,
): Promise<SyncSuccessResponse> {
  const calendar = await deps.calendarRepo.findById(existingRun.calendarId);
  const revision = calendar?.revision ?? 0;
  const changed =
    existingRun.insertedCount +
      existingRun.updatedCount +
      existingRun.removedCount +
      existingRun.restoredCount >
    0;

  return {
    syncId: existingRun.id,
    replayed: true,
    revision,
    changed,
    result: {
      received: existingRun.receivedCount,
      normalized: existingRun.normalizedCount,
      duplicatesRemoved: existingRun.duplicateCount,
      inserted: existingRun.insertedCount,
      updated: existingRun.updatedCount,
      removed: existingRun.removedCount,
      restored: existingRun.restoredCount,
      unchanged: existingRun.unchangedCount,
    },
  };
}
