
import re
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import require_staff
from app.database import get_db
from app.driver_applications import (PLATE_PATTERN, PRIVATE_UPLOAD_DIR, clean_plate, clean_vehicle_details,
                                     vehicle_problem, vehicle_row)
from app.models import AuditLog, Driver, User, Vehicle
from app import onboarding
from app.photo_storage import PHOTO_PREFIX, download_driver_photo

router = APIRouter(prefix="/api/v1/admin", tags=["admin driver verification"])


class DecisionRequest(BaseModel):
    decision: str = Field(pattern="^(approve|reject)$")
    reason: str | None = Field(default=None, max_length=300)


@router.get("/driver-applications/pending")
def pending_driver_applications(
    status: str = Query(
        default="pending",
        pattern="^(pending|approved|rejected|all)$",
    ),
    _admin=Depends(require_staff("drivers")),
    db: Session = Depends(get_db),
):
    # Removed drivers no longer appear here; their history stays on record.
    statement = select(Driver).join(User, User.id == Driver.user_id).where(User.removed_at.is_(None))

    if status != "all":
        statement = statement.where(
            Driver.verification_status == status
        )

    # Pending: the review due soonest first. Others: newest first.
    order = ((Driver.review_due_at.is_(None), Driver.review_due_at.asc(), Driver.created_at.asc())
             if status == "pending" else (Driver.created_at.desc(),))
    drivers = db.scalars(statement.order_by(*order)).all()

    results = []
    for driver in drivers:
        user = db.get(User, driver.user_id)
        vehicles = db.scalars(
            select(Vehicle).where(Vehicle.driver_id == driver.id)
        ).all()

        results.append({
            "driver_id": driver.id,
            "full_name": user.full_name if user else "Unavailable",
            "phone": user.phone if user else None,
            "email": user.email if user else None,
            "verification_status": driver.verification_status,
            "photo_available": bool(driver.photo_path),
            "applied_at": onboarding._iso(driver.created_at),
            **onboarding.review_info(driver),
            "details": onboarding.driver_details(driver),
            "details_missing": onboarding.details_missing(driver, vehicles),
            "invitations": onboarding.invitations_for(db, driver.id),
            "vehicles": [vehicle_row(vehicle) for vehicle in vehicles],
        })

    return results


def _private_photo(photo_ref: str | None, missing: str):
    """Stream a private photo to a reviewer without exposing where it is stored."""
    if not photo_ref:
        raise HTTPException(status_code=404, detail=missing)

    if photo_ref.startswith(PHOTO_PREFIX):
        try:
            photo_bytes, content_type = download_driver_photo(photo_ref)
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail=missing) from None
        except Exception:
            raise HTTPException(status_code=502, detail="Unable to retrieve the photo") from None

        return Response(
            content=photo_bytes,
            media_type=content_type,
            headers={"Cache-Control": "private, no-store"},
        )

    # Backward compatibility for photos saved before Cloudinary was enabled.
    photo_path = Path(photo_ref).resolve()
    upload_root = PRIVATE_UPLOAD_DIR.resolve()

    if (
        not photo_path.is_relative_to(upload_root)
        or not photo_path.is_file()
    ):
        raise HTTPException(status_code=404, detail=missing)

    return FileResponse(
        photo_path,
        headers={"Cache-Control": "private, no-store"},
    )


@router.get("/driver-applications/{driver_id}/photo")
def driver_application_photo(
    driver_id: int,
    _admin=Depends(require_staff("drivers")),
    db: Session = Depends(get_db),
):
    driver = db.get(Driver, driver_id)
    return _private_photo(driver.photo_path if driver else None, "Driver photo not found")


@router.get("/driver-vehicles/{vehicle_id}/photo")
def driver_vehicle_photo(
    vehicle_id: int,
    _admin=Depends(require_staff("drivers")),
    db: Session = Depends(get_db),
):
    vehicle = db.get(Vehicle, vehicle_id)
    return _private_photo(vehicle.photo_path if vehicle else None, "Vehicle photo not found")


@router.post("/driver-applications/{driver_id}/decision")
def decide_driver_application(
    driver_id: int,
    payload: DecisionRequest,
    background: BackgroundTasks,
    _admin=Depends(require_staff("drivers")),
    db: Session = Depends(get_db),
):
    driver = db.get(Driver, driver_id)
    if driver is None:
        raise HTTPException(status_code=404, detail="Driver not found")

    if driver.verification_status != "pending":
        raise HTTPException(
            status_code=409,
            detail="This driver application has already been reviewed",
        )

    driver.verification_status = (
        "approved" if payload.decision == "approve" else "rejected"
    )
    driver.is_online = False
    from app import notifications  # avoid an import cycle

    approved = payload.decision == "approve"
    driver.reviewed_at = onboarding.now()
    notifications.driver_reviewed(db, driver, approved)
    user = db.get(User, driver.user_id)
    if user is not None:
        onboarding.application_decided(db, user, approved, (payload.reason or "").strip() or None, background)
    db.commit()

    return {
        "driver_id": driver.id,
        "verification_status": driver.verification_status,
        "message": "Driver application decision saved",
    }


