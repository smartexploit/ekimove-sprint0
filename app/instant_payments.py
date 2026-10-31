"""Instant bank-transfer payments through Paystack dedicated virtual accounts.

Every passenger can get a personal account number. When money lands in it,
Paystack sends a signed ``charge.success`` webhook; the transaction is
re-verified with Paystack and then matched to the passenger's oldest unpaid
ride with exactly that fare, which confirms the payment with no staff step.
Anything that cannot be matched is kept as an unmatched deposit for admins.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Literal

import requests
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import get_current_user, require_super_admin
from app.config import settings
from app.database import get_db
from app.models import (
    AuditLog,
    BankDeposit,
    PassengerVirtualAccount,
    Payment,
    Ride,
    RideRequest,
    User,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["instant payments"])

PAYABLE_RIDE_STATUSES = ("assigned", "driver_arriving")
MATCHABLE_PAYMENT_STATUSES = ("pending", "awaiting_confirmation", "rejected")
PAYSTACK_TIMEOUT = (5, 20)


class PaystackError(Exception):
    """Paystack could not be reached or refused the request."""


def instant_transfers_enabled() -> bool:
    return bool(settings.paystack_secret_key)


def _paystack(method: str, path: str, payload: dict | None = None) -> dict:
    try:
        response = requests.request(
            method,
            f"{settings.paystack_base_url.rstrip('/')}{path}",
            json=payload,
            headers={
                "Authorization": f"Bearer {settings.paystack_secret_key}",
                "Content-Type": "application/json",
            },
            timeout=PAYSTACK_TIMEOUT,
        )
        body = response.json()
    except (requests.RequestException, ValueError) as exc:
        logger.warning("Paystack %s %s failed: %s", method, path, type(exc).__name__)
        raise PaystackError("Paystack is not reachable right now.") from None

    if response.status_code >= 400 or not body.get("status"):
        message = str(body.get("message") or "Paystack refused the request.")[:200]
        logger.warning("Paystack %s %s returned %s: %s", method, path, response.status_code, message)
        raise PaystackError(message)
    return body.get("data") or {}


def _naira_from_kobo(value) -> Decimal:
    try:
        return (Decimal(str(value)) / Decimal(100)).quantize(Decimal("0.01"))
    except (InvalidOperation, TypeError):
        raise PaystackError("Paystack sent an unreadable amount.") from None


def _international_phone(phone: str) -> str:
    digits = "".join(ch for ch in phone if ch.isdigit())
    if digits.startswith("234"):
        return f"+{digits}"
    if digits.startswith("0"):
        return f"+234{digits[1:]}"
    return f"+{digits}"


def _account_result(account: PassengerVirtualAccount | None) -> dict | None:
    if account is None:
        return None
    return {
        "bank_name": account.bank_name,
        "account_number": account.account_number,
        "account_name": account.account_name,
        "active": account.is_active,
    }


def _audit(db: Session, actor_id: int | None, action: str, entity_type: str, entity_id, details: str) -> None:
    db.add(
        AuditLog(
            actor_user_id=actor_id,
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id),
            details=details,
        )
    )


# --------------------------------------------------------------------------
# Passenger: personal account number
# --------------------------------------------------------------------------


class VirtualAccountConsent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    consent: Literal[True]


@router.get("/payments/virtual-account")
def get_my_virtual_account(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    if current_user.role != "passenger":
        raise HTTPException(status_code=403, detail="Only passengers have a payment account.")
    account = db.scalar(
        select(PassengerVirtualAccount).where(PassengerVirtualAccount.user_id == current_user.id)
    )
    return {"enabled": instant_transfers_enabled(), "account": _account_result(account)}


@router.post("/payments/virtual-account", status_code=201)
def create_my_virtual_account(
    payload: VirtualAccountConsent,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    if current_user.role != "passenger":
        raise HTTPException(status_code=403, detail="Only passengers have a payment account.")
    if not instant_transfers_enabled():
        raise HTTPException(status_code=503, detail="Instant transfers are not switched on yet.")

    existing = db.scalar(
        select(PassengerVirtualAccount).where(PassengerVirtualAccount.user_id == current_user.id)
    )
    if existing is not None:
        return {"enabled": True, "account": _account_result(existing)}

    names = (current_user.full_name or "").split()
    first_name = names[0] if names else "EkiMove"
    last_name = names[-1] if len(names) > 1 else first_name
    try:
        customer = _paystack(
            "POST",
            "/customer",
            {
                "email": f"passenger-{current_user.id}@{settings.paystack_customer_email_domain}",
                "first_name": first_name,
                "last_name": last_name,
                "phone": _international_phone(current_user.phone),
                "metadata": {"ekimove_user_id": current_user.id},
            },
        )
        customer_code = customer.get("customer_code")
        if not customer_code:
            raise PaystackError("Paystack did not return a customer.")
        dedicated = _paystack(
            "POST",
            "/dedicated_account",
            {"customer": customer_code, "preferred_bank": settings.paystack_preferred_bank},
        )
    except PaystackError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"We couldn't create your payment account right now. {exc}",
        ) from None

    account_number = str(dedicated.get("account_number") or "").strip()
    if not account_number:
        raise HTTPException(status_code=502, detail="Paystack did not return an account number.")

    account = PassengerVirtualAccount(
        user_id=current_user.id,
        provider="paystack",
        customer_code=customer_code,
        account_number=account_number,
        account_name=str(dedicated.get("account_name") or current_user.full_name)[:160],
        bank_name=str((dedicated.get("bank") or {}).get("name") or "Bank")[:120],
        is_active=bool(dedicated.get("active", True)),
    )
    db.add(account)
    _audit(db, current_user.id, "virtual_account.created", "user", current_user.id,
           "Passenger consented to and received a personal payment account.")
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        account = db.scalar(
            select(PassengerVirtualAccount).where(PassengerVirtualAccount.user_id == current_user.id)
        )
        if account is None:
            raise HTTPException(status_code=409, detail="This account number is already in use.") from None
    db.refresh(account)
    return {"enabled": True, "account": _account_result(account)}


# --------------------------------------------------------------------------
# Matching deposits to rides
# --------------------------------------------------------------------------


def confirm_payment_from_deposit(
    db: Session, payment: Payment, deposit: BankDeposit, actor_id: int | None, how: str
) -> None:
    now = datetime.now(timezone.utc)
    payment.method = "bank_transfer"
    payment.status = "confirmed"
    payment.transfer_reference = payment.transfer_reference or deposit.reference
    payment.provider_transaction_ref = f"{deposit.provider}:{deposit.reference}"
    payment.confirmed_by_user_id = actor_id
    payment.confirmed_at = now
    deposit.payment_id = payment.id
    deposit.status = "matched"
    _audit(db, actor_id, "payment.confirmed", "payment", payment.id,
           f"Payment confirmed {how} from deposit {deposit.reference} (NGN {deposit.amount}).")


def find_payment_for_deposit(db: Session, deposit: BankDeposit) -> Payment | None:
    """The passenger's oldest unpaid, still-active ride with exactly this fare."""
    if deposit.user_id is None:
        return None
    rows = db.execute(
        select(Ride, Payment)
        .join(RideRequest, Ride.request_id == RideRequest.id)
        .outerjoin(Payment, Payment.ride_id == Ride.id)
        .where(
            RideRequest.passenger_user_id == deposit.user_id,
            Ride.status.in_(PAYABLE_RIDE_STATUSES),
        )
        .order_by(Ride.id)
    ).all()
    for ride, payment in rows:
        if Decimal(ride.agreed_fare).quantize(Decimal("0.01")) != deposit.amount:
            continue
        if payment is None:
            payment = Payment(ride_id=ride.id, amount=ride.agreed_fare, method="bank_transfer", status="pending")
            db.add(payment)
            db.flush()
            return payment
        if payment.status in MATCHABLE_PAYMENT_STATUSES:
            return payment
    return None


