"""Trip safety and records: pickup PIN, live tracking, share links, the GPS
trail, two-way ratings and receipts."""

from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.config import settings
from app.database import get_db
from app.dispatch import haversine_m
from app.models import (
    AuditLog,
    Driver,
    EarningEntry,
    PassengerVerification,
    Payment,
    Place,
    Rating,
    Ride,
    RideLocationPoint,
    RideRequest,
    User,
    Vehicle,
)

router = APIRouter(prefix="/api/v1", tags=["trips"])

ACTIVE = ("assigned", "driver_arriving", "in_progress")
LOCATION_FRESH = timedelta(minutes=3)
SHARE_GRACE = timedelta(hours=2)
TRAIL_EVERY_SECONDS = 8
MAX_PIN_FAILURES = 5
CITY_SPEED_M_PER_MIN = 350  # about 21 km/h through town


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _iso(value: datetime | None) -> str | None:
    value = _utc(value)
    return value.isoformat() if value else None


def short_name(full_name: str | None) -> str | None:
    if not full_name:
        return None
    parts = full_name.split()
    return parts[0] if len(parts) == 1 else f"{parts[0]} {parts[-1][0].upper()}."


def new_pickup_pin() -> str:
    return f"{secrets.randbelow(10000):04d}"


def rating_summary(db: Session, user_id: int) -> dict:
    count, average = db.execute(
        select(func.count(Rating.id), func.avg(Rating.score)).where(Rating.ratee_user_id == user_id)
    ).one()
    return {"count": count or 0, "average": round(float(average), 1) if average else None}


def passenger_verified(db: Session, user_id: int) -> bool:
    return db.scalar(select(PassengerVerification.id).where(
        PassengerVerification.user_id == user_id, PassengerVerification.status == "approved")) is not None


# --------------------------------------------------------------------------
# Pickup PIN (checked when the driver starts the trip)
# --------------------------------------------------------------------------


def check_pickup_pin(db: Session, ride: Ride, pin: str | None, driver_user_id: int) -> None:
    if not ride.pickup_pin:
        return  # trips created before PINs existed
    failures = db.scalar(select(func.count(AuditLog.id)).where(
        AuditLog.action == "ride.pin_failed", AuditLog.entity_id == str(ride.id)))
    if failures >= MAX_PIN_FAILURES:
        raise HTTPException(status_code=429, detail="Too many wrong PINs for this trip. Contact EkiMove support.")
    if not pin or not secrets.compare_digest(pin.strip(), ride.pickup_pin):
        db.add(AuditLog(actor_user_id=driver_user_id, action="ride.pin_failed", entity_type="ride",
                        entity_id=str(ride.id), details="Wrong pickup PIN entered."))
        db.commit()
        raise HTTPException(status_code=409, detail="That PIN doesn't match. Ask the passenger for the 4-digit "
                                                    "PIN shown in their EkiMove app.")


# --------------------------------------------------------------------------
# GPS trail (written from driver location updates)
# --------------------------------------------------------------------------


def record_trail_point(db: Session, driver: Driver, latitude: float, longitude: float) -> None:
    ride = db.scalar(select(Ride).where(Ride.driver_id == driver.id, Ride.status.in_(ACTIVE))
                     .order_by(Ride.id.desc()).limit(1))
    if ride is None:
        return
    last = db.scalar(select(func.max(RideLocationPoint.recorded_at)).where(RideLocationPoint.ride_id == ride.id))
    last = _utc(last)
    if last is not None and (_now() - last).total_seconds() < TRAIL_EVERY_SECONDS:
        return
    db.add(RideLocationPoint(ride_id=ride.id, latitude=latitude, longitude=longitude, recorded_at=_now()))


def trail_points(db: Session, ride_id: int, limit: int = 500) -> list[list[float]]:
    points = db.scalars(select(RideLocationPoint).where(RideLocationPoint.ride_id == ride_id)
                        .order_by(RideLocationPoint.recorded_at, RideLocationPoint.id).limit(limit)).all()
    return [[p.latitude, p.longitude] for p in points]


# --------------------------------------------------------------------------
# Tracking
# --------------------------------------------------------------------------


def _place(db: Session, place_id: int | None, text: str) -> dict:
    place = db.get(Place, place_id) if place_id else None
    return {"name": place.name if place else text,
            "latitude": place.latitude if place else None,
            "longitude": place.longitude if place else None}


def trip_vehicle(db: Session, ride: Ride, request: RideRequest) -> Vehicle | None:
    if ride.vehicle_id:
        return db.get(Vehicle, ride.vehicle_id)
    return db.scalar(select(Vehicle).where(Vehicle.driver_id == ride.driver_id, Vehicle.is_approved.is_(True),
                                           Vehicle.vehicle_type == request.vehicle_type).order_by(Vehicle.id))


