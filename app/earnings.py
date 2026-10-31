"""Driver earnings: commission, an earnings ledger and payouts.

Every completed, paid trip credits the driver with the fare minus EkiMove's
commission (``COMMISSION_PERCENT``, 10% by default); a kept cancellation fee
is credited the same way. A driver's balance is the sum of their ledger
entries. A payout run moves each balance at or above ``PAYOUT_MINIMUM`` to
the driver's bank account, automatically with Paystack Transfers when
enabled, otherwise as a queued payout that staff send and record.
"""

from __future__ import annotations

import hmac
import logging
import re
from datetime import datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal
from uuid import uuid4
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import get_current_user, require_super_admin
from app.config import settings
from app.database import get_db
from app.instant_payments import PaystackError, _paystack, instant_transfers_enabled
from app.models import (
    AuditLog,
    Driver,
    DriverPayout,
    DriverPayoutAccount,
    EarningEntry,
    Payment,
    Ride,
    RideRequest,
    User,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1", tags=["earnings"])

CENT = Decimal("0.01")
LAGOS = ZoneInfo("Africa/Lagos")
EARNING_KINDS = ("trip", "cancellation_fee")
OPEN_PAYOUT_STATUSES = ("queued", "processing")

# Fallback list (Paystack bank codes) used when Paystack isn't configured.
COMMON_BANKS = [
    ("044", "Access Bank"), ("023", "Citibank Nigeria"), ("050", "Ecobank Nigeria"),
    ("070", "Fidelity Bank"), ("011", "First Bank of Nigeria"), ("214", "First City Monument Bank"),
    ("058", "Guaranty Trust Bank"), ("030", "Heritage Bank"), ("082", "Keystone Bank"),
    ("50211", "Kuda Bank"), ("50515", "Moniepoint MFB"), ("999992", "OPay Digital Services (OPay)"),
    ("999991", "PalmPay"), ("076", "Polaris Bank"), ("101", "Providus Bank"),
    ("221", "Stanbic IBTC Bank"), ("232", "Sterling Bank"), ("032", "Union Bank of Nigeria"),
    ("033", "United Bank For Africa"), ("215", "Unity Bank"), ("035", "Wema Bank"),
    ("057", "Zenith Bank"),
]


def money(value) -> Decimal:
    return Decimal(str(value or 0)).quantize(CENT, rounding=ROUND_HALF_UP)


def commission_rate() -> Decimal:
    rate = Decimal(str(settings.commission_percent))
    return min(max(rate, Decimal(0)), Decimal(100))


def split_fare(gross) -> tuple[Decimal, Decimal, Decimal]:
    """Return (gross, commission, driver_net) for an amount."""
    gross = money(gross)
    commission = money(gross * commission_rate() / Decimal(100))
    return gross, commission, gross - commission


def payouts_automatic() -> bool:
    return bool(settings.paystack_transfers_enabled and instant_transfers_enabled())


def _audit(db: Session, actor_id: int | None, action: str, entity_type: str, entity_id, details: str) -> None:
    db.add(AuditLog(actor_user_id=actor_id, action=action, entity_type=entity_type,
                    entity_id=str(entity_id), details=details))


# --------------------------------------------------------------------------
# Ledger writes (called from the ride and cancellation flows)
# --------------------------------------------------------------------------


def _credit(db: Session, ride: Ride, kind: str, gross) -> EarningEntry | None:
    existing = db.scalar(select(EarningEntry).where(EarningEntry.ride_id == ride.id, EarningEntry.kind == kind))
    if existing is not None:
        return existing
    gross, commission, net = split_fare(gross)
    if gross <= 0:
        return None
    entry = EarningEntry(
        driver_id=ride.driver_id, kind=kind, ride_id=ride.id, gross=gross,
        commission=commission, commission_percent=commission_rate(), amount=net,
    )
    db.add(entry)
    return entry


def record_trip_earning(db: Session, ride: Ride) -> EarningEntry | None:
    """Credit the driver for a completed trip whose payment was confirmed."""
    payment = db.scalar(select(Payment).where(Payment.ride_id == ride.id))
    if payment is None or payment.status != "confirmed":
        return None
    return _credit(db, ride, "trip", ride.agreed_fare)


def record_cancellation_earning(db: Session, ride: Ride, fee) -> EarningEntry | None:
    """Credit the driver with a kept cancellation fee (minus commission)."""
    return _credit(db, ride, "cancellation_fee", fee)


def driver_balance(db: Session, driver_id: int) -> Decimal:
    total = db.scalar(select(func.coalesce(func.sum(EarningEntry.amount), 0)).where(EarningEntry.driver_id == driver_id))
    return money(total)


# --------------------------------------------------------------------------
# Payouts
# --------------------------------------------------------------------------


def _new_reference(payout_hint: str = "") -> str:
    return f"ekm-payout-{payout_hint}{uuid4().hex[:16]}"


def _fail_payout(db: Session, payout: DriverPayout, reason: str, actor_id: int | None = None) -> None:
    """Mark a payout failed and give the money back to the driver's balance."""
    if payout.status in ("failed", "paid"):
        return
    payout.status = "failed"
    payout.failure_reason = reason[:500]
    payout.completed_at = datetime.now(timezone.utc)
    if not db.scalar(select(EarningEntry).where(EarningEntry.payout_id == payout.id,
                                                 EarningEntry.kind == "payout_reversal")):
        db.add(EarningEntry(driver_id=payout.driver_id, kind="payout_reversal", payout_id=payout.id,
                            amount=payout.amount, note=f"Payout {payout.reference} failed: {reason}"[:500]))
    _audit(db, actor_id, "payout.failed", "driver_payout", payout.id, reason)


def _mark_paid(db: Session, payout: DriverPayout, bank_reference: str | None, actor_id: int | None) -> None:
    if payout.status not in OPEN_PAYOUT_STATUSES:
        return
    payout.status = "paid"
    payout.bank_reference = bank_reference or payout.bank_reference
    payout.completed_at = datetime.now(timezone.utc)
    _audit(db, actor_id, "payout.paid", "driver_payout", payout.id,
           f"NGN {payout.amount} paid, reference {payout.bank_reference or payout.reference}.")


def _ensure_recipient(db: Session, account: DriverPayoutAccount) -> str:
    if account.recipient_code:
        return account.recipient_code
    data = _paystack("POST", "/transferrecipient", {
        "type": "nuban", "name": account.account_name, "account_number": account.account_number,
        "bank_code": account.bank_code, "currency": "NGN",
    })
    code = data.get("recipient_code")
    if not code:
        raise PaystackError("Paystack did not return a transfer recipient.")
    account.recipient_code = code
    return code


def run_payouts(db: Session, actor_id: int | None) -> dict:
    """Create a payout for every driver whose balance is due."""
    minimum = money(settings.payout_minimum)
    automatic = payouts_automatic()
    balances = db.execute(
        select(EarningEntry.driver_id, func.sum(EarningEntry.amount))
        .group_by(EarningEntry.driver_id)
    ).all()

    summary = {"automatic": automatic, "created": 0, "paid": 0, "processing": 0,
               "queued": 0, "failed": 0, "skipped_no_account": 0, "total": "0.00"}
    total = Decimal("0.00")

    for driver_id, raw_balance in balances:
        balance = money(raw_balance)
        if balance < minimum or balance <= 0:
            continue
        account = db.scalar(select(DriverPayoutAccount).where(DriverPayoutAccount.driver_id == driver_id))
        if account is None:
            summary["skipped_no_account"] += 1
            continue

        payout = DriverPayout(
            driver_id=driver_id, amount=balance,
            method="paystack" if automatic and account.verified else "manual",
            status="queued", reference=_new_reference(), created_by_user_id=actor_id,
        )
        db.add(payout)
        db.flush()
        db.add(EarningEntry(driver_id=driver_id, kind="payout", payout_id=payout.id, amount=-balance,
                            note=f"Payout {payout.reference}"))
        _audit(db, actor_id, "payout.created", "driver_payout", payout.id, f"NGN {balance} for driver {driver_id}.")
        # Commit the debit before any money moves, so a crash can never
        # leave a sent transfer without its ledger entry.
        db.commit()
        summary["created"] += 1
        total += balance

        if payout.method == "paystack":
            try:
                recipient = _ensure_recipient(db, account)
                data = _paystack("POST", "/transfer", {
                    "source": "balance", "amount": int(balance * 100), "recipient": recipient,
                    "reference": payout.reference, "reason": "EkiMove driver earnings",
                })
                payout.transfer_code = data.get("transfer_code")
                if data.get("status") == "success":
                    _mark_paid(db, payout, payout.reference, actor_id)
                elif data.get("status") in ("failed", "reversed"):
                    _fail_payout(db, payout, "Paystack could not send this transfer.", actor_id)
                else:  # pending / received / otp: settled by webhook
                    payout.status = "processing"
            except PaystackError as exc:
                _fail_payout(db, payout, str(exc), actor_id)
            db.commit()

        summary[payout.status] = summary.get(payout.status, 0) + 1

    summary["total"] = str(total)
    return summary


def handle_transfer_event(db: Session, event: dict) -> dict:
    """Apply a Paystack transfer.success / transfer.failed / transfer.reversed webhook."""
    data = event.get("data") or {}
    reference = str(data.get("reference") or "")
    payout = db.scalar(select(DriverPayout).where(DriverPayout.reference == reference)) if reference else None
    if payout is None:
        return {"status": "ignored"}
    kind = event.get("event")
    if kind == "transfer.success":
        _mark_paid(db, payout, reference, None)
    elif kind == "transfer.reversed" and payout.status == "paid":
        # Money came back after it was reported sent: reopen and credit back.
        payout.status = "processing"
        _fail_payout(db, payout, "Transfer was reversed by the bank.")
    elif kind in ("transfer.failed", "transfer.reversed"):
        _fail_payout(db, payout, str(data.get("reason") or "Transfer failed.")[:300])
    else:
        return {"status": "ignored"}
    db.commit()
    return {"status": payout.status}


# --------------------------------------------------------------------------
# Driver API
# --------------------------------------------------------------------------


def _current_driver(user: User, db: Session) -> Driver:
    if user.role != "driver":
        raise HTTPException(status_code=403, detail="Driver account required.")
    driver = db.scalar(select(Driver).where(Driver.user_id == user.id))
    if driver is None:
        raise HTTPException(status_code=404, detail="Driver profile not found.")
    return driver


def _mask(number: str) -> str:
    return f"••••{number[-4:]}" if number else ""


def _account_result(account: DriverPayoutAccount | None, full: bool = True) -> dict | None:
    if account is None:
        return None
    return {
        "bank_code": account.bank_code,
        "bank_name": account.bank_name,
        "account_number": account.account_number if full else _mask(account.account_number),
        "account_name": account.account_name,
        "verified": account.verified,
    }


def _payout_result(payout: DriverPayout) -> dict:
    return {
        "id": payout.id,
        "amount": str(payout.amount),
        "status": payout.status,
        "method": payout.method,
        "reference": payout.reference,
        "bank_reference": payout.bank_reference,
        "failure_reason": payout.failure_reason,
        "created_at": payout.created_at.isoformat() if payout.created_at else None,
        "completed_at": payout.completed_at.isoformat() if payout.completed_at else None,
    }


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def ride_earning_preview(db: Session, ride: Ride) -> dict:
    """Itemised earning for a driver's trip: recorded if credited, else projected."""
    entry = db.scalar(
        select(EarningEntry).where(EarningEntry.ride_id == ride.id, EarningEntry.kind.in_(EARNING_KINDS))
    )
    if entry is not None:
        return {"fare": str(entry.gross), "commission": str(entry.commission),
                "earning": str(entry.amount), "credited": True}
    if ride.status == "cancelled":
        return {"fare": "0.00", "commission": "0.00", "earning": "0.00", "credited": False}
    gross, commission, net = split_fare(ride.agreed_fare)
    return {"fare": str(gross), "commission": str(commission), "earning": str(net), "credited": False}


@router.get("/driver/earnings")
def driver_earnings(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    driver = _current_driver(current_user, db)
    entries = db.scalars(
        select(EarningEntry).where(EarningEntry.driver_id == driver.id)
        .order_by(EarningEntry.created_at.desc(), EarningEntry.id.desc()).limit(60)
    ).all()

    now_local = datetime.now(LAGOS)
    day_start = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = day_start - timedelta(days=day_start.weekday())
    credits = db.scalars(
        select(EarningEntry).where(EarningEntry.driver_id == driver.id, EarningEntry.kind.in_(EARNING_KINDS))
    ).all()

    def total_since(start: datetime) -> Decimal:
        return money(sum((Decimal(e.amount) for e in credits
                          if (_as_utc(e.created_at) or start) >= start), Decimal(0)))

    ride_ids = [e.ride_id for e in entries if e.ride_id]
    routes = {}
    if ride_ids:
        for ride_id, origin, destination in db.execute(
            select(Ride.id, RideRequest.origin_text, RideRequest.destination_text)
            .join(RideRequest, Ride.request_id == RideRequest.id).where(Ride.id.in_(ride_ids))
        ).all():
            routes[ride_id] = f"{origin} → {destination}"

    payouts = db.scalars(
        select(DriverPayout).where(DriverPayout.driver_id == driver.id).order_by(DriverPayout.id.desc()).limit(20)
    ).all()
    account = db.scalar(select(DriverPayoutAccount).where(DriverPayoutAccount.driver_id == driver.id))

    return {
        "currency": "NGN",
        "commission_percent": str(commission_rate()),
        "payout_minimum": str(money(settings.payout_minimum)),
        "payouts_automatic": payouts_automatic(),
        "balance": str(driver_balance(db, driver.id)),
        "today": str(total_since(day_start)),
        "this_week": str(total_since(week_start)),
        "lifetime": str(money(sum((Decimal(e.amount) for e in credits), Decimal(0)))),
        "trips_completed": sum(1 for e in credits if e.kind == "trip"),
        "entries": [
            {
                "id": e.id, "kind": e.kind, "ride_id": e.ride_id, "route": routes.get(e.ride_id),
                "fare": str(e.gross), "commission": str(e.commission), "amount": str(e.amount),
                "note": e.note, "created_at": e.created_at.isoformat() if e.created_at else None,
            }
            for e in entries
        ],
        "payouts": [_payout_result(p) for p in payouts],
        "payout_account": _account_result(account, full=False),
    }


@router.get("/banks")
def list_banks(_user: User = Depends(get_current_user)) -> list[dict]:
    if instant_transfers_enabled():
        try:
            data = _paystack("GET", "/bank?country=nigeria&currency=NGN&perPage=200")
            banks = [{"code": str(b["code"]), "name": b["name"]} for b in data
                     if isinstance(b, dict) and b.get("code") and b.get("name") and b.get("active", True)]
            if banks:
                return sorted(banks, key=lambda b: b["name"].lower())
        except (PaystackError, TypeError):
            pass
    return [{"code": code, "name": name} for code, name in COMMON_BANKS]


class PayoutAccountInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    bank_code: str = Field(min_length=3, max_length=20)
    account_number: str
    account_name: str | None = Field(default=None, max_length=160)

    @field_validator("account_number")
    @classmethod
    def ten_digits(cls, value: str) -> str:
        if not re.fullmatch(r"\d{10}", value):
            raise ValueError("Enter the 10-digit account number (NUBAN).")
        return value

    @field_validator("bank_code")
    @classmethod
    def digits_only(cls, value: str) -> str:
        if not value.isdigit():
            raise ValueError("Choose a bank from the list.")
        return value


@router.get("/driver/payout-account")
def get_payout_account(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    driver = _current_driver(current_user, db)
    account = db.scalar(select(DriverPayoutAccount).where(DriverPayoutAccount.driver_id == driver.id))
    return {"account": _account_result(account), "verification_available": instant_transfers_enabled()}


@router.put("/driver/payout-account")
def set_payout_account(
    payload: PayoutAccountInput,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    driver = _current_driver(current_user, db)
    if db.scalar(select(DriverPayout).where(DriverPayout.driver_id == driver.id,
                                            DriverPayout.status == "processing")):
        raise HTTPException(status_code=409, detail="A payout is on its way. Change your account after it arrives.")

    bank_names = {code: name for code, name in COMMON_BANKS}
    verified = False
    if instant_transfers_enabled():
        try:
            resolved = _paystack("GET", f"/bank/resolve?account_number={payload.account_number}"
                                        f"&bank_code={payload.bank_code}")
        except PaystackError:
            raise HTTPException(status_code=422, detail="That account number doesn't match the bank you chose. "
                                                        "Check both and try again.") from None
        account_name = str(resolved.get("account_name") or "").strip()
        if not account_name:
            raise HTTPException(status_code=422, detail="The bank didn't return an account name.")
        verified = True
        try:
            banks = {b["code"]: b["name"] for b in list_banks(current_user)}
            bank_names.update(banks)
        except Exception:  # noqa: BLE001 - name lookup is cosmetic
            pass
    else:
        account_name = (payload.account_name or "").strip()
        if len(account_name) < 3:
            raise HTTPException(status_code=422, detail="Enter the account name exactly as your bank shows it.")

    account = db.scalar(select(DriverPayoutAccount).where(DriverPayoutAccount.driver_id == driver.id))
    if account is None:
        account = DriverPayoutAccount(driver_id=driver.id)
        db.add(account)
    account.bank_code = payload.bank_code
    account.bank_name = bank_names.get(payload.bank_code, f"Bank {payload.bank_code}")[:120]
    account.account_number = payload.account_number
    account.account_name = account_name[:160]
    account.verified = verified
    account.recipient_code = None  # recreated with the new details on the next payout
    _audit(db, current_user.id, "payout_account.updated", "driver", driver.id,
           f"Payout account set to {account.bank_name} {_mask(account.account_number)} (verified={verified}).")
    db.commit()
    db.refresh(account)
    return {"account": _account_result(account), "verification_available": instant_transfers_enabled()}


# --------------------------------------------------------------------------
# Admin API
# --------------------------------------------------------------------------


@router.get("/admin/earnings/summary")
def admin_earnings_summary(db: Session = Depends(get_db), _admin: User = Depends(require_super_admin)) -> dict:
    totals = db.execute(
        select(func.coalesce(func.sum(EarningEntry.gross), 0), func.coalesce(func.sum(EarningEntry.commission), 0),
               func.coalesce(func.sum(EarningEntry.amount), 0), func.count(EarningEntry.id))
        .where(EarningEntry.kind.in_(EARNING_KINDS))
    ).one()
    paid_out = db.scalar(select(func.coalesce(func.sum(DriverPayout.amount), 0)).where(DriverPayout.status == "paid"))
    in_flight = db.scalar(select(func.coalesce(func.sum(DriverPayout.amount), 0))
                          .where(DriverPayout.status.in_(OPEN_PAYOUT_STATUSES)))

    drivers = []
    rows = db.execute(
        select(Driver.id, User.full_name, User.phone).join(User, Driver.user_id == User.id).order_by(Driver.id)
    ).all()
    owed = Decimal("0.00")
    for driver_id, name, phone in rows:
        balance = driver_balance(db, driver_id)
        lifetime = money(db.scalar(select(func.coalesce(func.sum(EarningEntry.amount), 0))
                                   .where(EarningEntry.driver_id == driver_id,
                                          EarningEntry.kind.in_(EARNING_KINDS))))
        if balance == 0 and lifetime == 0:
            continue
        owed += max(balance, Decimal(0))
        account = db.scalar(select(DriverPayoutAccount).where(DriverPayoutAccount.driver_id == driver_id))
        drivers.append({"driver_id": driver_id, "name": name, "phone": phone, "balance": str(balance),
                        "lifetime": str(lifetime), "payout_account": _account_result(account, full=False)})

    return {
        "currency": "NGN",
        "commission_percent": str(commission_rate()),
        "payout_minimum": str(money(settings.payout_minimum)),
        "payouts_automatic": payouts_automatic(),
        "fares": str(money(totals[0])),
        "commission": str(money(totals[1])),
        "driver_earnings": str(money(totals[2])),
        "entries": totals[3],
        "owed_to_drivers": str(owed),
        "paid_out": str(money(paid_out)),
        "in_flight": str(money(in_flight)),
        "drivers": drivers,
    }


@router.get("/admin/payouts")
def admin_list_payouts(
    status: Literal["open", "queued", "processing", "paid", "failed", "all"] = Query("open"),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_super_admin),
) -> list[dict]:
    query = select(DriverPayout, User.full_name, User.phone, DriverPayoutAccount) \
        .join(Driver, DriverPayout.driver_id == Driver.id).join(User, Driver.user_id == User.id) \
        .outerjoin(DriverPayoutAccount, DriverPayoutAccount.driver_id == Driver.id)
    if status == "open":
        query = query.where(DriverPayout.status.in_(OPEN_PAYOUT_STATUSES))
    elif status != "all":
        query = query.where(DriverPayout.status == status)
    rows = db.execute(query.order_by(DriverPayout.id.desc()).limit(200)).all()
    return [
        {**_payout_result(payout), "driver_id": payout.driver_id, "driver_name": name, "driver_phone": phone,
         "payout_account": _account_result(account)}
        for payout, name, phone, account in rows
    ]


@router.post("/admin/payouts/run")
def admin_run_payouts(db: Session = Depends(get_db), admin: User = Depends(require_super_admin)) -> dict:
    return run_payouts(db, admin.id)


@router.post("/internal/payouts/run", include_in_schema=False)
def cron_run_payouts(
    x_cron_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> dict:
    """Daily payout job (e.g. a Render Cron Job calling this with X-Cron-Token)."""
    expected = settings.payout_cron_token
    if not expected:
        raise HTTPException(status_code=404, detail="Not found.")
    if not x_cron_token or not hmac.compare_digest(expected, x_cron_token):
        raise HTTPException(status_code=401, detail="Invalid token.")
    return run_payouts(db, None)


class PayoutPaid(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    bank_reference: str = Field(min_length=3, max_length=120)


class PayoutFailed(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    reason: str = Field(min_length=3, max_length=300)


def _open_payout(db: Session, payout_id: int) -> DriverPayout:
    payout = db.get(DriverPayout, payout_id)
    if payout is None:
        raise HTTPException(status_code=404, detail="Payout not found.")
    if payout.status not in OPEN_PAYOUT_STATUSES:
        raise HTTPException(status_code=409, detail="This payout is already settled.")
    return payout


@router.post("/admin/payouts/{payout_id}/mark-paid")
def admin_mark_payout_paid(payout_id: int, payload: PayoutPaid, db: Session = Depends(get_db),
                           admin: User = Depends(require_super_admin)) -> dict:
    payout = _open_payout(db, payout_id)
    _mark_paid(db, payout, payload.bank_reference, admin.id)
    db.commit()
    return _payout_result(payout)


@router.post("/admin/payouts/{payout_id}/mark-failed")
def admin_mark_payout_failed(payout_id: int, payload: PayoutFailed, db: Session = Depends(get_db),
                             admin: User = Depends(require_super_admin)) -> dict:
    payout = _open_payout(db, payout_id)
    _fail_payout(db, payout, payload.reason, admin.id)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="This payout was already reversed.") from None
    return _payout_result(payout)
