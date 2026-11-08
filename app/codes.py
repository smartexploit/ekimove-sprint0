"""One-time codes by text message or email.

* Confirm the phone number or email address an account signs up with.
* Reset a forgotten password.
* Change (or add) the phone number or email address on an account.

Codes are 6 digits, last 10 minutes, allow 5 tries, and only a keyed hash
is stored. Each phone number or address can receive one code a minute
and 5 an hour. Everything here is off until SMS or email is configured
(see app/messaging.py); until then sign-up works without codes.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import messaging
from app.device_sessions import forget_all
from app.auth import get_current_user, hash_password, verify_password
from app.client_ip import client_ip
from app.config import settings
from app.contacts import (
    ContactError,
    clean_email,
    clean_phone,
    email_taken,
    find_user,
    is_email,
    mask_email,
    mask_phone,
    password_problem,
    phone_taken,
)
from app.rate_limit import enforce as enforce_rate_limit
from app.database import get_db
from app.models import AppSetting, AuditLog, User, VerificationCode

router = APIRouter(prefix="/api/v1", tags=["verification codes"])

CODE_MINUTES = 10
MAX_ATTEMPTS = 5
RESEND_SECONDS = 60
MAX_PER_HOUR = 5
# Each phone number or address gets at most this many codes a day, so a
# 6-digit code can't be ground down by asking again and again.
MAX_PER_DAY = 10
Channel = Literal["sms", "email"]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _hash(code: str, destination: str, purpose: str) -> str:
    key = (settings.jwt_secret_key or "ekimove-codes").encode("utf-8")
    return hmac.new(key, f"{purpose}:{destination}:{code}".encode("utf-8"), hashlib.sha256).hexdigest()


def channel_configured(channel: str) -> bool:
    return messaging.sms_configured() if channel == "sms" else messaging.email_configured()


def require_contact_verification(db: Session) -> bool:
    row = db.get(AppSetting, "require_contact_verification")
    return row is None or row.value == "true"


def contact_status(db: Session, user: User) -> dict:
    """What is verified, and what (if anything) the person must confirm now."""
    phone_ok = bool(user.phone and user.phone_verified_at)
    email_ok = bool(user.email and user.email_verified_at)
    needs = None
    if user.role != "super_admin" and not (phone_ok or email_ok) and require_contact_verification(db):
        if user.phone and messaging.sms_configured():
            needs = "sms"
        elif user.email and messaging.email_configured():
            needs = "email"
    return {
        "phone_verified": phone_ok,
        "email_verified": email_ok,
        "needs_verification": needs,
        "sms_available": messaging.sms_configured(),
        "email_available": messaging.email_configured(),
    }


def _message(code: str, purpose: str) -> tuple[str, str, str]:
    """(SMS text, email subject, email text). SMS stays plain ASCII so it
    is billed as a single 160-character page."""
    action = {
        "verify_contact": "confirm your account",
        "reset_password": "reset your password",
        "change_contact": "confirm this new contact",
    }[purpose]
    sms = f"Your EkiMove code is {code}. Use it to {action}. It expires in {CODE_MINUTES} minutes. Never share it."
    text = (
        f"Hello,\n\nYour EkiMove code is {code}.\n\nUse it to {action}. It expires in {CODE_MINUTES} minutes.\n\n"
        "EkiMove staff will never ask you for this code. If you didn't ask for it, you can ignore this email.\n\n"
        "EkiMove"
    )
    return sms, f"Your EkiMove code: {code}", text


def issue_code(db: Session, *, user: User | None, purpose: str, channel: str, destination: str) -> None:
    """Create and send a code. Raises 429 when asked too often and 502 when
    the provider can't send it."""
    now = _now()
    today = db.scalars(
        select(VerificationCode.created_at)
        .where(VerificationCode.destination == destination, VerificationCode.created_at >= now - timedelta(days=1))
        .order_by(VerificationCode.created_at.desc())
    ).all()
    recent = [created for created in today if _aware(created) >= now - timedelta(hours=1)]
    if recent:
        wait = RESEND_SECONDS - int((now - _aware(recent[0])).total_seconds())
        if wait > 0:
            raise HTTPException(status_code=429, detail=f"Please wait {wait} seconds before asking for another code.",
                                headers={"Retry-After": str(wait)})
    if len(recent) >= MAX_PER_HOUR:
        raise HTTPException(status_code=429, detail="Too many codes asked for. Please try again in an hour.",
                            headers={"Retry-After": "3600"})
    if len(today) >= MAX_PER_DAY:
        raise HTTPException(status_code=429, detail="Too many codes asked for today. Please try again tomorrow, "
                                                    "or message EkiMove support.", headers={"Retry-After": "3600"})

    # A daily ceiling on text messages caps the cost if someone abuses sign-up.
    if channel == "sms" and settings.sms_daily_limit > 0:
        sent_today = db.scalar(select(func.count(VerificationCode.id)).where(
            VerificationCode.channel == "sms", VerificationCode.created_at >= now - timedelta(days=1))) or 0
        if sent_today >= settings.sms_daily_limit:
            raise HTTPException(status_code=503, detail="Text message codes are busy right now. Please try again "
                                                        "later, or message EkiMove support.")

    # Older unused codes for the same thing stop working.
    for old in db.scalars(select(VerificationCode).where(
        VerificationCode.destination == destination, VerificationCode.purpose == purpose,
        VerificationCode.used_at.is_(None),
    )).all():
        old.used_at = now

    code = f"{secrets.randbelow(1_000_000):06d}"
    db.add(VerificationCode(
        user_id=user.id if user else None, purpose=purpose, channel=channel, destination=destination,
        code_hash=_hash(code, destination, purpose), expires_at=now + timedelta(minutes=CODE_MINUTES),
        created_at=now,
    ))
    db.flush()
    sms, subject, text = _message(code, purpose)
    try:
        if channel == "sms":
            messaging.send_sms(destination, sms)
        else:
            messaging.send_email(destination, subject, text)
    except messaging.MessagingError:
        db.rollback()
        where = "text message" if channel == "sms" else "email"
        raise HTTPException(status_code=502, detail=f"We couldn't send the {where} just now. Please try again "
                                                    "in a minute, or message EkiMove support.") from None
    db.commit()


