from decimal import Decimal, InvalidOperation
import re

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import require_super_admin
from app.database import get_db
from app.models import AuditLog, Fare, Place, PlaceFare, RideRequest, SavedPlace, ServiceArea, User, Zone

router = APIRouter(prefix="/api/v1/admin/locations", tags=["admin", "locations"])

AREA_STATUSES = {"draft", "active", "inactive"}
PLACE_TYPES = {"street", "landmark", "junction", "bus_stop", "neighbourhood", "other"}
PLACE_STATUSES = {"pending", "active", "inactive"}


class AreaCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    name: str = Field(min_length=2, max_length=120)
    slug: str | None = Field(default=None, max_length=100)
    description: str | None = Field(default=None, max_length=2000)
    status: str = "draft"


class AreaUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    name: str | None = Field(default=None, min_length=2, max_length=120)
    slug: str | None = Field(default=None, max_length=100)
    description: str | None = Field(default=None, max_length=2000)
    status: str | None = None


class PlaceCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    service_area_id: int = Field(gt=0)
    zone_id: int = Field(gt=0)
    name: str = Field(min_length=2, max_length=160)
    place_type: str = "other"
    address_text: str | None = Field(default=None, max_length=255)
    aliases: str | None = Field(default=None, max_length=2000)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    notes: str | None = Field(default=None, max_length=2000)
    status: str = "pending"


class PlaceUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    service_area_id: int | None = Field(default=None, gt=0)
    zone_id: int | None = Field(default=None, gt=0)
    name: str | None = Field(default=None, min_length=2, max_length=160)
    place_type: str | None = None
    address_text: str | None = Field(default=None, max_length=255)
    aliases: str | None = Field(default=None, max_length=2000)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    notes: str | None = Field(default=None, max_length=2000)
    status: str | None = None


class FareCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    origin_zone_id: int = Field(gt=0)
    destination_zone_id: int = Field(gt=0)
    vehicle_type: str = Field(min_length=2, max_length=32)
    base_amount: Decimal = Field(ge=0, max_digits=12, decimal_places=2)
    vehicle_multiplier: Decimal = Field(default=Decimal("1.000"), gt=0, max_digits=6, decimal_places=3)
    extra_passenger_amount: Decimal = Field(default=Decimal("0.00"), ge=0, max_digits=12, decimal_places=2)
    is_active: bool = False


class FareUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    origin_zone_id: int | None = Field(default=None, gt=0)
    destination_zone_id: int | None = Field(default=None, gt=0)
    vehicle_type: str | None = Field(default=None, min_length=2, max_length=32)
    base_amount: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    vehicle_multiplier: Decimal | None = Field(default=None, gt=0, max_digits=6, decimal_places=3)
    extra_passenger_amount: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    is_active: bool | None = None


def _audit(db: Session, admin: User, action: str, entity: str, entity_id: int, details: str) -> None:
    db.add(AuditLog(
        actor_user_id=admin.id,
        action=action,
        entity_type=entity,
        entity_id=str(entity_id),
        details=details[:2000],
    ))


def _save(db: Session, message: str) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=message,
        ) from exc


def _area_dict(area: ServiceArea) -> dict:
    return {
        "id": area.id, "name": area.name, "slug": area.slug,
        "description": area.description, "status": area.status,
    }


def _place_dict(place: Place) -> dict:
    return {
        "id": place.id, "service_area_id": place.service_area_id,
        "zone_id": place.zone_id, "name": place.name,
        "place_type": place.place_type, "address_text": place.address_text,
        "aliases": place.aliases, "latitude": place.latitude,
        "longitude": place.longitude, "notes": place.notes,
        "status": place.status,
    }


def _fare_dict(fare: Fare) -> dict:
    return {
        "id": fare.id, "origin_zone_id": fare.origin_zone_id,
        "destination_zone_id": fare.destination_zone_id,
        "vehicle_type": fare.vehicle_type, "base_amount": fare.base_amount,
        "vehicle_multiplier": fare.vehicle_multiplier,
        "extra_passenger_amount": fare.extra_passenger_amount,
        "is_active": fare.is_active, "currency": "NGN",
    }


