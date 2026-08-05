from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from seqta_link.errors import AppError
from seqta_link.services.dates import local_datetime_to_utc_iso
from seqta_link.services.sync.identity import (
    compute_content_hash,
    compute_natural_key,
    normalize_period_key,
)

MAX_LESSON_DURATION_MS = 8 * 60 * 60 * 1000


def normalize_string(value: str | None) -> str | None:
    if value is None:
        return None
    trimmed = " ".join(value.strip().split())
    return trimmed if trimmed else None


def normalize_course_code(course_code: str | None) -> str | None:
    normalized = normalize_string(course_code)
    return normalized.upper() if normalized else None


def normalize_title(title: str) -> str:
    normalized = normalize_string(title)
    if not normalized:
        raise AppError("INVALID_LESSON", "Lesson title is required.", 400)
    return normalized


@dataclass
class NormalizedLesson:
    source_key: str
    date: str
    period_key: str
    period_label: str
    course_code: str | None
    title: str
    teacher: str | None
    room: str | None
    description: str | None
    start: str
    end: str
    start_utc: str
    end_utc: str
    type: str
    natural_key: str
    content_hash: str


def normalize_lesson(lesson: dict[str, Any], feed_id: str, timezone: str) -> NormalizedLesson:
    title = normalize_title(lesson["title"])
    course_code = normalize_course_code(lesson.get("courseCode"))
    period_key = normalize_period_key(lesson["periodKey"])
    period_label = normalize_string(lesson.get("periodLabel")) or lesson["periodLabel"].strip()
    teacher = normalize_string(lesson.get("teacher"))
    room = normalize_string(lesson.get("room"))
    description = normalize_string(lesson.get("description"))
    source_key = lesson["sourceKey"].strip()

    start_utc = local_datetime_to_utc_iso(lesson["date"], lesson["start"], timezone)
    end_utc = local_datetime_to_utc_iso(lesson["date"], lesson["end"], timezone)

    from datetime import datetime

    start_ms = datetime.fromisoformat(start_utc.replace("Z", "+00:00")).timestamp() * 1000
    end_ms = datetime.fromisoformat(end_utc.replace("Z", "+00:00")).timestamp() * 1000
    if end_ms <= start_ms:
        raise AppError(
            "INVALID_TIME_RANGE",
            "The lesson end time must be later than its start time.",
            400,
        )
    if end_ms - start_ms > MAX_LESSON_DURATION_MS:
        raise AppError("INVALID_LESSON", "A single lesson cannot exceed eight hours.", 400)

    natural_key = compute_natural_key(feed_id, lesson["date"], period_key, course_code, title)
    content_hash = compute_content_hash(
        {
            "date": lesson["date"],
            "start_utc": start_utc,
            "end_utc": end_utc,
            "title": title,
            "course_code": course_code,
            "period_label": period_label,
            "teacher": teacher,
            "room": room,
            "description": description,
            "type": lesson.get("type", "class"),
            "status": "confirmed",
        }
    )

    return NormalizedLesson(
        source_key=source_key,
        date=lesson["date"],
        period_key=period_key,
        period_label=period_label,
        course_code=course_code,
        title=title,
        teacher=teacher,
        room=room,
        description=description,
        start=lesson["start"],
        end=lesson["end"],
        start_utc=start_utc,
        end_utc=end_utc,
        type=lesson.get("type", "class"),
        natural_key=natural_key,
        content_hash=content_hash,
    )


def normalize_lessons(
    lessons: list[dict[str, Any]], feed_id: str, timezone: str
) -> list[NormalizedLesson]:
    return [normalize_lesson(lesson, feed_id, timezone) for lesson in lessons]
