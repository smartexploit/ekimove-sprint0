"""Passenger cancellations with a short free window and a fixed late fee.

* Before a driver is assigned, and for ``cancellation_free_seconds`` after,
  cancelling is free.
* Later, while the driver is still on the way, a paid ride keeps a fixed fee
  (motorcycle or car rate, never more than the fare) for the driver's time;
  the rest is recorded as a refund for admins to send back.
* An unpaid ride has nothing to collect from, so it is cancelled free.
* Once the trip has started it cannot be cancelled here (use SOS/support).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.config import settings
from app.database import get_db
from app.earnings import record_cancellation_earning
from app.models import AuditLog, Payment, Ride, RideRequest, User

router = APIRouter(prefix="/api/v1", tags=["cancellations"])

MOTORCYCLE_TYPES = {"motorcycle", "motorbike"}
CANCELLABLE_RIDE_STATUSES = ("assigned", "driver_arriving")
CENT = Decimal("0.01")


class CancelRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    reason: str | None = Field(default=None, max_length=300)


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def late_fee_for(vehicle_type: str) -> Decimal:
    amount = (
        settings.cancellation_fee_motorcycle
        if str(vehicle_type).lower() in MOTORCYCLE_TYPES
        else settings.cancellation_fee_car
    )
    return Decimal(max(amount, 0)).quantize(CENT)


def cancellation_terms(
    ride_request: RideRequest, ride: Ride | None, payment: Payment | None, now: datetime
) -> dict:
    base = {
        "request_id": ride_request.id,
        "ride_id": ride.id if ride else None,
        "currency": "NGN",
        "paid": bool(payment and payment.status == "confirmed"),
        "fee": "0.00",
        "refund": "0.00",
        "free_until": None,
    }

    if ride_request.status == "cancelled" or (ride and ride.status == "cancelled"):
        return {**base, "can_cancel": False, "message": "This ride is already cancelled."}

    if ride is None:
        if ride_request.status in ("quote_requested", "quoted"):
            return {**base, "can_cancel": True, "message": "Nothing has been booked yet, so cancelling is free."}
        if ride_request.status != "requested":
            return {**base, "can_cancel": False, "message": "This booking can no longer be cancelled."}
        return {**base, "can_cancel": True, "message": "No driver yet, so cancelling is free."}

    if ride.status not in CANCELLABLE_RIDE_STATUSES:
        return {
            **base,
            "can_cancel": False,
            "message": "The trip has already started. Use SOS or contact support if something is wrong.",
        }

    assigned_at = _as_utc(ride.assigned_at) or now
    free_until = assigned_at + timedelta(seconds=settings.cancellation_free_seconds)
    paid_amount = Decimal(payment.amount).quantize(CENT) if base["paid"] else Decimal("0.00")
    terms = {**base, "can_cancel": True, "free_until": free_until.isoformat()}

    if now <= free_until:
        return {**terms, "refund": str(paid_amount),
                "message": "You're still inside the free cancellation window."}

    if not base["paid"]:
        return {**terms, "message": "Your ride isn't paid yet, so cancelling is free."}

    fee = min(late_fee_for(ride_request.vehicle_type), paid_amount)
    refund = paid_amount - fee
    return {
        **terms,
        "fee": str(fee),
        "refund": str(refund),
        "message": f"Your driver is already on the way, so ₦{fee:,.0f} goes to them for their time.",
    }


def _load(request_id: int, user: User, db: Session):
    if user.role != "passenger":
        raise HTTPException(status_code=403, detail="Only passengers can cancel their rides.")
    ride_request = db.get(RideRequest, request_id)
    if ride_request is None or ride_request.passenger_user_id != user.id:
        raise HTTPException(status_code=404, detail="Ride not found.")
    ride = db.scalar(select(Ride).where(Ride.request_id == ride_request.id))
    payment = db.scalar(select(Payment).where(Payment.ride_id == ride.id)) if ride else None
    return ride_request, ride, payment


@router.get("/ride-requests/{request_id}/cancel-preview")
def preview_cancellation(
    request_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    ride_request, ride, payment = _load(request_id, current_user, db)
    return cancellation_terms(ride_request, ride, payment, datetime.now(timezone.utc))


@router.post("/ride-requests/{request_id}/cancel")
def cancel_ride(
    request_id: int,
    payload: CancelRequest | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    ride_request, ride, payment = _load(request_id, current_user, db)
    now = datetime.now(timezone.utc)
    terms = cancellation_terms(ride_request, ride, payment, now)
    if not terms["can_cancel"]:
        raise HTTPException(status_code=409, detail=terms["message"])

    ride_request.status = "cancelled"
    fee = Decimal(terms["fee"])
    refund = Decimal(terms["refund"])
    if ride is not None:
        ride.status = "cancelled"
        ride.cancelled_at = now
        ride.cancelled_by_user_id = current_user.id
        ride.cancellation_fee = fee
        if payment is not None and terms["paid"] and refund > 0:
            payment.refund_amount = refund
            payment.refund_status = "due"
        if terms["paid"] and fee > 0:
            # The kept fee goes to the driver, minus commission.
            record_cancellation_earning(db, ride, fee)

    reason = (payload.reason if payload else None) or "No reason given"
    db.add(
        AuditLog(
            actor_user_id=current_user.id,
            action="ride.cancelled_by_passenger",
            entity_type="ride_request",
            entity_id=str(ride_request.id),
            details=f"Fee NGN {fee}, refund NGN {refund}. Reason: {reason}",
        )
    )
    db.commit()
    return {**terms, "can_cancel": False, "cancelled": True, "status": "cancelled"}
