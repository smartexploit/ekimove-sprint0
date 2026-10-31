"""Super-admin reports: daily totals and spreadsheet (CSV) downloads.

Days are Lagos calendar days. Ranges are limited to 366 days.
"""

from __future__ import annotations

import csv
import io
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import require_super_admin
from app.database import get_db
from app.models import Driver, DriverPayout, EarningEntry, Payment, Ride, RideRequest, User, Vehicle

router = APIRouter(prefix="/api/v1/admin/reports", tags=["admin", "reports"])
LAGOS = ZoneInfo("Africa/Lagos")
MAX_DAYS = 366
ZERO = Decimal("0.00")

DAILY_FIELDS = [
    ("date", "Date"),
    ("requests", "Requests"),
    ("completed_trips", "Completed trips"),
    ("completed_fares", "Fares of completed trips (NGN)"),
    ("cancelled_trips", "Cancelled trips"),
    ("payments_confirmed", "Payments confirmed"),
    ("payments_amount", "Payments received (NGN)"),
    ("discounts", "Promo discounts (NGN)"),
    ("refunds_paid", "Refunds paid (NGN)"),
    ("commission", "EkiMove commission (NGN)"),
    ("driver_earnings", "Driver earnings (NGN)"),
    ("payouts_paid", "Payouts sent (NGN)"),
    ("new_passengers", "New passengers"),
    ("new_drivers", "New drivers"),
]
MONEY = {"completed_fares", "payments_amount", "discounts", "refunds_paid", "commission", "driver_earnings", "payouts_paid"}


def _range(start: date | None, end: date | None) -> tuple[date, date, datetime, datetime]:
    today = datetime.now(LAGOS).date()
    end = end or today
    start = start or end - timedelta(days=29)
    if start > end:
        raise HTTPException(status_code=422, detail="The start date must be on or before the end date.")
    if (end - start).days + 1 > MAX_DAYS:
        raise HTTPException(status_code=422, detail=f"Choose at most {MAX_DAYS} days.")
    begin = datetime.combine(start, time.min, LAGOS).astimezone(timezone.utc)
    finish = datetime.combine(end + timedelta(days=1), time.min, LAGOS).astimezone(timezone.utc)
    return start, end, begin, finish


def _local_day(value: datetime | None) -> date | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(LAGOS).date()


def _local_text(value: datetime | None) -> str:
    if value is None:
        return ""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(LAGOS).strftime("%Y-%m-%d %H:%M")


def daily_report(db: Session, start: date, end: date, begin: datetime, finish: datetime) -> dict:
    days: dict[date, dict] = {}
    current = start
    while current <= end:
        days[current] = {key: (ZERO if key in MONEY else 0) for key, _ in DAILY_FIELDS if key != "date"}
        current += timedelta(days=1)

    def bump(when: datetime | None, key: str, amount=1) -> None:
        day = _local_day(when)
        if day in days:
            days[day][key] += amount

    def between(column):
        return column >= begin, column < finish

    for (created,) in db.execute(select(RideRequest.created_at).where(*between(RideRequest.created_at))):
        bump(created, "requests")
    for completed, fare in db.execute(select(Ride.completed_at, Ride.agreed_fare)
                                      .where(Ride.status == "completed", *between(Ride.completed_at))):
        bump(completed, "completed_trips")
        bump(completed, "completed_fares", Decimal(fare or 0))
    for (cancelled,) in db.execute(select(Ride.cancelled_at).where(Ride.status == "cancelled",
                                                                   *between(Ride.cancelled_at))):
        bump(cancelled, "cancelled_trips")
    for confirmed, amount, discount in db.execute(
        select(Payment.confirmed_at, Payment.amount, RideRequest.discount_amount)
        .join(Ride, Payment.ride_id == Ride.id).join(RideRequest, Ride.request_id == RideRequest.id)
        .where(Payment.status.in_(("confirmed", "refunded")), *between(Payment.confirmed_at))
    ):
        bump(confirmed, "payments_confirmed")
        bump(confirmed, "payments_amount", Decimal(amount or 0))
        bump(confirmed, "discounts", Decimal(discount or 0))
    for refunded, amount in db.execute(select(Payment.refunded_at, Payment.refund_amount)
                                       .where(Payment.refund_status == "paid", *between(Payment.refunded_at))):
        bump(refunded, "refunds_paid", Decimal(amount or 0))
    for created, commission, amount in db.execute(
        select(EarningEntry.created_at, EarningEntry.commission, EarningEntry.amount)
        .where(EarningEntry.kind.in_(("trip", "cancellation_fee")), *between(EarningEntry.created_at))
    ):
        bump(created, "commission", Decimal(commission or 0))
        bump(created, "driver_earnings", Decimal(amount or 0))
    for completed, amount in db.execute(select(DriverPayout.completed_at, DriverPayout.amount)
                                        .where(DriverPayout.status == "paid", *between(DriverPayout.completed_at))):
        bump(completed, "payouts_paid", Decimal(amount or 0))
    for created, role in db.execute(select(User.created_at, User.role)
                                    .where(User.role.in_(("passenger", "driver")), *between(User.created_at))):
        bump(created, "new_passengers" if role == "passenger" else "new_drivers")

    rows = [{"date": day.isoformat(), **values} for day, values in days.items()]
    totals = {key: sum((row[key] for row in rows), ZERO if key in MONEY else 0)
              for key, _ in DAILY_FIELDS if key != "date"}

    def out(row: dict) -> dict:
        return {key: (f"{value:.2f}" if key in MONEY else value) for key, value in row.items()}

    return {"start": start.isoformat(), "end": end.isoformat(), "days": [out(r) for r in rows], "totals": out(totals),
            "fields": [{"key": key, "label": label, "money": key in MONEY} for key, label in DAILY_FIELDS]}


