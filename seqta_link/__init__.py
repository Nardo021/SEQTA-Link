from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, g, render_template

from seqta_link.config import Config, load_config
from seqta_link.errors import AppError
from seqta_link.extensions import db, migrate
from sqlalchemy import text

from seqta_link.services.auth import AuthService

_PKG = Path(__file__).resolve().parent


def create_app(config: Config | None = None) -> Flask:
    load_dotenv()
    app_config = config or load_config()

    app = Flask(
        __name__,
        template_folder=str(_PKG / "templates"),
        static_folder=str(_PKG / "static"),
    )
    app.config["SECRET_KEY"] = app_config.secret_key
    app.config["SQLALCHEMY_DATABASE_URI"] = app_config.sqlalchemy_database_uri
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    app.config["APP_CONFIG"] = app_config

    db.init_app(app)
    migrate.init_app(app, db)

    from seqta_link.blueprints.health import bp as health_bp
    from seqta_link.blueprints.auth_pages import bp as auth_bp
    from seqta_link.blueprints.pages_app import bp as app_bp
    from seqta_link.blueprints.pages_admin import bp as admin_bp
    from seqta_link.blueprints.invite_pages import bp as invite_bp
    from seqta_link.blueprints.api_v2 import bp as api_bp
    from seqta_link.blueprints.calendar_feed import bp as feed_bp

    app.register_blueprint(health_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(app_bp)
    app.register_blueprint(admin_bp)
    app.register_blueprint(invite_bp)
    app.register_blueprint(api_bp)
    app.register_blueprint(feed_bp)

    @app.before_request
    def load_user():
        auth = AuthService(app_config)
        g.current_user = auth.validate_session(auth.read_session_from_request())

    @app.errorhandler(AppError)
    def handle_app_error(e: AppError):
        from flask import jsonify, request

        if request.path.startswith("/api/"):
            return (
                jsonify({"error": {"code": e.code, "message": e.message, "details": e.details}}),
                e.status,
            )
        from flask import flash, redirect, request as req

        flash(e.message, "error")
        return redirect(req.referrer or "/")

    @app.errorhandler(403)
    def forbidden(_e):
        return render_template("errors/403.html"), 403

    @app.errorhandler(404)
    def not_found(_e):
        return render_template("errors/404.html"), 404

    @app.errorhandler(500)
    def server_error(_e):
        return render_template("errors/500.html"), 500

    @app.get("/")
    def index():
        from flask import redirect, url_for

        return render_template(
            "index.html",
            logged_in=g.current_user is not None,
        )

    @app.cli.command("init-db")
    def init_db():
        """Create database tables."""
        Path(os.environ.get("DATABASE_PATH", "./data/seqta.db")).parent.mkdir(parents=True, exist_ok=True)
        with app.app_context():
            db.create_all()
            db.session.execute(text("PRAGMA journal_mode=WAL"))
            db.session.commit()
        print("Database initialized.")

    @app.cli.command("bootstrap-owner")
    def bootstrap_owner():
        """Create owner account from env or args."""
        import click

        email = click.prompt("Email", default=app_config.owner_bootstrap_email or "owner@local.test")
        password = click.prompt("Password", hide_input=True, confirmation_prompt=True)
        with app.app_context():
            auth = AuthService(app_config)
            user = auth.bootstrap_owner(email, password)
            print(f"Owner ensured: {user.email} ({user.id})")

    @app.cli.command("backup")
    def backup_db():
        """Copy SQLite database to backups/ with timestamp."""
        import shutil
        from datetime import datetime

        db_path = app_config.sqlalchemy_database_uri.replace("sqlite:///", "")
        dest_dir = Path("backups")
        dest_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
        dest = dest_dir / f"seqta-{stamp}.db"
        shutil.copy2(db_path, dest)
        print(f"Backup written to {dest}")

    with app.app_context():
        db_path = app_config.sqlalchemy_database_uri.replace("sqlite:///", "")
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        db.create_all()
        db.session.execute(text("PRAGMA journal_mode=WAL"))
        db.session.commit()
        if app_config.owner_bootstrap_email and app_config.owner_bootstrap_password:
            auth = AuthService(app_config)
            auth.bootstrap_owner(
                app_config.owner_bootstrap_email,
                app_config.owner_bootstrap_password,
            )

    return app
