-- Seqta Link v2 schema (PostgreSQL 17+)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
    version     TEXT PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    oidc_issuer         TEXT NOT NULL,
    oidc_subject        TEXT NOT NULL,
    display_name        TEXT NOT NULL,
    email               TEXT,
    role                TEXT NOT NULL DEFAULT 'user',
    account_status      TEXT NOT NULL DEFAULT 'active',
    sync_enabled        BOOLEAN NOT NULL DEFAULT true,
    feed_enabled        BOOLEAN NOT NULL DEFAULT true,
    max_devices         INTEGER NOT NULL DEFAULT 3,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    suspended_at        TIMESTAMPTZ,
    deleted_at          TIMESTAMPTZ,
    UNIQUE (oidc_issuer, oidc_subject),
    CHECK (role IN ('owner', 'admin', 'user')),
    CHECK (account_status IN ('active', 'suspended', 'deleted'))
);

CREATE TABLE calendars (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id       UUID NOT NULL REFERENCES users(id),
    name                TEXT NOT NULL,
    timezone            TEXT NOT NULL DEFAULT 'Australia/Sydney',
    revision            BIGINT NOT NULL DEFAULT 0,
    last_synced_at      TIMESTAMPTZ,
    last_changed_at     TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (owner_user_id)
);

CREATE TABLE source_identities (
    calendar_id         UUID PRIMARY KEY REFERENCES calendars(id) ON DELETE CASCADE,
    school_host         TEXT NOT NULL,
    student_ref         TEXT NOT NULL,
    person_uuid_hash    BYTEA,
    locked_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    reset_at            TIMESTAMPTZ,
    reset_by            UUID REFERENCES users(id)
);

CREATE TABLE calendar_tokens (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    calendar_id         UUID NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
    token_hash          TEXT NOT NULL UNIQUE,
    token_prefix        TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'active',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at        TIMESTAMPTZ,
    revoked_at          TIMESTAMPTZ,
    CHECK (status IN ('active', 'revoked'))
);

CREATE UNIQUE INDEX idx_calendar_tokens_one_active
ON calendar_tokens (calendar_id)
WHERE status = 'active';

CREATE TABLE devices (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id       UUID NOT NULL REFERENCES users(id),
    calendar_id         UUID NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,
    token_hash          TEXT NOT NULL UNIQUE,
    token_prefix        TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'active',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at        TIMESTAMPTZ,
    last_synced_at      TIMESTAMPTZ,
    revoked_at          TIMESTAMPTZ,
    CHECK (status IN ('active', 'revoked'))
);

CREATE TABLE events (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id       UUID NOT NULL REFERENCES users(id),
    calendar_id         UUID NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
    natural_key         TEXT NOT NULL,
    ical_uid            TEXT NOT NULL UNIQUE,
    local_date          DATE NOT NULL,
    period_key          TEXT NOT NULL,
    course_code         TEXT,
    title               TEXT NOT NULL,
    starts_at_utc       TIMESTAMPTZ NOT NULL,
    ends_at_utc         TIMESTAMPTZ NOT NULL,
    timezone            TEXT NOT NULL,
    teacher             TEXT,
    room                TEXT,
    description         TEXT,
    event_type          TEXT NOT NULL DEFAULT 'class',
    content_hash        TEXT NOT NULL,
    sequence            INTEGER NOT NULL DEFAULT 0,
    status              TEXT NOT NULL DEFAULT 'confirmed',
    active              BOOLEAN NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ,
    UNIQUE (calendar_id, natural_key),
    CHECK (status IN ('confirmed', 'cancelled')),
    CHECK (ends_at_utc > starts_at_utc)
);

CREATE TABLE event_aliases (
    calendar_id         UUID NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
    source_key          TEXT NOT NULL,
    event_id            UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    first_seen_at       TIMESTAMPTZ NOT NULL,
    last_seen_at        TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (calendar_id, source_key)
);

CREATE TABLE sync_runs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id       UUID NOT NULL REFERENCES users(id),
    calendar_id         UUID NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
    device_id           UUID NOT NULL REFERENCES devices(id),
    idempotency_key     TEXT NOT NULL,
    payload_hash        TEXT NOT NULL,
    snapshot_hash       TEXT NOT NULL,
    range_from          DATE NOT NULL,
    range_until         DATE NOT NULL,
    received_count      INTEGER NOT NULL DEFAULT 0,
    normalized_count    INTEGER NOT NULL DEFAULT 0,
    duplicate_count     INTEGER NOT NULL DEFAULT 0,
    inserted_count      INTEGER NOT NULL DEFAULT 0,
    updated_count       INTEGER NOT NULL DEFAULT 0,
    removed_count       INTEGER NOT NULL DEFAULT 0,
    restored_count      INTEGER NOT NULL DEFAULT 0,
    unchanged_count     INTEGER NOT NULL DEFAULT 0,
    status              TEXT NOT NULL,
    error_code          TEXT,
    started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at        TIMESTAMPTZ,
    UNIQUE (device_id, idempotency_key),
    CHECK (status IN ('running', 'success', 'failed'))
);

CREATE INDEX idx_events_calendar_active_start
ON events (calendar_id, active, starts_at_utc);

CREATE INDEX idx_events_calendar_date
ON events (calendar_id, local_date);

CREATE INDEX idx_aliases_event ON event_aliases (event_id);

CREATE INDEX idx_sync_runs_calendar_started
ON sync_runs (calendar_id, started_at DESC);

-- Phase 2+ tables (schema ready, unused in Phase 1 runtime)
CREATE TABLE invitations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash          TEXT NOT NULL UNIQUE,
    created_by          UUID NOT NULL REFERENCES users(id),
    expected_name       TEXT,
    note                TEXT,
    sync_enabled        BOOLEAN NOT NULL DEFAULT true,
    feed_enabled        BOOLEAN NOT NULL DEFAULT true,
    max_devices         INTEGER NOT NULL DEFAULT 3,
    expires_at          TIMESTAMPTZ NOT NULL,
    used_at             TIMESTAMPTZ,
    used_by             UUID REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pairing_codes (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id       UUID NOT NULL REFERENCES users(id),
    calendar_id         UUID NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
    code_hash           TEXT NOT NULL UNIQUE,
    expires_at          TIMESTAMPTZ NOT NULL,
    used_at             TIMESTAMPTZ,
    device_id           UUID REFERENCES devices(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_token_hash  TEXT NOT NULL UNIQUE,
    expires_at          TIMESTAMPTZ NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id       UUID REFERENCES users(id),
    actor_type          TEXT NOT NULL,
    target_user_id      UUID REFERENCES users(id),
    action              TEXT NOT NULL,
    request_id          TEXT,
    ip_hash             BYTEA,
    user_agent_summary  TEXT,
    metadata            JSONB NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (actor_type IN ('owner', 'admin', 'user', 'device', 'system'))
);
