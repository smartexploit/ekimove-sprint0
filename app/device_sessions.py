""""Keep me signed in" for passengers and drivers.

Closing the app no longer means signing in from scratch. At sign-in the
phone receives a random device token (kept in the app's storage); when the
person comes back, the app shows "Welcome back" and asks only for their
password, or a 4–6 digit PIN they chose on that phone. A PIN only works
together with that phone's token, so it's useless anywhere else.

Five wrong tries forget the phone (full sign-in needed). Changing or
resetting the password, signing out, or suspension ends all remembered
phones. Remembered phones expire after 60 days without use.
Staff accounts always use a full sign-in.
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.auth import create_access_token, get_current_user, hash_password, verify_password
from app.client_ip import client_ip
from app.config import settings
from app.database import get_db
from app.models import AuditLog, DeviceSession, User
from app.rate_limit import enforce as enforce_rate_limit

router = APIRouter(prefix="/api/v1", tags=["authentication"])

REMEMBER_DAYS = 60
MAX_FAILURES = 5
REMEMBER_ROLES = ("passenger", "driver")
WEAK_PINS = {"0000", "1111", "2222", "3333", "4444", "5555", "6666", "7777", "8888", "9999", "1234", "4321",
             "12345", "123456", "654321", "000000", "111111", "1212", "2580", "0852", "1122", "2000"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def remember_device(db: Session, user: User, label: str | None) -> str | None:
    """Create a remembered-phone token at sign-in (passengers and drivers)."""
    if user.role not in REMEMBER_ROLES:
        return None
    token = secrets.token_urlsafe(32)
    db.add(DeviceSession(user_id=user.id, token_hash=_hash(token), label=(label or "")[:120] or None,
                         expires_at=_now() + timedelta(days=REMEMBER_DAYS)))
    return token


def forget_all(db: Session, user_id: int) -> None:
    """End every remembered phone (password changed or reset, account suspended)."""
    db.execute(update(DeviceSession).where(DeviceSession.user_id == user_id, DeviceSession.revoked_at.is_(None))
               .values(revoked_at=_now()))


def _session(db: Session, token: str) -> tuple[DeviceSession, User]:
    gone = HTTPException(status_code=401, detail="Please sign in again.")
    if not token or len(token) > 100:
        raise gone
    row = db.scalar(select(DeviceSession).where(DeviceSession.token_hash == _hash(token)))
    if row is None or row.revoked_at is not None or _aware(row.expires_at) < _now():
        raise gone
    user = db.get(User, row.user_id)
    if user is None or not user.is_active or user.role not in REMEMBER_ROLES:
        raise gone
    return row, user


def _first(user: User) -> str:
    return (user.full_name or "there").split()[0]


def _masked(user: User) -> str:
    if user.phone:
        return f"{user.phone[:4]} ••• {user.phone[-4:]}"
    if user.email:
        name, _, domain = user.email.partition("@")
        return f"{name[:2]}•••@{domain}"
    return ""


class DeviceIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    device_token: str = Field(min_length=20, max_length=100)


@router.post("/auth/device")
def device_info(payload: DeviceIn, request: Request, db: Session = Depends(get_db)) -> dict:
    """Who this phone remembers, for the "Welcome back" screen."""
    enforce_rate_limit("device-info", f"ip:{client_ip(request)}", 60, 600, "Please wait a moment and try again.")
    row, user = _session(db, payload.device_token)
    return {"first_name": _first(user), "role": user.role, "account": _masked(user), "has_pin": bool(row.pin_hash)}


class UnlockIn(DeviceIn):
    password: str | None = Field(default=None, min_length=1, max_length=256)
    pin: str | None = Field(default=None, min_length=4, max_length=6, pattern=r"^\d{4,6}$")


@router.post("/auth/unlock")
def unlock(payload: UnlockIn, request: Request, db: Session = Depends(get_db)) -> dict:
    """Sign back in on a remembered phone with the password or this phone's PIN."""
    enforce_rate_limit("device-unlock", f"ip:{client_ip(request)}", 30, 600,
                       "Too many tries. Please wait a few minutes.")
    if (payload.password is None) == (payload.pin is None):
        raise HTTPException(status_code=422, detail="Enter your PIN or your password.")
    row, user = _session(db, payload.device_token)
    if payload.pin is not None:
        ok = bool(row.pin_hash) and verify_password(payload.pin, row.pin_hash)
    else:
        ok = verify_password(payload.password, user.password_hash)
    if not ok:
        row.failed_attempts += 1
        left = MAX_FAILURES - row.failed_attempts
        if left <= 0:
            row.revoked_at = _now()
            db.add(AuditLog(actor_user_id=user.id, action="auth.device_locked", entity_type="user",
                            entity_id=str(user.id), details="Remembered phone forgotten after 5 wrong tries."))
            db.commit()
            raise HTTPException(status_code=401, detail="Too many wrong tries. For your safety, please sign in "
                                                        "again with your phone number or email.")
        db.commit()
        what = "PIN" if payload.pin is not None else "password"
        raise HTTPException(status_code=401, detail=f"That {what} isn't right. {left} "
                                                    f"{'try' if left == 1 else 'tries'} left.")
    row.failed_attempts = 0
    row.last_used_at = _now()
    row.expires_at = _now() + timedelta(days=REMEMBER_DAYS)
    db.add(AuditLog(actor_user_id=user.id, action="auth.unlock", entity_type="user", entity_id=str(user.id),
                    details="Signed back in on a remembered phone with " +
                            ("PIN." if payload.pin is not None else "password.")))
    db.commit()
    return {"access_token": create_access_token(user), "token_type": "bearer",
            "expires_in": settings.access_token_expire_minutes * 60, "has_pin": bool(row.pin_hash)}


class PinIn(DeviceIn):
    pin: str = Field(min_length=4, max_length=6, pattern=r"^\d{4,6}$")


@router.post("/me/device-pin")
def set_device_pin(payload: PinIn, current_user: User = Depends(get_current_user),
                   db: Session = Depends(get_db)) -> dict:
    """Choose a quick PIN for this phone (needs a signed-in session)."""
    row, user = _session(db, payload.device_token)
    if user.id != current_user.id:
        raise HTTPException(status_code=401, detail="Please sign in again.")
    if payload.pin in WEAK_PINS or len(set(payload.pin)) == 1:
        raise HTTPException(status_code=422, detail="That PIN is too easy to guess. Choose a less obvious one.")
    row.pin_hash = hash_password(payload.pin)
    row.failed_attempts = 0
    db.commit()
    return {"has_pin": True}


@router.post("/auth/forget-device")
def forget_device(payload: DeviceIn, db: Session = Depends(get_db)) -> dict:
    """Sign out completely on this phone."""
    row = db.scalar(select(DeviceSession).where(DeviceSession.token_hash == _hash(payload.device_token)))
    if row is not None and row.revoked_at is None:
        row.revoked_at = _now()
        db.commit()
    return {"forgotten": True}
