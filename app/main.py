from datetime import datetime, timezone
from typing import Literal
from app.payments import router as payments_router
from decimal import Decimal, ROUND_HALF_UP
from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.auth import (
    create_access_token,
    get_current_user,
    hash_password,
    require_super_admin,
    verify_password,
)
from app.config import settings
from app.database import engine, get_db
from app.driver_applications import router as driver_applications_router
from app.models import AuditLog, Driver, Fare, Incident, Payment, Ride, RideRequest, User, Vehicle, Zone

from app.admin_driver_verification import router as admin_driver_verification_router
from app.rate_limit import (
    RateLimitUnavailable,
    check_login_allowed,
    record_failed_login,
)

app = FastAPI(
    title=settings.app_name,
    version="0.4.0",
    description=(
        "EkiMove mobility platform API. Pilot scope: Ado-Ekiti. "
        "Payment policy: bank transfer only; cash is not supported."
    ),
)



app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://ekimove.onrender.com",
        "http://localhost:5173",
        "http://localhost:5175",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(driver_applications_router)
app.include_router(admin_driver_verification_router)
app.include_router(payments_router)

class LoginRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    phone: str = Field(min_length=7, max_length=32)
    password: str = Field(min_length=1, max_length=256)


class RegisterRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    phone: str = Field(min_length=7, max_length=32)
    full_name: str = Field(min_length=2, max_length=160)
    password: str = Field(min_length=12, max_length=256)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class CurrentUserResponse(BaseModel):
    id: int
    phone: str
    full_name: str
    role: str
    is_active: bool


class AuthenticatedResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: CurrentUserResponse

class RideRequestCreate(BaseModel):
    """A ride request; passenger identity comes from the access token."""

    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    origin_zone_id: int = Field(gt=0)
    destination_zone_id: int = Field(gt=0)
    origin_text: str = Field(min_length=3, max_length=255)
    destination_text: str = Field(min_length=3, max_length=255)
    vehicle_type: str = Field(min_length=2, max_length=32)
    passenger_count: int = Field(default=1, ge=1, le=8)

class RideStatusUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["driver_arriving", "in_progress", "completed"]


class SOSReport(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    description: str = Field(
        default="SOS alert submitted by a ride participant.",
        min_length=5,
        max_length=1000,
    )


class IncidentReviewUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    status: Literal["investigating", "resolved"]
    note: str = Field(min_length=5, max_length=1000)


class RideRequestCreated(BaseModel):
    id: int
    passenger_user_id: int
    origin_zone_id: int
    destination_zone_id: int
    origin_text: str
    destination_text: str
    vehicle_type: str
    passenger_count: int
    quoted_fare: Decimal
    currency: str = "NGN"
    status: str


class RideAssignment(BaseModel):
    """Driver selected by an authorized dispatcher."""

    model_config = ConfigDict(extra="forbid")
    driver_id: int = Field(gt=0)


@app.get("/api/v1/admin/zones", tags=["admin"])
def admin_list_zones(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_super_admin),
) -> list[dict[str, object]]:
    """Read all pilot zones, including inactive zones, for admin review."""
    zones = db.scalars(select(Zone).order_by(Zone.id)).all()
    return [
        {"id": zone.id, "name": zone.name, "is_active": zone.is_active}
        for zone in zones
    ]


@app.get("/api/v1/admin/fares", tags=["admin"])
def admin_list_fares(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_super_admin),
) -> list[dict[str, object]]:
    """Read all fare rules for admin review; this endpoint never writes."""
    fares = db.scalars(select(Fare).order_by(Fare.id)).all()
    return [
        {
            "id": fare.id,
            "origin_zone_id": fare.origin_zone_id,
            "destination_zone_id": fare.destination_zone_id,
            "vehicle_type": fare.vehicle_type,
            "base_amount": fare.base_amount,
            "vehicle_multiplier": fare.vehicle_multiplier,
            "extra_passenger_amount": fare.extra_passenger_amount,
            "is_active": fare.is_active,
            "currency": "NGN",
        }
        for fare in fares
    ]


