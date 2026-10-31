"""Automatic dispatch: offer each request to the best-placed driver.

How it works
------------
* A new (or accepted load) request is offered to one eligible driver at a
  time. The driver has ``dispatch_offer_seconds`` to accept or decline.
* Eligible: approved, online, active account, an approved vehicle of the
  right type and size, not already on a trip, not holding another offer,
  and not already offered this request.
* Best-placed: the nearest driver by straight-line distance when the
  pickup place has coordinates and the driver shared a recent location;
  otherwise the driver who has waited longest for a trip.
* A decline or timeout moves the offer to the next driver. After
  ``dispatch_max_offers`` attempts the request is flagged for an admin,
  who can always assign by hand from Dispatch.

There is no background worker: ``advance_dispatch`` runs whenever drivers,
passengers or admins load or poll their pages (and from an optional
scheduled call), at most every couple of seconds per server.
"""

from __future__ import annotations

import hmac
import math
import threading
import time
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app import notifications
from app.app_settings import seats_needed
from app.auth import get_current_user
from app.config import settings
from app.database import get_db
from app.earnings import split_fare
from app.models import (
    AppSetting,
    AuditLog,
    Driver,
    Place,
    Ride,
    RideOffer,
    RideRequest,
    User,
    Vehicle,
)

router = APIRouter(prefix="/api/v1", tags=["dispatch"])

BUSY_RIDE_STATUSES = ("assigned", "driver_arriving", "in_progress")
LOCATION_FRESH_MINUTES = 15
DEFAULTS = {"auto_dispatch_enabled": "true", "dispatch_offer_seconds": "30", "dispatch_max_offers": "5"}
_throttle_lock = threading.Lock()
_last_run = 0.0
MIN_SECONDS_BETWEEN_RUNS = 2.0


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def dispatch_rules(db: Session) -> dict:
    def get(key: str) -> str:
        row = db.get(AppSetting, key)
        return row.value if row is not None else DEFAULTS[key]

    def as_int(key: str, low: int, high: int) -> int:
        try:
            return min(max(int(get(key)), low), high)
        except ValueError:
            return int(DEFAULTS[key])

    return {
        "auto_dispatch_enabled": get("auto_dispatch_enabled") == "true",
        "dispatch_offer_seconds": as_int("dispatch_offer_seconds", 15, 120),
        "dispatch_max_offers": as_int("dispatch_max_offers", 1, 20),
    }


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> int:
    r = 6_371_000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return int(2 * r * math.asin(math.sqrt(a)))


# --------------------------------------------------------------------------
# Assignment (shared by drivers accepting offers and admins assigning)
# --------------------------------------------------------------------------


def withdraw_offers(db: Session, request_id: int, keep_offer_id: int | None = None) -> None:
    for offer in db.scalars(select(RideOffer).where(RideOffer.request_id == request_id,
                                                   RideOffer.status == "pending")).all():
        if offer.id != keep_offer_id:
            offer.status = "withdrawn"
            offer.responded_at = _now()


def driver_is_busy(db: Session, driver_id: int) -> bool:
    return db.scalar(select(func.count(Ride.id)).where(Ride.driver_id == driver_id,
                                                       Ride.status.in_(BUSY_RIDE_STATUSES))) > 0


def matching_vehicle(db: Session, driver_id: int, ride_request: RideRequest) -> Vehicle | None:
    return db.scalar(
        select(Vehicle).where(
            Vehicle.driver_id == driver_id,
            Vehicle.is_approved.is_(True),
            Vehicle.vehicle_type == ride_request.vehicle_type,
            Vehicle.capacity >= seats_needed(ride_request.vehicle_type, ride_request.passenger_count),
        ).order_by(Vehicle.id)
    )


