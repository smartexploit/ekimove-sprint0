"""Find a map pin for a place from its name ("geocoding").

Uses Geoapify when GEOAPIFY_API_KEY is set, otherwise OpenStreetMap's free
Nominatim service (one request a second, fine for the occasional console
use). Results are only accepted inside the service area (within 25 km of
its centre), so "Okesa" never lands in another state. Local landmarks can
be missing from public maps, so every automatic pin is marked for checking.
"""

from __future__ import annotations

import logging
import math
import threading
import time

import requests

from app.config import settings

logger = logging.getLogger(__name__)

GEOAPIFY_URL = "https://api.geoapify.com/v1/geocode/search"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "EkiMove/1.0 (+https://ekimove.com.ng)"
MAX_DISTANCE_KM = 25
ADO_EKITI_CENTER = (7.6233, 5.2214)
_nominatim_lock = threading.Lock()
_nominatim_last = [0.0]


def _km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (lat1, lon1, lat2, lon2))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def _geoapify(text: str, center: tuple[float, float]) -> list[dict]:
    lat, lon = center
    response = requests.get(GEOAPIFY_URL, timeout=8, params={
        "text": text, "format": "json", "limit": 3, "apiKey": settings.geoapify_api_key,
        "filter": f"circle:{lon},{lat},{MAX_DISTANCE_KM * 1000}", "bias": f"proximity:{lon},{lat}",
    })
    response.raise_for_status()
    return [{"lat": float(r["lat"]), "lon": float(r["lon"]), "label": r.get("formatted") or text}
            for r in response.json().get("results", []) if "lat" in r and "lon" in r]


def _nominatim(text: str, center: tuple[float, float]) -> list[dict]:
    lat, lon = center
    d = MAX_DISTANCE_KM / 111
    with _nominatim_lock:  # their rule: at most one request a second
        wait = 1.05 - (time.monotonic() - _nominatim_last[0])
        if wait > 0:
            time.sleep(wait)
        try:
            response = requests.get(NOMINATIM_URL, timeout=8, headers={"User-Agent": USER_AGENT}, params={
                "q": text, "format": "jsonv2", "limit": 3, "countrycodes": "ng", "bounded": 1,
                "viewbox": f"{lon - d},{lat + d},{lon + d},{lat - d}",
            })
        finally:
            _nominatim_last[0] = time.monotonic()
    response.raise_for_status()
    return [{"lat": float(r["lat"]), "lon": float(r["lon"]), "label": r.get("display_name") or text}
            for r in response.json() if "lat" in r and "lon" in r]


def find_pin(name: str, center: tuple[float, float], address: str | None = None, aliases: str | None = None,
             city: str = "Ado-Ekiti, Ekiti State, Nigeria", max_queries: int = 4) -> dict | None:
    """Best pin for a place, or None. Tries the name with its address, then
    the name alone, then each other name, always near the area's centre."""
    queries = []
    if address:
        queries.append(f"{name}, {address}, {city}")
    queries.append(f"{name}, {city}")
    for alias in (aliases or "").replace("\n", ",").split(","):
        if alias.strip():
            queries.append(f"{alias.strip()}, {city}")
    search = _geoapify if settings.geoapify_api_key else _nominatim
    for query in queries[:max_queries]:
        try:
            results = search(query, center)
        except (requests.RequestException, ValueError, KeyError):
            logger.warning("Geocoding failed for a place")
            return None
        for result in results:
            if _km(center[0], center[1], result["lat"], result["lon"]) <= MAX_DISTANCE_KM:
                return {"latitude": round(result["lat"], 6), "longitude": round(result["lon"], 6),
                        "label": result["label"][:200], "query": query}
    return None
