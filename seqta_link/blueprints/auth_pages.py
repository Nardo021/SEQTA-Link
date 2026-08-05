from __future__ import annotations

from flask import Blueprint, flash, redirect, render_template, request, url_for, current_app

from seqta_link.extensions import db
from seqta_link.services.auth import AuthService, admin_required, login_required
from seqta_link.services.brute_force import BruteForceGuard

bp = Blueprint("auth", __name__)


def _login_guard() -> BruteForceGuard:
    config = current_app.config["APP_CONFIG"]
    return BruteForceGuard(
        config.auth_login_max_failures,
        config.auth_login_window_minutes * 60,
        config.auth_login_lockout_minutes * 60,
    )


@bp.route("/app/login", methods=["GET", "POST"])
def login():
    auth = AuthService(current_app.config["APP_CONFIG"])
    if request.method == "GET":
        user = auth.validate_session(auth.read_session_from_request())
        if user:
            return redirect(url_for("pages_app.dashboard"))
        return render_template("auth/login.html", admin=False)

    email = request.form.get("email", "")
    password = request.form.get("password", "")
    guard = _login_guard()
    ip_key = f"login-ip:{request.remote_addr}"
    email_key = f"login-email:{email.strip().lower()}"
    try:
        guard.assert_allowed(ip_key)
        guard.assert_allowed(email_key)
        token, user = auth.login(email, password)
        guard.record_success(ip_key)
        guard.record_success(email_key)
        next_url = request.args.get("next") or url_for("pages_app.dashboard")
        resp = redirect(next_url)
        auth.set_session_cookie(resp, token)
        flash(f"Welcome back, {user.display_name}.", "success")
        return resp
    except PermissionError:
        flash("Too many failed attempts. Try again later.", "error")
    except Exception as e:
        from seqta_link.errors import AppError

        guard.record_failure(ip_key)
        guard.record_failure(email_key)
        msg = e.message if isinstance(e, AppError) else "Sign in failed."
        flash(msg, "error")
    return render_template("auth/login.html", admin=False)


@bp.route("/admin/login", methods=["GET", "POST"])
def admin_login():
    auth = AuthService(current_app.config["APP_CONFIG"])
    if request.method == "GET":
        user = auth.validate_session(auth.read_session_from_request())
        if user and user.role in ("owner", "admin"):
            return redirect(url_for("pages_admin.dashboard"))
        return render_template("auth/login.html", admin=True)

    email = request.form.get("email", "")
    password = request.form.get("password", "")
    guard = _login_guard()
    ip_key = f"login-ip:{request.remote_addr}"
    email_key = f"login-email:{email.strip().lower()}"
    try:
        guard.assert_allowed(ip_key)
        guard.assert_allowed(email_key)
        token, user = auth.login(email, password)
        if user.role not in ("owner", "admin"):
            auth.logout(token)
            flash("This account is not an administrator.", "error")
            return render_template("auth/login.html", admin=True)
        guard.record_success(ip_key)
        guard.record_success(email_key)
        next_url = request.args.get("next") or url_for("pages_admin.dashboard")
        resp = redirect(next_url)
        auth.set_session_cookie(resp, token)
        flash(f"Signed in as {user.display_name}.", "success")
        return resp
    except PermissionError:
        flash("Too many failed attempts. Try again later.", "error")
    except Exception as e:
        from seqta_link.errors import AppError

        guard.record_failure(ip_key)
        guard.record_failure(email_key)
        msg = e.message if isinstance(e, AppError) else "Sign in failed."
        flash(msg, "error")
    return render_template("auth/login.html", admin=True)


@bp.post("/auth/logout")
def logout():
    auth = AuthService(current_app.config["APP_CONFIG"])
    auth.logout(auth.read_session_from_request())
    resp = redirect(url_for("auth.login"))
    auth.clear_session_cookie(resp)
    flash("Signed out.", "success")
    return resp