@router.post("/driver-vehicles/{vehicle_id}/decision")
def decide_driver_vehicle(
    vehicle_id: int,
    payload: DecisionRequest,
    _admin=Depends(require_staff("drivers")),
    db: Session = Depends(get_db),
):
    vehicle = db.get(Vehicle, vehicle_id)
    if vehicle is None:
        raise HTTPException(status_code=404, detail="Vehicle not found")

    vehicle.is_approved = payload.decision == "approve"
    db.commit()

    return {
        "vehicle_id": vehicle.id,
        "is_approved": vehicle.is_approved,
        "message": "Vehicle decision saved",
    }


class VehicleUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    vehicle_type: str | None = Field(default=None, min_length=2, max_length=32)
    plate_number: str | None = Field(default=None, min_length=2, max_length=32)
    capacity: int | None = Field(default=None, ge=1, le=60)
    make_model: str | None = Field(default=None, max_length=80)
    year: int | None = None
    color: str | None = Field(default=None, max_length=40)


@router.patch("/driver-vehicles/{vehicle_id}")
def update_driver_vehicle(
    vehicle_id: int,
    payload: VehicleUpdate,
    admin: User = Depends(require_staff("drivers")),
    db: Session = Depends(get_db),
):
    """Correct a vehicle's type, plate, seats, model, year or colour (e.g. a car saved as a motorcycle)."""
    vehicle = db.get(Vehicle, vehicle_id)
    if vehicle is None or vehicle.plate_number.startswith("REMOVED-"):
        raise HTTPException(status_code=404, detail="Vehicle not found")
    def summary() -> str:
        about = ", ".join(str(x) for x in (vehicle.make_model, vehicle.year, vehicle.color) if x)
        return f"{vehicle.vehicle_type}, {vehicle.plate_number}, {vehicle.capacity} seats" + (f", {about}" if about else "")

    before = summary()
    vehicle_type = (payload.vehicle_type or vehicle.vehicle_type).lower()
    capacity = payload.capacity if payload.capacity is not None else vehicle.capacity
    problem = vehicle_problem(vehicle_type, capacity)
    if problem:
        raise HTTPException(status_code=422, detail=problem)
    if payload.plate_number is not None:
        plate = clean_plate(payload.plate_number)
        if not re.fullmatch(PLATE_PATTERN, plate):
            raise HTTPException(status_code=422, detail="Enter the plate number as it appears on the vehicle, "
                                                        "like EKT 123 AB.")
        clash = db.scalar(select(Vehicle).where(Vehicle.plate_number == plate, Vehicle.id != vehicle.id))
        if clash is not None:
            raise HTTPException(status_code=409, detail="Another vehicle already has this plate number.")
        vehicle.plate_number = plate
    vehicle.vehicle_type = vehicle_type
    vehicle.capacity = capacity
    if any(v is not None for v in (payload.make_model, payload.year, payload.color)):
        vehicle.make_model, vehicle.year, vehicle.color = clean_vehicle_details(
            payload.make_model if payload.make_model is not None else vehicle.make_model or "",
            payload.year if payload.year is not None else vehicle.year or 0,
            payload.color if payload.color is not None else vehicle.color or "")
    after = summary()
    if after != before:
        db.add(AuditLog(actor_user_id=admin.id, action="vehicle.updated", entity_type="vehicle",
                        entity_id=str(vehicle.id), details=f"{before} -> {after}"))
    db.commit()
    return {**vehicle_row(vehicle), "message": "Vehicle details saved"}


class RemoveDriverRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    reason: str = Field(min_length=3, max_length=500)


@router.post("/drivers/{driver_id}/remove")
def remove_driver(
    driver_id: int,
    payload: RemoveDriverRequest,
    admin: User = Depends(require_staff("drivers")),
    db: Session = Depends(get_db),
):
    """Remove a driver, approved or not. Their account is closed and their
    personal details cleared; past trips and payments stay on record."""
    from app.accounts import _target, remove_account  # avoid an import cycle

    driver = db.get(Driver, driver_id)
    if driver is None:
        raise HTTPException(status_code=404, detail="Driver not found")
    user = _target(db, driver.user_id, admin)
    if user.role != "driver":
        raise HTTPException(status_code=409, detail="This person also has a staff or passenger role. "
                                                    "Remove them from People instead.")
    remove_account(db, user, admin, payload.reason)
    db.commit()
    return {"driver_id": driver.id, "message": "Driver removed"}