@router.get("/summary")
def report_summary(
    start: date | None = Query(default=None),
    end: date | None = Query(default=None),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_super_admin),
) -> dict:
    return daily_report(db, *_range(start, end))


def _safe(value) -> str:
    """Spreadsheet-safe text: a leading =, +, - or @ can run as a formula."""
    text = "" if value is None else str(value)
    if text and text[0] in "=+-@\t\r" and not _is_number(text):
        return "'" + text
    return text


def _is_number(text: str) -> bool:
    try:
        Decimal(text)
        return True
    except Exception:
        return False


def _csv(header: list[str], rows) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(header)
    for row in rows:
        writer.writerow([_safe(cell) for cell in row])
    return buffer.getvalue()


def _trips(db: Session, begin: datetime, finish: datetime):
    driver_user = select(Driver.id, User.full_name).join(User, Driver.user_id == User.id).subquery()
    query = (
        select(Ride, RideRequest, User, driver_user.c.full_name, Vehicle.plate_number, Payment)
        .join(RideRequest, Ride.request_id == RideRequest.id)
        .join(User, RideRequest.passenger_user_id == User.id)
        .outerjoin(driver_user, driver_user.c.id == Ride.driver_id)
        .outerjoin(Vehicle, Vehicle.id == Ride.vehicle_id)
        .outerjoin(Payment, Payment.ride_id == Ride.id)
        .where(Ride.assigned_at >= begin, Ride.assigned_at < finish)
        .order_by(Ride.id)
    )
    header = ["Trip", "Request", "Assigned", "Completed", "Status", "Service", "Vehicle type", "Pickup",
              "Destination", "Passengers", "Passenger", "Passenger contact", "Driver", "Plate", "Fare (NGN)",
              "Discount (NGN)",
              "Payment status", "Payment method", "Cancellation fee (NGN)"]
    rows = (
        [ride.id, request.id, _local_text(ride.assigned_at), _local_text(ride.completed_at), ride.status,
         request.service_type, request.vehicle_type, request.origin_text, request.destination_text,
         request.passenger_count, passenger.full_name, passenger.phone or passenger.email or "", driver_name or "",
         plate or "", f"{Decimal(ride.agreed_fare or 0):.2f}", f"{Decimal(request.discount_amount or 0):.2f}",
         payment.status if payment else "unpaid",
         payment.method if payment else "", f"{Decimal(ride.cancellation_fee or 0):.2f}"]
        for ride, request, passenger, driver_name, plate, payment in db.execute(query)
    )
    return header, rows


def _payments(db: Session, begin: datetime, finish: datetime):
    query = (select(Payment).where(Payment.created_at >= begin, Payment.created_at < finish).order_by(Payment.id))
    header = ["Payment", "Trip", "Created", "Confirmed", "Status", "Method", "Amount (NGN)", "Reference",
              "Refund (NGN)", "Refund status", "Refunded"]
    rows = (
        [p.id, p.ride_id, _local_text(p.created_at), _local_text(p.confirmed_at), p.status, p.method,
         f"{Decimal(p.amount or 0):.2f}", p.transfer_reference or p.provider_transaction_ref or "",
         f"{Decimal(p.refund_amount or 0):.2f}", p.refund_status or "", _local_text(p.refunded_at)]
        for p in db.scalars(query)
    )
    return header, rows


def _payouts(db: Session, begin: datetime, finish: datetime):
    query = (
        select(DriverPayout, User.full_name)
        .join(Driver, DriverPayout.driver_id == Driver.id)
        .join(User, Driver.user_id == User.id)
        .where(DriverPayout.created_at >= begin, DriverPayout.created_at < finish)
        .order_by(DriverPayout.id)
    )
    header = ["Payout", "Driver", "Amount (NGN)", "Method", "Status", "Reference", "Bank reference", "Created",
              "Completed", "Failure reason"]
    rows = (
        [p.id, name, f"{Decimal(p.amount):.2f}", p.method, p.status, p.reference, p.bank_reference or "",
         _local_text(p.created_at), _local_text(p.completed_at), p.failure_reason or ""]
        for p, name in db.execute(query)
    )
    return header, rows


@router.get("/export")
def report_export(
    kind: Literal["daily", "trips", "payments", "payouts"] = Query("daily"),
    start: date | None = Query(default=None),
    end: date | None = Query(default=None),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_super_admin),
) -> Response:
    start, end, begin, finish = _range(start, end)
    if kind == "daily":
        report = daily_report(db, start, end, begin, finish)
        header = [label for _, label in DAILY_FIELDS]
        rows = [[row[key] for key, _ in DAILY_FIELDS] for row in report["days"]]
        rows.append(["Total", *[report["totals"][key] for key, _ in DAILY_FIELDS[1:]]])
    else:
        header, rows = {"trips": _trips, "payments": _payments, "payouts": _payouts}[kind](db, begin, finish)
    body = "﻿" + _csv(header, rows)  # the BOM makes Excel read ₦ and accents correctly
    filename = f"ekimove-{kind}-{start.isoformat()}-to-{end.isoformat()}.csv"
    return Response(content=body, media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"',
                             "Cache-Control": "no-store"})
