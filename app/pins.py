"""Pin check: keep every place's map pin accurate, because fares are worked
out from the road distance between pins.

- Flags places whose pin is missing, only guessed from the name, sharing a
  spot with another place, outside the service area, or far from where
  drivers actually start and end trips there.
- Field staff can set a pin "from where I'm standing" (phone GPS) or add a
  new place on the spot. Either way the place's road distances and its
  automatic route prices are updated at once, so it's bookable straight away.
- Drivers' positions when trips start and end at a place are kept as
  evidence; three or more readings in agreement suggest the right pin.
- Riders can suggest a public spot for the list; staff approve or reject it.
"""

from __future__ import annotations

import logging
import math
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from statistics import median

import hashlib

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import get_current_user, require_staff
from app.client_ip import client_ip
from app.config import settings
from app.contacts import ContactError, clean_phone
from app.database import get_db
from app.fare_calculator import _pins, _road_matrix, formula, price, store_distance
from app.geocode import ADO_EKITI_CENTER, MAX_DISTANCE_KM
from app.models import (
    AuditLog, Driver, Place, PlaceDistance, PlaceFare, PlacePinEvidence, PlaceSuggestion, Ride,
    RideLocationPoint, RideRequest, ServiceArea, User, Zone,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1", tags=["map pins"])

MAX_ACCURACY_M = 50        # phone GPS readings less precise than this are refused
SHARED_SPOT_M = 30         # two places closer than this are probably one stacked pin
DISAGREE_M = 150           # trips this far from the pin suggest it's wrong
MIN_SAMPLES = 3            # trip readings needed before suggesting a pin
EVIDENCE_DAYS = 180
FRESH_SECONDS = 180        # driver position must be this recent to count
SIMILAR_SUGGESTION_M = 40
PLACE_TYPES = ("street", "landmark", "junction", "bus_stop", "neighbourhood", "other")

FLAG_TEXT = {
    "no_pin": "No pin yet",
    "guessed": "Guessed from the name",
    "shared_spot": "Same spot as another place",
    "outside": "Outside the service area",
    "trips_disagree": "Trips happen somewhere else",
    "survey_suggests": "Survey helpers sent its location",
}
SURVEY_MIN = 2              # agreeing survey readings needed before suggesting a pin
SURVEY_AGREE_M = 60         # survey readings must be this close together
SURVEY_DAILY_LIMIT = 40     # reports per phone/browser per day


def now() -> datetime:
    return datetime.now(timezone.utc)


def meters_between(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * 6_371_000 * math.asin(math.sqrt(h))


def in_service_area(lat: float, lon: float) -> bool:
    return meters_between(lat, lon, *ADO_EKITI_CENTER) <= MAX_DISTANCE_KM * 1000


def _has_pin(place: Place) -> bool:
    return place.latitude is not None and place.longitude is not None


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).isoformat()


# ------------------------------------------------------------------ evidence

def _driver_position(db: Session, ride: Ride) -> tuple[float, float] | None:
    cutoff = now() - timedelta(seconds=FRESH_SECONDS)
    point = db.scalar(select(RideLocationPoint).where(RideLocationPoint.ride_id == ride.id)
                      .order_by(RideLocationPoint.id.desc()).limit(1))
    if point is not None:
        stamp = point.recorded_at if point.recorded_at.tzinfo else point.recorded_at.replace(tzinfo=timezone.utc)
        if stamp >= cutoff:
            return point.latitude, point.longitude
    driver = db.get(Driver, ride.driver_id)
    if driver and driver.last_latitude is not None and driver.location_updated_at is not None:
        stamp = driver.location_updated_at
        stamp = stamp if stamp.tzinfo else stamp.replace(tzinfo=timezone.utc)
        if stamp >= cutoff:
            return driver.last_latitude, driver.last_longitude
    return None


def record_trip_evidence(db: Session, ride: Ride, request: RideRequest, end: str) -> None:
    """Note where the driver was when a trip started ("origin") or ended
    ("destination") at a listed place. Never fails the status change."""
    try:
        place_id = request.origin_place_id if end == "origin" else request.destination_place_id
        if not place_id:
            return
        position = _driver_position(db, ride)
        if position is None or not in_service_area(*position):
            return
        db.add(PlacePinEvidence(place_id=place_id, latitude=position[0], longitude=position[1],
                                source="trip_start" if end == "origin" else "trip_end", ride_id=ride.id,
                                user_id=None))
    except Exception:  # evidence is a bonus, never a reason to fail a trip update
        logger.exception("Couldn't record pin evidence for ride %s", ride.id)


def survey_suggestion(rows: list[PlacePinEvidence], place: Place) -> dict | None:
    """Where survey helpers standing at the place put it, once two or more agree."""
    readings = [r for r in rows if r.source == "survey"]
    if len(readings) < SURVEY_MIN:
        return None
    lat, lon = median(r.latitude for r in readings), median(r.longitude for r in readings)
    close = [r for r in readings if meters_between(lat, lon, r.latitude, r.longitude) <= SURVEY_AGREE_M]
    # Two different people must agree: one person's repeat visits don't count twice.
    if len({r.contact_phone or r.client_key or r.id for r in close}) < SURVEY_MIN:
        return None
    lat, lon = median(r.latitude for r in close), median(r.longitude for r in close)
    away = round(meters_between(lat, lon, place.latitude, place.longitude)) if _has_pin(place) else None
    return {"latitude": round(lat, 6), "longitude": round(lon, 6), "samples": len(close),
            "helpers": len({r.contact_phone or r.client_key for r in close}), "meters_from_pin": away}


def trip_suggestion(rows: list[PlacePinEvidence], place: Place) -> dict | None:
    """The middle of where trips really happen, once there are enough."""
    trips = [r for r in rows if r.source in ("trip_start", "trip_end")]
    if len(trips) < MIN_SAMPLES:
        return None
    lat, lon = median(r.latitude for r in trips), median(r.longitude for r in trips)
    # Readings should agree with each other: ignore a scattered set.
    spread = median(meters_between(lat, lon, r.latitude, r.longitude) for r in trips)
    if spread > 120:
        return None
    away = round(meters_between(lat, lon, place.latitude, place.longitude)) if _has_pin(place) else None
    return {"latitude": round(lat, 6), "longitude": round(lon, 6), "samples": len(trips),
            "meters_from_pin": away}


# ------------------------------------------------------------------ re-pricing

def reprice_place(db: Session, place: Place) -> dict:
    """Re-measure road distances between this place and every other pinned
    place in its area, and update the automatic route prices. Hand-set
    prices are never changed. Never raises: pin saving must not fail."""
    counts = {"routes": 0, "prices": 0, "road": 0, "estimate": 0}
    try:
        if not _has_pin(place) or place.status != "active":
            return counts
        others = list(db.scalars(
            select(Place).join(Zone, Zone.id == Place.zone_id)
            .where(Place.service_area_id == place.service_area_id, Place.status == "active",
                   Zone.is_active.is_(True), Place.id != place.id,
                   Place.latitude.is_not(None), Place.longitude.is_not(None))
        ).all())
        if not others:
            return counts
        rules = formula(db)
        outward = _road_matrix([place], others)
        inward = _road_matrix(others, [place])
        stored = {(r.origin_place_id, r.destination_place_id): r for r in db.scalars(
            select(PlaceDistance).where(
                ((PlaceDistance.origin_place_id == place.id) & PlaceDistance.destination_place_id.in_(
                    [o.id for o in others]))
                | ((PlaceDistance.destination_place_id == place.id) & PlaceDistance.origin_place_id.in_(
                    [o.id for o in others])))).all()}
        fares = {(f.origin_place_id, f.destination_place_id, f.vehicle_type): f for f in db.scalars(
            select(PlaceFare).where((PlaceFare.origin_place_id == place.id)
                                    | (PlaceFare.destination_place_id == place.id))).all()}
        area = db.get(ServiceArea, place.service_area_id)
        area_active = area is not None and area.status == "active"
        vehicles = [v for v in rules["vehicles"] if v["enabled"]]

        def save(a: Place, b: Place, cell: dict | None) -> None:
            row = stored.get((a.id, b.id))
            if row is None:
                row = PlaceDistance(origin_place_id=a.id, destination_place_id=b.id)
                db.add(row)
            source = store_distance(row, cell, a, b, rules["road_factor"])
            meters = row.meters
            counts["routes"] += 1
            counts[source] += 1
            for v in vehicles:
                key = (a.id, b.id, v["vehicle_type"])
                fare = fares.get(key)
                if fare is not None and fare.pricing_source == "manual":
                    continue
                amount = price(v, meters)
                if fare is None:
                    fare = PlaceFare(origin_place_id=a.id, destination_place_id=b.id, vehicle_type=v["vehicle_type"])
                    db.add(fare)
                    fares[key] = fare
                fare.base_amount = amount
                fare.vehicle_multiplier = Decimal("1.000")
                fare.extra_passenger_amount = Decimal(v["extra_passenger"])
                fare.is_active = area_active
                fare.pricing_source = "auto"
                counts["prices"] += 1

        for i, other in enumerate(others):
            save(place, other, outward[0][i] if outward else None)
            save(other, place, inward[i][0] if inward else None)
        db.flush()
    except Exception:
        logger.exception("Couldn't update prices for place %s", place.id)
    return counts


def _set_pin(db: Session, place: Place, lat: float, lon: float, source: str, label: str, user: User) -> dict:
    before = (place.latitude, place.longitude)
    place.latitude, place.longitude = round(lat, 6), round(lon, 6)
    place.pin_source, place.pin_label = source, label[:200]
    place.pin_verified_at, place.pin_verified_by_user_id = now(), user.id
    db.flush()
    prices = reprice_place(db, place)
    moved = round(meters_between(before[0], before[1], lat, lon)) if before[0] is not None else None
    db.add(AuditLog(actor_user_id=user.id, action="place.pin_set", entity_type="place", entity_id=str(place.id),
                    details=f"{label}. Moved {moved if moved is not None else 'new pin'} m; "
                            f"{prices['prices']} prices updated."))
    return {"moved_m": moved, "prices": prices}


# ------------------------------------------------------------------ pin check

def _bucket(lat: float, lon: float) -> tuple[int, int]:
    return int(lat / 0.0005), int(lon / 0.0005)


def _place_rows(db: Session) -> tuple[list[dict], dict]:
    places = db.scalars(select(Place).where(Place.status.in_(("active", "pending"))).order_by(Place.name)).all()
    zones = {z.id: z for z in db.scalars(select(Zone)).all()}
    areas = {a.id: a for a in db.scalars(select(ServiceArea)).all()}
    since = now() - timedelta(days=EVIDENCE_DAYS)
    evidence: dict[int, list[PlacePinEvidence]] = {}
    for row in db.scalars(select(PlacePinEvidence).where(PlacePinEvidence.created_at >= since)).all():
        evidence.setdefault(row.place_id, []).append(row)
    buckets: dict[tuple[int, int], list[Place]] = {}
    for p in places:
        if _has_pin(p):
            buckets.setdefault(_bucket(p.latitude, p.longitude), []).append(p)

    rows, summary = [], {"total": 0, "attention": 0, "checked": 0, "no_pin": 0}
    for p in places:
        flags, shared = [], []
        if not _has_pin(p):
            flags.append("no_pin")
        else:
            if p.pin_source == "auto" and p.pin_verified_at is None:
                flags.append("guessed")
            bx, by = _bucket(p.latitude, p.longitude)
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for other in buckets.get((bx + dx, by + dy), []):
                        if other.id != p.id and meters_between(
                                p.latitude, p.longitude, other.latitude, other.longitude) < SHARED_SPOT_M:
                            shared.append(other.name)
            if shared:
                flags.append("shared_spot")
            if not in_service_area(p.latitude, p.longitude):
                flags.append("outside")
        suggestion = trip_suggestion(evidence.get(p.id, []), p)
        if suggestion and (suggestion["meters_from_pin"] is None or suggestion["meters_from_pin"] > DISAGREE_M):
            flags.append("trips_disagree")
        survey = survey_suggestion(evidence.get(p.id, []), p)
        if survey and (survey["meters_from_pin"] is None or survey["meters_from_pin"] > SURVEY_AGREE_M) \
                and p.pin_source != "field":
            flags.append("survey_suggests")
        checked = p.pin_verified_at is not None and not flags
        summary["total"] += 1
        summary["attention"] += bool(flags)
        summary["checked"] += checked
        summary["no_pin"] += "no_pin" in flags
        zone, area = zones.get(p.zone_id), areas.get(p.service_area_id)
        rows.append({
            "id": p.id, "name": p.name, "status": p.status, "place_type": p.place_type,
            "zone": {"id": p.zone_id, "name": zone.name if zone else ""},
            "area": {"id": p.service_area_id, "name": area.name if area else ""},
            "latitude": p.latitude, "longitude": p.longitude,
            "pin_source": p.pin_source, "pin_label": p.pin_label,
            "pin_verified_at": _iso(p.pin_verified_at),
            "flags": [{"key": f, "text": FLAG_TEXT[f]} for f in flags],
            "shared_with": sorted(set(shared))[:5],
            "trip_readings": len([r for r in evidence.get(p.id, []) if r.source in ("trip_start", "trip_end")]),
            "survey_readings": len([r for r in evidence.get(p.id, []) if r.source == "survey"]),
            "suggestion": suggestion,
            "survey": survey,
            "checked": checked,
        })
    return rows, summary


@router.get("/admin/pins")
def pin_check(view: str = Query("attention", pattern="^(attention|all|checked)$"),
              q: str | None = Query(None, max_length=80), db: Session = Depends(get_db),
              _staff: User = Depends(require_staff("pins"))) -> dict:
    rows, summary = _place_rows(db)
    if view == "attention":
        rows = [r for r in rows if r["flags"]]
        # Worst first: most flags, then most trips (busy places matter most).
        rows.sort(key=lambda r: (-len(r["flags"]), -r["trip_readings"], r["name"]))
    elif view == "checked":
        rows = [r for r in rows if r["checked"]]
    if q:
        needle = q.strip().lower()
        rows = [r for r in rows if needle in r["name"].lower() or needle in r["zone"]["name"].lower()]
    summary["suggestions"] = db.scalar(select(func.count(PlaceSuggestion.id))
                                       .where(PlaceSuggestion.status == "pending")) or 0
    zones = [{"id": z.id, "name": z.name} for z in db.scalars(
        select(Zone).where(Zone.is_active.is_(True)).order_by(Zone.name)).all()]
    areas = [{"id": a.id, "name": a.name} for a in db.scalars(
        select(ServiceArea).where(ServiceArea.status != "inactive").order_by(ServiceArea.name)).all()]
    return {"summary": summary, "places": rows[:300], "zones": zones, "areas": areas,
            "max_accuracy_m": MAX_ACCURACY_M, "place_types": list(PLACE_TYPES)}


class Reading(BaseModel):
    model_config = ConfigDict(extra="forbid")
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracy_m: float = Field(ge=0, le=5000)


def _check_reading(reading: Reading) -> None:
    if reading.accuracy_m > MAX_ACCURACY_M:
        raise HTTPException(status_code=422, detail=f"Your phone's location is only accurate to about "
                            f"{round(reading.accuracy_m)} m. Step outside, away from tall buildings, wait a few "
                            f"seconds and try again (it needs to be within {MAX_ACCURACY_M} m).")
    if not in_service_area(reading.latitude, reading.longitude):
        raise HTTPException(status_code=422, detail="That location is outside EkiMove's service area.")


def _place_or_404(db: Session, place_id: int) -> Place:
    place = db.get(Place, place_id)
    if place is None or place.status == "inactive":
        raise HTTPException(status_code=404, detail="Place not found.")
    return place


@router.post("/admin/pins/places/{place_id}/on-site")
def set_pin_on_site(place_id: int, reading: Reading, db: Session = Depends(get_db),
                    staff: User = Depends(require_staff("pins"))) -> dict:
    """Set the pin from the phone of someone standing at the place."""
    _check_reading(reading)
    place = _place_or_404(db, place_id)
    result = _set_pin(db, place, reading.latitude, reading.longitude, "field",
                      f"Set on site by {staff.full_name} (±{round(reading.accuracy_m)} m)", staff)
    db.add(PlacePinEvidence(place_id=place.id, latitude=reading.latitude, longitude=reading.longitude,
                            accuracy_m=round(reading.accuracy_m), source="on_site", user_id=staff.id))
    db.commit()
    return {"place_id": place.id, **result}


@router.post("/admin/pins/places/{place_id}/use-trips")
def use_trip_pin(place_id: int, db: Session = Depends(get_db),
                 staff: User = Depends(require_staff("pins"))) -> dict:
    place = _place_or_404(db, place_id)
    since = now() - timedelta(days=EVIDENCE_DAYS)
    rows = db.scalars(select(PlacePinEvidence).where(PlacePinEvidence.place_id == place.id,
                                                     PlacePinEvidence.created_at >= since)).all()
    suggestion = trip_suggestion(list(rows), place)
    if suggestion is None:
        raise HTTPException(status_code=409, detail="There aren't enough trips at this place yet to suggest a pin.")
    result = _set_pin(db, place, suggestion["latitude"], suggestion["longitude"], "trips",
                      f"Moved to where {suggestion['samples']} trips happened", staff)
    db.commit()
    return {"place_id": place.id, **result}


@router.post("/admin/pins/places/{place_id}/use-survey")
def use_survey_pin(place_id: int, db: Session = Depends(get_db),
                   staff: User = Depends(require_staff("pins"))) -> dict:
    place = _place_or_404(db, place_id)
    rows = db.scalars(select(PlacePinEvidence).where(PlacePinEvidence.place_id == place.id,
                                                     PlacePinEvidence.source == "survey")).all()
    suggestion = survey_suggestion(list(rows), place)
    if suggestion is None:
        raise HTTPException(status_code=409, detail="Not enough survey helpers agree on this place yet.")
    result = _set_pin(db, place, suggestion["latitude"], suggestion["longitude"], "survey",
                      f"Placed by {suggestion['helpers']} survey helper(s), approved by {staff.full_name}", staff)
    db.commit()
    return {"place_id": place.id, **result}


@router.post("/admin/pins/places/{place_id}/confirm")
def confirm_pin(place_id: int, db: Session = Depends(get_db),
                staff: User = Depends(require_staff("pins"))) -> dict:
    """The pin was checked and is right; stop flagging it as guessed."""
    place = _place_or_404(db, place_id)
    if not _has_pin(place):
        raise HTTPException(status_code=409, detail="This place has no pin to confirm.")
    place.pin_verified_at, place.pin_verified_by_user_id = now(), staff.id
    if place.pin_source in (None, "auto"):
        place.pin_source = "manual"
    db.add(AuditLog(actor_user_id=staff.id, action="place.pin_confirmed", entity_type="place",
                    entity_id=str(place.id), details="Pin checked and confirmed"))
    db.commit()
    return {"place_id": place.id, "pin_verified_at": _iso(place.pin_verified_at)}


@router.get("/admin/pins/nearby")
def nearby_places(latitude: float = Query(ge=-90, le=90), longitude: float = Query(ge=-180, le=180),
                  db: Session = Depends(get_db), _staff: User = Depends(require_staff("pins"))) -> dict:
    """Listed places near a spot: warns about duplicates and suggests the zone."""
    places = db.scalars(select(Place).where(Place.status.in_(("active", "pending")),
                                            Place.latitude.is_not(None), Place.longitude.is_not(None))).all()
    near = sorted(((meters_between(latitude, longitude, p.latitude, p.longitude), p) for p in places),
                  key=lambda pair: pair[0])[:5]
    return {"places": [{"id": p.id, "name": p.name, "zone_id": p.zone_id, "service_area_id": p.service_area_id,
                        "meters": round(m)} for m, p in near]}


class NewPlaceIn(Reading):
    name: str = Field(min_length=3, max_length=120)
    zone_id: int = Field(gt=0)
    service_area_id: int | None = Field(default=None, gt=0)
    place_type: str = "landmark"
    aliases: str | None = Field(default=None, max_length=300)

    @field_validator("name", "aliases", mode="before")
    @classmethod
    def tidy(cls, value):
        return " ".join(value.split()) if isinstance(value, str) else value


def _create_place(db: Session, *, name: str, zone_id: int, service_area_id: int | None, place_type: str,
                  lat: float, lon: float, source: str, label: str, user: User, aliases: str | None = None) -> Place:
    if place_type not in PLACE_TYPES:
        raise HTTPException(status_code=422, detail="Choose a place type.")
    zone = db.get(Zone, zone_id)
    if zone is None or not zone.is_active:
        raise HTTPException(status_code=422, detail="Choose an active zone.")
    if service_area_id is None:
        nearest = min(((meters_between(lat, lon, p.latitude, p.longitude), p) for p in db.scalars(
            select(Place).where(Place.latitude.is_not(None), Place.status == "active")).all()),
            key=lambda pair: pair[0], default=(None, None))[1]
        service_area_id = nearest.service_area_id if nearest else db.scalar(select(ServiceArea.id).limit(1))
    if service_area_id is None or db.get(ServiceArea, service_area_id) is None:
        raise HTTPException(status_code=422, detail="Choose a service area.")
    place = Place(service_area_id=service_area_id, zone_id=zone_id, name=name, place_type=place_type,
                  aliases=aliases or None, status="active")
    db.add(place)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"“{name}” is already on the list in this area. "
                                                    "Search for it and set its pin instead.") from None
    _set_pin(db, place, lat, lon, source, label, user)
    db.add(AuditLog(actor_user_id=user.id, action="location.place_created", entity_type="place",
                    entity_id=str(place.id), details=f"Created place {name} on site"))
    return place


