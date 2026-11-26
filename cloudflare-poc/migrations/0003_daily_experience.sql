-- Additive calendar preferences, authoritative source-day coverage and latest device check.
CREATE TABLE IF NOT EXISTS worker_calendar_preferences (
 calendar_id TEXT PRIMARY KEY REFERENCES calendars(id) ON DELETE CASCADE,
 preferences_json TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS worker_school_days (
 calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
 local_date TEXT NOT NULL,
 week_label TEXT CHECK(week_label IS NULL OR week_label IN ('A','B')),
 term_label TEXT,
 holiday_label TEXT,
 checked_at TEXT NOT NULL,
 PRIMARY KEY(calendar_id,local_date)
);
CREATE TABLE IF NOT EXISTS worker_device_checks (
 device_id TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
 outcome TEXT NOT NULL CHECK(outcome IN ('uploaded','unchanged','skipped','failed')),
 reason TEXT NOT NULL,
 checked_at TEXT NOT NULL
);
