from seqta_link.services.dates import local_datetime_to_utc_iso
from seqta_link.services.sync.deduplicator import deduplicate_lessons
from seqta_link.services.sync.identity import compute_content_hash, compute_natural_key
from seqta_link.services.sync.normalizer import normalize_lesson


def test_normalize_course_code():
    lesson = {
        "sourceKey": "2026-08-05|period-2|1575659",
        "date": "2026-08-05",
        "periodKey": "Period-2",
        "periodLabel": "Period 2",
        "courseCode": "11mus",
        "title": "Music 1",
        "teacher": "Mr Example",
        "room": "M202",
        "start": "09:35:00",
        "end": "10:30:00",
        "type": "class",
    }
    normalized = normalize_lesson(lesson, "feed-1", "Australia/Sydney")
    assert normalized.course_code == "11MUS"
    assert normalized.period_key == "period-2"


def test_natural_key_stable():
    a = compute_natural_key("feed-1", "2026-08-05", "period-2", "11MUS", "Music 1")
    b = compute_natural_key("feed-1", "2026-08-05", "period-2", "11MUS", "Music 1")
    assert a == b


def test_content_hash_hex():
    lesson = {
        "sourceKey": "k",
        "date": "2026-08-05",
        "periodKey": "Period-2",
        "periodLabel": "Period 2",
        "courseCode": "11mus",
        "title": "Music 1",
        "start": "09:35:00",
        "end": "10:30:00",
        "type": "class",
    }
    normalized = normalize_lesson(lesson, "feed-1", "Australia/Sydney")
    h = compute_content_hash(
        {
            "date": normalized.date,
            "start_utc": normalized.start_utc,
            "end_utc": normalized.end_utc,
            "title": normalized.title,
            "course_code": normalized.course_code,
            "period_label": normalized.period_label,
            "teacher": normalized.teacher,
            "room": normalized.room,
            "description": normalized.description,
            "type": normalized.type,
            "status": "confirmed",
        }
    )
    assert len(h) == 64


def test_deduplicate_source_keys():
    lesson = {
        "sourceKey": "2026-08-05|period-2|1575659",
        "date": "2026-08-05",
        "periodKey": "Period-2",
        "periodLabel": "Period 2",
        "courseCode": "11mus",
        "title": "Music 1",
        "start": "09:35:00",
        "end": "10:30:00",
        "type": "class",
    }
    normalized = normalize_lesson(lesson, "feed-1", "Australia/Sydney")
    result = deduplicate_lessons([normalized, normalized])
    assert len(result.lessons) == 1
    assert result.duplicate_count == 1


def test_sydney_to_utc():
    utc = local_datetime_to_utc_iso("2026-08-05", "09:35:00", "Australia/Sydney")
    assert utc == "2026-08-04T23:35:00Z"


def test_login_and_dashboard(client, owner):
    resp = client.post(
        "/app/login",
        data={"email": "owner@test.local", "password": "OwnerPass123!"},
        follow_redirects=False,
    )
    assert resp.status_code == 302
    resp = client.get("/app/dashboard")
    assert resp.status_code == 200
    assert b"Dashboard" in resp.data
