"""Promo codes and invite (referral) codes.

* Admins create codes: a naira amount or a percentage off, with optional
  cap, minimum fare, dates, total uses, uses per person and "first ride
  only".
* Every passenger has an invite code. Someone who signs up with it gets a
  personal code for money off their first ride; when they finish their
  first paid trip, the person who invited them gets one too.
* The discount comes off what the passenger pays. The driver still earns
  on the full fare: EkiMove covers the discount from its commission.
* A code used on a booking that is cancelled before payment can be used
  again.
"""

from __future__ import annotations

import re
import secrets
from datetime import datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import get_current_user, require_super_admin
from app.database import get_db
from app.models import AppSetting, AuditLog, Payment, PromoCode, PromoRedemption, Ride, RideRequest, User

router = APIRouter(prefix="/api/v1", tags=["promos"])

# Every discounted trip still costs at least this much, so payments
# always have something to match.
MIN_PAYABLE = Decimal("100.00")
REFERRAL_REWARDS_PER_MONTH = 20
CODE_RE = re.compile(r"[A-Z0-9][A-Z0-9-]{2,31}")
SAFE_LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
ZERO = Decimal("0.00")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _iso(value: datetime | None) -> str | None:
    value = _aware(value)
    return value.isoformat() if value else None


def normalize_code(value: str | None) -> str:
    return re.sub(r"\s+", "", str(value or "")).upper()


def _money(value) -> Decimal:
    return Decimal(value or 0).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


# --------------------------------------------------------------------------
# Settings for invites
# --------------------------------------------------------------------------


def referral_rules(db: Session) -> dict:
    from app.app_settings import _get  # avoid an import cycle

    def amount(key: str) -> int:
        try:
            return max(int(_get(db, key)), 0)
        except ValueError:
            return 0

    return {
        "referral_enabled": _get(db, "referral_enabled") == "true",
        "referral_new_user_amount": amount("referral_new_user_amount"),
        "referral_reward_amount": amount("referral_reward_amount"),
    }


# --------------------------------------------------------------------------
# Discounts
# --------------------------------------------------------------------------


def discount_for(promo: PromoCode, fare: Decimal) -> Decimal:
    fare = _money(fare)
    if promo.kind == "percent":
        raw = (fare * Decimal(promo.value) / Decimal(100)).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    else:
        raw = Decimal(promo.value)
    if promo.max_discount is not None:
        raw = min(raw, Decimal(promo.max_discount))
    return _money(max(ZERO, min(raw, fare - MIN_PAYABLE)))


def _uses(db: Session, promo: PromoCode, user_id: int | None = None) -> int:
    query = select(func.count(PromoRedemption.id)).where(PromoRedemption.promo_id == promo.id,
                                                         PromoRedemption.status == "active")
    if user_id is not None:
        query = query.where(PromoRedemption.user_id == user_id)
    return db.scalar(query) or 0


def _has_completed_trip(db: Session, user_id: int) -> bool:
    return db.scalar(
        select(Ride.id).join(RideRequest, Ride.request_id == RideRequest.id)
        .where(RideRequest.passenger_user_id == user_id, Ride.status == "completed").limit(1)
    ) is not None


def check_code(db: Session, user: User, code: str, fare: Decimal) -> tuple[PromoCode, Decimal]:
    """Return the promo and the discount on this fare, or raise 422."""
    invalid = HTTPException(status_code=422, detail="This code isn't valid.")
    promo = db.scalar(select(PromoCode).where(PromoCode.code == normalize_code(code)))
    if promo is None or not promo.is_active:
        raise invalid
    if promo.owner_user_id is not None and promo.owner_user_id != user.id:
        raise invalid
    now = _now()
    if promo.starts_at and _aware(promo.starts_at) > now:
        raise HTTPException(status_code=422, detail="This code isn't active yet.")
    if promo.ends_at and _aware(promo.ends_at) < now:
        raise HTTPException(status_code=422, detail="This code has expired.")
    if promo.min_fare is not None and _money(fare) < Decimal(promo.min_fare):
        raise HTTPException(status_code=422,
                            detail=f"This code works on fares of ₦{Decimal(promo.min_fare):,.0f} or more.")
    if promo.max_uses is not None and _uses(db, promo) >= promo.max_uses:
        raise HTTPException(status_code=422, detail="This code has been fully used.")
    if _uses(db, promo, user.id) >= max(promo.per_user_limit, 1):
        raise HTTPException(status_code=422, detail="You've already used this code.")
    if promo.first_ride_only and _has_completed_trip(db, user.id):
        raise HTTPException(status_code=422, detail="This code is for your first ride only.")
    discount = discount_for(promo, fare)
    if discount <= 0:
        raise HTTPException(status_code=422, detail="This fare is too low for this code.")
    return promo, discount


