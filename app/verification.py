"""Passenger identity verification, emergency contact, policy acceptance,
and the super-admin's live map and trip trails."""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import get_current_user, is_staff, require_staff
from app.client_ip import client_ip
from app.contacts import ContactError, clean_name
from app.config import settings
from app.database import get_db
from app.driver_applications import ALLOWED_IMAGES, MAX_PHOTO_BYTES
from app.models import (
    AppSetting,
    AuditLog,
    Driver,
    PassengerVerification,
    Place,
    Ride,
    RideOffer,
    RideRequest,
    User,
    Vehicle,
)
from app.photo_storage import PhotoStorageError, delete_driver_photo, download_driver_photo, upload_driver_photo
from app.trip_chat import messages_for
from app.calls import calls_for_ride
from app.points import request_point
from app.trips import ACTIVE, short_name, trail_points

router = APIRouter(prefix="/api/v1", tags=["verification"])

# Bump this when the policies change in a way people must accept again.
POLICY_VERSION = "2026-11-01"
ID_TYPES = {"nin": "National ID (NIN)", "voters_card": "Voter's card",
            "drivers_licence": "Driver's licence", "passport": "International passport"}
ID_PATTERNS = {"nin": r"\d{11}", "voters_card": r"[A-Z0-9 ]{9,23}", "drivers_licence": r"[A-Z0-9-]{8,20}",
               "passport": r"[A-Z][0-9]{8}"}
DEFAULT_CENTER = {"latitude": 7.6233, "longitude": 5.2214}  # Ado-Ekiti


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).isoformat()


def client_fingerprint(request: Request) -> str:
    ip = client_ip(request)
    agent = "".join(ch for ch in request.headers.get("user-agent", "unknown") if ch.isprintable())[:160]
    return f"IP {ip} · {agent}"


def require_verified_passengers(db: Session) -> bool:
    row = db.get(AppSetting, "require_verified_passengers")
    return row is not None and row.value == "true"


def ensure_passenger_may_book(db: Session, user: User) -> None:
    from app.codes import contact_status  # avoid an import cycle

    needs = contact_status(db, user)["needs_verification"]
    if needs:
        raise HTTPException(status_code=403, detail="Please confirm your "
                            f"{'phone number' if needs == 'sms' else 'email address'} with the code we send you "
                            "before booking.")
    if not require_verified_passengers(db):
        return
    verified = db.scalar(select(PassengerVerification.id).where(
        PassengerVerification.user_id == user.id, PassengerVerification.status == "approved"))
    if verified is None:
        raise HTTPException(status_code=403, detail="Please verify your ID in your profile before booking. "
                                                    "It usually takes a few hours.")


def _mask(number: str) -> str:
    return f"{'•' * max(0, len(number) - 4)}{number[-4:]}"


def verification_result(record: PassengerVerification | None, full: bool = False) -> dict:
    if record is None:
        return {"status": "not_submitted"}
    return {
        "status": record.status,
        "id_type": record.id_type,
        "id_type_label": ID_TYPES.get(record.id_type, record.id_type),
        "id_number": record.id_number if full else _mask(record.id_number),
        "has_photo": bool(record.id_photo_ref),
        "review_note": record.review_note,
        "submitted_at": _iso(record.submitted_at),
        "reviewed_at": _iso(record.reviewed_at),
    }


# --------------------------------------------------------------------------
# Passenger: submit ID
# --------------------------------------------------------------------------


