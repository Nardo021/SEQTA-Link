from __future__ import annotations

from datetime import timedelta

from flask import current_app

from seqta_link.extensions import db
from seqta_link.models import Device, PairingCode, User, new_id, utcnow
from seqta_link.services.crypto import (
    generate_pairing_code,
    generate_raw_token,
    hash_token,
    normalize_pairing_code,
)


class PairingService:
    def create_pairing_code(self, user: User, calendar_id: str) -> dict:
        active_devices = Device.query.filter_by(
            owner_user_id=user.id, status="active"
        ).count()
        if active_devices >= user.max_devices:
            from seqta_link.errors import AppError

            raise AppError("DEVICE_LIMIT", "Maximum number of devices reached.", 409)

        code = generate_pairing_code()
        expires = utcnow() + timedelta(minutes=10)
        record = PairingCode(
            id=new_id(),
            owner_user_id=user.id,
            calendar_id=calendar_id,
            code_hash=hash_token(
                current_app.config["APP_CONFIG"].token_pepper,
                "invite",
                normalize_pairing_code(code),
            ),
            expires_at=expires,
        )
        db.session.add(record)
        db.session.commit()
        return {"code": code, "expiresAt": expires.isoformat(), "id": record.id}

    def list_pending_codes(self, user: User) -> list[PairingCode]:
        now = utcnow()
        return (
            PairingCode.query.filter_by(owner_user_id=user.id, used_at=None)
            .filter(PairingCode.expires_at > now)
            .order_by(PairingCode.created_at.desc())
            .all()
        )

    def revoke_pending_code(self, user: User, code_id: str) -> None:
        code = PairingCode.query.filter_by(id=code_id, owner_user_id=user.id).first()
        if code and not code.used_at:
            db.session.delete(code)
            db.session.commit()

    def pair_device(self, code: str, device_name: str) -> str:
        from seqta_link.errors import AppError

        config = current_app.config["APP_CONFIG"]
        normalized = normalize_pairing_code(code)
        code_hash = hash_token(config.token_pepper, "invite", normalized)
        record = PairingCode.query.filter_by(code_hash=code_hash, used_at=None).first()
        if not record or record.expires_at < utcnow():
            raise AppError("INVALID_REQUEST", "Invalid or expired pairing code.", 404)

        user = User.query.get(record.owner_user_id)
        if not user or not user.sync_enabled:
            raise AppError("FORBIDDEN", "Sync is disabled for this account.", 403)

        active = Device.query.filter_by(owner_user_id=user.id, status="active").count()
        if active >= user.max_devices:
            raise AppError("DEVICE_LIMIT", "Maximum number of devices reached.", 409)

        raw = generate_raw_token("device")
        device = Device(
            id=new_id(),
            owner_user_id=user.id,
            calendar_id=record.calendar_id,
            name=device_name.strip() or "Browser",
            token_hash=hash_token(config.token_pepper, "device", raw),
            token_prefix=raw[:12],
            status="active",
        )
        record.used_at = utcnow()
        record.device_id = device.id
        db.session.add(device)
        db.session.commit()
        return raw