@router.post("/admin/pins/places", status_code=201)
def add_place_here(payload: NewPlaceIn, db: Session = Depends(get_db),
                   staff: User = Depends(require_staff("pins"))) -> dict:
    """Add a new place at the spot where the staff member is standing."""
    _check_reading(payload)
    place = _create_place(db, name=payload.name, zone_id=payload.zone_id, service_area_id=payload.service_area_id,
                          place_type=payload.place_type, lat=payload.latitude, lon=payload.longitude,
                          source="field", label=f"Added on site by {staff.full_name} (±{round(payload.accuracy_m)} m)",
                          user=staff, aliases=payload.aliases)
    db.add(PlacePinEvidence(place_id=place.id, latitude=payload.latitude, longitude=payload.longitude,
                            accuracy_m=round(payload.accuracy_m), source="on_site", user_id=staff.id))
    db.commit()
    prices = db.scalar(select(func.count(PlaceFare.id)).where(
        (PlaceFare.origin_place_id == place.id) | (PlaceFare.destination_place_id == place.id))) or 0
    return {"place_id": place.id, "name": place.name, "prices": prices}


# ------------------------------------------------------------------ riders' suggestions

class SuggestionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=3, max_length=120)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracy_m: float | None = Field(default=None, ge=0, le=5000)

    @field_validator("name", mode="before")
    @classmethod
    def tidy(cls, value):
        return " ".join(value.split()) if isinstance(value, str) else value


