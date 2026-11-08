"""Super-admins add team members with limited console access.

A staff account (role "staff") signs in with a work email on EkiMove's own
domain (settings.staff_email_domain) and lands in the admin console, but only sees and uses the areas its permissions allow (see
app.auth.STAFF_PERMISSIONS). Fares, zones and places, app settings,
suspending or removing accounts, and managing staff stay with super-admins.
"""

from __future__ import annotations

import secrets
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import STAFF_PERMISSIONS, hash_password, require_super_admin, staff_permissions
from app.config import settings
from app.contacts import ContactError, clean_email, clean_name
from app.database import get_db
from app.device_sessions import forget_all
from app.models import AuditLog, User

router = APIRouter(prefix="/api/v1/admin/staff", tags=["staff"])

TEMP_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
# Ready-made sets for common jobs (the console shows these as presets).
PRESETS = {
    "dispatcher": ["dispatch"],
    "driver_reviewer": ["drivers", "dispatch"],
    "support_agent": ["support", "dispatch"],
    "finance": ["finance"],
    "website_editor": ["website"],
}


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).isoformat()


def _clean_permissions(values: list[str]) -> list[str]:
    chosen = [p for p in dict.fromkeys(values) if p in STAFF_PERMISSIONS]
    unknown = set(values) - set(STAFF_PERMISSIONS)
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unknown permission: {', '.join(sorted(unknown))}.")
    if not chosen:
        raise HTTPException(status_code=422, detail="Choose at least one area this person can use.")
    return chosen


def _row(db: Session, user: User) -> dict:
    last_login = db.scalar(select(AuditLog.created_at).where(
        AuditLog.actor_user_id == user.id, AuditLog.action == "auth.login").order_by(AuditLog.id.desc()).limit(1))
    return {
        "id": user.id,
        "full_name": user.full_name,
        "phone": user.phone,
        "email": user.email,
        "role": user.role,
        "permissions": staff_permissions(user),
        "is_active": user.is_active,
        "must_change_password": bool(user.must_change_password),
        "last_sign_in": _iso(last_login),
        "created_at": _iso(user.created_at),
    }


def _temporary_password() -> str:
    return "-".join("".join(secrets.choice(TEMP_ALPHABET) for _ in range(4)) for _ in range(3))


@router.get("")
def list_staff(db: Session = Depends(get_db), _admin: User = Depends(require_super_admin)) -> dict:
    team = db.scalars(select(User).where(User.role.in_(("super_admin", "staff")), User.removed_at.is_(None))
                      .order_by(User.role.desc(), User.full_name)).all()
    return {
        "team": [_row(db, user) for user in team],
        "permissions": [{"key": key, "label": label} for key, label in STAFF_PERMISSIONS.items()],
        "presets": PRESETS,
        "email_domain": settings.staff_email_domain.strip().lower().lstrip("@"),
    }


class StaffIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    full_name: str = Field(min_length=2, max_length=160)
    # Team members sign in with this work email only (e.g. tolu@ekimove.com.ng).
    email: str = Field(min_length=6, max_length=254)
    role: Literal["staff", "super_admin"] = "staff"
    permissions: list[str] = Field(default_factory=list, max_length=10)


def _work_email(value: str) -> str:
    try:
        email = clean_email(value)
    except ContactError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    domain = settings.staff_email_domain.strip().lower().lstrip("@")
    if not email or (domain and not email.endswith("@" + domain)):
        raise HTTPException(status_code=422, detail=f"Use their work email ending in @{domain}.")
    return email


