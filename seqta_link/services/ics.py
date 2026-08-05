from __future__ import annotations

import re

from seqta_link.models import Event


def escape_ical_text(value: str) -> str:
    return (
        value.replace("\\", "\\\\")
        .replace("\n", "\\n")
        .replace(",", "\\,")
        .replace(";", "\\;")
    )


def fold_ical_line(line: str) -> list[str]:
    max_len = 75
    if len(line) <= max_len:
        return [line]
    lines = [line[:max_len]]
    remaining = line[max_len:]
    while remaining:
        lines.append(" " + remaining[: max_len - 1])
        remaining = remaining[max_len - 1 :]
    return lines


def fold_ical_content(content: str) -> str:
    lines: list[str] = []
    for line in content.split("\r\n"):
        lines.extend(fold_ical_line(line))
    return "\r\n".join(lines)


def format_period_label(period_key: str) -> str:
    return "-".join(part.capitalize() for part in period_key.split("-"))


def build_event_description(event: Event) -> str:
    parts: list[str] = []
    if event.teacher:
        parts.append(f"Teacher: {event.teacher}")
    parts.append(f"Period: {format_period_label(event.period_key)}")
    if event.course_code:
        parts.append(f"Class: {event.course_code}")
    if event.description:
        parts.append(event.description)
    return "\\n".join(parts)


def format_event_summary(title: str, room: str | None) -> str:
    trimmed = (room or "").strip()
    return f"{title} {trimmed}" if trimmed else title


def build_sydney_vtimezone() -> list[str]:
    return [
        "BEGIN:VTIMEZONE",
        "TZID:Australia/Sydney",
        "BEGIN:STANDARD",
        "TZOFFSETFROM:+1100",
        "TZOFFSETTO:+1000",
        "TZNAME:AEST",
        "DTSTART:19700405T030000",
        "RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU",
        "END:STANDARD",
        "BEGIN:DAYLIGHT",
        "TZOFFSETFROM:+1000",
        "TZOFFSETTO:+1100",
        "TZNAME:AEDT",
        "DTSTART:19701004T020000",
        "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=1SU",
        "END:DAYLIGHT",
        "END:VTIMEZONE",
    ]


def serialize_events(events: list[Event], calendar_name: str, timezone: str, dt_stamp: str) -> str:
    from seqta_link.services.dates import format_ical_local, format_ical_utc, now_iso

    sorted_events = sorted(events, key=lambda e: (e.starts_at_utc, e.ical_uid))
    stamp = format_ical_utc(dt_stamp or now_iso())
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Leoze//Seqta Link//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{escape_ical_text(calendar_name)}",
        f"X-WR-TIMEZONE:{escape_ical_text(timezone)}",
        "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
        "X-PUBLISHED-TTL:PT1H",
        *build_sydney_vtimezone(),
    ]

    for event in sorted_events:
        status = "CANCELLED" if event.status == "cancelled" else "CONFIRMED"
        created = format_ical_utc(
            event.created_at.isoformat().replace("+00:00", "Z")
            if hasattr(event.created_at, "isoformat")
            else str(event.created_at)
        )
        modified = format_ical_utc(
            event.updated_at.isoformat().replace("+00:00", "Z")
            if hasattr(event.updated_at, "isoformat")
            else str(event.updated_at)
        )
        dt_start = format_ical_local(event.starts_at_utc, timezone)
        dt_end = format_ical_local(event.ends_at_utc, timezone)
        summary = format_event_summary(event.title, event.room)
        description = build_event_description(event)

        lines.extend(
            [
                "BEGIN:VEVENT",
                f"UID:{escape_ical_text(event.ical_uid)}",
                f"DTSTAMP:{stamp}",
                f"CREATED:{created}",
                f"LAST-MODIFIED:{modified}",
                f"SEQUENCE:{event.sequence}",
                f"DTSTART;TZID={timezone}:{dt_start}",
                f"DTEND;TZID={timezone}:{dt_end}",
                f"SUMMARY:{escape_ical_text(summary)}",
            ]
        )
        if event.room:
            lines.append(f"LOCATION:{escape_ical_text(event.room)}")
        lines.extend(
            [
                f"DESCRIPTION:{escape_ical_text(description)}",
                f"STATUS:{status}",
                "TRANSP:OPAQUE",
                "END:VEVENT",
            ]
        )

    lines.extend(["END:VCALENDAR", ""])
    return fold_ical_content("\r\n".join(lines))
