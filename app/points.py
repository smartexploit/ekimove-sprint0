"""Booking to a spot that isn't on EkiMove's list of places.

When "Riders can drop a pin" is on in the Fare calculator, a rider can drop a
pin on the map for the pickup or destination and describe the spot (e.g.
"blue gate opposite the church"). The price is worked out on the server from
the road distance with the same per-km formula, so it can't be tampered
with. Pins must be close to an area EkiMove serves.
"""

from __future__ import annotations

import logging
import math
import re
from decimal import Decimal

import requests
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import google_maps
from app.app_settings import booking_rules, is_motorcycle, max_passengers
from app.auth import get_current_user
from app.client_ip import client_ip
from app.config import settings
from app.database import get_db
from app.anchor_fares import anchor_price, load_anchors
from app.fare_calculator import formula
from app.geocode import NOMINATIM_URL, USER_AGENT
from app.models import Place, RideRequest, ServiceArea, User, Zone
from app.rate_limit import enforce as enforce_rate_limit

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1", tags=["booking"])

# A dropped pin must be within this distance of a place EkiMove serves.
COVER_KM = 8.0
ROUTING_URL = "https://api.geoapify.com/v1/routing"
REVERSE_URL = "https://api.geoapify.com/v1/geocode/reverse"
NOMINATIM_REVERSE_URL = NOMINATIM_URL.replace("/search", "/reverse")


def _km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (lat1, lon1, lat2, lon2))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def _tidy(text: str) -> str:
    text = "".join(ch if ch.isprintable() else " " for ch in str(text))
    return re.sub(r"\s+", " ", text).strip()


class PointIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    label: str = Field(min_length=3, max_length=120)

    @field_validator("label", mode="before")
    @classmethod
    def clean_label(cls, value):
        return _tidy(value) if isinstance(value, str) else value


class Stop(BaseModel):
    """A pickup or destination: a listed place, or a dropped pin."""

    model_config = ConfigDict(extra="forbid")
    place_id: int | None = Field(default=None, gt=0)
    point: PointIn | None = None


def request_point(db: Session, request: RideRequest, end: str) -> dict:
    """Name and coordinates of a booking's pickup ("origin") or destination."""
    place_id = request.origin_place_id if end == "origin" else request.destination_place_id
    text = request.origin_text if end == "origin" else request.destination_text
    place = db.get(Place, place_id) if place_id else None
    if place is not None:
        return {"name": place.name, "latitude": place.latitude, "longitude": place.longitude}
    return {"name": text, "latitude": getattr(request, f"{end}_latitude"),
            "longitude": getattr(request, f"{end}_longitude")}


def _served_places(db: Session) -> list[tuple[Place, Zone]]:
    return db.execute(
        select(Place, Zone).join(Zone, Zone.id == Place.zone_id)
        .join(ServiceArea, ServiceArea.id == Place.service_area_id)
        .where(Place.status == "active", ServiceArea.status == "active", Zone.is_active.is_(True),
               Place.latitude.is_not(None), Place.longitude.is_not(None))
    ).all()


def resolve_stop(db: Session, stop: Stop, which: str) -> dict:
    """Check a stop and return {name, latitude, longitude, place, zone_id}."""
    if (stop.place_id is None) == (stop.point is None):
        raise HTTPException(status_code=422, detail=f"Choose a {which} place or drop a pin.")
    if stop.place_id is not None:
        place = db.get(Place, stop.place_id)
        area = db.get(ServiceArea, place.service_area_id) if place else None
        zone = db.get(Zone, place.zone_id) if place else None
        if place is None or place.status != "active" or not area or area.status != "active" or not zone \
                or not zone.is_active:
            raise HTTPException(status_code=422, detail=f"That {which} place isn't available.")
        if place.latitude is None or place.longitude is None:
            raise HTTPException(status_code=422, detail=f"{place.name} has no map pin yet, so a price can't be "
                                                        "worked out from a dropped pin. Choose a listed place for "
                                                        "both ends, or drop a pin for this one too.")
        return {"name": place.name, "latitude": place.latitude, "longitude": place.longitude, "place": place,
                "zone_id": place.zone_id}
    point = stop.point
    served = _served_places(db)
    nearest = min(served, key=lambda pz: _km(point.latitude, point.longitude, pz[0].latitude, pz[0].longitude),
                  default=None)
    if nearest is None or _km(point.latitude, point.longitude, nearest[0].latitude,
                              nearest[0].longitude) > COVER_KM:
        raise HTTPException(status_code=422, detail=f"That {which} pin is outside the area EkiMove serves for now.")
    return {"name": point.label, "latitude": point.latitude, "longitude": point.longitude, "place": None,
            "zone_id": nearest[1].id}