def apply_code(db: Session, user: User, request: RideRequest, code: str) -> Decimal:
    """Use a code on a new booking (request must be flushed). Returns the discount."""
    promo, discount = check_code(db, user, code, request.quoted_fare)
    request.discount_amount = discount
    db.add(PromoRedemption(promo_id=promo.id, user_id=user.id, ride_request_id=request.id, discount=discount,
                           created_at=_now()))
    return discount


def release_code(db: Session, request: RideRequest) -> None:
    """A booking cancelled before it was paid gives the code back."""
    redemption = db.scalar(select(PromoRedemption).where(PromoRedemption.ride_request_id == request.id,
                                                         PromoRedemption.status == "active"))
    if redemption is None:
        return
    ride = db.scalar(select(Ride).where(Ride.request_id == request.id))
    if ride is not None:
        payment = db.scalar(select(Payment).where(Payment.ride_id == ride.id))
        if payment is not None and payment.status in ("confirmed", "refunded"):
            return
    redemption.status = "released"


def payable_amount(db: Session, ride: Ride) -> Decimal:
    """What the passenger pays for a ride: the fare minus any discount."""
    request = db.get(RideRequest, ride.request_id)
    discount = Decimal(request.discount_amount or 0) if request is not None else ZERO
    return _money(max(ZERO, Decimal(ride.agreed_fare) - discount))


# --------------------------------------------------------------------------
# Invites
# --------------------------------------------------------------------------


def _random(length: int) -> str:
    return "".join(secrets.choice(SAFE_LETTERS) for _ in range(length))


def ensure_invite_code(db: Session, user: User) -> str:
    if user.referral_code:
        return user.referral_code
    letters = re.sub(r"[^A-Z]", "", (user.full_name or "").upper())[:4] or "EKI"
    for _ in range(20):
        candidate = f"{letters}{_random(4)}"
        if db.scalar(select(User.id).where(User.referral_code == candidate)) is None:
            user.referral_code = candidate
            try:
                db.flush()
                return candidate
            except IntegrityError:
                db.rollback()
    raise HTTPException(status_code=503, detail="Could not create an invite code. Please try again.")


def _personal_code(db: Session, owner: User, prefix: str, amount: int, days: int, description: str,
                   first_ride_only: bool) -> PromoCode:
    for _ in range(20):
        code = f"{prefix}-{_random(6)}"
        if db.scalar(select(PromoCode.id).where(PromoCode.code == code)) is None:
            break
    promo = PromoCode(code=code, description=description, kind="amount", value=Decimal(amount), max_uses=1,
                      per_user_limit=1, first_ride_only=first_ride_only, is_active=True, source="referral",
                      owner_user_id=owner.id, ends_at=_now() + timedelta(days=days), created_at=_now())
    db.add(promo)
    return promo


def find_inviter(db: Session, code: str | None) -> User | None:
    code = normalize_code(code)
    if not code:
        return None
    inviter = db.scalar(select(User).where(User.referral_code == code))
    if inviter is None or not inviter.is_active or inviter.role != "passenger":
        raise HTTPException(status_code=422, detail="That invite code isn't valid. Check it, or leave it empty.")
    return inviter


def welcome_invited(db: Session, user: User, inviter: User | None) -> None:
    """Link a new passenger to whoever invited them and give the welcome code."""
    if inviter is None or inviter.id == user.id:
        return
    rules = referral_rules(db)
    if not rules["referral_enabled"]:
        return
    user.referred_by_user_id = inviter.id
    if rules["referral_new_user_amount"] > 0:
        _personal_code(db, user, "WELCOME", rules["referral_new_user_amount"], 60,
                       f"Welcome gift from {(inviter.full_name or 'a friend').split()[0]}", first_ride_only=True)
    db.add(AuditLog(actor_user_id=user.id, action="referral.joined", entity_type="user", entity_id=str(user.id),
                    details=f"Invited by user {inviter.id}."))


