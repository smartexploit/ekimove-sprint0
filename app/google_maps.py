"""Google Maps Platform: road distances (Routes API, Compute Route Matrix)
and address search (Places API (New), Autocomplete + Place Details).

Everything here is off until GOOGLE_MAPS_SERVER_KEY is set, and every call
falls back quietly (the caller then uses Geoapify or an estimate).

Google's terms (Service Specific Terms, Places and Routes sections):
- latitude/longitude from Places or Routes may be cached for at most 30
  days, so places found here are only used for the booking in hand, and
  Google-measured distances are re-measured when older than 30 days;
- results must not be shown on a non-Google map, so the app's maps switch
  to Google when GOOGLE_MAPS_BROWSER_KEY is set.
"""

from __future__ import annotations

import logging
import re

import requests
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.auth import get_current_user
from app.config import settings
from app.models import User
from app.rate_limit import enforce as enforce_rate_limit

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/places", tags=["address search"])

MATRIX_URL = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix"
AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete"
DETAILS_URL = "https://places.googleapis.com/v1/places/{place_id}"
# Compute Route Matrix allows 625 elements a request; 25 x 25 stays inside.
MATRIX_SIDE = 25
SEARCH_CENTER = (7.6233, 5.2214)  # Ado-Ekiti; 25 km also covers Iworoko
SEARCH_RADIUS_M = 25000.0
REFRESH_DAYS = 30
_SESSION = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


def enabled() -> bool:
    return bool(settings.google_maps_server_key)


def _headers(field_mask: str) -> dict:
    return {"X-Goog-Api-Key": settings.google_maps_server_key or "", "X-Goog-FieldMask": field_mask,
            "Content-Type": "application/json"}


def _waypoint(lat: float, lon: float) -> dict:
    return {"waypoint": {"location": {"latLng": {"latitude": lat, "longitude": lon}}}}


def route_matrix(origins: list[tuple[float, float]],
                 destinations: list[tuple[float, float]]) -> list[list[dict | None]] | None:
    """Driving distances, as rows of {"distance": m, "time": s} (None where
    there is no route), or None if Google isn't set up or didn't answer."""
    if not enabled() or not origins or not destinations:
        return None
    matrix: list[list[dict | None]] = [[None] * len(destinations) for _ in origins]
    try:
        for o0 in range(0, len(origins), MATRIX_SIDE):
            for d0 in range(0, len(destinations), MATRIX_SIDE):
                o_chunk = origins[o0:o0 + MATRIX_SIDE]
                d_chunk = destinations[d0:d0 + MATRIX_SIDE]
                response = requests.post(MATRIX_URL, timeout=30, headers=_headers(
                    "originIndex,destinationIndex,distanceMeters,duration,condition"), json={
                    "origins": [_waypoint(*p) for p in o_chunk],
                    "destinations": [_waypoint(*p) for p in d_chunk],
                    "travelMode": "DRIVE", "routingPreference": "TRAFFIC_UNAWARE",
                })
                response.raise_for_status()
                for cell in response.json():
                    if cell.get("condition") != "ROUTE_EXISTS" or cell.get("distanceMeters") is None:
                        continue
                    seconds = str(cell.get("duration") or "0s").rstrip("s")
                    matrix[o0 + int(cell.get("originIndex", 0))][d0 + int(cell.get("destinationIndex", 0))] = {
                        "distance": int(cell["distanceMeters"]),
                        "time": int(float(seconds or 0)) or None,
                    }
    except (requests.RequestException, ValueError, KeyError, TypeError, IndexError):
        logger.warning("Google route matrix failed")
        return None
    return matrix


# --------------------------------------------------------------------------
# Address search for spots that aren't on EkiMove's list
# --------------------------------------------------------------------------


def _session(token: str | None) -> str | None:
    return token if token and _SESSION.match(token) else None


@router.get("/settings")
def search_settings() -> dict:
    return {"enabled": enabled()}


@router.get("/search")
def search(q: str, session: str | None = None, current_user: User = Depends(get_current_user)) -> dict:
    """Address suggestions from Google, limited to around Ado-Ekiti."""
    text = " ".join(q.split())[:80]
    if not enabled() or len(text) < 3:
        return {"suggestions": []}
    enforce_rate_limit("google-search", f"user:{current_user.id}", 120, 600,
                       "Too many searches. Please wait a few minutes.")
    body = {
        "input": text, "includedRegionCodes": ["ng"], "languageCode": "en",
        "locationRestriction": {"circle": {"center": {"latitude": SEARCH_CENTER[0], "longitude": SEARCH_CENTER[1]},
                                           "radius": SEARCH_RADIUS_M}},
    }
    if _session(session):
        body["sessionToken"] = session
    try:
        response = requests.post(AUTOCOMPLETE_URL, timeout=6, json=body, headers=_headers(
            "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text,"
            "suggestions.placePrediction.structuredFormat"))
        response.raise_for_status()
        out = []
        for item in response.json().get("suggestions", []):
            p = item.get("placePrediction")
            if not p or not p.get("placeId"):
                continue
            fmt = p.get("structuredFormat") or {}
            out.append({
                "place_id": p["placeId"],
                "name": (fmt.get("mainText") or {}).get("text") or (p.get("text") or {}).get("text") or "",
                "detail": (fmt.get("secondaryText") or {}).get("text") or "",
            })
        return {"suggestions": out[:5]}
    except (requests.RequestException, ValueError, TypeError, AttributeError):
        logger.warning("Google address search failed")
        return {"suggestions": []}


class ResolveIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    place_id: str = Field(min_length=3, max_length=300, pattern=r"^[A-Za-z0-9_-]+$")
    session: str | None = Field(default=None, max_length=64)


@router.post("/resolve")
def resolve(payload: ResolveIn, current_user: User = Depends(get_current_user)) -> dict:
    """Where a suggested address is. Used only for the booking being made."""
    if not enabled():
        raise HTTPException(status_code=409, detail="Address search isn't available right now.")
    enforce_rate_limit("google-resolve", f"user:{current_user.id}", 60, 600,
                       "Too many lookups. Please wait a few minutes.")
    params = {"sessionToken": payload.session} if _session(payload.session) else {}
    try:
        response = requests.get(DETAILS_URL.format(place_id=payload.place_id), timeout=6, params=params,
                                headers=_headers("id,location,formattedAddress"))
        response.raise_for_status()
        data = response.json()
        location = data["location"]
        return {"latitude": float(location["latitude"]), "longitude": float(location["longitude"]),
                "address": data.get("formattedAddress") or ""}
    except (requests.RequestException, ValueError, KeyError, TypeError):
        logger.warning("Google place lookup failed")
        raise HTTPException(status_code=502, detail="Couldn’t find that address. Try again, or drop a pin "
                                                    "on the map.") from None