@router.get("/me/verification")
def my_verification(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    record = db.scalar(select(PassengerVerification).where(PassengerVerification.user_id == current_user.id))
    return {**verification_result(record), "required_to_book": require_verified_passengers(db),
            "id_types": [{"value": k, "label": v} for k, v in ID_TYPES.items()]}


@router.post("/me/verification", status_code=201)
async def submit_verification(
    id_type: Literal["nin", "voters_card", "drivers_licence", "passport"] = Form(...),
    id_number: str = Form(..., min_length=6, max_length=40),
    id_photo: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    if current_user.role != "passenger":
        raise HTTPException(status_code=403, detail="Drivers are verified through the driver application.")
    number = re.sub(r"\s+", " ", id_number.strip().upper())
    if not re.fullmatch(ID_PATTERNS[id_type], number):
        raise HTTPException(status_code=422, detail=f"That doesn't look like a valid {ID_TYPES[id_type]} number.")
    record = db.scalar(select(PassengerVerification).where(PassengerVerification.user_id == current_user.id))
    if record is not None and record.status == "approved":
        raise HTTPException(status_code=409, detail="Your ID is already verified. Contact support to change it.")

    rule = ALLOWED_IMAGES.get((id_photo.content_type or "").lower())
    if rule is None:
        raise HTTPException(status_code=415, detail="Upload a JPEG, PNG or WebP photo of your ID.")
    try:
        data = await id_photo.read(MAX_PHOTO_BYTES + 1)
    finally:
        await id_photo.close()
    if not data or len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=413, detail="The photo must be no larger than 5 MB.")
    if not rule[1](data):
        raise HTTPException(status_code=415, detail="The file isn't a valid image.")
    try:
        photo_ref = upload_driver_photo(data, folder="passenger-ids")
    except PhotoStorageError:
        raise HTTPException(status_code=503, detail="ID uploads aren't available right now. Please try later.") from None

    old_photo = record.id_photo_ref if record else None
    if record is None:
        record = PassengerVerification(user_id=current_user.id)
        db.add(record)
    record.id_type = id_type
    record.id_number = number
    record.id_photo_ref = photo_ref
    record.status = "pending"
    record.review_note = None
    record.reviewed_at = None
    record.reviewed_by_user_id = None
    record.submitted_at = _now()
    db.add(AuditLog(actor_user_id=current_user.id, action="verification.submitted", entity_type="user",
                    entity_id=str(current_user.id), details=f"{ID_TYPES[id_type]} ending {number[-4:]}"))
    db.commit()
    delete_driver_photo(old_photo)
    return verification_result(record)


# --------------------------------------------------------------------------
# Admin: review IDs
# --------------------------------------------------------------------------


@router.get("/admin/verifications")
def admin_verifications(
    status: Literal["pending", "approved", "rejected"] = Query("pending"),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_staff("drivers")),
) -> list[dict]:
    rows = db.execute(select(PassengerVerification, User).join(User, PassengerVerification.user_id == User.id)
                      .where(PassengerVerification.status == status)
                      .order_by(PassengerVerification.submitted_at).limit(200)).all()
    return [{**verification_result(record, full=True), "user_id": user.id, "name": user.full_name,
             "phone": user.phone or user.email} for record, user in rows]


class ReviewInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    decision: Literal["approve", "reject"]
    note: str | None = Field(default=None, max_length=500)


@router.post("/admin/verifications/{user_id}/review")
def admin_review_verification(user_id: int, payload: ReviewInput, db: Session = Depends(get_db),
                              admin: User = Depends(require_staff("drivers"))) -> dict:
    record = db.scalar(select(PassengerVerification).where(PassengerVerification.user_id == user_id))
    if record is None:
        raise HTTPException(status_code=404, detail="No ID submitted for this account.")
    if payload.decision == "reject" and not (payload.note and len(payload.note) >= 3):
        raise HTTPException(status_code=422, detail="Tell the passenger why, so they can fix it.")
    record.status = "approved" if payload.decision == "approve" else "rejected"
    record.review_note = payload.note
    record.reviewed_at = _now()
    record.reviewed_by_user_id = admin.id
    db.add(AuditLog(actor_user_id=admin.id, action=f"verification.{record.status}", entity_type="user",
                    entity_id=str(user_id), details=payload.note or record.status))
    from app import notifications  # avoid an import cycle

    notifications.id_reviewed(db, user_id, record.status == "approved")
    db.commit()
    return verification_result(record, full=True)


@router.get("/admin/verifications/{user_id}/photo")
def admin_verification_photo(user_id: int, db: Session = Depends(get_db),
                             _admin: User = Depends(require_staff("drivers"))) -> Response:
    record = db.scalar(select(PassengerVerification).where(PassengerVerification.user_id == user_id))
    if record is None or not record.id_photo_ref:
        raise HTTPException(status_code=404, detail="ID photo not found.")
    try:
        data, content_type = download_driver_photo(record.id_photo_ref)
    except (ValueError, PhotoStorageError):
        raise HTTPException(status_code=502, detail="Couldn't load the ID photo.") from None
    return Response(content=data, media_type=content_type, headers={"Cache-Control": "no-store"})