def _valid_zone(db: Session, zone_id: int) -> Zone:
    zone = db.get(Zone, zone_id)
    if zone is None:
        raise HTTPException(status_code=422, detail=f"Zone {zone_id} does not exist")
    return zone


def _valid_area(db: Session, area_id: int) -> ServiceArea:
    area = db.get(ServiceArea, area_id)
    if area is None:
        raise HTTPException(status_code=422, detail=f"Service area {area_id} does not exist")
    return area


@router.get("/areas")
def list_areas(
    include_inactive: bool = True,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_super_admin),
) -> list[dict]:
    query = select(ServiceArea).order_by(ServiceArea.name)
    if not include_inactive:
        query = query.where(ServiceArea.status == "active")
    return [_area_dict(area) for area in db.scalars(query).all()]


@router.post("/areas", status_code=201)
def create_area(
    payload: AreaCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_super_admin),
) -> dict:
    if payload.status not in AREA_STATUSES:
        raise HTTPException(status_code=422, detail="Invalid service-area status")
    slug = payload.slug or re.sub(r"[^a-z0-9]+", "-", payload.name.lower()).strip("-")
    if not slug or len(slug) > 100:
        raise HTTPException(status_code=422, detail="A valid slug could not be generated")
    existing_area = db.scalar(
        select(ServiceArea).where(
            (func.lower(ServiceArea.name) == payload.name.lower())
            | (func.lower(ServiceArea.slug) == slug.lower())
        )
    )
    if existing_area is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A service area with this name or slug already exists. Edit the existing area instead.",
        )

    area = ServiceArea(
        name=payload.name, slug=slug, description=payload.description,
        status=payload.status,
    )
    db.add(area)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A service area with this name or slug already exists. Edit the existing area instead.",
        ) from exc

    _audit(db, admin, "location.area_created", "service_area", area.id, f"Created area {area.name}")
    _save(db, "A service area with this name or slug already exists")
    db.refresh(area)
    return _area_dict(area)


@router.patch("/areas/{area_id}")
def update_area(
    area_id: int,
    payload: AreaUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_super_admin),
) -> dict:
    area = db.get(ServiceArea, area_id)
    if area is None:
        raise HTTPException(status_code=404, detail="Service area not found")
    changes = payload.model_dump(exclude_unset=True)
    if "status" in changes and changes["status"] not in AREA_STATUSES:
        raise HTTPException(status_code=422, detail="Invalid service-area status")
    if "slug" in changes and changes["slug"] is None:
        raise HTTPException(status_code=422, detail="Slug cannot be null")
    for key, value in changes.items():
        setattr(area, key, value)
    _audit(db, admin, "location.area_updated", "service_area", area.id, f"Updated fields: {', '.join(changes)}")
    _save(db, "A service area with this name or slug already exists")
    db.refresh(area)
    return _area_dict(area)


@router.get("/places")
def list_places(
    service_area_id: int | None = None,
    include_inactive: bool = True,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_super_admin),
) -> list[dict]:
    query = select(Place).order_by(Place.name)
    if service_area_id is not None:
        query = query.where(Place.service_area_id == service_area_id)
    if not include_inactive:
        query = query.where(Place.status == "active")
    return [_place_dict(place) for place in db.scalars(query).all()]


@router.post("/places", status_code=201)
def create_place(
    payload: PlaceCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_super_admin),
) -> dict:
    if payload.place_type not in PLACE_TYPES or payload.status not in PLACE_STATUSES:
        raise HTTPException(status_code=422, detail="Invalid place type or status")
    _valid_area(db, payload.service_area_id)
    _valid_zone(db, payload.zone_id)
    place = Place(**payload.model_dump())
    db.add(place)
    db.flush()
    _audit(db, admin, "location.place_created", "place", place.id, f"Created place {place.name}")
    _save(db, "A place with this name already exists in this service area")
    db.refresh(place)
    return _place_dict(place)