def assign_driver(db: Session, ride_request: RideRequest, driver: Driver, actor_id: int | None,
                  how: str) -> tuple[Ride, Vehicle]:
    """Create the ride for a request. Raises HTTPException if not allowed."""
    if ride_request.status != "requested":
        raise HTTPException(status_code=409, detail="Only unassigned ride requests can be assigned")
    if driver.verification_status != "approved" or not driver.is_online:
        raise HTTPException(status_code=409, detail="Driver must be approved and online")
    driver_user = db.get(User, driver.user_id)
    if driver_user is None or not driver_user.is_active:
        raise HTTPException(status_code=409, detail="Driver account is not active")
    vehicle = matching_vehicle(db, driver.id, ride_request)
    if vehicle is None:
        raise HTTPException(status_code=409,
                            detail="Driver has no approved matching vehicle with sufficient capacity")

    from app.trips import new_pickup_pin  # avoid an import cycle

    ride = Ride(request_id=ride_request.id, driver_id=driver.id, status="assigned",
                agreed_fare=Decimal(ride_request.quoted_fare), assigned_at=_now(),
                vehicle_id=vehicle.id, pickup_pin=new_pickup_pin(),
                delivery_code=new_pickup_pin() if ride_request.service_type == "delivery" else None)
    ride_request.status = "assigned"
    ride_request.dispatch_status = None
    db.add(ride)
    db.add(AuditLog(actor_user_id=actor_id, action="ride.assigned", entity_type="ride_request",
                    entity_id=str(ride_request.id), details=f"Driver {driver.id} assigned {how}."))
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Ride request has already been assigned") from None
    notifications.driver_assigned(db, ride_request, driver, vehicle)
    return ride, vehicle


# --------------------------------------------------------------------------
# The engine
# --------------------------------------------------------------------------


def _idle_since(db: Session, driver: Driver) -> datetime:
    last_trip = db.scalar(select(func.max(Ride.completed_at)).where(Ride.driver_id == driver.id))
    candidates = [t for t in (_as_utc(last_trip), _as_utc(driver.online_since)) if t]
    return max(candidates) if candidates else datetime(2000, 1, 1, tzinfo=timezone.utc)


def ranked_drivers(db: Session, ride_request: RideRequest) -> list[tuple[Driver, int | None]]:
    tried = set(db.scalars(select(RideOffer.driver_id).where(RideOffer.request_id == ride_request.id)).all())
    holding = set(db.scalars(select(RideOffer.driver_id).where(RideOffer.status == "pending")).all())
    busy = set(db.scalars(select(Ride.driver_id).where(Ride.status.in_(BUSY_RIDE_STATUSES))).all())
    drivers = db.scalars(
        select(Driver).join(User, Driver.user_id == User.id).where(
            Driver.verification_status == "approved",
            Driver.is_online.is_(True),
            User.is_active.is_(True),
        )
    ).all()

    pickup = db.get(Place, ride_request.origin_place_id) if ride_request.origin_place_id else None
    fresh_after = _now() - timedelta(minutes=LOCATION_FRESH_MINUTES)
    located, unlocated = [], []
    for driver in drivers:
        if driver.id in tried or driver.id in holding or driver.id in busy:
            continue
        if matching_vehicle(db, driver.id, ride_request) is None:
            continue
        has_fix = (pickup is not None and pickup.latitude is not None and pickup.longitude is not None
                   and driver.last_latitude is not None and driver.last_longitude is not None
                   and (_as_utc(driver.location_updated_at) or fresh_after) > fresh_after)
        if has_fix:
            located.append((driver, haversine_m(driver.last_latitude, driver.last_longitude,
                                                pickup.latitude, pickup.longitude)))
        else:
            unlocated.append((driver, None))
    located.sort(key=lambda item: item[1])
    unlocated.sort(key=lambda item: _idle_since(db, item[0]))
    return located + unlocated


def _offer_next(db: Session, ride_request: RideRequest, rules: dict) -> None:
    """Offer one waiting request to the best eligible driver and commit."""
    if ride_request.dispatch_attempts >= rules["dispatch_max_offers"]:
        if ride_request.dispatch_status != "manual":
            ride_request.dispatch_status = "manual"
            db.add(AuditLog(actor_user_id=None, action="dispatch.needs_admin", entity_type="ride_request",
                            entity_id=str(ride_request.id),
                            details=f"No driver accepted after {ride_request.dispatch_attempts} offers."))
        db.commit()
        return
    candidates = ranked_drivers(db, ride_request)
    if not candidates:
        ride_request.dispatch_status = "searching"
        db.commit()
        return
    driver, distance = candidates[0]
    db.add(RideOffer(request_id=ride_request.id, driver_id=driver.id, status="pending",
                     distance_m=distance, offered_at=_now(),
                     expires_at=_now() + timedelta(seconds=rules["dispatch_offer_seconds"])))
    ride_request.dispatch_attempts += 1
    ride_request.dispatch_status = "offering"
    notifications.trip_offered(db, ride_request, driver, rules["dispatch_offer_seconds"])
    try:
        db.commit()
    except IntegrityError:
        # Another server offered this request (or this driver) a moment ago;
        # the next run picks up from there.
        db.rollback()


