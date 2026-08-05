from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from seqta_link.extensions import db


def utcnow() -> datetime:
    return datetime.utcnow()


def new_id() -> str:
    return str(uuid.uuid4())


class User(db.Model):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    email: Mapped[str | None] = mapped_column(String(320), unique=True, index=True)
    password_hash: Mapped[str | None] = mapped_column(Text)
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="user")
    account_status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    sync_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    feed_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    max_devices: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)
    suspended_at: Mapped[datetime | None] = mapped_column(default=None)
    deleted_at: Mapped[datetime | None] = mapped_column(default=None)

    calendar: Mapped[Calendar | None] = relationship(back_populates="owner", uselist=False)
    sessions: Mapped[list[Session]] = relationship(back_populates="user")

    __table_args__ = (
        CheckConstraint("role IN ('owner', 'admin', 'user')", name="ck_users_role"),
        CheckConstraint(
            "account_status IN ('active', 'suspended', 'deleted')",
            name="ck_users_account_status",
        ),
    )


class Calendar(db.Model):
    __tablename__ = "calendars"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="Australia/Sydney")
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_synced_at: Mapped[datetime | None] = mapped_column(default=None)
    last_changed_at: Mapped[datetime | None] = mapped_column(default=None)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)

    owner: Mapped[User] = relationship(back_populates="calendar")
    source_identity: Mapped[SourceIdentity | None] = relationship(
        back_populates="calendar", uselist=False
    )
    tokens: Mapped[list[CalendarToken]] = relationship(back_populates="calendar")
    devices: Mapped[list[Device]] = relationship(back_populates="calendar")
    events: Mapped[list[Event]] = relationship(back_populates="calendar")


class SourceIdentity(db.Model):
    __tablename__ = "source_identities"

    calendar_id: Mapped[str] = mapped_column(
        ForeignKey("calendars.id", ondelete="CASCADE"), primary_key=True
    )
    school_host: Mapped[str] = mapped_column(String(255), nullable=False)
    student_ref: Mapped[str] = mapped_column(String(64), nullable=False)
    locked_at: Mapped[datetime] = mapped_column(default=utcnow)
    reset_at: Mapped[datetime | None] = mapped_column(default=None)
    reset_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), default=None)

    calendar: Mapped[Calendar] = relationship(back_populates="source_identity")


class CalendarToken(db.Model):
    __tablename__ = "calendar_tokens"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    calendar_id: Mapped[str] = mapped_column(
        ForeignKey("calendars.id", ondelete="CASCADE"), nullable=False
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    token_prefix: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    last_used_at: Mapped[datetime | None] = mapped_column(default=None)
    revoked_at: Mapped[datetime | None] = mapped_column(default=None)

    calendar: Mapped[Calendar] = relationship(back_populates="tokens")

    __table_args__ = (
        CheckConstraint("status IN ('active', 'revoked')", name="ck_calendar_tokens_status"),
    )


class Device(db.Model):
    __tablename__ = "devices"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    calendar_id: Mapped[str] = mapped_column(
        ForeignKey("calendars.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    token_prefix: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    last_seen_at: Mapped[datetime | None] = mapped_column(default=None)
    last_synced_at: Mapped[datetime | None] = mapped_column(default=None)
    revoked_at: Mapped[datetime | None] = mapped_column(default=None)

    calendar: Mapped[Calendar] = relationship(back_populates="devices")

    __table_args__ = (CheckConstraint("status IN ('active', 'revoked')", name="ck_devices_status"),)


class Event(db.Model):
    __tablename__ = "events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    calendar_id: Mapped[str] = mapped_column(
        ForeignKey("calendars.id", ondelete="CASCADE"), nullable=False
    )
    natural_key: Mapped[str] = mapped_column(String(64), nullable=False)
    ical_uid: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    local_date: Mapped[str] = mapped_column(String(10), nullable=False)
    period_key: Mapped[str] = mapped_column(String(64), nullable=False)
    course_code: Mapped[str | None] = mapped_column(String(32))
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    starts_at_utc: Mapped[str] = mapped_column(String(32), nullable=False)
    ends_at_utc: Mapped[str] = mapped_column(String(32), nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False)
    teacher: Mapped[str | None] = mapped_column(String(200))
    room: Mapped[str | None] = mapped_column(String(100))
    description: Mapped[str | None] = mapped_column(Text)
    event_type: Mapped[str] = mapped_column(String(32), nullable=False, default="class")
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="confirmed")
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(default=None)

    calendar: Mapped[Calendar] = relationship(back_populates="events")

    __table_args__ = (
        UniqueConstraint("calendar_id", "natural_key", name="uq_events_calendar_natural_key"),
        CheckConstraint("status IN ('confirmed', 'cancelled')", name="ck_events_status"),
        Index("ix_events_calendar_active_start", "calendar_id", "active", "starts_at_utc"),
        Index("ix_events_calendar_date", "calendar_id", "local_date"),
    )


class EventAlias(db.Model):
    __tablename__ = "event_aliases"

    calendar_id: Mapped[str] = mapped_column(
        ForeignKey("calendars.id", ondelete="CASCADE"), primary_key=True
    )
    source_key: Mapped[str] = mapped_column(String(300), primary_key=True)
    event_id: Mapped[str] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), nullable=False)
    first_seen_at: Mapped[datetime] = mapped_column(default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(default=utcnow)


class SyncRun(db.Model):
    __tablename__ = "sync_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    calendar_id: Mapped[str] = mapped_column(
        ForeignKey("calendars.id", ondelete="CASCADE"), nullable=False
    )
    device_id: Mapped[str] = mapped_column(ForeignKey("devices.id"), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(36), nullable=False)
    payload_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    snapshot_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    range_from: Mapped[str] = mapped_column(String(10), nullable=False)
    range_until: Mapped[str] = mapped_column(String(10), nullable=False)
    received_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    normalized_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    duplicate_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    inserted_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    removed_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    restored_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    unchanged_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    error_code: Mapped[str | None] = mapped_column(String(64))
    started_at: Mapped[datetime] = mapped_column(default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(default=None)

    __table_args__ = (
        UniqueConstraint("device_id", "idempotency_key", name="uq_sync_runs_device_idempotency"),
        CheckConstraint("status IN ('running', 'success', 'failed')", name="ck_sync_runs_status"),
        Index("ix_sync_runs_calendar_started", "calendar_id", "started_at"),
    )


class Invitation(db.Model):
    __tablename__ = "invitations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    expected_name: Mapped[str | None] = mapped_column(String(200))
    note: Mapped[str | None] = mapped_column(Text)
    sync_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    feed_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    max_devices: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    expires_at: Mapped[datetime] = mapped_column(nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(default=None)
    used_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class PairingCode(db.Model):
    __tablename__ = "pairing_codes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    calendar_id: Mapped[str] = mapped_column(
        ForeignKey("calendars.id", ondelete="CASCADE"), nullable=False
    )
    code_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(default=None)
    device_id: Mapped[str | None] = mapped_column(ForeignKey("devices.id"))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class Session(db.Model):
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    session_token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(nullable=False)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(default=utcnow)

    user: Mapped[User] = relationship(back_populates="sessions")


class AuditLog(db.Model):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    actor_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    actor_type: Mapped[str] = mapped_column(String(16), nullable=False)
    target_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    request_id: Mapped[str | None] = mapped_column(String(64))
    metadata_json: Mapped[dict] = mapped_column("metadata", JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

    __table_args__ = (
        CheckConstraint(
            "actor_type IN ('owner', 'admin', 'user', 'device', 'system')",
            name="ck_audit_actor_type",
        ),
    )
