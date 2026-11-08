"""Profiles, session refresh, and super-admin account management.

* Everyone: view and edit their profile, change password, refresh their
  session token while active (the app signs people out when idle).
* Super-admin: list passengers and drivers with profiles, see an overview
  of what is happening in the app, and suspend, reactivate or remove any
  non-admin account. Removing anonymises the person but keeps their trips,
  payments and earnings so the books stay complete.
"""

from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.orm import Session

from app.codes import contact_status
from app.contacts import ContactError, clean_email, clean_name, email_taken, password_problem, search_filter
from app.rate_limit import enforce as enforce_rate_limit
from app.messaging import email_configured
from app.device_sessions import forget_all
from app.auth import create_access_token, get_current_user, hash_password, require_super_admin, verify_password
from app.config import settings
from app.database import get_db
from app.earnings import driver_balance
from app.models import (
    AuditLog,
    BankDeposit,
    Driver,
    DriverPayout,
    DriverPayoutAccount,
    EarningEntry,
    Incident,
    PassengerVerification,
    Payment,
    PromoCode,
    PushSubscription,
    SavedPlace,
    Ride,
    RideRequest,
    SupportMessage,
    SupportThread,
    User,
    Vehicle,
)

router = APIRouter(prefix="/api/v1", tags=["accounts"])
LAGOS = ZoneInfo("Africa/Lagos")
ACTIVE_RIDE_STATUSES = ("assigned", "driver_arriving", "in_progress")


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def account_status(user: User) -> str:
    if user.removed_at:
        return "removed"
    if not user.is_active:
        return "suspended"
    return "active"


def _driver_info(db: Session, user: User) -> dict | None:
    driver = db.scalar(select(Driver).where(Driver.user_id == user.id))
    if driver is None:
        return None
    vehicles = db.scalars(select(Vehicle).where(Vehicle.driver_id == driver.id).order_by(Vehicle.id)).all()
    return {
        "driver_id": driver.id,
        "verification_status": driver.verification_status,
        "is_online": driver.is_online,
        "has_photo": bool(driver.photo_path),
        "vehicles": [
            {"id": v.id, "vehicle_type": v.vehicle_type, "plate_number": v.plate_number,
             "capacity": v.capacity, "is_approved": v.is_approved}
            for v in vehicles
        ],
    }


def profile_result(db: Session, user: User) -> dict:
    from app.trips import rating_summary  # avoid an import cycle
    from app.verification import POLICY_VERSION, verification_result

    record = db.scalar(select(PassengerVerification).where(PassengerVerification.user_id == user.id))
    return {
        "emergency_contact": ({"name": user.emergency_contact_name, "phone": user.emergency_contact_phone}
                              if user.emergency_contact_phone else None),
        "verification": verification_result(record) if user.role == "passenger" else None,
        "rating": rating_summary(db, user.id),
        "policies": {"accepted_version": user.policies_version, "accepted_at": _iso(user.policies_accepted_at),
                     "current_version": POLICY_VERSION},
        "id": user.id,
        "full_name": user.full_name,
        "phone": user.phone,
        "email": user.email,
        "contact": contact_status(db, user),
        "must_change_password": bool(user.must_change_password),
        "deletion_requested_at": _iso(user.deletion_requested_at),
        "deletion_reason": user.deletion_reason,
        "role": user.role,
        "status": account_status(user),
        "joined_at": _iso(user.created_at),
        "driver": _driver_info(db, user) if user.role == "driver" else None,
    }


# --------------------------------------------------------------------------
# Self-service
# --------------------------------------------------------------------------


