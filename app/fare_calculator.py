"""Fare calculator: prices every place-to-place route from its road distance.

The super-admin sets a simple formula per vehicle (starting fare + price per
km, a minimum, rounding), EkiMove measures the road distance between every
pair of places (Geoapify route matrix, or a straight-line estimate when no
map key is set), and the admin previews every price before applying it.
Applying writes ordinary route fares (place_fares) marked "auto". Fares set
by hand ("manual") are never changed unless the admin ticks them.
"""

from __future__ import annotations

import json
import logging
import math
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import requests
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import google_maps
from app.anchor_fares import anchor_price, basis_text, finish, formula_raw, load_anchors
from app.auth import require_super_admin
from app.config import settings
from app.database import get_db
from app.models import AppSetting, AuditLog, Place, PlaceDistance, PlaceFare, ServiceArea, User, Zone

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/admin/fare-calculator", tags=["fare calculator"])

FORMULA_KEY = "fare_formula"
MATRIX_URL = "https://api.geoapify.com/v1/routematrix"
MATRIX_CELLS = 1000
# Roads bend: straight-line distance times this is a fair road estimate.
DEFAULT_ROAD_FACTOR = 1.35
DEFAULT_FORMULA = {
    "road_factor": DEFAULT_ROAD_FACTOR,
    "allow_custom_points": False,
    "vehicles": [
        {"vehicle_type": "motorcycle", "label": "Okada", "enabled": True, "base": 300, "per_km": 100,
         "minimum": 400, "round_to": 50, "extra_passenger": 0},
        {"vehicle_type": "car", "label": "Car", "enabled": True, "base": 600, "per_km": 200,
         "minimum": 800, "round_to": 50, "extra_passenger": 0},
    ],
}


class VehicleFormula(BaseModel):
    model_config = ConfigDict(extra="forbid")
    vehicle_type: str = Field(min_length=2, max_length=32, pattern=r"^[a-z_]+$")
    label: str = Field(min_length=2, max_length=40)
    enabled: bool = True
    base: int = Field(ge=0, le=100_000)
    per_km: int = Field(ge=0, le=50_000)
    minimum: int = Field(ge=0, le=500_000)
    round_to: int = Field(ge=1, le=1_000)
    extra_passenger: int = Field(default=0, ge=0, le=100_000)


class Formula(BaseModel):
    model_config = ConfigDict(extra="forbid")
    road_factor: float = Field(default=DEFAULT_ROAD_FACTOR, ge=1.0, le=2.5)
    # Riders may drop a pin for a place that isn't on the list; it is priced
    # with this formula from the road distance.
    allow_custom_points: bool = False
    # Anchor fares: hand-set prices on known routes price the trips around
    # them (app/anchor_fares.py). A trip whose ends are within anchor_near_km
    # of an anchor's ends is priced from it; the effect fades out by
    # anchor_reach_km.
    use_anchors: bool = True
    anchor_near_km: float = Field(default=1.0, ge=0.2, le=3.0)
    anchor_reach_km: float = Field(default=3.0, ge=0.5, le=10.0)
    vehicles: list[VehicleFormula] = Field(min_length=1, max_length=8)

    @model_validator(mode="after")
    def reach_beyond_near(self):
        if self.anchor_reach_km <= self.anchor_near_km:
            raise ValueError("The fade-out distance must be more than the \"near\" distance.")
        return self

    @field_validator("vehicles")
    @classmethod
    def unique_vehicles(cls, vehicles: list[VehicleFormula]) -> list[VehicleFormula]:
        types = [v.vehicle_type for v in vehicles]
        if len(types) != len(set(types)):
            raise ValueError("Each vehicle type can only appear once.")
        return vehicles


def formula(db: Session) -> dict:
    row = db.get(AppSetting, FORMULA_KEY)
    if row is not None:
        try:
            return Formula.model_validate(json.loads(row.value)).model_dump()
        except ValueError:
            logger.warning("Saved fare formula is unreadable; using the default")
    return Formula.model_validate(DEFAULT_FORMULA).model_dump()


def price(vehicle: dict, meters: int) -> Decimal:
    """Starting fare + per-km price, at least the minimum, rounded to the step."""
    return finish(vehicle, formula_raw(vehicle, meters))


