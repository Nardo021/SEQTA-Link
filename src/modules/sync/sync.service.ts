import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../../config.js';
import type { DbClient } from '../../db/client.js';
import { runTransaction } from '../../db/transaction.js';
import { sha256Hex } from '../../shared/crypto.js';
import { AppError } from '../../shared/errors.js';
import type { SyncContext, SyncSuccessResponse } from '../../shared/types.js';
import { getFeedMutex } from '../../shared/mutex.js';
import { EventRepository } from '../events/event.repository.js';
import { CalendarRepository } from '../calendars/calendar.repository.js';
import { DeviceRepository } from '../calendars/device.repository.js';
import { createSyncServiceDeps } from '../../services/scoped-services.js';
import { SourceIdentityRepository } from '../source-identities/source-identity.repository.js';
import {
  normalizeCoverage,
  validateCoverageSpan,
  validateEmptySnapshot,
  validateLessonsWithinCoverage,
} from './coverage.js';
import { deduplicateLessons } from './deduplicator.js';
import { normalizeLessons } from './normalizer.js';
import type { SyncRequestBody } from './sync.schemas.js';
import { SyncRepository } from './sync.repository.js';
import { runSyncTransaction } from './sync-transaction.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface SyncServiceDeps {
  syncRepo: SyncRepository;
  eventRepo: EventRepository;
  calendarRepo: CalendarRepository;
  deviceRepo: DeviceRepository;
  sourceIdentityRepo: SourceIdentityRepository;
}

export class SyncService {
  private readonly syncRepo: SyncRepository;
  private readonly eventRepo: EventRepository;
  private readonly calendarRepo: CalendarRepository;
  private readonly deviceRepo: DeviceRepository;
  private readonly sourceIdentityRepo: SourceIdentityRepository;

  constructor(
    private readonly db: DbClient,
    private readonly config: AppConfig,
    deps: SyncServiceDeps,
  ) {
    this.syncRepo = deps.syncRepo;
    this.eventRepo = deps.eventRepo;
    this.calendarRepo = deps.calendarRepo;
    this.deviceRepo = deps.deviceRepo;
    this.sourceIdentityRepo = deps.sourceIdentityRepo;
  }

  async sync(
    context: SyncContext,
    idempotencyKey: string,
    body: SyncRequestBody,
  ): Promise<SyncSuccessResponse> {
    if (!UUID_RE.test(idempotencyKey)) {
      throw new AppError('INVALID_REQUEST', 'Idempotency-Key must be a valid UUID.', 400);
    }

    await this.validateSourceIdentity(context.calendar, body);

    const coverage = normalizeCoverage(body.coverage);
    validateCoverageSpan(coverage, this.config.maxSyncRangeDays);
    validateEmptySnapshot(body.lessons.length, coverage, body.allowEmptySnapshot);

    const normalizedLessons = normalizeLessons(
      body.lessons,
      context.calendar.id,
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

    const mutex = getFeedMutex(context.calendar.id);
    const mutexResult = await mutex.runExclusive(async () =>
      runTransaction(this.db, async (tx) =>
        runSyncTransaction(createSyncServiceDeps(tx), this.config, {
          context,
          idempotencyKey,
          payloadHash,
          snapshotHash,
          coverage,
          lessons,
          duplicateCount,
          receivedCount: body.lessons.length,
          bodySchoolHost: body.schoolHost,
          bodyStudentRef: body.studentRef,
        }),
      ),
    );

    if (mutexResult === null) {
      throw new AppError(
        'SYNC_ALREADY_RUNNING',
        'Another sync is currently running for this calendar.',
        409,
      );
    }

    return mutexResult;
  }

  private async validateSourceIdentity(
    calendar: SyncContext['calendar'],
    body: SyncRequestBody,
  ): Promise<void> {
    if (body.timezone !== calendar.timezone) {
      throw new AppError('INVALID_TIMEZONE', 'Only Australia/Sydney is supported.', 400);
    }

    const identity = await this.sourceIdentityRepo.findByCalendarId(calendar.id);
    if (!identity) {
      return;
    }

    if (
      body.schoolHost !== identity.schoolHost ||
      body.studentRef !== identity.studentRef
    ) {
      throw new AppError(
        'SOURCE_IDENTITY_MISMATCH',
        'This device is paired with a different SEQTA student.',
        409,
      );
    }
  }
}