@router.patch("/places/{place_id}")
def update_place(
    place_id: int,
    payload: PlaceUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_super_admin),
) -> dict:
    place = db.get(Place, place_id)
    if place is None:
        raise HTTPException(status_code=404, detail="Place not found")
    changes = payload.model_dump(exclude_unset=True)
    if "place_type" in changes and changes["place_type"] not in PLACE_TYPES:
        raise HTTPException(status_code=422, detail="Invalid place type")
    if "status" in changes and changes["status"] not in PLACE_STATUSES:
        raise HTTPException(status_code=422, detail="Invalid place status")
    if changes.get("service_area_id") is not None:
        _valid_area(db, changes["service_area_id"])
    if changes.get("zone_id") is not None:
        _valid_zone(db, changes["zone_id"])
    for key, value in changes.items():
        setattr(place, key, value)
    _audit(db, admin, "location.place_updated", "place", place.id, f"Updated fields: {', '.join(changes)}")
    _save(db, "A place with this name already exists in this service area")
    db.refresh(place)
    return _place_dict(place)


@router.get("/fares")
def list_fares(
    include_inactive: bool = True,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_super_admin),
) -> list[dict]:
    query = select(Fare).order_by(Fare.origin_zone_id, Fare.destination_zone_id, Fare.vehicle_type)
    if not include_inactive:
        query = query.where(Fare.is_active.is_(True))
    return [_fare_dict(fare) for fare in db.scalars(query).all()]


@router.post("/fares", status_code=201)
def create_fare(
    payload: FareCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_super_admin),
) -> dict:
    if payload.origin_zone_id == payload.destination_zone_id:
        raise HTTPException(status_code=422, detail="Origin and destination must differ")
    _valid_zone(db, payload.origin_zone_id)
    _valid_zone(db, payload.destination_zone_id)
    existing = db.scalar(select(Fare).where(
        Fare.origin_zone_id == payload.origin_zone_id,
        Fare.destination_zone_id == payload.destination_zone_id,
        Fare.vehicle_type == payload.vehicle_type,
        Fare.is_active.is_(True),
    ))
    if payload.is_active and existing:
        raise HTTPException(status_code=409, detail="An active fare already exists for this route and vehicle")
    fare = Fare(**payload.model_dump())
    db.add(fare)
    db.flush()
    _audit(db, admin, "location.fare_created", "fare", fare.id, f"Created {fare.vehicle_type} fare; activation={fare.is_active}")
    _save(db, "Could not save this fare rule")
    db.refresh(fare)
    return _fare_dict(fare)


@router.patch("/fares/{fare_id}")
def update_fare(
    fare_id: int,
    payload: FareUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_super_admin),
) -> dict:
    fare = db.get(Fare, fare_id)
    if fare is None:
        raise HTTPException(status_code=404, detail="Fare rule not found")
    changes = payload.model_dump(exclude_unset=True)
    origin_id = changes.get("origin_zone_id", fare.origin_zone_id)
    destination_id = changes.get("destination_zone_id", fare.destination_zone_id)
    vehicle_type = changes.get("vehicle_type", fare.vehicle_type)
    active = changes.get("is_active", fare.is_active)
    if origin_id == destination_id:
        raise HTTPException(status_code=422, detail="Origin and destination must differ")
    _valid_zone(db, origin_id)
    _valid_zone(db, destination_id)
    if active:
        duplicate = db.scalar(select(Fare).where(
            Fare.id != fare.id,
            Fare.origin_zone_id == origin_id,
            Fare.destination_zone_id == destination_id,
            Fare.vehicle_type == vehicle_type,
            Fare.is_active.is_(True),
        ))
        if duplicate:
            raise HTTPException(status_code=409, detail="An active fare already exists for this route and vehicle")
    for key, value in changes.items():
        setattr(fare, key, value)
    _audit(db, admin, "location.fare_updated", "fare", fare.id, f"Updated fields: {', '.join(changes)}")
    _save(db, "Could not update this fare rule")
    db.refresh(fare)
    return _fare_dict(fare)


class PlaceFareCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    origin_place_id: int = Field(gt=0)
    destination_place_id: int = Field(gt=0)
    vehicle_type: str = Field(min_length=2, max_length=32)
    base_amount: Decimal = Field(ge=0, max_digits=12, decimal_places=2)
    vehicle_multiplier: Decimal = Field(
        default=Decimal("1.000"), gt=0, max_digits=6, decimal_places=3
    )
    extra_passenger_amount: Decimal = Field(
        default=Decimal("0.00"), ge=0, max_digits=12, decimal_places=2
    )
    is_active: bool = False


class PlaceFareUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    origin_place_id: int | None = Field(default=None, gt=0)
    destination_place_id: int | None = Field(default=None, gt=0)
    vehicle_type: str | None = Field(default=None, min_length=2, max_length=32)
    base_amount: Decimal | None = Field(
        default=None, ge=0, max_digits=12, decimal_places=2
    )
    vehicle_multiplier: Decimal | None = Field(
        default=None, gt=0, max_digits=6, decimal_places=3
    )
    extra_passenger_amount: Decimal | None = Field(
        default=None, ge=0, max_digits=12, decimal_places=2
    )
    is_active: bool | None = None


def _place_fare_dict(fare: PlaceFare) -> dict:
    return {
        "id": fare.id,
        "origin_place_id": fare.origin_place_id,
        "destination_place_id": fare.destination_place_id,
        "vehicle_type": fare.vehicle_type,
        "base_amount": fare.base_amount,
        "vehicle_multiplier": fare.vehicle_multiplier,
        "extra_passenger_amount": fare.extra_passenger_amount,
        "is_active": fare.is_active,
        "pricing_source": fare.pricing_source,
        "currency": "NGN",
    }


def _valid_place(db: Session, place_id: int) -> Place:
    place = db.get(Place, place_id)
    if place is None:
        raise HTTPException(
            status_code=422, detail=f"Place {place_id} does not exist"
        )
    return place


def _check_place_fare_activation(
    db: Session, origin_id: int, destination_id: int, active: bool
) -> None:
    if origin_id == destination_id:
        raise HTTPException(
            status_code=422, detail="Pickup and destination must differ"
        )
    origin = _valid_place(db, origin_id)
    destination = _valid_place(db, destination_id)
    if active:
        for place in (origin, destination):
            area = db.get(ServiceArea, place.service_area_id)
            zone = db.get(Zone, place.zone_id)
            if (
                place.status != "active"
                or area is None
                or area.status != "active"
                or zone is None
                or not zone.is_active
            ):
                raise HTTPException(
                    status_code=422,
                    detail="Both places, service areas and zones must be active before activating a fare",
                )


@router.get("/place-fares")
def list_place_fares(
    include_inactive: bool = True,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_super_admin),
) -> list[dict]:
    query = select(PlaceFare).order_by(
        PlaceFare.origin_place_id,
        PlaceFare.destination_place_id,
        PlaceFare.vehicle_type,
    )
    if not include_inactive:
        query = query.where(PlaceFare.is_active.is_(True))
    return [_place_fare_dict(fare) for fare in db.scalars(query).all()]


@router.post("/place-fares", status_code=201)
def create_place_fare(
    payload: PlaceFareCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_super_admin),
) -> dict:
    _check_place_fare_activation(
        db,
        payload.origin_place_id,
        payload.destination_place_id,
        payload.is_active,
    )
    fare = PlaceFare(**payload.model_dump())
    db.add(fare)
    try:
        db.flush()
        _audit(
            db, admin, "location.place_fare_created", "place_fare", fare.id,
            f"Configured {payload.vehicle_type} place fare; active={payload.is_active}",
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="A fare already exists for this pickup, destination and vehicle type",
        ) from exc
    db.refresh(fare)
    return _place_fare_dict(fare)