@router.post("/payments/paystack/webhook", include_in_schema=False)
async def paystack_webhook(request: Request, db: Session = Depends(get_db)) -> dict:
    if not instant_transfers_enabled():
        raise HTTPException(status_code=503, detail="Instant transfers are not switched on.")

    raw = await request.body()
    expected = hmac.new(settings.paystack_secret_key.encode(), raw, hashlib.sha512).hexdigest()
    signature = request.headers.get("x-paystack-signature", "")
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(status_code=401, detail="Invalid signature.")

    try:
        event = json.loads(raw)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid JSON.") from None

    if str(event.get("event") or "").startswith("transfer."):
        from app.earnings import handle_transfer_event  # avoid an import cycle

        return handle_transfer_event(db, event)

    data = event.get("data") or {}
    if event.get("event") != "charge.success" or data.get("channel") != "dedicated_nuban":
        return {"status": "ignored"}

    reference = str(data.get("reference") or "").strip()
    if not reference:
        return {"status": "ignored"}

    if db.scalar(select(BankDeposit).where(BankDeposit.reference == reference)):
        return {"status": "duplicate"}

    # Never trust the webhook body for money: ask Paystack directly.
    try:
        verified = _paystack("GET", f"/transaction/verify/{reference}")
        amount = _naira_from_kobo(verified.get("amount"))
    except PaystackError:
        # A non-2xx makes Paystack retry the webhook later.
        raise HTTPException(status_code=503, detail="Could not verify with Paystack yet.") from None
    if verified.get("status") != "success" or (verified.get("currency") or "NGN") != "NGN":
        return {"status": "ignored"}

    customer_code = ((verified.get("customer") or {}).get("customer_code")
                     or (data.get("customer") or {}).get("customer_code"))
    authorization = data.get("authorization") or {}
    account_number = authorization.get("receiver_bank_account_number")
    account = None
    if customer_code:
        account = db.scalar(
            select(PassengerVirtualAccount).where(PassengerVirtualAccount.customer_code == customer_code)
        )
    if account is None and account_number:
        account = db.scalar(
            select(PassengerVirtualAccount).where(PassengerVirtualAccount.account_number == str(account_number))
        )

    deposit = BankDeposit(
        provider="paystack",
        reference=reference,
        amount=amount,
        user_id=account.user_id if account else None,
        account_number=account.account_number if account else (str(account_number) if account_number else None),
        sender_name=(str(authorization.get("sender_name"))[:160] if authorization.get("sender_name") else None),
        status="unmatched",
    )
    db.add(deposit)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        return {"status": "duplicate"}

    payment = find_payment_for_deposit(db, deposit)
    if payment is not None:
        confirm_payment_from_deposit(db, payment, deposit, None, "automatically")
    else:
        deposit.note = "No unpaid ride with this exact fare was waiting for this passenger."
        _audit(db, None, "deposit.unmatched", "bank_deposit", reference,
               f"Deposit of NGN {amount} could not be matched automatically.")
    db.commit()
    return {"status": "matched" if payment is not None else "unmatched"}


