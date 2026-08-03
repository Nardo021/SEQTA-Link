import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import type { AppConfig } from "../../config.js";
import { runImmediateTransaction } from "../../db/transaction.js";
import { generateIcalUid, sha256Hex } from "../../shared/crypto.js";
import { nowIso } from "../../shared/dates.js";
import { AppError } from "../../shared/errors.js";
import type {
  FeedRecord,
  SyncResultCounts,
  SyncSuccessResponse,
} from "../../shared/types.js";
import { getFeedMutex } from "../../shared/mutex.js";
import { findActiveEventsInCompleteCoverage } from "../events/event.helpers.js";
import type { EventRepository } from "../events/event.repository.js";
import type { FeedRepository } from "../feeds/feed.repository.js";
import {
  getOverallRange,
  normalizeCoverage,
  validateCoverageSpan,
  validateEmptySnapshot,
  validateLessonsWithinCoverage,
} from "./coverage.js";
import { deduplicateLessons } from "./deduplicator.js";
import { resolveLessonAction } from "./lesson-actions.js";
import { normalizeLessons } from "./normalizer.js";
import type { SyncRequestBody } from "./sync.schemas.js";
import type { SyncRepository } from "./sync.repository.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface SyncServiceDeps {
  syncRepo: SyncRepository;
  eventRepo: EventRepository;
  feedRepo: FeedRepository;
}

export class SyncService {
  private readonly syncRepo: SyncRepository;
  private readonly eventRepo: EventRepository;
  private readonly feedRepo: FeedRepository;

  constructor(
    private readonly db: Database,
    private readonly config: AppConfig,
    deps: SyncServiceDeps,
  ) {
    this.syncRepo = deps.syncRepo;
    this.eventRepo = deps.eventRepo;
    this.feedRepo = deps.feedRepo;
  }

  async sync(
    feed: FeedRecord,
    idempotencyKey: string,
    body: SyncRequestBody,
  ): Promise<SyncSuccessResponse> {
    if (!UUID_RE.test(idempotencyKey)) {
      throw new AppError(
        "INVALID_REQUEST",
        "Idempotency-Key must be a valid UUID.",
        400,
      );
    }

    this.validateFeedBinding(feed, body);

    const coverage = normalizeCoverage(body.coverage);
    validateCoverageSpan(coverage, this.config.maxSyncRangeDays);
    validateEmptySnapshot(
      body.lessons.length,
      coverage,
      body.allowEmptySnapshot,
    );

    const normalizedLessons = normalizeLessons(
      body.lessons,
      feed.id,
      body.timezone,
    );
    validateLessonsWithinCoverage(
      normalizedLessons.map((lesson) => lesson.date),
      coverage,
    );

    const { lessons, duplicateCount } = deduplicateLessons(normalizedLessons);
    const payloadHash = sha256Hex(JSON.stringify(body));
    const snapshotHash = sha256Hex(
      JSON.stringify({
        coverage,
        lessons: lessons.map((lesson) => ({
          sourceKey: lesson.sourceKey,
          naturalKey: lesson.naturalKey,
          contentHash: lesson.contentHash,
        })),
      }),
    );

    const mutex = getFeedMutex(feed.id);
    const mutexResult = await mutex.runExclusive(async () => {
      return runImmediateTransaction(this.db, () =>
        this.executeSyncTransaction({
          feed,
          idempotencyKey,
          payloadHash,
          snapshotHash,
          coverage,
          lessons,
          duplicateCount,
          receivedCount: body.lessons.length,
        }),
      );
    });

    if (mutexResult === null) {
      throw new AppError(
        "SYNC_ALREADY_RUNNING",
        "Another sync is currently running for this feed.",
        409,
      );
    }

    return mutexResult;
  }

  private validateFeedBinding(feed: FeedRecord, body: SyncRequestBody): void {
    if (
      body.schoolHost !== feed.schoolHost ||
      body.studentRef !== feed.studentRef ||
      body.timezone !== feed.timezone
    ) {
      throw new AppError(
        "FEED_MISMATCH",
        "schoolHost, studentRef, and timezone must match the feed configuration.",
        409,
      );
    }
  }

