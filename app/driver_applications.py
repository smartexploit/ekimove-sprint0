from datetime import datetime, timedelta, timezone
import os
import re
from pathlib import Path

from fastapi import BackgroundTasks, Body, APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.auth import hash_password
from app.config import settings
from app.client_ip import client_ip
from app.contacts import ContactError, clean_email, clean_name, clean_phone, email_taken, password_problem, phone_taken
from app.rate_limit import enforce as enforce_rate_limit
from app.database import get_db
from app.app_settings import HAULAGE_TYPES
from app.models import Driver, User, Vehicle
from app import onboarding
from app.photo_storage import PhotoStorageError, upload_driver_photo, delete_driver_photo

router = APIRouter(tags=["driver applications"])

# What a driver can sign up with: a motorcycle, a car, or a moving vehicle
# (a big car, van or Dyna truck for moving jobs). Each has a passenger limit.
MOVING_VEHICLE_TYPES = set(HAULAGE_TYPES)
# Travel buses carry students on long trips (seats booked ahead); they never get town rides.
TRAVEL_VEHICLE_TYPES = {"bus"}
DRIVER_VEHICLE_TYPES = {"motorcycle", "car"} | MOVING_VEHICLE_TYPES | TRAVEL_VEHICLE_TYPES
SEAT_LIMITS = {"motorcycle": 2, "car": 4, "big_car": 6, "van": 8, "dyna": 2, "bus": 60}
PLATE_PATTERN = r"[A-Z0-9][A-Z0-9 -]{3,13}[A-Z0-9]"


def clean_plate(plate_number: str) -> str:
    return " ".join(str(plate_number or "").strip().upper().split())


def vehicle_problem(vehicle_type: str, capacity: int) -> str | None:
    """Why this vehicle can't be registered, or None."""
    if vehicle_type not in DRIVER_VEHICLE_TYPES:
        return "Choose your vehicle: a motorcycle, a car, a moving vehicle (big car, van or Dyna truck) or a travel bus."
    limit = SEAT_LIMITS[vehicle_type]
    if capacity > limit:
        name = HAULAGE_TYPES.get(vehicle_type, vehicle_type.replace("_", " ")).split(" (")[0].lower()
        return f"A {name} can carry {limit} passenger{'s' if limit != 1 else ''} at most"
    return None

MAX_PHOTO_BYTES = 5 * 1024 * 1024
ALLOWED_IMAGES = {
    "image/jpeg": (".jpg", lambda b: b.startswith(b"\xff\xd8\xff")),
    "image/png": (".png", lambda b: b.startswith(b"\x89PNG\r\n\x1a\n")),
    "image/webp": (".webp", lambda b: b.startswith(b"RIFF") and b[8:12] == b"WEBP"),
}
OLDEST_VEHICLE_YEAR = 1980


def clean_vehicle_details(make_model: str, year: int, color: str) -> tuple[str, int, str]:
    """Tidy and check the make/model, year and colour a driver typed."""
    make_model = " ".join(str(make_model or "").split())
    color = " ".join(str(color or "").split())
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 .,'()/&-]{1,79}", make_model):
        raise HTTPException(status_code=422, detail="Enter the make and model, like Toyota Corolla or Bajaj Boxer.")
    latest = datetime.now(timezone.utc).year + 1
    if not OLDEST_VEHICLE_YEAR <= int(year) <= latest:
        raise HTTPException(status_code=422, detail=f"Enter the year the vehicle was made, "
                                                    f"between {OLDEST_VEHICLE_YEAR} and {latest}.")
    if not re.fullmatch(r"[A-Za-z][A-Za-z /-]{1,39}", color):
        raise HTTPException(status_code=422, detail="Enter the vehicle's colour, like Silver or Black.")
    return make_model, int(year), color.title()