@router.post("", status_code=201)
def add_staff(payload: StaffIn, db: Session = Depends(get_db), admin: User = Depends(require_super_admin)) -> dict:
    super_admin = payload.role == "super_admin"
    permissions = None if super_admin else _clean_permissions(payload.permissions)
    try:
        name = clean_name(payload.full_name)
    except ContactError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    email = _work_email(payload.email)

    temporary = _temporary_password()
    user = db.scalar(select(User).where(User.email == email))
    if user is not None:
        if user.role in ("super_admin", "staff") and user.removed_at is None:
            raise HTTPException(status_code=409, detail=f"{user.full_name} is already on the team.")
        # A former team member's work account (no phone, not removed) can come back.
        former_staff = user.removed_at is None and user.role == "passenger" and not user.phone and db.scalar(
            select(AuditLog.id).where(AuditLog.entity_type == "user", AuditLog.entity_id == str(user.id),
                                      AuditLog.action == "staff.removed").limit(1))
        if not former_staff:
            raise HTTPException(status_code=409, detail="That email is already used by another EkiMove account.")
        user.full_name = name
        user.is_active = True
        user.suspended_at = None
    else:
        user = User(full_name=name, email=email, phone=None, is_active=True, created_at=datetime.now(timezone.utc))
        db.add(user)
    user.role = "super_admin" if super_admin else "staff"
    user.staff_permissions = permissions
    user.password_hash = hash_password(temporary)
    user.must_change_password = True
    db.flush()
    db.add(AuditLog(actor_user_id=admin.id, action="staff.added_super_admin" if super_admin else "staff.added",
                    entity_type="user", entity_id=str(user.id),
                    details="full access" if super_admin else ", ".join(permissions)))
    if super_admin:
        from app.push import notify  # avoid an import cycle

        others = [uid for uid in db.scalars(select(User.id).where(
            User.role == "super_admin", User.is_active.is_(True), User.id.notin_((admin.id, user.id)))).all()]
        notify(db, others, "New super-admin added", f"{admin.full_name} gave {name} full access to the console.",
               url="/admin/team", tag=f"super-admin-{user.id}")
    db.commit()
    db.refresh(user)
    return {"member": _row(db, user), "temporary_password": temporary}


def _staff_member(db: Session, user_id: int, admin: User, *, allow_super_admin: bool = False) -> User:
    user = db.get(User, user_id)
    if user is None or user.removed_at is not None or user.role not in ("staff", "super_admin"):
        raise HTTPException(status_code=404, detail="Team member not found.")
    if user.id == admin.id:
        raise HTTPException(status_code=409, detail="You can't change your own access here.")
    if user.role == "super_admin" and not allow_super_admin:
        raise HTTPException(status_code=409, detail="Super-admins already have full access.")
    return user


class PermissionsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    permissions: list[str] = Field(min_length=1, max_length=10)


@router.patch("/{user_id}")
def update_staff(user_id: int, payload: PermissionsIn, db: Session = Depends(get_db),
                 admin: User = Depends(require_super_admin)) -> dict:
    user = _staff_member(db, user_id, admin)
    user.staff_permissions = _clean_permissions(payload.permissions)
    db.add(AuditLog(actor_user_id=admin.id, action="staff.permissions_changed", entity_type="user",
                    entity_id=str(user.id), details=", ".join(user.staff_permissions)))
    db.commit()
    return _row(db, user)


@router.post("/{user_id}/remove-access")
def remove_access(user_id: int, db: Session = Depends(get_db), admin: User = Depends(require_super_admin)) -> dict:
    """Take away console access. The account becomes an ordinary passenger
    account, and remembered phones must sign in again. A super-admin can be
    removed too, as long as another active super-admin remains."""
    user = _staff_member(db, user_id, admin, allow_super_admin=True)
    if user.role == "super_admin":
        remaining = db.scalar(select(func.count(User.id)).where(
            User.role == "super_admin", User.is_active.is_(True), User.removed_at.is_(None), User.id != user.id)) or 0
        if remaining < 1:
            raise HTTPException(status_code=409, detail="EkiMove needs at least one super-admin.")
    user.role = "passenger"
    user.staff_permissions = None
    forget_all(db, user.id)
    db.add(AuditLog(actor_user_id=admin.id, action="staff.removed", entity_type="user", entity_id=str(user.id)))
    db.commit()
    return {"removed": True, "id": user.id}


@router.post("/{user_id}/reset-password")
def reset_staff_password(user_id: int, db: Session = Depends(get_db),
                         admin: User = Depends(require_super_admin)) -> dict:
    user = _staff_member(db, user_id, admin, allow_super_admin=True)
    temporary = _temporary_password()
    user.password_hash = hash_password(temporary)
    user.must_change_password = True
    forget_all(db, user.id)
    db.add(AuditLog(actor_user_id=admin.id, action="password.admin_reset", entity_type="user",
                    entity_id=str(user.id), details="staff account"))
    db.commit()
    return {"temporary_password": temporary, "member": _row(db, user)}
