"""Welcome messages, driver application details, the 72-hour review promise,
and invitations to vehicle inspection / app orientation.

Welcome messages cost nothing: an email (when the person gave one and email
is set up; Brevo's free plan covers 300 a day) and a message in their
EkiMove inbox (Support), which everyone can read. No SMS is sent, because
text messages cost money per message.
"""

from __future__ import annotations

import html
import logging
import re
from datetime import date, datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import messaging
from app.auth import get_current_user, require_staff
from app.config import settings
from app.contacts import ContactError, clean_name, clean_phone
from app.database import get_db
from app.models import Driver, DriverInvitation, SupportMessage, SupportThread, User, Vehicle

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1", tags=["driver onboarding"])

REVIEW_HOURS = 72
LAGOS = timezone(timedelta(hours=1))  # Nigeria has no daylight saving.
MIN_AGE, MAX_AGE = 18, 70
# Vehicles that need a driver's licence number on the application.
LICENCE_VEHICLES = {"car", "minibus", "big_car", "van", "dyna"}
GENDERS = {"male": "Male", "female": "Female"}
PLEDGES = {
    "documents": "I hold a valid licence and will carry my licence and vehicle papers on every trip.",
    "sober": "I will never drive after drinking alcohol or taking drugs.",
    "protection": "On a motorcycle, my passenger and I will wear helmets. In a car, everyone wears a seat belt.",
    "road_rules": "I will obey speed limits and traffic rules, and won't use my phone while moving.",
    "respect": "I will treat every passenger with respect. No harassment, threats or overcharging.",
    "roadworthy": "I will keep my vehicle roadworthy and bring it for inspection when EkiMove asks.",
}
INVITE_KINDS = {
    "inspection": "vehicle inspection",
    "orientation": "app orientation",
    "both": "vehicle inspection and app orientation",
}
OPEN_INVITES = ("invited", "confirmed", "reschedule")


def now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _iso(value: datetime | None) -> str | None:
    value = _as_utc(value)
    return value.isoformat() if value else None


def lagos_time(value: datetime) -> str:
    """'Tue 11 Nov, 3:00 PM' in Nigerian time."""
    local = _as_utc(value).astimezone(LAGOS)
    return local.strftime("%a %d %b, %I:%M %p").replace(" 0", " ")


def _first(user: User) -> str:
    return (user.full_name or "there").split()[0]


# --------------------------------------------------------------- details

def clean_details(*, gender, date_of_birth, home_address, town, licence_number, emergency_contact_name,
                  emergency_contact_phone, vehicle_type: str | None, pledges, own_phone: str | None = None) -> dict:
    """Check the application details and return them tidy, or raise 422."""
    def fail(message: str):
        raise HTTPException(status_code=422, detail=message)

    gender = (gender or "").strip().lower()
    if gender not in GENDERS:
        fail("Choose your gender.")
    try:
        born = date_of_birth if isinstance(date_of_birth, date) else date.fromisoformat(str(date_of_birth or "").strip())
    except ValueError:
        fail("Enter your date of birth.")
    today = now().astimezone(LAGOS).date()
    age = today.year - born.year - ((today.month, today.day) < (born.month, born.day))
    if age < MIN_AGE:
        fail(f"You must be at least {MIN_AGE} years old to drive with EkiMove.")
    if age > MAX_AGE:
        fail("Check your date of birth.")
    home_address = " ".join(str(home_address or "").split())
    if len(home_address) < 8 or not re.search(r"[A-Za-z]", home_address):
        fail("Enter your home address (house number, street and area).")
    town = " ".join(str(town or "").split())
    if len(town) < 2 or not re.fullmatch(r"[A-Za-z][A-Za-z .'-]{1,79}", town):
        fail("Enter the town you live in, like Ado-Ekiti or Iworoko.")
    licence = re.sub(r"\s+", "", str(licence_number or "")).upper()
    if vehicle_type in LICENCE_VEHICLES and not licence:
        fail("Enter your driver's licence number. It's required for cars, buses and trucks.")
    if licence and not re.fullmatch(r"[A-Z0-9-]{6,20}", licence):
        fail("Enter the licence number as printed on your licence (letters and numbers only).")
    try:
        contact_name = clean_name(emergency_contact_name or "", label="emergency contact's name")
        contact_phone = clean_phone(emergency_contact_phone or "")
    except ContactError as exc:
        fail(str(exc))
    if not contact_phone:
        fail("Enter a phone number for your emergency contact.")
    if own_phone and contact_phone == own_phone:
        fail("Your emergency contact needs a different phone number from yours.")
    pledged = {str(p).strip() for p in (pledges or [])}
    missing = [key for key in PLEDGES if key not in pledged]
    if missing:
        fail("Tick every safety promise to continue.")
    return {
        "gender": gender, "date_of_birth": born, "home_address": home_address[:240], "town": town[:80],
        "licence_number": licence or None, "emergency_contact_name": contact_name,
        "emergency_contact_phone": contact_phone, "safety_pledges": list(PLEDGES),
    }