def route_price(vehicle: dict, rules: dict, anchors: dict, a: Place, b: Place, meters: int,
                skip_self: bool = False) -> tuple[Decimal, dict]:
    """Price for a place-to-place route: from nearby hand-set routes where
    there are any, else the formula."""
    return anchor_price(vehicle, rules, anchors.get(vehicle["vehicle_type"], []), (a.latitude, a.longitude),
                        (b.latitude, b.longitude), meters, skip=(a.id, b.id) if skip_self else None)


def straight_line_meters(a: Place, b: Place) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (a.latitude, a.longitude, b.latitude, b.longitude))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * 6_371_000 * math.asin(math.sqrt(h))


def _pins(a: Place, b: Place) -> str:
    return f"{a.latitude:.5f},{a.longitude:.5f};{b.latitude:.5f},{b.longitude:.5f}"


def _has_pin(place: Place) -> bool:
    return place.latitude is not None and place.longitude is not None


def _hidden_places(db: Session, area_id: int) -> list[dict]:
    """Places in the area the calculator leaves out, and why."""
    out = []
    for place, zone in db.execute(select(Place, Zone).outerjoin(Zone, Zone.id == Place.zone_id)
                                  .where(Place.service_area_id == area_id).order_by(Place.name)).all():
        if place.status != "active":
            out.append({"id": place.id, "name": place.name, "reason": "switched off"})
        elif zone is None or not zone.is_active:
            out.append({"id": place.id, "name": place.name, "reason": "its zone is switched off"})
    return out


def _area_places(db: Session, area_id: int) -> tuple[ServiceArea, list[Place]]:
    area = db.get(ServiceArea, area_id)
    if area is None:
        raise HTTPException(status_code=404, detail="Service area not found.")
    places = db.scalars(
        select(Place).join(Zone, Zone.id == Place.zone_id)
        .where(Place.service_area_id == area.id, Place.status == "active", Zone.is_active.is_(True))
        .order_by(Place.name)
    ).all()
    return area, list(places)


def _stored_distances(db: Session, places: list[Place]) -> dict[tuple[int, int], PlaceDistance]:
    ids = [p.id for p in places]
    if not ids:
        return {}
    rows = db.scalars(select(PlaceDistance).where(PlaceDistance.origin_place_id.in_(ids),
                                                  PlaceDistance.destination_place_id.in_(ids))).all()
    return {(r.origin_place_id, r.destination_place_id): r for r in rows}


def distance_provider() -> str | None:
    """Which map service measures road distances now."""
    if google_maps.enabled():
        return "google"
    return "geoapify" if settings.geoapify_api_key else None


def needs_remeasure(row: PlaceDistance, pins: str, refresh: bool = False) -> bool:
    """A stored distance is measured again when asked, when a pin moved, when
    it was only an estimate, when the map service changed, or (Google's
    rule) when a Google distance is older than 30 days."""
    if refresh or row.pins != pins or row.source == "estimate":
        return True
    provider = distance_provider()
    if provider and row.provider != provider:
        return True
    if row.provider == "google" and row.computed_at is not None:
        computed = row.computed_at if row.computed_at.tzinfo else row.computed_at.replace(tzinfo=timezone.utc)
        return datetime.now(timezone.utc) - computed > timedelta(days=google_maps.REFRESH_DAYS)
    return False


def store_distance(row: PlaceDistance, cell: dict | None, a: Place, b: Place, road_factor: float) -> str:
    """Write one measured (or estimated) distance; returns its source."""
    if cell:
        row.meters, row.seconds, row.source = int(cell["distance"]), int(cell.get("time") or 0) or None, "road"
        row.provider = cell.get("provider")
    else:
        row.meters, row.seconds, row.source = int(straight_line_meters(a, b) * road_factor), None, "estimate"
        row.provider = None
    row.pins = _pins(a, b)
    row.computed_at = datetime.now(timezone.utc)
    return row.source


