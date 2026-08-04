import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveLessonAction } from "../../src/modules/sync/lesson-actions.js";
import type { EventRecord } from "../../src/shared/types.js";

const baseEvent: EventRecord = {
  id: "event-1",
  ownerUserId: "user-1",
  calendarId: "calendar-1",
  naturalKey: "nk-1",
  icalUid: "uid@timetable.leoze.top",
  localDate: "2026-08-05",
  periodKey: "period-2",
  courseCode: "11MUS",
  title: "Music 1",
  startsAtUtc: "2026-08-04T23:35:00.000Z",
  endsAtUtc: "2026-08-05T00:30:00.000Z",
  timezone: "Australia/Sydney",
  teacher: "Mr Example",
  room: "M202",
  description: null,
  eventType: "class",
  contentHash: "hash-a",
  sequence: 0,
  status: "confirmed",
  active: true,
  createdAt: "2026-08-04T00:00:00.000Z",
  updatedAt: "2026-08-04T00:00:00.000Z",
  deletedAt: null,
};

const baseLesson = {
  sourceKey: "2026-08-05|period-2|1575659",
  date: "2026-08-05",
  periodKey: "period-2",
  periodLabel: "Period 2",
  courseCode: "11MUS",
  title: "Music 1",
  teacher: "Mr Example",
  room: "M202",
  description: null,
  start: "09:35:00",
  end: "10:30:00",
  startUtc: "2026-08-04T23:35:00.000Z",
  endUtc: "2026-08-05T00:30:00.000Z",
  type: "class" as const,
  naturalKey: "nk-1",
  contentHash: "hash-a",
};

describe("lesson actions", () => {
  it("inserts when no existing event", () => {
    assert.equal(resolveLessonAction(null, baseLesson).kind, "insert");
  });

  it("restores cancelled events", () => {
    const cancelled = {
      ...baseEvent,
      status: "cancelled" as const,
      active: false,
    };
    const action = resolveLessonAction(cancelled, baseLesson);
    assert.equal(action.kind, "restore");
    if (action.kind === "restore") {
      assert.equal(action.event.id, cancelled.id);
    }
  });

  it("skips unchanged events", () => {
    const action = resolveLessonAction(baseEvent, baseLesson);
    assert.equal(action.kind, "unchanged");
    if (action.kind === "unchanged") {
      assert.equal(action.event.id, baseEvent.id);
    }
  });

  it("updates when content hash differs", () => {
    const action = resolveLessonAction(baseEvent, {
      ...baseLesson,
      contentHash: "hash-b",
      teacher: "Ms New",
    });
    assert.equal(action.kind, "update");
    if (action.kind === "update") {
      assert.equal(action.event.id, baseEvent.id);
    }
  });
});
