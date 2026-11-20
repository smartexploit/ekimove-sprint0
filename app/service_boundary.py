"""Service area boundaries: the edge of where EkiMove serves.

Two ways to set it:
- automatic: everything within N km of the area's pinned places (a rounded
  shape around them, worked out fresh each time, so new places are included);
- drawn: corners an admin taps on a map.
A dropped pin is accepted when it is inside an active area's boundary. Areas
with neither keep the older rule (within points.COVER_KM of one of the area's
places), so nothing breaks before a boundary is set.
"""

from __future__ import annotations

import json
import math

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import require_super_admin
from app.database import get_db
from app.models import AuditLog, Place, ServiceArea, User

router = APIRouter(prefix="/api/v1/admin/service-areas", tags=["service areas"])

MAX_CORNERS = 300
MIN_AREA_KM2 = 0.05
AUTO_KM_CHOICES = (1.0, 2.0, 3.0, 5.0)
CIRCLE_POINTS = 24


def _setting(area: ServiceArea):
    if not area.boundary:
        return None
    try:
        return json.loads(area.boundary)
    except ValueError:
        return None


def mode(area: ServiceArea) -> tuple[str | None, float | None]:
    value = _setting(area)
    if isinstance(value, dict) and value.get("auto_km"):
        return "auto", float(value["auto_km"])
    if isinstance(value, list):
        return "drawn", None
    return None, None


def _pinned(db: Session, area_id: int) -> list[Place]:
    return [p for p in db.scalars(select(Place).where(Place.service_area_id == area_id, Place.status == "active"))
            if p.latitude is not None and p.longitude is not None]


def auto_shape(places: list[Place], km: float) -> list[tuple[float, float]] | None:
    """A rounded shape covering every place plus ``km`` around it: the convex
    hull of a circle around each place."""
    if not places:
        return None
    pts = []
    for p in places:
        dlat = km / 110.57
        dlon = km / (111.32 * math.cos(math.radians(p.latitude)))
        for k in range(CIRCLE_POINTS):
            a = 2 * math.pi * k / CIRCLE_POINTS
            pts.append((p.latitude + dlat * math.sin(a), p.longitude + dlon * math.cos(a)))
    hull = _hull(pts)
    return [(round(lat, 6), round(lon, 6)) for lat, lon in hull] if len(hull) >= 3 else None


def _hull(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    pts = sorted(set(points), key=lambda p: (p[1], p[0]))
    if len(pts) <= 2:
        return pts

    def cross(o, a, b):
        return (a[1] - o[1]) * (b[0] - o[0]) - (a[0] - o[0]) * (b[1] - o[1])

    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def corners(area: ServiceArea, db: Session | None = None) -> list[tuple[float, float]] | None:
    value = _setting(area)
    if isinstance(value, dict) and value.get("auto_km") and db is not None:
        return auto_shape(_pinned(db, area.id), float(value["auto_km"]))
    if isinstance(value, list):
        try:
            points = [(float(lat), float(lon)) for lat, lon in value]
        except (ValueError, TypeError):
            return None
        return points if len(points) >= 3 else None
    return None


def contains(polygon: list[tuple[float, float]], lat: float, lon: float) -> bool:
    """Ray casting: is (lat, lon) inside the polygon? Points on the edge count."""
    inside = False
    n = len(polygon)
    for i in range(n):
        y1, x1 = polygon[i]
        y2, x2 = polygon[(i + 1) % n]
        if _on_segment(lat, lon, y1, x1, y2, x2):
            return True
        if (y1 > lat) != (y2 > lat):
            x_cross = x1 + (lat - y1) * (x2 - x1) / (y2 - y1)
            if lon < x_cross:
                inside = not inside
    return inside


def _on_segment(py, px, y1, x1, y2, x2, eps=1e-9) -> bool:
    cross = (px - x1) * (y2 - y1) - (py - y1) * (x2 - x1)
    if abs(cross) > eps:
        return False
    return min(x1, x2) - eps <= px <= max(x1, x2) + eps and min(y1, y2) - eps <= py <= max(y1, y2) + eps


def _area_km2(polygon: list[tuple[float, float]]) -> float:
    lat0 = sum(p[0] for p in polygon) / len(polygon)
    kx, ky = 111.32 * math.cos(math.radians(lat0)), 110.57
    pts = [(lon * kx, lat * ky) for lat, lon in polygon]
    return abs(sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1]
                   for i in range(len(pts)))) / 2


def _segments_cross(a, b, c, d) -> bool:
    def orient(p, q, r):
        v = (q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1])
        return 0 if abs(v) < 1e-12 else (1 if v > 0 else 2)
    return orient(a, b, c) != orient(a, b, d) and orient(c, d, a) != orient(c, d, b) \
        and 0 not in (orient(a, b, c), orient(a, b, d), orient(c, d, a), orient(c, d, b))