async def read_image(upload: UploadFile, what: str) -> bytes:
    """Read an uploaded photo, checking its type, size and contents."""
    image_rule = ALLOWED_IMAGES.get((upload.content_type or "").lower())
    if image_rule is None:
        raise HTTPException(status_code=415, detail=f"Upload a JPEG, PNG, or WebP {what}")
    try:
        data = await upload.read(MAX_PHOTO_BYTES + 1)
    finally:
        await upload.close()
    if not data or len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=413, detail=f"The {what} must be no larger than 5 MB")
    if not image_rule[1](data):
        raise HTTPException(status_code=415, detail=f"The {what} file does not match its image type")
    return data

# Private development storage. Never mount this directory as static content.
PROJECT_ROOT = Path(__file__).resolve().parent.parent
PRIVATE_UPLOAD_DIR = Path(
    os.environ.get("EKIMOVE_PRIVATE_UPLOAD_DIR", str(PROJECT_ROOT / ".private_uploads"))
).resolve()


@router.post("/api/v1/driver-applications", status_code=status.HTTP_201_CREATED)
async def submit_driver_application(
    request: Request,
    background: BackgroundTasks,
    full_name: str = Form(min_length=2, max_length=160),
    phone: str = Form(min_length=7, max_length=32),
    password: str = Form(min_length=12, max_length=128),
    vehicle_type: str = Form(min_length=2, max_length=32),
    plate_number: str = Form(min_length=2, max_length=32),
    capacity: int = Form(ge=1, le=60),
    make_model: str = Form(min_length=2, max_length=80),
    year: int = Form(),
    color: str = Form(min_length=2, max_length=40),
    face_photo: UploadFile = File(...),
    vehicle_photo: UploadFile = File(...),
    accept_policies: bool = Form(False),
    email: str | None = Form(default=None, max_length=254),
    gender: str | None = Form(default=None, max_length=16),
    date_of_birth: str | None = Form(default=None, max_length=10),
    home_address: str | None = Form(default=None, max_length=240),
    town: str | None = Form(default=None, max_length=80),
    licence_number: str | None = Form(default=None, max_length=32),
    emergency_contact_name: str | None = Form(default=None, max_length=160),
    emergency_contact_phone: str | None = Form(default=None, max_length=32),
    safety_pledges: list[str] = Form(default=[]),
    db: Session = Depends(get_db),
):
    """Create a driver account pending review and keep the face photo private."""
    if not settings.jwt_secret_key:
        raise HTTPException(status_code=503, detail="Authentication is not configured")

    try:
        full_name = clean_name(full_name, label="full name")
        phone = clean_phone(phone) or ""
        email = clean_email(email)
    except ContactError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    vehicle_type = vehicle_type.strip().lower()
    plate_number = clean_plate(plate_number)

    if not phone:
        raise HTTPException(status_code=422, detail="Enter a valid name and phone number")
    if not re.fullmatch(PLATE_PATTERN, plate_number):
        raise HTTPException(status_code=422, detail="Enter the plate number as it appears on the vehicle, "
                                                    "like ABC-123DE (letters, numbers and hyphens only).")
    weak = password_problem(password, name=full_name, phone=phone, email=email)
    if weak:
        raise HTTPException(status_code=422, detail=weak)
    enforce_rate_limit("driver-apply", client_ip(request), settings.driver_apply_ip_limit_per_hour, 3600,
                       "Too many applications from this connection. Please try again in an hour.")

    problem = vehicle_problem(vehicle_type, capacity)
    if problem:
        raise HTTPException(status_code=422, detail=problem)
    make_model, year, color = clean_vehicle_details(make_model, year, color)

    details = onboarding.clean_details(
        gender=gender, date_of_birth=date_of_birth, home_address=home_address, town=town,
        licence_number=licence_number, emergency_contact_name=emergency_contact_name,
        emergency_contact_phone=emergency_contact_phone, vehicle_type=vehicle_type, pledges=safety_pledges,
        own_phone=phone,
    )

    if phone_taken(db, phone):
        raise HTTPException(status_code=409, detail="Phone number is already registered")

    if email and email_taken(db, email):
        raise HTTPException(status_code=409, detail="Email address is already registered")

    if db.scalar(select(Vehicle).where(Vehicle.plate_number == plate_number)) is not None:
        raise HTTPException(status_code=409, detail="Vehicle plate number is already registered")

    photo_bytes = await read_image(face_photo, "face photo")
    vehicle_bytes = await read_image(vehicle_photo, "vehicle photo")

    photo_ref = None
    vehicle_ref = None

    try:
        photo_ref = upload_driver_photo(photo_bytes)
        vehicle_ref = upload_driver_photo(vehicle_bytes, folder="vehicle-photos")

        user = User(
            phone=phone,
            email=email,
            full_name=full_name,
            password_hash=hash_password(password),
            role="driver",
            is_active=True,
        )
        db.add(user)
        db.flush()

        driver = Driver(
            user_id=user.id,
            verification_status="pending",
            is_online=False,
            photo_path=photo_ref,
            review_due_at=datetime.now(timezone.utc) + timedelta(hours=onboarding.REVIEW_HOURS),
        )
        onboarding.apply_details(driver, details)
        db.add(driver)
        db.flush()

        db.add(Vehicle(
            driver_id=driver.id,
            vehicle_type=vehicle_type,
            plate_number=plate_number,
            capacity=capacity,
            make_model=make_model,
            year=year,
            color=color,
            photo_path=vehicle_ref,
            is_approved=False,
        ))
        if accept_policies:
            from app.verification import record_policy_acceptance  # avoid an import cycle

            record_policy_acceptance(db, user, request)
        onboarding.welcome_driver(db, user, driver, background)
        from app.push import notify_admins  # avoid an import cycle

        due_label = onboarding.lagos_time(driver.review_due_at)
        notify_admins(db, f"New driver application · {full_name}",
                      f"{vehicle_type.replace('_', ' ').capitalize()} {plate_number}. Review by {due_label}.",
                      url="/admin/drivers", tag=f"driver-app-{driver.id}", permission="drivers")
        db.commit()

        return {
            "status": "pending_review",
            "review_due_at": onboarding.review_info(driver)["review_due_at"],
            "review_due_label": due_label,
            "message": f"Application submitted. We'll review it within {onboarding.REVIEW_HOURS} hours "
                       f"(by {due_label}).",
        }

    except IntegrityError:
        db.rollback()
        delete_driver_photo(photo_ref)
        delete_driver_photo(vehicle_ref)
        raise HTTPException(
            status_code=409,
            detail="Phone number or vehicle plate number is already registered",
        ) from None
    except (SQLAlchemyError, OSError, PhotoStorageError):
        db.rollback()
        delete_driver_photo(photo_ref)
        delete_driver_photo(vehicle_ref)
        raise HTTPException(
            status_code=503,
            detail="Unable to submit the application. Please try again later.",
        ) from None
