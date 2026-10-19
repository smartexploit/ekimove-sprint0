"""Idempotently seed the initial EkiMove Ado-Ekiti zones."""

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from app.database import SessionLocal
from app.models import Zone


PILOT_ZONES = (
    "Ado-Ekiti Central",
    "Fajuyi / Secretariat Axis",
    "Oke-Ila",
    "Basiri",
    "Adebayo",
    "Ajilosun",
)


def main() -> int:
    db = SessionLocal()
    try:
        existing_names = set(db.scalars(select(Zone.name)).all())
        added = []

        for name in PILOT_ZONES:
            if name not in existing_names:
                db.add(Zone(name=name, is_active=True))
                added.append(name)

        if added:
            db.commit()
            print(f"Created {len(added)} zone(s):")
            for name in added:
                print(f"  + {name}")
        else:
            print("All six pilot zones already exist. No changes made.")

        print("\nCurrent pilot-zone status:")
        zones = db.scalars(
            select(Zone).where(Zone.name.in_(PILOT_ZONES)).order_by(Zone.id)
        ).all()

        for zone in zones:
            status = "active" if zone.is_active else "inactive"
            print(f"  [{status}] ID {zone.id}: {zone.name}")

        print("\nNo fares were created or changed.")
        return 0

    except SQLAlchemyError:
        db.rollback()
        print("Database operation failed. Changes were rolled back.")
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
