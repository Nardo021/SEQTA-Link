from __future__ import annotations

from flask import Blueprint, Response, request, current_app

from seqta_link.errors import AppError
from seqta_link.models import Event
from seqta_link.services.auth import AuthService
from seqta_link.services.dates import format_http_date, now_iso
from seqta_link.services.ics import serialize_events

bp = Blueprint("calendar_feed", __name__)


@bp.get("/calendar/<token>")
def calendar_feed(token: str):
    raw = token[:-4] if token.endswith(".ics") else token
    auth = AuthService(current_app.config["APP_CONFIG"])
    try:
        _, calendar, user = auth.resolve_calendar_token(raw)
    except AppError as e:
        if e.status == 410:
            return Response(e.message, status=410, mimetype="text/plain")
        return Response(status=404)

    etag = f'"calendar-{calendar.revision}"'
    if_none = request.headers.get("If-None-Match", "")
    if if_none.strip('"') == etag.strip('"') or if_none == etag:
        return Response(status=304)

    events = Event.query.filter_by(calendar_id=calendar.id).filter(
        (Event.active == True) | (Event.status == "cancelled")  # noqa: E712
    ).all()
    body = serialize_events(events, calendar.name, calendar.timezone, now_iso())
    last_mod = calendar.last_changed_at or calendar.updated_at
    resp = Response(body, content_type="text/calendar; charset=utf-8")
    resp.headers["Cache-Control"] = "private, no-cache, max-age=0, must-revalidate"
    resp.headers["ETag"] = etag
    if last_mod:
        resp.headers["Last-Modified"] = format_http_date(
            last_mod.isoformat() if hasattr(last_mod, "isoformat") else str(last_mod)
        )
    return resp