@router.post("/places/suggestions", status_code=201)
def suggest_place(payload: SuggestionIn, db: Session = Depends(get_db),
                  user: User = Depends(get_current_user)) -> dict:
    """A rider suggests a public spot for EkiMove's list (staff review it)."""
    if not in_service_area(payload.latitude, payload.longitude):
        raise HTTPException(status_code=422, detail="That spot is outside EkiMove's service area.")
    today = now() - timedelta(days=1)
    recent = db.scalar(select(func.count(PlaceSuggestion.id)).where(
        PlaceSuggestion.user_id == user.id, PlaceSuggestion.created_at >= today)) or 0
    if recent >= 10:
        raise HTTPException(status_code=429, detail="Thanks! You've suggested a lot of places today. "
                                                    "Please try again tomorrow.")
    suggestion = PlaceSuggestion(user_id=user.id, name=payload.name, latitude=payload.latitude,
                                 longitude=payload.longitude,
                                 accuracy_m=round(payload.accuracy_m) if payload.accuracy_m is not None else None,
                                 status="pending")
    db.add(suggestion)
    db.commit()
    return {"id": suggestion.id, "status": "pending",
            "message": "Thanks! EkiMove will check this spot and add it to the list for everyone."}


@router.get("/points/recent")
def my_recent_spots(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    """The rider's own recent dropped-pin spots, to reuse with one tap."""
    requests_ = db.scalars(select(RideRequest).where(RideRequest.passenger_user_id == user.id)
                           .order_by(RideRequest.id.desc()).limit(40)).all()
    spots, seen = [], []
    for r in requests_:
        for end in ("origin", "destination"):
            if getattr(r, f"{end}_place_id"):
                continue
            lat, lon = getattr(r, f"{end}_latitude"), getattr(r, f"{end}_longitude")
            label = getattr(r, f"{end}_text")
            if lat is None or lon is None or not label:
                continue
            if any(meters_between(lat, lon, s[0], s[1]) < 25 for s in seen):
                continue
            seen.append((lat, lon))
            spots.append({"latitude": lat, "longitude": lon, "label": label})
            if len(spots) >= 5:
                return {"spots": spots}
    return {"spots": spots}


def _who(s: PlaceSuggestion) -> str:
    return f"u{s.user_id}" if s.user_id else (s.contact_phone or s.client_key or f"s{s.id}")


def _similar_pending(db: Session, suggestion: PlaceSuggestion) -> list[PlaceSuggestion]:
    pending = db.scalars(select(PlaceSuggestion).where(PlaceSuggestion.status == "pending",
                                                       PlaceSuggestion.id != suggestion.id)).all()
    return [s for s in pending if meters_between(suggestion.latitude, suggestion.longitude, s.latitude,
                                                 s.longitude) < SIMILAR_SUGGESTION_M]


@router.get("/admin/pins/suggestions")
def list_suggestions(db: Session = Depends(get_db), _staff: User = Depends(require_staff("pins"))) -> dict:
    pending = db.scalars(select(PlaceSuggestion).where(PlaceSuggestion.status == "pending")
                         .order_by(PlaceSuggestion.id)).all()
    places = db.scalars(select(Place).where(Place.status.in_(("active", "pending")),
                                            Place.latitude.is_not(None))).all()
    shown, rows = set(), []
    for s in pending:
        if s.id in shown:
            continue
        group = [s] + _similar_pending(db, s)
        shown.update(g.id for g in group)
        nearest = min(((meters_between(s.latitude, s.longitude, p.latitude, p.longitude), p) for p in places),
                      key=lambda pair: pair[0], default=(None, None))
        rows.append({
            "id": s.id, "name": s.name, "latitude": s.latitude, "longitude": s.longitude,
            "accuracy_m": s.accuracy_m, "suggested_by": len({_who(g) for g in group}),
            "from_survey": any(g.source == "survey" for g in group),
            "other_names": sorted({g.name for g in group if g.name != s.name})[:4],
            "nearest_place": {"name": nearest[1].name, "meters": round(nearest[0]), "zone_id": nearest[1].zone_id,
                              "service_area_id": nearest[1].service_area_id} if nearest[1] else None,
            "created_at": _iso(s.created_at),
        })
    rows.sort(key=lambda r: -r["suggested_by"])
    return {"suggestions": rows}


class ApproveIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=3, max_length=120)
    zone_id: int = Field(gt=0)
    service_area_id: int | None = Field(default=None, gt=0)
    place_type: str = "landmark"