@router.patch("/place-fares/{fare_id}")
def update_place_fare(
    fare_id: int,
    payload: PlaceFareUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_super_admin),
) -> dict:
    fare = db.get(PlaceFare, fare_id)
    if fare is None:
        raise HTTPException(status_code=404, detail="Place fare not found")

    changes = payload.model_dump(exclude_unset=True)
    if any(value is None for value in changes.values()):
        raise HTTPException(
            status_code=422,
            detail="Fare fields cannot be set to null; omit unchanged fields",
        )

    origin_id = changes.get("origin_place_id", fare.origin_place_id)
    destination_id = changes.get(
        "destination_place_id", fare.destination_place_id
    )
    active = changes.get("is_active", fare.is_active)
    _check_place_fare_activation(db, origin_id, destination_id, active)

    vehicle_type = changes.get("vehicle_type", fare.vehicle_type)
    duplicate = db.scalar(
        select(PlaceFare).where(
            PlaceFare.id != fare.id,
            PlaceFare.origin_place_id == origin_id,
            PlaceFare.destination_place_id == destination_id,
            PlaceFare.vehicle_type == vehicle_type,
        )
    )
    if duplicate is not None:
        raise HTTPException(
            status_code=409,
            detail="A fare already exists for this pickup, destination and vehicle type",
        )

    for field, value in changes.items():
        setattr(fare, field, value)
    # Edited by hand, so the fare calculator leaves it alone from now on.
    fare.pricing_source = "manual"

    _audit(
        db, admin, "location.place_fare_updated", "place_fare", fare.id,
        f"Updated place fare; fields={','.join(sorted(changes))}",
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409, detail="Could not save this place fare"
        ) from exc

    db.refresh(fare)
    return _place_fare_dict(fare)



# --------------------------------------------------------------------------
# Removing areas, zones, places and route fares
#
# Anything a trip has used stays, so receipts, reports and ride history
# keep their place names: those can only be switched to Inactive (hidden
# from booking). Everything else can be removed for good. Each "removal"
# check says what would go before anything is deleted.
# --------------------------------------------------------------------------


def _trips_using(db: Session, place_ids: list[int]) -> int:
    if not place_ids:
        return 0
    return db.scalar(select(func.count(RideRequest.id)).where(or_(
        RideRequest.origin_place_id.in_(place_ids), RideRequest.destination_place_id.in_(place_ids)))) or 0


def _fares_for(db: Session, place_ids: list[int]) -> list[int]:
    if not place_ids:
        return []
    return list(db.scalars(select(PlaceFare.id).where(or_(
        PlaceFare.origin_place_id.in_(place_ids), PlaceFare.destination_place_id.in_(place_ids)))).all())


def _saved_for(db: Session, place_ids: list[int]) -> int:
    if not place_ids:
        return 0
    return db.scalar(select(func.count(SavedPlace.id)).where(SavedPlace.place_id.in_(place_ids))) or 0


def _remove_places(db: Session, place_ids: list[int]) -> None:
    if not place_ids:
        return
    db.execute(delete(PlaceFare).where(or_(
        PlaceFare.origin_place_id.in_(place_ids), PlaceFare.destination_place_id.in_(place_ids))))
    db.execute(delete(SavedPlace).where(SavedPlace.place_id.in_(place_ids)))
    db.execute(delete(Place).where(Place.id.in_(place_ids)))


def _plural(count: int, word: str) -> str:
    return f"{count} {word}{'' if count == 1 else 's'}"


def _area_removal(db: Session, area: ServiceArea) -> dict:
    place_ids = list(db.scalars(select(Place.id).where(Place.service_area_id == area.id)).all())
    trips = _trips_using(db, place_ids)
    summary = {
        "kind": "service area", "name": area.name, "places": len(place_ids),
        "route_fares": len(_fares_for(db, place_ids)), "saved_places": _saved_for(db, place_ids), "trips": trips,
        "can_remove": trips == 0,
    }
    summary["reason"] = None if trips == 0 else (
        f"Its places have been used in {_plural(trips, 'trip')}. Set the area to Inactive instead: it disappears "
        "from booking, and past receipts keep their place names.")
    return summary


def _zone_removal(db: Session, zone: Zone) -> dict:
    places = db.scalar(select(func.count(Place.id)).where(Place.zone_id == zone.id)) or 0
    zone_fares = db.scalar(select(func.count(Fare.id)).where(
        or_(Fare.origin_zone_id == zone.id, Fare.destination_zone_id == zone.id))) or 0
    return {
        "kind": "zone", "name": zone.name, "places": places, "zone_fares": zone_fares, "can_remove": places == 0,
        "reason": None if places == 0 else (
            f"{_plural(places, 'place')} still use this zone. Move them to another zone or remove them first, "
            "or set the zone to Inactive."),
    }


