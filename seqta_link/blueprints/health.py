from __future__ import annotations

from flask import Blueprint, jsonify

from sqlalchemy import text

from seqta_link.extensions import db

bp = Blueprint("health", __name__)


@bp.get("/health/live")
def live():
    return jsonify({"status": "ok"})


@bp.get("/health/ready")
def ready():
    try:
        db.session.execute(text("SELECT 1"))
        return jsonify({"status": "ready", "database": "ok"})
    except Exception as e:
        return jsonify({"status": "not_ready", "error": str(e)}), 503