def check_code(db: Session, *, user: User, purpose: str, code: str, destination: str | None = None) -> VerificationCode:
    """Accept the latest live code for this account and purpose, or raise 400."""
    query = select(VerificationCode).where(
        VerificationCode.user_id == user.id, VerificationCode.purpose == purpose, VerificationCode.used_at.is_(None),
    )
    if destination is not None:
        query = query.where(VerificationCode.destination == destination)
    record = db.scalars(query.order_by(VerificationCode.id.desc())).first()
    now = _now()
    if record is None or _aware(record.expires_at) < now:
        raise HTTPException(status_code=400, detail="This code has expired or was replaced. Ask for a new one.")
    record.attempts += 1
    supplied = "".join(ch for ch in str(code or "") if ch in "0123456789")
    if not hmac.compare_digest(record.code_hash, _hash(supplied, record.destination, purpose)):
        if record.attempts >= MAX_ATTEMPTS:
            record.used_at = now
            db.commit()
            raise HTTPException(status_code=400, detail="Too many wrong tries. Ask for a new code.")
        db.commit()
        left = MAX_ATTEMPTS - record.attempts
        raise HTTPException(status_code=400, detail=f"That code isn't right. {left} {'try' if left == 1 else 'tries'} left.")
    record.used_at = now
    return record


def _mark_verified(user: User, record: VerificationCode) -> None:
    if record.channel == "sms" and user.phone and record.destination == user.phone:
        user.phone_verified_at = record.used_at
    if record.channel == "email" and user.email and record.destination == user.email:
        user.email_verified_at = record.used_at


# --------------------------------------------------------------------------
# Public
# --------------------------------------------------------------------------


@router.get("/auth/options", tags=["authentication"])
def auth_options() -> dict:
    """Which code channels are switched on (the sign-up and sign-in pages
    use this to explain what will happen)."""
    sms, email = messaging.sms_configured(), messaging.email_configured()
    return {"sms": sms, "email": email, "password_reset": sms or email}


class ResetRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    identifier: str = Field(min_length=3, max_length=254)


GENERIC_RESET = "If an account uses that phone number or email, we've sent it a 6-digit code."


