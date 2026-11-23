"""Student travel: seats on scheduled buses (e.g. EKSU to Lagos for the holidays).

How it works
- Staff create *departures*: the school (origin), pickup spot, destination,
  date and time, seats, price per seat, and whether a deposit is allowed.
- A student books seats. The seats are held for HOLD_MINUTES while they pay.
  They pay in full, or a deposit (e.g. 50%) and the balance before
  ``balance_due_hours`` ahead of departure.
- Money that lands in the student's personal account number is matched to
  the booking automatically (see instant_payments.paystack_webhook); staff
  can also record cash or bank transfers by hand.
- On the day the student shows the ticket code at the bus; the driver (or
  staff) checks them in. Only fully paid tickets can board.
- When the trip is completed, the bus driver is credited the money collected
  minus EkiMove's commission, and paid out like other earnings.
- Schools get a report: travellers by destination and day. Names are only
  included for students who agreed to share them with their school.
"""

from __future__ import annotations

import csv
import io
import secrets
from datetime import date, datetime, time, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import get_current_user, require_staff
from app.config import settings
from app.database import get_db
from app.models import AuditLog, Driver, EarningEntry, TravelBooking, TravelDeparture, TravelPayment, User, Vehicle

router = APIRouter(prefix="/api/v1", tags=["student travel"])

LAGOS = ZoneInfo("Africa/Lagos")
HOLD_MINUTES = 60                 # unpaid bookings keep their seats this long
BOOKING_CLOSES_HOURS = 2          # no new bookings this close to departure
MAX_SEATS_PER_BOOKING = 4
ACTIVE = ("awaiting_payment", "reserved", "paid")
CONFIRMED = ("reserved", "paid")
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
CENT = Decimal("0.01")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _iso(value: datetime | None) -> str | None:
    value = _aware(value)
    return value.isoformat() if value else None


def _money(value) -> Decimal:
    return Decimal(str(value or 0)).quantize(CENT, rounding=ROUND_HALF_UP)


def _naira(value) -> str:
    return f"NGN {_money(value):,.0f}"


def _audit(db: Session, actor_id: int | None, action: str, entity_type: str, entity_id, details: str) -> None:
    db.add(AuditLog(actor_user_id=actor_id, action=action, entity_type=entity_type,
                    entity_id=str(entity_id), details=details))


def _notify(db: Session, user_ids, title: str, body: str, url: str = "/travel") -> None:
    from app.push import notify  # avoid an import cycle

    notify(db, user_ids, title, body, url=url, tag="travel")


# ---------------------------------------------------------------- rules

def balance_deadline(dep: TravelDeparture) -> datetime:
    return _aware(dep.departs_at) - timedelta(hours=dep.balance_due_hours)


def refund_cutoff(dep: TravelDeparture) -> datetime:
    return _aware(dep.departs_at) - timedelta(hours=dep.refund_cutoff_hours)


def booking_closes(dep: TravelDeparture) -> datetime:
    return _aware(dep.departs_at) - timedelta(hours=BOOKING_CLOSES_HOURS)


def deposit_available(dep: TravelDeparture, now: datetime | None = None) -> bool:
    return bool(dep.allow_deposit and dep.deposit_percent < 100 and (now or _now()) < balance_deadline(dep))


def deposit_per_seat(dep: TravelDeparture) -> Decimal:
    return _money(Decimal(dep.price_per_seat) * dep.deposit_percent / 100)


def balance(booking: TravelBooking) -> Decimal:
    return max(_money(booking.amount_total) - _money(booking.amount_paid), Decimal("0.00"))


def due_now(booking: TravelBooking) -> Decimal:
    """What the student should transfer next."""
    if booking.status not in ACTIVE:
        return Decimal("0.00")
    if _money(booking.amount_paid) == 0 and booking.payment_option == "deposit":
        return _money(booking.deposit_amount)
    return balance(booking)


def expire_holds(db: Session) -> None:
    """Free the seats of bookings that were never paid for."""
    cutoff = _now() - timedelta(minutes=HOLD_MINUTES)
    stale = db.scalars(select(TravelBooking).where(TravelBooking.status == "awaiting_payment",
                                                   TravelBooking.created_at < cutoff)).all()
    for booking in stale:
        if _money(booking.amount_paid) == 0:
            booking.status = "expired"
    if stale:
        db.commit()


def seats_taken(db: Session, departure_id: int) -> int:
    return int(db.scalar(select(func.coalesce(func.sum(TravelBooking.seats), 0)).where(
        TravelBooking.departure_id == departure_id, TravelBooking.status.in_(ACTIVE))) or 0)


def _new_code(db: Session) -> str:
    while True:
        code = "EKT" + "".join(secrets.choice(CODE_ALPHABET) for _ in range(6))
        if db.scalar(select(TravelBooking.id).where(TravelBooking.ticket_code == code)) is None:
            return code


