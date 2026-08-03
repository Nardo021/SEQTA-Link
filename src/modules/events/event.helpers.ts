import type { EventRecord } from "../../shared/types.js";
import type { NormalizedLesson } from "../sync/sync.schemas.js";
import { isDateInCompleteCoverage } from "../sync/coverage.js";
import type { CoverageRange } from "../sync/coverage.js";
import type { FeedEventIndex } from "./event.repository.js";

export function buildInsertedEvent(input: {
  id: string;
  feedId: string;
  naturalKey: string;
  icalUid: string;
  lesson: NormalizedLesson;
  timezone: string;
  now: string;
}): EventRecord {
  return {
    id: input.id,
    feedId: input.feedId,
    naturalKey: input.naturalKey,
    icalUid: input.icalUid,
    localDate: input.lesson.date,
    periodKey: input.lesson.periodKey,
    courseCode: input.lesson.courseCode,
    title: input.lesson.title,
    startsAtUtc: input.lesson.startUtc,
    endsAtUtc: input.lesson.endUtc,
    timezone: input.timezone,
    teacher: input.lesson.teacher,
    room: input.lesson.room,
    description: input.lesson.description,
    eventType: input.lesson.type,
    contentHash: input.lesson.contentHash,
    sequence: 0,
    status: "confirmed",
    active: true,
    createdAt: input.now,
    updatedAt: input.now,
    deletedAt: null,
  };
}

export function buildUpdatedEvent(
  existing: EventRecord,
  lesson: NormalizedLesson,
  now: string,
): EventRecord {
  return {
    ...existing,
    localDate: lesson.date,
    periodKey: lesson.periodKey,
    courseCode: lesson.courseCode,
    title: lesson.title,
    startsAtUtc: lesson.startUtc,
    endsAtUtc: lesson.endUtc,
    teacher: lesson.teacher,
    room: lesson.room,
    description: lesson.description,
    eventType: lesson.type,
    contentHash: lesson.contentHash,
    sequence: existing.sequence + 1,
    status: "confirmed",
    active: true,
    deletedAt: null,
    updatedAt: now,
  };
}

export function findActiveEventsInCompleteCoverage(
  index: FeedEventIndex,
  coverage: CoverageRange[],
): EventRecord[] {
  return [...index.eventsById.values()].filter(
    (event) =>
      event.active &&
      event.status === "confirmed" &&
      isDateInCompleteCoverage(event.localDate, coverage),
  );
}