def _limit_codes(request: Request) -> None:
    enforce_rate_limit("codes", client_ip(request), settings.code_ip_limit_per_hour, 3600,
                       "Too many codes asked for from this connection. Please try again in an hour.")


def _limit_code_checks(request: Request) -> None:
    enforce_rate_limit("code-checks", client_ip(request), settings.code_check_ip_limit, 900,
                       "Too many codes tried from this connection. Please wait 15 minutes and try again.")


@router.post("/auth/password-reset/request", tags=["authentication"])
def request_password_reset(payload: ResetRequest, request: Request, db: Session = Depends(get_db)) -> dict:
    if not (messaging.sms_configured() or messaging.email_configured()):
        raise HTTPException(status_code=503, detail="Password reset by code isn't switched on yet. "
                                                    "Please message EkiMove support to reset your password.")
    _limit_codes(request)
    user = find_user(db, payload.identifier)
    if user is None or not user.is_active or user.removed_at is not None:
        return {"message": GENERIC_RESET}
    # Send to what they typed when possible, otherwise their other contact.
    options = [("email", user.email), ("sms", user.phone)]
    if not is_email(payload.identifier):
        options.reverse()
    for channel, destination in options:
        if destination and channel_configured(channel):
            try:
                issue_code(db, user=user, purpose="reset_password", channel=channel, destination=destination)
            except HTTPException as exc:
                # "Wait before asking again" would reveal that the account
                # exists, so those answers look like every other one.
                if exc.status_code != 429:
                    raise
            break
    return {"message": GENERIC_RESET}


