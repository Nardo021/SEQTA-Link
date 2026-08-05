from __future__ import annotations

import json
import re
import threading
from collections import defaultdict

from seqta_link.config import Config
from seqta_link.errors import AppError
from seqta_link.extensions import db
from seqta_link.models import Calendar, Device, Event, EventAlias, SourceIdentity, SyncRun, User
from seqta_link.models import new_id, utcnow
from seqta_link.services.crypto import generate_ical_uid, sha256_hex
from seqta_link.services.dates import now_iso
from seqta_link.services.sync.coverage import (
    CoverageRange,
    get_overall_range,
    is_date_in_complete_coverage,
    normalize_coverage,
    validate_coverage_span,
    validate_empty_snapshot,
    validate_lessons_within_coverage,
)
from seqta_link.services.sync.deduplicator import deduplicate_lessons
from seqta_link.services.sync.lesson_actions import resolve_lesson_action
from seqta_link.services.sync.normalizer import NormalizedLesson, normalize_lessons

UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.I,
)

_feed_locks: dict[str, threading.Lock] = defaultdict(threading.Lock)


class SyncService:
    def __init__(self, config: Config):
        self.config = config

    def sync(
        self,
        user: User,
        calendar: Calendar,
        device: Device,
        idempotency_key: str,
        body: dict,
    ) -> dict:
        if not UUID_RE.match(idempotency_key):
            raise AppError("INVALID_REQUEST", "Idempotency-Key must be a valid UUID.", 400)

        self._validate_source_identity(calendar, body)

        coverage = normalize_coverage(body["coverage"])
        validate_coverage_span(coverage, self.config.max_sync_range_days)
        validate_empty_snapshot(
            len(body.get("lessons", [])),
            coverage,
            body.get("allowEmptySnapshot"),
        )

        normalized = normalize_lessons(body["lessons"], calendar.id, body["timezone"])
        validate_lessons_within_coverage([l.date for l in normalized], coverage)

        deduped = deduplicate_lessons(normalized)
        payload_hash = sha256_hex(json.dumps(body, sort_keys=True))
        snapshot_hash = sha256_hex(
            json.dumps(
                {
                    "coverage": [
                        {"from": r.from_date, "until": r.until_date, "complete": r.complete}
                        for r in coverage
                    ],
                    "lessons": [
                        {
                            "sourceKey": l.source_key,
                            "naturalKey": l.natural_key,
                            "contentHash": l.content_hash,
                        }
                        for l in deduped.lessons
                    ],
                },
                sort_keys=True,
            )
        )

        lock = _feed_locks[calendar.id]
        if not lock.acquire(blocking=False):
            raise AppError(
                "SYNC_ALREADY_RUNNING",
                "Another sync is currently running for this calendar.",
                409,
            )
        try:
            return self._run_sync(
                user,
                calendar,
                device,
                idempotency_key,
                body,
                coverage,
                deduped.lessons,
                deduped.duplicate_count,
                payload_hash,
                snapshot_hash,
            )
        finally:
            lock.release()

    def _validate_source_identity(self, calendar: Calendar, body: dict) -> None:
        if body.get("timezone") != calendar.timezone:
            raise AppError("INVALID_TIMEZONE", "Only Australia/Sydney is supported.", 400)
        identity = SourceIdentity.query.filter_by(calendar_id=calendar.id).first()
        if not identity:
            return
        if (
            body.get("schoolHost") != identity.school_host
            or body.get("studentRef") != identity.student_ref
        ):
            raise AppError(
                "SOURCE_IDENTITY_MISMATCH",
                "This device is paired with a different SEQTA student.",
                409,
            )

    def _run_sync(
        self,
        user: User,
        calendar: Calendar,
        device: Device,
        idempotency_key: str,
        body: dict,
        coverage: list[CoverageRange],
        lessons: list[NormalizedLesson],
        duplicate_count: int,
        payload_hash: str,
        snapshot_hash: str,
    ) -> dict:
        existing = SyncRun.query.filter_by(
            device_id=device.id, idempotency_key=idempotency_key
        ).first()
        if existing:
            if existing.payload_hash != payload_hash or existing.snapshot_hash != snapshot_hash:
                raise AppError(
                    "IDEMPOTENCY_KEY_REUSED",
                    "The idempotency key has already been used with another payload.",
                    409,
                )
            return self._replay_response(existing)

        sync_run_id = new_id()
        now = utcnow()
        now_str = now_iso()
        range_from, range_until = get_overall_range(coverage)

        sync_run = SyncRun(
            id=sync_run_id,
            owner_user_id=user.id,
            calendar_id=calendar.id,
            device_id=device.id,
            idempotency_key=idempotency_key,
            payload_hash=payload_hash,
            snapshot_hash=snapshot_hash,
            range_from=range_from,
            range_until=range_until,
            received_count=len(body.get("lessons", [])),
            normalized_count=len(lessons),
            duplicate_count=duplicate_count,
            status="running",
            started_at=now,
        )
        db.session.add(sync_run)

        counts = {
            "received": len(body.get("lessons", [])),
            "normalized": len(lessons),
            "duplicatesRemoved": duplicate_count,
            "inserted": 0,
            "updated": 0,
            "removed": 0,
            "restored": 0,
            "unchanged": 0,
        }

        events = Event.query.filter_by(calendar_id=calendar.id).all()
        events_by_id = {e.id: e for e in events}
        events_by_natural = {e.natural_key: e for e in events}
        aliases = EventAlias.query.filter_by(calendar_id=calendar.id).all()
        aliases_by_source = {a.source_key: a.event_id for a in aliases}
        seen_event_ids: set[str] = set()

        for lesson in lessons:
            event_id = aliases_by_source.get(lesson.source_key)
            event = events_by_id.get(event_id) if event_id else None
            if event is None:
                event = events_by_natural.get(lesson.natural_key)

            action = resolve_lesson_action(event, lesson)

            if action["kind"] == "insert":
                event_id = new_id()
                ical_uid = generate_ical_uid(self.config.uid_secret, calendar.id, event_id)
                new_event = Event(
                    id=event_id,
                    owner_user_id=user.id,
                    calendar_id=calendar.id,
                    natural_key=lesson.natural_key,
                    ical_uid=ical_uid,
                    local_date=lesson.date,
                    period_key=lesson.period_key,
                    course_code=lesson.course_code,
                    title=lesson.title,
                    starts_at_utc=lesson.start_utc,
                    ends_at_utc=lesson.end_utc,
                    timezone=calendar.timezone,
                    teacher=lesson.teacher,
                    room=lesson.room,
                    description=lesson.description,
                    event_type=lesson.type,
                    content_hash=lesson.content_hash,
                    sequence=0,
                    status="confirmed",
                    active=True,
                    created_at=now,
                    updated_at=now,
                )
                db.session.add(new_event)
                self._upsert_alias(calendar.id, lesson.source_key, event_id, now)
                events_by_id[event_id] = new_event
                events_by_natural[lesson.natural_key] = new_event
                aliases_by_source[lesson.source_key] = event_id
                seen_event_ids.add(event_id)
                counts["inserted"] += 1
                continue

            existing_event: Event = action["event"]
            self._upsert_alias(calendar.id, lesson.source_key, existing_event.id, now)
            aliases_by_source[lesson.source_key] = existing_event.id
            seen_event_ids.add(existing_event.id)

            if action["kind"] in ("restore", "update"):
                self._apply_lesson(existing_event, lesson, now)
                if action["kind"] == "restore":
                    counts["restored"] += 1
                else:
                    counts["updated"] += 1
            else:
                counts["unchanged"] += 1

        for event in events_by_id.values():
            if not event.active or event.status != "confirmed":
                continue
            if not is_date_in_complete_coverage(event.local_date, coverage):
                continue
            if event.id in seen_event_ids:
                continue
            event.status = "cancelled"
            event.active = False
            event.deleted_at = now
            event.updated_at = now
            event.sequence += 1
            counts["removed"] += 1

        changed = (
            counts["inserted"] + counts["updated"] + counts["removed"] + counts["restored"] > 0
        )
        revision = calendar.revision
        if changed:
            calendar.revision += 1
            calendar.last_changed_at = now

        calendar.last_synced_at = now
        calendar.updated_at = now
        device.last_synced_at = now
        device.last_seen_at = now

        sync_run.inserted_count = counts["inserted"]
        sync_run.updated_count = counts["updated"]
        sync_run.removed_count = counts["removed"]
        sync_run.restored_count = counts["restored"]
        sync_run.unchanged_count = counts["unchanged"]
        sync_run.status = "success"
        sync_run.completed_at = now

        identity = SourceIdentity.query.filter_by(calendar_id=calendar.id).first()
        if not identity:
            db.session.add(
                SourceIdentity(
                    calendar_id=calendar.id,
                    school_host=body["schoolHost"],
                    student_ref=body["studentRef"],
                    locked_at=now,
                )
            )

        db.session.commit()

        return {
            "syncId": sync_run_id,
            "revision": calendar.revision,
            "changed": changed,
            "result": counts,
            "lastSyncedAt": now_str,
        }

    def _upsert_alias(
        self, calendar_id: str, source_key: str, event_id: str, now
    ) -> None:
        alias = EventAlias.query.filter_by(calendar_id=calendar_id, source_key=source_key).first()
        if alias:
            alias.event_id = event_id
            alias.last_seen_at = now
        else:
            db.session.add(
                EventAlias(
                    calendar_id=calendar_id,
                    source_key=source_key,
                    event_id=event_id,
                    first_seen_at=now,
                    last_seen_at=now,
                )
            )

    def _apply_lesson(self, event: Event, lesson: NormalizedLesson, now) -> None:
        event.local_date = lesson.date
        event.period_key = lesson.period_key
        event.course_code = lesson.course_code
        event.title = lesson.title
        event.starts_at_utc = lesson.start_utc
        event.ends_at_utc = lesson.end_utc
        event.teacher = lesson.teacher
        event.room = lesson.room
        event.description = lesson.description
        event.event_type = lesson.type
        event.content_hash = lesson.content_hash
        event.sequence += 1
        event.status = "confirmed"
        event.active = True
        event.deleted_at = None
        event.updated_at = now

    def _replay_response(self, run: SyncRun) -> dict:
        calendar = Calendar.query.get(run.calendar_id)
        changed = (
            run.inserted_count + run.updated_count + run.removed_count + run.restored_count > 0
        )
        return {
            "syncId": run.id,
            "replayed": True,
            "revision": calendar.revision if calendar else 0,
            "changed": changed,
            "result": {
                "received": run.received_count,
                "normalized": run.normalized_count,
                "duplicatesRemoved": run.duplicate_count,
                "inserted": run.inserted_count,
                "updated": run.updated_count,
                "removed": run.removed_count,
                "restored": run.restored_count,
                "unchanged": run.unchanged_count,
            },
        }
