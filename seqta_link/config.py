import os
from dataclasses import dataclass


def _bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    return int(raw) if raw else default


@dataclass(frozen=True)
class Config:
    secret_key: str
    sqlalchemy_database_uri: str
    public_base_url: str
    cookie_secure: bool
    session_ttl_hours: int
    token_pepper: bytes
    uid_secret: bytes
    session_secret: bytes
    max_sync_range_days: int
    max_lessons_per_sync: int
    auth_dev_login: bool
    owner_bootstrap_email: str | None
    owner_bootstrap_password: str | None
    auth_login_max_failures: int
    auth_login_window_minutes: int
    auth_login_lockout_minutes: int


def load_config() -> Config:
    node_env = os.environ.get("NODE_ENV", os.environ.get("FLASK_ENV", "development"))
    token_pepper_raw = os.environ.get("TOKEN_PEPPER", "")
    uid_secret_raw = os.environ.get("UID_SECRET", "")
    session_secret_raw = os.environ.get("SESSION_SECRET", "")

    if not token_pepper_raw or not uid_secret_raw:
        if node_env == "production":
            raise RuntimeError("TOKEN_PEPPER and UID_SECRET are required in production")
        token_pepper_raw = token_pepper_raw or "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
        uid_secret_raw = uid_secret_raw or "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB="

    if not session_secret_raw:
        if node_env == "production":
            raise RuntimeError("SESSION_SECRET is required in production")
        session_secret_raw = uid_secret_raw

    import base64

    token_pepper = base64.b64decode(token_pepper_raw)
    uid_secret = base64.b64decode(uid_secret_raw)
    session_secret = base64.b64decode(session_secret_raw)

    db_path = os.environ.get("DATABASE_PATH", "./data/seqta.db")
    owner_email = os.environ.get("OWNER_BOOTSTRAP_EMAIL", "").strip().lower() or None
    owner_password = os.environ.get("OWNER_BOOTSTRAP_PASSWORD") or None

    return Config(
        secret_key=session_secret_raw,
        sqlalchemy_database_uri=f"sqlite:///{db_path}",
        public_base_url=os.environ.get("PUBLIC_BASE_URL", "http://127.0.0.1:3210"),
        cookie_secure=_bool("COOKIE_SECURE", node_env == "production"),
        session_ttl_hours=_int("SESSION_TTL_HOURS", 168),
        token_pepper=token_pepper,
        uid_secret=uid_secret,
        session_secret=session_secret,
        max_sync_range_days=_int("MAX_SYNC_RANGE_DAYS", 120),
        max_lessons_per_sync=_int("MAX_LESSONS_PER_SYNC", 2000),
        auth_dev_login=_bool("AUTH_DEV_LOGIN", node_env != "production"),
        owner_bootstrap_email=owner_email,
        owner_bootstrap_password=owner_password,
        auth_login_max_failures=_int("AUTH_LOGIN_MAX_FAILURES", 5),
        auth_login_window_minutes=_int("AUTH_LOGIN_WINDOW_MINUTES", 15),
        auth_login_lockout_minutes=_int("AUTH_LOGIN_LOCKOUT_MINUTES", 15),
    )
