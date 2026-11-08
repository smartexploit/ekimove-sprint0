"""Booking rules the super-admin can change in the app, plus vehicle limits.

* A car carries at most 4 passengers.
* A motorcycle carries 1 passenger; a second one is allowed only when the
  super-admin switches it on, at an extra charge they set. A route's own
  "extra passenger" amount for motorcycles overrides that default charge.
* Big cars, vans and dyna trucks are for loads (haulage) and are priced by
  quote, not by fixed route fares.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

from fastapi import APIRouter, Depends, HTTPException
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.auth import require_super_admin
from app.database import get_db
from app.models import AppSetting, AuditLog, User

router = APIRouter(prefix="/api/v1", tags=["settings"])

MOTORCYCLE_TYPES = {"motorcycle", "motorbike"}
HAULAGE_TYPES = {
    "big_car": "Big car (SUV / Sienna)",
    "van": "Van or bus",
    "dyna": "Dyna truck",
}
PASSENGER_LIMITS = {"car": 4, "tricycle": 3, "minibus": 8}
DEFAULT_PASSENGER_LIMIT = 4

DEFAULTS = {
    "motorcycle_second_passenger_enabled": "true",
    "motorcycle_second_passenger_fee": "200",
    "auto_dispatch_enabled": "true",
    "dispatch_offer_seconds": "30",
    "dispatch_max_offers": "5",
    "require_verified_passengers": "false",
    # Once text or email codes are set up, people confirm their phone
    # number or email with a code before using the app.
    "require_contact_verification": "true",
    # Invites: money off a new passenger's first ride, and a thank-you
    # code for whoever invited them once that ride is done (naira).
    "referral_enabled": "true",
    "referral_new_user_amount": "300",
    "referral_reward_amount": "300",
    # Rides booked for later start looking for a driver this many minutes
    # before pickup.
    "schedule_lead_minutes": "20",
    # Package deliveries: on/off, and the extra (naira) on top of the route
    # fare for medium and large packages.
    "delivery_enabled": "true",
    "delivery_medium_extra": "200",
    "delivery_large_extra": "300",
}


def is_motorcycle(vehicle_type: str | None) -> bool:
    return str(vehicle_type or "").strip().lower() in MOTORCYCLE_TYPES


def _get(db: Session, key: str) -> str:
    row = db.get(AppSetting, key)
    return row.value if row is not None else DEFAULTS[key]


def booking_rules(db: Session) -> dict:
    second = _get(db, "motorcycle_second_passenger_enabled") == "true"
    try:
        fee = max(int(_get(db, "motorcycle_second_passenger_fee")), 0)
    except ValueError:
        fee = int(DEFAULTS["motorcycle_second_passenger_fee"])
    return {
        "motorcycle_second_passenger_enabled": second,
        "motorcycle_second_passenger_fee": fee,
        "max_passengers": {"motorcycle": 2 if second else 1, **PASSENGER_LIMITS},
        "require_verified_passengers": _get(db, "require_verified_passengers") == "true",
        "haulage_vehicle_types": [{"value": k, "label": v} for k, v in HAULAGE_TYPES.items()],
        "schedule_lead_minutes": schedule_lead_minutes(db),
        "delivery": delivery_rules(db),
    }


def max_passengers(rules: dict, vehicle_type: str) -> int:
    vehicle_type = str(vehicle_type or "").strip().lower()
    if is_motorcycle(vehicle_type):
        return rules["max_passengers"]["motorcycle"]
    return rules["max_passengers"].get(vehicle_type, DEFAULT_PASSENGER_LIMIT)


def seats_needed(vehicle_type: str, passenger_count: int) -> int:
    """Seats a driver's vehicle must have. Motorcycles are registered as
    one-seat vehicles; whether a second passenger may ride is a booking
    rule, so any approved motorcycle can take a two-passenger booking."""
    return 1 if is_motorcycle(vehicle_type) else passenger_count


def quote_amount(rules: dict, fare, vehicle_type: str, passenger_count: int) -> Decimal:
    base = Decimal(fare.base_amount) * Decimal(fare.vehicle_multiplier)
    extra_each = Decimal(fare.extra_passenger_amount or 0)
    if is_motorcycle(vehicle_type):
        extras = Decimal(0)
        if passenger_count >= 2:
            extras = extra_each if extra_each > 0 else Decimal(rules["motorcycle_second_passenger_fee"])
    else:
        extras = extra_each * (passenger_count - 1)
    return (base + extras).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


@router.get("/booking-rules", tags=["booking"])
def public_booking_rules(db: Session = Depends(get_db)) -> dict:
    return booking_rules(db)


class SettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    motorcycle_second_passenger_enabled: bool | None = None
    motorcycle_second_passenger_fee: int | None = Field(default=None, ge=0, le=100_000)
    auto_dispatch_enabled: bool | None = None
    dispatch_offer_seconds: int | None = Field(default=None, ge=15, le=120)
    dispatch_max_offers: int | None = Field(default=None, ge=1, le=20)
    dispatch_mode: Literal["all", "one"] | None = None
    require_verified_passengers: bool | None = None
    require_contact_verification: bool | None = None
    referral_enabled: bool | None = None
    referral_new_user_amount: int | None = Field(default=None, ge=0, le=50_000)
    referral_reward_amount: int | None = Field(default=None, ge=0, le=50_000)
    schedule_lead_minutes: int | None = Field(default=None, ge=5, le=120)
    delivery_enabled: bool | None = None
    delivery_medium_extra: int | None = Field(default=None, ge=0, le=50_000)
    delivery_large_extra: int | None = Field(default=None, ge=0, le=50_000)


def delivery_rules(db: Session) -> dict:
    def amount(key: str) -> int:
        try:
            return max(int(_get(db, key)), 0)
        except ValueError:
            return int(DEFAULTS[key])

    return {"enabled": _get(db, "delivery_enabled") == "true", "medium_extra": amount("delivery_medium_extra"),
            "large_extra": amount("delivery_large_extra")}


def schedule_lead_minutes(db: Session) -> int:
    try:
        return min(max(int(_get(db, "schedule_lead_minutes")), 5), 120)
    except ValueError:
        return int(DEFAULTS["schedule_lead_minutes"])


def all_settings(db: Session) -> dict:
    from app.dispatch import dispatch_rules  # avoid an import cycle

    from app import messaging
    from app.promos import referral_rules

    return {**booking_rules(db), **dispatch_rules(db), **referral_rules(db),
            "schedule_lead_minutes": schedule_lead_minutes(db),
            "require_contact_verification": _get(db, "require_contact_verification") == "true",
            "sms_configured": messaging.sms_configured(),
            "email_configured": messaging.email_configured()}


@router.get("/admin/settings")
def admin_get_settings(db: Session = Depends(get_db), _admin: User = Depends(require_super_admin)) -> dict:
    return all_settings(db)


@router.put("/admin/settings")
def admin_update_settings(
    payload: SettingsUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_super_admin),
) -> dict:
    changes = {}
    if payload.motorcycle_second_passenger_enabled is not None:
        changes["motorcycle_second_passenger_enabled"] = "true" if payload.motorcycle_second_passenger_enabled else "false"
    if payload.motorcycle_second_passenger_fee is not None:
        changes["motorcycle_second_passenger_fee"] = str(payload.motorcycle_second_passenger_fee)
    if payload.auto_dispatch_enabled is not None:
        changes["auto_dispatch_enabled"] = "true" if payload.auto_dispatch_enabled else "false"
    if payload.dispatch_offer_seconds is not None:
        changes["dispatch_offer_seconds"] = str(payload.dispatch_offer_seconds)
    if payload.dispatch_max_offers is not None:
        changes["dispatch_max_offers"] = str(payload.dispatch_max_offers)
    if payload.dispatch_mode is not None:
        changes["dispatch_mode"] = payload.dispatch_mode
    if payload.require_verified_passengers is not None:
        changes["require_verified_passengers"] = "true" if payload.require_verified_passengers else "false"
    if payload.require_contact_verification is not None:
        changes["require_contact_verification"] = "true" if payload.require_contact_verification else "false"
    for key in ("referral_new_user_amount", "referral_reward_amount", "schedule_lead_minutes",
                "delivery_medium_extra", "delivery_large_extra"):
        if getattr(payload, key) is not None:
            changes[key] = str(getattr(payload, key))
    if payload.delivery_enabled is not None:
        changes["delivery_enabled"] = "true" if payload.delivery_enabled else "false"
    if payload.referral_enabled is not None:
        changes["referral_enabled"] = "true" if payload.referral_enabled else "false"
    if not changes:
        raise HTTPException(status_code=422, detail="Nothing to change.")
    for key, value in changes.items():
        row = db.get(AppSetting, key)
        if row is None:
            db.add(AppSetting(key=key, value=value, updated_by_user_id=admin.id))
        else:
            row.value = value
            row.updated_by_user_id = admin.id
    db.add(AuditLog(actor_user_id=admin.id, action="settings.updated", entity_type="app_settings",
                    entity_id="booking", details=", ".join(f"{k}={v}" for k, v in changes.items())))
    db.commit()
    return all_settings(db)