class ResetConfirm(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    identifier: str = Field(min_length=3, max_length=254)
    code: str = Field(min_length=4, max_length=12)
    new_password: str = Field(min_length=12, max_length=128)


@router.post("/auth/password-reset/confirm", tags=["authentication"])
def confirm_password_reset(payload: ResetConfirm, request: Request, db: Session = Depends(get_db)) -> dict:
    _limit_code_checks(request)
    user = find_user(db, payload.identifier)
    if user is None or not user.is_active or user.removed_at is not None:
        raise HTTPException(status_code=400, detail="This code has expired or was replaced. Ask for a new one.")
    weak = password_problem(payload.new_password, name=user.full_name, phone=user.phone, email=user.email)
    if weak:
        raise HTTPException(status_code=422, detail=weak)
    record = check_code(db, user=user, purpose="reset_password", code=payload.code)
    user.password_hash = hash_password(payload.new_password)
    forget_all(db, user.id)  # remembered phones must sign in again
    user.must_change_password = False
    _mark_verified(user, record)
    db.add(AuditLog(actor_user_id=user.id, action="password.reset", entity_type="user", entity_id=str(user.id),
                    details=f"Password reset with a code sent by {'text' if record.channel == 'sms' else 'email'}."))
    db.commit()
    return {"message": "Your password has been changed. Sign in with your new password."}


# --------------------------------------------------------------------------
# Signed in: confirm my phone or email
# --------------------------------------------------------------------------


class VerifySend(BaseModel):
    model_config = ConfigDict(extra="forbid")
    channel: Channel


def _destination(user: User, channel: str) -> str:
    destination = user.phone if channel == "sms" else user.email
    if not destination:
        raise HTTPException(status_code=409, detail="Add this contact to your profile first.")
    return destination


@router.post("/me/verify/send")
def send_my_verification(payload: VerifySend, request: Request, current_user: User = Depends(get_current_user),
                         db: Session = Depends(get_db)) -> dict:
    if not channel_configured(payload.channel):
        raise HTTPException(status_code=503, detail="Codes by this route aren't switched on yet.")
    destination = _destination(current_user, payload.channel)
    if (current_user.phone_verified_at if payload.channel == "sms" else current_user.email_verified_at):
        raise HTTPException(status_code=409, detail="This is already confirmed.")
    _limit_codes(request)
    issue_code(db, user=current_user, purpose="verify_contact", channel=payload.channel, destination=destination)
    shown = mask_phone(destination) if payload.channel == "sms" else mask_email(destination)
    return {"sent_to": shown, "expires_in_minutes": CODE_MINUTES}


class VerifyConfirm(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    channel: Channel
    code: str = Field(min_length=4, max_length=12)


@router.post("/me/verify/confirm")
def confirm_my_verification(payload: VerifyConfirm, current_user: User = Depends(get_current_user),
                            db: Session = Depends(get_db)) -> dict:
    destination = _destination(current_user, payload.channel)
    record = check_code(db, user=current_user, purpose="verify_contact", code=payload.code, destination=destination)
    _mark_verified(current_user, record)
    db.add(AuditLog(actor_user_id=current_user.id, action="contact.verified", entity_type="user",
                    entity_id=str(current_user.id),
                    details=f"{'Phone number' if payload.channel == 'sms' else 'Email address'} confirmed."))
    db.commit()
    return contact_status(db, current_user)


# --------------------------------------------------------------------------
# Signed in: change or add my phone or email
# --------------------------------------------------------------------------


class ContactStart(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    kind: Literal["phone", "email"]
    value: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=256)


class ContactConfirm(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    kind: Literal["phone", "email"]
    value: str = Field(min_length=3, max_length=254)
    code: str = Field(min_length=4, max_length=12)


def _clean_new_contact(db: Session, user: User, kind: str, value: str) -> str:
    try:
        cleaned = clean_phone(value) if kind == "phone" else clean_email(value)
    except ContactError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    if not cleaned:
        raise HTTPException(status_code=422, detail="Enter a phone number or email address.")
    if cleaned == (user.phone if kind == "phone" else user.email):
        raise HTTPException(status_code=409, detail="That's already on your account.")
    taken = phone_taken(db, cleaned, user.id) if kind == "phone" else email_taken(db, cleaned, user.id)
    if taken:
        raise HTTPException(status_code=409, detail=f"That {'phone number' if kind == 'phone' else 'email address'} "
                                                    "is already used by another EkiMove account.")
    return cleaned


def _apply_contact(db: Session, user: User, kind: str, value: str, verified_at: datetime | None) -> None:
    old = user.phone if kind == "phone" else user.email
    if kind == "phone":
        user.phone, user.phone_verified_at = value, verified_at
    else:
        user.email, user.email_verified_at = value, verified_at
    label = "Phone number" if kind == "phone" else "Email address"
    shown = mask_phone if kind == "phone" else mask_email
    db.add(AuditLog(actor_user_id=user.id, action="contact.changed", entity_type="user", entity_id=str(user.id),
                    details=f"{label} changed from {shown(old) or 'none'} to {shown(value)}"
                            f"{' (confirmed by code)' if verified_at else ''}."))


def _profile(db: Session, user: User) -> dict:
    from app.accounts import profile_result  # avoid an import cycle

    db.refresh(user)
    return profile_result(db, user)


@router.post("/me/contact/start")
def start_contact_change(payload: ContactStart, request: Request, current_user: User = Depends(get_current_user),
                         db: Session = Depends(get_db)) -> dict:
    from app.accounts import limit_password_checks  # avoid an import cycle

    limit_password_checks(current_user)
    if not verify_password(payload.password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="Your password isn't right.")
    value = _clean_new_contact(db, current_user, payload.kind, payload.value)
    channel = "sms" if payload.kind == "phone" else "email"
    if not channel_configured(channel):
        # No way to send a code yet: save it unconfirmed.
        _apply_contact(db, current_user, payload.kind, value, None)
        db.commit()
        return {"code_sent": False, "profile": _profile(db, current_user)}
    _limit_codes(request)
    issue_code(db, user=current_user, purpose="change_contact", channel=channel, destination=value)
    return {"code_sent": True, "sent_to": mask_phone(value) if channel == "sms" else mask_email(value),
            "expires_in_minutes": CODE_MINUTES}


@router.post("/me/contact/confirm")
def confirm_contact_change(payload: ContactConfirm, current_user: User = Depends(get_current_user),
                           db: Session = Depends(get_db)) -> dict:
    try:
        cleaned = clean_phone(payload.value) if payload.kind == "phone" else clean_email(payload.value)
    except ContactError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    record = check_code(db, user=current_user, purpose="change_contact", code=payload.code, destination=cleaned)
    value = _clean_new_contact(db, current_user, payload.kind, payload.value)
    _apply_contact(db, current_user, payload.kind, value, record.used_at)
    db.commit()
    return {"code_sent": False, "profile": _profile(db, current_user)}

