import os
import uuid
from pathlib import Path

from fastapi import Body, APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.auth import hash_password
from app.config import settings
from app.database import get_db
from app.models import Driver, User, Vehicle

router = APIRouter(tags=["driver applications"])

MAX_PHOTO_BYTES = 5 * 1024 * 1024
ALLOWED_IMAGES = {
    "image/jpeg": (".jpg", lambda b: b.startswith(b"\xff\xd8\xff")),
    "image/png": (".png", lambda b: b.startswith(b"\x89PNG\r\n\x1a\n")),
    "image/webp": (".webp", lambda b: b.startswith(b"RIFF") and b[8:12] == b"WEBP"),
}

# Private development storage. Never mount this directory as static content.
PROJECT_ROOT = Path(__file__).resolve().parent.parent
PRIVATE_UPLOAD_DIR = Path(
    os.environ.get("EKIMOVE_PRIVATE_UPLOAD_DIR", str(PROJECT_ROOT / ".private_uploads"))
).resolve()


@router.post("/api/v1/driver-applications", status_code=status.HTTP_201_CREATED)
async def submit_driver_application(
    full_name: str = Form(min_length=2, max_length=160),
    phone: str = Form(min_length=7, max_length=32),
    password: str = Form(min_length=12, max_length=256),
    vehicle_type: str = Form(min_length=2, max_length=32),
    plate_number: str = Form(min_length=2, max_length=32),
    capacity: int = Form(ge=1, le=8),
    face_photo: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """Create a driver account pending review and keep the face photo private."""
    if not settings.jwt_secret_key:
        raise HTTPException(status_code=503, detail="Authentication is not configured")

    full_name = full_name.strip()
    phone = phone.strip()
    vehicle_type = vehicle_type.strip().lower()
    plate_number = plate_number.strip().upper()

    if len(full_name) < 2 or len(phone) < 7:
        raise HTTPException(status_code=422, detail="Enter a valid name and phone number")

    if vehicle_type not in {"motorcycle", "car", "tricycle", "minibus"}:
        raise HTTPException(status_code=422, detail="Unsupported vehicle type")

    if vehicle_type == "motorcycle" and capacity != 1:
        raise HTTPException(status_code=422, detail="Motorcycle capacity must be 1")

    if db.scalar(select(User).where(User.phone == phone)) is not None:
        raise HTTPException(status_code=409, detail="Phone number is already registered")

    if db.scalar(select(Vehicle).where(Vehicle.plate_number == plate_number)) is not None:
        raise HTTPException(status_code=409, detail="Vehicle plate number is already registered")

    content_type = (face_photo.content_type or "").lower()
    image_rule = ALLOWED_IMAGES.get(content_type)
    if image_rule is None:
        raise HTTPException(status_code=415, detail="Upload a JPEG, PNG, or WebP face photo")

    try:
        photo_bytes = await face_photo.read(MAX_PHOTO_BYTES + 1)
    finally:
        await face_photo.close()

    if not photo_bytes or len(photo_bytes) > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=413, detail="Photo must be no larger than 5 MB")

    extension, signature_check = image_rule
    if not signature_check(photo_bytes):
        raise HTTPException(status_code=415, detail="Photo contents do not match the image type")

    PRIVATE_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    photo_name = f"{uuid.uuid4().hex}{extension}"
    photo_path = PRIVATE_UPLOAD_DIR / photo_name

    try:
        # Exclusive creation prevents accidental overwrite.
        with photo_path.open("xb") as photo_file:
            photo_file.write(photo_bytes)

        user = User(
            phone=phone,
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
            photo_path=str(photo_path),
        )
        db.add(driver)
        db.flush()

        db.add(Vehicle(
            driver_id=driver.id,
            vehicle_type=vehicle_type,
            plate_number=plate_number,
            capacity=capacity,
            is_approved=False,
        ))
        db.commit()

        return {
            "status": "pending_review",
            "message": "Application submitted. Your driver and vehicle details must be reviewed before you can accept rides.",
        }

    except IntegrityError:
        db.rollback()
        photo_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=409,
            detail="Phone number or vehicle plate number is already registered",
        ) from None
    except (SQLAlchemyError, OSError):
        db.rollback()
        photo_path.unlink(missing_ok=True)
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
        "vehicles": [
            {
                "vehicle_type": vehicle.vehicle_type,
                "plate_number": vehicle.plate_number,
                "capacity": vehicle.capacity,
                "is_approved": vehicle.is_approved,
            }
            for vehicle in vehicles
        ],
    }

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

    driver.is_online = is_online
    db.commit()
    db.refresh(driver)

    return {
        "is_online": driver.is_online,
        "message": "You are now online" if is_online else "You are now offline",
    }
