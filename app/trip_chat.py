"""Trip chat: the passenger and their driver message each other in the
app, so neither has to share a phone number.

Open from assignment until the trip ends; afterwards it is read-only and
kept for safety reviews (super-admins can read it in the trip record).
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.rate_limit import enforce as enforce_rate_limit
from app.models import Driver, Ride, RideRequest, TripMessage, User

router = APIRouter(prefix="/api/v1", tags=["trip chat"])
OPEN_STATUSES = ("assigned", "driver_arriving", "in_progress")
MAX_MESSAGES_PER_TRIP = 200


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).isoformat()


def _side(db: Session, ride: Ride, user: User) -> str | None:
    request = db.get(RideRequest, ride.request_id)
    if request is not None and request.passenger_user_id == user.id:
        return "passenger"
    driver = db.get(Driver, ride.driver_id)
    if driver is not None and driver.user_id == user.id:
        return "driver"
    return None


def chat_unread(db: Session, ride: Ride, user: User) -> int:
    """Messages from the other person since this person last opened the chat."""
    side = _side(db, ride, user)
    if side is None:
        return 0
    read_at = ride.passenger_chat_read_at if side == "passenger" else ride.driver_chat_read_at
    query = select(func.count(TripMessage.id)).where(TripMessage.ride_id == ride.id,
                                                     TripMessage.sender_user_id != user.id)
    if read_at is not None:
        query = query.where(TripMessage.created_at > read_at)
    return db.scalar(query) or 0


def messages_for(db: Session, ride: Ride, viewer: User | None = None) -> list[dict]:
    request = db.get(RideRequest, ride.request_id)
    rows = db.scalars(select(TripMessage).where(TripMessage.ride_id == ride.id)
                      .order_by(TripMessage.created_at, TripMessage.id)).all()
    return [
        {"id": m.id, "body": m.body, "created_at": _iso(m.created_at),
         "from": "passenger" if request and m.sender_user_id == request.passenger_user_id else "driver",
         "mine": viewer is not None and m.sender_user_id == viewer.id}
        for m in rows
    ]


def _ride(db: Session, ride_id: int, user: User) -> tuple[Ride, str]:
    ride = db.get(Ride, ride_id)
    side = _side(db, ride, user) if ride is not None else None
    if ride is None or side is None:
        raise HTTPException(status_code=404, detail="Trip not found.")
    return ride, side


@router.get("/rides/{ride_id}/messages")
def list_trip_messages(ride_id: int, current_user: User = Depends(get_current_user),
                       db: Session = Depends(get_db)) -> dict:
    ride, side = _ride(db, ride_id, current_user)
    if side == "passenger":
        ride.passenger_chat_read_at = _now()
    else:
        ride.driver_chat_read_at = _now()
    db.commit()
    return {"ride_id": ride.id, "open": ride.status in OPEN_STATUSES, "messages": messages_for(db, ride, current_user)}


class TripMessageIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    body: str = Field(min_length=1, max_length=500)


@router.post("/rides/{ride_id}/messages", status_code=201)
def send_trip_message(ride_id: int, payload: TripMessageIn, current_user: User = Depends(get_current_user),
                      db: Session = Depends(get_db)) -> dict:
    ride, side = _ride(db, ride_id, current_user)
    enforce_rate_limit("trip-chat", f"user:{current_user.id}", 20, 60,
                       "You're sending messages very fast. Please wait a moment.")
    if ride.status not in OPEN_STATUSES:
        raise HTTPException(status_code=409, detail="This trip has ended, so the chat is closed. "
                                                    "Use Support if you need help.")
    count = db.scalar(select(func.count(TripMessage.id)).where(TripMessage.ride_id == ride.id)) or 0
    if count >= MAX_MESSAGES_PER_TRIP:
        raise HTTPException(status_code=429, detail="This chat is full. Please call through Support if needed.")
    now = _now()
    db.add(TripMessage(ride_id=ride.id, sender_user_id=current_user.id, body=payload.body, created_at=now))
    if side == "passenger":
        ride.passenger_chat_read_at = now
    else:
        ride.driver_chat_read_at = now
    from app import notifications  # avoid an import cycle

    notifications.trip_message(db, ride, db.get(RideRequest, ride.request_id), current_user, payload.body)
    db.commit()
    return {"ride_id": ride.id, "open": True, "messages": messages_for(db, ride, current_user)}