@app.get("/api/v1/admin/ride-requests/pending", tags=["admin"])
def admin_list_pending_ride_requests(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_super_admin),
) -> list[dict[str, object]]:
    """List unassigned requests for the admin dispatch queue."""
    rows = db.execute(
        select(RideRequest, User)
        .join(User, RideRequest.passenger_user_id == User.id)
        .where(RideRequest.status == "requested")
        .order_by(RideRequest.created_at.asc(), RideRequest.id.asc())
    ).all()

    return [
        {
            "id": request.id,
            "passenger_name": passenger.full_name,
            "origin_text": request.origin_text,
            "destination_text": request.destination_text,
            "vehicle_type": request.vehicle_type,
            "passenger_count": request.passenger_count,
            "quoted_fare": float(request.quoted_fare),
            "currency": "NGN",
            "status": request.status,
            "created_at": request.created_at.isoformat() if request.created_at else None,
        }
        for request, passenger in rows
    ]


@app.get(
    "/api/v1/admin/ride-requests/{request_id}/eligible-drivers",
    tags=["admin"],
)
def admin_list_eligible_drivers(
    request_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_super_admin),
) -> list[dict[str, object]]:
    """List approved, online drivers with a suitable approved vehicle."""
    ride_request = db.get(RideRequest, request_id)
    if ride_request is None:
        raise HTTPException(status_code=404, detail="Ride request not found")
    if ride_request.status != "requested":
        raise HTTPException(
            status_code=409,
            detail="Only pending ride requests can be dispatched",
        )

    rows = db.execute(
        select(Driver, User, Vehicle)
        .join(User, Driver.user_id == User.id)
        .join(Vehicle, Vehicle.driver_id == Driver.id)
        .where(
            Driver.verification_status == "approved",
            Driver.is_online.is_(True),
            User.is_active.is_(True),
            Vehicle.is_approved.is_(True),
            Vehicle.vehicle_type == ride_request.vehicle_type,
            Vehicle.capacity >= ride_request.passenger_count,
        )
        .order_by(Driver.id.asc(), Vehicle.id.asc())
    ).all()

    # The assignment endpoint accepts a driver ID and selects a matching
    # approved vehicle itself. Show each driver only once in this list.
    eligible = {}
    for driver, user, vehicle in rows:
        if driver.id not in eligible:
            eligible[driver.id] = {
                "driver_id": driver.id,
                "full_name": user.full_name,
                "vehicle_id": vehicle.id,
                "vehicle_type": vehicle.vehicle_type,
                "plate_number": vehicle.plate_number,
                "capacity": vehicle.capacity,
            }

    return list(eligible.values())


@app.post(
    "/api/v1/admin/ride-requests/{request_id}/assign",
    tags=["admin"],
    status_code=status.HTTP_201_CREATED,
)
def assign_ride_request(
    request_id: int,
    payload: RideAssignment,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_super_admin),
) -> dict[str, object]:
    """Assign a requested booking to an approved, online driver."""
    ride_request = db.get(RideRequest, request_id)
    if ride_request is None:
        raise HTTPException(status_code=404, detail="Ride request not found")

    if ride_request.status != "requested":
        raise HTTPException(
            status_code=409,
            detail="Only unassigned ride requests can be assigned",
        )

    driver = db.get(Driver, payload.driver_id)
    if driver is None:
        raise HTTPException(status_code=404, detail="Driver not found")

    if driver.verification_status != "approved" or not driver.is_online:
        raise HTTPException(
            status_code=409,
            detail="Driver must be approved and online",
        )

    driver_user = db.get(User, driver.user_id)
    if driver_user is None or not driver_user.is_active:
        raise HTTPException(
            status_code=409,
            detail="Driver account is not active",
        )

    vehicle = db.scalar(
        select(Vehicle)
        .where(
            Vehicle.driver_id == driver.id,
            Vehicle.is_approved.is_(True),
            Vehicle.vehicle_type == ride_request.vehicle_type,
            Vehicle.capacity >= ride_request.passenger_count,
        )
        .order_by(Vehicle.id)
    )
    if vehicle is None:
        raise HTTPException(
            status_code=409,
            detail="Driver has no approved matching vehicle with sufficient capacity",
        )

    ride = Ride(
        request_id=ride_request.id,
        driver_id=driver.id,
        status="assigned",
        agreed_fare=Decimal(ride_request.quoted_fare),
    )
    ride_request.status = "assigned"
    db.add(ride)

    try:
        db.commit()
        db.refresh(ride)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Ride request has already been assigned",
        ) from None
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Unable to assign ride request",
        ) from exc

    return {
        "ride_id": ride.id,
        "request_id": ride.request_id,
        "driver_id": ride.driver_id,
        "vehicle_id": vehicle.id,
        "vehicle_type": vehicle.vehicle_type,
        "plate_number": vehicle.plate_number,
        "status": ride.status,
        "agreed_fare": ride.agreed_fare,
        "currency": "NGN",
    }


