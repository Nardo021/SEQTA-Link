from __future__ import annotations

from typing import Literal

from seqta_link.models import Event
from seqta_link.services.sync.normalizer import NormalizedLesson


LessonAction = (
    dict[Literal["kind"], Literal["insert"]]
    | dict[Literal["kind", "event"], Literal["restore", "update", "unchanged"] | Event]
)


def resolve_lesson_action(event: Event | None, lesson: NormalizedLesson) -> dict:
    if event is None:
        return {"kind": "insert"}
    if event.status == "cancelled" or not event.active:
        return {"kind": "restore", "event": event}
    if event.content_hash == lesson.content_hash:
        return {"kind": "unchanged", "event": event}
    return {"kind": "update", "event": event}
