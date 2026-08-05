import os
import tempfile

import pytest

from seqta_link import create_app
from seqta_link.config import Config
from seqta_link.extensions import db


@pytest.fixture()
def app():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    config = Config(
        secret_key="test-secret-key-32bytes-minimum!!",
        sqlalchemy_database_uri=f"sqlite:///{path}",
        public_base_url="http://127.0.0.1:3210",
        cookie_secure=False,
        session_ttl_hours=168,
        token_pepper=b"x" * 32,
        uid_secret=b"y" * 32,
        session_secret=b"z" * 32,
        max_sync_range_days=120,
        max_lessons_per_sync=2000,
        auth_dev_login=True,
        owner_bootstrap_email=None,
        owner_bootstrap_password=None,
        auth_login_max_failures=5,
        auth_login_window_minutes=15,
        auth_login_lockout_minutes=15,
    )
    application = create_app(config)
    application.config["TESTING"] = True
    yield application
    os.unlink(path)


@pytest.fixture()
def client(app):
    return app.test_client()


@pytest.fixture()
def owner(app):
    from seqta_link.services.auth import AuthService

    with app.app_context():
        auth = AuthService(app.config["APP_CONFIG"])
        user = auth.bootstrap_owner("owner@test.local", "OwnerPass123!")
        db.session.commit()
        return user
