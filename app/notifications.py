"""The phone notifications EkiMove sends, in one place.

Each function queues a push (sent after the caller commits). Keep texts
short: phones show about two lines.
"""

from __future__ import annotations

from decimal import Decimal

from sqlalchemy.orm import Session

from app.models import Driver, Ride, RideRequest, User, Vehicle
from app.push import notify, notify_admins


def _route(request: RideRequest) -> str:
    return f"{request.origin_text} → {request.destination_text}"


def _naira(amount) -> str:
    return f"₦{Decimal(amount or 0):,.0f}"


def _first_name(user: User | None) -> str:
    return (user.full_name or "Your driver").split()[0] if user else "Your driver"


def _driver_user_id(db: Session, driver_id: int) -> int | None:
    driver = db.get(Driver, driver_id)
    return driver.user_id if driver else None


def trip_offered(db: Session, request: RideRequest, driver: Driver, seconds: int) -> None:
    kind = "Load" if request.service_type == "haulage" else "Trip"
    notify(db, driver.user_id, f"New {kind.lower()} offer · {_naira(request.quoted_fare)}",
           f"{_route(request)}. Accept within {seconds} seconds.", url="/driver/trips", tag=f"offer-{request.id}",
           urgent=True, ttl=max(seconds, 30))


def driver_assigned(db: Session, request: RideRequest, driver: Driver, vehicle: Vehicle) -> None:
    driver_user = db.get(User, driver.user_id)
    notify(db, request.passenger_user_id, "Your driver is assigned",
           f"{_first_name(driver_user)} · {vehicle.plate_number}. Pay in My rides so the trip can start.",
           url="/my-rides", tag=f"ride-{request.id}", urgent=True)


def ride_status(db: Session, ride: Ride, request: RideRequest) -> None:
    texts = {
        "driver_arriving": ("Your driver has arrived", "Check the plate, then give your pickup PIN."),
        "in_progress": ("Trip started", "Have a safe trip. You can share your live trip from My rides."),
        "completed": ("Trip completed", "Thanks for riding with EkiMove. Tap to rate your driver."),
    }
    if ride.status in texts:
        title, body = texts[ride.status]
        notify(db, request.passenger_user_id, title, body, url="/my-rides", tag=f"ride-{request.id}",
               urgent=ride.status == "driver_arriving")


def payment_confirmed(db: Session, ride: Ride) -> None:
    request = db.get(RideRequest, ride.request_id)
    if request is None:
        return
    notify(db, request.passenger_user_id, "Payment received",
           f"{_naira(ride.agreed_fare)} for {_route(request)} is confirmed.", url="/my-rides",
           tag=f"pay-{ride.id}")
    driver_user_id = _driver_user_id(db, ride.driver_id)
    if driver_user_id:
        notify(db, driver_user_id, "Passenger has paid", f"{_route(request)}. You can start when you meet them.",
               url="/driver/trips", tag=f"pay-{ride.id}")


def ride_cancelled(db: Session, ride: Ride, request: RideRequest, by_user_id: int | None) -> None:
    driver_user_id = _driver_user_id(db, ride.driver_id)
    target = driver_user_id if by_user_id == request.passenger_user_id else request.passenger_user_id
    notify(db, target, "Trip cancelled", f"{_route(request)} was cancelled.",
           url="/driver/trips" if target == driver_user_id else "/my-rides", tag=f"ride-{request.id}")


def quote_ready(db: Session, request: RideRequest) -> None:
    notify(db, request.passenger_user_id, "Your load quote is ready",
           f"{_naira(request.quoted_fare)} for {_route(request)}. Tap to accept or decline.",
           url="/move-a-load", tag=f"quote-{request.id}")


def support_reply(db: Session, user_id: int, thread_id: int, body: str) -> None:
    notify(db, user_id, "EkiMove support replied", body[:120], url=f"/support?thread={thread_id}",
           tag=f"support-{thread_id}")


def support_message(db: Session, thread_id: int, author: User, body: str) -> None:
    notify_admins(db, f"Support: {author.full_name}", body[:120], url=f"/admin/support?thread={thread_id}",
                  tag=f"support-{thread_id}")


def sos_raised(db: Session, ride_id: int, reporter: User) -> None:
    notify_admins(db, "SOS on a live trip", f"Trip #{ride_id}, raised by {reporter.full_name}. Act now.",
                  url="/admin/incidents", tag=f"sos-{ride_id}", urgent=True)


def driver_reviewed(db: Session, driver: Driver, approved: bool) -> None:
    if approved:
        notify(db, driver.user_id, "You're approved to drive",
               "Welcome to EkiMove. Go online to start getting trips.", url="/driver/status", tag="driver-review")
    else:
        notify(db, driver.user_id, "Driver application update",
               "Your application wasn't approved. Open EkiMove for details.", url="/driver/status", tag="driver-review")


def id_reviewed(db: Session, user_id: int, approved: bool) -> None:
    notify(db, user_id, "ID verified" if approved else "ID check needs attention",
           "Your ID is confirmed. Drivers will see you're verified." if approved
           else "We couldn't confirm your ID. Open your profile to see why.", url="/profile", tag="id-review")
