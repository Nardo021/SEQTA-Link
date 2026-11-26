-- Additive audit history and read-path indexes; no changes to existing records.
CREATE TABLE IF NOT EXISTS worker_event_changes (
 calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
 sync_id TEXT NOT NULL REFERENCES sync_runs(id) ON DELETE CASCADE,
 event_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('inserted','updated','removed','restored')),
 before_json TEXT,
 after_json TEXT NOT NULL,
 changed_at TEXT NOT NULL,
 PRIMARY KEY(sync_id,event_id)
);
CREATE INDEX IF NOT EXISTS ix_worker_changes_calendar_time ON worker_event_changes(calendar_id,changed_at DESC);
CREATE INDEX IF NOT EXISTS ix_events_confirmed_date ON events(calendar_id,local_date,starts_at_utc,title) WHERE active=1 AND status='confirmed';
