"""Book for later, and saved places.

* A ride can be booked from 30 minutes to 7 days ahead. It waits as
  "scheduled" and starts looking for a driver a set number of minutes
  before pickup (admin setting, default 20). The passenger gets a phone
  notification when the search starts.
* Passengers can save up to 10 places (Home, Work, …) to fill the booking
  form in one tap.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models import Place, RideRequest, SavedPlace, ServiceArea, User

router = APIRouter(prefix="/api/v1", tags=["booking"])
LAGOS = ZoneInfo("Africa/Lagos")
MIN_AHEAD = timedelta(minutes=30)
MAX_AHEAD = timedelta(days=7)
MAX_SAVED = 10


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def iso_utc(value: datetime | None) -> str | None:
    """ISO time with its UTC offset (SQLite hands back times without one)."""
    value = _aware(value)
    return value.isoformat() if value else None


def check_pickup_time(db: Session, when: datetime | None) -> datetime | None:
    """Validate a pickup time for a booking made for later."""
    if when is None:
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=LAGOS)  # times without a zone are Lagos time
    when = when.astimezone(timezone.utc)
    now = _now()
    if when < now + MIN_AHEAD - timedelta(minutes=1):
        raise HTTPException(status_code=422, detail="Book for later at least 30 minutes ahead, or book now.")
    if when > now + MAX_AHEAD:
        raise HTTPException(status_code=422, detail="You can book up to 7 days ahead.")
    return when


def due_for_dispatch(request: RideRequest, lead_minutes: int, now: datetime | None = None) -> bool:
    when = _aware(request.scheduled_for)
    return when is None or when <= (now or _now()) + timedelta(minutes=lead_minutes)


# --------------------------------------------------------------------------
# Saved places
# --------------------------------------------------------------------------


def _saved_result(db: Session, saved: SavedPlace) -> dict:
    place = db.get(Place, saved.place_id)
    area = db.get(ServiceArea, place.service_area_id) if place else None
    usable = bool(place and place.status == "active" and area and area.status == "active")
    return {"id": saved.id, "label": saved.label, "place_id": saved.place_id,
            "place_name": place.name if place else None, "service_area_id": place.service_area_id if place else None,
            "available": usable}


def _passenger(user: User) -> User:
    if user.role != "passenger":
        raise HTTPException(status_code=403, detail="Saved places are for passengers.")
    return user


@router.get("/me/saved-places")
def list_saved_places(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[dict]:
    _passenger(current_user)
    rows = db.scalars(select(SavedPlace).where(SavedPlace.user_id == current_user.id)
                      .order_by(SavedPlace.created_at, SavedPlace.id)).all()
    return [_saved_result(db, row) for row in rows]


class SavedPlaceIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    label: str = Field(min_length=1, max_length=40)
    place_id: int = Field(gt=0)


@router.post("/me/saved-places", status_code=201)
def save_place(payload: SavedPlaceIn, current_user: User = Depends(get_current_user),
               db: Session = Depends(get_db)) -> dict:
    _passenger(current_user)
    place = db.get(Place, payload.place_id)
    if place is None or place.status != "active":
        raise HTTPException(status_code=422, detail="Choose a place from the list.")
    existing = db.scalar(select(SavedPlace).where(SavedPlace.user_id == current_user.id,
                                                  SavedPlace.label == payload.label))
    if existing is not None:
        existing.place_id = place.id  # saving "Home" again moves it
        db.commit()
        return _saved_result(db, existing)
    count = len(db.scalars(select(SavedPlace.id).where(SavedPlace.user_id == current_user.id)).all())
    if count >= MAX_SAVED:
        raise HTTPException(status_code=409, detail=f"You can save up to {MAX_SAVED} places. Remove one first.")
    saved = SavedPlace(user_id=current_user.id, label=payload.label, place_id=place.id, created_at=_now())
    db.add(saved)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="You already have a place with that name.") from None
    return _saved_result(db, saved)


@router.delete("/me/saved-places/{saved_id}")
def delete_saved_place(saved_id: int, current_user: User = Depends(get_current_user),
                       db: Session = Depends(get_db)) -> dict:
    saved = db.get(SavedPlace, saved_id)
    if saved is None or saved.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Saved place not found.")
    db.delete(saved)
    db.commit()
    return {"deleted": True}
