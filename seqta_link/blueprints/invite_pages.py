from __future__ import annotations

from flask import Blueprint, flash, redirect, render_template, request, url_for, current_app

from seqta_link.models import Invitation, utcnow
from seqta_link.services.auth import AuthService

bp = Blueprint("invite", __name__)


@bp.route("/invite", methods=["GET", "POST"])
def accept_invite():
    token = request.args.get("token", "")
    auth = AuthService(current_app.config["APP_CONFIG"])
    invitation = Invitation.query.filter_by(token_hash=auth.hash_invite(token)).first()
    preview = None
    error = None
    if not invitation or invitation.used_at:
        error = "Invitation not found or already used."
    elif invitation.expires_at < utcnow():
        error = "Invitation has expired."
    else:
        preview = invitation

    if request.method == "GET":
        return render_template("invite/accept.html", preview=preview, error=error, token=token)

    if error or not preview:
        flash(error or "Invalid invitation.", "error")
        return render_template("invite/accept.html", preview=None, error=error, token=token)

    email = request.form.get("email", "")
    password = request.form.get("password", "")
    display_name = request.form.get("display_name")
    try:
        session_token, user = auth.register_with_invitation(preview, email, password, display_name)
        resp = redirect(url_for("pages_app.dashboard"))
        auth.set_session_cookie(resp, session_token)
        flash(f"Welcome, {user.display_name}! Your account is ready.", "success")
        return resp
    except Exception as e:
        from seqta_link.errors import AppError

        flash(e.message if isinstance(e, AppError) else str(e), "error")
        return render_template("invite/accept.html", preview=preview, error=None, token=token)