def apply_details(driver: Driver, details: dict) -> None:
    for key, value in details.items():
        setattr(driver, key, value)
    driver.safety_pledged_at = now()


def details_missing(driver: Driver, vehicles: list[Vehicle]) -> list[str]:
    missing = []
    for field, label in (("gender", "gender"), ("date_of_birth", "date of birth"), ("home_address", "address"),
                         ("town", "town"), ("emergency_contact_phone", "emergency contact")):
        if not getattr(driver, field):
            missing.append(label)
    if any(v.vehicle_type in LICENCE_VEHICLES for v in vehicles) and not driver.licence_number:
        missing.append("licence number")
    if not driver.safety_pledged_at:
        missing.append("safety promises")
    return missing


def driver_details(driver: Driver) -> dict:
    age = None
    if driver.date_of_birth:
        today = now().astimezone(LAGOS).date()
        born = driver.date_of_birth
        age = today.year - born.year - ((today.month, today.day) < (born.month, born.day))
    return {
        "gender": driver.gender,
        "date_of_birth": driver.date_of_birth.isoformat() if driver.date_of_birth else None,
        "age": age,
        "home_address": driver.home_address,
        "town": driver.town,
        "licence_number": driver.licence_number,
        "emergency_contact_name": driver.emergency_contact_name,
        "emergency_contact_phone": driver.emergency_contact_phone,
        "safety_pledged_at": _iso(driver.safety_pledged_at),
    }


def review_info(driver: Driver) -> dict:
    due = _as_utc(driver.review_due_at)
    overdue = bool(due and driver.verification_status == "pending" and due < now())
    return {
        "review_due_at": _iso(due),
        "review_due_label": lagos_time(due) if due else None,
        "review_overdue": overdue,
        "reviewed_at": _iso(driver.reviewed_at),
    }


def invitation_row(invite: DriverInvitation) -> dict:
    return {
        "id": invite.id,
        "kind": invite.kind,
        "kind_label": INVITE_KINDS[invite.kind],
        "scheduled_for": _iso(invite.scheduled_for),
        "scheduled_label": lagos_time(invite.scheduled_for),
        "venue": invite.venue,
        "notes": invite.notes,
        "status": invite.status,
        "driver_note": invite.driver_note,
        "responded_at": _iso(invite.responded_at),
    }


def invitations_for(db: Session, driver_id: int) -> list[dict]:
    rows = db.scalars(select(DriverInvitation).where(DriverInvitation.driver_id == driver_id)
                      .order_by(DriverInvitation.scheduled_for.desc(), DriverInvitation.id.desc()).limit(10)).all()
    return [invitation_row(row) for row in rows]


# --------------------------------------------------------------- messages

