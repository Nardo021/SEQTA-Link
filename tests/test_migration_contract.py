"""External contracts that must survive the Workers + D1 migration.

Synthetic users/tokens only. Do not use production credentials or DB files.
"""
from datetime import datetime

from seqta_link.extensions import db
from seqta_link.models import Calendar, CalendarToken, Event, User, new_id
from seqta_link.services.crypto import generate_ical_uid, hash_token


def test_crypto_migration_vectors():
    """Cross-runtime implementations must produce these exact bytes."""
    raw = "sl_cal_fixture_please_do_not_use_as_secret"
    assert hash_token(b"x" * 32, "calendar", raw) == (
        "6476eb6b120207962d91aca225a38bc4dc2efa68b2621f6c393494f7c4be63f0"
    )
    assert hash_token(b"x" * 32, "device", "sl_dvc_fixture") == (
        "abe94f4d7ac51798148861957e78336b032bf6e85c7d85a8c9ff849c97080086"
    )
    assert generate_ical_uid(b"y" * 32, "cal-fixed-01", "evt-fixed-01") == (
        "TU3ivCe5WD3fTmf9vAprFaHSm5WszzJ_qOufOht6yPs@seqta.link"
    )


def test_ics_subscription_http_contract(app, client, owner):
    """Verify 200, 304, 404, 410 and inclusion of cancelled events."""
    raw = "sl_cal_synthetic_contract_test_token"
    with app.app_context():
        user = User.query.filter_by(email="owner@test.local").one()
        cal = Calendar.query.filter_by(owner_user_id=user.id).one()
        cal.revision = 7
        cal.last_changed_at = datetime(2026, 11, 24, 0, 0, 0)

        token = CalendarToken(
            id=new_id(),
            calendar_id=cal.id,
            token_hash=hash_token(app.config["APP_CONFIG"].token_pepper, "calendar", raw),
            token_prefix=raw[:12],
            status="active",
        )
        db.session.add(token)

        for event_id, status, active, title in [
            ("contract-evt-1", "confirmed", True, "Synthetic lesson"),
            ("contract-evt-2", "cancelled", False, "Cancelled synthetic lesson"),
        ]:
            db.session.add(Event(
                id=event_id,
                owner_user_id=user.id,
                calendar_id=cal.id,
                natural_key="natural-" + event_id,
                ical_uid=generate_ical_uid(
                    app.config["APP_CONFIG"].uid_secret, cal.id, event_id
                ),
                local_date="2026-11-24",
                period_key="period-1",
                course_code="TEST",
                title=title,
                starts_at_utc="2026-11-23T22:00:00Z",
                ends_at_utc="2026-11-23T23:00:00Z",
                timezone="Australia/Sydney",
                event_type="class",
                content_hash="a" * 64,
                status=status,
                active=active,
            ))
        db.session.commit()

    path = "/calendar/" + raw + ".ics"
    response = client.get(path)
    assert response.status_code == 200
    assert response.headers["Content-Type"] == "text/calendar; charset=utf-8"
    assert response.headers["ETag"] == '"calendar-7"'
    assert "private" in response.headers["Cache-Control"]
    body = response.get_data(as_text=True)
    assert body.startswith("BEGIN:VCALENDAR")
    assert body.count("BEGIN:VEVENT") == 2
    assert "STATUS:CONFIRMED" in body
    assert "STATUS:CANCELLED" in body
    assert body.endswith("END:VCALENDAR\r\n")

    not_modified = client.get(path, headers={"If-None-Match": '"calendar-7"'})
    assert not_modified.status_code == 304

    invalid = client.get("/calendar/sl_cal_unknown_test_token.ics")
    assert invalid.status_code == 404

    with app.app_context():
        user = User.query.filter_by(email="owner@test.local").one()
        user.feed_enabled = False
        db.session.commit()
    disabled = client.get(path)
    assert disabled.status_code == 410

    with app.app_context():
        user = User.query.filter_by(email="owner@test.local").one()
        user.feed_enabled = True
        record = CalendarToken.query.filter_by(
            token_hash=hash_token(app.config["APP_CONFIG"].token_pepper, "calendar", raw)
        ).one()
        record.status = "revoked"
        db.session.commit()
    revoked = client.get(path)
    assert revoked.status_code == 404
