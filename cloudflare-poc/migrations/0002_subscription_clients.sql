-- Additive, idempotent metadata only. Existing token hashes and events unchanged.
CREATE TABLE IF NOT EXISTS calendar_subscription_meta (
 token_id TEXT PRIMARY KEY NOT NULL REFERENCES calendar_tokens(id) ON DELETE CASCADE,
 label TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND 80)
);
CREATE TABLE IF NOT EXISTS calendar_subscription_clients (
 token_id TEXT NOT NULL REFERENCES calendar_tokens(id) ON DELETE CASCADE,
 client TEXT NOT NULL CHECK(client IN ('apple','google','outlook','thunderbird','calendar','browser','other','unknown')),
 first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, fetch_count INTEGER NOT NULL DEFAULT 1 CHECK(fetch_count>=1),
 PRIMARY KEY(token_id,client)
);