def tracking_view(db: Session, ride: Ride, *, include_pin: bool, public: bool) -> dict:
    request = db.get(RideRequest, ride.request_id)
    driver = db.get(Driver, ride.driver_id)
    driver_user = db.get(User, driver.user_id) if driver else None
    vehicle = trip_vehicle(db, ride, request)
    pickup = _place(db, request.origin_place_id, request.origin_text)
    destination = _place(db, request.destination_place_id, request.destination_text)

    location = None
    if driver and ride.status in ACTIVE and driver.last_latitude is not None and driver.location_updated_at:
        if _now() - _utc(driver.location_updated_at) <= LOCATION_FRESH:
            location = {"latitude": driver.last_latitude, "longitude": driver.last_longitude,
                        "updated_at": _iso(driver.location_updated_at)}

    target = pickup if ride.status in ("assigned", "driver_arriving") else destination
    distance = eta = None
    if location and target["latitude"] is not None:
        distance = haversine_m(location["latitude"], location["longitude"], target["latitude"], target["longitude"])
        eta = max(1, round(distance / CITY_SPEED_M_PER_MIN))

    view = {
        "ride_id": ride.id,
        "status": ride.status,
        "service_type": request.service_type,
        "pickup": pickup,
        "destination": destination,
        "driver": {
            "name": short_name(driver_user.full_name if driver_user else None),
            "rating": rating_summary(db, driver_user.id) if driver_user else None,
            "vehicle_type": vehicle.vehicle_type if vehicle else request.vehicle_type,
            "plate_number": vehicle.plate_number if vehicle else None,
        },
        "driver_location": location,
        "heading_to": "pickup" if ride.status in ("assigned", "driver_arriving") else "destination",
        "distance_m": distance,
        "eta_minutes": eta,
        "trail": trail_points(db, ride.id, 300) if ride.status in ("in_progress", "completed") else [],
        "started_at": _iso(ride.started_at),
        "completed_at": _iso(ride.completed_at),
    }
    if include_pin and ride.status in ("assigned", "driver_arriving"):
        view["pickup_pin"] = ride.pickup_pin
    if not public:
        view["share_active"] = bool(ride.share_token)
    return view


def _ride_for(db: Session, ride_id: int, user: User) -> tuple[Ride, RideRequest, str]:
    """Return the ride and the caller's relation to it: passenger, driver or admin."""
    ride = db.get(Ride, ride_id)
    if ride is None:
        raise HTTPException(status_code=404, detail="Ride not found.")
    request = db.get(RideRequest, ride.request_id)
    if user.role == "super_admin":
        return ride, request, "admin"
    if request.passenger_user_id == user.id:
        return ride, request, "passenger"
    driver = db.get(Driver, ride.driver_id)
    if driver is not None and driver.user_id == user.id:
        return ride, request, "driver"
    raise HTTPException(status_code=404, detail="Ride not found.")