def apply_payment(db: Session, booking: TravelBooking, amount: Decimal, method: str,
                  reference: str | None, actor_id: int | None) -> None:
    amount = _money(amount)
    db.add(TravelPayment(booking_id=booking.id, amount=amount, method=method, reference=reference,
                         recorded_by_user_id=actor_id))
    booking.amount_paid = _money(booking.amount_paid) + amount
    booking.status = "paid" if balance(booking) == 0 else "reserved"
    dep = db.get(TravelDeparture, booking.departure_id)
    _audit(db, actor_id, "travel.payment", "travel_booking", booking.id,
           f"{_naira(amount)} received ({method}) for ticket {booking.ticket_code}.")
    if booking.status == "paid":
        body = f"Your seat to {dep.destination} is fully paid. Show ticket {booking.ticket_code} at the bus."
    else:
        body = (f"Deposit received. Pay the balance of {_naira(balance(booking))} before "
                f"{balance_deadline(dep).astimezone(LAGOS):%a %d %b, %I:%M %p}.")
    _notify(db, booking.user_id, "Payment received", body)


def match_deposit(db: Session, deposit) -> TravelBooking | None:
    """A transfer into a student's account: the oldest booking expecting exactly this amount."""
    if deposit.user_id is None:
        return None
    bookings = db.scalars(select(TravelBooking).where(
        TravelBooking.user_id == deposit.user_id,
        TravelBooking.status.in_(("awaiting_payment", "reserved"))).order_by(TravelBooking.id)).all()
    amount = _money(deposit.amount)
    for booking in bookings:
        dep = db.get(TravelDeparture, booking.departure_id)
        if dep is None or dep.status not in ("open", "closed"):
            continue
        if amount in (due_now(booking), balance(booking)) and amount > 0:
            apply_payment(db, booking, amount, "bank_transfer", f"{deposit.provider}:{deposit.reference}", None)
            deposit.travel_booking_id = booking.id
            deposit.status = "matched"
            return booking
    return None


# ---------------------------------------------------------------- views

def departure_view(db: Session, dep: TravelDeparture, now: datetime | None = None) -> dict:
    now = now or _now()
    left = max(dep.seats_total - seats_taken(db, dep.id), 0)
    return {
        "id": dep.id, "origin": dep.origin, "pickup_spot": dep.pickup_spot,
        "destination": dep.destination, "drop_off": dep.drop_off,
        "departs_at": _iso(dep.departs_at), "seats_total": dep.seats_total, "seats_left": left,
        "price_per_seat": str(_money(dep.price_per_seat)),
        "deposit_available": deposit_available(dep, now), "deposit_percent": dep.deposit_percent,
        "deposit_per_seat": str(deposit_per_seat(dep)),
        "balance_due_at": _iso(balance_deadline(dep)), "refund_cutoff_at": _iso(refund_cutoff(dep)),
        "booking_closes_at": _iso(booking_closes(dep)),
        "bookable": dep.status == "open" and now < booking_closes(dep) and left > 0,
        "operator_name": dep.operator_name, "notes": dep.notes, "status": dep.status,
    }


def booking_view(db: Session, booking: TravelBooking, dep: TravelDeparture | None = None) -> dict:
    dep = dep or db.get(TravelDeparture, booking.departure_id)
    now = _now()
    can_cancel = booking.status in ACTIVE and dep.status in ("open", "closed")
    refund_if_cancelled = (_money(booking.amount_paid)
                           if can_cancel and now < refund_cutoff(dep) else Decimal("0.00"))
    return {
        "id": booking.id, "ticket_code": booking.ticket_code, "status": booking.status,
        "seats": booking.seats, "traveller_names": booking.traveller_names or [],
        "payment_option": booking.payment_option,
        "amount_total": str(_money(booking.amount_total)), "deposit_amount": str(_money(booking.deposit_amount)),
        "amount_paid": str(_money(booking.amount_paid)), "balance": str(balance(booking)),
        "due_now": str(due_now(booking)),
        "hold_expires_at": (_iso(_aware(booking.created_at) + timedelta(minutes=HOLD_MINUTES))
                            if booking.status == "awaiting_payment" and booking.created_at else None),
        "checked_in": booking.checked_in_at is not None, "checked_in_at": _iso(booking.checked_in_at),
        "share_with_school": booking.share_with_school, "matric_number": booking.matric_number,
        "can_cancel": can_cancel, "refund_if_cancelled": str(refund_if_cancelled),
        "refund_amount": str(_money(booking.refund_amount)) if booking.refund_amount is not None else None,
        "refund_status": booking.refund_status,
        "created_at": _iso(booking.created_at),
        "departure": departure_view(db, dep, now),
    }


