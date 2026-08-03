import type { EventRecord } from "../../shared/types.js";
import type { NormalizedLesson } from "../sync/sync.schemas.js";

export type LessonAction =
  | { kind: "insert" }
  | { kind: "restore"; event: EventRecord }
  | { kind: "update"; event: EventRecord }
  | { kind: "unchanged"; event: EventRecord };

export function resolveLessonAction(
  event: EventRecord | null,
  lesson: NormalizedLesson,
): LessonAction {
  if (!event) {
    return { kind: "insert" };
  }
  if (event.status === "cancelled" || !event.active) {
    return { kind: "restore", event };
  }
  if (event.contentHash === lesson.contentHash) {
    return { kind: "unchanged", event };
  }
  return { kind: "update", event };
}