@router.get("/rides/{ride_id}/tracking")
def ride_tracking(ride_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    ride, _, relation = _ride_for(db, ride_id, current_user)
    return tracking_view(db, ride, include_pin=relation == "passenger", public=False)


# --------------------------------------------------------------------------
# Share a live trip with a trusted contact
# --------------------------------------------------------------------------


@router.post("/rides/{ride_id}/share")
def share_trip(ride_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    ride, _, relation = _ride_for(db, ride_id, current_user)
    if relation != "passenger":
        raise HTTPException(status_code=403, detail="Only the passenger can share this trip.")
    if ride.status not in ACTIVE:
        raise HTTPException(status_code=409, detail="Only a live trip can be shared.")
    if not ride.share_token:
        ride.share_token = secrets.token_urlsafe(24)
        db.add(AuditLog(actor_user_id=current_user.id, action="ride.shared", entity_type="ride",
                        entity_id=str(ride.id), details="Live trip link created."))
        db.commit()
    return {"token": ride.share_token, "path": f"/t/{ride.share_token}"}


@router.delete("/rides/{ride_id}/share")
def stop_sharing(ride_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    ride, _, relation = _ride_for(db, ride_id, current_user)
    if relation != "passenger":
        raise HTTPException(status_code=403, detail="Only the passenger can stop sharing this trip.")
    ride.share_token = None
    db.commit()
    return {"shared": False}


@router.get("/share/{token}")
def shared_trip(token: str, db: Session = Depends(get_db)) -> dict:
    """Public, sign-in-free view for the passenger's trusted contact."""
    ride = db.scalar(select(Ride).where(Ride.share_token == token)) if 16 <= len(token) <= 64 else None
    if ride is None:
        raise HTTPException(status_code=404, detail="This trip link isn't valid.")
    ended = _utc(ride.completed_at) or _utc(ride.cancelled_at)
    if ride.status not in ACTIVE and (ended is None or _now() - ended > SHARE_GRACE):
        raise HTTPException(status_code=410, detail="This trip has ended, so the link no longer works.")
    request = db.get(RideRequest, ride.request_id)
    passenger = db.get(User, request.passenger_user_id)
    return {**tracking_view(db, ride, include_pin=False, public=True),
            "passenger_name": short_name(passenger.full_name if passenger else None)}


# --------------------------------------------------------------------------
# Ratings
# --------------------------------------------------------------------------


class RatingInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    score: int = Field(ge=1, le=5)
    comment: str | None = Field(default=None, max_length=500)


@router.post("/rides/{ride_id}/rating", status_code=201)
def rate_trip(ride_id: int, payload: RatingInput, current_user: User = Depends(get_current_user),
              db: Session = Depends(get_db)) -> dict:
    ride, request, relation = _ride_for(db, ride_id, current_user)
    if relation not in ("passenger", "driver"):
        raise HTTPException(status_code=403, detail="Only the passenger and driver can rate this trip.")
    if ride.status != "completed":
        raise HTTPException(status_code=409, detail="You can rate a trip once it's completed.")
    if relation == "passenger":
        ratee = db.get(Driver, ride.driver_id).user_id
    else:
        ratee = request.passenger_user_id
    db.add(Rating(ride_id=ride.id, author_user_id=current_user.id, ratee_user_id=ratee,
                  score=payload.score, comment=payload.comment or None))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="You've already rated this trip.") from None
    return {"ride_id": ride.id, "score": payload.score, "comment": payload.comment or None}


def my_rating(db: Session, ride_id: int, user_id: int) -> int | None:
    return db.scalar(select(Rating.score).where(Rating.ride_id == ride_id, Rating.author_user_id == user_id))


# --------------------------------------------------------------------------
# Receipts
# --------------------------------------------------------------------------


@router.get("/rides/{ride_id}/receipt")
def trip_receipt(ride_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    ride, request, relation = _ride_for(db, ride_id, current_user)
    if ride.status not in ("completed", "cancelled"):
        raise HTTPException(status_code=409, detail="A receipt is available once the trip has ended.")
    payment = db.scalar(select(Payment).where(Payment.ride_id == ride.id))
    driver = db.get(Driver, ride.driver_id)
    driver_user = db.get(User, driver.user_id) if driver else None
    passenger = db.get(User, request.passenger_user_id)
    vehicle = trip_vehicle(db, ride, request)
    paid = payment is not None and payment.status in ("confirmed", "refunded")
    receipt = {
        "receipt_number": f"EKM-{ride.id:06d}",
        "ride_id": ride.id,
        "status": ride.status,
        "service_type": request.service_type,
        "issued_at": _now().isoformat(),
        "trip_date": _iso(ride.completed_at or ride.cancelled_at or ride.assigned_at),
        "started_at": _iso(ride.started_at),
        "completed_at": _iso(ride.completed_at),
        "origin": request.origin_text,
        "destination": request.destination_text,
        "vehicle_type": request.vehicle_type,
        "plate_number": vehicle.plate_number if vehicle else None,
        "passenger_count": request.passenger_count,
        "passenger_name": passenger.full_name if passenger else None,
        "driver_name": short_name(driver_user.full_name if driver_user else None),
        "currency": "NGN",
        "fare": str(Decimal(ride.agreed_fare).quantize(Decimal("0.01"))),
        "paid": paid,
        "discount": str(Decimal(request.discount_amount or 0).quantize(Decimal("0.01"))),
        "amount_paid": str(Decimal(payment.amount).quantize(Decimal("0.01"))) if paid else None,
        "payment_method": payment.method if payment else None,
        "payment_reference": (payment.transfer_reference or payment.provider_transaction_ref) if payment else None,
        "cancellation_fee": str(ride.cancellation_fee) if ride.cancellation_fee is not None else None,
        "refund_amount": str(payment.refund_amount) if payment and payment.refund_amount is not None else None,
        "refund_status": payment.refund_status if payment else None,
        "business": {"name": "EkiMove", "support_email": settings.support_email, "support_phone": settings.support_phone},
    }
    if relation in ("driver", "admin"):
        entry = db.scalar(select(EarningEntry).where(EarningEntry.ride_id == ride.id,
                                                     EarningEntry.kind.in_(("trip", "cancellation_fee"))))
        if entry is not None:
            receipt["driver_earning"] = {"commission": str(entry.commission), "earning": str(entry.amount),
                                         "commission_percent": str(entry.commission_percent)}
    return receipt