# --------------------------------------------------------------------------
# Emergency contact
# --------------------------------------------------------------------------


class EmergencyContact(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    name: str = Field(default="", max_length=160)
    phone: str = Field(default="", max_length=32)


@router.put("/me/emergency-contact")
def set_emergency_contact(payload: EmergencyContact, current_user: User = Depends(get_current_user),
                          db: Session = Depends(get_db)) -> dict:
    payload.phone = " ".join(re.sub(r"[()\-.]", " ", payload.phone).split())
    if payload.phone and not re.fullmatch(r"\+?\d[\d ]{6,18}", payload.phone):
        raise HTTPException(status_code=422, detail="Enter a valid phone number.")
    if payload.name:
        try:
            payload.name = clean_name(payload.name, label="contact's name")
        except ContactError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from None
    if bool(payload.name) != bool(payload.phone):
        raise HTTPException(status_code=422, detail="Enter both a name and a phone number, or clear both.")
    current_user.emergency_contact_name = payload.name or None
    current_user.emergency_contact_phone = payload.phone or None
    db.commit()
    return {"name": current_user.emergency_contact_name, "phone": current_user.emergency_contact_phone}


# --------------------------------------------------------------------------
# Policies
# --------------------------------------------------------------------------


def record_policy_acceptance(db: Session, user: User, request: Request | None) -> None:
    user.policies_version = POLICY_VERSION
    user.policies_accepted_at = _now()
    db.add(AuditLog(actor_user_id=user.id, action="policies.accepted", entity_type="user", entity_id=str(user.id),
                    details=f"Version {POLICY_VERSION}" + (f" · {client_fingerprint(request)}" if request else "")))


@router.get("/policies/status")
def policies_status(current_user: User = Depends(get_current_user)) -> dict:
    return {"current_version": POLICY_VERSION, "accepted_version": current_user.policies_version,
            "accepted_at": _iso(current_user.policies_accepted_at),
            "needs_acceptance": not is_staff(current_user) and current_user.policies_version != POLICY_VERSION}


class PolicyAccept(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: str


@router.post("/policies/accept")
def accept_policies(payload: PolicyAccept, request: Request, current_user: User = Depends(get_current_user),
                    db: Session = Depends(get_db)) -> dict:
    if payload.version != POLICY_VERSION:
        raise HTTPException(status_code=409, detail="The policies have been updated. Please reload and read them again.")
    record_policy_acceptance(db, current_user, request)
    db.commit()
    return policies_status(current_user)


# --------------------------------------------------------------------------
# Maps: tiles, admin live map, trip trails
# --------------------------------------------------------------------------


@router.get("/map-config")
def map_config() -> dict:
    base = _tile_config()
    if settings.google_maps_browser_key:
        # Google's terms: Google search results and distances go on a Google
        # map, so every map uses Google once its browser key is set. The
        # tiles above stay as the fallback if Google's map fails to load.
        base.update({"provider": "google", "google_key": settings.google_maps_browser_key,
                     "google_map_id": settings.google_maps_map_id})
    else:
        base["provider"] = "tiles"
    return base


def _tile_config() -> dict:
    if settings.geoapify_api_key:
        return {"tile_url": f"https://maps.geoapify.com/v1/tile/osm-bright/{{z}}/{{x}}/{{y}}.png?apiKey={settings.geoapify_api_key}",
                "attribution": 'Powered by <a href="https://www.geoapify.com/">Geoapify</a> | © OpenStreetMap contributors',
                "center": DEFAULT_CENTER}
    return {"tile_url": "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
            "attribution": '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            "center": DEFAULT_CENTER}


def _coords(place: Place | None) -> dict | None:
    if place is None or place.latitude is None or place.longitude is None:
        return None
    return {"latitude": place.latitude, "longitude": place.longitude, "name": place.name}


def _point_coords(db: Session, request: RideRequest, end: str) -> dict | None:
    point = request_point(db, request, end)
    return point if point["latitude"] is not None and point["longitude"] is not None else None


@router.get("/admin/live-map")
def admin_live_map(db: Session = Depends(get_db), _admin: User = Depends(require_staff("dispatch", "support"))) -> dict:
    now = _now()
    active_rides = db.scalars(select(Ride).where(Ride.status.in_(ACTIVE))).all()
    ride_by_driver = {ride.driver_id: ride for ride in active_rides}
    offered = set(db.scalars(select(RideOffer.driver_id).where(RideOffer.status == "pending")).all())
    drivers = []
    for driver, user in db.execute(select(Driver, User).join(User, Driver.user_id == User.id)
                                   .where(Driver.is_online.is_(True), User.is_active.is_(True))).all():
        updated = driver.location_updated_at
        if updated is not None and updated.tzinfo is None:
            updated = updated.replace(tzinfo=timezone.utc)
        plates = db.scalars(select(Vehicle.plate_number).where(Vehicle.driver_id == driver.id,
                                                               Vehicle.is_approved.is_(True))).all()
        ride = ride_by_driver.get(driver.id)
        drivers.append({
            "driver_id": driver.id, "user_id": user.id, "name": user.full_name, "phone": user.phone,
            "plates": plates,
            "latitude": driver.last_latitude, "longitude": driver.last_longitude,
            "location_updated_at": _iso(updated),
            "location_stale": updated is None or now - updated > timedelta(minutes=5),
            "state": "on_trip" if ride else ("offered" if driver.id in offered else "free"),
            "ride_id": ride.id if ride else None,
        })
    trips = []
    for ride in active_rides:
        request = db.get(RideRequest, ride.request_id)
        passenger = db.get(User, request.passenger_user_id)
        driver = db.get(Driver, ride.driver_id)
        driver_user = db.get(User, driver.user_id) if driver else None
        trips.append({
            "ride_id": ride.id, "status": ride.status, "route": f"{request.origin_text} → {request.destination_text}",
            "service_type": request.service_type, "recipient": request.recipient_name,
            "passenger": passenger.full_name if passenger else None, "passenger_phone": (passenger.phone or passenger.email) if passenger else None,
            "driver": driver_user.full_name if driver_user else None,
            "pickup": _point_coords(db, request, "origin"),
            "destination": _point_coords(db, request, "destination"),
            "driver_location": ({"latitude": driver.last_latitude, "longitude": driver.last_longitude}
                                if driver and driver.last_latitude is not None else None),
        })
    return {"generated_at": now.isoformat(), "center": DEFAULT_CENTER, "drivers": drivers, "trips": trips}


@router.get("/admin/rides/{ride_id}/trail")
def admin_ride_trail(ride_id: int, db: Session = Depends(get_db), _admin: User = Depends(require_staff("dispatch", "support"))) -> dict:
    ride = db.get(Ride, ride_id)
    if ride is None:
        raise HTTPException(status_code=404, detail="Ride not found.")
    request = db.get(RideRequest, ride.request_id)
    driver = db.get(Driver, ride.driver_id)
    driver_user = db.get(User, driver.user_id) if driver else None
    passenger = db.get(User, request.passenger_user_id)
    vehicle = db.get(Vehicle, ride.vehicle_id) if ride.vehicle_id else None
    return {
        "ride_id": ride.id, "status": ride.status, "route": f"{request.origin_text} → {request.destination_text}",
        "passenger": {"id": passenger.id, "name": passenger.full_name, "phone": passenger.phone or passenger.email} if passenger else None,
        "driver": {"id": driver_user.id, "name": driver_user.full_name, "phone": driver_user.phone} if driver_user else None,
        "vehicle": {"plate_number": vehicle.plate_number, "vehicle_type": vehicle.vehicle_type} if vehicle else None,
        "assigned_at": _iso(ride.assigned_at), "arrived_at": _iso(ride.arrived_at),
        "started_at": _iso(ride.started_at), "completed_at": _iso(ride.completed_at),
        "cancelled_at": _iso(ride.cancelled_at),
        "pickup": _point_coords(db, request, "origin"),
        "destination": _point_coords(db, request, "destination"),
        "trail": trail_points(db, ride.id, 2000),
        "messages": messages_for(db, ride),
        "calls": calls_for_ride(db, ride),
        "passenger_name_short": short_name(passenger.full_name if passenger else None),
    }
