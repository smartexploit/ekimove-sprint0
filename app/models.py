from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, CheckConstraint, DateTime, Float, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    phone: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(160))
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    role: Mapped[str] = mapped_column(String(24), default="passenger", index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Driver(Base):
    __tablename__ = "drivers"
    __table_args__ = (CheckConstraint("verification_status IN ('pending', 'approved', 'rejected', 'suspended')", name="ck_drivers_verification_status"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), unique=True)
    verification_status: Mapped[str] = mapped_column(String(24), default="pending", nullable=False, index=True)
    is_online: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Vehicle(Base):
    __tablename__ = "vehicles"
    __table_args__ = (CheckConstraint("capacity >= 1", name="ck_vehicles_capacity_positive"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    driver_id: Mapped[int] = mapped_column(ForeignKey("drivers.id", ondelete="RESTRICT"), index=True)
    vehicle_type: Mapped[str] = mapped_column(String(32))
    plate_number: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    capacity: Mapped[int] = mapped_column(Integer)
    is_approved: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class Zone(Base):
    __tablename__ = "zones"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class Fare(Base):
    __tablename__ = "fares"
    __table_args__ = (
        CheckConstraint("base_amount >= 0", name="ck_fares_base_amount_nonnegative"),
        CheckConstraint("vehicle_multiplier > 0", name="ck_fares_vehicle_multiplier_positive"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    origin_zone_id: Mapped[int] = mapped_column(ForeignKey("zones.id", ondelete="RESTRICT"), index=True)
    destination_zone_id: Mapped[int] = mapped_column(ForeignKey("zones.id", ondelete="RESTRICT"), index=True)
    vehicle_type: Mapped[str] = mapped_column(String(32))
    base_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    vehicle_multiplier: Mapped[Decimal] = mapped_column(Numeric(6, 3), default=Decimal("1.000"))
    extra_passenger_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class RideRequest(Base):
    __tablename__ = "ride_requests"
    __table_args__ = (CheckConstraint("passenger_count >= 1", name="ck_ride_requests_passengers_positive"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    passenger_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    origin_text: Mapped[str] = mapped_column(String(255))
    destination_text: Mapped[str] = mapped_column(String(255))
    vehicle_type: Mapped[str] = mapped_column(String(32))
    passenger_count: Mapped[int] = mapped_column(Integer, default=1)
    quoted_fare: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    status: Mapped[str] = mapped_column(String(24), default="requested", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Ride(Base):
    __tablename__ = "rides"
    __table_args__ = (CheckConstraint("status IN ('assigned', 'driver_arriving', 'in_progress', 'completed', 'cancelled', 'incident_review')", name="ck_rides_status"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    request_id: Mapped[int] = mapped_column(ForeignKey("ride_requests.id", ondelete="RESTRICT"), unique=True)
    driver_id: Mapped[int] = mapped_column(ForeignKey("drivers.id", ondelete="RESTRICT"), index=True)
    status: Mapped[str] = mapped_column(String(24), default="assigned", nullable=False, index=True)
    agreed_fare: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Payment(Base):
    __tablename__ = "payments"
    __table_args__ = (
        CheckConstraint("method = 'bank_transfer'", name="ck_payments_bank_transfer_only"),
        CheckConstraint("status IN ('pending', 'awaiting_confirmation', 'confirmed', 'rejected', 'refunded')", name="ck_payments_status"),
        CheckConstraint("amount >= 0", name="ck_payments_amount_nonnegative"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    ride_id: Mapped[int] = mapped_column(ForeignKey("rides.id", ondelete="RESTRICT"), unique=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    method: Mapped[str] = mapped_column(String(24), default="bank_transfer", nullable=False)
    transfer_reference: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(32), default="pending", nullable=False, index=True)
    confirmed_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=True)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Rating(Base):
    __tablename__ = "ratings"
    __table_args__ = (CheckConstraint("score BETWEEN 1 AND 5", name="ck_ratings_score_range"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    ride_id: Mapped[int] = mapped_column(ForeignKey("rides.id", ondelete="RESTRICT"), index=True)
    author_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    score: Mapped[int] = mapped_column(Integer)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Incident(Base):
    __tablename__ = "incidents"
    __table_args__ = (CheckConstraint("severity IN ('low', 'medium', 'high', 'critical')", name="ck_incidents_severity"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    ride_id: Mapped[int | None] = mapped_column(ForeignKey("rides.id", ondelete="RESTRICT"), nullable=True, index=True)
    reporter_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=True)
    severity: Mapped[str] = mapped_column(String(16), default="medium", nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(24), default="open", nullable=False, index=True)
    description: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(100), index=True)
    entity_type: Mapped[str] = mapped_column(String(64))
    entity_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    details: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
class ServiceArea(Base):
    __tablename__ = "service_areas"
    __table_args__ = (
        CheckConstraint(
            "status IN ('draft', 'active', 'inactive')",
            name="ck_service_areas_status",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    slug: Mapped[str] = mapped_column(String(100), unique=True, index=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        String(16), default="draft", nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Place(Base):
    __tablename__ = "places"
    __table_args__ = (
        UniqueConstraint(
            "service_area_id", "name", name="uq_places_service_area_name"
        ),
        CheckConstraint(
            "place_type IN ('street', 'landmark', 'junction', 'bus_stop', "
            "'neighbourhood', 'other')",
            name="ck_places_place_type",
        ),
        CheckConstraint(
            "status IN ('pending', 'active', 'inactive')",
            name="ck_places_status",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    service_area_id: Mapped[int] = mapped_column(
        ForeignKey("service_areas.id", ondelete="RESTRICT"),
        index=True,
        nullable=False,
    )
    zone_id: Mapped[int] = mapped_column(
        ForeignKey("zones.id", ondelete="RESTRICT"),
        index=True,
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    place_type: Mapped[str] = mapped_column(
        String(24), default="other", nullable=False
    )
    address_text: Mapped[str | None] = mapped_column(String(255), nullable=True)
    aliases: Mapped[str | None] = mapped_column(Text, nullable=True)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        String(16), default="pending", nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