def _support_lines() -> list[str]:
    lines = []
    if settings.support_whatsapp:
        lines.append(f"WhatsApp: {settings.support_whatsapp}")
    if settings.support_phone:
        lines.append(f"Phone: {settings.support_phone}")
    if settings.support_email:
        lines.append(f"Email: {settings.support_email}")
    return lines


def _email_html(heading: str, paragraphs: list[str], steps: list[str], button: tuple[str, str] | None) -> str:
    esc = html.escape
    parts = [f'<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#1f2a24">{esc(p)}</p>'
             for p in paragraphs]
    if steps:
        items = "".join(f'<li style="margin:0 0 8px">{esc(s)}</li>' for s in steps)
        parts.append(f'<ol style="margin:0 0 16px;padding-left:20px;font-size:15px;line-height:1.5;'
                     f'color:#1f2a24">{items}</ol>')
    if button:
        label, url = button
        parts.append(f'<p style="margin:22px 0"><a href="{esc(url)}" style="background:#0f5c3f;color:#ffffff;'
                     f'text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px;'
                     f'display:inline-block">{esc(label)}</a></p>')
    support = _support_lines()
    footer = ("Need help? " + " · ".join(esc(s) for s in support)) if support else "Need help? Reply in the app under Support."
    return f"""<!doctype html><html><body style="margin:0;background:#f3f1ea;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f1ea;padding:24px 12px">
<tr><td align="center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"
 style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden">
<tr><td style="background:#0f5c3f;padding:18px 24px;color:#ffffff;font-size:20px;font-weight:800">EkiMove</td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 14px;font-size:21px;color:#0f2a1e">{esc(heading)}</h1>
{''.join(parts)}
</td></tr>
<tr><td style="padding:16px 24px;background:#f7f6f1;font-size:12px;color:#5b6660;line-height:1.5">{footer}<br>
EkiMove · Rides and deliveries in Ado-Ekiti</td></tr>
</table></td></tr></table></body></html>"""


def _email_text(heading: str, paragraphs: list[str], steps: list[str], button: tuple[str, str] | None) -> str:
    lines = [heading, ""] + [p + "\n" for p in paragraphs]
    lines += [f"{i}. {s}" for i, s in enumerate(steps, 1)]
    if steps:
        lines.append("")
    if button:
        lines += [f"{button[0]}: {button[1]}", ""]
    lines += _support_lines() + ["", "EkiMove · Rides and deliveries in Ado-Ekiti"]
    return "\n".join(lines).strip() + "\n"


def _send_email_now(to: str, subject: str, text: str, html_body: str) -> None:
    try:
        messaging.send_email(to, subject, text, html=html_body)
    except messaging.MessagingError:
        logger.warning("Couldn't send %r to a user", subject)
    except Exception:  # never let an email break the request that queued it
        logger.exception("Unexpected email failure")


def email_user(background: BackgroundTasks | None, user: User, subject: str, heading: str,
               paragraphs: list[str], steps: list[str] | None = None,
               button: tuple[str, str] | None = None) -> bool:
    """Queue a branded email after the response is sent. False if it can't go."""
    if not user.email or not messaging.email_configured():
        return False
    steps = steps or []
    text = _email_text(heading, paragraphs, steps, button)
    body = _email_html(heading, paragraphs, steps, button)
    if background is None:
        _send_email_now(user.email, subject, text, body)
    else:
        background.add_task(_send_email_now, user.email, subject, text, body)
    return True


def inbox_message(db: Session, user: User, subject: str, body: str) -> None:
    """Put a message from the EkiMove team in the person's inbox (Support).

    The conversation starts closed so it doesn't sit in the staff queue; it
    reopens if they reply.
    """
    stamp = now()
    thread = SupportThread(user_id=user.id, subject=subject[:160], status="closed", created_at=stamp,
                           last_message_at=stamp, staff_last_read_at=stamp)
    db.add(thread)
    db.flush()
    db.add(SupportMessage(thread_id=thread.id, sender_user_id=None, from_staff=True, body=body, created_at=stamp))


