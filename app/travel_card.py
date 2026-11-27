"""Paying for student travel tickets through Interswitch checkout.

Interswitch's checkout page takes cards and, where switched on for the
merchant, bank transfer, USSD and wallets. Whatever the student uses, a
ticket is only credited after Interswitch itself confirms that the reference
was paid in full (never on the browser's word or a notification alone).

- Every checkout a student starts is kept, so a payment completed in an old
  browser tab is still found and credited.
- While a checkout is in progress the seats aren't released.
- Money that arrives for a booking that has since expired gets the seats
  back if they're still free; otherwise (or when someone pays more than was
  owed) the extra is listed as a refund for staff to send.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app import travel
from app.auth import get_current_user
from app.database import get_db
from app.interswitch_payments import (InterswitchInitiateRequest, card_payments_enabled, checkout_details,
                                      checkout_mode, reference_paid)
from app.models import TravelBooking, TravelCardCheckout, TravelDeparture, TravelPayment, User

router = APIRouter(prefix="/api/v1/travel", tags=["student travel"])

# A seat isn't released while a card checkout started this recently is unfinished.
CHECKOUT_GRACE = timedelta(minutes=30)


def checkout_in_progress(db: Session, booking_id: int, now: datetime | None = None) -> bool:
    since = (now or datetime.now(timezone.utc)) - CHECKOUT_GRACE
    return db.scalar(select(TravelCardCheckout.id).where(
        TravelCardCheckout.booking_id == booking_id, TravelCardCheckout.status == "pending",
        TravelCardCheckout.created_at >= since).limit(1)) is not None


def settle_checkout(db: Session, checkout: TravelCardCheckout) -> bool:
    """Credit a checkout if Interswitch says it was paid in full. True if this call credited it.

    Raises 502/503 when Interswitch can't be asked (the caller can try again).
    """
    if checkout.status != "pending":
        return False
    if not reference_paid(checkout.reference, checkout.amount, f"travel checkout {checkout.id}"):
        return False
    claimed = db.execute(update(TravelCardCheckout).where(
        TravelCardCheckout.id == checkout.id, TravelCardCheckout.status == "pending",
    ).values(status="paid", paid_at=datetime.now(timezone.utc)))
    if claimed.rowcount != 1:
        db.rollback()
        return False

    booking = db.get(TravelBooking, checkout.booking_id)
    dep = db.get(TravelDeparture, booking.departure_id)
    amount = travel._money(checkout.amount)
    reference = f"interswitch:{checkout.reference}"

    if booking.status == "expired" and dep.status == "open" \
            and travel.seats_taken(db, dep.id) + booking.seats <= dep.seats_total:
        booking.status = "awaiting_payment"     # the seats were still free: give them back

    if booking.status in travel.ACTIVE:
        owed = travel.balance(booking)
        travel.apply_payment(db, booking, amount, "card", reference, None)
        extra = amount - owed
    else:
        # Cancelled, or expired and the seats have gone: keep a record and refund it all.
        db.add(TravelPayment(booking_id=booking.id, amount=amount, method="card", reference=reference))
        booking.amount_paid = travel._money(booking.amount_paid) + amount
        extra = amount
        travel._audit(db, None, "travel.payment", "travel_booking", booking.id,
                      f"{travel._naira(amount)} card payment arrived after ticket {booking.ticket_code} "
                      f"was {booking.status}; refund due.")
    if extra > 0:
        booking.refund_amount = travel._money(booking.refund_amount or 0) + extra
        booking.refund_status = "due"
        travel._notify(db, booking.user_id, "Refund on its way",
                       f"We received {travel._naira(extra)} more than ticket {booking.ticket_code} needed. "
                       "We'll send it back to you.")
    db.commit()
    return True


def _payable_booking(db: Session, booking_id: int, user: User) -> tuple[TravelBooking, TravelDeparture]:
    booking = travel._my_booking(db, booking_id, user)
    dep = db.get(TravelDeparture, booking.departure_id)
    if booking.status not in travel.ACTIVE or dep.status not in ("open", "closed"):
        raise HTTPException(status_code=409, detail="This ticket can't be paid for any more.")
    return booking, dep


@router.post("/bookings/{booking_id}/card")
def start_card_payment(booking_id: int, payload: InterswitchInitiateRequest, db: Session = Depends(get_db),
                       user: User = Depends(get_current_user)) -> dict:
    """Start an Interswitch checkout for what's due now (the deposit or the balance)."""
    if not card_payments_enabled():
        raise HTTPException(status_code=503, detail="Card payments aren't available yet. Please pay by transfer.")
    checkout_mode()
    travel.expire_holds(db)
    booking, _dep = _payable_booking(db, booking_id, user)

    # Finish any earlier checkout first, so nobody pays twice for the same thing.
    for earlier in db.scalars(select(TravelCardCheckout).where(
            TravelCardCheckout.booking_id == booking.id, TravelCardCheckout.status == "pending")).all():
        try:
            settled = settle_checkout(db, earlier)
        except HTTPException:
            raise HTTPException(status_code=503, detail="We couldn't reach Interswitch to check your earlier card "
                                                        "payment. Try again in a few minutes, or pay by bank "
                                                        "transfer.") from None
        if settled:
            db.refresh(booking)
    due = travel.due_now(booking)
    if due <= 0:
        return {"booking": travel.booking_view(db, booking), "checkout": None}

    checkout = TravelCardCheckout(booking_id=booking.id, amount=due,
                                  reference=f"EKIMOVE-T{booking.id}-{uuid4().hex[:16].upper()}")
    db.add(checkout)
    travel._audit(db, user.id, "travel.card_started", "travel_booking", booking.id,
                  f"Card checkout started for {travel._naira(due)} on ticket {booking.ticket_code}.")
    db.commit()
    return {"booking": travel.booking_view(db, booking),
            "checkout": checkout_details(checkout.reference, due, payload.customer_email)}


@router.post("/bookings/{booking_id}/card/verify")
def verify_card_payment(booking_id: int, db: Session = Depends(get_db),
                        user: User = Depends(get_current_user)) -> dict:
    """Check the student's unfinished checkouts with Interswitch and credit any that were paid."""
    booking = travel._my_booking(db, booking_id, user)
    pending = db.scalars(select(TravelCardCheckout).where(
        TravelCardCheckout.booking_id == booking.id, TravelCardCheckout.status == "pending")).all()
    credited = Decimal("0.00")
    for checkout in pending:
        if settle_checkout(db, checkout):
            credited += travel._money(checkout.amount)
    db.refresh(booking)
    return {"booking": travel.booking_view(db, booking), "credited": str(credited)}