def _payment_options() -> dict:
    from app.instant_payments import instant_transfers_enabled  # avoid an import cycle

    bank = None
    if settings.bank_transfer_account_number:
        bank = {"bank_name": settings.bank_transfer_bank_name,
                "account_number": settings.bank_transfer_account_number,
                "account_name": settings.bank_transfer_account_name}
    return {"instant": instant_transfers_enabled(), "bank": bank}


# ---------------------------------------------------------------- students

@router.get("/travel/departures")
def list_departures(origin: str | None = Query(default=None, max_length=80),
                    destination: str | None = Query(default=None, max_length=80),
                    db: Session = Depends(get_db)) -> dict:
    """Upcoming departures open for booking (no sign-in needed to look)."""
    expire_holds(db)
    now = _now()
    query = select(TravelDeparture).where(TravelDeparture.status == "open",
                                          TravelDeparture.departs_at > now).order_by(TravelDeparture.departs_at)
    rows = [d for d in db.scalars(query).all() if now < booking_closes(d)]
    origins = sorted({d.origin for d in rows})
    destinations = sorted({d.destination for d in rows})
    if origin:
        rows = [d for d in rows if d.origin.lower() == origin.lower()]
    if destination:
        rows = [d for d in rows if d.destination.lower() == destination.lower()]
    return {"departures": [departure_view(db, d, now) for d in rows],
            "origins": origins, "destinations": destinations}


class BookingIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    departure_id: int
    seats: int = Field(ge=1, le=MAX_SEATS_PER_BOOKING)
    traveller_names: list[str] = Field(min_length=1, max_length=MAX_SEATS_PER_BOOKING)
    payment_option: Literal["full", "deposit"] = "full"
    matric_number: str | None = Field(default=None, max_length=40)
    kin_phone: str | None = Field(default=None, max_length=32)
    share_with_school: bool = False

    @field_validator("traveller_names")
    @classmethod
    def _names(cls, names: list[str]) -> list[str]:
        clean = [" ".join(str(n).split()) for n in names]
        if any(not (2 <= len(n) <= 80) for n in clean):
            raise ValueError("Give each traveller's full name.")
        return clean


@router.post("/travel/bookings", status_code=201)
def book_seats(payload: BookingIn, current_user: User = Depends(get_current_user),
               db: Session = Depends(get_db)) -> dict:
    if current_user.role not in ("passenger", "driver"):
        raise HTTPException(status_code=403, detail="Use a passenger account to book seats.")
    if len(payload.traveller_names) != payload.seats:
        raise HTTPException(status_code=422, detail="Give one name for each seat.")
    expire_holds(db)
    dep = db.scalar(select(TravelDeparture).where(TravelDeparture.id == payload.departure_id).with_for_update())
    now = _now()
    if dep is None or dep.status != "open" or now >= booking_closes(dep):
        raise HTTPException(status_code=409, detail="Booking for this departure has closed.")
    if payload.payment_option == "deposit" and not deposit_available(dep, now):
        raise HTTPException(status_code=409, detail="A deposit isn't possible for this departure any more. "
                                                    "Please pay in full.")
    left = dep.seats_total - seats_taken(db, dep.id)
    if payload.seats > left:
        raise HTTPException(status_code=409, detail=(f"Only {left} seat{'s' if left != 1 else ''} left on this bus."
                                                     if left > 0 else "This bus is full. Choose another departure."))
    total = _money(Decimal(dep.price_per_seat) * payload.seats)
    booking = TravelBooking(
        departure_id=dep.id, user_id=current_user.id, ticket_code=_new_code(db), seats=payload.seats,
        traveller_names=payload.traveller_names, payment_option=payload.payment_option,
        amount_total=total, deposit_amount=_money(deposit_per_seat(dep) * payload.seats),
        amount_paid=Decimal("0.00"), status="awaiting_payment",
        matric_number=(payload.matric_number or "").strip().upper() or None,
        kin_phone=(payload.kin_phone or "").strip() or None, share_with_school=payload.share_with_school,
        created_at=now,
    )
    if total == 0:
        booking.status = "paid"
    db.add(booking)
    db.flush()
    _audit(db, current_user.id, "travel.booked", "travel_booking", booking.id,
           f"{payload.seats} seat(s) to {dep.destination} ({booking.ticket_code}).")
    db.commit()
    return {"booking": booking_view(db, booking, dep), "payment": _payment_options()}