def check(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Tidy and validate a drawn boundary, or raise 422 with a plain reason."""
    tidy: list[tuple[float, float]] = []
    for lat, lon in points:
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            raise HTTPException(status_code=422, detail="A corner is off the map.")
        p = (round(lat, 6), round(lon, 6))
        if not tidy or tidy[-1] != p:
            tidy.append(p)
    if len(tidy) > 1 and tidy[0] == tidy[-1]:
        tidy.pop()
    if len(tidy) < 3:
        raise HTTPException(status_code=422, detail="Draw at least 3 corners.")
    if len(tidy) > MAX_CORNERS:
        raise HTTPException(status_code=422, detail=f"Use {MAX_CORNERS} corners or fewer.")
    n = len(tidy)
    for i in range(n):
        for j in range(i + 1, n):
            if j in (i, (i + 1) % n) or i == (j + 1) % n:
                continue
            if _segments_cross(tidy[i], tidy[(i + 1) % n], tidy[j], tidy[(j + 1) % n]):
                raise HTTPException(status_code=422, detail="The edges cross each other. Move a corner so the "
                                                            "shape doesn't fold over itself.")
    if _area_km2(tidy) < MIN_AREA_KM2:
        raise HTTPException(status_code=422, detail="That shape is too small to be a service area.")
    return tidy


def area_for_point(db: Session, lat: float, lon: float) -> tuple[ServiceArea | None, set[int]]:
    """(the active area whose boundary holds the point, ids of areas that have a boundary)."""
    drawn: set[int] = set()
    found = None
    for area in db.scalars(select(ServiceArea).where(ServiceArea.status == "active").order_by(ServiceArea.id)):
        polygon = corners(area, db)
        if polygon is None:
            continue
        drawn.add(area.id)
        if found is None and contains(polygon, lat, lon):
            found = area
    return found, drawn


# ---------- admin ----------

class BoundaryIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    corners: list[tuple[float, float]] | None = Field(default=None, max_length=MAX_CORNERS + 1)
    # Automatic: everything within this many km of the area's places.
    auto_km: float | None = Field(default=None, ge=0.5, le=10)


def _row(db: Session, area: ServiceArea) -> dict:
    polygon = corners(area, db)
    pinned = _pinned(db, area.id)
    outside = [p.name for p in pinned if polygon and not contains(polygon, p.latitude, p.longitude)]
    kind, auto_km = mode(area)
    unpinned = db.scalar(select(func.count(Place.id)).where(
        Place.service_area_id == area.id, Place.status == "active", Place.latitude.is_(None)))
    return {
        "id": area.id, "name": area.name, "status": area.status,
        "mode": kind, "auto_km": auto_km, "auto_choices": list(AUTO_KM_CHOICES),
        "previews": {str(km): [list(c) for c in (auto_shape(pinned, km) or [])] for km in AUTO_KM_CHOICES},
        "unpinned_places": unpinned,
        "corners": [list(c) for c in polygon] if polygon else None,
        "area_km2": round(_area_km2(polygon), 1) if polygon else None,
        "places": [{"id": p.id, "name": p.name, "latitude": p.latitude, "longitude": p.longitude} for p in pinned],
        "places_outside": outside,
    }


@router.get("")
def list_areas(db: Session = Depends(get_db), _admin: User = Depends(require_super_admin)) -> list[dict]:
    from app.points import COVER_KM

    rows = [_row(db, a) for a in db.scalars(select(ServiceArea).order_by(ServiceArea.name))]
    for row in rows:
        row["fallback_km"] = COVER_KM
    return rows


@router.put("/{area_id}/boundary")
def save_boundary(area_id: int, payload: BoundaryIn, db: Session = Depends(get_db),
                  admin: User = Depends(require_super_admin)) -> dict:
    area = db.get(ServiceArea, area_id)
    if area is None:
        raise HTTPException(status_code=404, detail="Service area not found")
    if payload.auto_km is not None:
        if not _pinned(db, area.id):
            raise HTTPException(status_code=422, detail="None of this area's places has a map pin yet. Pin your "
                                                        "places first (Pin check), then try again.")
        area.boundary = json.dumps({"auto_km": payload.auto_km})
        details = f"automatic, {payload.auto_km:g} km around the places"
    elif payload.corners is None:
        area.boundary = None
        details = "boundary removed"
    else:
        tidy = check(payload.corners)
        area.boundary = json.dumps([list(c) for c in tidy])
        details = f"{len(tidy)} corners, {_area_km2(tidy):.1f} km²"
    db.add(AuditLog(actor_user_id=admin.id, action="service_area.boundary", entity_type="service_area",
                    entity_id=str(area.id), details=details))
    db.commit()
    return _row(db, area)
