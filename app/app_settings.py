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
        "haulage_vehicle_types": [{"value": k, "label": v} for k, v in HAULAGE_TYPES.items()],
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


@router.get("/admin/settings")
def admin_get_settings(db: Session = Depends(get_db), _admin: User = Depends(require_super_admin)) -> dict:
    return booking_rules(db)


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
    return booking_rules(db)