def _app(path: str) -> str:
    return settings.frontend_url.rstrip("/") + path


PASSENGER_STEPS = [
    "Choose your pickup and destination. You see the full fare before you book.",
    "We ring nearby drivers at once. The first to accept is shown to you with their plate number.",
    "Pay through EkiMove by bank transfer so your trip is recorded.",
    "When the driver arrives, check the plate, then give them your pickup PIN.",
    "Share your live trip with family, and use SOS if anything feels wrong.",
]


def welcome_passenger(db: Session, user: User, background: BackgroundTasks | None) -> None:
    first = _first(user)
    intro = (f"Hi {first}, welcome to EkiMove! You can now book okada and car rides and send packages "
             "around Ado-Ekiti, with the price agreed before you move.")
    inbox_message(db, user, "Welcome to EkiMove", "\n\n".join([
        intro, "How it works:", *[f"{i}. {s}" for i, s in enumerate(PASSENGER_STEPS, 1)],
        "Turn on notifications so you know the moment your driver accepts. Questions? Reply here any time.",
    ]))
    email_user(background, user, f"Welcome to EkiMove, {first}", "Welcome to EkiMove",
               [intro, "Here's how a trip works:"], PASSENGER_STEPS,
               ("Book your first ride", _app("/book-ride")))


def driver_next_steps(due_label: str) -> list[str]:
    return [
        f"We review your details, face photo and vehicle. You'll hear from us by {due_label}.",
        "We may invite you for a short vehicle inspection and app orientation. Bring your licence, "
        "vehicle papers and the vehicle itself.",
        "Once your profile and vehicle are approved, go online in the app to start receiving trips.",
        "Turn on notifications on your phone now, so trip requests ring even when the app is closed.",
    ]


def welcome_driver(db: Session, user: User, driver: Driver, background: BackgroundTasks | None) -> None:
    first = _first(user)
    due = lagos_time(driver.review_due_at)
    intro = (f"Hi {first}, thank you for applying to drive with EkiMove. Your application has been received "
             f"and our team will review it within {REVIEW_HOURS} hours.")
    steps = driver_next_steps(due)
    inbox_message(db, user, "Your EkiMove driver application", "\n\n".join([
        intro, "What happens next:", *[f"{i}. {s}" for i, s in enumerate(steps, 1)],
        "Keep your sign-in details private. EkiMove staff will never ask for your password or PIN.",
    ]))
    email_user(background, user, "We've received your EkiMove driver application", "Application received",
               [intro, "What happens next:"], steps, ("Check your application", _app("/driver/status")))


def application_decided(db: Session, user: User, approved: bool, reason: str | None,
                        background: BackgroundTasks | None) -> None:
    first = _first(user)
    if approved:
        paragraphs = [f"Congratulations {first}, your EkiMove driver profile is approved.",
                      "Once your vehicle is approved too, open the app and tap Go online to start receiving "
                      "trip requests. Keep notifications on so requests ring out loud."]
        subject = "You're approved to drive with EkiMove"
    else:
        paragraphs = [f"Hi {first}, thank you for applying. We couldn't approve your driver application this time."]
        if reason:
            paragraphs.append(f"Reason: {reason}")
        paragraphs.append("If you think this is a mistake or you can fix it, message EkiMove support.")
        subject = "Your EkiMove driver application"
    inbox_message(db, user, subject, "\n\n".join(paragraphs))
    email_user(background, user, subject, subject, paragraphs, button=("Open EkiMove", _app("/driver/status")))


# --------------------------------------------------------------- invitations

class InviteIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    driver_ids: list[int] = Field(min_length=1, max_length=100)
    kind: Literal["inspection", "orientation", "both"] = "both"
    scheduled_for: datetime
    venue: str = Field(min_length=4, max_length=240)
    notes: str | None = Field(default=None, max_length=1000)


