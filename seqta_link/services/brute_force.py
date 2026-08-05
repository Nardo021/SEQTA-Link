from __future__ import annotations

import time
from collections import defaultdict
from dataclasses import dataclass


@dataclass
class AttemptRecord:
    failures: int = 0
    window_start: float = 0.0
    locked_until: float = 0.0


class BruteForceGuard:
    def __init__(self, max_failures: int, window_seconds: int, lockout_seconds: int):
        self.max_failures = max_failures
        self.window_seconds = window_seconds
        self.lockout_seconds = lockout_seconds
        self._records: dict[str, AttemptRecord] = defaultdict(AttemptRecord)

    def assert_allowed(self, key: str) -> None:
        now = time.time()
        record = self._records[key]
        if record.locked_until > now:
            raise PermissionError("Too many failed attempts. Try again later.")
        if record.window_start and now - record.window_start > self.window_seconds:
            record.failures = 0
            record.window_start = now

    def record_failure(self, key: str) -> None:
        now = time.time()
        record = self._records[key]
        if not record.window_start or now - record.window_start > self.window_seconds:
            record.window_start = now
            record.failures = 0
        record.failures += 1
        if record.failures >= self.max_failures:
            record.locked_until = now + self.lockout_seconds

    def record_success(self, key: str) -> None:
        self._records.pop(key, None)