def _road_matrix(sources: list[Place], targets: list[Place]) -> list[list[dict | None]] | None:
    """Road distances: Google when set up, else Geoapify (chunks of at most
    1,000 cells). Each cell says which service measured it."""
    if not sources or not targets:
        return None
    google = google_maps.route_matrix([(p.latitude, p.longitude) for p in sources],
                                      [(p.latitude, p.longitude) for p in targets])
    if google is not None:
        return [[dict(cell, provider="google") if cell else None for cell in row] for row in google]
    if not settings.geoapify_api_key:
        return None
    rows_per_call = max(1, MATRIX_CELLS // max(1, len(targets)))
    matrix: list[list[dict | None]] = []
    try:
        for start in range(0, len(sources), rows_per_call):
            chunk = sources[start:start + rows_per_call]
            response = requests.post(
                MATRIX_URL, params={"apiKey": settings.geoapify_api_key}, timeout=30,
                json={"mode": "drive",
                      "sources": [{"location": [p.longitude, p.latitude]} for p in chunk],
                      "targets": [{"location": [p.longitude, p.latitude]} for p in targets]},
            )
            response.raise_for_status()
            for row in response.json().get("sources_to_targets", []):
                matrix.append([dict(cell, provider="geoapify") if cell and cell.get("distance") is not None
                               else None for cell in row])
        if len(matrix) != len(sources):
            raise ValueError("incomplete route matrix")
    except (requests.RequestException, ValueError):
        logger.warning("Geoapify route matrix failed; using straight-line estimates")
        return None
    return matrix


def measure(db: Session, places: list[Place], refresh: bool = False) -> dict:
    """Store road distances for every pair of pinned places that needs one."""
    pinned = [p for p in places if _has_pin(p)]
    stored = _stored_distances(db, pinned)
    rules = formula(db)

    def needs(a: Place, b: Place) -> bool:
        row = stored.get((a.id, b.id))
        return row is None or needs_remeasure(row, _pins(a, b), refresh)

    sources = [a for a in pinned if any(a.id != b.id and needs(a, b) for b in pinned)]
    matrix = _road_matrix(sources, pinned) if sources else None
    counts = {"road": 0, "estimate": 0, "unchanged": 0}
    for i, a in enumerate(sources):
        for j, b in enumerate(pinned):
            if a.id == b.id:
                continue
            if not needs(a, b):
                counts["unchanged"] += 1
                continue
            cell = matrix[i][j] if matrix else None
            row = stored.get((a.id, b.id))
            if row is None:
                row = PlaceDistance(origin_place_id=a.id, destination_place_id=b.id)
                db.add(row)
            counts[store_distance(row, cell, a, b, rules["road_factor"])] += 1
    counts["unchanged"] += sum(1 for a in pinned if a not in sources for b in pinned if a.id != b.id)
    return counts


def _distance(stored: dict, a: Place, b: Place, road_factor: float) -> tuple[int, str]:
    row = stored.get((a.id, b.id))
    if row is not None and row.pins == _pins(a, b):
        return row.meters, row.source
    return int(straight_line_meters(a, b) * road_factor), "estimate"


def preview(db: Session, area_id: int) -> dict:
    area, places = _area_places(db, area_id)
    rules = formula(db)
    vehicles = [v for v in rules["vehicles"] if v["enabled"]]
    pinned = [p for p in places if _has_pin(p)]
    stored = _stored_distances(db, pinned)
    ids = [p.id for p in pinned]
    fares = {}
    if ids:
        for fare in db.scalars(select(PlaceFare).where(PlaceFare.origin_place_id.in_(ids),
                                                       PlaceFare.destination_place_id.in_(ids))):
            fares[(fare.origin_place_id, fare.destination_place_id, fare.vehicle_type)] = fare
    anchors = load_anchors(db, rules["road_factor"])
    routes = []
    summary = {"new": 0, "change": 0, "same": 0, "manual": 0}
    for a in pinned:
        for b in pinned:
            if a.id == b.id:
                continue
            meters, source = _distance(stored, a, b, rules["road_factor"])
            prices = {}
            for v in vehicles:
                fare = fares.get((a.id, b.id, v["vehicle_type"]))
                is_manual = fare is not None and fare.pricing_source == "manual"
                calculated, basis = route_price(v, rules, anchors, a, b, meters, skip_self=is_manual)
                if fare is None:
                    action = "new"
                elif fare.pricing_source == "manual":
                    action = "manual"
                elif (Decimal(fare.base_amount) * Decimal(fare.vehicle_multiplier) == calculated
                      and Decimal(fare.extra_passenger_amount) == Decimal(v["extra_passenger"])):
                    action = "same"
                else:
                    action = "change"
                summary[action] += 1
                prices[v["vehicle_type"]] = {
                    "calculated": str(calculated), "action": action,
                    "current": str((Decimal(fare.base_amount) * Decimal(fare.vehicle_multiplier))
                                   .quantize(Decimal("0.01"))) if fare else None,
                    "current_active": fare.is_active if fare else None,
                    "basis": basis_text(basis), "basis_kind": basis["kind"],
                }
            routes.append({"origin": {"id": a.id, "name": a.name}, "destination": {"id": b.id, "name": b.name},
                           "km": round(meters / 1000, 2), "distance_source": source, "prices": prices})
    measured = sum(1 for r in routes if r["distance_source"] == "road")
    return {
        "area": {"id": area.id, "name": area.name},
        "formula": rules,
        "places": len(places),
        "missing_pins": [{"id": p.id, "name": p.name} for p in places if not _has_pin(p)],
        "hidden_places": _hidden_places(db, area_id),
        "auto_pins": [{"id": p.id, "name": p.name, "label": p.pin_label} for p in places
                      if _has_pin(p) and p.pin_source == "auto"],
        "road_distances": measured, "estimated_distances": len(routes) - measured,
        "map_service": bool(distance_provider()),
        "summary": summary, "routes": routes,
        "anchors": sum(len(v) for v in anchors.values()),
    }


@router.get("")
def get_calculator(service_area_id: int, db: Session = Depends(get_db),
                   _admin: User = Depends(require_super_admin)) -> dict:
    return preview(db, service_area_id)


@router.put("/formula")
def save_formula(payload: Formula, db: Session = Depends(get_db),
                 admin: User = Depends(require_super_admin)) -> dict:
    value = json.dumps(payload.model_dump())
    row = db.get(AppSetting, FORMULA_KEY)
    if row is None:
        db.add(AppSetting(key=FORMULA_KEY, value=value, updated_by_user_id=admin.id))
    else:
        row.value, row.updated_by_user_id = value, admin.id
    db.add(AuditLog(actor_user_id=admin.id, action="fares.formula_saved", entity_type="fare_formula",
                    entity_id="formula", details=value[:2000]))
    db.commit()
    return formula(db)


class MeasureIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    service_area_id: int = Field(gt=0)
    refresh: bool = False


@router.post("/distances")
def measure_distances(payload: MeasureIn, db: Session = Depends(get_db),
                      _admin: User = Depends(require_super_admin)) -> dict:
    _area, places = _area_places(db, payload.service_area_id)
    counts = measure(db, places, payload.refresh)
    db.commit()
    return {"counts": counts, "map_service": bool(distance_provider())}


class RouteKey(BaseModel):
    model_config = ConfigDict(extra="forbid")
    origin_place_id: int = Field(gt=0)
    destination_place_id: int = Field(gt=0)
    vehicle_type: str = Field(min_length=2, max_length=32)


class RouteEdit(RouteKey):
    amount: int = Field(ge=0, le=1_000_000)


class ApplyIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    service_area_id: int = Field(gt=0)
    # Prices changed by hand in the preview; saved as hand-set fares.
    edits: list[RouteEdit] = Field(default_factory=list, max_length=5000)
    # Hand-set fares the admin chose to replace with the calculated price.
    replace_manual: list[RouteKey] = Field(default_factory=list, max_length=5000)


@router.post("/apply")
def apply_fares(payload: ApplyIn, db: Session = Depends(get_db),
                admin: User = Depends(require_super_admin)) -> dict:
    area_active = db.get(ServiceArea, payload.service_area_id).status == "active"
    rules = {v["vehicle_type"]: v for v in formula(db)["vehicles"] if v["enabled"]}
    edits = {(e.origin_place_id, e.destination_place_id, e.vehicle_type): e.amount for e in payload.edits}
    replace = {(r.origin_place_id, r.destination_place_id, r.vehicle_type) for r in payload.replace_manual}
    done = {"created": 0, "updated": 0, "kept": 0, "unchanged": 0}

    def existing_fares(ids: set[int]) -> dict:
        found = {}
        if ids:
            for fare in db.scalars(select(PlaceFare).where(PlaceFare.origin_place_id.in_(ids),
                                                           PlaceFare.destination_place_id.in_(ids))):
                found[(fare.origin_place_id, fare.destination_place_id, fare.vehicle_type)] = fare
        return found

    def write(key: tuple, fare: PlaceFare | None, amount: Decimal, source: str) -> None:
        if fare is None:
            fare = PlaceFare(origin_place_id=key[0], destination_place_id=key[1], vehicle_type=key[2])
            db.add(fare)
            done["created"] += 1
        else:
            done["updated"] += 1
        fare.base_amount = amount
        fare.vehicle_multiplier = Decimal("1.000")
        fare.extra_passenger_amount = Decimal(rules[key[2]]["extra_passenger"])
        # Fares go live with the area; in a draft area they wait, switched off.
        fare.is_active = area_active
        fare.pricing_source = source

    # Prices typed by hand are saved first, so they already count as anchors
    # when the other routes are priced below.
    _area, area_places = _area_places(db, payload.service_area_id)
    area_ids = {p.id for p in area_places}
    existing = existing_fares(area_ids)
    for key, amount in edits.items():
        if key[0] in area_ids and key[1] in area_ids and key[2] in rules:
            write(key, existing.get(key), Decimal(amount), "manual")
    db.flush()
    data = preview(db, payload.service_area_id)
    existing = existing_fares({r["origin"]["id"] for r in data["routes"]})
    for route in data["routes"]:
        for vehicle_type, info in route["prices"].items():
            key = (route["origin"]["id"], route["destination"]["id"], vehicle_type)
            fare = existing.get(key)
            if key in edits:
                continue
            elif fare is not None and fare.pricing_source == "manual" and key not in replace:
                done["kept"] += 1
                continue
            elif info["action"] == "same":
                done["unchanged"] += 1
                continue
            else:
                write(key, fare, Decimal(info["calculated"]), "auto")
    db.add(AuditLog(actor_user_id=admin.id, action="fares.calculator_applied", entity_type="service_area",
                    entity_id=str(payload.service_area_id),
                    details=f"Fare calculator applied: {done['created']} new, {done['updated']} updated, "
                            f"{done['kept']} hand-set kept."))
    db.commit()
    return {"result": done, **preview(db, payload.service_area_id)}


class Sample(RouteKey):
    amount: int = Field(gt=0, le=1_000_000)


class SuggestIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    samples: list[Sample] = Field(min_length=1, max_length=40)


@router.post("/suggest")
def suggest_formula(payload: SuggestIn, db: Session = Depends(get_db),
                    _admin: User = Depends(require_super_admin)) -> dict:
    """Starting fare and per-km price that best match prices people pay today."""
    rules = formula(db)
    places = {p.id: p for p in db.scalars(select(Place).where(Place.id.in_(
        {s.origin_place_id for s in payload.samples} | {s.destination_place_id for s in payload.samples})))}
    by_vehicle: dict[str, list[tuple[float, int, Sample]]] = {}
    for sample in payload.samples:
        a, b = places.get(sample.origin_place_id), places.get(sample.destination_place_id)
        if a is None or b is None or a.id == b.id:
            raise HTTPException(status_code=422, detail="Choose two different places for each example.")
        if not (_has_pin(a) and _has_pin(b)):
            raise HTTPException(status_code=422, detail=f"Add map pins for {a.name} and {b.name} first.")
        meters, _source = _distance(_stored_distances(db, [a, b]), a, b, rules["road_factor"])
        by_vehicle.setdefault(sample.vehicle_type, []).append((meters / 1000, sample.amount, sample))
    suggestions = []
    for vehicle_type, points in by_vehicle.items():
        n = len(points)
        mean_km = sum(km for km, _, _ in points) / n
        mean_amount = sum(amount for _, amount, _ in points) / n
        spread = sum((km - mean_km) ** 2 for km, _, _ in points)
        if n >= 2 and spread > 0.01:
            per_km = sum((km - mean_km) * (amount - mean_amount) for km, amount, _ in points) / spread
            per_km = max(0.0, per_km)
            base = max(0.0, mean_amount - per_km * mean_km)
        else:
            # One example (or all the same length): keep today's per-km price.
            current = next((v for v in rules["vehicles"] if v["vehicle_type"] == vehicle_type), None)
            per_km = float(current["per_km"]) if current else 100.0
            base = max(0.0, mean_amount - per_km * mean_km)
        base_r, per_km_r = int(round(base / 10) * 10), int(round(per_km / 10) * 10)
        suggestions.append({
            "vehicle_type": vehicle_type, "base": base_r, "per_km": per_km_r,
            "minimum": int(round(min(amount for _, amount, _ in points) / 50) * 50),
            "examples": [{"origin_place_id": s.origin_place_id, "destination_place_id": s.destination_place_id,
                          "km": round(km, 2), "today": amount,
                          "with_formula": round(base_r + per_km_r * km)} for km, amount, s in points],
        })
    return {"suggestions": suggestions}
