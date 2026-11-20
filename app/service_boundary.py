"""Service area boundaries: the edge of where EkiMove serves, drawn on a map.

A dropped pin is accepted when it is inside an active area's boundary. Areas
without a boundary keep the older rule (within points.COVER_KM of one of the
area's places), so nothing breaks while boundaries are being drawn.
"""

from __future__ import annotations

import json
import math

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import require_super_admin
from app.database import get_db
from app.models import AuditLog, Place, ServiceArea, User

router = APIRouter(prefix="/api/v1/admin/service-areas", tags=["service areas"])

MAX_CORNERS = 300
MIN_AREA_KM2 = 0.05


def corners(area: ServiceArea) -> list[tuple[float, float]] | None:
    if not area.boundary:
        return None
    try:
        points = [(float(lat), float(lon)) for lat, lon in json.loads(area.boundary)]
    except (ValueError, TypeError):
        return None
    return points if len(points) >= 3 else None


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
        polygon = corners(area)
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


def _row(db: Session, area: ServiceArea) -> dict:
    polygon = corners(area)
    places = db.scalars(select(Place).where(Place.service_area_id == area.id, Place.status == "active")).all()
    pinned = [p for p in places if p.latitude is not None and p.longitude is not None]
    outside = [p.name for p in pinned if polygon and not contains(polygon, p.latitude, p.longitude)]
    return {
        "id": area.id, "name": area.name, "status": area.status,
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
    if payload.corners is None:
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
