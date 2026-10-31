"""Package deliveries across town.

* The sender picks a pickup and drop-off place and a package size:
  small and medium go by motorcycle (or car where no motorcycle fare is
  set), large by car. The price is the route's fare for that vehicle plus
  an admin-set extra for medium and large packages.
* It is dispatched, paid and tracked like a ride. The driver collects it
  with the sender's pickup PIN and can only finish with the 4-digit
  delivery code, which the recipient receives (by text when SMS is set
  up, and the sender can forward it). Five wrong codes lock the trip.
* Staff can mark a delivery done after confirming with the recipient.
"""

from __future__ import annotations

import logging
import secrets
import threading
from datetime import datetime, timezone
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import messaging, promos
from app.app_settings import booking_rules, delivery_rules, is_motorcycle, quote_amount
from app.auth import get_current_user, require_super_admin
from app.config import settings
from app.contacts import ContactError, clean_phone
from app.database import get_db
from app.models import AuditLog, Place, PlaceFare, Ride, RideRequest, ServiceArea, User, Zone
from app.scheduling import check_pickup_time, iso_utc
from app.verification import ensure_passenger_may_book

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1", tags=["deliveries"])
MAX_CODE_FAILURES = 5

SIZES = {
    "small": {"label": "Small", "hint": "Envelope, phone, food pack", "vehicle": "motorbike"},
    "medium": {"label": "Medium", "hint": "Bag or small carton, up to about 10 kg", "vehicle": "motorbike"},
    "large": {"label": "Large", "hint": "Fits in a car boot, up to about 30 kg", "vehicle": "car"},
}
CAR_TYPES = ("car", "standard")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _active_route(db: Session, origin_id: int, destination_id: int) -> tuple[Place, Place, Zone, Zone]:
    if origin_id == destination_id:
        raise HTTPException(status_code=422, detail="Pickup and drop-off must be different places.")
    origin, destination = db.get(Place, origin_id), db.get(Place, destination_id)
    bad = HTTPException(status_code=422, detail="Choose pickup and drop-off places from the list.")
    if origin is None or destination is None or origin.status != "active" or destination.status != "active":
        raise bad
    for place in (origin, destination):
        area = db.get(ServiceArea, place.service_area_id)
        zone = db.get(Zone, place.zone_id)
        if area is None or area.status != "active" or zone is None or not zone.is_active:
            raise bad
    return origin, destination, db.get(Zone, origin.zone_id), db.get(Zone, destination.zone_id)


def _fare_for(fares: dict[str, PlaceFare], size: str) -> tuple[str, PlaceFare] | None:
    """The vehicle and fare a package of this size travels on."""
    if SIZES[size]["vehicle"] == "motorbike":
        for vehicle, fare in fares.items():
            if is_motorcycle(vehicle):
                return vehicle, fare
    for vehicle in CAR_TYPES:
        if vehicle in fares:
            return vehicle, fares[vehicle]
    return None


def delivery_options(db: Session, origin_id: int, destination_id: int) -> list[dict]:
    _active_route(db, origin_id, destination_id)
    fares = {f.vehicle_type: f for f in db.scalars(select(PlaceFare).where(
        PlaceFare.origin_place_id == origin_id, PlaceFare.destination_place_id == destination_id,
        PlaceFare.is_active.is_(True)))}
    rules, extras = booking_rules(db), delivery_rules(db)
    options = []
    for size, meta in SIZES.items():
        found = _fare_for(fares, size)
        if found is None:
            continue
        vehicle, fare = found
        extra = Decimal(extras.get(f"{size}_extra", 0))
        price = (quote_amount(rules, fare, vehicle, 1) + extra).quantize(Decimal("0.01"))
        options.append({"size": size, "label": meta["label"], "hint": meta["hint"], "vehicle_type": vehicle,
                        "price": str(price)})
    return options


@router.get("/delivery-options", tags=["booking"])
def list_delivery_options(origin_place_id: int, destination_place_id: int, db: Session = Depends(get_db)) -> dict:
    rules = delivery_rules(db)
    if not rules["enabled"]:
        return {"enabled": False, "options": []}
    try:
        options = delivery_options(db, origin_place_id, destination_place_id)
    except HTTPException:
        options = []
    return {"enabled": True, "options": options}


class DeliveryCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    origin_place_id: int = Field(gt=0)
    destination_place_id: int = Field(gt=0)
    size: Literal["small", "medium", "large"]
    description: str = Field(min_length=3, max_length=300)
    recipient_name: str = Field(min_length=2, max_length=160)
    recipient_phone: str = Field(min_length=7, max_length=32)
    notes: str | None = Field(default=None, max_length=500)
    fragile: bool = False
    # The sender confirms the package holds nothing on the banned list.
    no_prohibited_items: bool
    scheduled_for: datetime | None = None
    promo_code: str | None = Field(default=None, max_length=40)


def delivery_result(request: RideRequest) -> dict:
    return {
        "id": request.id,
        "service_type": request.service_type,
        "status": request.status,
        "origin_text": request.origin_text,
        "destination_text": request.destination_text,
        "vehicle_type": request.vehicle_type,
        "size": request.delivery_size,
        "description": request.load_description,
        "recipient_name": request.recipient_name,
        "recipient_phone": request.recipient_phone,
        "notes": request.delivery_notes,
        "fragile": request.fragile,
        "quoted_fare": str(Decimal(request.quoted_fare)),
        "discount_amount": str(Decimal(request.discount_amount or 0)),
        "amount_to_pay": str(Decimal(request.quoted_fare) - Decimal(request.discount_amount or 0)),
        "scheduled_for": iso_utc(request.scheduled_for),
        "dispatch_status": request.dispatch_status,
    }


