from app.admin_locations import router as admin_locations_router
from app.atona import router as atona_router
import re
from datetime import datetime, timezone
from typing import Literal
from app.payments import router as payments_router
from app.interswitch_payments import router as interswitch_payments_router
from app.instant_payments import instant_transfers_enabled, router as instant_payments_router
from app.cancellations import router as cancellations_router
from app import notifications, promos
from app.scheduling import check_pickup_time, iso_utc
from app.trip_chat import chat_unread
from app.accounts import router as accounts_router
from app.codes import router as codes_router
from app.push import router as push_router
from app.reports import router as reports_router
from app.promos import router as promos_router
from app.scheduling import router as scheduling_router
from app.trip_chat import router as trip_chat_router
from app.data_rights import router as data_rights_router
from app.site_content import router as site_content_router
from app import deliveries as deliveries_module
from app.deliveries import check_delivery_code, recipient_text, router as deliveries_router
from app.support import router as support_router
from app.haulage import router as haulage_router
from app.verification import client_fingerprint, ensure_passenger_may_book, record_policy_acceptance, router as verification_router
from app.trips import check_pickup_pin, my_rating, passenger_verified, rating_summary, router as trips_router, short_name as trip_short_name
from app.dispatch import advance_dispatch, assign_driver, dispatch_summary, router as dispatch_router, withdraw_offers
from app.app_settings import booking_rules, is_motorcycle, max_passengers, quote_amount, router as app_settings_router, seats_needed
from app.earnings import record_trip_earning, ride_earning_preview, router as earnings_router
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
from app.client_ip import client_ip
from app.contacts import (ContactError, clean_email, clean_name, clean_phone, email_taken, find_user,
                          international_number, is_email, password_problem, phone_taken)
from app.database import engine, get_db
from app.driver_applications import router as driver_applications_router
from app.models import AuditLog, Driver, Fare, Incident, Payment, Place, PlaceFare, Ride, RideRequest, ServiceArea, User, Vehicle, Zone

from app.admin_driver_verification import router as admin_driver_verification_router
from app.rate_limit import (
    RateLimitUnavailable,
    check_login_allowed,
    enforce as enforce_rate_limit,
    record_failed_login,
)

if settings.sentry_dsn:
    # Optional error monitoring: crashes are reported to Sentry without
    # personal data (no request bodies, cookies or IP addresses).
    import sentry_sdk

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.app_env,
        send_default_pii=False,
        traces_sample_rate=0.0,
    )

_docs_on = settings.api_docs_enabled if settings.api_docs_enabled is not None else settings.app_env != "production"

app = FastAPI(
    title=settings.app_name,
    version="0.4.0",
    description=(
        "EkiMove mobility platform API. Pilot scope: Ado-Ekiti. "
        "Payment policy: bank transfer only; cash is not supported."
    ),
    # The interactive API map is for developers; it stays off in production.
    docs_url="/docs" if _docs_on else None,
    redoc_url="/redoc" if _docs_on else None,
    openapi_url="/openapi.json" if _docs_on else None,
)



app.include_router(driver_applications_router)
app.include_router(admin_driver_verification_router)
app.include_router(payments_router)
app.include_router(interswitch_payments_router)
app.include_router(instant_payments_router)
app.include_router(cancellations_router)
app.include_router(earnings_router)
app.include_router(app_settings_router)
app.include_router(accounts_router)
app.include_router(support_router)
app.include_router(haulage_router)
app.include_router(dispatch_router)
app.include_router(trips_router)
app.include_router(verification_router)
app.include_router(codes_router)
app.include_router(push_router)
app.include_router(reports_router)
app.include_router(promos_router)
app.include_router(scheduling_router)
app.include_router(trip_chat_router)
app.include_router(data_rights_router)
app.include_router(deliveries_router)
app.include_router(site_content_router)

class LoginRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    # A phone number or an email address. "phone" is kept for older apps.
    identifier: str | None = Field(default=None, min_length=3, max_length=254)
    phone: str | None = Field(default=None, min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=256)


class RegisterRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    # Sign up with a phone number, an email address, or both.
    phone: str | None = Field(default=None, min_length=7, max_length=32)
    email: str | None = Field(default=None, max_length=254)
    full_name: str = Field(min_length=2, max_length=160)
    # Leading/trailing spaces in a password are kept (they are part of it).
    password: str = Field(min_length=12, max_length=128)
    # The app sends true after the person ticks "I agree" to EkiMove's policies.
    accept_policies: bool | None = None
    # Optional invite code from a friend (money off the first ride).
    referral_code: str | None = Field(default=None, max_length=40)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class CurrentUserResponse(BaseModel):
    id: int
    phone: str | None
    email: str | None = None
    full_name: str
    role: str
    is_active: bool
    must_change_password: bool = False


def current_user_response(user: User) -> CurrentUserResponse:
    return CurrentUserResponse(
        id=user.id,
        phone=user.phone,
        email=user.email,
        full_name=user.full_name,
        role=user.role,
        is_active=user.is_active,
        must_change_password=bool(user.must_change_password),
    )


class AuthenticatedResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: CurrentUserResponse

class RideRequestCreate(BaseModel):
    """A ride request using either legacy zones or configured places."""

    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    origin_zone_id: int | None = Field(default=None, gt=0)
    destination_zone_id: int | None = Field(default=None, gt=0)
    origin_place_id: int | None = Field(default=None, gt=0)
    destination_place_id: int | None = Field(default=None, gt=0)
    origin_text: str | None = Field(default=None, min_length=3, max_length=255)
    destination_text: str | None = Field(default=None, min_length=3, max_length=255)
    vehicle_type: str = Field(min_length=2, max_length=32)
    passenger_count: int = Field(default=1, ge=1, le=8)
    # Book for later: pickup time (30 minutes to 7 days ahead).
    scheduled_for: datetime | None = None
    promo_code: str | None = Field(default=None, max_length=40)

class RideStatusUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["driver_arriving", "in_progress", "completed"]
    # Required to start a trip: the 4-digit PIN shown in the passenger's app.
    pickup_pin: str | None = Field(default=None, max_length=8)
    # Required to finish a delivery: the code the recipient was given.
    delivery_code: str | None = Field(default=None, max_length=8)


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
    discount_amount: Decimal = Decimal("0.00")
    amount_to_pay: Decimal | None = None
    scheduled_for: str | None = None


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


@app.post("/api/v1/admin/zones", tags=["admin"])
def admin_create_zone(
    payload: dict[str, object],
    db: Session = Depends(get_db),
    admin: User = Depends(require_super_admin),
) -> dict[str, object]:
    """Create a zone manually from the admin interface."""
    name = payload.get("name")
    is_active = payload.get("is_active", False)

    if not isinstance(name, str) or not 2 <= len(name.strip()) <= 100:
        raise HTTPException(
            status_code=422,
            detail="Zone name must contain between 2 and 100 characters",
        )

    if not isinstance(is_active, bool):
        raise HTTPException(
            status_code=422,
            detail="Zone status must be active or inactive",
        )

    name = name.strip()
    existing_zones = db.scalars(select(Zone)).all()

    if any(zone.name.casefold() == name.casefold() for zone in existing_zones):
        raise HTTPException(
            status_code=409,
            detail="A zone with this name already exists",
        )

    zone = Zone(name=name, is_active=is_active)
    db.add(zone)
    db.flush()

    db.add(AuditLog(
        actor_user_id=admin.id,
        action="zone.created",
        entity_type="zone",
        entity_id=str(zone.id),
        details=f"Created zone: {name}"[:2000],
    ))

    try:
        db.commit()
        db.refresh(zone)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="A zone with this name already exists",
        ) from exc

    return {
        "id": zone.id,
        "name": zone.name,
        "is_active": zone.is_active,
    }