# --------------------------------------------------------------------------
# Admin: unmatched deposits and refunds owed
# --------------------------------------------------------------------------


def _deposit_result(deposit: BankDeposit, db: Session) -> dict:
    owner = db.get(User, deposit.user_id) if deposit.user_id else None
    payment = db.get(Payment, deposit.payment_id) if deposit.payment_id else None
    return {
        "id": deposit.id,
        "reference": deposit.reference,
        "amount": str(deposit.amount),
        "currency": "NGN",
        "status": deposit.status,
        "sender_name": deposit.sender_name,
        "account_number": deposit.account_number,
        "passenger": ({"id": owner.id, "name": owner.full_name, "phone": owner.phone} if owner else None),
        "ride_id": payment.ride_id if payment else None,
        "note": deposit.note,
        "created_at": deposit.created_at.isoformat() if deposit.created_at else None,
    }


@router.get("/admin/deposits")
def admin_list_deposits(
    status: Literal["unmatched", "matched", "resolved"] = Query("unmatched"),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_super_admin),
) -> list[dict]:
    deposits = db.scalars(
        select(BankDeposit).where(BankDeposit.status == status).order_by(BankDeposit.id.desc()).limit(200)
    ).all()
    return [_deposit_result(deposit, db) for deposit in deposits]