@router.post("/admin/pins/suggestions/{suggestion_id}/approve", status_code=201)
def approve_suggestion(suggestion_id: int, payload: ApproveIn, db: Session = Depends(get_db),
                       staff: User = Depends(require_staff("pins"))) -> dict:
    suggestion = db.get(PlaceSuggestion, suggestion_id)
    if suggestion is None or suggestion.status != "pending":
        raise HTTPException(status_code=404, detail="Suggestion not found.")
    group = [suggestion] + _similar_pending(db, suggestion)
    place = _create_place(db, name=" ".join(payload.name.split()), zone_id=payload.zone_id,
                          service_area_id=payload.service_area_id, place_type=payload.place_type,
                          lat=suggestion.latitude, lon=suggestion.longitude, source="rider",
                          label=f"Suggested by {len({_who(g) for g in group})} people, approved by "
                                f"{staff.full_name}", user=staff)
    from app.push import notify  # avoid an import cycle

    for item in group:
        item.status, item.place_id = "approved", place.id
        item.reviewed_by_user_id, item.reviewed_at = staff.id, now()
    suggesters = sorted({g.user_id for g in group if g.user_id})
    notify(db, suggesters, "Your spot is on EkiMove", f"“{place.name}” is now on the list. Thanks for helping!",
           url="/book-ride", tag=f"place-{place.id}")
    db.commit()
    return {"place_id": place.id, "name": place.name, "approved": len(group)}