def advance_dispatch(db: Session, force: bool = False) -> None:
    """Expire overdue offers and offer waiting requests to the next driver."""
    global _last_run
    with _throttle_lock:
        if not force and time.monotonic() - _last_run < MIN_SECONDS_BETWEEN_RUNS:
            return
        _last_run = time.monotonic()
    try:
        now = _now()
        for offer in db.scalars(select(RideOffer).where(RideOffer.status == "pending")).all():
            if (_as_utc(offer.expires_at) or now) <= now:
                offer.status = "expired"
                offer.responded_at = now
        db.commit()

        rules = dispatch_rules(db)
        if not rules["auto_dispatch_enabled"]:
            return
        waiting_ids = db.scalars(
            select(RideRequest.id).where(RideRequest.status == "requested",
                                         or_(RideRequest.dispatch_status.is_(None),
                                             RideRequest.dispatch_status != "manual"))
            .order_by(RideRequest.created_at, RideRequest.id)
        ).all()
        from app.app_settings import schedule_lead_minutes  # avoid an import cycle
        from app.scheduling import due_for_dispatch

        lead = schedule_lead_minutes(db)
        for request_id in waiting_ids:
            if db.scalar(select(RideOffer.id).where(RideOffer.request_id == request_id,
                                                    RideOffer.status == "pending")):
                continue
            ride_request = db.get(RideRequest, request_id)
            if ride_request is None or ride_request.status != "requested":
                continue
            # Rides booked for later wait until shortly before pickup.
            if not due_for_dispatch(ride_request, lead, now):
                continue
            if ride_request.dispatch_status == "scheduled":
                ride_request.dispatch_status = None
                notifications.scheduled_search_started(db, ride_request)
            _offer_next(db, ride_request, rules)
    except SQLAlchemyError:
        db.rollback()


def reset_dispatch_throttle() -> None:
    """For tests: let the next advance_dispatch call run immediately."""
    global _last_run
    _last_run = 0.0


# --------------------------------------------------------------------------
# Driver API
# --------------------------------------------------------------------------


def _my_driver(user: User, db: Session) -> Driver:
    if user.role != "driver":
        raise HTTPException(status_code=403, detail="Driver account required.")
    driver = db.scalar(select(Driver).where(Driver.user_id == user.id))
    if driver is None:
        raise HTTPException(status_code=404, detail="Driver profile not found.")
    return driver


class LocationUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


@router.post("/driver/location")
def update_my_location(payload: LocationUpdate, current_user: User = Depends(get_current_user),
                       db: Session = Depends(get_db)) -> dict:
    driver = _my_driver(current_user, db)
    from app.trips import record_trail_point  # avoid an import cycle

    driver.last_latitude = payload.latitude
    driver.last_longitude = payload.longitude
    driver.location_updated_at = _now()
    record_trail_point(db, driver, payload.latitude, payload.longitude)
    db.commit()
    return {"ok": True}


def offer_result(db: Session, offer: RideOffer) -> dict:
    ride_request = db.get(RideRequest, offer.request_id)
    gross, commission, net = split_fare(ride_request.quoted_fare)
    left = max(0, int(((_as_utc(offer.expires_at) or _now()) - _now()).total_seconds()))
    return {
        "id": offer.id,
        "request_id": ride_request.id,
        "status": offer.status,
        "seconds_left": left,
        "expires_at": _as_utc(offer.expires_at).isoformat(),
        "distance_m": offer.distance_m,
        "origin_text": ride_request.origin_text,
        "destination_text": ride_request.destination_text,
        "vehicle_type": ride_request.vehicle_type,
        "passenger_count": ride_request.passenger_count,
        "service_type": ride_request.service_type,
        "load_description": ride_request.load_description,
        "delivery_size": ride_request.delivery_size,
        "fragile": ride_request.fragile,
        "fare": str(gross),
        "commission": str(commission),
        "earning": str(net),
    }


