"""Fuel-linked fares.

Every okada and car price (listed routes, hand-set prices and pinned spots)
is set at the *reference* fuel price. When the admin enters a different
*current* fuel price, the fuel share of each fare moves with it:

    factor = 1 + fuel_share x (current / reference - 1)

e.g. a car fare that is 60% fuel, with petrol up from N1,400 to N1,540
(+10%), costs 6% more. The result is rounded to the vehicle's step. Prices
stored in the database never change, so going back to the reference price
gives the original fares, and nothing needs re-saving.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal


def _vehicle(rules: dict, vehicle_type: str) -> dict | None:
    for vehicle in rules.get("vehicles", []):
        if vehicle["vehicle_type"] == vehicle_type:
            return vehicle
    if vehicle_type in ("motorcycle", "okada", "bike"):
        return next((v for v in rules.get("vehicles", []) if v["vehicle_type"] in ("motorcycle", "okada", "bike")),
                    None)
    return None


def factor(rules: dict, vehicle_type: str) -> Decimal:
    fuel = rules.get("fuel") or {}
    vehicle = _vehicle(rules, vehicle_type)
    if not fuel.get("enabled") or vehicle is None:
        return Decimal(1)
    reference = Decimal(fuel.get("reference_price") or 0)
    current = Decimal(fuel.get("current_price") or 0)
    if reference <= 0 or current <= 0 or current == reference:
        return Decimal(1)
    share = Decimal(vehicle.get("fuel_share") or 0) / 100
    return max(Decimal("0.2"), 1 + share * (current / reference - 1))


def adjust(rules: dict, vehicle_type: str, amount: Decimal) -> Decimal:
    """``amount`` at today's fuel price, rounded to the vehicle's step."""
    f = factor(rules, vehicle_type)
    amount = Decimal(amount)
    if f == 1 or amount <= 0:
        return amount.quantize(Decimal("0.01"))
    vehicle = _vehicle(rules, vehicle_type) or {}
    step = Decimal(vehicle.get("round_to") or 50)
    raw = amount * f
    return ((raw / step).quantize(Decimal(1), rounding=ROUND_HALF_UP) * step).quantize(Decimal("0.01"))


def current_rules(db) -> dict:
    from app.fare_calculator import formula  # late import: fare_calculator imports pricing helpers

    return formula(db)