@router.post("/admin/pins/suggestions/{suggestion_id}/reject")
def reject_suggestion(suggestion_id: int, db: Session = Depends(get_db),
                      staff: User = Depends(require_staff("pins"))) -> dict:
    suggestion = db.get(PlaceSuggestion, suggestion_id)
    if suggestion is None or suggestion.status != "pending":
        raise HTTPException(status_code=404, detail="Suggestion not found.")
    group = [suggestion] + _similar_pending(db, suggestion)
    for item in group:
        item.status, item.reviewed_by_user_id, item.reviewed_at = "rejected", staff.id, now()
    db.add(AuditLog(actor_user_id=staff.id, action="place.suggestion_rejected", entity_type="place_suggestion",
                    entity_id=str(suggestion.id), details=suggestion.name))
    db.commit()
    return {"rejected": len(group)}


# ------------------------------------------------------------------ public "Map a place" survey

def _client_key(request: Request) -> str:
    raw = f"{client_ip(request)}|{request.headers.get('user-agent', '')[:200]}|{settings.jwt_secret_key or 'ekimove'}"
    return hashlib.sha256(raw.encode()).hexdigest()


@router.get("/survey/places")
def survey_places(db: Session = Depends(get_db)) -> dict:
    """Listed places, the ones that still need a good pin first."""
    places = db.scalars(select(Place).join(Zone, Zone.id == Place.zone_id)
                        .where(Place.status == "active", Zone.is_active.is_(True)).order_by(Place.name)).all()
    zones = {z.id: z.name for z in db.scalars(select(Zone)).all()}
    rows = []
    for p in places:
        needed = not _has_pin(p) or (p.pin_source == "auto" and p.pin_verified_at is None)
        rows.append({"id": p.id, "name": p.name, "zone": zones.get(p.zone_id, ""), "needed": needed})
    rows.sort(key=lambda r: (not r["needed"], r["name"].lower()))
    return {"places": rows, "max_accuracy_m": MAX_ACCURACY_M}


class SurveyReportIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    place_id: int | None = Field(default=None, gt=0)
    name: str | None = Field(default=None, max_length=120)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracy_m: float = Field(ge=0, le=5000)
    contact_phone: str | None = Field(default=None, max_length=32)
    website: str | None = Field(default=None, max_length=200)  # left empty by people; bots fill it in

    @field_validator("name", "contact_phone", mode="before")
    @classmethod
    def tidy(cls, value):
        return " ".join(value.split()) or None if isinstance(value, str) else value


@router.post("/survey/reports", status_code=201)
def survey_report(payload: SurveyReportIn, request: Request, db: Session = Depends(get_db)) -> dict:
    """Someone standing at a place sends its location. No sign-in needed;
    staff review everything before it changes a pin."""
    if payload.website:
        return {"thanks": True, "message": "Thank you!", "your_reports": 0}
    if payload.accuracy_m > MAX_ACCURACY_M:
        raise HTTPException(status_code=422, detail=f"Your phone's location is only accurate to about "
                            f"{round(payload.accuracy_m)} m. Step outside, wait a few seconds and try again.")
    if not in_service_area(payload.latitude, payload.longitude):
        raise HTTPException(status_code=422, detail="That location is outside the area EkiMove covers "
                                                    "(Ado-Ekiti and Iworoko).")
    phone = None
    if payload.contact_phone:
        try:
            phone = clean_phone(payload.contact_phone)
        except ContactError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from None
    key = _client_key(request)
    since = now() - timedelta(days=1)
    who = [PlacePinEvidence.client_key == key] + ([PlacePinEvidence.contact_phone == phone] if phone else [])
    who_s = [PlaceSuggestion.client_key == key] + ([PlaceSuggestion.contact_phone == phone] if phone else [])
    from sqlalchemy import or_

    today = (db.scalar(select(func.count(PlacePinEvidence.id)).where(
        PlacePinEvidence.source == "survey", PlacePinEvidence.created_at >= since, or_(*who))) or 0) + \
        (db.scalar(select(func.count(PlaceSuggestion.id)).where(
            PlaceSuggestion.source == "survey", PlaceSuggestion.created_at >= since, or_(*who_s))) or 0)
    if today >= SURVEY_DAILY_LIMIT:
        raise HTTPException(status_code=429, detail="Thank you for all your help today! Please continue tomorrow.")

    if payload.place_id:
        place = db.get(Place, payload.place_id)
        if place is None or place.status != "active":
            raise HTTPException(status_code=404, detail="That place isn't on the list. Choose another one.")
        again = db.scalar(select(func.count(PlacePinEvidence.id)).where(
            PlacePinEvidence.place_id == place.id, PlacePinEvidence.source == "survey",
            PlacePinEvidence.created_at >= since, or_(*who)))
        if again:
            raise HTTPException(status_code=409, detail=f"You've already sent {place.name} today. Thanks! "
                                                        "Try another place.")
        db.add(PlacePinEvidence(place_id=place.id, latitude=payload.latitude, longitude=payload.longitude,
                                accuracy_m=round(payload.accuracy_m), source="survey", contact_phone=phone,
                                client_key=key))
        what = place.name
    else:
        name = (payload.name or "").strip()
        if len(name) < 3:
            raise HTTPException(status_code=422, detail="Choose the place from the list, or type its name.")
        db.add(PlaceSuggestion(user_id=None, name=name[:120], latitude=payload.latitude, longitude=payload.longitude,
                               accuracy_m=round(payload.accuracy_m), status="pending", source="survey",
                               contact_phone=phone, client_key=key))
        what = name
    db.commit()
    mine = None
    if phone:
        mine = (db.scalar(select(func.count(PlacePinEvidence.id)).where(
            PlacePinEvidence.source == "survey", PlacePinEvidence.contact_phone == phone)) or 0) + \
            (db.scalar(select(func.count(PlaceSuggestion.id)).where(
                PlaceSuggestion.source == "survey", PlaceSuggestion.contact_phone == phone)) or 0)
    return {"thanks": True, "message": f"Thank you! We've received {what}.", "your_reports": mine}