def reward_inviter(db: Session, passenger: User) -> None:
    """After an invited passenger's first completed (paid) trip."""
    if not passenger.referred_by_user_id or passenger.referral_rewarded_at:
        return
    rules = referral_rules(db)
    inviter = db.get(User, passenger.referred_by_user_id)
    passenger.referral_rewarded_at = _now()
    if not rules["referral_enabled"] or rules["referral_reward_amount"] <= 0 or inviter is None \
            or not inviter.is_active:
        return
    db.flush()
    month_ago = _now() - timedelta(days=30)
    recent = db.scalar(select(func.count(User.id)).where(User.referred_by_user_id == inviter.id,
                                                         User.referral_rewarded_at >= month_ago)) or 0
    # This passenger's own timestamp is already counted above.
    if recent > REFERRAL_REWARDS_PER_MONTH:
        return
    promo = _personal_code(db, inviter, "THANKS", rules["referral_reward_amount"], 90,
                           f"Thanks for inviting {(passenger.full_name or 'a friend').split()[0]}",
                           first_ride_only=False)
    db.add(AuditLog(actor_user_id=None, action="referral.rewarded", entity_type="user", entity_id=str(inviter.id),
                    details=f"For inviting user {passenger.id}."))
    from app.push import notify  # avoid an import cycle

    notify(db, inviter.id, f"₦{rules['referral_reward_amount']:,} off your next ride",
           f"{(passenger.full_name or 'Your friend').split()[0]} took their first EkiMove ride. "
           f"Your code {promo.code} is ready.", url="/invite", tag="referral")


# --------------------------------------------------------------------------
# Passenger endpoints
# --------------------------------------------------------------------------


def _promo_card(db: Session, promo: PromoCode) -> dict:
    return {
        "code": promo.code,
        "description": promo.description,
        "kind": promo.kind,
        "value": str(_money(promo.value)),
        "max_discount": str(_money(promo.max_discount)) if promo.max_discount is not None else None,
        "min_fare": str(_money(promo.min_fare)) if promo.min_fare is not None else None,
        "ends_at": _iso(promo.ends_at),
        "first_ride_only": promo.first_ride_only,
    }


