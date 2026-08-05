from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from seqta_link.errors import AppError
from seqta_link.services.dates import days_between_inclusive, is_date_within_range


@dataclass(frozen=True)
class CoverageRange:
    from_date: str
    until_date: str
    complete: bool


def normalize_coverage(coverage: list[dict[str, Any]]) -> list[CoverageRange]:
    result: list[CoverageRange] = []
    for entry in coverage:
        from_date = entry["from"]
        until_date = entry["until"]
        if from_date > until_date:
            raise AppError(
                "INVALID_DATE_RANGE",
                "Coverage from date must be on or before until date.",
                400,
            )
        result.append(
            CoverageRange(
                from_date=from_date,
                until_date=until_date,
                complete=bool(entry["complete"]),
            )
        )
    return result


def validate_lessons_within_coverage(lesson_dates: list[str], coverage: list[CoverageRange]) -> None:
    for date in lesson_dates:
        if not any(is_date_within_range(date, r.from_date, r.until_date) for r in coverage):
            raise AppError(
                "INVALID_DATE_RANGE",
                f"Lesson date {date} is outside declared coverage ranges.",
                400,
            )


def validate_empty_snapshot(
    lessons_count: int,
    coverage: list[CoverageRange],
    allow_empty_snapshot: bool | None,
) -> None:
    if lessons_count > 0:
        return
    complete_days = sum(
        days_between_inclusive(r.from_date, r.until_date) for r in coverage if r.complete
    )
    if complete_days > 7 and not allow_empty_snapshot:
        raise AppError(
            "SUSPICIOUS_EMPTY_SNAPSHOT",
            "An empty snapshot covering more than seven days requires explicit confirmation.",
            422,
        )


def get_complete_coverage_ranges(coverage: list[CoverageRange]) -> list[CoverageRange]:
    return [r for r in coverage if r.complete]


def is_date_in_complete_coverage(date: str, coverage: list[CoverageRange]) -> bool:
    return any(
        r.complete and is_date_within_range(date, r.from_date, r.until_date) for r in coverage
    )


def get_overall_range(coverage: list[CoverageRange]) -> tuple[str, str]:
    from_date = min(r.from_date for r in coverage)
    until_date = max(r.until_date for r in coverage)
    return from_date, until_date


def validate_coverage_span(coverage: list[CoverageRange], max_days: int) -> None:
    for r in coverage:
        days = days_between_inclusive(r.from_date, r.until_date)
        if days > max_days:
            raise AppError(
                "INVALID_DATE_RANGE",
                f"Coverage range exceeds maximum of {max_days} days.",
                400,
            )
