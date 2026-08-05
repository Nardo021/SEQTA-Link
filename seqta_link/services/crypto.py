from __future__ import annotations

import hashlib
import hmac
import json
import secrets
from typing import Any, Literal

TokenType = Literal["device", "calendar"]
SecretPurpose = Literal["device", "calendar", "invite"]

DEVICE_PREFIX = "sl_dvc_"
CALENDAR_PREFIX = "sl_cal_"
TOKEN_RANDOM_BYTES = 32
PAIRING_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
ICAL_UID_DOMAIN = "seqta.link"


def generate_raw_token(token_type: TokenType) -> str:
    prefix = DEVICE_PREFIX if token_type == "device" else CALENDAR_PREFIX
    return prefix + secrets.token_urlsafe(TOKEN_RANDOM_BYTES)


def generate_pairing_code() -> str:
    raw = "".join(secrets.choice(PAIRING_CODE_CHARS) for _ in range(8))
    return f"{raw[:4]}-{raw[4:]}"


def normalize_pairing_code(code: str) -> str:
    return code.replace("-", "").upper()


def hash_token(pepper: bytes, purpose: SecretPurpose, raw_token: str) -> str:
    msg = f"{purpose}:{raw_token}".encode()
    return hmac.new(pepper, msg, hashlib.sha256).hexdigest()


def hash_invite_token(pepper: bytes, raw_token: str) -> str:
    return hash_token(pepper, "invite", raw_token)


def detect_token_type(raw_token: str) -> TokenType | None:
    if raw_token.startswith(DEVICE_PREFIX):
        return "device"
    if raw_token.startswith(CALENDAR_PREFIX):
        return "calendar"
    return None


def generate_ical_uid(uid_secret: bytes, feed_id: str, event_id: str) -> str:
    digest = hmac.new(
        uid_secret,
        f"event:v1:{feed_id}:{event_id}".encode(),
        hashlib.sha256,
    ).digest()
    import base64

    token = base64.urlsafe_b64encode(digest).decode().rstrip("=")
    return f"{token}@{ICAL_UID_DOMAIN}"


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _sort_keys(value: Any) -> Any:
    if isinstance(value, list):
        return [_sort_keys(v) for v in value]
    if isinstance(value, dict):
        return {k: _sort_keys(value[k]) for k in sorted(value)}
    return value


def canonical_json_hash(payload: dict[str, Any]) -> str:
    return sha256_hex(json.dumps(_sort_keys(payload), separators=(",", ":")))