@app.get("/health", tags=["operations"])
def health_check() -> dict[str, str]:
    """Lightweight process health check; does not require the database."""
    return {"status": "ok", "app": settings.app_name, "environment": settings.app_env}


@app.get("/health/database", tags=["operations"])
def database_health_check() -> dict[str, str]:
    """Check database connectivity without exposing credentials."""
    try:
        with engine.connect() as connection:
            if settings.database_url.startswith("sqlite"):
                connection.execute(text("SELECT 1"))
                database_name = "sqlite"
            else:
                database_name, _ = connection.execute(
                    text("SELECT current_database(), current_user")
                ).one()
        return {"status": "ok", "database": str(database_name)}
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=503,
            detail="Database connection unavailable",
        ) from exc


@app.get("/api/v1/policy/payments", tags=["policy"])
def payment_policy() -> dict[str, object]:
    """Expose the transfer-only payment policy."""
    return {
        "supported_methods": ["bank_transfer"],
        "cash_enabled": False,
        "confirmation_rule": "trusted_provider_confirmation_or_authorized_reconciliation",
        "screenshot_alone_confirms_payment": False,
    }

@app.post(
    "/api/v1/auth/register",
    tags=["authentication"],
    response_model=AuthenticatedResponse,
    status_code=status.HTTP_201_CREATED,
)
def register(
    payload: RegisterRequest,
    db: Session = Depends(get_db),
) -> AuthenticatedResponse:
    """Create a passenger account and return an access token."""
    if not settings.jwt_secret_key:
        raise HTTPException(
            status_code=503,
            detail="Authentication is not configured",
        )

    phone = payload.phone.strip()
    full_name = payload.full_name.strip()

    if len(phone) < 7 or len(full_name) < 2:
        raise HTTPException(
            status_code=422,
            detail="A valid phone number and full name are required",
        )

    existing_user = db.scalar(
        select(User).where(User.phone == phone)
    )
    if existing_user is not None:
        raise HTTPException(
            status_code=409,
            detail="Phone number is already registered",
        )

    user = User(
        phone=phone,
        full_name=full_name,
        password_hash=hash_password(payload.password),
        role="passenger",
        is_active=True,
    )

    try:
        db.add(user)
        db.commit()
        db.refresh(user)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Phone number is already registered",
        ) from None
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(
            status_code=503,
            detail="Unable to create account at this time",
        ) from None

    token = create_access_token(user)

    return AuthenticatedResponse(
        access_token=token,
        expires_in=settings.access_token_expire_minutes * 60,
        user=CurrentUserResponse(
            id=user.id,
            phone=user.phone,
            full_name=user.full_name,
            role=user.role,
            is_active=user.is_active,
        ),
    )
