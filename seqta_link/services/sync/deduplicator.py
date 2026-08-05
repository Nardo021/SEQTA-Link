from __future__ import annotations

from dataclasses import dataclass

from seqta_link.errors import AppError
from seqta_link.services.sync.normalizer import NormalizedLesson


@dataclass
class DeduplicationResult:
    lessons: list[NormalizedLesson]
    duplicate_count: int


def deduplicate_lessons(lessons: list[NormalizedLesson]) -> DeduplicationResult:
    by_source: dict[str, NormalizedLesson] = {}
    duplicate_count = 0

    for lesson in lessons:
        if lesson.source_key in by_source:
            duplicate_count += 1
            continue
        by_source[lesson.source_key] = lesson

    by_natural: dict[str, list[NormalizedLesson]] = {}
    for lesson in by_source.values():
        by_natural.setdefault(lesson.natural_key, []).append(lesson)

    result: list[NormalizedLesson] = []
    for natural_key, group in by_natural.items():
        if len(group) == 1:
            result.append(group[0])
            continue
        first = group[0]
        if all(l.content_hash == first.content_hash for l in group):
            result.append(first)
            duplicate_count += len(group) - 1
            continue
        raise AppError(
            "DUPLICATE_LESSON_CONFLICT",
            "Two lessons resolve to the same timetable slot but contain conflicting data.",
            409,
            {"naturalKey": natural_key, "sourceKeys": [l.source_key for l in group]},
        )

    return DeduplicationResult(lessons=result, duplicate_count=duplicate_count)
