"""Anchor fares: price trips from the real prices of known routes.

The admin sets real prices by hand for common routes between junctions and
landmarks ("anchors", the hand-set fares in the fare calculator). A trip that
starts and ends near an anchor's two ends is priced from that anchor:

    anchor price + (this trip's road distance - the anchor's) x price per km

so going 600 m past a landmark costs a little more and stopping 400 m short
costs a little less. Trips that are near anchors, but not that near, get the
formula price adjusted by how much more or less riders pay than the formula
on those nearby routes, fading out with distance. With no anchors around,
the plain formula applies. Hand-set fares themselves are never changed.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Place, PlaceDistance, PlaceFare

MAX_FACTOR, MIN_FACTOR = 2.0, 0.5


@dataclass(frozen=True)
class Anchor:
    origin_id: int
    destination_id: int
    origin: tuple[float, float]
    destination: tuple[float, float]
    meters: int
    amount: Decimal
    label: str
    reversed: bool = False


def meters_between(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * 6_371_000 * math.asin(math.sqrt(h))


def finish(vehicle: dict, raw: Decimal) -> Decimal:
    """At least the minimum, rounded to the vehicle's step."""
    raw = max(raw, Decimal(vehicle["minimum"]))
    step = Decimal(vehicle["round_to"]) or Decimal(1)
    return ((raw / step).quantize(Decimal(1), rounding=ROUND_HALF_UP) * step).quantize(Decimal("0.01"))


def formula_raw(vehicle: dict, meters: float) -> Decimal:
    return max(Decimal(vehicle["base"]) + Decimal(vehicle["per_km"]) * Decimal(meters) / Decimal(1000),
               Decimal(vehicle["minimum"]))


def load_anchors(db: Session, road_factor: float) -> dict[str, list[Anchor]]:
    """Hand-set fares between pinned places, by vehicle type. A route set in
    one direction also serves the other, unless that one is set too."""
    fares = db.scalars(select(PlaceFare).where(PlaceFare.pricing_source == "manual")).all()
    if not fares:
        return {}
    ids = {f.origin_place_id for f in fares} | {f.destination_place_id for f in fares}
    places = {p.id: p for p in db.scalars(select(Place).where(Place.id.in_(ids), Place.status == "active"))
              if p.latitude is not None and p.longitude is not None}
    stored = {(d.origin_place_id, d.destination_place_id): d for d in db.scalars(
        select(PlaceDistance).where(PlaceDistance.origin_place_id.in_(ids)))}
    out: dict[str, list[Anchor]] = {}
    keys = {(f.origin_place_id, f.destination_place_id, f.vehicle_type) for f in fares}
    for fare in fares:
        a, b = places.get(fare.origin_place_id), places.get(fare.destination_place_id)
        if a is None or b is None:
            continue
        amount = (Decimal(fare.base_amount) * Decimal(fare.vehicle_multiplier)).quantize(Decimal("0.01"))
        if amount <= 0:
            continue
        for x, y, rev in ((a, b, False), (b, a, True)):
            if rev and (y.id, x.id, fare.vehicle_type) in keys and (x.id, y.id, fare.vehicle_type) in keys:
                continue  # both directions are set by hand; each is its own anchor
            row = stored.get((x.id, y.id)) or stored.get((y.id, x.id))
            meters = row.meters if row is not None and row.source == "road" else int(
                meters_between((x.latitude, x.longitude), (y.latitude, y.longitude)) * road_factor)
            out.setdefault(fare.vehicle_type, []).append(Anchor(
                origin_id=x.id, destination_id=y.id, origin=(x.latitude, x.longitude),
                destination=(y.latitude, y.longitude), meters=max(meters, 1), amount=amount,
                label=f"{y.name} → {x.name}, the other way" if rev else f"{x.name} → {y.name}", reversed=rev))
    return out


def anchor_price(vehicle: dict, rules: dict, anchors: list[Anchor], origin: tuple[float, float],
                 destination: tuple[float, float], trip_meters: int,
                 skip: tuple[int, int] | None = None) -> tuple[Decimal, dict]:
    """(price, basis) for one vehicle. basis["kind"] is "anchor", "nearby"
    or "formula". ``skip`` leaves out the anchor for that place pair (used to
    show what a hand-set route would cost without its own price)."""
    near = float(rules.get("anchor_near_km", 1.0)) * 1000
    reach = max(float(rules.get("anchor_reach_km", 3.0)) * 1000, near + 1)
    plain = finish(vehicle, formula_raw(vehicle, trip_meters))
    if not rules.get("use_anchors", True) or not anchors:
        return plain, {"kind": "formula"}
    best, best_gap = None, None
    nearby: list[tuple[float, Anchor]] = []
    for anchor in anchors:
        if skip and (anchor.origin_id, anchor.destination_id) in (skip, (skip[1], skip[0])):
            continue
        d_from = meters_between(origin, anchor.origin)
        d_to = meters_between(destination, anchor.destination)
        far = max(d_from, d_to)
        if far <= near and (best_gap is None or d_from + d_to < best_gap):
            best, best_gap = anchor, d_from + d_to
        if far < reach:
            closeness = 1.0 if far <= near else (reach - far) / (reach - near)
            nearby.append((closeness, anchor))
    if best is not None:
        extra = trip_meters - best.meters
        raw = best.amount + Decimal(vehicle["per_km"]) * Decimal(extra) / Decimal(1000)
        return finish(vehicle, raw), {"kind": "anchor", "from": best.label, "anchor_price": str(best.amount),
                                      "extra_km": round(extra / 1000, 2)}
    if nearby:
        total = sum(c for c, _ in nearby)
        ratio = sum(c * float(a.amount / formula_raw(vehicle, a.meters)) for c, a in nearby) / total
        strength = max(c for c, _ in nearby)
        factor = min(MAX_FACTOR, max(MIN_FACTOR, 1 + strength * (ratio - 1)))
        if abs(factor - 1) >= 0.005:
            raw = formula_raw(vehicle, trip_meters) * Decimal(str(round(factor, 4)))
            names: list[str] = []
            for _, a in sorted(nearby, key=lambda x: -x[0]):
                name = a.label.removesuffix(", the other way")
                if name not in names:
                    names.append(name)
                if len(names) == 2:
                    break
            return finish(vehicle, raw), {"kind": "nearby", "factor": round(factor, 3), "from": names}
    return plain, {"kind": "formula"}


def basis_text(basis: dict) -> str:
    if basis.get("kind") == "anchor":
        km = basis["extra_km"]
        diff = f"{abs(km):.1f} km {'further' if km >= 0 else 'shorter'}"
        return f"From {basis['from']} (₦{Decimal(basis['anchor_price']):,.0f}), {diff}"
    if basis.get("kind") == "nearby":
        pct = round((basis["factor"] - 1) * 100)
        return f"Formula {'+' if pct >= 0 else ''}{pct}%, like nearby {', '.join(basis['from'])}"
    return "Formula"
