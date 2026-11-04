"""In-app voice calls between a passenger and their driver.

The audio travels directly between the two phones using WebRTC, so neither
person sees the other's phone number and EkiMove never hears or records
the call. The API only introduces the two phones to each other: the caller
posts a connection "offer", the other phone answers, and both exchange
network routes ("candidates") until the audio flows. Those details are
deleted when the call ends; only who called, when and for how long is kept.

Calls are open from driver assignment until the trip ends, like the chat.
"""

from __future__ import annotations

import json
import logging
import secrets
import time
from datetime import datetime, timedelta, timezone

import requests
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.config import settings
from app.database import get_db
from app.models import Driver, Ride, RideRequest, TripCall, TripCallSignal, User
from app.push import notify
from app.rate_limit import enforce as enforce_rate_limit

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1", tags=["trip calls"])

OPEN_RIDE_STATUSES = ("assigned", "driver_arriving", "in_progress")
LIVE = ("ringing", "active")
MAX_SIGNALS_PER_CALL = 150
MAX_SIGNAL_CHARS = 16_000
TURN_URL = "https://rtc.live.cloudflare.com/v1/turn/keys/{key}/credentials/generate-ice-servers"
PUBLIC_STUN = [{"urls": ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"]}]
_turn_cache: dict = {"until": 0.0, "servers": None}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _iso(value: datetime | None) -> str | None:
    value = _aware(value)
    return value.isoformat() if value else None


def ice_servers() -> list[dict]:
    """STUN for everyone, plus Cloudflare TURN relay when a key is set.

    TURN credentials are short-lived; one set is reused for 15 minutes and
    each lasts long enough for the longest call.
    """
    key, token = settings.cloudflare_turn_key_id, settings.cloudflare_turn_api_token
    if not (key and token):
        return PUBLIC_STUN
    if _turn_cache["servers"] and _turn_cache["until"] > time.monotonic():
        return _turn_cache["servers"]
    try:
        response = requests.post(
            TURN_URL.format(key=key),
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={"ttl": settings.call_max_minutes * 60 + 3600},
            timeout=6,
        )
        response.raise_for_status()
        servers = []
        for server in response.json().get("iceServers", []):
            urls = server.get("urls")
            urls = [urls] if isinstance(urls, str) else list(urls or [])
            # Browsers block port 53, so those addresses only cause delays.
            urls = [url for url in urls if ":53" not in url.split("?")[0]]
            if urls:
                servers.append({**server, "urls": urls})
        if not servers:
            raise ValueError("no ICE servers in the response")
    except (requests.RequestException, ValueError):
        logger.warning("Could not get Cloudflare TURN credentials; calls use direct connections only")
        return PUBLIC_STUN
    _turn_cache.update(servers=servers, until=time.monotonic() + 15 * 60)
    return servers


def relay_configured() -> bool:
    return bool(settings.cloudflare_turn_key_id and settings.cloudflare_turn_api_token)


def _sides(db: Session, ride: Ride) -> tuple[int | None, int | None]:
    request = db.get(RideRequest, ride.request_id)
    driver = db.get(Driver, ride.driver_id)
    return (request.passenger_user_id if request else None, driver.user_id if driver else None)


def _first(user: User | None, fallback: str) -> str:
    return (user.full_name or fallback).split()[0] if user and user.full_name else fallback


def _clear_signals(db: Session, call: TripCall) -> None:
    db.execute(delete(TripCallSignal).where(TripCallSignal.call_id == call.id))


def _finish(db: Session, call: TripCall, status: str, by_user_id: int | None = None) -> None:
    call.status = status
    call.ended_at = _now()
    call.ended_by_user_id = by_user_id
    _clear_signals(db, call)


def _settle(db: Session, call: TripCall) -> TripCall:
    """End calls that rang out, ran too long, or whose trip has finished."""
    if call.status not in LIVE:
        return call
    now = _now()
    ride = db.get(Ride, call.ride_id)
    if ride is None or ride.status not in OPEN_RIDE_STATUSES:
        _finish(db, call, "ended" if call.status == "active" else "cancelled")
    elif call.status == "ringing" and now - _aware(call.created_at) > timedelta(seconds=settings.call_ring_seconds):
        _finish(db, call, "missed")
        caller = db.get(User, call.caller_user_id) if call.caller_user_id else None
        if call.callee_user_id:
            notify(db, call.callee_user_id, f"Missed call from {_first(caller, 'your trip')}",
                   "Open EkiMove to call back or send a message.", url=_trip_url(db, call, call.callee_user_id),
                   tag=f"call-{call.id}", ttl=3600)
    elif call.status == "active" and now - _aware(call.answered_at or call.created_at) > timedelta(
            minutes=settings.call_max_minutes):
        _finish(db, call, "ended")
    return call


def _trip_url(db: Session, call: TripCall, user_id: int) -> str:
    ride = db.get(Ride, call.ride_id)
    passenger_id, _driver_id = _sides(db, ride) if ride else (None, None)
    return "/my-rides" if user_id == passenger_id else "/driver/trips"


def _duration(call: TripCall) -> int | None:
    if not call.answered_at:
        return None
    end = _aware(call.ended_at) or _now()
    return max(0, int((end - _aware(call.answered_at)).total_seconds()))


def call_view(db: Session, call: TripCall, viewer: User) -> dict:
    ride = db.get(Ride, call.ride_id)
    passenger_id, _driver_id = _sides(db, ride) if ride else (None, None)
    other_id = call.callee_user_id if viewer.id == call.caller_user_id else call.caller_user_id
    other = db.get(User, other_id) if other_id else None
    other_role = "passenger" if other_id == passenger_id else "driver"
    return {
        "id": call.id, "ride_id": call.ride_id, "status": call.status,
        "role": "caller" if viewer.id == call.caller_user_id else "callee",
        "other": {"role": other_role, "name": _first(other, "Your " + other_role)},
        "created_at": _iso(call.created_at), "answered_at": _iso(call.answered_at), "ended_at": _iso(call.ended_at),
        "duration_seconds": _duration(call), "ring_seconds": settings.call_ring_seconds,
        "max_minutes": settings.call_max_minutes,
    }


def calls_for_ride(db: Session, ride: Ride) -> list[dict]:
    """Call log for the admin trip record (no audio is ever kept)."""
    passenger_id, _driver_id = _sides(db, ride)
    rows = db.scalars(select(TripCall).where(TripCall.ride_id == ride.id).order_by(TripCall.created_at)).all()
    return [{"from": "passenger" if c.caller_user_id == passenger_id else "driver", "status": c.status,
             "created_at": _iso(c.created_at), "duration_seconds": _duration(c)} for c in rows]


def _call_for(db: Session, call_id: str, user: User) -> TripCall:
    call = db.get(TripCall, call_id) if len(call_id) <= 32 else None
    if call is None or user.id not in (call.caller_user_id, call.callee_user_id):
        raise HTTPException(status_code=404, detail="Call not found.")
    return call


def _live_call_for_user(db: Session, user_id: int, exclude_ride: int | None = None) -> TripCall | None:
    rows = db.scalars(select(TripCall).where(
        TripCall.status.in_(LIVE),
        (TripCall.caller_user_id == user_id) | (TripCall.callee_user_id == user_id),
    )).all()
    for call in rows:
        _settle(db, call)
        if call.status in LIVE and call.ride_id != exclude_ride:
            return call
    return None


@router.get("/calls/config")
def calls_config(current_user: User = Depends(get_current_user)) -> dict:
    return {"enabled": settings.calls_enabled, "relay": relay_configured(),
            "ring_seconds": settings.call_ring_seconds, "max_minutes": settings.call_max_minutes}


@router.post("/rides/{ride_id}/calls", status_code=201)
def start_call(ride_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    if not settings.calls_enabled:
        raise HTTPException(status_code=503, detail="In-app calls are switched off. Please send a message instead.")
    ride = db.get(Ride, ride_id)
    passenger_id, driver_id = _sides(db, ride) if ride else (None, None)
    if ride is None or current_user.id not in (passenger_id, driver_id):
        raise HTTPException(status_code=404, detail="Trip not found.")
    if ride.status not in OPEN_RIDE_STATUSES:
        raise HTTPException(status_code=409, detail="This trip has ended, so calls are closed.")
    callee_id = driver_id if current_user.id == passenger_id else passenger_id
    if not callee_id:
        raise HTTPException(status_code=409, detail="There's no one to call on this trip yet.")
    enforce_rate_limit("call-start", f"user:{current_user.id}", 8, 600,
                       "You've called several times. Please wait a few minutes or send a message.")
    for call in db.scalars(select(TripCall).where(TripCall.ride_id == ride.id, TripCall.status.in_(LIVE))).all():
        _settle(db, call)
        if call.status in LIVE:
            db.commit()
            if call.callee_user_id == current_user.id and call.status == "ringing":
                raise HTTPException(status_code=409, detail="They're calling you right now. Answer the call instead.")
            raise HTTPException(status_code=409, detail="A call on this trip is already in progress.")
    if _live_call_for_user(db, current_user.id, exclude_ride=ride.id):
        db.commit()
        raise HTTPException(status_code=409, detail="Finish your other call first.")
    if _live_call_for_user(db, callee_id, exclude_ride=ride.id):
        db.commit()
        raise HTTPException(status_code=409, detail="They're on another call. Try again shortly or send a message.")
    call = TripCall(id=secrets.token_hex(16), ride_id=ride.id, caller_user_id=current_user.id,
                    callee_user_id=callee_id, status="ringing", created_at=_now())
    db.add(call)
    caller_role = "passenger" if current_user.id == passenger_id else "driver"
    notify(db, callee_id, f"{_first(current_user, 'Your ' + caller_role)} is calling",
           f"Your {caller_role} is calling you in EkiMove. Tap to answer.", url=_trip_url(db, call, callee_id),
           tag=f"call-{call.id}", urgent=True, ttl=settings.call_ring_seconds, extra={"call": True})
    db.commit()
    return {"call": call_view(db, call, current_user), "ice_servers": ice_servers()}


@router.get("/calls/incoming")
def incoming_call(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    """The newest call ringing for this person, if any (the app checks often)."""
    call = db.scalars(select(TripCall).where(TripCall.callee_user_id == current_user.id,
                                             TripCall.status == "ringing")
                      .order_by(TripCall.created_at.desc()).limit(1)).first()
    if call is not None:
        _settle(db, call)
        db.commit()
    if call is None or call.status != "ringing":
        return {"call": None}
    return {"call": call_view(db, call, current_user)}


@router.get("/calls/{call_id}")
def call_state(call_id: str, after: int = Query(default=0, ge=0), current_user: User = Depends(get_current_user),
               db: Session = Depends(get_db)) -> dict:
    call = _settle(db, _call_for(db, call_id, current_user))
    signals = []
    if call.status in LIVE:
        signals = [{"id": s.id, "kind": s.kind, "payload": s.payload}
                   for s in db.scalars(select(TripCallSignal).where(
                       TripCallSignal.call_id == call.id, TripCallSignal.id > after,
                       TripCallSignal.sender_user_id != current_user.id).order_by(TripCallSignal.id))]
    db.commit()
    return {"call": call_view(db, call, current_user), "signals": signals}


class SignalIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: str = Field(pattern="^(offer|answer|candidates)$")
    payload: str = Field(min_length=2, max_length=MAX_SIGNAL_CHARS)


@router.post("/calls/{call_id}/signal", status_code=201)
def send_signal(call_id: str, signal: SignalIn, current_user: User = Depends(get_current_user),
                db: Session = Depends(get_db)) -> dict:
    call = _settle(db, _call_for(db, call_id, current_user))
    if call.status not in LIVE:
        db.commit()
        raise HTTPException(status_code=409, detail="This call has ended.")
    caller = current_user.id == call.caller_user_id
    allowed = {"offer", "candidates"} if caller else ({"answer", "candidates"} if call.status == "active" else set())
    if signal.kind not in allowed:
        raise HTTPException(status_code=409, detail="That step isn't allowed at this point in the call.")
    try:
        json.loads(signal.payload)
    except ValueError:
        raise HTTPException(status_code=422, detail="Call details were not readable.") from None
    enforce_rate_limit("call-signal", f"user:{current_user.id}", 300, 600, "Too many call updates. Please hang up "
                                                                         "and call again.")
    count = db.scalar(select(func.count(TripCallSignal.id)).where(TripCallSignal.call_id == call.id)) or 0
    if count >= MAX_SIGNALS_PER_CALL:
        raise HTTPException(status_code=429, detail="This call couldn't connect. Please hang up and try again.")
    row = TripCallSignal(call_id=call.id, sender_user_id=current_user.id, kind=signal.kind, payload=signal.payload)
    db.add(row)
    db.commit()
    return {"id": row.id}


@router.post("/calls/{call_id}/accept")
def accept_call(call_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    call = _settle(db, _call_for(db, call_id, current_user))
    if current_user.id != call.callee_user_id:
        raise HTTPException(status_code=404, detail="Call not found.")
    if call.status != "ringing":
        db.commit()
        raise HTTPException(status_code=409, detail="This call has already ended.")
    call.status = "active"
    call.answered_at = _now()
    db.commit()
    return {"call": call_view(db, call, current_user), "ice_servers": ice_servers()}


@router.post("/calls/{call_id}/decline")
def decline_call(call_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    call = _settle(db, _call_for(db, call_id, current_user))
    if current_user.id == call.callee_user_id and call.status == "ringing":
        _finish(db, call, "declined", current_user.id)
    db.commit()
    return {"call": call_view(db, call, current_user)}


class EndIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    failed: bool = False


@router.post("/calls/{call_id}/end")
def end_call(call_id: str, payload: EndIn | None = None, current_user: User = Depends(get_current_user),
             db: Session = Depends(get_db)) -> dict:
    call = _settle(db, _call_for(db, call_id, current_user))
    if call.status in LIVE:
        if payload is not None and payload.failed:
            status = "failed"
        elif call.status == "ringing":
            status = "cancelled" if current_user.id == call.caller_user_id else "declined"
        else:
            status = "ended"
        _finish(db, call, status, current_user.id)
        if status == "cancelled" and call.callee_user_id:
            caller_name = _first(current_user, "your trip")
            notify(db, call.callee_user_id, f"Missed call from {caller_name}",
                   "Open EkiMove to call back or send a message.",
                   url=_trip_url(db, call, call.callee_user_id), tag=f"call-{call.id}", ttl=3600)
    db.commit()
    return {"call": call_view(db, call, current_user)}
