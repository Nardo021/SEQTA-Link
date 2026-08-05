from __future__ import annotations

import json
from datetime import timedelta

from flask import Blueprint, flash, redirect, render_template, request, url_for, current_app

from seqta_link.errors import AppError
from seqta_link.extensions import db
from seqta_link.models import Event, SyncRun, User, utcnow
from seqta_link.services.auth import get_current_user, login_required
from seqta_link.services.dates import format_datetime_display
from seqta_link.services.pairing import PairingService

bp = Blueprint("pages_app", __name__, url_prefix="/app")


def _calendar_for(user: User):
    from seqta_link.models import Calendar

    cal = Calendar.query.filter_by(owner_user_id=user.id).first()
    if not cal:
        from seqta_link.errors import AppError

        raise AppError("INVALID_REQUEST", "Calendar not found.", 404)
    return cal


@bp.get("/")
@login_required
def index():
    from flask import redirect, url_for

    return redirect(url_for("pages_app.dashboard"))


@bp.get("/dashboard")
@login_required
def dashboard():
    from flask import render_template

    user = get_current_user()
    cal = _calendar_for(user)
    active_events = Event.query.filter_by(calendar_id=cal.id, active=True, status="confirmed").count()
    from seqta_link.models import Device

    devices = Device.query.filter_by(owner_user_id=user.id, status="active").count()
    last_run = (
        SyncRun.query.filter_by(calendar_id=cal.id)
        .order_by(SyncRun.started_at.desc())
        .first()
    )
    from seqta_link.models import SourceIdentity

    identity = SourceIdentity.query.filter_by(calendar_id=cal.id).first()
    return render_template(
        "app/dashboard.html",
        user=user,
        calendar=cal,
        active_events=active_events,
        devices=devices,
        max_devices=user.max_devices,
        last_run=last_run,
        identity=identity,
        format_dt=format_datetime_display,
    )


@bp.get("/timetable")
@login_required
def timetable():
    from flask import render_template, request

    user = get_current_user()
    cal = _calendar_for(user)
    from_date = request.args.get("from", "")
    until_date = request.args.get("until", "")
    query = Event.query.filter_by(calendar_id=cal.id, active=True).order_by(Event.starts_at_utc)
    if from_date:
        query = query.filter(Event.local_date >= from_date)
    if until_date:
        query = query.filter(Event.local_date <= until_date)
    events = query.limit(500).all()
    return render_template(
        "app/timetable.html",
        user=user,
        events=events,
        from_date=from_date,
        until_date=until_date,
        format_dt=format_datetime_display,
    )


@bp.get("/calendar")
@login_required
def calendar_page():
    from flask import render_template

    user = get_current_user()
    cal = _calendar_for(user)
    from seqta_link.models import CalendarToken

    token = CalendarToken.query.filter_by(calendar_id=cal.id, status="active").first()
    return render_template(
        "app/calendar.html",
        user=user,
        calendar=cal,
        token_prefix=token.token_prefix if token else None,
        feed_enabled=user.feed_enabled,
    )


@bp.post("/calendar/rotate")
@login_required
def rotate_calendar():
    from flask import flash, redirect, url_for

    from seqta_link.services.auth import AuthService

    user = get_current_user()
    if not user.feed_enabled:
        flash("Calendar feed is disabled.", "error")
        return redirect(url_for("pages_app.calendar_page"))
    cal = _calendar_for(user)
    auth = AuthService(current_app.config["APP_CONFIG"])
    raw = auth.rotate_calendar_token(cal.id)
    url = f"{current_app.config['APP_CONFIG'].public_base_url}/calendar/{raw}.ics"
    flash(f"New subscription URL (copy now): {url}", "success")
    return redirect(url_for("pages_app.calendar_page"))


@bp.get("/devices")
@login_required
def devices():
    from flask import render_template

    from seqta_link.models import Device

    user = get_current_user()
    pairing = PairingService()
    device_rows = Device.query.filter_by(owner_user_id=user.id).order_by(Device.created_at.desc()).all()
    codes = pairing.list_pending_codes(user)
    return render_template(
        "app/devices.html",
        user=user,
        devices=device_rows,
        codes=codes,
        format_dt=format_datetime_display,
    )


@bp.post("/devices/pairing-codes")
@login_required
def create_pairing_code():
    from flask import flash, redirect, url_for

    user = get_current_user()
    cal = _calendar_for(user)
    try:
        result = PairingService().create_pairing_code(user, cal.id)
        flash(f"Pairing code: {result['code']} (expires in 10 minutes)", "success")
    except AppError as e:
        flash(e.message, "error")
    return redirect(url_for("pages_app.devices"))


@bp.post("/devices/pairing-codes/<code_id>/delete")
@login_required
def delete_pairing_code(code_id: str):
    from flask import flash, redirect, url_for

    PairingService().revoke_pending_code(get_current_user(), code_id)
    flash("Pairing code removed.", "success")
    return redirect(url_for("pages_app.devices"))


@bp.post("/devices/<device_id>/revoke")
@login_required
def revoke_device(device_id: str):
    from flask import flash, redirect, url_for

    from seqta_link.models import Device

    user = get_current_user()
    device = Device.query.filter_by(id=device_id, owner_user_id=user.id).first()
    if device:
        device.status = "revoked"
        device.revoked_at = utcnow()
        db.session.commit()
        flash("Device revoked.", "success")
    return redirect(url_for("pages_app.devices"))


@bp.get("/sync-history")
@login_required
def sync_history():
    from flask import render_template

    user = get_current_user()
    cal = _calendar_for(user)
    runs = (
        SyncRun.query.filter_by(calendar_id=cal.id)
        .order_by(SyncRun.started_at.desc())
        .limit(50)
        .all()
    )
    return render_template(
        "app/sync_history.html",
        user=user,
        runs=runs,
        format_dt=format_datetime_display,
    )


@bp.route("/account", methods=["GET", "POST"])
@login_required
def account():
    from flask import flash, redirect, render_template, request, url_for

    user = get_current_user()
    cal = _calendar_for(user)
    if request.method == "POST":
        action = request.form.get("action")
        if action == "preferences":
            name = request.form.get("calendar_name", "").strip()
            if name:
                cal.name = name
                db.session.commit()
                flash("Preferences saved.", "success")
        elif action == "password":
            from seqta_link.services.auth import AuthService
            from seqta_link.services.password import assert_password_policy, hash_password, verify_password

            current = request.form.get("current_password", "")
            new_pw = request.form.get("new_password", "")
            if not user.password_hash or not verify_password(current, user.password_hash):
                flash("Current password is incorrect.", "error")
            else:
                try:
                    assert_password_policy(new_pw)
                    user.password_hash = hash_password(new_pw)
                    AuthService(current_app.config["APP_CONFIG"]).logout(
                        request.cookies.get("seqta_session")
                    )
                    db.session.commit()
                    flash("Password changed. Please sign in again.", "success")
                    return redirect(url_for("auth.login"))
                except ValueError as e:
                    flash(str(e), "error")
    return render_template("app/account.html", user=user, calendar=cal)