from app.auth import get_current_user


@router.get("/api/v1/driver-applications/me")
def get_my_driver_application(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return the authenticated driver's own review status, never their photo path."""
    if current_user.role != "driver":
        raise HTTPException(status_code=403, detail="Driver account required")

    driver = db.scalar(
        select(Driver).where(Driver.user_id == current_user.id)
    )
    if driver is None:
        raise HTTPException(status_code=404, detail="Driver application not found")

    vehicles = db.scalars(
        select(Vehicle).where(Vehicle.driver_id == driver.id)
    ).all()

    return {
        "verification_status": driver.verification_status,
        "is_online": driver.is_online,
        **onboarding.review_info(driver),
        "details": onboarding.driver_details(driver),
        "details_missing": onboarding.details_missing(driver, vehicles),
        "invitations": onboarding.invitations_for(db, driver.id),
        "vehicles": [vehicle_row(vehicle) for vehicle in vehicles],
    }


def vehicle_details_needed(vehicle: Vehicle) -> bool:
    """True when the vehicle's make and model, year, colour or photo is missing."""
    return not (vehicle.make_model and vehicle.year and vehicle.color and vehicle.photo_path)


def vehicle_name(vehicle: Vehicle | None) -> str | None:
    """How passengers spot the vehicle, e.g. "Silver Toyota Corolla (2012)"."""
    if vehicle is None or not vehicle.make_model:
        return None
    name = f"{vehicle.color} {vehicle.make_model}" if vehicle.color else vehicle.make_model
    return f"{name} ({vehicle.year})" if vehicle.year else name


def vehicle_row(vehicle: Vehicle) -> dict:
    """A vehicle as the driver and reviewers see it, never its photo path."""
    return {
        "id": vehicle.id,
        "vehicle_type": vehicle.vehicle_type,
        "plate_number": vehicle.plate_number,
        "capacity": vehicle.capacity,
        "is_approved": vehicle.is_approved,
        "make_model": vehicle.make_model,
        "year": vehicle.year,
        "color": vehicle.color,
        "photo_available": bool(vehicle.photo_path),
        "details_needed": vehicle_details_needed(vehicle),
    }


@router.post("/api/v1/driver-applications/me/vehicles/{vehicle_id}/details")
async def add_my_vehicle_details(
    vehicle_id: int,
    make_model: str = Form(min_length=2, max_length=80),
    year: int = Form(),
    color: str = Form(min_length=2, max_length=40),
    vehicle_photo: UploadFile | None = File(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Add (or correct) a vehicle's make and model, year, colour and photo.

    Open while the vehicle awaits approval, or once for drivers who applied
    before these details were asked for. After that, changes go through support.
    """
    if current_user.role != "driver":
        raise HTTPException(status_code=403, detail="Driver account required")
    driver = db.scalar(select(Driver).where(Driver.user_id == current_user.id))
    vehicle = db.get(Vehicle, vehicle_id)
    if driver is None or vehicle is None or vehicle.driver_id != driver.id:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    if vehicle.is_approved and not vehicle_details_needed(vehicle):
        raise HTTPException(status_code=409, detail="This vehicle is approved, so its details are locked. "
                                                    "Message support to change them.")
    make_model, year, color = clean_vehicle_details(make_model, year, color)
    has_upload = vehicle_photo is not None and bool(vehicle_photo.filename)
    if not has_upload and not vehicle.photo_path:
        raise HTTPException(status_code=422, detail="Add a clear photo of the vehicle.")

    new_ref = None
    try:
        if has_upload:
            new_ref = upload_driver_photo(await read_image(vehicle_photo, "vehicle photo"), folder="vehicle-photos")
        old_ref = vehicle.photo_path if new_ref else None
        vehicle.make_model, vehicle.year, vehicle.color = make_model, year, color
        if new_ref:
            vehicle.photo_path = new_ref
        db.commit()
    except (SQLAlchemyError, OSError, PhotoStorageError):
        db.rollback()
        delete_driver_photo(new_ref)
        raise HTTPException(status_code=503, detail="Unable to save the vehicle details. Please try again.") from None
    delete_driver_photo(old_ref)
    return vehicle_row(vehicle)

@router.patch("/api/v1/driver-applications/me/online")
def set_my_driver_online_status(
    is_online: bool = Body(..., embed=True),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Set online status for an eligible, authenticated driver."""
    if current_user.role != "driver":
        raise HTTPException(status_code=403, detail="Driver account required")

    if not current_user.is_active:
        raise HTTPException(status_code=403, detail="Driver account is inactive")

    driver = db.scalar(
        select(Driver).where(Driver.user_id == current_user.id)
    )
    if driver is None:
        raise HTTPException(status_code=404, detail="Driver application not found")

    if is_online:
        if driver.verification_status != "approved":
            raise HTTPException(
                status_code=409,
                detail="Driver profile must be approved before going online",
            )

        approved_vehicle = db.scalar(
            select(Vehicle.id).where(
                Vehicle.driver_id == driver.id,
                Vehicle.is_approved.is_(True),
            ).limit(1)
        )
        if approved_vehicle is None:
            raise HTTPException(
                status_code=409,
                detail="At least one approved vehicle is required to go online",
            )

    if is_online and not driver.is_online:
        driver.online_since = datetime.now(timezone.utc)
    if not is_online:
        from app.dispatch import driver_went_offline  # avoid an import cycle

        driver_went_offline(db, driver)
    driver.is_online = is_online
    db.commit()
    db.refresh(driver)

    return {
        "is_online": driver.is_online,
        "message": "You are now online" if is_online else "You are now offline",
    }
