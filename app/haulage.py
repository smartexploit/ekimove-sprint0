"""Loads and luggage: big cars, vans and dyna trucks, priced by quote.

1. The customer describes the load and route; a support chat opens with it.
2. EkiMove support agrees the price and terms in that chat and sends a quote.
3. The customer accepts (the job joins the normal dispatch queue, then is
   paid through EkiMove like any ride once a driver is assigned) or declines.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.app_settings import HAULAGE_TYPES
from app.auth import get_current_user, require_super_admin
from app.database import get_db
from app.models import AuditLog, RideRequest, SupportThread, User
from app.support import open_thread, post_message

router = APIRouter(prefix="/api/v1", tags=["haulage"])


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def haulage_result(db: Session, request: RideRequest) -> dict:
    thread = db.scalar(select(SupportThread).where(SupportThread.ride_request_id == request.id)
                       .order_by(SupportThread.id).limit(1))
    return {
        "id": request.id,
        "service_type": request.service_type,
        "vehicle_type": request.vehicle_type,
        "vehicle_label": HAULAGE_TYPES.get(request.vehicle_type, request.vehicle_type),
        "origin_text": request.origin_text,
        "destination_text": request.destination_text,
        "load_description": request.load_description,
        "scheduled_for": _iso(request.scheduled_for),
        "status": request.status,
        "quoted_fare": str(request.quoted_fare) if request.quoted_at else None,
        "quote_terms": request.quote_terms,
        "quoted_at": _iso(request.quoted_at),
        "created_at": _iso(request.created_at),
        "support_thread_id": thread.id if thread else None,
    }


class HaulageCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    vehicle_type: Literal["big_car", "van", "dyna"]
    origin_text: str = Field(min_length=3, max_length=255)
    destination_text: str = Field(min_length=3, max_length=255)
    load_description: str = Field(min_length=5, max_length=1500)
    scheduled_for: datetime | None = None


@router.post("/haulage-requests", status_code=201)
def create_haulage_request(
    payload: HaulageCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    if current_user.role != "passenger":
        raise HTTPException(status_code=403, detail="Only passenger accounts can book a load.")
    scheduled = payload.scheduled_for
    if scheduled is not None and scheduled.tzinfo is None:
        scheduled = scheduled.replace(tzinfo=timezone.utc)
    request = RideRequest(
        passenger_user_id=current_user.id,
        origin_text=payload.origin_text,
        destination_text=payload.destination_text,
        vehicle_type=payload.vehicle_type,
        passenger_count=1,
        quoted_fare=Decimal("0.00"),
        status="quote_requested",
        service_type="haulage",
        load_description=payload.load_description,
        scheduled_for=scheduled,
    )
    db.add(request)
    db.flush()
    when = f"\nWhen: {scheduled.isoformat(timespec='minutes')}" if scheduled else ""
    open_thread(
        db, current_user,
        subject=f"Load booking #{request.id}: {HAULAGE_TYPES[payload.vehicle_type]}",
        first_message=(f"I need a {HAULAGE_TYPES[payload.vehicle_type].lower()}.\n"
                       f"From: {payload.origin_text}\nTo: {payload.destination_text}{when}\n"
                       f"Load: {payload.load_description}"),
        ride_request_id=request.id,
    )
    db.add(AuditLog(actor_user_id=current_user.id, action="haulage.requested", entity_type="ride_request",
                    entity_id=str(request.id), details=f"{payload.vehicle_type}: {payload.origin_text} → {payload.destination_text}"))
    db.commit()
    return haulage_result(db, request)


@router.get("/haulage-requests")
def my_haulage_requests(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[dict]:
    requests = db.scalars(select(RideRequest).where(RideRequest.passenger_user_id == current_user.id,
                                                    RideRequest.service_type == "haulage")
                          .order_by(RideRequest.id.desc()).limit(50)).all()
    return [haulage_result(db, r) for r in requests]


def _own_quoted(db: Session, request_id: int, user: User) -> RideRequest:
    request = db.get(RideRequest, request_id)
    if request is None or request.passenger_user_id != user.id or request.service_type != "haulage":
        raise HTTPException(status_code=404, detail="Load booking not found.")
    if request.status != "quoted":
        raise HTTPException(status_code=409, detail="There's no quote waiting for your answer on this booking.")
    return request


def _thread_for(db: Session, request: RideRequest) -> SupportThread | None:
    return db.scalar(select(SupportThread).where(SupportThread.ride_request_id == request.id)
                     .order_by(SupportThread.id).limit(1))


@router.post("/haulage-requests/{request_id}/accept")
def accept_quote(request_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    request = _own_quoted(db, request_id, current_user)
    request.status = "requested"  # now waits for a driver like any booking
    thread = _thread_for(db, request)
    if thread is not None:
        post_message(db, thread, current_user, f"I accept the quote of ₦{request.quoted_fare:,.0f}.", from_staff=False)
    db.add(AuditLog(actor_user_id=current_user.id, action="haulage.quote_accepted", entity_type="ride_request",
                    entity_id=str(request.id), details=f"NGN {request.quoted_fare}"))
    db.commit()
    return haulage_result(db, request)


@router.post("/haulage-requests/{request_id}/decline")
def decline_quote(request_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    request = _own_quoted(db, request_id, current_user)
    request.status = "cancelled"
    thread = _thread_for(db, request)
    if thread is not None:
        post_message(db, thread, current_user, "I've declined this quote.", from_staff=False)
    db.add(AuditLog(actor_user_id=current_user.id, action="haulage.quote_declined", entity_type="ride_request",
                    entity_id=str(request.id), details=f"NGN {request.quoted_fare}"))
    db.commit()
    return haulage_result(db, request)


# --------------------------------------------------------------------------
# Admin: quotes
# --------------------------------------------------------------------------


@router.get("/admin/haulage-requests")
def admin_haulage_requests(
    status: Literal["quote_requested", "quoted", "requested", "all"] = Query("quote_requested"),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_super_admin),
) -> list[dict]:
    query = select(RideRequest).where(RideRequest.service_type == "haulage")
    if status != "all":
        query = query.where(RideRequest.status == status)
    requests = db.scalars(query.order_by(RideRequest.id.desc()).limit(200)).all()
    rows = []
    for request in requests:
        customer = db.get(User, request.passenger_user_id)
        rows.append({**haulage_result(db, request),
                     "customer": {"id": customer.id, "name": customer.full_name, "phone": customer.phone}
                     if customer else None})
    return rows


class QuoteInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    amount: Decimal = Field(gt=0, le=Decimal("5000000"), decimal_places=2)
    terms: str = Field(min_length=3, max_length=1500)


@router.post("/admin/haulage-requests/{request_id}/quote")
def admin_send_quote(request_id: int, payload: QuoteInput, db: Session = Depends(get_db),
                     admin: User = Depends(require_super_admin)) -> dict:
    request = db.get(RideRequest, request_id)
    if request is None or request.service_type != "haulage":
        raise HTTPException(status_code=404, detail="Load booking not found.")
    if request.status not in ("quote_requested", "quoted"):
        raise HTTPException(status_code=409, detail="This booking is past the quote stage.")
    request.quoted_fare = payload.amount
    request.quote_terms = payload.terms
    request.quoted_at = datetime.now(timezone.utc)
    request.status = "quoted"
    thread = _thread_for(db, request)
    if thread is not None:
        post_message(db, thread, admin,
                     f"Quote for your load: ₦{payload.amount:,.0f}.\nTerms: {payload.terms}\n"
                     "Accept it on the Move a load page to book. You'll pay through EkiMove once a driver is assigned.",
                     from_staff=True)
    db.add(AuditLog(actor_user_id=admin.id, action="haulage.quoted", entity_type="ride_request",
                    entity_id=str(request.id), details=f"NGN {payload.amount}: {payload.terms}"))
    db.commit()
    return haulage_result(db, request)