@router.get("/driver/offers/current")
def my_current_offer(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    driver = _my_driver(current_user, db)
    advance_dispatch(db)
    offer = db.scalar(select(RideOffer).where(RideOffer.driver_id == driver.id, RideOffer.status == "pending"))
    if offer is not None and (_as_utc(offer.expires_at) or _now()) <= _now():
        offer = None
    return {"offer": offer_result(db, offer) if offer else None, "is_online": driver.is_online}


def _my_pending_offer(db: Session, offer_id: int, driver: Driver) -> RideOffer:
    offer = db.get(RideOffer, offer_id)
    if offer is None or offer.driver_id != driver.id:
        raise HTTPException(status_code=404, detail="Offer not found.")
    if offer.status != "pending" or (_as_utc(offer.expires_at) or _now()) <= _now():
        raise HTTPException(status_code=409, detail="This trip is no longer available. It went to another driver.")
    return offer


@router.post("/driver/offers/{offer_id}/accept")
def accept_offer(offer_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    driver = _my_driver(current_user, db)
    offer = _my_pending_offer(db, offer_id, driver)
    if driver_is_busy(db, driver.id):
        raise HTTPException(status_code=409, detail="Finish your current trip before taking another.")
    ride_request = db.get(RideRequest, offer.request_id)
    ride, vehicle = assign_driver(db, ride_request, driver, current_user.id, "by accepting an offer")
    offer.status = "accepted"
    offer.responded_at = _now()
    withdraw_offers(db, ride_request.id, keep_offer_id=offer.id)
    db.commit()
    return {"ride_id": ride.id, "request_id": ride_request.id, "status": ride.status,
            "plate_number": vehicle.plate_number}


@router.post("/driver/offers/{offer_id}/decline")
def decline_offer(offer_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    driver = _my_driver(current_user, db)
    offer = _my_pending_offer(db, offer_id, driver)
    offer.status = "declined"
    offer.responded_at = _now()
    db.commit()
    advance_dispatch(db, force=True)
    return {"status": "declined"}


def driver_went_offline(db: Session, driver: Driver) -> None:
    """Hand any live offer straight to the next driver."""
    for offer in db.scalars(select(RideOffer).where(RideOffer.driver_id == driver.id,
                                                   RideOffer.status == "pending")).all():
        offer.status = "declined"
        offer.responded_at = _now()


def dispatch_summary(db: Session, ride_request: RideRequest) -> dict:
    """Dispatch state shown to admins and passengers."""
    offer = db.scalar(select(RideOffer).where(RideOffer.request_id == ride_request.id,
                                             RideOffer.status == "pending"))
    current = None
    if offer is not None:
        driver = db.get(Driver, offer.driver_id)
        user = db.get(User, driver.user_id) if driver else None
        left = max(0, int(((_as_utc(offer.expires_at) or _now()) - _now()).total_seconds()))
        current = {"driver_id": offer.driver_id, "driver_name": user.full_name if user else None,
                   "seconds_left": left, "distance_m": offer.distance_m}
    declined = db.scalar(select(func.count(RideOffer.id)).where(
        RideOffer.request_id == ride_request.id, RideOffer.status.in_(("declined", "expired"))))
    created = _as_utc(ride_request.created_at) or _now()
    if ride_request.scheduled_for is not None:
        from app.app_settings import schedule_lead_minutes  # avoid an import cycle

        created = max(created, _as_utc(ride_request.scheduled_for) - timedelta(minutes=schedule_lead_minutes(db)))
    return {
        "scheduled_for": _as_utc(ride_request.scheduled_for).isoformat() if ride_request.scheduled_for else None,
        "dispatch_status": ride_request.dispatch_status,
        "dispatch_attempts": ride_request.dispatch_attempts,
        "declined_or_missed": declined,
        "current_offer": current,
        "waiting_seconds": max(0, int((_now() - created).total_seconds())),
    }


# --------------------------------------------------------------------------
# Optional scheduled run (e.g. a Render Cron Job every minute)
# --------------------------------------------------------------------------


@router.post("/internal/dispatch/run", include_in_schema=False)
def cron_advance_dispatch(x_cron_token: str | None = Header(default=None), db: Session = Depends(get_db)) -> dict:
    expected = settings.payout_cron_token
    if not expected:
        raise HTTPException(status_code=404, detail="Not found.")
    if not x_cron_token or not hmac.compare_digest(expected, x_cron_token):
        raise HTTPException(status_code=401, detail="Invalid token.")
    advance_dispatch(db, force=True)
    return {"ok": True}