  private executeSyncTransaction(input: {
    feed: FeedRecord;
    idempotencyKey: string;
    payloadHash: string;
    snapshotHash: string;
    coverage: ReturnType<typeof normalizeCoverage>;
    lessons: ReturnType<typeof deduplicateLessons>["lessons"];
    duplicateCount: number;
    receivedCount: number;
  }): SyncSuccessResponse {
    const existingRun = this.syncRepo.findSyncRunByIdempotencyKey(
      input.feed.id,
      input.idempotencyKey,
    );

    if (existingRun) {
      if (
        existingRun.payloadHash !== input.payloadHash ||
        existingRun.snapshotHash !== input.snapshotHash
      ) {
        throw new AppError(
          "IDEMPOTENCY_KEY_REUSED",
          "The idempotency key has already been used with another payload.",
          409,
        );
      }

      return this.buildReplayResponse(existingRun);
    }

    const syncRunId = randomUUID();
    const startedAt = nowIso();
    const overallRange = getOverallRange(input.coverage);

    this.syncRepo.createSyncRun({
      id: syncRunId,
      feedId: input.feed.id,
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

    const eventIndex = this.eventRepo.loadFeedIndex(input.feed.id);
    const seenEventIds = new Set<string>();
    const now = nowIso();

    for (const lesson of input.lessons) {
      const existing = this.eventRepo.resolveEvent(
        eventIndex,
        lesson.sourceKey,
        lesson.naturalKey,
      );
      const action = resolveLessonAction(existing, lesson);

      if (action.kind === "insert") {
        const eventId = randomUUID();
        const icalUid = generateIcalUid(
          this.config.uidSecret,
          input.feed.id,
          eventId,
        );
        const created = this.eventRepo.insertEvent({
          id: eventId,
          feedId: input.feed.id,
          naturalKey: lesson.naturalKey,
          icalUid,
          lesson,
          timezone: input.feed.timezone,
          now,
        });
        this.eventRepo.upsertAlias(
          input.feed.id,
          lesson.sourceKey,
          eventId,
          now,
        );
        eventIndex.eventsById.set(eventId, created);
        eventIndex.eventsByNaturalKey.set(lesson.naturalKey, created);
        eventIndex.aliasesBySourceKey.set(lesson.sourceKey, eventId);
        seenEventIds.add(eventId);
        counts.inserted++;
        continue;
      }

      const eventId = action.event.id;
      this.eventRepo.upsertAlias(input.feed.id, lesson.sourceKey, eventId, now);
      eventIndex.aliasesBySourceKey.set(lesson.sourceKey, eventId);
      seenEventIds.add(eventId);

      if (action.kind === "restore" || action.kind === "update") {
        const updated = this.eventRepo.updateEvent(action.event, lesson, now);
        eventIndex.eventsById.set(eventId, updated);
        eventIndex.eventsByNaturalKey.set(lesson.naturalKey, updated);
        if (action.kind === "restore") {
          counts.restored++;
        } else {
          counts.updated++;
        }
        continue;
      }

      counts.unchanged++;
    }

    const activeEvents = findActiveEventsInCompleteCoverage(
      eventIndex,
      input.coverage,
    );

    for (const event of activeEvents) {
      if (seenEventIds.has(event.id)) {
        continue;
      }
      this.eventRepo.cancelEvent(event.id, now);
      counts.removed++;
    }

    const changed =
      counts.inserted + counts.updated + counts.removed + counts.restored > 0;

    let revision = input.feed.revision;
    if (changed) {
      revision = this.feedRepo.incrementRevision(input.feed.id, now);
    }

    this.feedRepo.updateLastSynced(input.feed.id, now);
    this.syncRepo.completeSyncRun(
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

    return {
      syncId: syncRunId,
      revision,
      changed,
      result: counts,
      lastSyncedAt: now,
    };
  }

  private buildReplayResponse(
    existingRun: NonNullable<
      ReturnType<SyncRepository["findSyncRunByIdempotencyKey"]>
    >,
  ): SyncSuccessResponse {
    const feed = this.feedRepo.findById(existingRun.feedId);
    const revision = feed?.revision ?? 0;
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
}
