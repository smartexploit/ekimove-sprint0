"""In-app chat between passengers or drivers and EkiMove support."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import get_current_user, require_super_admin
from app.database import get_db
from app.models import RideRequest, SupportMessage, SupportThread, User

router = APIRouter(prefix="/api/v1", tags=["support"])


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _unread(db: Session, thread: SupportThread, for_staff: bool) -> int:
    since = thread.staff_last_read_at if for_staff else thread.user_last_read_at
    query = select(func.count(SupportMessage.id)).where(
        SupportMessage.thread_id == thread.id,
        SupportMessage.from_staff.is_(not for_staff),
    )
    if since is not None:
        query = query.where(SupportMessage.created_at > since)
    return db.scalar(query) or 0


def thread_summary(db: Session, thread: SupportThread, for_staff: bool) -> dict:
    last = db.scalar(select(SupportMessage).where(SupportMessage.thread_id == thread.id)
                     .order_by(SupportMessage.id.desc()).limit(1))
    result = {
        "id": thread.id,
        "subject": thread.subject,
        "status": thread.status,
        "ride_request_id": thread.ride_request_id,
        "created_at": _iso(thread.created_at),
        "last_message_at": _iso(thread.last_message_at),
        "last_message": (last.body[:140] if last else None),
        "last_from_staff": bool(last and last.from_staff),
        "unread": _unread(db, thread, for_staff),
    }
    if for_staff:
        user = db.get(User, thread.user_id)
        result["user"] = ({"id": user.id, "name": user.full_name, "phone": user.phone, "role": user.role}
                          if user else None)
    return result


def thread_detail(db: Session, thread: SupportThread, for_staff: bool) -> dict:
    messages = db.scalars(select(SupportMessage).where(SupportMessage.thread_id == thread.id)
                          .order_by(SupportMessage.created_at, SupportMessage.id)).all()
    names = {}
    out = []
    for message in messages:
        sender = None
        if message.sender_user_id:
            if message.sender_user_id not in names:
                user = db.get(User, message.sender_user_id)
                names[message.sender_user_id] = user.full_name if user else None
            sender = names[message.sender_user_id]
        out.append({
            "id": message.id,
            "body": message.body,
            "from_staff": message.from_staff,
            "sender_name": ("EkiMove support" if message.from_staff and not for_staff else sender),
            "created_at": _iso(message.created_at),
        })
    request = db.get(RideRequest, thread.ride_request_id) if thread.ride_request_id else None
    return {
        **thread_summary(db, thread, for_staff),
        "messages": out,
        "ride_request": (
            {"id": request.id, "service_type": request.service_type, "status": request.status,
             "vehicle_type": request.vehicle_type, "route": f"{request.origin_text} → {request.destination_text}",
             "quoted_fare": str(request.quoted_fare), "quote_terms": request.quote_terms}
            if request else None
        ),
    }


def post_message(db: Session, thread: SupportThread, sender: User | None, body: str, from_staff: bool) -> SupportMessage:
    now = _now()
    message = SupportMessage(thread_id=thread.id, sender_user_id=sender.id if sender else None,
                             from_staff=from_staff, body=body, created_at=now)
    db.add(message)
    thread.last_message_at = now
    if from_staff:
        thread.staff_last_read_at = now
    else:
        thread.user_last_read_at = now
        thread.status = "open"  # a customer writing again reopens the chat
    return message


def open_thread(db: Session, user: User, subject: str, first_message: str,
                ride_request_id: int | None = None) -> SupportThread:
    now = _now()
    thread = SupportThread(user_id=user.id, subject=subject[:160], status="open",
                           ride_request_id=ride_request_id, created_at=now, last_message_at=now)
    db.add(thread)
    db.flush()
    post_message(db, thread, user, first_message, from_staff=False)
    return thread


# --------------------------------------------------------------------------
# Customer side
# --------------------------------------------------------------------------


class NewThread(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    subject: str = Field(min_length=3, max_length=160)
    message: str = Field(min_length=1, max_length=2000)
    ride_request_id: int | None = Field(default=None, gt=0)


class NewMessage(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    body: str = Field(min_length=1, max_length=2000)


def _own_thread(db: Session, thread_id: int, user: User) -> SupportThread:
    thread = db.get(SupportThread, thread_id)
    if thread is None or thread.user_id != user.id:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    return thread


def _no_admins(user: User) -> None:
    if user.role == "super_admin":
        raise HTTPException(status_code=403, detail="Use the support inbox in the admin console.")


@router.get("/support/threads")
def my_threads(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[dict]:
    _no_admins(current_user)
    threads = db.scalars(select(SupportThread).where(SupportThread.user_id == current_user.id)
                         .order_by(SupportThread.last_message_at.desc()).limit(50)).all()
    return [thread_summary(db, t, for_staff=False) for t in threads]


@router.post("/support/threads", status_code=201)
def start_thread(payload: NewThread, current_user: User = Depends(get_current_user),
                 db: Session = Depends(get_db)) -> dict:
    _no_admins(current_user)
    if payload.ride_request_id is not None:
        request = db.get(RideRequest, payload.ride_request_id)
        if request is None or request.passenger_user_id != current_user.id:
            raise HTTPException(status_code=404, detail="Ride not found.")
    thread = open_thread(db, current_user, payload.subject, payload.message, payload.ride_request_id)
    db.commit()
    return thread_detail(db, thread, for_staff=False)


@router.get("/support/threads/{thread_id}")
def read_thread(thread_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    thread = _own_thread(db, thread_id, current_user)
    thread.user_last_read_at = _now()
    db.commit()
    return thread_detail(db, thread, for_staff=False)


@router.post("/support/threads/{thread_id}/messages", status_code=201)
def reply(thread_id: int, payload: NewMessage, current_user: User = Depends(get_current_user),
          db: Session = Depends(get_db)) -> dict:
    thread = _own_thread(db, thread_id, current_user)
    post_message(db, thread, current_user, payload.body, from_staff=False)
    db.commit()
    return thread_detail(db, thread, for_staff=False)


@router.get("/support/unread")
def my_unread(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    if current_user.role == "super_admin":
        threads = db.scalars(select(SupportThread).where(SupportThread.status == "open")).all()
        return {"unread": sum(1 for t in threads if _unread(db, t, for_staff=True))}
    threads = db.scalars(select(SupportThread).where(SupportThread.user_id == current_user.id)).all()
    return {"unread": sum(1 for t in threads if _unread(db, t, for_staff=False))}


# --------------------------------------------------------------------------
# Support team (super-admin)
# --------------------------------------------------------------------------


@router.get("/admin/support/threads")
def staff_threads(
    status: Literal["open", "closed", "all"] = Query("open"),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_super_admin),
) -> list[dict]:
    query = select(SupportThread)
    if status != "all":
        query = query.where(SupportThread.status == status)
    threads = db.scalars(query.order_by(SupportThread.last_message_at.desc()).limit(200)).all()
    rows = [thread_summary(db, t, for_staff=True) for t in threads]
    # Conversations waiting for a reply first, newest first within each group.
    rows.sort(key=lambda r: r["last_message_at"] or "", reverse=True)
    rows.sort(key=lambda r: r["unread"] == 0)
    return rows


@router.get("/admin/support/threads/{thread_id}")
def staff_read_thread(thread_id: int, db: Session = Depends(get_db),
                      _admin: User = Depends(require_super_admin)) -> dict:
    thread = db.get(SupportThread, thread_id)
    if thread is None:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    thread.staff_last_read_at = _now()
    db.commit()
    return thread_detail(db, thread, for_staff=True)


@router.post("/admin/support/threads/{thread_id}/messages", status_code=201)
def staff_reply(thread_id: int, payload: NewMessage, db: Session = Depends(get_db),
                admin: User = Depends(require_super_admin)) -> dict:
    thread = db.get(SupportThread, thread_id)
    if thread is None:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    post_message(db, thread, admin, payload.body, from_staff=True)
    db.commit()
    return thread_detail(db, thread, for_staff=True)


class ThreadStatus(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["open", "closed"]


@router.post("/admin/support/threads/{thread_id}/status")
def staff_set_status(thread_id: int, payload: ThreadStatus, db: Session = Depends(get_db),
                     _admin: User = Depends(require_super_admin)) -> dict:
    thread = db.get(SupportThread, thread_id)
    if thread is None:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    thread.status = payload.status
    db.commit()
    return thread_detail(db, thread, for_staff=True)
