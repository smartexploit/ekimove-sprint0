"""Read-only validation of EkiMove pilot fares. Never writes to the database."""

from decimal import Decimal
from itertools import permutations

from app.database import SessionLocal
from app.models import Fare, Zone


PILOT_ZONES = (
    "Ado-Ekiti Central",
    "Fajuyi / Secretariat Axis",
    "Oke-Ila",
    "Basiri",
    "Adebayo",
    "Ajilosun",
)

FARE_RULES = {
    "standard": {
        "base_amount": Decimal("1500.00"),
        "vehicle_multiplier": Decimal("1.000"),
        "extra_passenger_amount": Decimal("500.00"),
    },
    "motorcycle": {
        "base_amount": Decimal("800.00"),
        "vehicle_multiplier": Decimal("1.000"),
        "extra_passenger_amount": Decimal("0.00"),
    },
}


def build_plan(zone_ids: dict[str, int]) -> list[dict]:
    if set(zone_ids) != set(PILOT_ZONES):
        raise ValueError("The six expected pilot zones do not match the database.")

    if len(set(zone_ids.values())) != len(PILOT_ZONES):
        raise ValueError("Pilot zones must have unique database IDs.")

    plan = []
    for origin, destination in permutations(PILOT_ZONES, 2):
        for vehicle_type, rules in FARE_RULES.items():
            plan.append({
                "origin_zone_id": zone_ids[origin],
                "origin": origin,
                "destination_zone_id": zone_ids[destination],
                "destination": destination,
                "vehicle_type": vehicle_type,
                **rules,
                "is_active": True,
            })
    return plan


def validate_plan(plan: list[dict]) -> None:
    if len(plan) != 60:
        raise ValueError(f"Expected 60 fare proposals; got {len(plan)}.")

    keys = [
        (r["origin_zone_id"], r["destination_zone_id"], r["vehicle_type"])
        for r in plan
    ]
    if len(keys) != len(set(keys)):
        raise ValueError("Duplicate route/vehicle combinations found.")

    for row in plan:
        if row["origin_zone_id"] == row["destination_zone_id"]:
            raise ValueError("Same-zone routes must not be included.")

        for field, expected in FARE_RULES[row["vehicle_type"]].items():
            if row[field] != expected:
                raise ValueError(
                    f"Unexpected {field} for {row['vehicle_type']}."
                )

        if row["is_active"] is not True:
            raise ValueError("Proposed fares must be active.")

    if sum(r["vehicle_type"] == "standard" for r in plan) != 30:
        raise ValueError("Expected 30 standard-car fares.")

    if sum(r["vehicle_type"] == "motorcycle" for r in plan) != 30:
        raise ValueError("Expected 30 motorcycle fares.")


def main() -> int:
    print("READ-ONLY REVIEW — no database writes will be performed.")

    with SessionLocal() as session:
        zones = session.query(Zone).all()
        zone_ids = {zone.name: zone.id for zone in zones}

        missing = sorted(set(PILOT_ZONES) - set(zone_ids))
        if missing:
            raise ValueError(f"Missing pilot zones in database: {missing}")

        inactive = [
            name for name in PILOT_ZONES
            if not zone_ids[name] or not next(
                z for z in zones if z.name == name
            ).is_active
        ]
        if inactive:
            raise ValueError(f"Pilot zones missing IDs or inactive: {inactive}")

        plan = build_plan({
            name: zone_ids[name] for name in PILOT_ZONES
        })
        validate_plan(plan)

        existing_fares = session.query(Fare).all()
        existing_keys = {
            (f.origin_zone_id, f.destination_zone_id, f.vehicle_type)
            for f in existing_fares
            if f.origin_zone_id != f.destination_zone_id
        }
        proposed_keys = {
            (r["origin_zone_id"], r["destination_zone_id"], r["vehicle_type"])
            for r in plan
        }
        overlaps = proposed_keys & existing_keys

        print("\nVerified pilot zones:")
        for name in PILOT_ZONES:
            print(f"  ID {zone_ids[name]}: {name}")

        print("\nProposed fare rules:")
        for vehicle_type, rules in FARE_RULES.items():
            print(
                f"  {vehicle_type}: base NGN {rules['base_amount']:.2f}; "
                f"multiplier {rules['vehicle_multiplier']}; "
                f"additional passenger NGN "
                f"{rules['extra_passenger_amount']:.2f}"
            )

        print("\nValidation: PASSED")
        print(f"  Directional routes: {len(PILOT_ZONES) * (len(PILOT_ZONES) - 1)}")
        print(f"  Standard-car proposals: "
              f"{sum(r['vehicle_type'] == 'standard' for r in plan)}")
        print(f"  Motorcycle proposals: "
              f"{sum(r['vehicle_type'] == 'motorcycle' for r in plan)}")
        print(f"  Total proposed fare records: {len(plan)}")
        print(f"  Existing fare records: {len(existing_fares)}")
        print(f"  Proposed combinations already present: {len(overlaps)}")

        if overlaps:
            print("\nExisting matching combinations (review before any future insert):")
            for origin_id, destination_id, vehicle_type in sorted(overlaps):
                print(f"  origin={origin_id}, destination={destination_id}, "
                      f"vehicle={vehicle_type}")

        print("\nNo records were inserted, updated, or deleted.")
        print("Motorcycle rule: one passenger, excluding the rider.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