@app.patch("/api/v1/admin/zones/{zone_id}", tags=["admin"])
def admin_update_zone(
    zone_id: int,
    payload: dict[str, object],
    db: Session = Depends(get_db),
    admin: User = Depends(require_super_admin),
) -> dict[str, object]:
    """Rename a zone or change its activation status."""
    zone = db.get(Zone, zone_id)

    if zone is None:
        raise HTTPException(status_code=404, detail="Zone not found")

    if not payload or set(payload) - {"name", "is_active"}:
        raise HTTPException(
            status_code=422,
            detail="Provide a zone name or activation status",
        )

    if "name" in payload:
        name = payload["name"]

        if not isinstance(name, str) or not 2 <= len(name.strip()) <= 100:
            raise HTTPException(
                status_code=422,
                detail="Zone name must contain between 2 and 100 characters",
            )

        name = name.strip()
        existing_zones = db.scalars(select(Zone)).all()

        if any(
            item.id != zone.id and item.name.casefold() == name.casefold()
            for item in existing_zones
        ):
            raise HTTPException(
                status_code=409,
                detail="A zone with this name already exists",
            )

        zone.name = name

    if "is_active" in payload:
        is_active = payload["is_active"]

        if not isinstance(is_active, bool):
            raise HTTPException(
                status_code=422,
                detail="Zone status must be active or inactive",
            )

        zone.is_active = is_active

    db.add(AuditLog(
        actor_user_id=admin.id,
        action="zone.updated",
        entity_type="zone",
        entity_id=str(zone.id),
        details=f"Updated zone: {zone.name}"[:2000],
    ))

    try:
        db.commit()
        db.refresh(zone)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="The zone update conflicts with existing data",
        ) from exc

    return {
        "id": zone.id,
        "name": zone.name,
        "is_active": zone.is_active,
    }


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
    advance_dispatch(db)
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
            "service_type": request.service_type,
            "load_description": request.load_description,
            **dispatch_summary(db, request),
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
            Vehicle.capacity >= seats_needed(ride_request.vehicle_type, ride_request.passenger_count),
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
    admin: User = Depends(require_super_admin),
) -> dict[str, object]:
    """Assign a requested booking to an approved, online driver by hand.

    Overrides automatic dispatch: any live offer for the request is withdrawn.
    """
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

    ride, vehicle = assign_driver(db, ride_request, driver, admin.id, "by an admin")
    withdraw_offers(db, ride_request.id)
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
            connection.execute(text("SELECT 1"))
        return {"status": "ok"}
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=503,
            detail="Database connection unavailable",
        ) from exc


@app.get("/api/v1/policy/payments", tags=["policy"])
def payment_policy() -> dict[str, object]:
    """Expose supported payment methods and confirmation rules."""
    return {
        "supported_methods": ["bank_transfer", "interswitch"],
        "cash_enabled": False,
        "instant_transfers_enabled": instant_transfers_enabled(),
        "confirmation_rule": "server_side_provider_verification_or_authorized_reconciliation",
        "screenshot_alone_confirms_payment": False,
    }


@app.get("/api/v1/business-info", tags=["policy"])
def business_info() -> dict[str, object]:
    """Expose the configured bank-transfer account and support contacts.

    Values come from environment settings so they can be filled in or
    changed without a code release. Bank details are only reported as
    configured when the bank name, account number and account name are
    all set.
    """
    bank_name = settings.bank_transfer_bank_name
    account_number = settings.bank_transfer_account_number
    account_name = settings.bank_transfer_account_name
    return {
        "instant_transfers": {"enabled": instant_transfers_enabled()},
        "cancellation": {
            "free_seconds": settings.cancellation_free_seconds,
            "fee_motorcycle": settings.cancellation_fee_motorcycle,
            "fee_car": settings.cancellation_fee_car,
        },
        "bank_transfer": {
            "configured": bool(bank_name and account_number and account_name),
            "bank_name": bank_name,
            "account_number": account_number,
            "account_name": account_name,
        },
        "support": {
            "phone": settings.support_phone,
            "email": settings.support_email,
            "whatsapp": settings.support_whatsapp,
        },
    }

