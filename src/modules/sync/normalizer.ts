import { localDateTimeToUtcIso } from '../../shared/dates.js';
import { AppError } from '../../shared/errors.js';
import { computeContentHash, computeNaturalKey, normalizePeriodKey } from './identity.js';
import type { SyncLessonInput } from './sync.schemas.js';
import type { NormalizedLesson } from './sync.schemas.js';

const MAX_LESSON_DURATION_MS = 8 * 60 * 60 * 1000;

export function normalizeString(value: string | undefined | null): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeCourseCode(courseCode: string | undefined): string | null {
  const normalized = normalizeString(courseCode ?? null);
  return normalized ? normalized.toUpperCase() : null;
}

export function normalizeTitle(title: string): string {
  const normalized = normalizeString(title);
  if (!normalized) {
    throw new AppError('INVALID_LESSON', 'Lesson title is required.', 400);
  }
  return normalized;
}

export function normalizeLesson(
  lesson: SyncLessonInput,
  feedId: string,
  timezone: string,
): NormalizedLesson {
  const title = normalizeTitle(lesson.title);
  const courseCode = normalizeCourseCode(lesson.courseCode);
  const periodKey = normalizePeriodKey(lesson.periodKey);
  const periodLabel = normalizeString(lesson.periodLabel) ?? lesson.periodLabel.trim();
  const teacher = normalizeString(lesson.teacher);
  const room = normalizeString(lesson.room);
  const description = normalizeString(lesson.description);
  const sourceKey = lesson.sourceKey.trim();

  const startUtc = localDateTimeToUtcIso(lesson.date, lesson.start, timezone);
  const endUtc = localDateTimeToUtcIso(lesson.date, lesson.end, timezone);

  const startMs = Date.parse(startUtc);
  const endMs = Date.parse(endUtc);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
    throw new AppError(
      'INVALID_TIME_RANGE',
      'The lesson end time must be later than its start time.',
      400,
    );
  }
  if (endMs - startMs > MAX_LESSON_DURATION_MS) {
    throw new AppError('INVALID_LESSON', 'A single lesson cannot exceed eight hours.', 400);
  }

  const naturalKey = computeNaturalKey(feedId, lesson.date, periodKey, courseCode, title);
  const contentHash = computeContentHash({
    date: lesson.date,
    startUtc,
    endUtc,
    title,
    courseCode,
    periodLabel,
    teacher,
    room,
    description,
    type: lesson.type,
    status: 'confirmed',
  });

  return {
    sourceKey,
    date: lesson.date,
    periodKey,
    periodLabel,
    courseCode,
    title,
    teacher,
    room,
    description,
    start: lesson.start,
    end: lesson.end,
    startUtc,
    endUtc,
    type: lesson.type,
    naturalKey,
    contentHash,
  };
}

export function normalizeLessons(
  lessons: SyncLessonInput[],
  feedId: string,
  timezone: string,
): NormalizedLesson[] {
  return lessons.map((lesson) => normalizeLesson(lesson, feedId, timezone));
}
