from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from seqta_link.errors import AppError

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIME_RE = re.compile(r"^\d{2}:\d{2}:\d{2}$")


def utcnow() -> datetime:
    return datetime.utcnow()


def now_iso() -> str:
    return utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_date_parts(date: str) -> tuple[int, int, int]:
    if not DATE_RE.match(date):
        raise AppError("INVALID_DATE_RANGE", "Date must be in YYYY-MM-DD format.", 400)
    y, m, d = map(int, date.split("-"))
    return y, m, d


def parse_time_parts(time: str) -> tuple[int, int, int]:
    if not TIME_RE.match(time):
        raise AppError("INVALID_LESSON", "Time must be in HH:MM:SS format.", 400)
    h, m, s = map(int, time.split(":"))
    return h, m, s


def local_datetime_to_utc_iso(local_date: str, local_time: str, tz_name: str) -> str:
    y, mo, d = parse_date_parts(local_date)
    h, mi, s = parse_time_parts(local_time)
    tz = ZoneInfo(tz_name)
    dt = datetime(y, mo, d, h, mi, s, tzinfo=tz)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def format_ical_utc(date_iso: str) -> str:
    dt = datetime.fromisoformat(date_iso.replace("Z", "+00:00"))
    return dt.strftime("%Y%m%dT%H%M%SZ")


def format_ical_local(date_iso: str, tz_name: str) -> str:
    dt = datetime.fromisoformat(date_iso.replace("Z", "+00:00"))
    local = dt.astimezone(ZoneInfo(tz_name))
    hour = local.hour
    return local.strftime(f"%Y%m%dT{hour:02d}{local.strftime('%M%S')}")


def format_http_date(date_iso: str) -> str:
    dt = datetime.fromisoformat(date_iso.replace("Z", "+00:00"))
    return dt.strftime("%a, %d %b %Y %H:%M:%S GMT")


def days_between_inclusive(from_date: str, until_date: str) -> int:
    start = datetime.fromisoformat(f"{from_date}T00:00:00+00:00")
    end = datetime.fromisoformat(f"{until_date}T00:00:00+00:00")
    if end < start:
        raise AppError("INVALID_DATE_RANGE", "Invalid coverage date range.", 400)
    return (end.date() - start.date()).days + 1


def is_date_within_range(date: str, from_date: str, until_date: str) -> bool:
    return from_date <= date <= until_date


def format_datetime_display(value: datetime | None) -> str:
    if not value:
        return "—"
    if value.tzinfo is None:
        value = value.replace(tzinfo=ZoneInfo("UTC"))
    return value.astimezone(ZoneInfo("Australia/Sydney")).strftime("%d/%m/%Y, %I:%M:%p")


def format_date_display(value: str | None) -> str:
    if not value:
        return "—"
    dt = datetime.fromisoformat(value[:10] + "T00:00:00+00:00")
    return dt.astimezone(ZoneInfo("Australia/Sydney")).strftime("%d/%m/%Y")