@app.post(
    "/api/v1/auth/register",
    tags=["authentication"],
    response_model=AuthenticatedResponse,
    status_code=status.HTTP_201_CREATED,
)
def register(
    payload: RegisterRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> AuthenticatedResponse:
    """Create a passenger account and return an access token."""
    if not settings.jwt_secret_key:
        raise HTTPException(
            status_code=503,
            detail="Authentication is not configured",
        )

    try:
        full_name = clean_name(payload.full_name, label="full name")
        phone = clean_phone(payload.phone)
        email = clean_email(payload.email)
    except ContactError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None

    if not (phone or email):
        raise HTTPException(
            status_code=422,
            detail="Enter your phone number or email address, and your full name",
        )
    referral_code = (payload.referral_code or "").strip().upper()
    if referral_code and not re.fullmatch(r"[A-Z0-9-]{3,40}", referral_code):
        raise HTTPException(status_code=422, detail="Invite codes use only letters, numbers and hyphens.")
    weak = password_problem(payload.password, name=full_name, phone=phone, email=email)
    if weak:
        raise HTTPException(status_code=422, detail=weak)
    enforce_rate_limit("signup", client_ip(request), settings.signup_ip_limit_per_hour, 3600,
                       "Too many new accounts from this connection. Please try again in an hour.")

    if phone and phone_taken(db, phone):
        raise HTTPException(
            status_code=409,
            detail="Phone number is already registered",
        )
    if email and email_taken(db, email):
        raise HTTPException(
            status_code=409,
            detail="Email address is already registered",
        )
    inviter = promos.find_inviter(db, referral_code or None)

    user = User(
        phone=phone,
        email=email,
        full_name=full_name,
        password_hash=hash_password(payload.password),
        role="passenger",
        is_active=True,
    )

    try:
        db.add(user)
        db.flush()
        if payload.accept_policies:
            record_policy_acceptance(db, user, request)
        promos.welcome_invited(db, user, inviter)
        db.add(AuditLog(actor_user_id=user.id, action="auth.registered", entity_type="user",
                        entity_id=str(user.id), details=client_fingerprint(request)))
        db.commit()
        db.refresh(user)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="This phone number or email address is already registered",
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
        user=current_user_response(user),
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

    # A phone number or an email address; whitespace is trimmed.
    identifier = (payload.identifier or payload.phone or "").strip()
    if not identifier:
        raise HTTPException(status_code=422, detail="Enter your phone number or email address")
    # Rate-limit on one spelling of the identifier.
    limit_key = identifier.lower() if is_email(identifier) else international_number(identifier)

    ip_address = client_ip(request)

    try:
        allowed, retry_after = check_login_allowed(ip_address, limit_key)
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

    user = find_user(db, identifier)

    if (
        user is not None
        and not user.is_active
        and user.removed_at is None
        and user.password_hash
        and verify_password(payload.password, user.password_hash)
    ):
        raise HTTPException(
            status_code=403,
            detail="This account is suspended. Please contact EkiMove support.",
        )

    if (
        user is None
        or not user.is_active
        or not verify_password(payload.password, user.password_hash)
    ):
        try:
            recorded, retry_after = record_failed_login(ip_address, limit_key)
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
            detail="Invalid phone number, email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Sign-in log for traceability (time, IP address and device).
    db.add(AuditLog(actor_user_id=user.id, action="auth.login", entity_type="user",
                    entity_id=str(user.id), details=client_fingerprint(request)))
    db.commit()
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
    return current_user_response(current_user)


@app.get("/api/v1/zones", tags=["booking"])
def list_active_zones(db: Session = Depends(get_db)) -> list[dict[str, object]]:
    """List active pickup and destination zones."""
    zones = db.scalars(
        select(Zone).where(Zone.is_active.is_(True)).order_by(Zone.name)
    ).all()
    return [{"id": zone.id, "name": zone.name} for zone in zones]


@app.get("/api/v1/locations/areas", tags=["booking"])
def list_passenger_service_areas(
    db: Session = Depends(get_db),
) -> list[dict[str, object]]:
    """List active service areas available to passengers."""
    areas = db.scalars(
        select(ServiceArea)
        .where(ServiceArea.status == "active")
        .order_by(ServiceArea.name)
    ).all()
    return [
        {"id": area.id, "name": area.name, "slug": area.slug}
        for area in areas
    ]


@app.get("/api/v1/locations/places", tags=["booking"])
def list_passenger_places(
    service_area_id: int,
    db: Session = Depends(get_db),
) -> list[dict[str, object]]:
    """List active places in an active service area and active zones."""
    if service_area_id <= 0:
        raise HTTPException(status_code=422, detail="Service area ID must be positive")

    area = db.get(ServiceArea, service_area_id)
    if area is None or area.status != "active":
        return []

    rows = db.execute(
        select(Place, Zone)
        .join(Zone, Place.zone_id == Zone.id)
        .where(
            Place.service_area_id == service_area_id,
            Place.status == "active",
            Zone.is_active.is_(True),
        )
        .order_by(Place.name)
    ).all()

    return [
        {
            "id": place.id,
            "name": place.name,
            "place_type": place.place_type,
            "address_text": place.address_text,
            "service_area_id": place.service_area_id,
            "zone_id": place.zone_id,
        }
        for place, zone in rows
    ]


@app.get("/api/v1/place-fare-options", tags=["booking"])
def list_active_place_fare_options(
    origin_place_id: int,
    destination_place_id: int,
    passenger_count: int = 1,
    db: Session = Depends(get_db),
) -> list[dict[str, object]]:
    """Return server-calculated quotes for explicitly active place fares."""
    if origin_place_id <= 0 or destination_place_id <= 0:
        raise HTTPException(status_code=422, detail="Place IDs must be positive")
    if passenger_count < 1 or passenger_count > 8:
        raise HTTPException(
            status_code=422,
            detail="Passenger count must be between 1 and 8",
        )
    if origin_place_id == destination_place_id:
        return []

    origin_place = db.get(Place, origin_place_id)
    destination_place = db.get(Place, destination_place_id)
    if (
        origin_place is None
        or destination_place is None
        or origin_place.status != "active"
        or destination_place.status != "active"
    ):
        return []

    origin_area = db.get(ServiceArea, origin_place.service_area_id)
    destination_area = db.get(ServiceArea, destination_place.service_area_id)
    origin_zone = db.get(Zone, origin_place.zone_id)
    destination_zone = db.get(Zone, destination_place.zone_id)
    if (
        origin_area is None
        or destination_area is None
        or origin_area.status != "active"
        or destination_area.status != "active"
        or origin_zone is None
        or destination_zone is None
        or not origin_zone.is_active
        or not destination_zone.is_active
    ):
        return []

    fares = db.scalars(
        select(PlaceFare)
        .where(
            PlaceFare.origin_place_id == origin_place_id,
            PlaceFare.destination_place_id == destination_place_id,
            PlaceFare.is_active.is_(True),
        )
        .order_by(PlaceFare.vehicle_type)
    ).all()

    rules = booking_rules(db)
    options = []
    for fare in fares:
        if passenger_count > max_passengers(rules, fare.vehicle_type):
            continue

        amount = quote_amount(rules, fare, fare.vehicle_type, passenger_count)

        options.append(
            {
                "fare_id": fare.id,
                "vehicle_type": fare.vehicle_type,
                "quoted_fare": amount,
                "currency": "NGN",
                "passenger_count": passenger_count,
            }
        )
    return options


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

    advance_dispatch(db)
    requests = db.scalars(
        select(RideRequest)
        .where(RideRequest.passenger_user_id == current_user.id)
        .order_by(RideRequest.created_at.desc(), RideRequest.id.desc())
    ).all()

    request_ids = [item.id for item in requests]
    requests_by_id = {item.id: item for item in requests}
    place_ids = {item.origin_place_id for item in requests if item.origin_place_id}
    place_areas = dict(db.execute(select(Place.id, Place.service_area_id).where(Place.id.in_(place_ids))).all()) \
        if place_ids else {}
    assigned_rides = {}
    if request_ids:
        rows = db.execute(
            select(Ride.request_id, Ride.id, Ride.status, Ride.driver_id, User.full_name)
            .join(Driver, Ride.driver_id == Driver.id)
            .join(User, Driver.user_id == User.id)
            .where(Ride.request_id.in_(request_ids))
        ).all()
        for request_id, ride_id, ride_status, driver_id, driver_full_name in rows:
            ride_request = requests_by_id[request_id]
            # Rides do not record a vehicle; use the same rule as assignment:
            # the driver's first approved vehicle matching the booking.
            vehicle = db.scalar(
                select(Vehicle)
                .where(
                    Vehicle.driver_id == driver_id,
                    Vehicle.is_approved.is_(True),
                    Vehicle.vehicle_type == ride_request.vehicle_type,
                    Vehicle.capacity >= seats_needed(ride_request.vehicle_type, ride_request.passenger_count),
                )
                .order_by(Vehicle.id)
            )
            payment = db.scalar(select(Payment).where(Payment.ride_id == ride_id))
            ride = db.get(Ride, ride_id)
            if ride.vehicle_id:
                vehicle = db.get(Vehicle, ride.vehicle_id)
            assigned_rides[request_id] = {
                "pickup_pin": ride.pickup_pin if ride.status in ("assigned", "driver_arriving") else None,
                "my_rating": my_rating(db, ride.id, current_user.id),
                "share_active": bool(ride.share_token),
                "driver_rating": rating_summary(db, db.get(Driver, driver_id).user_id),
                "payment_status": payment.status if payment else None,
                "refund_status": payment.refund_status if payment else None,
                "refund_amount": (
                    str(payment.refund_amount)
                    if payment and payment.refund_amount is not None
                    else None
                ),
                "cancellation_fee": (
                    str(ride.cancellation_fee)
                    if ride.cancellation_fee is not None
                    else None
                ),
                "chat_unread": chat_unread(db, ride, current_user),
                "delivery_code": ride.delivery_code if ride.status in ("assigned", "driver_arriving", "in_progress") else None,
                "share_path": f"/t/{ride.share_token}" if ride.share_token else None,
                "id": ride_id,
                "status": ride_status,
                "driver_name": _short_display_name(driver_full_name),
                "vehicle_plate": vehicle.plate_number if vehicle else None,
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
            "service_type": ride_request.service_type,
            "load_description": ride_request.load_description,
            "dispatch_status": ride_request.dispatch_status,
            "quote_terms": ride_request.quote_terms,
            "scheduled_for": iso_utc(ride_request.scheduled_for),
            "discount_amount": str(Decimal(ride_request.discount_amount or 0)),
            "amount_to_pay": str(Decimal(ride_request.quoted_fare) - Decimal(ride_request.discount_amount or 0)),
            "origin_place_id": ride_request.origin_place_id,
            "destination_place_id": ride_request.destination_place_id,
            "service_area_id": place_areas.get(ride_request.origin_place_id),
            **({"delivery": {"size": ride_request.delivery_size, "recipient_name": ride_request.recipient_name,
                             "recipient_phone": ride_request.recipient_phone, "fragile": ride_request.fragile,
                             "notes": ride_request.delivery_notes}}
               if ride_request.service_type == "delivery" else {}),
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
            "driver_name": (
                assigned_rides[ride_request.id]["driver_name"]
                if ride_request.id in assigned_rides
                else None
            ),
            "vehicle_plate": (
                assigned_rides[ride_request.id]["vehicle_plate"]
                if ride_request.id in assigned_rides
                else None
            ),
            **{
                key: assigned_rides.get(ride_request.id, {}).get(key)
                for key in (
                    "payment_status",
                    "refund_status",
                    "refund_amount",
                    "cancellation_fee",
                    "pickup_pin",
                    "my_rating",
                    "share_active",
                    "driver_rating",
                    "chat_unread",
                    "delivery_code",
                    "share_path",
                )
            },
        }
        for ride_request in requests
    ]


