from __future__ import annotations

import hashlib
import secrets
from datetime import timedelta

from flask import g, request

from seqta_link.config import Config
from seqta_link.errors import AppError
from seqta_link.extensions import db
from seqta_link.models import Calendar, CalendarToken, Device, Session, User, new_id, utcnow
from seqta_link.services.crypto import (
    detect_token_type,
    generate_raw_token,
    hash_invite_token,
    hash_token,
)
from seqta_link.services.password import assert_password_policy, hash_password, normalize_email, verify_password
from seqta_link.services.calendar_provisioning import provision_user_calendar

SESSION_COOKIE = "seqta_session"


class AuthService:
    def __init__(self, config: Config):
        self.config = config

    def login(self, email_raw: str, password: str) -> tuple[str, User]:
        email = normalize_email(email_raw)
        if not email or not password:
            raise AppError("UNAUTHORIZED", "Invalid email or password.", 401)

        user = User.query.filter_by(email=email).first()
        if not user or user.account_status != "active":
            raise AppError("UNAUTHORIZED", "Invalid email or password.", 401)
        if not user.password_hash or not verify_password(password, user.password_hash):
            raise AppError("UNAUTHORIZED", "Invalid email or password.", 401)

        provision_user_calendar(user, self.config)
        token = self._create_session(user.id)
        return token, user

    def logout(self, session_token: str | None) -> None:
        if not session_token:
            return
        Session.query.filter_by(session_token_hash=self._hash_session(session_token)).delete()
        db.session.commit()

    def validate_session(self, session_token: str | None) -> User | None:
        if not session_token:
            return None
        token_hash = self._hash_session(session_token)
        session = Session.query.filter_by(session_token_hash=token_hash).first()
        if not session or session.expires_at < utcnow():
            return None
        user = User.query.get(session.user_id)
        if not user or user.account_status != "active":
            return None
        session.last_seen_at = utcnow()
        db.session.commit()
        return user

    def register_with_invitation(
        self, invitation, email: str, password: str, display_name: str | None
    ) -> tuple[str, User]:
        assert_password_policy(password)
        normalized = normalize_email(email)
        if User.query.filter_by(email=normalized).first():
            raise AppError("INVALID_REQUEST", "An account with this email already exists.", 409)

        name = (
            (display_name or "").strip()
            or (invitation.expected_name or "").strip()
            or normalized.split("@")[0]
            or "User"
        )
        user = User(
            id=new_id(),
            display_name=name,
            email=normalized,
            password_hash=hash_password(password),
            role="user",
            sync_enabled=invitation.sync_enabled,
            feed_enabled=invitation.feed_enabled,
            max_devices=invitation.max_devices,
        )
        db.session.add(user)
        invitation.used_at = utcnow()
        invitation.used_by = user.id
        db.session.commit()

        provision_user_calendar(user, self.config)
        token = self._create_session(user.id)
        return token, user

    def bootstrap_owner(self, email: str, password: str, display_name: str = "Owner") -> User:
        assert_password_policy(password)
        normalized = normalize_email(email)
        existing_owner = User.query.filter(User.role == "owner").first()
        if existing_owner:
            return existing_owner

        user = User(
            id=new_id(),
            display_name=display_name,
            email=normalized,
            password_hash=hash_password(password),
            role="owner",
        )
        db.session.add(user)
        db.session.commit()
        provision_user_calendar(user, self.config)
        return user

    def resolve_device_token(self, raw_token: str) -> tuple[Device, Calendar, User]:
        if detect_token_type(raw_token) != "device":
            raise AppError("INVALID_TOKEN", "Invalid token format.", 401)
        token_hash = hash_token(self.config.token_pepper, "device", raw_token)
        device = Device.query.filter_by(token_hash=token_hash, status="active").first()
        if not device:
            raise AppError("INVALID_TOKEN", "Invalid or revoked device token.", 401)
        calendar = Calendar.query.get(device.calendar_id)
        user = User.query.get(device.owner_user_id)
        if not calendar or not user or not user.sync_enabled or user.account_status != "active":
            raise AppError("INVALID_TOKEN", "Sync is not available for this device.", 401)
        return device, calendar, user

    def resolve_calendar_token(self, raw_token: str) -> tuple[CalendarToken, Calendar, User]:
        if detect_token_type(raw_token) != "calendar":
            raise AppError("INVALID_TOKEN", "Calendar feed not found.", 404)
        token_hash = hash_token(self.config.token_pepper, "calendar", raw_token)
        token = CalendarToken.query.filter_by(token_hash=token_hash, status="active").first()
        if not token:
            raise AppError("INVALID_TOKEN", "Calendar feed not found.", 404)
        calendar = Calendar.query.get(token.calendar_id)
        user = User.query.get(calendar.owner_user_id) if calendar else None
        if not calendar or not user or not user.feed_enabled or user.account_status != "active":
            raise AppError("FEED_DISABLED", "Calendar feed is disabled.", 410)
        token.last_used_at = utcnow()
        db.session.commit()
        return token, calendar, user

    def rotate_calendar_token(self, calendar_id: str) -> str:
        CalendarToken.query.filter_by(calendar_id=calendar_id, status="active").update(
            {"status": "revoked", "revoked_at": utcnow()}
        )
        raw = generate_raw_token("calendar")
        db.session.add(
            CalendarToken(
                id=new_id(),
                calendar_id=calendar_id,
                token_hash=hash_token(self.config.token_pepper, "calendar", raw),
                token_prefix=raw[:12],
                status="active",
            )
        )
        db.session.commit()
        return raw

    def hash_invite(self, raw: str) -> str:
        return hash_invite_token(self.config.token_pepper, raw)

    def _create_session(self, user_id: str) -> str:
        token = secrets.token_urlsafe(32)
        expires = utcnow() + timedelta(hours=self.config.session_ttl_hours)
        db.session.add(
            Session(
                id=new_id(),
                user_id=user_id,
                session_token_hash=self._hash_session(token),
                expires_at=expires,
            )
        )
        db.session.commit()
        return token

    def _hash_session(self, token: str) -> str:
        return hashlib.sha256(self.config.session_secret + token.encode()).hexdigest()

    def set_session_cookie(self, response, token: str):
        response.set_cookie(
            SESSION_COOKIE,
            token,
            httponly=True,
            secure=self.config.cookie_secure,
            samesite="Lax",
            path="/",
            max_age=self.config.session_ttl_hours * 3600,
        )

    def clear_session_cookie(self, response):
        response.delete_cookie(SESSION_COOKIE, path="/")

    def read_session_from_request(self) -> str | None:
        return request.cookies.get(SESSION_COOKIE)


def get_current_user() -> User | None:
    return getattr(g, "current_user", None)


def login_required(view):
    from functools import wraps
    from flask import redirect, url_for

    @wraps(view)
    def wrapped(*args, **kwargs):
        if g.current_user is None:
            return redirect(url_for("auth.login", next=request.path))
        return view(*args, **kwargs)

    return wrapped


def admin_required(view):
    from functools import wraps
    from flask import abort, redirect, url_for

    @wraps(view)
    def wrapped(*args, **kwargs):
        user = g.current_user
        if user is None:
            return redirect(url_for("auth.admin_login", next=request.path))
        if user.role not in ("owner", "admin"):
            abort(403)
        return view(*args, **kwargs)

    return wrapped
