from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
import re
from pydantic import BaseModel, Field, field_validator
from uuid import uuid4

import requests
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.config import settings
from app.database import get_db
from app.models import AuditLog, Payment, Ride, RideRequest, User

router = APIRouter(prefix="/api/v1/payments", tags=["interswitch"])


class InterswitchInitiateRequest(BaseModel):
    customer_email: str = Field(min_length=5, max_length=254)

    @field_validator("customer_email")
    @classmethod
    def validate_customer_email(cls, value: str) -> str:
        value = value.strip()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
            raise ValueError("Enter a valid email address.")
        return value


def _owned_ride(ride_id: int, user: User, db: Session) -> Ride:
    ride = db.get(Ride, ride_id)
    if not ride:
        raise HTTPException(status_code=404, detail="Ride not found.")

    request = db.get(RideRequest, ride.request_id)
    if not request or request.passenger_user_id != user.id:
        raise HTTPException(status_code=404, detail="Ride not found.")

    return ride


def _result(payment: Payment) -> dict:
    return {
        "id": payment.id,
        "ride_id": payment.ride_id,
        "amount": str(payment.amount),
        "currency": "NGN",
        "method": payment.method,
        "status": payment.status,
        "provider_transaction_ref": payment.provider_transaction_ref,
        "confirmed_at": (
            payment.confirmed_at.isoformat() if payment.confirmed_at else None
        ),
    }