@router.get("/me/promos")
def my_promos(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    if current_user.role != "passenger":
        raise HTTPException(status_code=403, detail="Promo codes are for passengers.")
    rules = referral_rules(db)
    code = ensure_invite_code(db, current_user)
    db.commit()
    now = _now()
    personal = db.scalars(select(PromoCode).where(PromoCode.owner_user_id == current_user.id,
                                                  PromoCode.is_active.is_(True))
                          .order_by(PromoCode.created_at)).all()
    available = [
        _promo_card(db, promo) for promo in personal
        if (not promo.ends_at or _aware(promo.ends_at) > now) and _uses(db, promo, current_user.id) < promo.per_user_limit
        and not (promo.first_ride_only and _has_completed_trip(db, current_user.id))
    ]
    invited = db.scalar(select(func.count(User.id)).where(User.referred_by_user_id == current_user.id)) or 0
    rewarded = db.scalar(select(func.count(User.id)).where(User.referred_by_user_id == current_user.id,
                                                           User.referral_rewarded_at.is_not(None))) or 0
    return {
        "invite": {**rules, "code": code, "link_path": f"/register?ref={code}", "invited": invited,
                   "completed_first_ride": rewarded},
        "codes": available,
    }


class PromoCheck(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    code: str = Field(min_length=3, max_length=40)
    fare: Decimal = Field(gt=0, le=10_000_000)


@router.post("/promos/check")
def check_promo(payload: PromoCheck, current_user: User = Depends(get_current_user),
                db: Session = Depends(get_db)) -> dict:
    """Preview a code on a fare (the booking itself re-checks everything)."""
    promo, discount = check_code(db, current_user, payload.code, payload.fare)
    return {"code": promo.code, "description": promo.description, "discount": str(discount),
            "payable": str(_money(payload.fare) - discount)}


# --------------------------------------------------------------------------
# Admin
# --------------------------------------------------------------------------


class PromoCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    code: str = Field(min_length=3, max_length=32)
    description: str | None = Field(default=None, max_length=160)
    kind: Literal["amount", "percent"]
    value: Decimal = Field(gt=0, le=1_000_000)
    max_discount: Decimal | None = Field(default=None, gt=0, le=1_000_000)
    min_fare: Decimal | None = Field(default=None, ge=0, le=10_000_000)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    max_uses: int | None = Field(default=None, ge=1, le=1_000_000)
    per_user_limit: int = Field(default=1, ge=1, le=100)
    first_ride_only: bool = False


def _admin_row(db: Session, promo: PromoCode) -> dict:
    total = db.scalar(select(func.coalesce(func.sum(PromoRedemption.discount), 0)).where(
        PromoRedemption.promo_id == promo.id, PromoRedemption.status == "active")) or 0
    return {**_promo_card(db, promo), "id": promo.id, "is_active": promo.is_active, "starts_at": _iso(promo.starts_at),
            "max_uses": promo.max_uses, "per_user_limit": promo.per_user_limit, "uses": _uses(db, promo),
            "total_discount": str(_money(total)), "created_at": _iso(promo.created_at)}


@router.get("/admin/promos")
def admin_list_promos(db: Session = Depends(get_db), _admin: User = Depends(require_super_admin)) -> dict:
    promos = db.scalars(select(PromoCode).where(PromoCode.source == "admin")
                        .order_by(PromoCode.is_active.desc(), PromoCode.created_at.desc())).all()
    invites = db.scalars(select(PromoCode).where(PromoCode.source == "referral")).all()
    invite_uses = db.scalar(select(func.count(PromoRedemption.id)).select_from(PromoRedemption)
                            .join(PromoCode, PromoRedemption.promo_id == PromoCode.id).where(PromoCode.source == "referral", PromoRedemption.status == "active")) or 0
    invite_total = db.scalar(select(func.coalesce(func.sum(PromoRedemption.discount), 0)).select_from(PromoRedemption)
                             .join(PromoCode, PromoRedemption.promo_id == PromoCode.id).where(PromoCode.source == "referral", PromoRedemption.status == "active")) or 0
    return {
        "codes": [_admin_row(db, promo) for promo in promos],
        "invites": {"codes_given": len(invites), "used": invite_uses, "total_discount": str(_money(invite_total)),
                    "referred_people": db.scalar(select(func.count(User.id))
                                                 .where(User.referred_by_user_id.is_not(None))) or 0},
        "rules": referral_rules(db),
    }


@router.post("/admin/promos", status_code=201)
def admin_create_promo(payload: PromoCreate, db: Session = Depends(get_db),
                       admin: User = Depends(require_super_admin)) -> dict:
    code = normalize_code(payload.code)
    if not CODE_RE.fullmatch(code) or code.startswith(("WELCOME-", "THANKS-")):
        raise HTTPException(status_code=422, detail="Use 3–32 letters, numbers or dashes (e.g. EKSU500).")
    if payload.kind == "percent" and payload.value > 100:
        raise HTTPException(status_code=422, detail="A percentage can't be more than 100.")
    if payload.starts_at and payload.ends_at and payload.ends_at <= payload.starts_at:
        raise HTTPException(status_code=422, detail="The end date must be after the start date.")
    if db.scalar(select(PromoCode.id).where(PromoCode.code == code)) is not None:
        raise HTTPException(status_code=409, detail="That code already exists.")
    promo = PromoCode(code=code, description=payload.description, kind=payload.kind, value=payload.value,
                      max_discount=payload.max_discount, min_fare=payload.min_fare, starts_at=payload.starts_at,
                      ends_at=payload.ends_at, max_uses=payload.max_uses, per_user_limit=payload.per_user_limit,
                      first_ride_only=payload.first_ride_only, is_active=True, source="admin",
                      created_by_user_id=admin.id, created_at=_now())
    db.add(promo)
    db.add(AuditLog(actor_user_id=admin.id, action="promo.created", entity_type="promo_code", entity_id=code,
                    details=f"{payload.kind} {payload.value}"))
    db.commit()
    return _admin_row(db, promo)


class PromoUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    is_active: bool


@router.patch("/admin/promos/{promo_id}")
def admin_update_promo(promo_id: int, payload: PromoUpdate, db: Session = Depends(get_db),
                       admin: User = Depends(require_super_admin)) -> dict:
    promo = db.get(PromoCode, promo_id)
    if promo is None or promo.source != "admin":
        raise HTTPException(status_code=404, detail="Promo code not found.")
    promo.is_active = payload.is_active
    db.add(AuditLog(actor_user_id=admin.id, action="promo.activated" if payload.is_active else "promo.paused",
                    entity_type="promo_code", entity_id=promo.code, details=None))
    db.commit()
    return _admin_row(db, promo)
