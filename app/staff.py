"""Super-admins add team members with limited console access.

A staff account (role "staff") signs in like anyone else and lands in the
admin console, but only sees and uses the areas its permissions allow (see
app.auth.STAFF_PERMISSIONS). Fares, zones and places, app settings,
suspending or removing accounts, and managing staff stay with super-admins.
"""

from __future__ import annotations

import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.auth import STAFF_PERMISSIONS, hash_password, require_super_admin, staff_permissions
from app.contacts import ContactError, clean_email, clean_name, clean_phone
from app.database import get_db
from app.device_sessions import forget_all
from app.models import AuditLog, Driver, User

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
    }


class StaffIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    full_name: str = Field(min_length=2, max_length=160)
    phone: str = Field(min_length=7, max_length=32)
    email: str | None = Field(default=None, max_length=254)
    permissions: list[str] = Field(min_length=1, max_length=10)
    # The phone already has a passenger account: turn that account into a
    # staff account (they keep their own password).
    use_existing_account: bool = False


@router.post("", status_code=201)
def add_staff(payload: StaffIn, db: Session = Depends(get_db), admin: User = Depends(require_super_admin)) -> dict:
    permissions = _clean_permissions(payload.permissions)
    try:
        name = clean_name(payload.full_name)
        phone = clean_phone(payload.phone)
        email = clean_email(payload.email) if payload.email else None
    except ContactError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    if not phone:
        raise HTTPException(status_code=422, detail="Enter a phone number.")

    existing = db.scalar(select(User).where(or_(User.phone == phone, *( [User.email == email] if email else []))))
    now = datetime.now(timezone.utc)
    if existing is not None:
        if existing.removed_at is not None:
            raise HTTPException(status_code=409, detail="That phone number or email belongs to a removed account.")
        if existing.role in ("super_admin", "staff"):
            raise HTTPException(status_code=409, detail=f"{existing.full_name} is already on the team.")
        if existing.role == "driver" or db.scalar(select(Driver.id).where(Driver.user_id == existing.id)):
            raise HTTPException(status_code=409, detail="That number belongs to a driver account. Use a different "
                                                        "number for the staff account.")
        if not payload.use_existing_account:
            raise HTTPException(status_code=409, detail={
                "code": "existing_account",
                "message": f"{existing.full_name} already uses EkiMove with this number as a passenger. "
                           "You can make that account a staff account (they keep their password, but can no "
                           "longer book rides with it), or use a different number.",
            })
        existing.role = "staff"
        existing.staff_permissions = permissions
        db.add(AuditLog(actor_user_id=admin.id, action="staff.added", entity_type="user", entity_id=str(existing.id),
                        details=f"existing account; {', '.join(permissions)}"))
        db.commit()
        return {"member": _row(db, existing), "temporary_password": None}

    temporary = _temporary_password()
    user = User(full_name=name, phone=phone, email=email, role="staff", staff_permissions=permissions,
                password_hash=hash_password(temporary), must_change_password=True, is_active=True, created_at=now)
    db.add(user)
    db.flush()
    db.add(AuditLog(actor_user_id=admin.id, action="staff.added", entity_type="user", entity_id=str(user.id),
                    details=", ".join(permissions)))
    db.commit()
    db.refresh(user)
    return {"member": _row(db, user), "temporary_password": temporary}


def _staff_member(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if user is None or user.removed_at is not None:
        raise HTTPException(status_code=404, detail="Team member not found.")
    if user.role == "super_admin":
        raise HTTPException(status_code=409, detail="Super-admins already have full access.")
    if user.role != "staff":
        raise HTTPException(status_code=404, detail="Team member not found.")
    return user


class PermissionsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    permissions: list[str] = Field(min_length=1, max_length=10)


@router.patch("/{user_id}")
def update_staff(user_id: int, payload: PermissionsIn, db: Session = Depends(get_db),
                 admin: User = Depends(require_super_admin)) -> dict:
    user = _staff_member(db, user_id)
    user.staff_permissions = _clean_permissions(payload.permissions)
    db.add(AuditLog(actor_user_id=admin.id, action="staff.permissions_changed", entity_type="user",
                    entity_id=str(user.id), details=", ".join(user.staff_permissions)))
    db.commit()
    return _row(db, user)


@router.post("/{user_id}/remove-access")
def remove_access(user_id: int, db: Session = Depends(get_db), admin: User = Depends(require_super_admin)) -> dict:
    """Take away console access. The account becomes an ordinary passenger
    account, and remembered phones must sign in again."""
    user = _staff_member(db, user_id)
    user.role = "passenger"
    user.staff_permissions = None
    forget_all(db, user.id)
    db.add(AuditLog(actor_user_id=admin.id, action="staff.removed", entity_type="user", entity_id=str(user.id)))
    db.commit()
    return {"removed": True, "id": user.id}


@router.post("/{user_id}/reset-password")
def reset_staff_password(user_id: int, db: Session = Depends(get_db),
                         admin: User = Depends(require_super_admin)) -> dict:
    user = _staff_member(db, user_id)
    temporary = _temporary_password()
    user.password_hash = hash_password(temporary)
    user.must_change_password = True
    forget_all(db, user.id)
    db.add(AuditLog(actor_user_id=admin.id, action="password.admin_reset", entity_type="user",
                    entity_id=str(user.id), details="staff account"))
    db.commit()
    return {"temporary_password": temporary, "member": _row(db, user)}