def _place_removal(db: Session, place: Place) -> dict:
    trips = _trips_using(db, [place.id])
    return {
        "kind": "place", "name": place.name, "route_fares": len(_fares_for(db, [place.id])),
        "saved_places": _saved_for(db, [place.id]), "trips": trips, "can_remove": trips == 0,
        "reason": None if trips == 0 else (
            f"It has been used in {_plural(trips, 'trip')}. Set it to Inactive instead: it disappears from "
            "booking, and past receipts keep its name."),
    }


def _get(db: Session, model, item_id: int, label: str):
    item = db.get(model, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail=f"{label} not found")
    return item


def _refuse(summary: dict) -> None:
    if not summary["can_remove"]:
        raise HTTPException(status_code=409, detail=f"This {summary['kind']} can't be removed. {summary['reason']}")


@router.get("/areas/{area_id}/removal")
def check_area_removal(area_id: int, db: Session = Depends(get_db),
                       _admin: User = Depends(require_super_admin)) -> dict:
    return _area_removal(db, _get(db, ServiceArea, area_id, "Service area"))


@router.delete("/areas/{area_id}")
def remove_area(area_id: int, db: Session = Depends(get_db), admin: User = Depends(require_super_admin)) -> dict:
    area = _get(db, ServiceArea, area_id, "Service area")
    summary = _area_removal(db, area)
    _refuse(summary)
    place_ids = list(db.scalars(select(Place.id).where(Place.service_area_id == area.id)).all())
    _remove_places(db, place_ids)
    db.delete(area)
    _audit(db, admin, "location.area_removed", "service_area", area_id,
           f"Removed area {summary['name']} with {_plural(summary['places'], 'place')} and "
           f"{_plural(summary['route_fares'], 'route fare')}")
    db.commit()
    return {"removed": True, **summary}


@router.get("/zones/{zone_id}/removal")
def check_zone_removal(zone_id: int, db: Session = Depends(get_db),
                       _admin: User = Depends(require_super_admin)) -> dict:
    return _zone_removal(db, _get(db, Zone, zone_id, "Zone"))


@router.delete("/zones/{zone_id}")
def remove_zone(zone_id: int, db: Session = Depends(get_db), admin: User = Depends(require_super_admin)) -> dict:
    zone = _get(db, Zone, zone_id, "Zone")
    summary = _zone_removal(db, zone)
    _refuse(summary)
    db.execute(delete(Fare).where(or_(Fare.origin_zone_id == zone.id, Fare.destination_zone_id == zone.id)))
    db.delete(zone)
    _audit(db, admin, "location.zone_removed", "zone", zone_id, f"Removed zone {summary['name']}")
    db.commit()
    return {"removed": True, **summary}


@router.get("/places/{place_id}/removal")
def check_place_removal(place_id: int, db: Session = Depends(get_db),
                        _admin: User = Depends(require_super_admin)) -> dict:
    return _place_removal(db, _get(db, Place, place_id, "Place"))


@router.delete("/places/{place_id}")
def remove_place(place_id: int, db: Session = Depends(get_db), admin: User = Depends(require_super_admin)) -> dict:
    place = _get(db, Place, place_id, "Place")
    summary = _place_removal(db, place)
    _refuse(summary)
    _remove_places(db, [place.id])
    _audit(db, admin, "location.place_removed", "place", place_id,
           f"Removed place {summary['name']} and {_plural(summary['route_fares'], 'route fare')}")
    db.commit()
    return {"removed": True, **summary}


@router.delete("/place-fares/{fare_id}")
def remove_place_fare(fare_id: int, db: Session = Depends(get_db),
                      admin: User = Depends(require_super_admin)) -> dict:
    fare = _get(db, PlaceFare, fare_id, "Route fare")
    origin, destination = db.get(Place, fare.origin_place_id), db.get(Place, fare.destination_place_id)
    label = f"{origin.name if origin else fare.origin_place_id} to " \
            f"{destination.name if destination else fare.destination_place_id} ({fare.vehicle_type})"
    db.delete(fare)
    _audit(db, admin, "location.place_fare_removed", "place_fare", fare_id, f"Removed route fare {label}")
    db.commit()
    return {"removed": True, "kind": "route fare", "name": label}
