
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import require_super_admin
from app.database import get_db
from app.driver_applications import PRIVATE_UPLOAD_DIR
from app.models import Driver, User, Vehicle

router = APIRouter(prefix="/api/v1/admin", tags=["admin driver verification"])


class DecisionRequest(BaseModel):
    decision: str = Field(pattern="^(approve|reject)$")


@router.get("/driver-applications/pending")
def pending_driver_applications(
    status: str = Query(
        default="pending",
        pattern="^(pending|approved|rejected|all)$",
    ),
    _admin=Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    statement = select(Driver)

    if status != "all":
        statement = statement.where(
            Driver.verification_status == status
        )

    drivers = db.scalars(
        statement.order_by(Driver.created_at.asc())
    ).all()

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
            "verification_status": driver.verification_status,
            "photo_available": bool(driver.photo_path),
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
    _admin=Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    driver = db.get(Driver, driver_id)
    if driver is None or not driver.photo_path:
        raise HTTPException(status_code=404, detail="Driver photo not found")

    photo_path = Path(driver.photo_path).resolve()
    upload_root = PRIVATE_UPLOAD_DIR.resolve()

    if (
        not photo_path.is_relative_to(upload_root)
        or not photo_path.is_file()
    ):
        raise HTTPException(status_code=404, detail="Driver photo not found")

    return FileResponse(photo_path)


@router.post("/driver-applications/{driver_id}/decision")
def decide_driver_application(
    driver_id: int,
    payload: DecisionRequest,
    _admin=Depends(require_super_admin),
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
    _admin=Depends(require_super_admin),
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