@app.post(
    "/api/v1/auth/login",
    tags=["authentication"],
    response_model=TokenResponse,
)
def login(
    payload: LoginRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> TokenResponse:
    """Authenticate an account with shared Redis login rate limiting."""
    if not settings.jwt_secret_key:
        raise HTTPException(
            status_code=503,
            detail="Authentication is not configured",
        )

    ip_address = (
        request.client.host if request.client is not None else "unknown"
    )

    try:
        allowed, retry_after = check_login_allowed(
            ip_address, payload.phone
        )
    except RateLimitUnavailable:
        raise HTTPException(
            status_code=503,
            detail="Login protection is temporarily unavailable",
        ) from None

    if not allowed:
        raise HTTPException(
            status_code=429,
            detail="Too many failed login attempts. Please try again later.",
            headers={"Retry-After": str(max(1, retry_after))},
        )

    user = db.scalar(select(User).where(User.phone == payload.phone))

    if (
        user is None
        or not user.is_active
        or not verify_password(payload.password, user.password_hash)
    ):
        try:
            recorded, retry_after = record_failed_login(
                ip_address, payload.phone
            )
        except RateLimitUnavailable:
            raise HTTPException(
                status_code=503,
                detail="Login protection is temporarily unavailable",
            ) from None

        if not recorded:
            raise HTTPException(
                status_code=429,
                detail="Too many failed login attempts. Please try again later.",
                headers={"Retry-After": str(max(1, retry_after))},
            )

        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid phone number or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = create_access_token(user)
    return TokenResponse(
        access_token=token,
        expires_in=settings.access_token_expire_minutes * 60,
    )


@app.get(
    "/api/v1/auth/me",
    tags=["authentication"],
    response_model=CurrentUserResponse,
)
def read_current_user(
    current_user: User = Depends(get_current_user),
) -> CurrentUserResponse:
    """Return the identity associated with the validated access token."""
    return CurrentUserResponse(
        id=current_user.id,
        phone=current_user.phone,
        full_name=current_user.full_name,
        role=current_user.role,
        is_active=current_user.is_active,
    )


@app.get("/api/v1/zones", tags=["booking"])
def list_active_zones(db: Session = Depends(get_db)) -> list[dict[str, object]]:
    """List active pickup and destination zones."""
    zones = db.scalars(
        select(Zone).where(Zone.is_active.is_(True)).order_by(Zone.name)
    ).all()
    return [{"id": zone.id, "name": zone.name} for zone in zones]


@app.get("/api/v1/fare-options", tags=["booking"])
def list_active_fare_options(
    origin_zone_id: int,
    destination_zone_id: int,
    db: Session = Depends(get_db),
) -> list[str]:
    """List vehicle types with active fares for a valid route."""
    if origin_zone_id <= 0 or destination_zone_id <= 0:
        raise HTTPException(status_code=422, detail="Zone IDs must be positive")

    if origin_zone_id == destination_zone_id:
        return []

    origin = db.get(Zone, origin_zone_id)
    destination = db.get(Zone, destination_zone_id)

    if (
        origin is None
        or destination is None
        or not origin.is_active
        or not destination.is_active
    ):
        return []

    vehicle_types = db.scalars(
        select(Fare.vehicle_type)
        .where(
            Fare.origin_zone_id == origin_zone_id,
            Fare.destination_zone_id == destination_zone_id,
            Fare.is_active.is_(True),
        )
        .distinct()
        .order_by(Fare.vehicle_type)
    ).all()

    return list(vehicle_types)


@app.get("/api/v1/ride-requests/my-rides", tags=["booking"])
def list_my_ride_requests(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict[str, object]]:
    """Return the passenger's ride requests and any assigned ride IDs."""
    if current_user.role != "passenger":
        raise HTTPException(
            status_code=403,
            detail="Only passenger accounts can view passenger ride history",
        )

    requests = db.scalars(
        select(RideRequest)
        .where(RideRequest.passenger_user_id == current_user.id)
        .order_by(RideRequest.created_at.desc(), RideRequest.id.desc())
    ).all()

    request_ids = [item.id for item in requests]
    assigned_rides = {}
    if request_ids:
        rows = db.execute(
            select(Ride.request_id, Ride.id, Ride.status).where(
                Ride.request_id.in_(request_ids)
            )
        ).all()
        assigned_rides = {
            request_id: {"id": ride_id, "status": ride_status}
            for request_id, ride_id, ride_status in rows
        }

    return [
        {
            "id": ride_request.id,
            "origin_text": ride_request.origin_text,
            "destination_text": ride_request.destination_text,
            "vehicle_type": ride_request.vehicle_type,
            "passenger_count": ride_request.passenger_count,
            "quoted_fare": ride_request.quoted_fare,
            "currency": "NGN",
            "status": ride_request.status,
            "created_at": ride_request.created_at,
            "assigned_ride_id": (
                assigned_rides[ride_request.id]["id"]
                if ride_request.id in assigned_rides
                else None
            ),
            "ride_status": (
                assigned_rides[ride_request.id]["status"]
                if ride_request.id in assigned_rides
                else None
            ),
        }
        for ride_request in requests
    ]


@app.post(
    "/api/v1/ride-requests",
    tags=["booking"],
    status_code=status.HTTP_201_CREATED,
    response_model=RideRequestCreated,
)
def create_ride_request(
    payload: RideRequestCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> RideRequestCreated:
    """Create a ride request using authenticated identity and a server-side fare."""
    if current_user.role != "passenger":
        raise HTTPException(
            status_code=403,
            detail="Only passenger accounts can create ride requests",
        )

    if (
        payload.vehicle_type.strip().lower() in {"motorcycle", "motorbike"}
        and payload.passenger_count > 1
    ):
        raise HTTPException(
            status_code=422,
            detail="Motorcycle bookings allow at most one passenger in addition to the rider",
        )

    origin = db.get(Zone, payload.origin_zone_id)
    destination = db.get(Zone, payload.destination_zone_id)

    if (
        origin is None
        or destination is None
        or not origin.is_active
        or not destination.is_active
    ):
        raise HTTPException(
            status_code=422,
            detail="Pickup and destination must be active zones",
        )

    fare = db.scalar(
        select(Fare).where(
            Fare.origin_zone_id == payload.origin_zone_id,
            Fare.destination_zone_id == payload.destination_zone_id,
            Fare.vehicle_type == payload.vehicle_type,
            Fare.is_active.is_(True),
        )
    )

    if fare is None:
        raise HTTPException(
            status_code=422,
            detail="No active fare is configured for this route and vehicle type",
        )

    calculated = (
        Decimal(fare.base_amount) * Decimal(fare.vehicle_multiplier)
        + Decimal(fare.extra_passenger_amount) * (payload.passenger_count - 1)
    ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    request = RideRequest(
        passenger_user_id=current_user.id,
        origin_text=payload.origin_text,
        destination_text=payload.destination_text,
        vehicle_type=payload.vehicle_type,
        passenger_count=payload.passenger_count,
        quoted_fare=calculated,
        status="requested",
    )

    db.add(request)
    try:
        db.commit()
        db.refresh(request)
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Unable to save ride request",
        ) from exc

    return RideRequestCreated(
        id=request.id,
        passenger_user_id=request.passenger_user_id,
        origin_zone_id=origin.id,
        destination_zone_id=destination.id,
        origin_text=request.origin_text,
        destination_text=request.destination_text,
        vehicle_type=request.vehicle_type,
        passenger_count=request.passenger_count,
        quoted_fare=Decimal(request.quoted_fare),
        status=request.status,
    )

from datetime import timezone


@app.post("/api/v1/rides/{ride_id}/sos", tags=["safety"])
def report_ride_sos(
    ride_id: int,
    payload: SOSReport,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Record an SOS from a passenger on the ride or its assigned driver."""
    row = db.execute(
        select(Ride, RideRequest, Driver)
        .join(RideRequest, Ride.request_id == RideRequest.id)
        .join(Driver, Ride.driver_id == Driver.id)
        .where(Ride.id == ride_id)
    ).first()

    if row is None:
        raise HTTPException(status_code=404, detail="Ride not found")

    ride, ride_request, driver = row

    is_passenger = (
        current_user.role == "passenger"
        and ride_request.passenger_user_id == current_user.id
    )
    is_assigned_driver = (
        current_user.role == "driver"
        and driver.user_id == current_user.id
    )

    if not (is_passenger or is_assigned_driver):
        raise HTTPException(
            status_code=403,
            detail="Only a passenger on this ride or its assigned driver can report SOS",
        )

    if ride.status not in ("assigned", "driver_arriving", "in_progress", "incident_review"):
        raise HTTPException(
            status_code=409,
            detail="SOS reporting is unavailable for this ride status",
        )

    incident = Incident(
        ride_id=ride.id,
        reporter_user_id=current_user.id,
        severity="critical",
        status="open",
        description=payload.description,
    )
    db.add(incident)
    db.flush()

    previous_status = ride.status
    ride.status = "incident_review"

    db.add(
        AuditLog(
            actor_user_id=current_user.id,
            action="ride.sos_reported",
            entity_type="incident",
            entity_id=str(incident.id),
            details=(
                f"SOS reported for ride {ride.id}; "
                f"previous ride status: {previous_status}."
            ),
        )
    )

    db.commit()
    db.refresh(incident)

    return {
        "incident_id": incident.id,
        "ride_id": ride.id,
        "severity": incident.severity,
        "incident_status": incident.status,
        "ride_status": ride.status,
        "message": (
            "SOS recorded in EkiMove. This does not automatically contact "
            "emergency services. If anyone is in immediate danger, contact "
            "local emergency services directly when safe to do so."
        ),
    }


@app.get("/api/v1/admin/incidents", tags=["admin", "safety"])
def admin_list_incidents(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_super_admin),
):
    """List incident reports for authorized admin review."""
    incidents = db.scalars(
        select(Incident).order_by(Incident.created_at.desc(), Incident.id.desc())
    ).all()

    return [
        {
            "id": item.id,
            "ride_id": item.ride_id,
            "reporter_user_id": item.reporter_user_id,
            "severity": item.severity,
            "status": item.status,
            "description": item.description,
            "created_at": item.created_at,
        }
        for item in incidents
    ]


@app.patch("/api/v1/admin/incidents/{incident_id}", tags=["admin", "safety"])
def admin_review_incident(
    incident_id: int,
    payload: IncidentReviewUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Allow a super-admin to record incident investigation or resolution."""
    if current_user.role != "super_admin":
        raise HTTPException(status_code=403, detail="Super-admin account required")

    incident = db.get(Incident, incident_id)
    if incident is None:
        raise HTTPException(status_code=404, detail="Incident not found")

    previous_status = incident.status
    incident.status = payload.status

    db.add(
        AuditLog(
            actor_user_id=current_user.id,
            action="incident.review_updated",
            entity_type="incident",
            entity_id=str(incident.id),
            details=(
                f"Incident status changed from '{previous_status}' "
                f"to '{payload.status}'. Note: {payload.note}"
            ),
        )
    )

    # Keep the ride under review even when the incident is resolved.
    # Restoring normal ride operations requires a separate authorized decision.
    db.commit()
    db.refresh(incident)

    return {
        "incident_id": incident.id,
        "status": incident.status,
        "message": "Incident review status updated.",
    }


@app.get("/api/v1/driver/rides")
def list_driver_rides(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict[str, object]]:
    """List rides assigned to the authenticated driver."""
    if current_user.role != "driver":
        raise HTTPException(status_code=403, detail="Driver account required")

    rows = db.execute(
        select(Ride, RideRequest)
        .join(Driver, Ride.driver_id == Driver.id)
        .join(RideRequest, Ride.request_id == RideRequest.id)
        .where(Driver.user_id == current_user.id)
        .order_by(Ride.id.desc())
    ).all()

    return [
        {
            "id": ride.id,
            "status": ride.status,
            "agreed_fare": str(ride.agreed_fare),
            "started_at": ride.started_at.isoformat() if ride.started_at else None,
            "completed_at": ride.completed_at.isoformat() if ride.completed_at else None,
            "origin_text": request.origin_text,
            "destination_text": request.destination_text,
            "vehicle_type": request.vehicle_type,
            "passenger_count": request.passenger_count,
            "created_at": request.created_at.isoformat() if request.created_at else None,
        }
        for ride, request in rows
    ]

@app.patch("/api/v1/driver/rides/{ride_id}/status")
def update_driver_ride_status(
    ride_id: int,
    payload: RideStatusUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Allow a driver to advance only their own assigned ride."""

    if current_user.role != "driver":
        raise HTTPException(
            status_code=403,
            detail="Driver account required",
        )

    ride = db.scalar(
        select(Ride)
        .join(Driver, Ride.driver_id == Driver.id)
        .where(
            Ride.id == ride_id,
            Driver.user_id == current_user.id,
        )
    )

    if ride is None:
        raise HTTPException(
            status_code=404,
            detail="Ride not found",
        )

    allowed_transitions = {
        "assigned": "driver_arriving",
        "driver_arriving": "in_progress",
        "in_progress": "completed",
    }

    expected_status = allowed_transitions.get(ride.status)

    if expected_status != payload.status:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Invalid status transition from '{ride.status}' "
                f"to '{payload.status}'."
            ),
        )

    # A ride must have independently verified payment before it starts.
    if payload.status == "in_progress":
        payment = db.scalar(
            select(Payment).where(Payment.ride_id == ride.id)
        )
        if payment is None or payment.status != "confirmed":
            raise HTTPException(
                status_code=409,
                detail=(
                    "Ride cannot start until its bank-transfer payment "
                    "has been independently verified and confirmed."
                ),
            )

    previous_status = ride.status
    now = datetime.now(timezone.utc)

    ride.status = payload.status

    if payload.status == "in_progress":
        ride.started_at = now
    elif payload.status == "completed":
        ride.completed_at = now

    db.add(
        AuditLog(
            actor_user_id=current_user.id,
            action="ride.status_changed",
            entity_type="ride",
            entity_id=str(ride.id),
            details=(
                f"Ride status changed from '{previous_status}' "
                f"to '{payload.status}'."
            ),
        )
    )

    db.commit()
    db.refresh(ride)

    return {
        "ride_id": ride.id,
        "status": ride.status,
        "started_at": ride.started_at,
        "completed_at": ride.completed_at,
    }
