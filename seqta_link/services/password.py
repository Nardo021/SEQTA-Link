from __future__ import annotations

import re

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

MIN_PASSWORD_LENGTH = 8
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

_ph = PasswordHasher()


def normalize_email(email: str) -> str:
    return email.strip().lower()


def assert_password_policy(password: str) -> None:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"Password must be at least {MIN_PASSWORD_LENGTH} characters.")


def hash_password(password: str) -> str:
    assert_password_policy(password)
    return _ph.hash(password)


def verify_password(password: str, stored: str) -> bool:
    if stored.startswith("scrypt$"):
        return _verify_legacy_scrypt(password, stored)
    try:
        return _ph.verify(stored, password)
    except VerifyMismatchError:
        return False


def _verify_legacy_scrypt(password: str, stored: str) -> bool:
    import base64
    import hashlib

    parts = stored.split("$")
    if len(parts) != 3 or parts[0] != "scrypt":
        return False
    _, salt, expected_b64 = parts
    actual = hashlib.scrypt(
        password.encode(),
        salt=salt.encode(),
        n=2**14,
        r=8,
        p=1,
        dklen=64,
    )
    expected = base64.urlsafe_b64decode(expected_b64 + "==")
    return len(actual) == len(expected) and __import__("hmac").compare_digest(actual, expected)