def _short_display_name(full_name: str | None) -> str | None:
    """Return a first name and last initial, e.g. "Tunde A."."""
    if not full_name:
        return None
    parts = full_name.split()
    if not parts:
        return None
    if len(parts) == 1:
        return parts[0]
    return f"{parts[0]} {parts[-1][0].upper()}."


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
    ensure_passenger_may_book(db, current_user)

    use_places = (
        payload.origin_place_id is not None
        or payload.destination_place_id is not None
    )
    if use_places:
        if (
            payload.origin_place_id is None
            or payload.destination_place_id is None
            or payload.origin_zone_id is not None
            or payload.destination_zone_id is not None
        ):
            raise HTTPException(
                status_code=422,
                detail="Provide both place IDs, without zone IDs",
            )
        if payload.origin_place_id == payload.destination_place_id:
            raise HTTPException(
                status_code=422,
                detail="Pickup and destination must be different places",
            )

        origin_place = db.get(Place, payload.origin_place_id)
        destination_place = db.get(Place, payload.destination_place_id)
        if (
            origin_place is None
            or destination_place is None
            or origin_place.status != "active"
            or destination_place.status != "active"
        ):
            raise HTTPException(
                status_code=422,
                detail="Pickup and destination must be active places",
            )

        origin_area = db.get(ServiceArea, origin_place.service_area_id)
        destination_area = db.get(ServiceArea, destination_place.service_area_id)
        origin = db.get(Zone, origin_place.zone_id)
        destination = db.get(Zone, destination_place.zone_id)

        if (
            origin_area is None
            or destination_area is None
            or origin_area.status != "active"
            or destination_area.status != "active"
            or origin is None
            or destination is None
            or not origin.is_active
            or not destination.is_active
        ):
            raise HTTPException(
                status_code=422,
                detail="Places must belong to active service areas and zones",
            )

        fare = db.scalar(
            select(PlaceFare).where(
                PlaceFare.origin_place_id == origin_place.id,
                PlaceFare.destination_place_id == destination_place.id,
                PlaceFare.vehicle_type == payload.vehicle_type,
                PlaceFare.is_active.is_(True),
            )
        )
        origin_text = origin_place.name
        destination_text = destination_place.name
    else:
        if (
            payload.origin_zone_id is None
            or payload.destination_zone_id is None
            or payload.origin_text is None
            or payload.destination_text is None
        ):
            raise HTTPException(
                status_code=422,
                detail="Provide both zone IDs and pickup/destination text",
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
        origin_text = payload.origin_text
        destination_text = payload.destination_text

    if fare is None:
        raise HTTPException(
            status_code=422,
            detail="No active fare is configured for this route and vehicle type",
        )

    rules = booking_rules(db)
    limit = max_passengers(rules, payload.vehicle_type)
    if payload.passenger_count > limit:
        if is_motorcycle(payload.vehicle_type):
            detail = (
                "A motorcycle can carry 2 passengers at most."
                if limit == 2
                else "A motorcycle can carry only 1 passenger. Choose a car for more people."
            )
        else:
            detail = f"A {payload.vehicle_type} can carry {limit} passengers at most."
        raise HTTPException(status_code=422, detail=detail)

    calculated = quote_amount(rules, fare, payload.vehicle_type, payload.passenger_count)
    scheduled_for = check_pickup_time(db, payload.scheduled_for)

    request = RideRequest(
        passenger_user_id=current_user.id,
        origin_place_id=origin_place.id if use_places else None,
        destination_place_id=destination_place.id if use_places else None,
        origin_text=origin_text,
        destination_text=destination_text,
        vehicle_type=payload.vehicle_type,
        passenger_count=payload.passenger_count,
        quoted_fare=calculated,
        status="requested",
        scheduled_for=scheduled_for,
        dispatch_status="scheduled" if scheduled_for else None,
    )

    db.add(request)
    if payload.promo_code and payload.promo_code.strip():
        db.flush()
        promos.apply_code(db, current_user, request, payload.promo_code)
    try:
        db.commit()
        db.refresh(request)
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Unable to save ride request",
        ) from exc

    # Offer it to the best-placed driver straight away.
    advance_dispatch(db, force=True)
    db.refresh(request)

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
        discount_amount=Decimal(request.discount_amount or 0),
        amount_to_pay=Decimal(request.quoted_fare) - Decimal(request.discount_amount or 0),
        scheduled_for=iso_utc(request.scheduled_for),
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
    notifications.sos_raised(db, ride.id, current_user)

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
    current_user: User = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """Allow a super-admin to record incident investigation or resolution."""

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
    passengers = {
        user.id: user
        for user in db.scalars(
            select(User).where(User.id.in_({request.passenger_user_id for _, request in rows}))
        ).all()
    } if rows else {}

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
            "earning": ride_earning_preview(db, ride),
            "passenger_name": trip_short_name(
                passengers[request.passenger_user_id].full_name
                if request.passenger_user_id in passengers else None
            ),
            "passenger_verified": passenger_verified(db, request.passenger_user_id),
            # Trips created before pickup PINs existed start without one.
            "pin_required": bool(ride.pickup_pin),
            "passenger_rating": rating_summary(db, request.passenger_user_id),
            "my_rating": my_rating(db, ride.id, current_user.id),
            "service_type": request.service_type,
            "load_description": request.load_description,
            "scheduled_for": iso_utc(request.scheduled_for),
            "chat_unread": chat_unread(db, ride, current_user),
            **({"delivery": {"size": request.delivery_size, "recipient_name": request.recipient_name,
                             "recipient_phone": request.recipient_phone, "fragile": request.fragile,
                             "notes": request.delivery_notes, "code_required": bool(ride.delivery_code)}}
               if request.service_type == "delivery" else {}),
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

    if payload.status == "in_progress":
        check_pickup_pin(db, ride, payload.pickup_pin, current_user.id)

    status_request = db.get(RideRequest, ride.request_id)
    is_delivery = status_request is not None and status_request.service_type == "delivery"
    if is_delivery and payload.status == "completed":
        check_delivery_code(db, ride, payload.delivery_code, current_user.id)

    previous_status = ride.status
    now = datetime.now(timezone.utc)

    ride.status = payload.status

    if payload.status == "driver_arriving":
        ride.arrived_at = now
    elif payload.status == "in_progress":
        ride.started_at = now
    elif payload.status == "completed":
        ride.completed_at = now
        # Credit the driver: fare minus EkiMove's commission.
        record_trip_earning(db, ride)
    recipient_sms = None
    if is_delivery and payload.status == "in_progress":
        recipient_sms = recipient_text(db, ride, status_request)
    if status_request is not None:
        notifications.ride_status(db, ride, status_request)
        if payload.status == "completed":
            trip_passenger = db.get(User, status_request.passenger_user_id)
            if trip_passenger is not None:
                promos.reward_inviter(db, trip_passenger)

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
    if recipient_sms:
        deliveries_module.send_text(*recipient_sms)

    return {
        "ride_id": ride.id,
        "status": ride.status,
        "started_at": ride.started_at,
        "completed_at": ride.completed_at,
    }