@router.get("/admin/pins/helpers")
def survey_helpers(db: Session = Depends(get_db), _staff: User = Depends(require_staff("pins"))) -> dict:
    """Survey helpers who left a phone number, with how much of their work
    turned out right, for thanking and rewarding them."""
    places = {p.id: p for p in db.scalars(select(Place)).all()}
    helpers: dict[str, dict] = {}
    for r in db.scalars(select(PlacePinEvidence).where(PlacePinEvidence.source == "survey",
                                                       PlacePinEvidence.contact_phone.is_not(None))).all():
        h = helpers.setdefault(r.contact_phone, {"phone": r.contact_phone, "reports": 0, "confirmed": 0,
                                                 "new_places": 0, "approved_places": 0, "last": None})
        h["reports"] += 1
        p = places.get(r.place_id)
        if p is not None and _has_pin(p) and p.pin_verified_at is not None and \
                meters_between(r.latitude, r.longitude, p.latitude, p.longitude) <= SURVEY_AGREE_M:
            h["confirmed"] += 1
        h["last"] = max(filter(None, [h["last"], _iso(r.created_at)]))
    for sgg in db.scalars(select(PlaceSuggestion).where(PlaceSuggestion.source == "survey",
                                                        PlaceSuggestion.contact_phone.is_not(None))).all():
        h = helpers.setdefault(sgg.contact_phone, {"phone": sgg.contact_phone, "reports": 0, "confirmed": 0,
                                                   "new_places": 0, "approved_places": 0, "last": None})
        h["new_places"] += 1
        h["approved_places"] += sgg.status == "approved"
        h["last"] = max(filter(None, [h["last"], _iso(sgg.created_at)]))
    rows = sorted(helpers.values(), key=lambda h: (-(h["confirmed"] + h["approved_places"]), -h["reports"]))
    totals = {"reports": db.scalar(select(func.count(PlacePinEvidence.id)).where(
        PlacePinEvidence.source == "survey")) or 0,
        "new_places": db.scalar(select(func.count(PlaceSuggestion.id)).where(
            PlaceSuggestion.source == "survey")) or 0}
    return {"helpers": rows[:200], "totals": totals}