@router.get("/travel/bookings")
def my_bookings(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    expire_holds(db)
    rows = db.scalars(select(TravelBooking).where(TravelBooking.user_id == current_user.id)
                      .order_by(TravelBooking.id.desc()).limit(30)).all()
    return {"bookings": [booking_view(db, b) for b in rows], "payment": _payment_options()}


@router.post("/travel/bookings/{booking_id}/cancel")
def cancel_booking(booking_id: int, current_user: User = Depends(get_current_user),
                   db: Session = Depends(get_db)) -> dict:
    booking = db.get(TravelBooking, booking_id)
    if booking is None or booking.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Booking not found.")
    view = booking_view(db, booking)
    if not view["can_cancel"]:
        raise HTTPException(status_code=409, detail="This booking can't be cancelled.")
    refund = Decimal(view["refund_if_cancelled"])
    booking.status = "cancelled"
    booking.cancelled_at = _now()
    if refund > 0:
        booking.refund_amount, booking.refund_status = refund, "due"
    elif _money(booking.amount_paid) > 0:
        booking.refund_amount = Decimal("0.00")
    _audit(db, current_user.id, "travel.cancelled", "travel_booking", booking.id,
           f"Cancelled by the student; refund due {_naira(refund)}.")
    db.commit()
    return {"booking": booking_view(db, booking)}


# ---------------------------------------------------------------- staff

class DepartureIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    origin: str = Field(min_length=2, max_length=80)
    pickup_spot: str = Field(min_length=3, max_length=160)
    destination: str = Field(min_length=2, max_length=80)
    drop_off: str | None = Field(default=None, max_length=160)
    departs_at: datetime
    seats_total: int = Field(ge=1, le=80)
    price_per_seat: Decimal = Field(ge=0, le=1_000_000)
    allow_deposit: bool = True
    deposit_percent: int = Field(default=50, ge=10, le=100)
    balance_due_hours: int = Field(default=24, ge=0, le=168)
    refund_cutoff_hours: int = Field(default=48, ge=0, le=336)
    operator_name: str | None = Field(default=None, max_length=160)
    driver_id: int | None = None
    vehicle_id: int | None = None
    notes: str | None = Field(default=None, max_length=1000)


def _clean_departure(db: Session, payload: DepartureIn, dep: TravelDeparture | None) -> dict:
    data = payload.model_dump()
    when = data["departs_at"]
    data["departs_at"] = (when.replace(tzinfo=LAGOS) if when.tzinfo is None else when).astimezone(timezone.utc)
    if dep is None and data["departs_at"] <= _now():
        raise HTTPException(status_code=422, detail="The departure time must be in the future.")
    for key in ("origin", "pickup_spot", "destination", "drop_off", "operator_name", "notes"):
        if isinstance(data[key], str):
            data[key] = " ".join(data[key].split()) or None
    if data["vehicle_id"] is not None and data["driver_id"] is None:
        raise HTTPException(status_code=422, detail="Choose the driver for this bus first.")
    if data["driver_id"] is not None:
        driver = db.get(Driver, data["driver_id"])
        if driver is None or driver.verification_status != "approved":
            raise HTTPException(status_code=422, detail="Choose an approved driver.")
    if data["vehicle_id"] is not None:
        vehicle = db.get(Vehicle, data["vehicle_id"])
        if vehicle is None or vehicle.driver_id != data["driver_id"] or not vehicle.is_approved:
            raise HTTPException(status_code=422, detail="That vehicle isn't an approved vehicle of this driver.")
        if data["seats_total"] > vehicle.capacity:
            raise HTTPException(status_code=422, detail=f"This bus has {vehicle.capacity} seats. "
                                                        "Lower the number of seats.")
    if dep is not None:
        taken = seats_taken(db, dep.id)
        if data["seats_total"] < taken:
            raise HTTPException(status_code=422, detail=f"{taken} seats are already booked. "
                                                        "The bus can't have fewer seats than that.")
    return data


def _admin_departure(db: Session, dep: TravelDeparture) -> dict:
    view = departure_view(db, dep)
    bookings = db.scalars(select(TravelBooking).where(TravelBooking.departure_id == dep.id)).all()
    live = [b for b in bookings if b.status in ACTIVE]
    confirmed = [b for b in live if b.status in CONFIRMED]
    driver_name = plate = None
    if dep.driver_id:
        driver = db.get(Driver, dep.driver_id)
        user = db.get(User, driver.user_id) if driver else None
        driver_name = user.full_name if user else None
    if dep.vehicle_id:
        vehicle = db.get(Vehicle, dep.vehicle_id)
        plate = vehicle.plate_number if vehicle else None
    view.update({
        "allow_deposit": dep.allow_deposit, "balance_due_hours": dep.balance_due_hours,
        "refund_cutoff_hours": dep.refund_cutoff_hours, "driver_id": dep.driver_id, "vehicle_id": dep.vehicle_id,
        "driver_name": driver_name, "plate_number": plate,
        "seats_confirmed": sum(b.seats for b in confirmed),
        "seats_held": sum(b.seats for b in live if b.status == "awaiting_payment"),
        "seats_fully_paid": sum(b.seats for b in live if b.status == "paid"),
        "seats_checked_in": sum(b.seats for b in live if b.checked_in_at),
        "money_collected": str(sum((_money(b.amount_paid) for b in bookings), Decimal("0.00"))),
        "balance_outstanding": str(sum((balance(b) for b in confirmed), Decimal("0.00"))),
        "refunds_due": str(sum((_money(b.refund_amount) for b in bookings if b.refund_status == "due"),
                               Decimal("0.00"))),
        "departed_at": _iso(dep.departed_at), "completed_at": _iso(dep.completed_at),
    })
    return view


@router.get("/admin/travel/departures")
def admin_departures(include_past: bool = False, db: Session = Depends(get_db),
                     _staff: User = Depends(require_staff("travel"))) -> list[dict]:
    expire_holds(db)
    query = select(TravelDeparture).order_by(TravelDeparture.departs_at)
    if not include_past:
        query = query.where(TravelDeparture.departs_at > _now() - timedelta(days=3))
    return [_admin_departure(db, d) for d in db.scalars(query).all()]


@router.get("/admin/travel/drivers")
def admin_bus_drivers(db: Session = Depends(get_db), _staff: User = Depends(require_staff("travel"))) -> list[dict]:
    """Approved drivers with an approved travel bus, to put on a departure."""
    rows = db.execute(select(Driver, User, Vehicle).join(User, Driver.user_id == User.id)
                      .join(Vehicle, Vehicle.driver_id == Driver.id)
                      .where(Driver.verification_status == "approved", User.is_active.is_(True),
                             Vehicle.vehicle_type == "bus", Vehicle.is_approved.is_(True))
                      .order_by(User.full_name)).all()
    out: dict[int, dict] = {}
    for driver, user, vehicle in rows:
        entry = out.setdefault(driver.id, {"driver_id": driver.id, "name": user.full_name, "phone": user.phone,
                                           "buses": []})
        entry["buses"].append({"vehicle_id": vehicle.id, "plate_number": vehicle.plate_number,
                               "seats": vehicle.capacity})
    return list(out.values())


@router.post("/admin/travel/departures", status_code=201)
def admin_create_departure(payload: DepartureIn, db: Session = Depends(get_db),
                           staff: User = Depends(require_staff("travel"))) -> dict:
    dep = TravelDeparture(**_clean_departure(db, payload, None), status="open", created_by_user_id=staff.id)
    db.add(dep)
    db.flush()
    _audit(db, staff.id, "travel.departure_created", "travel_departure", dep.id,
           f"{dep.origin} to {dep.destination}, {dep.seats_total} seats at {_naira(dep.price_per_seat)}.")
    db.commit()
    return _admin_departure(db, dep)


def _departure(db: Session, departure_id: int) -> TravelDeparture:
    dep = db.get(TravelDeparture, departure_id)
    if dep is None:
        raise HTTPException(status_code=404, detail="Departure not found.")
    return dep


@router.put("/admin/travel/departures/{departure_id}")
def admin_update_departure(departure_id: int, payload: DepartureIn, db: Session = Depends(get_db),
                           staff: User = Depends(require_staff("travel"))) -> dict:
    dep = _departure(db, departure_id)
    if dep.status not in ("open", "closed"):
        raise HTTPException(status_code=409, detail="This departure can't be changed any more.")
    data = _clean_departure(db, payload, dep)
    moved = _aware(dep.departs_at) != data["departs_at"]
    if dep.price_per_seat != data["price_per_seat"] and seats_taken(db, dep.id):
        raise HTTPException(status_code=409, detail="Seats are already booked at the current price. "
                                                    "Create a new departure for a different price.")
    for key, value in data.items():
        setattr(dep, key, value)
    _audit(db, staff.id, "travel.departure_updated", "travel_departure", dep.id, "Departure details changed.")
    if moved:
        users = db.scalars(select(TravelBooking.user_id).where(TravelBooking.departure_id == dep.id,
                                                               TravelBooking.status.in_(ACTIVE))).all()
        _notify(db, set(users), "Departure time changed",
                f"Your bus to {dep.destination} now leaves {data['departs_at'].astimezone(LAGOS):%a %d %b, %I:%M %p}.")
    db.commit()
    return _admin_departure(db, dep)


def credit_driver(db: Session, dep: TravelDeparture) -> EarningEntry | None:
    """Pay the bus driver what was collected, minus EkiMove's commission."""
    from app.earnings import commission_rate, split_fare  # avoid an import cycle

    if dep.driver_id is None:
        return None
    existing = db.scalar(select(EarningEntry).where(EarningEntry.travel_departure_id == dep.id,
                                                    EarningEntry.kind == "travel"))
    if existing is not None:
        return existing
    bookings = db.scalars(select(TravelBooking).where(TravelBooking.departure_id == dep.id)).all()
    kept = sum((_money(b.amount_paid) - _money(b.refund_amount if b.refund_status else 0) for b in bookings),
               Decimal("0.00"))
    gross, commission, net = split_fare(kept)
    if gross <= 0:
        return None
    entry = EarningEntry(driver_id=dep.driver_id, kind="travel", travel_departure_id=dep.id, gross=gross,
                         commission=commission, commission_percent=commission_rate(), amount=net,
                         note=f"Student travel: {dep.origin} to {dep.destination}, "
                              f"{_aware(dep.departs_at).astimezone(LAGOS):%d %b %Y}")
    db.add(entry)
    return entry


def _set_status(db: Session, dep: TravelDeparture, status: str, actor_id: int | None) -> None:
    allowed = {"open": ("closed",), "closed": ("open",), "departed": ("open", "closed"),
               "completed": ("departed",), "cancelled": ("open", "closed")}
    if dep.status not in allowed.get(status, ()):
        raise HTTPException(status_code=409, detail=f"A {dep.status} departure can't be marked {status}.")
    now = _now()
    dep.status = status
    bookings = db.scalars(select(TravelBooking).where(TravelBooking.departure_id == dep.id)).all()
    if status == "departed":
        dep.departed_at = now
    elif status == "completed":
        dep.completed_at = now
        credit_driver(db, dep)
    elif status == "cancelled":
        dep.cancelled_at = now
        for booking in bookings:
            if booking.status not in ACTIVE:
                continue
            booking.status, booking.cancelled_at = "cancelled", now
            if _money(booking.amount_paid) > 0:
                booking.refund_amount, booking.refund_status = _money(booking.amount_paid), "due"
        _notify(db, {b.user_id for b in bookings if b.status == "cancelled" and b.cancelled_at == now},
                "Departure cancelled",
                f"Sorry, the bus to {dep.destination} was cancelled. Any money you paid will be refunded.")
    _audit(db, actor_id, f"travel.departure_{status}", "travel_departure", dep.id, f"Marked {status}.")


class StatusIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["open", "closed", "departed", "completed", "cancelled"]


@router.post("/admin/travel/departures/{departure_id}/status")
def admin_departure_status(departure_id: int, payload: StatusIn, db: Session = Depends(get_db),
                           staff: User = Depends(require_staff("travel"))) -> dict:
    dep = _departure(db, departure_id)
    _set_status(db, dep, payload.status, staff.id)
    db.commit()
    return _admin_departure(db, dep)


def _manifest_row(db: Session, booking: TravelBooking, private: bool) -> dict:
    user = db.get(User, booking.user_id)
    row = {
        "booking_id": booking.id, "ticket_code": booking.ticket_code, "status": booking.status,
        "seats": booking.seats, "traveller_names": booking.traveller_names or [],
        "booked_by": user.full_name if user else None,
        "fully_paid": booking.status == "paid", "balance": str(balance(booking)),
        "checked_in": booking.checked_in_at is not None,
    }
    if private:
        row.update({"phone": user.phone if user else None, "matric_number": booking.matric_number,
                    "kin_phone": booking.kin_phone, "amount_paid": str(_money(booking.amount_paid)),
                    "amount_total": str(_money(booking.amount_total)), "payment_option": booking.payment_option,
                    "share_with_school": booking.share_with_school,
                    "refund_amount": str(_money(booking.refund_amount)) if booking.refund_amount is not None else None,
                    "refund_status": booking.refund_status, "created_at": _iso(booking.created_at)})
    return row


@router.get("/admin/travel/departures/{departure_id}/manifest")
def admin_manifest(departure_id: int, db: Session = Depends(get_db),
                   _staff: User = Depends(require_staff("travel"))) -> dict:
    dep = _departure(db, departure_id)
    rows = db.scalars(select(TravelBooking).where(TravelBooking.departure_id == dep.id,
                                                  TravelBooking.status != "expired").order_by(TravelBooking.id)).all()
    return {"departure": _admin_departure(db, dep), "bookings": [_manifest_row(db, b, True) for b in rows]}


class PaymentIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    amount: Decimal = Field(gt=0, le=10_000_000)
    method: Literal["cash", "bank_transfer"]
    reference: str | None = Field(default=None, max_length=120)


def _booking(db: Session, booking_id: int) -> TravelBooking:
    booking = db.get(TravelBooking, booking_id)
    if booking is None:
        raise HTTPException(status_code=404, detail="Booking not found.")
    return booking


@router.post("/admin/travel/bookings/{booking_id}/payments")
def admin_record_payment(booking_id: int, payload: PaymentIn, db: Session = Depends(get_db),
                         staff: User = Depends(require_staff("travel", "finance"))) -> dict:
    booking = _booking(db, booking_id)
    if booking.status not in ("awaiting_payment", "reserved", "expired"):
        raise HTTPException(status_code=409, detail="This booking isn't waiting for payment.")
    if booking.status == "expired":
        dep = db.get(TravelDeparture, booking.departure_id)
        if dep.seats_total - seats_taken(db, dep.id) < booking.seats:
            raise HTTPException(status_code=409, detail="This hold expired and the bus has no free seats now.")
        booking.status = "awaiting_payment"
    amount = _money(payload.amount)
    if amount > balance(booking):
        raise HTTPException(status_code=422, detail=f"That's more than the balance of {_naira(balance(booking))}.")
    reference = (payload.reference or "").strip() or None
    if reference and db.scalar(select(TravelPayment.id).where(TravelPayment.reference == reference)):
        raise HTTPException(status_code=409, detail="A payment with this reference is already recorded.")
    apply_payment(db, booking, amount, payload.method, reference, staff.id)
    db.commit()
    return _manifest_row(db, booking, True)


class RefundPaidIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reference: str = Field(min_length=3, max_length=120)


@router.post("/admin/travel/bookings/{booking_id}/refund-paid")
def admin_refund_paid(booking_id: int, payload: RefundPaidIn, db: Session = Depends(get_db),
                      staff: User = Depends(require_staff("travel", "finance"))) -> dict:
    booking = _booking(db, booking_id)
    if booking.refund_status != "due":
        raise HTTPException(status_code=409, detail="No refund is due on this booking.")
    booking.refund_status, booking.refund_reference = "paid", payload.reference.strip()
    _audit(db, staff.id, "travel.refund_paid", "travel_booking", booking.id,
           f"Refund of {_naira(booking.refund_amount)} paid ({booking.refund_reference}).")
    _notify(db, booking.user_id, "Refund sent", f"Your refund of {_naira(booking.refund_amount)} has been sent.")
    db.commit()
    return _manifest_row(db, booking, True)


def _check_in(db: Session, dep: TravelDeparture, code: str, actor_id: int) -> TravelBooking:
    code = "".join(code.split()).upper()
    booking = db.scalar(select(TravelBooking).where(TravelBooking.ticket_code == code))
    if booking is None or booking.departure_id != dep.id:
        raise HTTPException(status_code=404, detail="No ticket with that code on this bus.")
    if dep.status in ("completed", "cancelled"):
        raise HTTPException(status_code=409, detail=f"This departure is {dep.status}.")
    if booking.status != "paid":
        if booking.status == "reserved":
            raise HTTPException(status_code=409, detail=f"Balance of {_naira(balance(booking))} isn't paid yet. "
                                                        "They can pay it in the app now.")
        raise HTTPException(status_code=409, detail="This ticket isn't valid (not paid or cancelled).")
    if booking.checked_in_at is None:
        booking.checked_in_at = _now()
        _audit(db, actor_id, "travel.checked_in", "travel_booking", booking.id, f"Boarded ({booking.ticket_code}).")
    return booking


class CheckInIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str = Field(min_length=4, max_length=20)


@router.post("/admin/travel/departures/{departure_id}/check-in")
def admin_check_in(departure_id: int, payload: CheckInIn, db: Session = Depends(get_db),
                   staff: User = Depends(require_staff("travel"))) -> dict:
    booking = _check_in(db, _departure(db, departure_id), payload.code, staff.id)
    db.commit()
    return _manifest_row(db, booking, True)


class MessageIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    message: str = Field(min_length=3, max_length=300)


@router.post("/admin/travel/departures/{departure_id}/message")
def admin_message_travellers(departure_id: int, payload: MessageIn, db: Session = Depends(get_db),
                             staff: User = Depends(require_staff("travel"))) -> dict:
    dep = _departure(db, departure_id)
    users = set(db.scalars(select(TravelBooking.user_id).where(TravelBooking.departure_id == dep.id,
                                                               TravelBooking.status.in_(CONFIRMED))).all())
    _notify(db, users, f"Your bus to {dep.destination}", " ".join(payload.message.split()))
    _audit(db, staff.id, "travel.message", "travel_departure", dep.id, f"Message to {len(users)} traveller(s).")
    db.commit()
    return {"sent_to": len(users)}


def _report_rows(db: Session, origin: str | None, date_from: date | None, date_to: date | None):
    query = (select(TravelBooking, TravelDeparture).join(TravelDeparture, TravelBooking.departure_id == TravelDeparture.id)
             .where(TravelBooking.status.in_(CONFIRMED), TravelDeparture.status != "cancelled"))
    if origin:
        query = query.where(func.lower(TravelDeparture.origin) == origin.lower())
    if date_from:
        query = query.where(TravelDeparture.departs_at >= datetime.combine(date_from, time.min, LAGOS))
    if date_to:
        query = query.where(TravelDeparture.departs_at < datetime.combine(date_to + timedelta(days=1), time.min, LAGOS))
    return db.execute(query.order_by(TravelDeparture.departs_at, TravelBooking.id)).all()


@router.get("/admin/travel/report")
def admin_travel_report(origin: str | None = Query(default=None, max_length=80), date_from: date | None = None,
                        date_to: date | None = None, db: Session = Depends(get_db),
                        _staff: User = Depends(require_staff("travel"))) -> dict:
    rows = _report_rows(db, origin, date_from, date_to)
    by_destination: dict[str, dict] = {}
    by_day: dict[str, int] = {}
    departures = set()
    for booking, dep in rows:
        entry = by_destination.setdefault(dep.destination, {"destination": dep.destination, "travellers": 0,
                                                            "departures": set()})
        entry["travellers"] += booking.seats
        entry["departures"].add(dep.id)
        day = _aware(dep.departs_at).astimezone(LAGOS).date().isoformat()
        by_day[day] = by_day.get(day, 0) + booking.seats
        departures.add(dep.id)
    return {
        "origin": origin, "date_from": date_from.isoformat() if date_from else None,
        "date_to": date_to.isoformat() if date_to else None,
        "travellers": sum(b.seats for b, _ in rows), "departures": len(departures),
        "boarded": sum(b.seats for b, _ in rows if b.checked_in_at),
        "by_destination": sorted(({**e, "departures": len(e["departures"])} for e in by_destination.values()),
                                 key=lambda e: -e["travellers"]),
        "by_day": [{"date": d, "travellers": n} for d, n in sorted(by_day.items())],
        "named_travellers": sum(b.seats for b, _ in rows if b.share_with_school),
    }


@router.get("/admin/travel/report.csv")
def admin_travel_report_csv(origin: str | None = Query(default=None, max_length=80), date_from: date | None = None,
                            date_to: date | None = None, db: Session = Depends(get_db),
                            staff: User = Depends(require_staff("travel"))) -> Response:
    """Travellers for the school. Names only for students who agreed to share them."""
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["Date", "Time", "From", "To", "Traveller", "Matric number", "Ticket", "Boarded"])
    hidden = 0
    for booking, dep in _report_rows(db, origin, date_from, date_to):
        when = _aware(dep.departs_at).astimezone(LAGOS)
        if not booking.share_with_school:
            hidden += booking.seats
            continue
        for name in booking.traveller_names or []:
            writer.writerow([f"{when:%Y-%m-%d}", f"{when:%H:%M}", dep.origin, dep.destination, name,
                             booking.matric_number or "", booking.ticket_code,
                             "Yes" if booking.checked_in_at else "No"])
    if hidden:
        writer.writerow([])
        writer.writerow([f"{hidden} more traveller(s) did not agree to share their names and are only counted."])
    _audit(db, staff.id, "travel.report_exported", "travel_report", origin or "all", "School travel list exported.")
    db.commit()
    name = f"ekimove-travel-{(origin or 'all').lower().replace(' ', '-')}.csv"
    return Response(out.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


# ---------------------------------------------------------------- bus drivers

def _my_driver(db: Session, user: User) -> Driver:
    driver = db.scalar(select(Driver).where(Driver.user_id == user.id))
    if driver is None:
        raise HTTPException(status_code=403, detail="Only drivers can do this.")
    return driver


@router.get("/driver/travel")
def driver_departures(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[dict]:
    driver = _my_driver(db, current_user)
    deps = db.scalars(select(TravelDeparture).where(
        TravelDeparture.driver_id == driver.id, TravelDeparture.status != "cancelled",
        TravelDeparture.departs_at > _now() - timedelta(days=2)).order_by(TravelDeparture.departs_at)).all()
    out = []
    for dep in deps:
        rows = db.scalars(select(TravelBooking).where(TravelBooking.departure_id == dep.id,
                                                      TravelBooking.status.in_(CONFIRMED))
                          .order_by(TravelBooking.id)).all()
        view = departure_view(db, dep)
        view["passengers"] = [_manifest_row(db, b, False) for b in rows]
        view["seats_booked"] = sum(b.seats for b in rows)
        view["seats_checked_in"] = sum(b.seats for b in rows if b.checked_in_at)
        out.append(view)
    return out


def _drivers_departure(db: Session, user: User, departure_id: int) -> TravelDeparture:
    driver = _my_driver(db, user)
    dep = db.get(TravelDeparture, departure_id)
    if dep is None or dep.driver_id != driver.id:
        raise HTTPException(status_code=404, detail="Departure not found.")
    return dep


@router.post("/driver/travel/{departure_id}/check-in")
def driver_check_in(departure_id: int, payload: CheckInIn, current_user: User = Depends(get_current_user),
                    db: Session = Depends(get_db)) -> dict:
    booking = _check_in(db, _drivers_departure(db, current_user, departure_id), payload.code, current_user.id)
    db.commit()
    return _manifest_row(db, booking, False)


class DriverStatusIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["departed", "completed"]


@router.post("/driver/travel/{departure_id}/status")
def driver_departure_status(departure_id: int, payload: DriverStatusIn,
                            current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    dep = _drivers_departure(db, current_user, departure_id)
    _set_status(db, dep, payload.status, current_user.id)
    db.commit()
    return departure_view(db, dep)
