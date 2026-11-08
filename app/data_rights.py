"""Data rights (Nigeria Data Protection Act 2023): a copy of your data,
and asking for your account to be deleted.

A deletion request opens a support conversation and appears for
super-admins under People → "Deletion requested". Staff settle anything
owed (refunds, driver balances) and then use "Remove account", which
erases the name, contacts and sign-in and keeps trip and payment records
in anonymised form for legal and accounting reasons.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.auth import get_current_user, is_staff, verify_password
from app.database import get_db
from app.rate_limit import enforce as enforce_rate_limit
from app.models import (
    AuditLog,
    Driver,
    DriverPayout,
    DriverPayoutAccount,
    EarningEntry,
    Incident,
    PassengerVerification,
    Payment,
    PromoCode,
    PromoRedemption,
    PushSubscription,
    Rating,
    Ride,
    RideRequest,
    SavedPlace,
    SupportMessage,
    SupportThread,
    TripCall,
    TripMessage,
    User,
    Vehicle,
)

router = APIRouter(prefix="/api/v1", tags=["data rights"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _value(value):
    if isinstance(value, datetime):
        return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).isoformat()
    if isinstance(value, Decimal):
        return str(value)
    return value


def _row(obj, fields: list[str]) -> dict:
    return {field: _value(getattr(obj, field)) for field in fields}


def export_data(db: Session, user: User) -> dict:
    driver = db.scalar(select(Driver).where(Driver.user_id == user.id))
    requests = db.scalars(select(RideRequest).where(RideRequest.passenger_user_id == user.id)
                          .order_by(RideRequest.id)).all()
    request_ids = [r.id for r in requests]
    ride_query = select(Ride)
    conditions = []
    if request_ids:
        conditions.append(Ride.request_id.in_(request_ids))
    if driver is not None:
        conditions.append(Ride.driver_id == driver.id)
    rides = db.scalars(ride_query.where(or_(*conditions)).order_by(Ride.id)).all() if conditions else []
    ride_ids = [r.id for r in rides]
    threads = db.scalars(select(SupportThread).where(SupportThread.user_id == user.id)).all()
    verification = db.scalar(select(PassengerVerification).where(PassengerVerification.user_id == user.id))

    data = {
        "exported_at": _now().isoformat(),
        "about": "Your EkiMove data. Ask EkiMove support if anything is wrong or missing.",
        "account": _row(user, ["id", "full_name", "phone", "email", "role", "created_at", "phone_verified_at",
                               "email_verified_at", "emergency_contact_name", "emergency_contact_phone",
                               "policies_version", "policies_accepted_at", "referral_code",
                               "deletion_requested_at"]),
        "id_verification": (_row(verification, ["id_type", "status", "submitted_at", "reviewed_at", "review_note"])
                            | {"id_number": verification.id_number, "photo": "kept privately; ask support for a copy"}
                            if verification else None),
        "saved_places": [_row(p, ["label", "place_id", "created_at"])
                         for p in db.scalars(select(SavedPlace).where(SavedPlace.user_id == user.id))],
        "bookings": [_row(r, ["id", "service_type", "origin_text", "destination_text", "vehicle_type",
                              "passenger_count", "quoted_fare", "discount_amount", "status", "scheduled_for",
                              "load_description", "delivery_size", "recipient_name", "recipient_phone",
                              "delivery_notes", "created_at"]) for r in requests],
        "trips": [_row(r, ["id", "request_id", "status", "agreed_fare", "assigned_at", "arrived_at", "started_at",
                           "completed_at", "cancelled_at", "cancellation_fee"]) for r in rides],
        "payments": [_row(p, ["id", "ride_id", "amount", "method", "status", "transfer_reference", "confirmed_at",
                              "refund_amount", "refund_status", "refunded_at", "created_at"])
                     for p in (db.scalars(select(Payment).where(Payment.ride_id.in_(ride_ids))) if ride_ids else [])],
        "ratings_given": [_row(r, ["ride_id", "score", "comment", "created_at"])
                          for r in db.scalars(select(Rating).where(Rating.author_user_id == user.id))],
        "ratings_received": [_row(r, ["ride_id", "score", "comment", "created_at"])
                             for r in db.scalars(select(Rating).where(Rating.ratee_user_id == user.id))],
        "trip_messages": [_row(m, ["ride_id", "body", "created_at"]) | {"sent_by_me": m.sender_user_id == user.id}
                          for m in (db.scalars(select(TripMessage).where(TripMessage.ride_id.in_(ride_ids)))
                                    if ride_ids else [])],
        "trip_calls": [_row(c, ["ride_id", "status", "created_at", "answered_at", "ended_at"])
                       | {"i_called": c.caller_user_id == user.id}
                       for c in (db.scalars(select(TripCall).where(TripCall.ride_id.in_(ride_ids)))
                                 if ride_ids else [])],
        "support_conversations": [
            _row(t, ["id", "subject", "status", "created_at"]) | {
                "messages": [_row(m, ["body", "from_staff", "created_at"])
                             for m in db.scalars(select(SupportMessage).where(SupportMessage.thread_id == t.id)
                                                 .order_by(SupportMessage.id))]}
            for t in threads
        ],
        "safety_reports": [_row(i, ["ride_id", "severity", "status", "description", "created_at"])
                           for i in db.scalars(select(Incident).where(Incident.reporter_user_id == user.id))],
        "promo_codes_used": [_row(r, ["ride_request_id", "discount", "status", "created_at"])
                             for r in db.scalars(select(PromoRedemption).where(PromoRedemption.user_id == user.id))],
        "my_promo_codes": [_row(p, ["code", "description", "value", "ends_at"])
                           for p in db.scalars(select(PromoCode).where(PromoCode.owner_user_id == user.id))],
        "people_i_invited": len(db.scalars(select(User.id).where(User.referred_by_user_id == user.id)).all()),
        "sign_ins_and_account_activity": [
            _row(a, ["action", "details", "created_at"])
            for a in db.scalars(select(AuditLog).where(AuditLog.actor_user_id == user.id)
                                .order_by(AuditLog.id.desc()).limit(500))
        ],
        "notification_devices": len(db.scalars(select(PushSubscription.id)
                                               .where(PushSubscription.user_id == user.id)).all()),
    }
    if driver is not None:
        account = db.scalar(select(DriverPayoutAccount).where(DriverPayoutAccount.driver_id == driver.id))
        data["driver"] = {
            **_row(driver, ["verification_status", "created_at", "last_latitude", "last_longitude",
                            "location_updated_at"]),
            "face_photo": "kept privately; ask support for a copy" if driver.photo_path else None,
            "vehicles": [_row(v, ["vehicle_type", "plate_number", "capacity", "is_approved"])
                         for v in db.scalars(select(Vehicle).where(Vehicle.driver_id == driver.id))],
            "payout_account": _row(account, ["bank_name", "account_number", "account_name"]) if account else None,
            "earnings": [_row(e, ["kind", "ride_id", "gross", "commission", "amount", "created_at"])
                         for e in db.scalars(select(EarningEntry).where(EarningEntry.driver_id == driver.id)
                                             .order_by(EarningEntry.id))],
            "payouts": [_row(p, ["amount", "method", "status", "reference", "created_at", "completed_at"])
                        for p in db.scalars(select(DriverPayout).where(DriverPayout.driver_id == driver.id))],
        }
    return data


@router.get("/me/export")
def download_my_data(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> Response:
    enforce_rate_limit("data-export", f"user:{current_user.id}", 5, 3600,
                       "You've downloaded your data several times this hour. Please try again later.")
    data = export_data(db, current_user)
    db.add(AuditLog(actor_user_id=current_user.id, action="data.exported", entity_type="user",
                    entity_id=str(current_user.id), details="Downloaded a copy of their data."))
    db.commit()
    stamp = _now().strftime("%Y-%m-%d")
    return Response(content=json.dumps(data, ensure_ascii=False, indent=2), media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="ekimove-my-data-{stamp}.json"',
                             "Cache-Control": "no-store"})


class DeletionRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    password: str = Field(min_length=1, max_length=256)
    reason: str | None = Field(default=None, max_length=500)


@router.post("/me/deletion-request")
def request_deletion(payload: DeletionRequest, current_user: User = Depends(get_current_user),
                     db: Session = Depends(get_db)) -> dict:
    if is_staff(current_user):
        raise HTTPException(status_code=409, detail="EkiMove team accounts can't be deleted this way. Ask a super-admin.")
    if not verify_password(payload.password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="Your password isn't right.")
    if current_user.deletion_requested_at is not None:
        raise HTTPException(status_code=409, detail="You've already asked for your account to be deleted.")
    current_user.deletion_requested_at = _now()
    current_user.deletion_reason = payload.reason
    from app.support import open_thread  # avoid an import cycle

    open_thread(db, current_user, "Please delete my account",
                "I'd like my EkiMove account and personal data deleted."
                + (f"\nReason: {payload.reason}" if payload.reason else ""))
    db.add(AuditLog(actor_user_id=current_user.id, action="account.deletion_requested", entity_type="user",
                    entity_id=str(current_user.id), details=payload.reason))
    db.commit()
    return deletion_status(current_user)


@router.delete("/me/deletion-request")
def cancel_deletion(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    if current_user.deletion_requested_at is None:
        raise HTTPException(status_code=409, detail="There's no deletion request to cancel.")
    current_user.deletion_requested_at = None
    current_user.deletion_reason = None
    db.add(AuditLog(actor_user_id=current_user.id, action="account.deletion_cancelled", entity_type="user",
                    entity_id=str(current_user.id), details=None))
    db.commit()
    return deletion_status(current_user)


def deletion_status(user: User) -> dict:
    return {"deletion_requested_at": _value(user.deletion_requested_at), "deletion_reason": user.deletion_reason}
