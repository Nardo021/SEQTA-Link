from __future__ import annotations

from flask import Blueprint, jsonify, request, current_app

from seqta_link.errors import AppError
from seqta_link.extensions import db
from seqta_link.models import Device, Event, SyncRun
from seqta_link.services.auth import AuthService, login_required, get_current_user
from seqta_link.services.brute_force import BruteForceGuard
from seqta_link.services.dates import now_iso
from seqta_link.services.pairing import PairingService
from seqta_link.services.sync.service import SyncService

bp = Blueprint("api_v2", __name__, url_prefix="/api/v2")


def _error(e: AppError):
    return jsonify({"error": {"code": e.code, "message": e.message, "details": e.details}}), e.status


@bp.post("/device/pair")
def pair_device():
    config = current_app.config["APP_CONFIG"]
    guard = BruteForceGuard(10, 900, 900)
    key = f"pair-ip:{request.remote_addr}"
    try:
        guard.assert_allowed(key)
        body = request.get_json(silent=True) or {}
        code = body.get("code", "")
        name = body.get("deviceName", "Browser")
        token = PairingService().pair_device(code, name)
        guard.record_success(key)
        return jsonify({"deviceToken": token})
    except PermissionError:
        return jsonify({"error": {"code": "RATE_LIMITED", "message": "Too many attempts."}}), 429
    except AppError as e:
        guard.record_failure(key)
        return _error(e)


@bp.post("/sync")
def sync():
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return jsonify({"error": {"code": "INVALID_TOKEN", "message": "Missing bearer token."}}), 401
    raw = auth_header[7:].strip()
    auth = AuthService(current_app.config["APP_CONFIG"])
    try:
        device, calendar, user = auth.resolve_device_token(raw)
        body = request.get_json(silent=True) or {}
        if len(body.get("lessons", [])) > current_app.config["APP_CONFIG"].max_lessons_per_sync:
            raise AppError("INVALID_REQUEST", "Too many lessons in payload.", 400)
        idem = request.headers.get("Idempotency-Key", "")
        result = SyncService(current_app.config["APP_CONFIG"]).sync(
            user, calendar, device, idem, body
        )
        return jsonify(result)
    except AppError as e:
        return _error(e)


@bp.get("/status")
def status():
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return jsonify({"error": {"code": "INVALID_TOKEN", "message": "Missing bearer token."}}), 401
    raw = auth_header[7:].strip()
    auth = AuthService(current_app.config["APP_CONFIG"])
    try:
        device, calendar, user = auth.resolve_device_token(raw)
        active_events = Event.query.filter_by(
            calendar_id=calendar.id, active=True, status="confirmed"
        ).count()
        last_run = (
            SyncRun.query.filter_by(calendar_id=calendar.id)
            .order_by(SyncRun.started_at.desc())
            .first()
        )
        return jsonify(
            {
                "feed": {
                    "name": calendar.name,
                    "timezone": calendar.timezone,
                    "revision": calendar.revision,
                },
                "sync": {
                    "enabled": user.sync_enabled,
                    "lastSyncedAt": calendar.last_synced_at.isoformat()
                    if calendar.last_synced_at
                    else None,
                    "lastStatus": last_run.status if last_run else "unknown",
                },
                "events": {"active": active_events},
                "device": {"name": device.name, "lastSeenAt": now_iso()},
            }
        )
    except AppError as e:
        return _error(e)


@bp.post("/me/pairing-codes")
@login_required
def api_create_pairing_code():
    user = get_current_user()
    from seqta_link.models import Calendar

    cal = Calendar.query.filter_by(owner_user_id=user.id).first()
    if not cal:
        return jsonify({"error": {"message": "Calendar not found."}}), 404
    try:
        result = PairingService().create_pairing_code(user, cal.id)
        return jsonify(result)
    except AppError as e:
        return _error(e)


@bp.delete("/me/devices/<device_id>")
@login_required
def api_revoke_device(device_id: str):
    user = get_current_user()
    device = Device.query.filter_by(id=device_id, owner_user_id=user.id).first()
    if not device:
        return jsonify({"error": {"message": "Device not found."}}), 404
    from seqta_link.models import utcnow

    device.status = "revoked"
    device.revoked_at = utcnow()
    db.session.commit()
    return jsonify({"ok": True})
