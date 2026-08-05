from __future__ import annotations

import secrets
from datetime import timedelta

from flask import Blueprint, flash, redirect, render_template, request, url_for, current_app

from seqta_link.extensions import db
from seqta_link.models import AuditLog, Invitation, User, new_id, utcnow
from seqta_link.services.auth import admin_required, get_current_user
from seqta_link.services.dates import format_datetime_display

bp = Blueprint("pages_admin", __name__, url_prefix="/admin")


@bp.get("/")
@admin_required
def index():
    return redirect(url_for("pages_admin.dashboard"))


@bp.get("/dashboard")
@admin_required
def dashboard():
    users = User.query.filter(User.account_status != "deleted").all()
    active = sum(1 for u in users if u.account_status == "active")
    suspended = sum(1 for u in users if u.account_status == "suspended")
    pending = Invitation.query.filter(Invitation.used_at.is_(None), Invitation.expires_at > utcnow()).count()
    recent = AuditLog.query.order_by(AuditLog.created_at.desc()).limit(8).all()
    return render_template(
        "admin/dashboard.html",
        total=len(users),
        active=active,
        suspended=suspended,
        pending=pending,
        recent=recent,
        format_dt=format_datetime_display,
    )


@bp.get("/users")
@admin_required
def users():
    rows = User.query.filter(User.account_status != "deleted").order_by(User.created_at.desc()).all()
    return render_template("admin/users.html", users=rows, format_dt=format_datetime_display)


@bp.route("/users/<user_id>", methods=["GET", "POST"])
@admin_required
def user_detail(user_id: str):
    from seqta_link.models import Calendar, Device, Event, SourceIdentity, SyncRun

    target = User.query.get_or_404(user_id)
    cal = Calendar.query.filter_by(owner_user_id=user_id).first()
    identity = SourceIdentity.query.filter_by(calendar_id=cal.id).first() if cal else None

    if request.method == "POST":
        action = request.form.get("action")
        actor = get_current_user()
        if action == "update":
            target.display_name = request.form.get("display_name", target.display_name).strip()
            target.max_devices = int(request.form.get("max_devices", target.max_devices))
            target.sync_enabled = request.form.get("sync_enabled") == "on"
            target.feed_enabled = request.form.get("feed_enabled") == "on"
            db.session.add(
                AuditLog(
                    id=new_id(),
                    actor_user_id=actor.id,
                    actor_type=actor.role,
                    target_user_id=target.id,
                    action="user.update",
                )
            )
            db.session.commit()
            flash("User updated.", "success")
        elif action == "suspend" and target.role not in ("owner",) and actor.id != target.id:
            target.account_status = "suspended"
            target.suspended_at = utcnow()
            db.session.commit()
            flash("User suspended.", "success")
        elif action == "activate":
            target.account_status = "active"
            target.suspended_at = None
            db.session.commit()
            flash("User activated.", "success")
        elif action == "reset_identity" and cal:
            confirm = request.form.get("confirm_name", "")
            if confirm == target.display_name:
                if identity:
                    identity.reset_at = utcnow()
                    identity.reset_by = actor.id
                Device.query.filter_by(owner_user_id=target.id, status="active").update(
                    {"status": "revoked", "revoked_at": utcnow()}
                )
                db.session.commit()
                flash("Source identity reset and devices revoked.", "success")
            else:
                flash("Confirmation name does not match.", "error")
        return redirect(url_for("pages_admin.user_detail", user_id=user_id))

    devices = Device.query.filter_by(owner_user_id=user_id).order_by(Device.created_at.desc()).all()
    runs = (
        SyncRun.query.filter_by(calendar_id=cal.id).order_by(SyncRun.started_at.desc()).limit(20).all()
        if cal
        else []
    )
    return render_template(
        "admin/user.html",
        target=target,
        calendar=cal,
        identity=identity,
        devices=devices,
        runs=runs,
        format_dt=format_datetime_display,
    )


@bp.get("/invitations")
@admin_required
def invitations():
    rows = Invitation.query.order_by(Invitation.created_at.desc()).limit(100).all()
    return render_template("admin/invitations.html", invitations=rows, format_dt=format_datetime_display)


@bp.post("/invitations")
@admin_required
def create_invitation():
    actor = get_current_user()
    config = current_app.config["APP_CONFIG"]
    from seqta_link.services.auth import AuthService

    auth = AuthService(config)
    raw = secrets.token_urlsafe(32)
    hours = int(request.form.get("expires_hours", 72))
    inv = Invitation(
        id=new_id(),
        token_hash=auth.hash_invite(raw),
        created_by=actor.id,
        expected_name=request.form.get("expected_name") or None,
        note=request.form.get("note") or None,
        sync_enabled=True,
        feed_enabled=True,
        max_devices=int(request.form.get("max_devices", 3)),
        expires_at=utcnow() + timedelta(hours=hours),
    )
    db.session.add(inv)
    db.session.commit()
    url = f"{config.public_base_url}/invite?token={raw}"
    flash(f"Invitation created: {url}", "success")
    return redirect(url_for("pages_admin.invitations"))


@bp.post("/invitations/<inv_id>/delete")
@admin_required
def delete_invitation(inv_id: str):
    inv = Invitation.query.get_or_404(inv_id)
    if not inv.used_at:
        db.session.delete(inv)
        db.session.commit()
        flash("Invitation deleted.", "success")
    return redirect(url_for("pages_admin.invitations"))


@bp.get("/audit")
@admin_required
def audit():
    rows = AuditLog.query.order_by(AuditLog.created_at.desc()).limit(100).all()
    return render_template("admin/audit.html", logs=rows, format_dt=format_datetime_display)
