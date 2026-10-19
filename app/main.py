from decimal import Decimal, ROUND_HALF_UP
from fastapi import Depends, FastAPI, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.auth import create_access_token, get_current_user, verify_password
from app.config import settings
from app.database import engine, get_db
from app.models import Fare, RideRequest, User, Zone
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


class LoginRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    phone: str = Field(min_length=7, max_length=32)
    password: str = Field(min_length=1, max_length=256)


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


class RideRequestCreate(BaseModel):
    """A ride request; passenger identity comes from the access token."""

    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    origin_zone_id: int = Field(gt=0)
    destination_zone_id: int = Field(gt=0)
    origin_text: str = Field(min_length=3, max_length=255)
    destination_text: str = Field(min_length=3, max_length=255)
    vehicle_type: str = Field(min_length=2, max_length=32)
    passenger_count: int = Field(default=1, ge=1, le=8)


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
        and payload.passenger_count > 2
    ):
        raise HTTPException(
            status_code=422,
            detail="Motorcycle bookings allow at most two passengers in addition to the rider",
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
