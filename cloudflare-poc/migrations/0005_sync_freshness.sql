-- Keep the last successful source check after a later failed attempt.
ALTER TABLE worker_device_checks ADD COLUMN succeeded_at TEXT;
UPDATE worker_device_checks SET succeeded_at=checked_at WHERE outcome IN ('uploaded','unchanged') AND succeeded_at IS NULL;