@router.post("/admin/driver-invitations", status_code=201)
def invite_drivers(payload: InviteIn, background: BackgroundTasks, db: Session = Depends(get_db),
                   admin: User = Depends(require_staff("drivers"))) -> dict:
    """Invite one or more drivers to an inspection and/or orientation session."""
    when = _as_utc(payload.scheduled_for)
    if when < now() + timedelta(minutes=30):
        raise HTTPException(status_code=422, detail="Pick a time at least 30 minutes from now.")
    if when > now() + timedelta(days=60):
        raise HTTPException(status_code=422, detail="Pick a time within the next 60 days.")
    from app.push import notify  # avoid an import cycle

    created = []
    for driver_id in dict.fromkeys(payload.driver_ids):
        driver = db.get(Driver, driver_id)
        user = db.get(User, driver.user_id) if driver else None
        if driver is None or user is None or user.removed_at is not None:
            raise HTTPException(status_code=404, detail=f"Driver #{driver_id} not found.")
        for old in db.scalars(select(DriverInvitation).where(DriverInvitation.driver_id == driver.id,
                                                             DriverInvitation.status.in_(OPEN_INVITES))).all():
            old.status = "cancelled"
            old.outcome_at = now()
        invite = DriverInvitation(driver_id=driver.id, kind=payload.kind, scheduled_for=when, venue=payload.venue,
                                  notes=payload.notes or None, status="invited", created_by_user_id=admin.id,
                                  created_at=now())
        db.add(invite)
        db.flush()
        created.append(invite)
        what = INVITE_KINDS[payload.kind]
        label = lagos_time(when)
        notify(db, user.id, f"You're invited: {what}", f"{label} at {payload.venue}. Tap to confirm.",
               url="/driver/status", tag=f"invite-{invite.id}", urgent=True, ttl=86400)
        paragraphs = [f"Hi {_first(user)}, EkiMove invites you to a {what}.",
                      f"When: {label}", f"Where: {payload.venue}"]
        if payload.notes:
            paragraphs.append(payload.notes)
        paragraphs.append("Please confirm in the app, or tell us if you need another time.")
        steps = []
        if payload.kind in ("inspection", "both"):
            steps.append("Bring the vehicle you registered, clean and with its papers.")
        steps.append("Bring your driver's licence or another photo ID.")
        if payload.kind in ("orientation", "both"):
            steps.append("Bring your phone with EkiMove installed and charged; we'll show you how to take trips.")
        inbox_message(db, user, f"Invitation: {what}", "\n\n".join(
            paragraphs + ["Please bring:"] + [f"• {s}" for s in steps]))
        email_user(background, user, f"EkiMove invitation: {what} on {label}", f"You're invited to a {what}",
                   paragraphs + ["Please bring:"], steps, ("Confirm in the app", _app("/driver/status")))
    db.commit()
    return {"invited": len(created), "invitations": [invitation_row(i) for i in created]}


class OutcomeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["attended", "missed", "cancelled"]


@router.post("/admin/driver-invitations/{invite_id}/outcome")
def invitation_outcome(invite_id: int, payload: OutcomeIn, db: Session = Depends(get_db),
                       _admin: User = Depends(require_staff("drivers"))) -> dict:
    invite = db.get(DriverInvitation, invite_id)
    if invite is None:
        raise HTTPException(status_code=404, detail="Invitation not found.")
    if invite.status not in OPEN_INVITES and not (invite.status in ("attended", "missed")
                                                   and payload.status in ("attended", "missed")):
        raise HTTPException(status_code=409, detail="This invitation is already closed.")
    invite.status = payload.status
    invite.outcome_at = now()
    if payload.status == "cancelled":
        from app.push import notify

        driver = db.get(Driver, invite.driver_id)
        notify(db, driver.user_id, "Invitation cancelled",
               f"The {INVITE_KINDS[invite.kind]} on {lagos_time(invite.scheduled_for)} is cancelled. "
               "We'll send a new time.", url="/driver/status", tag=f"invite-{invite.id}")
    db.commit()
    return invitation_row(invite)


class RespondIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    response: Literal["confirmed", "reschedule"]
    note: str | None = Field(default=None, max_length=300)


def _my_driver(db: Session, user: User) -> Driver:
    if user.role != "driver":
        raise HTTPException(status_code=403, detail="Driver account required")
    driver = db.scalar(select(Driver).where(Driver.user_id == user.id))
    if driver is None:
        raise HTTPException(status_code=404, detail="Driver application not found")
    return driver


@router.post("/driver-applications/me/invitations/{invite_id}/respond")
def respond_to_invitation(invite_id: int, payload: RespondIn, db: Session = Depends(get_db),
                          current_user: User = Depends(get_current_user)) -> dict:
    driver = _my_driver(db, current_user)
    invite = db.get(DriverInvitation, invite_id)
    if invite is None or invite.driver_id != driver.id:
        raise HTTPException(status_code=404, detail="Invitation not found.")
    if invite.status not in OPEN_INVITES:
        raise HTTPException(status_code=409, detail="This invitation is closed.")
    if payload.response == "reschedule" and not payload.note:
        raise HTTPException(status_code=422, detail="Tell us which days and times suit you.")
    invite.status = payload.response
    invite.driver_note = payload.note or None
    invite.responded_at = now()
    from app.push import notify_admins

    what = INVITE_KINDS[invite.kind]
    if payload.response == "confirmed":
        notify_admins(db, f"{current_user.full_name} confirmed", f"{what.capitalize()} on "
                      f"{lagos_time(invite.scheduled_for)}.", url="/admin/drivers", tag=f"invite-{invite.id}", permission="drivers")
    else:
        notify_admins(db, f"{current_user.full_name} needs another time", f"{what.capitalize()}: {payload.note}"[:120],
                      url="/admin/drivers", tag=f"invite-{invite.id}", urgent=True, permission="drivers")
    db.commit()
    return invitation_row(invite)


class DetailsIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    gender: str
    date_of_birth: str
    home_address: str = Field(max_length=240)
    town: str = Field(max_length=80)
    licence_number: str | None = Field(default=None, max_length=32)
    emergency_contact_name: str = Field(max_length=160)
    emergency_contact_phone: str = Field(max_length=32)
    safety_pledges: list[str] = Field(default_factory=list, max_length=20)


@router.patch("/driver-applications/me/details")
def update_my_details(payload: DetailsIn, db: Session = Depends(get_db),
                      current_user: User = Depends(get_current_user)) -> dict:
    """Fill in (or correct) the application details while the review is open.

    Approved drivers who applied before these details were asked for can
    fill them in once; after that, changes go through support.
    """
    driver = _my_driver(db, current_user)
    vehicles = db.scalars(select(Vehicle).where(Vehicle.driver_id == driver.id)).all()
    if driver.verification_status != "pending" and not details_missing(driver, vehicles):
        raise HTTPException(status_code=409, detail="Your details are locked after review. Message support to "
                                                    "change them.")
    needs_licence = next((v.vehicle_type for v in vehicles if v.vehicle_type in LICENCE_VEHICLES), None)
    details = clean_details(**payload.model_dump(exclude={"safety_pledges"}), pledges=payload.safety_pledges,
                            vehicle_type=needs_licence, own_phone=current_user.phone)
    apply_details(driver, details)
    db.commit()
    return {"details": driver_details(driver), "details_missing": details_missing(driver, vehicles)}


@router.get("/driver-applications/requirements")
def application_requirements() -> dict:
    """The safety promises and rules the application form shows."""
    return {
        "pledges": [{"key": k, "text": v} for k, v in PLEDGES.items()],
        "licence_vehicles": sorted(LICENCE_VEHICLES),
        "min_age": MIN_AGE,
        "review_hours": REVIEW_HOURS,
    }
