
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import require_staff
from app.database import get_db
from app.driver_applications import PRIVATE_UPLOAD_DIR
from app.models import Driver, User, Vehicle
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
    statement = select(Driver)

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
            "vehicles": [
                {
                    "id": vehicle.id,
                    "vehicle_type": vehicle.vehicle_type,
                    "plate_number": vehicle.plate_number,
                    "capacity": vehicle.capacity,
                    "is_approved": vehicle.is_approved,
                }
                for vehicle in vehicles
            ],
        })

    return results


@router.get("/driver-applications/{driver_id}/photo")
def driver_application_photo(
    driver_id: int,
    _admin=Depends(require_staff("drivers")),
    db: Session = Depends(get_db),
):
    driver = db.get(Driver, driver_id)
    if driver is None or not driver.photo_path:
        raise HTTPException(status_code=404, detail="Driver photo not found")

    if driver.photo_path.startswith(PHOTO_PREFIX):
        try:
            photo_bytes, content_type = download_driver_photo(driver.photo_path)
        except FileNotFoundError:
            raise HTTPException(
                status_code=404, detail="Driver photo not found"
            ) from None
        except Exception:
            raise HTTPException(
                status_code=502, detail="Unable to retrieve driver photo"
            ) from None

        return Response(
            content=photo_bytes,
            media_type=content_type,
            headers={"Cache-Control": "private, no-store"},
        )

    # Backward compatibility for photos saved before Cloudinary was enabled.
    photo_path = Path(driver.photo_path).resolve()
    upload_root = PRIVATE_UPLOAD_DIR.resolve()

    if (
        not photo_path.is_relative_to(upload_root)
        or not photo_path.is_file()
    ):
        raise HTTPException(status_code=404, detail="Driver photo not found")

    return FileResponse(
        photo_path,
        headers={"Cache-Control": "private, no-store"},
    )


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
