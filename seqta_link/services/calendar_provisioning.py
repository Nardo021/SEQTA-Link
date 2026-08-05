from __future__ import annotations

from seqta_link.config import Config
from seqta_link.extensions import db
from seqta_link.models import Calendar, CalendarToken, User, new_id
from seqta_link.services.crypto import generate_raw_token, hash_token


def provision_user_calendar(user: User, config: Config) -> Calendar:
    existing = Calendar.query.filter_by(owner_user_id=user.id).first()
    if existing:
        return existing

    calendar = Calendar(
        id=new_id(),
        owner_user_id=user.id,
        name=f"{user.display_name}'s Timetable",
        timezone="Australia/Sydney",
    )
    db.session.add(calendar)
    raw = generate_raw_token("calendar")
    db.session.add(
        CalendarToken(
            id=new_id(),
            calendar_id=calendar.id,
            token_hash=hash_token(config.token_pepper, "calendar", raw),
            token_prefix=raw[:12],
            status="active",
        )
    )
    db.session.commit()
    return calendar
