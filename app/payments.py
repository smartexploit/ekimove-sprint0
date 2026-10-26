from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import get_current_user, require_super_admin
from app.database import get_db
from app.models import AuditLog, Payment, Ride, RideRequest, User

router = APIRouter(prefix="/api/v1", tags=["payments"])


class TransferReference(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    transfer_reference: str = Field(min_length=3, max_length=120)


class ReconciliationDecision(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    decision: str
    reason: str = Field(min_length=3, max_length=500)


def payment_result(payment: Payment) -> dict:
    return {
        "id": payment.id,
        "ride_id": payment.ride_id,
        "amount": str(payment.amount),
        "currency": "NGN",
        "method": payment.method,
        "transfer_reference": payment.transfer_reference,
        "status": payment.status,
        "confirmed_at": (
            payment.confirmed_at.isoformat()
            if payment.confirmed_at else None
        ),
        "created_at": (
            payment.created_at.isoformat()
            if payment.created_at else None
        ),
    }


def get_owned_ride(
    ride_id: int, user: User, db: Session
) -> Ride:
    ride = db.get(Ride, ride_id)
    if not ride:
        raise HTTPException(status_code=404, detail="Ride not found.")

    request = db.get(RideRequest, ride.request_id)
    if not request or request.passenger_user_id != user.id:
        raise HTTPException(status_code=404, detail="Ride not found.")

    return ride


def record_audit(
    db: Session,
    actor_id: int,
    action: str,
    payment: Payment,
    details: str,
) -> None:
    db.add(AuditLog(
        actor_user_id=actor_id,
        action=action,
        entity_type="payment",
        entity_id=str(payment.id),
        details=details,
    ))


@router.post("/payments/rides/{ride_id}/initiate")
def initiate_payment(
    ride_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    if user.role != "passenger":
        raise HTTPException(status_code=403, detail="Passenger access required.")

    ride = get_owned_ride(ride_id, user, db)

    if ride.status in ("cancelled", "incident_review"):
        raise HTTPException(
            status_code=409,
            detail="Payment cannot be initiated for this ride status.",
        )

    existing = db.scalar(
        select(Payment).where(Payment.ride_id == ride_id)
    )
    if existing:
        return payment_result(existing)

    payment = Payment(
        ride_id=ride.id,
        amount=Decimal(str(ride.agreed_fare)),
        method="bank_transfer",
        status="pending",
    )
    db.add(payment)

    try:
        db.flush()
        record_audit(
            db, user.id, "payment.initiated", payment,
            "Bank-transfer payment initiated.",
        )
        db.commit()
        db.refresh(payment)
    except IntegrityError:
        db.rollback()
        existing = db.scalar(
            select(Payment).where(Payment.ride_id == ride_id)
        )
        if existing:
            return payment_result(existing)
        raise HTTPException(
            status_code=409,
            detail="Payment could not be initiated; retry the request.",
        )

    return payment_result(payment)


@router.post("/payments/rides/{ride_id}/submit-transfer")
def submit_transfer_reference(
    ride_id: int,
    payload: TransferReference,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    if user.role != "passenger":
        raise HTTPException(status_code=403, detail="Passenger access required.")

    get_owned_ride(ride_id, user, db)
    payment = db.scalar(
        select(Payment).where(Payment.ride_id == ride_id)
    )

    if not payment:
        raise HTTPException(
            status_code=404,
            detail="Initiate the payment before submitting a transfer reference.",
        )

    if payment.status not in ("pending", "rejected"):
        raise HTTPException(
            status_code=409,
            detail="This payment can no longer accept a transfer reference.",
        )

    reference = payload.transfer_reference.strip()
    if not reference:
        raise HTTPException(status_code=422, detail="Transfer reference is required.")

    payment.transfer_reference = reference
    payment.status = "awaiting_confirmation"
    payment.confirmed_by_user_id = None
    payment.confirmed_at = None

    record_audit(
        db, user.id, "payment.transfer_submitted", payment,
        "Passenger submitted a transfer reference; verification is required.",
    )
    db.commit()
    db.refresh(payment)
    return payment_result(payment)


@router.get("/payments/rides/{ride_id}")
def get_payment_status(
    ride_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    ride = db.get(Ride, ride_id)
    if not ride:
        raise HTTPException(status_code=404, detail="Ride not found.")

    request = db.get(RideRequest, ride.request_id)
    if user.role != "super_admin" and (
        not request or request.passenger_user_id != user.id
    ):
        raise HTTPException(status_code=404, detail="Ride not found.")

    payment = db.scalar(
        select(Payment).where(Payment.ride_id == ride_id)
    )
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found.")

    return payment_result(payment)


@router.post("/admin/payments/{payment_id}/reconcile")
def reconcile_payment(
    payment_id: int,
    payload: ReconciliationDecision,
    db: Session = Depends(get_db),
    admin: User = Depends(require_super_admin),
) -> dict:
    decision = payload.decision.strip().lower()
    if decision not in ("confirm", "reject"):
        raise HTTPException(
            status_code=422,
            detail="Decision must be 'confirm' or 'reject'.",
        )

    payment = db.get(Payment, payment_id)
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found.")

    if payment.status != "awaiting_confirmation":
        raise HTTPException(
            status_code=409,
            detail="Only payments awaiting confirmation can be reconciled.",
        )

    if not payment.transfer_reference:
        raise HTTPException(
            status_code=409,
            detail="A transfer reference is required before reconciliation.",
        )

    if decision == "confirm":
        # The administrator must independently verify the actual bank
        # transaction before choosing confirm. A reference alone is not proof.
        payment.status = "confirmed"
        payment.confirmed_by_user_id = admin.id
        payment.confirmed_at = datetime.now(timezone.utc)
        action = "payment.confirmed"
    else:
        payment.status = "rejected"
        payment.confirmed_by_user_id = None
        payment.confirmed_at = None
        action = "payment.rejected"

    record_audit(
        db, admin.id, action, payment,
        f"Admin reconciliation: {decision}. Reason: {payload.reason.strip()}",
    )
    db.commit()
    db.refresh(payment)
    return payment_result(payment)

@router.get("/admin/payments/pending")
def list_pending_payments(
    db: Session = Depends(get_db),
    admin: User = Depends(require_super_admin),
) -> list[dict]:
    payments = db.scalars(
        select(Payment)
        .where(Payment.status == "awaiting_confirmation")
        .order_by(Payment.created_at.desc(), Payment.id.desc())
    ).all()

    return [payment_result(payment) for payment in payments]