@router.get("/me")
def get_my_profile(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    return profile_result(db, current_user)


class ProfileUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    full_name: str | None = Field(default=None, min_length=2, max_length=160)
    email: str | None = Field(default=None, max_length=254)

    @field_validator("full_name")
    @classmethod
    def valid_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        try:
            return clean_name(value, label="full name")
        except ContactError as exc:
            raise ValueError(str(exc)) from None

    @field_validator("email")
    @classmethod
    def valid_email(cls, value: str | None) -> str | None:
        if value is None or value == "":
            return ""
        try:
            return clean_email(value) or ""
        except ContactError as exc:
            raise ValueError(str(exc)) from None


@router.patch("/me")
def update_my_profile(
    payload: ProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    if payload.full_name is not None:
        current_user.full_name = payload.full_name
    if payload.email is not None and payload.email != (current_user.email or ""):
        if not payload.email:
            if not current_user.phone:
                raise HTTPException(status_code=409, detail="You sign in with this email. Add a phone number "
                                                            "before removing it.")
        elif email_configured():
            raise HTTPException(status_code=409, detail="Use \"Change email\" so we can send a code to the new address.")
        elif email_taken(db, payload.email, current_user.id):
            raise HTTPException(status_code=409, detail="That email address is already used by another EkiMove account.")
        current_user.email = payload.email or None
        current_user.email_verified_at = None
    db.add(AuditLog(actor_user_id=current_user.id, action="profile.updated", entity_type="user",
                    entity_id=str(current_user.id), details="Profile details updated."))
    db.commit()
    db.refresh(current_user)
    return profile_result(db, current_user)


class PasswordChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=12, max_length=128)


def limit_password_checks(user: User) -> None:
    """Typing the current password is checked at most 5 times in 15 minutes,
    so a stolen session can't be used to guess it."""
    enforce_rate_limit("password-check", f"user:{user.id}", 5, 900,
                       "Too many password tries. Please wait 15 minutes and try again.")


@router.post("/me/password")
def change_my_password(
    payload: PasswordChange,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    limit_password_checks(current_user)
    if not verify_password(payload.current_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="Your current password isn't right.")
    if payload.new_password == payload.current_password:
        raise HTTPException(status_code=400, detail="Choose a password you haven't just used.")
    weak = password_problem(payload.new_password, name=current_user.full_name, phone=current_user.phone,
                            email=current_user.email)
    if weak:
        raise HTTPException(status_code=422, detail=weak)
    current_user.password_hash = hash_password(payload.new_password)
    forget_all(db, current_user.id)  # remembered phones must sign in again
    current_user.must_change_password = False
    db.add(AuditLog(actor_user_id=current_user.id, action="password.changed", entity_type="user",
                    entity_id=str(current_user.id), details="Password changed; older sessions signed out."))
    db.commit()
    # Tokens are bound to the password, so other devices are signed out;
    # this one gets a fresh token.
    return {"access_token": create_access_token(current_user), "token_type": "bearer",
            "expires_in": settings.access_token_expire_minutes * 60}


@router.post("/auth/refresh", tags=["authentication"])
def refresh_session(current_user: User = Depends(get_current_user)) -> dict:
    """Swap a still-valid token for a fresh one (used while the person is active)."""
    return {"access_token": create_access_token(current_user), "token_type": "bearer",
            "expires_in": settings.access_token_expire_minutes * 60}


# --------------------------------------------------------------------------
# Super-admin: people
# --------------------------------------------------------------------------


def _ride_counts(db: Session, user: User) -> dict:
    if user.role == "driver":
        driver = db.scalar(select(Driver).where(Driver.user_id == user.id))
        if driver is None:
            return {"trips": 0, "completed": 0, "active": 0}
        base = select(func.count(Ride.id)).where(Ride.driver_id == driver.id)
    else:
        base = select(func.count(Ride.id)).join(RideRequest, Ride.request_id == RideRequest.id) \
            .where(RideRequest.passenger_user_id == user.id)
    return {
        "trips": db.scalar(base) or 0,
        "completed": db.scalar(base.where(Ride.status == "completed")) or 0,
        "active": db.scalar(base.where(Ride.status.in_(ACTIVE_RIDE_STATUSES))) or 0,
    }


def _person_row(db: Session, user: User) -> dict:
    row = {**profile_result(db, user), "rides": _ride_counts(db, user),
           "suspension_reason": user.suspension_reason, "suspended_at": _iso(user.suspended_at)}
    if user.role == "passenger":
        row["requests"] = db.scalar(select(func.count(RideRequest.id))
                                    .where(RideRequest.passenger_user_id == user.id)) or 0
    if row.get("driver"):
        driver_id = row["driver"]["driver_id"]
        row["driver"]["balance"] = str(driver_balance(db, driver_id))
        account = db.scalar(select(DriverPayoutAccount).where(DriverPayoutAccount.driver_id == driver_id))
        row["driver"]["payout_account"] = (
            {"bank_name": account.bank_name, "account_number": account.account_number,
             "account_name": account.account_name, "verified": account.verified}
            if account else None
        )
    return row


@router.get("/admin/people")
def admin_list_people(
    role: Literal["passenger", "driver"] = Query("passenger"),
    status: Literal["all", "active", "suspended", "removed", "approved", "pending", "id_pending",
                    "deletion"] = Query("all"),
    q: str | None = Query(default=None, max_length=80),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_super_admin),
) -> list[dict]:
    query = select(User).where(User.role == role)
    if status == "active":
        query = query.where(User.is_active.is_(True))
    elif status == "suspended":
        query = query.where(User.is_active.is_(False), User.removed_at.is_(None))
    elif status == "removed":
        query = query.where(User.removed_at.is_not(None))
    elif status == "deletion":
        query = query.where(User.deletion_requested_at.is_not(None))
    elif status == "id_pending":
        query = query.join(PassengerVerification, PassengerVerification.user_id == User.id) \
            .where(PassengerVerification.status == "pending")
    elif status in ("approved", "pending") and role == "driver":
        query = query.join(Driver, Driver.user_id == User.id).where(Driver.verification_status == status)
    if status != "removed":
        query = query.where(User.removed_at.is_(None))
    if q:
        like = f"%{q.strip()}%"
        query = query.where(search_filter(like))
    users = db.scalars(query.order_by(User.created_at.desc(), User.id.desc()).limit(300)).all()
    return [_person_row(db, user) for user in users]


@router.get("/admin/people/{user_id}")
def admin_get_person(user_id: int, db: Session = Depends(get_db), _admin: User = Depends(require_super_admin)) -> dict:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Account not found.")
    row = _person_row(db, user)
    if user.role == "driver" and row.get("driver"):
        rides = db.execute(
            select(Ride, RideRequest).join(RideRequest, Ride.request_id == RideRequest.id)
            .where(Ride.driver_id == row["driver"]["driver_id"]).order_by(Ride.id.desc()).limit(15)
        ).all()
    else:
        rides = db.execute(
            select(Ride, RideRequest).join(RideRequest, Ride.request_id == RideRequest.id)
            .where(RideRequest.passenger_user_id == user.id).order_by(Ride.id.desc()).limit(15)
        ).all()
    row["recent_rides"] = [
        {"ride_id": ride.id, "status": ride.status, "fare": str(ride.agreed_fare),
         "route": f"{req.origin_text} → {req.destination_text}", "vehicle_type": req.vehicle_type,
         "created_at": _iso(req.created_at)}
        for ride, req in rides
    ]
    from app.verification import verification_result

    record = db.scalar(select(PassengerVerification).where(PassengerVerification.user_id == user.id))
    row["verification"] = verification_result(record, full=True) if user.role == "passenger" else None
    row["emergency_contact"] = ({"name": user.emergency_contact_name, "phone": user.emergency_contact_phone}
                                if user.emergency_contact_phone else None)
    row["sign_ins"] = [
        {"at": _iso(log.created_at), "details": log.details}
        for log in db.scalars(select(AuditLog).where(AuditLog.actor_user_id == user.id,
                                                     AuditLog.action == "auth.login")
                              .order_by(AuditLog.id.desc()).limit(10)).all()
    ]
    row["recent_activity"] = [
        {"action": log.action, "details": log.details, "created_at": _iso(log.created_at)}
        for log in db.scalars(select(AuditLog).where(
            or_(AuditLog.actor_user_id == user.id,
                (AuditLog.entity_type == "user") & (AuditLog.entity_id == str(user.id))))
            .order_by(AuditLog.id.desc()).limit(15)).all()
    ]
    return row


class AccountAction(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    reason: str = Field(min_length=3, max_length=500)


def _target(db: Session, user_id: int, admin: User) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Account not found.")
    if user.id == admin.id:
        raise HTTPException(status_code=409, detail="You can't do this to your own account.")
    if user.role == "super_admin":
        raise HTTPException(status_code=409, detail="Super-admin accounts can't be changed here.")
    if user.removed_at:
        raise HTTPException(status_code=409, detail="This account has already been removed.")
    return user


def _active_trip(db: Session, user: User) -> bool:
    return _ride_counts(db, user)["active"] > 0


def _take_driver_offline(db: Session, user: User) -> None:
    driver = db.scalar(select(Driver).where(Driver.user_id == user.id))
    if driver is not None:
        from app.dispatch import driver_went_offline  # avoid an import cycle

        driver_went_offline(db, driver)
        driver.is_online = False


@router.post("/admin/people/{user_id}/suspend")
def admin_suspend(user_id: int, payload: AccountAction, db: Session = Depends(get_db),
                  admin: User = Depends(require_super_admin)) -> dict:
    user = _target(db, user_id, admin)
    if not user.is_active:
        raise HTTPException(status_code=409, detail="This account is already suspended.")
    user.is_active = False
    user.suspended_at = datetime.now(timezone.utc)
    user.suspension_reason = payload.reason
    _take_driver_offline(db, user)
    db.add(AuditLog(actor_user_id=admin.id, action="account.suspended", entity_type="user",
                    entity_id=str(user.id), details=payload.reason))
    db.commit()
    return _person_row(db, user)


@router.post("/admin/people/{user_id}/reactivate")
def admin_reactivate(user_id: int, payload: AccountAction, db: Session = Depends(get_db),
                     admin: User = Depends(require_super_admin)) -> dict:
    user = _target(db, user_id, admin)
    if user.is_active:
        raise HTTPException(status_code=409, detail="This account is already active.")
    user.is_active = True
    user.suspended_at = None
    user.suspension_reason = None
    db.add(AuditLog(actor_user_id=admin.id, action="account.reactivated", entity_type="user",
                    entity_id=str(user.id), details=payload.reason))
    db.commit()
    return _person_row(db, user)


@router.post("/admin/people/{user_id}/remove")
def admin_remove(user_id: int, payload: AccountAction, db: Session = Depends(get_db),
                 admin: User = Depends(require_super_admin)) -> dict:
    user = _target(db, user_id, admin)
    if _active_trip(db, user):
        raise HTTPException(status_code=409, detail="This person has a trip in progress. "
                                                    "Wait for it to finish or cancel it first.")
    original = user.phone or user.email or ""
    user.is_active = False
    user.removed_at = datetime.now(timezone.utc)
    user.suspension_reason = payload.reason
    user.full_name = "Removed account"
    user.email = None
    user.password_hash = None
    # Free the phone number and email so the person could register again.
    user.phone = f"removed-{user.id}-{original[-4:]}"[:32]
    user.phone_verified_at = None
    user.email_verified_at = None
    user.emergency_contact_name = None
    user.emergency_contact_phone = None
    user.referral_code = None
    user.deletion_reason = None
    # Personal shortcuts and devices go too.
    db.execute(delete(SavedPlace).where(SavedPlace.user_id == user.id))
    db.execute(delete(PushSubscription).where(PushSubscription.user_id == user.id))
    db.execute(update(PromoCode).where(PromoCode.owner_user_id == user.id).values(is_active=False))
    _take_driver_offline(db, user)
    db.add(AuditLog(actor_user_id=admin.id, action="account.removed", entity_type="user",
                    entity_id=str(user.id), details=f"{payload.reason} (contact ending {original[-4:]})"))
    db.commit()
    return _person_row(db, user)


# Letters and digits that are hard to confuse when read out over the phone.
_TEMP_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


@router.post("/admin/people/{user_id}/reset-password")
def admin_reset_password(user_id: int, payload: AccountAction, db: Session = Depends(get_db),
                         admin: User = Depends(require_super_admin)) -> dict:
    """Set a temporary password to give the person (shown once). They must
    choose their own when they next sign in; older sessions are signed out."""
    user = _target(db, user_id, admin)
    temporary = "-".join("".join(secrets.choice(_TEMP_ALPHABET) for _ in range(4)) for _ in range(3))
    user.password_hash = hash_password(temporary)
    forget_all(db, user.id)  # remembered phones must sign in again
    user.must_change_password = True
    db.add(AuditLog(actor_user_id=admin.id, action="password.admin_reset", entity_type="user",
                    entity_id=str(user.id), details=payload.reason))
    db.commit()
    db.refresh(user)
    return {"temporary_password": temporary, "person": _person_row(db, user)}


# --------------------------------------------------------------------------
# Super-admin: overview
# --------------------------------------------------------------------------


@router.get("/admin/overview")
def admin_overview(db: Session = Depends(get_db), _admin: User = Depends(require_super_admin)) -> dict:
    now_local = datetime.now(LAGOS)
    today = now_local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
    week = today - timedelta(days=6)

    def count(query) -> int:
        return db.scalar(query) or 0

    def users(role: str, active: bool | None = None) -> int:
        query = select(func.count(User.id)).where(User.role == role, User.removed_at.is_(None))
        if active is not None:
            query = query.where(User.is_active.is_(active))
        return count(query)

    rides_by_status = dict(db.execute(select(Ride.status, func.count(Ride.id)).group_by(Ride.status)).all())
    requests_today = count(select(func.count(RideRequest.id)).where(RideRequest.created_at >= today))
    completed_today = count(select(func.count(Ride.id)).where(Ride.status == "completed", Ride.completed_at >= today))
    cancelled_today = count(select(func.count(Ride.id)).where(Ride.status == "cancelled", Ride.cancelled_at >= today))
    commission_today = db.scalar(select(func.coalesce(func.sum(EarningEntry.commission), 0))
                                 .where(EarningEntry.kind.in_(("trip", "cancellation_fee")),
                                        EarningEntry.created_at >= today))
    fares_week = db.scalar(select(func.coalesce(func.sum(EarningEntry.gross), 0))
                           .where(EarningEntry.kind.in_(("trip", "cancellation_fee")),
                                  EarningEntry.created_at >= week))

    unread_support = 0
    for thread in db.scalars(select(SupportThread).where(SupportThread.status == "open")).all():
        query = select(func.count(SupportMessage.id)).where(SupportMessage.thread_id == thread.id,
                                                            SupportMessage.from_staff.is_(False))
        if thread.staff_last_read_at:
            query = query.where(SupportMessage.created_at > thread.staff_last_read_at)
        if count(query):
            unread_support += 1

    actors = {}
    activity = []
    for log in db.scalars(select(AuditLog).order_by(AuditLog.id.desc()).limit(30)).all():
        if log.actor_user_id and log.actor_user_id not in actors:
            actor = db.get(User, log.actor_user_id)
            actors[log.actor_user_id] = (actor.full_name, actor.role) if actor else ("Unknown", "")
        name, role = actors.get(log.actor_user_id, ("EkiMove system", "system"))
        activity.append({"action": log.action, "details": log.details, "actor": name, "actor_role": role,
                         "entity_type": log.entity_type, "entity_id": log.entity_id,
                         "created_at": _iso(log.created_at)})

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "people": {
            "passengers": users("passenger"),
            "drivers": users("driver"),
            "drivers_approved": count(select(func.count(Driver.id)).join(User, Driver.user_id == User.id)
                                      .where(Driver.verification_status == "approved", User.is_active.is_(True))),
            "drivers_pending": count(select(func.count(Driver.id)).where(Driver.verification_status == "pending")),
            "drivers_online": count(select(func.count(Driver.id)).join(User, Driver.user_id == User.id)
                                    .where(Driver.is_online.is_(True), User.is_active.is_(True))),
            "suspended": count(select(func.count(User.id)).where(User.is_active.is_(False),
                                                                  User.removed_at.is_(None))),
            "new_this_week": count(select(func.count(User.id)).where(User.created_at >= week)),
        },
        "trips": {
            "waiting_for_driver": count(select(func.count(RideRequest.id)).where(RideRequest.status == "requested")),
            "quotes_to_send": count(select(func.count(RideRequest.id)).where(RideRequest.status == "quote_requested")),
            "assigned": rides_by_status.get("assigned", 0),
            "driver_arriving": rides_by_status.get("driver_arriving", 0),
            "in_progress": rides_by_status.get("in_progress", 0),
            "requests_today": requests_today,
            "completed_today": completed_today,
            "cancelled_today": cancelled_today,
        },
        "money": {
            "payments_to_confirm": count(select(func.count(Payment.id)).where(Payment.status == "awaiting_confirmation")),
            "deposits_to_check": count(select(func.count(BankDeposit.id)).where(BankDeposit.status == "unmatched")),
            "refunds_due": count(select(func.count(Payment.id)).where(Payment.refund_status == "due")),
            "payouts_open": count(select(func.count(DriverPayout.id)).where(DriverPayout.status.in_(("queued", "processing")))),
            "commission_today": str(Decimal(commission_today or 0).quantize(Decimal("0.01"))),
            "fares_this_week": str(Decimal(fares_week or 0).quantize(Decimal("0.01"))),
        },
        "safety": {
            "open_incidents": count(select(func.count(Incident.id)).where(Incident.status != "resolved")),
        },
        "support": {
            "open_threads": count(select(func.count(SupportThread.id)).where(SupportThread.status == "open")),
            "awaiting_reply": unread_support,
        },
        "activity": activity,
    }