def road_meters(a: dict, b: dict, road_factor: float) -> tuple[int, str]:
    """Road distance between two stops (Google, else Geoapify routing), else
    an estimate. Measured for this booking only, never stored as a pin."""
    google = google_maps.route_matrix([(a["latitude"], a["longitude"])], [(b["latitude"], b["longitude"])])
    if google and google[0][0]:
        return int(google[0][0]["distance"]), "road"
    if settings.geoapify_api_key:
        try:
            response = requests.get(ROUTING_URL, timeout=8, params={
                "waypoints": f"{a['latitude']},{a['longitude']}|{b['latitude']},{b['longitude']}",
                "mode": "drive", "apiKey": settings.geoapify_api_key,
            })
            response.raise_for_status()
            meters = response.json()["features"][0]["properties"]["distance"]
            return int(meters), "road"
        except (requests.RequestException, ValueError, KeyError, IndexError, TypeError):
            logger.warning("Road distance lookup failed; using an estimate")
    straight = _km(a["latitude"], a["longitude"], b["latitude"], b["longitude"]) * 1000
    return int(straight * road_factor), "estimate"


def distance_quotes(db: Session, origin: dict, destination: dict, passenger_count: int) -> tuple[list[dict], int]:
    rules = formula(db)
    if not rules.get("allow_custom_points"):
        raise HTTPException(status_code=409, detail="Booking to places that aren't on the list is switched off. "
                                                    "Please choose places from the list.")
    if _km(origin["latitude"], origin["longitude"], destination["latitude"], destination["longitude"]) < 0.05:
        raise HTTPException(status_code=422, detail="Pickup and destination are the same spot.")
    meters, _source = road_meters(origin, destination, rules["road_factor"])
    booking = booking_rules(db)
    anchors = load_anchors(db, rules["road_factor"])
    options = []
    for vehicle in rules["vehicles"]:
        if not vehicle["enabled"] or passenger_count > max_passengers(booking, vehicle["vehicle_type"]):
            continue
        # Priced from the nearest hand-set route (junction to landmark) where
        # there is one, else the per-km formula.
        amount, basis = anchor_price(vehicle, rules, anchors.get(vehicle["vehicle_type"], []),
                                     (origin["latitude"], origin["longitude"]),
                                     (destination["latitude"], destination["longitude"]), meters)
        extra = Decimal(vehicle["extra_passenger"])
        if is_motorcycle(vehicle["vehicle_type"]):
            if passenger_count >= 2:
                amount += extra if extra > 0 else Decimal(booking["motorcycle_second_passenger_fee"])
        else:
            amount += extra * (passenger_count - 1)
        options.append({"vehicle_type": vehicle["vehicle_type"], "quoted_fare": str(amount.quantize(Decimal("0.01"))),
                        "currency": "NGN", "passenger_count": passenger_count, "pricing": "distance",
                        "priced_from": basis["kind"], "distance_km": round(meters / 1000, 1)})
    return options, meters


class PointQuoteIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    origin: Stop
    destination: Stop
    passenger_count: int = Field(default=1, ge=1, le=8)


@router.post("/point-fare-options")
def point_fare_options(payload: PointQuoteIn, request: Request, db: Session = Depends(get_db)) -> dict:
    """Prices when the pickup or destination is a dropped pin."""
    enforce_rate_limit("point-quote", f"ip:{client_ip(request)}", 120, 600,
                       "Too many price checks. Please wait a few minutes.")
    origin = resolve_stop(db, payload.origin, "pickup")
    destination = resolve_stop(db, payload.destination, "destination")
    options, meters = distance_quotes(db, origin, destination, payload.passenger_count)
    return {"options": options, "distance_km": round(meters / 1000, 1)}


@router.get("/points/settings")
def point_settings(db: Session = Depends(get_db)) -> dict:
    return {"enabled": bool(formula(db).get("allow_custom_points"))}


@router.get("/points/describe")
def describe_point(latitude: float, longitude: float, current_user: User = Depends(get_current_user)) -> dict:
    """A street or landmark name for a dropped pin, to start the description."""
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        raise HTTPException(status_code=422, detail="That spot isn't on the map.")
    enforce_rate_limit("point-describe", f"user:{current_user.id}", 30, 600,
                       "Too many lookups. Please type a short description instead.")
    if not settings.geocoding_enabled:
        return {"label": None}
    try:
        if settings.geoapify_api_key:
            response = requests.get(REVERSE_URL, timeout=6, params={
                "lat": latitude, "lon": longitude, "format": "json", "apiKey": settings.geoapify_api_key})
            response.raise_for_status()
            results = response.json().get("results") or []
            first = results[0] if results else {}
            parts = [first.get("name"), first.get("street"), first.get("suburb") or first.get("district")]
        else:
            response = requests.get(NOMINATIM_REVERSE_URL, timeout=6, headers={"User-Agent": USER_AGENT}, params={
                "lat": latitude, "lon": longitude, "format": "jsonv2", "zoom": 17})
            response.raise_for_status()
            address = response.json().get("address") or {}
            parts = [address.get("amenity") or address.get("building"), address.get("road"),
                     address.get("suburb") or address.get("neighbourhood") or address.get("quarter")]
    except (requests.RequestException, ValueError, AttributeError):
        return {"label": None}
    seen, words = set(), []
    for part in parts:
        if part and part not in seen:
            seen.add(part)
            words.append(_tidy(part))
    label = ", ".join(words)[:120]
    return {"label": label or None}
