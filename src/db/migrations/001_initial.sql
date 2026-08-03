CREATE TABLE IF NOT EXISTS schema_migrations (
    version     TEXT PRIMARY KEY,
    applied_at  TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS feeds (
    id                  TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    school_host         TEXT NOT NULL,
    student_ref         TEXT NOT NULL,
    timezone            TEXT NOT NULL,

    upload_token_hash   TEXT NOT NULL UNIQUE,
    calendar_token_hash TEXT NOT NULL UNIQUE,

    revision            INTEGER NOT NULL DEFAULT 0,
    last_changed_at     TEXT,
    last_synced_at      TEXT,

    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,

    UNIQUE (school_host, student_ref)
) STRICT;

CREATE TABLE IF NOT EXISTS events (
    id                  TEXT PRIMARY KEY,
    feed_id             TEXT NOT NULL,

    natural_key         TEXT NOT NULL,
    ical_uid            TEXT NOT NULL UNIQUE,

    local_date          TEXT NOT NULL,
    period_key          TEXT NOT NULL,
    course_code         TEXT,
    title               TEXT NOT NULL,

    starts_at_utc       TEXT NOT NULL,
    ends_at_utc         TEXT NOT NULL,
    timezone            TEXT NOT NULL,

    teacher             TEXT,
    room                TEXT,
    description         TEXT,
    event_type          TEXT NOT NULL DEFAULT 'class',

    content_hash        TEXT NOT NULL,
    sequence            INTEGER NOT NULL DEFAULT 0,

    status              TEXT NOT NULL DEFAULT 'confirmed',
    active              INTEGER NOT NULL DEFAULT 1,

    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    deleted_at          TEXT,

    FOREIGN KEY (feed_id) REFERENCES feeds(id) ON DELETE CASCADE,
    UNIQUE (feed_id, natural_key)
) STRICT;

CREATE TABLE IF NOT EXISTS event_aliases (
    feed_id             TEXT NOT NULL,
    source_key          TEXT NOT NULL,
    event_id            TEXT NOT NULL,
    first_seen_at       TEXT NOT NULL,
    last_seen_at        TEXT NOT NULL,

    FOREIGN KEY (feed_id) REFERENCES feeds(id) ON DELETE CASCADE,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,

    PRIMARY KEY (feed_id, source_key)
) STRICT;

CREATE TABLE IF NOT EXISTS sync_runs (
    id                  TEXT PRIMARY KEY,
    feed_id             TEXT NOT NULL,
    idempotency_key     TEXT NOT NULL,

    payload_hash        TEXT NOT NULL,
    snapshot_hash       TEXT NOT NULL,

    range_from          TEXT NOT NULL,
    range_until         TEXT NOT NULL,

    received_count      INTEGER NOT NULL,
    normalized_count    INTEGER NOT NULL,
    duplicate_count     INTEGER NOT NULL,
    inserted_count      INTEGER NOT NULL,
    updated_count       INTEGER NOT NULL,
    removed_count       INTEGER NOT NULL,
    restored_count      INTEGER NOT NULL,
    unchanged_count     INTEGER NOT NULL,

    status              TEXT NOT NULL,
    error_code          TEXT,

    started_at          TEXT NOT NULL,
    completed_at        TEXT,

    FOREIGN KEY (feed_id) REFERENCES feeds(id) ON DELETE CASCADE,
    UNIQUE (feed_id, idempotency_key)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_events_feed_active_start
ON events(feed_id, active, starts_at_utc);

CREATE INDEX IF NOT EXISTS idx_events_feed_date
ON events(feed_id, local_date);

CREATE INDEX IF NOT EXISTS idx_aliases_event
ON event_aliases(event_id);

CREATE INDEX IF NOT EXISTS idx_sync_runs_feed_started
ON sync_runs(feed_id, started_at DESC);
