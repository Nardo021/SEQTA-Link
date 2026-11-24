-- SQLite-compatible production model columns; Worker-only guard tables are additive.
CREATE TABLE users (
 id TEXT PRIMARY KEY NOT NULL, display_name TEXT NOT NULL, email TEXT UNIQUE,
 password_hash TEXT, role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('owner','admin','user')),
 account_status TEXT NOT NULL DEFAULT 'active' CHECK(account_status IN ('active','suspended','deleted')),
 sync_enabled INTEGER NOT NULL DEFAULT 1, feed_enabled INTEGER NOT NULL DEFAULT 1,
 max_devices INTEGER NOT NULL DEFAULT 3, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 suspended_at TEXT, deleted_at TEXT
);
CREATE TABLE calendars (
 id TEXT PRIMARY KEY NOT NULL, owner_user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
 name TEXT NOT NULL, timezone TEXT NOT NULL DEFAULT 'Australia/Sydney', revision INTEGER NOT NULL DEFAULT 0,
 last_synced_at TEXT, last_changed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE source_identities (
 calendar_id TEXT PRIMARY KEY NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
 school_host TEXT NOT NULL, student_ref TEXT NOT NULL, locked_at TEXT NOT NULL,
 reset_at TEXT, reset_by TEXT REFERENCES users(id)
);
CREATE TABLE calendar_tokens (
 id TEXT PRIMARY KEY NOT NULL, calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
 token_hash TEXT NOT NULL UNIQUE, token_prefix TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
 created_at TEXT NOT NULL, last_used_at TEXT, revoked_at TEXT
);
CREATE TABLE devices (
 id TEXT PRIMARY KEY NOT NULL, owner_user_id TEXT NOT NULL REFERENCES users(id),
 calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE, name TEXT NOT NULL,
 token_hash TEXT NOT NULL UNIQUE, token_prefix TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
 created_at TEXT NOT NULL, last_seen_at TEXT, last_synced_at TEXT, revoked_at TEXT
);
CREATE TABLE events (
 id TEXT PRIMARY KEY NOT NULL, owner_user_id TEXT NOT NULL REFERENCES users(id),
 calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
 natural_key TEXT NOT NULL, ical_uid TEXT NOT NULL UNIQUE, local_date TEXT NOT NULL,
 period_key TEXT NOT NULL, course_code TEXT, title TEXT NOT NULL, starts_at_utc TEXT NOT NULL,
 ends_at_utc TEXT NOT NULL, timezone TEXT NOT NULL, teacher TEXT, room TEXT, description TEXT,
 event_type TEXT NOT NULL DEFAULT 'class', content_hash TEXT NOT NULL, sequence INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed','cancelled')), active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, UNIQUE(calendar_id,natural_key)
);
CREATE INDEX ix_events_calendar_active_start ON events(calendar_id,active,starts_at_utc);
CREATE INDEX ix_events_calendar_date ON events(calendar_id,local_date);
CREATE TABLE event_aliases (
 calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE, source_key TEXT NOT NULL,
 event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE, first_seen_at TEXT NOT NULL,
 last_seen_at TEXT NOT NULL, PRIMARY KEY(calendar_id,source_key)
);
CREATE TABLE sync_runs (
 id TEXT PRIMARY KEY NOT NULL, owner_user_id TEXT NOT NULL REFERENCES users(id),
 calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE, device_id TEXT NOT NULL REFERENCES devices(id),
 idempotency_key TEXT NOT NULL, payload_hash TEXT NOT NULL, snapshot_hash TEXT NOT NULL,
 range_from TEXT NOT NULL, range_until TEXT NOT NULL, received_count INTEGER NOT NULL DEFAULT 0,
 normalized_count INTEGER NOT NULL DEFAULT 0, duplicate_count INTEGER NOT NULL DEFAULT 0,
 inserted_count INTEGER NOT NULL DEFAULT 0, updated_count INTEGER NOT NULL DEFAULT 0,
 removed_count INTEGER NOT NULL DEFAULT 0, restored_count INTEGER NOT NULL DEFAULT 0,
 unchanged_count INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL CHECK(status IN ('running','success','failed')),
 error_code TEXT, started_at TEXT NOT NULL, completed_at TEXT, UNIQUE(device_id,idempotency_key)
);
CREATE INDEX ix_sync_runs_calendar_started ON sync_runs(calendar_id,started_at);
CREATE TABLE invitations (
 id TEXT PRIMARY KEY NOT NULL, token_hash TEXT NOT NULL UNIQUE, created_by TEXT NOT NULL REFERENCES users(id),
 expected_name TEXT, note TEXT, sync_enabled INTEGER NOT NULL DEFAULT 1, feed_enabled INTEGER NOT NULL DEFAULT 1,
 max_devices INTEGER NOT NULL DEFAULT 3, expires_at TEXT NOT NULL, used_at TEXT,
 used_by TEXT REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE TABLE pairing_codes (
 id TEXT PRIMARY KEY NOT NULL, owner_user_id TEXT NOT NULL REFERENCES users(id),
 calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE, code_hash TEXT NOT NULL UNIQUE,
 expires_at TEXT NOT NULL, used_at TEXT, device_id TEXT REFERENCES devices(id), created_at TEXT NOT NULL
);
CREATE TABLE sessions (
 id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 session_token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL
);
CREATE TABLE audit_logs (
 id TEXT PRIMARY KEY NOT NULL, actor_user_id TEXT REFERENCES users(id),
 actor_type TEXT NOT NULL CHECK(actor_type IN ('owner','admin','user','device','system')),
 target_user_id TEXT REFERENCES users(id), action TEXT NOT NULL, request_id TEXT,
 metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);
CREATE TABLE worker_sync_versions (
 calendar_id TEXT PRIMARY KEY NOT NULL REFERENCES calendars(id) ON DELETE CASCADE, generation INTEGER NOT NULL
);
CREATE TABLE worker_sync_guard (
 id TEXT PRIMARY KEY NOT NULL, ok INTEGER NOT NULL CHECK(ok=1)
);
