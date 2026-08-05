from __future__ import annotations

from seqta_link.services.crypto import canonical_json_hash, sha256_hex

IDENTITY_VERSION = "v1"


def normalize_period_key(period_key: str) -> str:
    return period_key.strip().lower().replace(" ", "-")


def normalize_course_code_or_title(course_code: str | None, title: str) -> str:
    if course_code:
        return course_code
    return title.lower()


def compute_natural_key(
    feed_id: str,
    date: str,
    period_key: str,
    course_code: str | None,
    title: str,
) -> str:
    normalized_period = normalize_period_key(period_key)
    normalized_course = normalize_course_code_or_title(course_code, title)
    return sha256_hex(f"{IDENTITY_VERSION}:{feed_id}:{date}:{normalized_period}:{normalized_course}")


def compute_content_hash(fields: dict) -> str:
    return canonical_json_hash(
        {
            "courseCode": fields.get("course_code"),
            "date": fields["date"],
            "description": fields.get("description"),
            "endUtc": fields["end_utc"],
            "periodLabel": fields["period_label"],
            "room": fields.get("room"),
            "startUtc": fields["start_utc"],
            "status": fields.get("status", "confirmed"),
            "teacher": fields.get("teacher"),
            "title": fields["title"],
            "type": fields.get("type", "class"),
        }
    )