@router.post("/deliveries", status_code=201)
def create_delivery(payload: DeliveryCreate, current_user: User = Depends(get_current_user),
                    db: Session = Depends(get_db)) -> dict:
    if current_user.role != "passenger":
        raise HTTPException(status_code=403, detail="Only customer accounts can send packages.")
    if not delivery_rules(db)["enabled"]:
        raise HTTPException(status_code=503, detail="Deliveries are paused right now. Please try again later.")
    if not payload.no_prohibited_items:
        raise HTTPException(status_code=422, detail="Please confirm the package holds no banned items.")
    ensure_passenger_may_book(db, current_user)
    try:
        recipient_phone = clean_phone(payload.recipient_phone)
    except ContactError:
        raise HTTPException(status_code=422, detail="Enter the recipient's phone number.") from None
    origin, destination, _, _ = _active_route(db, payload.origin_place_id, payload.destination_place_id)
    option = next((o for o in delivery_options(db, origin.id, destination.id) if o["size"] == payload.size), None)
    if option is None:
        raise HTTPException(status_code=422, detail="Deliveries of this size aren't priced for this route yet.")
    scheduled_for = check_pickup_time(db, payload.scheduled_for)
    request = RideRequest(
        passenger_user_id=current_user.id, origin_place_id=origin.id, destination_place_id=destination.id,
        origin_text=origin.name, destination_text=destination.name, vehicle_type=option["vehicle_type"],
        passenger_count=1, quoted_fare=Decimal(option["price"]), status="requested", service_type="delivery",
        load_description=payload.description, delivery_size=payload.size, recipient_name=payload.recipient_name,
        recipient_phone=recipient_phone, delivery_notes=payload.notes or None, fragile=payload.fragile,
        scheduled_for=scheduled_for, dispatch_status="scheduled" if scheduled_for else None,
    )
    db.add(request)
    db.flush()
    if payload.promo_code and payload.promo_code.strip():
        promos.apply_code(db, current_user, request, payload.promo_code)
    db.add(AuditLog(actor_user_id=current_user.id, action="delivery.requested", entity_type="ride_request",
                    entity_id=str(request.id), details=f"{payload.size} package to {payload.recipient_name}."))
    db.commit()
    from app.dispatch import advance_dispatch  # avoid an import cycle

    advance_dispatch(db, force=True)
    db.refresh(request)
    return delivery_result(request)


# --------------------------------------------------------------------------
# Drop-off code
# --------------------------------------------------------------------------


def new_delivery_code() -> str:
    return f"{secrets.randbelow(10000):04d}"


def check_delivery_code(db: Session, ride: Ride, code: str | None, driver_user_id: int) -> None:
    if not ride.delivery_code:
        return
    failures = db.scalar(select(func.count(AuditLog.id)).where(
        AuditLog.action == "delivery.code_failed", AuditLog.entity_id == str(ride.id))) or 0
    if failures >= MAX_CODE_FAILURES:
        raise HTTPException(status_code=429, detail="Too many wrong codes for this delivery. Contact EkiMove support.")
    if not code or not secrets.compare_digest(code.strip(), ride.delivery_code):
        db.add(AuditLog(actor_user_id=driver_user_id, action="delivery.code_failed", entity_type="ride",
                        entity_id=str(ride.id), details="Wrong delivery code entered."))
        db.commit()
        raise HTTPException(status_code=409, detail="That code doesn't match. Ask the recipient for the 4-digit "
                                                    "delivery code they were sent.")


def send_text(phone: str, body: str) -> None:
    """Send in the background so the driver's tap isn't held up (tests replace this)."""
    def run() -> None:
        try:
            messaging.send_sms(phone, body)
        except messaging.MessagingError:
            logger.warning("Could not text a delivery recipient")

    threading.Thread(target=run, daemon=True).start()


def recipient_text(db: Session, ride: Ride, request: RideRequest) -> tuple[str, str] | None:
    """When the package is picked up: a tracking link for the recipient, and
    the text to send them (sent by the caller once the change is saved)."""
    if not ride.share_token:
        ride.share_token = secrets.token_urlsafe(24)
    if not (messaging.sms_configured() and request.recipient_phone and ride.delivery_code):
        return None
    sender = db.get(User, request.passenger_user_id)
    first = (sender.full_name or "Someone").split()[0] if sender else "Someone"
    link = f"{settings.frontend_url.rstrip('/')}/t/{ride.share_token}"
    body = (f"EkiMove: {first} sent you a package. Track: {link} Give the rider code {ride.delivery_code} "
            "only when you have it.")
    return request.recipient_phone, body.encode("ascii", "ignore").decode()


class StaffDelivered(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    reason: str = Field(min_length=3, max_length=300)


@router.post("/admin/rides/{ride_id}/mark-delivered")
def admin_mark_delivered(ride_id: int, payload: StaffDelivered, db: Session = Depends(get_db),
                         admin: User = Depends(require_super_admin)) -> dict:
    """For when the recipient got the package but can't give the code."""
    from app.earnings import record_trip_earning  # avoid an import cycle

    ride = db.get(Ride, ride_id)
    request = db.get(RideRequest, ride.request_id) if ride else None
    if ride is None or request is None or request.service_type != "delivery":
        raise HTTPException(status_code=404, detail="Delivery not found.")
    if ride.status != "in_progress":
        raise HTTPException(status_code=409, detail="Only a package on its way can be marked delivered.")
    ride.status = "completed"
    ride.completed_at = _now()
    record_trip_earning(db, ride)
    db.add(AuditLog(actor_user_id=admin.id, action="delivery.marked_by_staff", entity_type="ride",
                    entity_id=str(ride.id), details=payload.reason))
    from app import notifications  # avoid an import cycle

    notifications.ride_status(db, ride, request)
    db.commit()
    return {"ride_id": ride.id, "status": ride.status}