@router.post("/rides/{ride_id}/interswitch/initiate")
def initiate_interswitch(
    ride_id: int,
    payload: InterswitchInitiateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    if user.role != "passenger":
        raise HTTPException(status_code=403, detail="Passenger access required.")

    if not settings.interswitch_merchant_code or not settings.interswitch_pay_item_id:
        raise HTTPException(
            status_code=503,
            detail="Interswitch checkout is not configured on the server.",
        )

    mode = settings.interswitch_mode.strip().upper()
    if mode not in ("TEST", "LIVE"):
        raise HTTPException(status_code=503, detail="Invalid Interswitch mode.")

    ride = _owned_ride(ride_id, user, db)
    if ride.status in ("cancelled", "incident_review", "completed"):
        raise HTTPException(status_code=409, detail="This ride cannot be paid.")

    payment = db.scalar(select(Payment).where(Payment.ride_id == ride_id))
    if payment:
        if payment.method != "interswitch":
            raise HTTPException(
                status_code=409,
                detail="A bank-transfer payment already exists for this ride. "
                       "Resolve that payment before choosing Interswitch.",
            )
        if payment.status in ("confirmed", "refunded"):
            return {"payment": _result(payment), "checkout": None}

        # Reuse the existing reference; do not create a second payment.
        reference = payment.provider_transaction_ref
        if not reference:
            reference = f"EKIMOVE-{ride.id}-{uuid4().hex[:16].upper()}"
            payment.provider_transaction_ref = reference
            db.commit()
            db.refresh(payment)
    else:
        reference = f"EKIMOVE-{ride.id}-{uuid4().hex[:16].upper()}"
        payment = Payment(
            ride_id=ride.id,
            amount=Decimal(str(ride.agreed_fare)).quantize(Decimal("0.01")),
            method="interswitch",
            status="pending",
            provider_transaction_ref=reference,
        )
        db.add(payment)
        db.flush()
        db.add(AuditLog(
            actor_user_id=user.id,
            action="payment.interswitch_initiated",
            entity_type="payment",
            entity_id=str(payment.id),
            details="Interswitch checkout initiated; provider verification required.",
        ))
        db.commit()
        db.refresh(payment)

    amount_kobo = int(
        (Decimal(str(payment.amount)) * 100).quantize(
            Decimal("1"), rounding=ROUND_HALF_UP
        )
    )
    return {
        "payment": _result(payment),
        "checkout": {
            "merchant_code": settings.interswitch_merchant_code,
            "pay_item_id": settings.interswitch_pay_item_id,
            "txn_ref": reference,
            "amount": amount_kobo,
            "currency": "566",
            "mode": mode,
            "customer_email": payload.customer_email,
            "redirect_url": (
                "https://newwebpay.interswitchng.com/collections/w/pay"
                if mode == "LIVE"
                else "https://newwebpay-sandbox.interswitchng.com/collections/w/pay"
            ),
        },
    }


@router.post("/rides/{ride_id}/interswitch/verify")
def verify_interswitch(
    ride_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    if user.role != "passenger":
        raise HTTPException(status_code=403, detail="Passenger access required.")

    _owned_ride(ride_id, user, db)
    payment = db.scalar(select(Payment).where(Payment.ride_id == ride_id))

    if not payment or payment.method != "interswitch":
        raise HTTPException(status_code=404, detail="Interswitch payment not found.")

    if payment.status == "confirmed":
        return _result(payment)

    if not payment.provider_transaction_ref:
        raise HTTPException(status_code=409, detail="Transaction reference is missing.")

    if not settings.interswitch_merchant_code:
        raise HTTPException(status_code=503, detail="Interswitch is not configured.")

    amount_kobo = int(
        (Decimal(str(payment.amount)) * 100).quantize(
            Decimal("1"), rounding=ROUND_HALF_UP
        )
    )

    mode = settings.interswitch_mode.strip().upper()
    if mode not in ("TEST", "LIVE"):
        raise HTTPException(status_code=503, detail="Invalid Interswitch mode.")

    requery_url = (
        settings.interswitch_live_requery_base_url
        if mode == "LIVE"
        else settings.interswitch_requery_base_url
    )

    try:
        response = requests.get(
            requery_url,
            params={
                "merchantcode": settings.interswitch_merchant_code,
                "transactionreference": payment.provider_transaction_ref,
                "amount": amount_kobo,
            },
            timeout=12,
        )
        response.raise_for_status()
        result = response.json()
    except (requests.RequestException, ValueError):
        raise HTTPException(
            status_code=502,
            detail="Unable to verify with Interswitch. Check the status and retry.",
        )

    # A successful HTTP response alone is not evidence of payment.
    if not isinstance(result, dict):
        raise HTTPException(status_code=502, detail="Invalid provider response.")

    response_code = str(result.get("ResponseCode", "")).strip()
    returned_reference = str(result.get("MerchantReference", "")).strip()
    try:
        provider_amount = int(str(result.get("Amount", "")).strip())
    except (ValueError, TypeError):
        provider_amount = -1

    if (
        response_code != "00"
        or provider_amount != amount_kobo
        or returned_reference != payment.provider_transaction_ref
    ):
        raise HTTPException(
            status_code=409,
            detail="Payment has not been verified. Check status and retry later.",
        )

    # Atomically confirm only if another request has not already done so.
    confirmation_time = datetime.now(timezone.utc)
    confirmation = db.execute(
        update(Payment)
        .where(
            Payment.id == payment.id,
            Payment.status.in_(("pending", "awaiting_confirmation")),
        )
        .values(
            status="confirmed",
            confirmed_at=confirmation_time,
        )
    )

    if confirmation.rowcount == 1:
        db.add(AuditLog(
            actor_user_id=user.id,
            action="payment.interswitch_verified",
            entity_type="payment",
            entity_id=str(payment.id),
            details="Provider requery returned success and matching amount.",
        ))
        db.commit()
    else:
        db.rollback()

    # Read the committed state instead of returning a potentially stale ORM object.
    confirmed_payment = db.scalar(
        select(Payment).where(Payment.id == payment.id)
    )
    if not confirmed_payment:
        raise HTTPException(
            status_code=404,
            detail="Interswitch payment not found.",
        )

    if confirmed_payment.status != "confirmed":
        raise HTTPException(
            status_code=409,
            detail="Payment state changed before confirmation. Check status and retry.",
        )

    return _result(confirmed_payment)