class DepositMatch(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    ride_id: int
    reason: str = Field(min_length=3, max_length=500)


class DepositResolution(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    reason: str = Field(min_length=3, max_length=500)


def _unmatched_deposit(db: Session, deposit_id: int) -> BankDeposit:
    deposit = db.get(BankDeposit, deposit_id)
    if deposit is None:
        raise HTTPException(status_code=404, detail="Deposit not found.")
    if deposit.status != "unmatched":
        raise HTTPException(status_code=409, detail="This deposit has already been handled.")
    return deposit


@router.post("/admin/deposits/{deposit_id}/match")
def admin_match_deposit(
    deposit_id: int,
    payload: DepositMatch,
    db: Session = Depends(get_db),
    admin: User = Depends(require_super_admin),
) -> dict:
    deposit = _unmatched_deposit(db, deposit_id)
    ride = db.get(Ride, payload.ride_id)
    if ride is None:
        raise HTTPException(status_code=404, detail="Ride not found.")
    ride_request = db.get(RideRequest, ride.request_id)
    if deposit.user_id is not None and ride_request.passenger_user_id != deposit.user_id:
        raise HTTPException(status_code=409, detail="This deposit came from a different passenger's account.")
    if ride.status not in PAYABLE_RIDE_STATUSES:
        raise HTTPException(status_code=409, detail="Only rides waiting for pickup can be paid this way.")
    if Decimal(ride.agreed_fare).quantize(Decimal("0.01")) != deposit.amount:
        raise HTTPException(
            status_code=409,
            detail="The deposit amount differs from the fare. Refund it and ask the passenger to send the exact fare.",
        )
    payment = db.scalar(select(Payment).where(Payment.ride_id == ride.id))
    if payment is None:
        payment = Payment(ride_id=ride.id, amount=ride.agreed_fare, method="bank_transfer", status="pending")
        db.add(payment)
        db.flush()
    elif payment.status not in MATCHABLE_PAYMENT_STATUSES:
        raise HTTPException(status_code=409, detail="This ride is already paid.")
    confirm_payment_from_deposit(db, payment, deposit, admin.id, f"by an admin ({payload.reason})")
    deposit.resolved_by_user_id = admin.id
    db.commit()
    return _deposit_result(deposit, db)


@router.post("/admin/deposits/{deposit_id}/resolve")
def admin_resolve_deposit(
    deposit_id: int,
    payload: DepositResolution,
    db: Session = Depends(get_db),
    admin: User = Depends(require_super_admin),
) -> dict:
    """Close a deposit that is not a ride payment, e.g. after refunding it."""
    deposit = _unmatched_deposit(db, deposit_id)
    deposit.status = "resolved"
    deposit.note = payload.reason
    deposit.resolved_by_user_id = admin.id
    _audit(db, admin.id, "deposit.resolved", "bank_deposit", deposit.reference, payload.reason)
    db.commit()
    return _deposit_result(deposit, db)


def _refund_result(payment: Payment, db: Session) -> dict:
    ride = db.get(Ride, payment.ride_id)
    ride_request = db.get(RideRequest, ride.request_id) if ride else None
    passenger = db.get(User, ride_request.passenger_user_id) if ride_request else None
    account = (
        db.scalar(select(PassengerVirtualAccount).where(PassengerVirtualAccount.user_id == passenger.id))
        if passenger else None
    )
    return {
        "payment_id": payment.id,
        "ride_id": payment.ride_id,
        "paid_amount": str(payment.amount),
        "cancellation_fee": str(ride.cancellation_fee) if ride and ride.cancellation_fee is not None else "0.00",
        "refund_amount": str(payment.refund_amount) if payment.refund_amount is not None else None,
        "refund_status": payment.refund_status,
        "refund_reference": payment.refund_reference,
        "currency": "NGN",
        "passenger": ({"id": passenger.id, "name": passenger.full_name, "phone": passenger.phone} if passenger else None),
        "has_payment_account": account is not None,
        "route": f"{ride_request.origin_text} → {ride_request.destination_text}" if ride_request else None,
        "cancelled_at": ride.cancelled_at.isoformat() if ride and ride.cancelled_at else None,
    }


@router.get("/admin/refunds")
def admin_list_refunds(
    status: Literal["due", "paid"] = Query("due"),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_super_admin),
) -> list[dict]:
    payments = db.scalars(
        select(Payment).where(Payment.refund_status == status).order_by(Payment.id).limit(200)
    ).all()
    return [_refund_result(payment, db) for payment in payments]


class RefundPaid(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    refund_reference: str = Field(min_length=3, max_length=120)


@router.post("/admin/payments/{payment_id}/refund-paid")
def admin_mark_refund_paid(
    payment_id: int,
    payload: RefundPaid,
    db: Session = Depends(get_db),
    admin: User = Depends(require_super_admin),
) -> dict:
    payment = db.get(Payment, payment_id)
    if payment is None:
        raise HTTPException(status_code=404, detail="Payment not found.")
    if payment.refund_status != "due":
        raise HTTPException(status_code=409, detail="No refund is due on this payment.")
    payment.refund_status = "paid"
    payment.refund_reference = payload.refund_reference
    payment.refunded_at = datetime.now(timezone.utc)
    if payment.refund_amount is not None and Decimal(payment.refund_amount) >= Decimal(payment.amount):
        payment.status = "refunded"
    _audit(db, admin.id, "payment.refund_paid", "payment", payment.id,
           f"Refund of NGN {payment.refund_amount} sent, reference {payload.refund_reference}.")
    db.commit()
    return _refund_result(payment, db)