# Apply CORS around the complete application, including application error responses.
from starlette.middleware.cors import CORSMiddleware as OuterCORSMiddleware

# Keep `app` as FastAPI for tests and dependency overrides.
# Render serves `application`, which wraps the complete app in CORS.
app.include_router(atona_router)
app.include_router(admin_locations_router)

class SecurityHeaders:
    """Browser safety headers on every API response, and a cap on request
    size so one huge upload can't tie the server up."""

    HEADERS = [
        (b"x-content-type-options", b"nosniff"),
        (b"x-frame-options", b"DENY"),
        (b"referrer-policy", b"no-referrer"),
        (b"permissions-policy", b"camera=(), microphone=(), geolocation=()"),
        (b"cross-origin-opener-policy", b"same-origin"),
        (b"content-security-policy", b"default-src 'none'; frame-ancestors 'none'"),
    ]

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path = scope.get("path", "")
        length = dict(scope.get("headers") or []).get(b"content-length")
        if length is not None:
            try:
                too_big = int(length) > settings.max_request_bytes
            except ValueError:
                too_big = True
            if too_big:
                await send({"type": "http.response.start", "status": 413,
                            "headers": [(b"content-type", b"application/json")] + self.HEADERS})
                await send({"type": "http.response.body", "body": b'{"detail":"Request is too large."}'})
                return

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers") or [])
                present = {name.lower() for name, _ in headers}
                is_docs = path in ("/docs", "/redoc")
                for name, value in self.HEADERS:
                    if name in present or (is_docs and name == b"content-security-policy"):
                        continue
                    headers.append((name, value))
                if settings.app_env == "production":
                    headers.append((b"strict-transport-security", b"max-age=31536000; includeSubDomains"))
                # Account, ride and payment answers must never be stored by
                # shared caches or left in a phone's back-button cache.
                if path.startswith("/api/") and b"cache-control" not in present:
                    headers.append((b"cache-control", b"no-store"))
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_with_headers)


application = OuterCORSMiddleware(
    app=SecurityHeaders(app),
    allow_origins=[
        "https://ekimove.com.ng",
        "https://www.ekimove.com.ng",
        "https://ekimove.onrender.com",
        "http://localhost:5173",
        "http://localhost:5175",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


