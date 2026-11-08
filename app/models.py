from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, CheckConstraint, DateTime, Float, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    # People sign up with a phone number, an email address, or both.
    phone: Mapped[str | None] = mapped_column(String(32), unique=True, index=True, nullable=True)
    full_name: Mapped[str] = mapped_column(String(160))
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    role: Mapped[str] = mapped_column(String(24), default="passenger", index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    email: Mapped[str | None] = mapped_column(String(254), unique=True, index=True, nullable=True)
    # Set when the person proves they own the number or address with a code.
    phone_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Set after a super-admin resets the password: choose a new one first.
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    # Invite code this person shares, who invited them, and when the
    # person who invited them was rewarded (after their first paid trip).
    referral_code: Mapped[str | None] = mapped_column(String(16), unique=True, index=True, nullable=True)
    referred_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    referral_rewarded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # The person asked for their account to be deleted (data rights).
    deletion_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    deletion_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Set by a super-admin. Suspended accounts can't sign in; removed
    # accounts are anonymised but their trips and payments are kept.
    suspended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    suspension_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    emergency_contact_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    emergency_contact_phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # Version of EkiMove's policies this person last accepted, and when.
    policies_version: Mapped[str | None] = mapped_column(String(20), nullable=True)
    policies_accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Driver(Base):
    __tablename__ = "drivers"
    __table_args__ = (CheckConstraint("verification_status IN ('pending', 'approved', 'rejected', 'suspended')", name="ck_drivers_verification_status"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), unique=True)
    photo_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    verification_status: Mapped[str] = mapped_column(String(24), default="pending", nullable=False, index=True)
    is_online: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # Last location shared from the driver's phone while online (for
    # offering trips to the nearest driver), and when they went online.
    last_latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    location_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    online_since: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


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
    origin_place_id: Mapped[int | None] = mapped_column(
        ForeignKey("places.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    destination_place_id: Mapped[int | None] = mapped_column(
        ForeignKey("places.id", ondelete="RESTRICT"), nullable=True, index=True
    )

    origin_text: Mapped[str] = mapped_column(String(255))
    destination_text: Mapped[str] = mapped_column(String(255))
    vehicle_type: Mapped[str] = mapped_column(String(32))
    passenger_count: Mapped[int] = mapped_column(Integer, default=1)
    quoted_fare: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    status: Mapped[str] = mapped_column(String(24), default="requested", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # "ride" (fixed fare) or "haulage" (loads/luggage, priced by quote).
    service_type: Mapped[str] = mapped_column(String(16), default="ride", server_default="ride", nullable=False, index=True)
    load_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    scheduled_for: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    quote_terms: Mapped[str | None] = mapped_column(Text, nullable=True)
    quoted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Automatic dispatch: "searching" (no driver free yet), "offering",
    # or "manual" (needs an admin). None once assigned or never dispatched.
    dispatch_status: Mapped[str | None] = mapped_column(String(16), nullable=True, index=True)
    # Promo or invite discount taken off what the passenger pays. The
    # driver still earns on the full fare; EkiMove covers the discount.
    discount_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"),
                                                     server_default="0", nullable=False)
    # Package deliveries (service_type "delivery"): size, who receives it.
    delivery_size: Mapped[str | None] = mapped_column(String(8), nullable=True)
    recipient_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    recipient_phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    delivery_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    fragile: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    dispatch_attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    # A pin the rider dropped when the place isn't on EkiMove's list (the
    # matching *_place_id is then empty), and how the price was worked out.
    origin_latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    origin_longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    destination_latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    destination_longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    distance_m: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pricing: Mapped[str | None] = mapped_column(String(12), nullable=True)


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
    assigned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, server_default=func.now())
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=True)
    cancellation_fee: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    # Traceability and pickup safety.
    vehicle_id: Mapped[int | None] = mapped_column(ForeignKey("vehicles.id", ondelete="RESTRICT"), nullable=True, index=True)
    pickup_pin: Mapped[str | None] = mapped_column(String(4), nullable=True)
    arrived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    share_token: Mapped[str | None] = mapped_column(String(48), nullable=True, unique=True, index=True)
    # When each side last read the trip chat.
    # Deliveries: the recipient gives this code to the driver at drop-off.
    delivery_code: Mapped[str | None] = mapped_column(String(4), nullable=True)
    passenger_chat_read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    driver_chat_read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Payment(Base):
    __tablename__ = "payments"
    __table_args__ = (
        CheckConstraint("method IN ('bank_transfer', 'interswitch')", name="ck_payments_method"),
        CheckConstraint("status IN ('pending', 'awaiting_confirmation', 'confirmed', 'rejected', 'refunded')", name="ck_payments_status"),
        CheckConstraint("amount >= 0", name="ck_payments_amount_nonnegative"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    ride_id: Mapped[int] = mapped_column(ForeignKey("rides.id", ondelete="RESTRICT"), unique=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    method: Mapped[str] = mapped_column(String(24), default="bank_transfer", nullable=False)
    transfer_reference: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    provider_transaction_ref: Mapped[str | None] = mapped_column(String(120), nullable=True, unique=True, index=True)
    status: Mapped[str] = mapped_column(String(32), default="pending", nullable=False, index=True)
    confirmed_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=True)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Refund owed back to the passenger (e.g. a cancelled paid ride).
    # refund_status: None, "due" or "paid".
    refund_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    refund_status: Mapped[str | None] = mapped_column(String(16), nullable=True, index=True)
    refund_reference: Mapped[str | None] = mapped_column(String(120), nullable=True)
    refunded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PassengerVirtualAccount(Base):
    """A passenger's personal bank account number for paying rides."""

    __tablename__ = "passenger_virtual_accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), unique=True, index=True)
    provider: Mapped[str] = mapped_column(String(24), default="paystack", nullable=False)
    customer_code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    account_number: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    account_name: Mapped[str] = mapped_column(String(160))
    bank_name: Mapped[str] = mapped_column(String(120))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class BankDeposit(Base):
    """A transfer received into a passenger's virtual account."""

    __tablename__ = "bank_deposits"
    __table_args__ = (
        CheckConstraint("status IN ('matched', 'unmatched', 'resolved')", name="ck_bank_deposits_status"),
        CheckConstraint("amount >= 0", name="ck_bank_deposits_amount_nonnegative"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    provider: Mapped[str] = mapped_column(String(24), default="paystack", nullable=False)
    reference: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=True, index=True)
    account_number: Mapped[str | None] = mapped_column(String(20), nullable=True)
    sender_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    payment_id: Mapped[int | None] = mapped_column(ForeignKey("payments.id", ondelete="RESTRICT"), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(16), default="unmatched", nullable=False, index=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    resolved_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class DriverPayoutAccount(Base):
    """Where a driver's earnings are paid."""

    __tablename__ = "driver_payout_accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    driver_id: Mapped[int] = mapped_column(ForeignKey("drivers.id", ondelete="RESTRICT"), unique=True, index=True)
    bank_code: Mapped[str] = mapped_column(String(20))
    bank_name: Mapped[str] = mapped_column(String(120))
    account_number: Mapped[str] = mapped_column(String(20))
    account_name: Mapped[str] = mapped_column(String(160))
    # True when the account name was confirmed with the bank via Paystack.
    verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    recipient_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class DriverPayout(Base):
    """One transfer of a driver's balance to their bank account."""

    __tablename__ = "driver_payouts"
    __table_args__ = (
        CheckConstraint("status IN ('queued', 'processing', 'paid', 'failed')", name="ck_driver_payouts_status"),
        CheckConstraint("amount > 0", name="ck_driver_payouts_amount_positive"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    driver_id: Mapped[int] = mapped_column(ForeignKey("drivers.id", ondelete="RESTRICT"), index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    # "paystack" (automatic transfer) or "manual" (sent by staff).
    method: Mapped[str] = mapped_column(String(16), default="manual", nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="queued", nullable=False, index=True)
    reference: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    transfer_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    bank_reference: Mapped[str | None] = mapped_column(String(120), nullable=True)
    failure_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class EarningEntry(Base):
    """Driver earnings ledger. A driver's balance is the sum of amounts.

    trip / cancellation_fee: credit of the fare (or fee) minus commission.
    payout: debit when a payout is created; payout_reversal: credit back
    if that payout fails.
    """

    __tablename__ = "earning_entries"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('trip', 'cancellation_fee', 'payout', 'payout_reversal', 'adjustment')",
            name="ck_earning_entries_kind",
        ),
        UniqueConstraint("ride_id", "kind", name="uq_earning_entries_ride_kind"),
        UniqueConstraint("payout_id", "kind", name="uq_earning_entries_payout_kind"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    driver_id: Mapped[int] = mapped_column(ForeignKey("drivers.id", ondelete="RESTRICT"), index=True)
    kind: Mapped[str] = mapped_column(String(24), index=True)
    ride_id: Mapped[int | None] = mapped_column(ForeignKey("rides.id", ondelete="RESTRICT"), nullable=True, index=True)
    payout_id: Mapped[int | None] = mapped_column(ForeignKey("driver_payouts.id", ondelete="RESTRICT"), nullable=True, index=True)
    gross: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    commission: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    commission_percent: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class RideOffer(Base):
    """A request offered to one driver, who may accept or decline in time."""

    __tablename__ = "ride_offers"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'accepted', 'declined', 'expired', 'withdrawn')",
            name="ck_ride_offers_status",
        ),
        # At most one live offer per request and per driver, enforced by
        # the database so two app servers can never double-offer.
        Index("uq_ride_offers_pending_request", "request_id", unique=True,
              sqlite_where=text("status = 'pending'"), postgresql_where=text("status = 'pending'")),
        Index("uq_ride_offers_pending_driver", "driver_id", unique=True,
              sqlite_where=text("status = 'pending'"), postgresql_where=text("status = 'pending'")),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    request_id: Mapped[int] = mapped_column(ForeignKey("ride_requests.id", ondelete="RESTRICT"), index=True)
    driver_id: Mapped[int] = mapped_column(ForeignKey("drivers.id", ondelete="RESTRICT"), index=True)
    status: Mapped[str] = mapped_column(String(16), default="pending", nullable=False, index=True)
    distance_m: Mapped[int | None] = mapped_column(Integer, nullable=True)
    offered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class RideLocationPoint(Base):
    """The driver's position during a trip (the trip's GPS trail)."""

    __tablename__ = "ride_location_points"

    id: Mapped[int] = mapped_column(primary_key=True)
    ride_id: Mapped[int] = mapped_column(ForeignKey("rides.id", ondelete="RESTRICT"), index=True)
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class PassengerVerification(Base):
    """A passenger's government ID, reviewed by an admin."""

    __tablename__ = "passenger_verifications"
    __table_args__ = (
        CheckConstraint("status IN ('pending', 'approved', 'rejected')", name="ck_passenger_verifications_status"),
        CheckConstraint("id_type IN ('nin', 'voters_card', 'drivers_licence', 'passport')",
                        name="ck_passenger_verifications_id_type"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), unique=True, index=True)
    id_type: Mapped[str] = mapped_column(String(20))
    id_number: Mapped[str] = mapped_column(String(40))
    id_photo_ref: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="pending", nullable=False, index=True)
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=True)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AppSetting(Base):
    """Business rules the super-admin can change in the app."""

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text)
    updated_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class SupportThread(Base):
    """A conversation between a user and EkiMove support."""

    __tablename__ = "support_threads"
    __table_args__ = (CheckConstraint("status IN ('open', 'closed')", name="ck_support_threads_status"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    subject: Mapped[str] = mapped_column(String(160))
    status: Mapped[str] = mapped_column(String(16), default="open", nullable=False, index=True)
    ride_request_id: Mapped[int | None] = mapped_column(ForeignKey("ride_requests.id", ondelete="RESTRICT"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_message_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    user_last_read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    staff_last_read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SupportMessage(Base):
    __tablename__ = "support_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    thread_id: Mapped[int] = mapped_column(ForeignKey("support_threads.id", ondelete="RESTRICT"), index=True)
    sender_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=True)
    from_staff: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class Rating(Base):
    __tablename__ = "ratings"
    __table_args__ = (
        CheckConstraint("score BETWEEN 1 AND 5", name="ck_ratings_score_range"),
        UniqueConstraint("ride_id", "author_user_id", name="uq_ratings_ride_author"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    ride_id: Mapped[int] = mapped_column(ForeignKey("rides.id", ondelete="RESTRICT"), index=True)
    author_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    ratee_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=True, index=True)
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
    # "manual": placed by staff; "auto": found from the name (check it).
    pin_source: Mapped[str | None] = mapped_column(String(8), nullable=True)
    pin_label: Mapped[str | None] = mapped_column(String(200), nullable=True)
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


class PlaceFare(Base):
    """Manually configured fare for a specific place-to-place route."""

    __tablename__ = "place_fares"
    __table_args__ = (
        CheckConstraint(
            "origin_place_id <> destination_place_id",
            name="ck_place_fares_distinct_places",
        ),
        CheckConstraint(
            "base_amount >= 0",
            name="ck_place_fares_base_amount_nonnegative",
        ),
        CheckConstraint(
            "vehicle_multiplier > 0",
            name="ck_place_fares_multiplier_positive",
        ),
        CheckConstraint(
            "extra_passenger_amount >= 0",
            name="ck_place_fares_extra_passenger_nonnegative",
        ),
        UniqueConstraint(
            "origin_place_id",
            "destination_place_id",
            "vehicle_type",
            name="uq_place_fares_route_vehicle",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    origin_place_id: Mapped[int] = mapped_column(
        ForeignKey("places.id", ondelete="RESTRICT"),
        index=True,
        nullable=False,
    )
    destination_place_id: Mapped[int] = mapped_column(
        ForeignKey("places.id", ondelete="RESTRICT"),
        index=True,
        nullable=False,
    )
    vehicle_type: Mapped[str] = mapped_column(String(32), nullable=False)
    base_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    vehicle_multiplier: Mapped[Decimal] = mapped_column(
        Numeric(6, 3), default=Decimal("1.000"), nullable=False
    )
    extra_passenger_amount: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), default=Decimal("0.00"), nullable=False
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )
    # "manual": set by hand in the console (the fare calculator never
    # changes it); "auto": filled in by the fare calculator.
    pricing_source: Mapped[str] = mapped_column(
        String(8), default="manual", server_default="manual", nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class PlaceDistance(Base):
    """Road distance from one place to another, measured once and reused
    by the fare calculator. "road" comes from the map service; "estimate"
    is the straight-line distance with an allowance for bends."""

    __tablename__ = "place_distances"
    __table_args__ = (
        UniqueConstraint("origin_place_id", "destination_place_id", name="uq_place_distances_route"),
        CheckConstraint("source IN ('road', 'estimate')", name="ck_place_distances_source"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    origin_place_id: Mapped[int] = mapped_column(ForeignKey("places.id", ondelete="CASCADE"), index=True)
    destination_place_id: Mapped[int] = mapped_column(ForeignKey("places.id", ondelete="CASCADE"), index=True)
    meters: Mapped[int] = mapped_column(Integer)
    seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source: Mapped[str] = mapped_column(String(8))
    # The pins the distance was measured from, so a moved pin is re-measured.
    pins: Mapped[str] = mapped_column(String(80))
    computed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class VerificationCode(Base):
    """A one-time code sent by text or email. Only a hash is stored."""

    __tablename__ = "verification_codes"
    __table_args__ = (
        CheckConstraint("channel IN ('sms', 'email')", name="ck_verification_codes_channel"),
        CheckConstraint(
            "purpose IN ('verify_contact', 'reset_password', 'change_contact')",
            name="ck_verification_codes_purpose",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    purpose: Mapped[str] = mapped_column(String(24))
    channel: Mapped[str] = mapped_column(String(8))
    destination: Mapped[str] = mapped_column(String(254), index=True)
    code_hash: Mapped[str] = mapped_column(String(64))
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class PushSubscription(Base):
    """A phone or browser that agreed to receive EkiMove notifications."""

    __tablename__ = "push_subscriptions"
    __table_args__ = (UniqueConstraint("endpoint", name="uq_push_subscriptions_endpoint"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    endpoint: Mapped[str] = mapped_column(String(1024))
    p256dh: Mapped[str] = mapped_column(String(255))
    auth: Mapped[str] = mapped_column(String(255))
    user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SavedPlace(Base):
    """A passenger's shortcut to a place they use often (Home, Work…)."""

    __tablename__ = "saved_places"
    __table_args__ = (UniqueConstraint("user_id", "label", name="uq_saved_places_user_label"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    label: Mapped[str] = mapped_column(String(40))
    place_id: Mapped[int] = mapped_column(ForeignKey("places.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PromoCode(Base):
    """A discount code. Admin codes are for everyone; personal codes
    (invite rewards) can only be used by their owner."""

    __tablename__ = "promo_codes"
    __table_args__ = (
        CheckConstraint("kind IN ('amount', 'percent')", name="ck_promo_codes_kind"),
        CheckConstraint("source IN ('admin', 'referral')", name="ck_promo_codes_source"),
        CheckConstraint("value > 0", name="ck_promo_codes_value_positive"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    description: Mapped[str | None] = mapped_column(String(160), nullable=True)
    kind: Mapped[str] = mapped_column(String(8))
    value: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    max_discount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    min_fare: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    max_uses: Mapped[int | None] = mapped_column(Integer, nullable=True)
    per_user_limit: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)
    first_ride_only: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    source: Mapped[str] = mapped_column(String(12), default="admin", server_default="admin", nullable=False)
    owner_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PromoRedemption(Base):
    """A code used on one booking. Released if the booking is cancelled
    before it was paid, so the code can be used again."""

    __tablename__ = "promo_redemptions"
    __table_args__ = (CheckConstraint("status IN ('active', 'released')", name="ck_promo_redemptions_status"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    promo_id: Mapped[int] = mapped_column(ForeignKey("promo_codes.id", ondelete="RESTRICT"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    ride_request_id: Mapped[int] = mapped_column(ForeignKey("ride_requests.id", ondelete="CASCADE"), unique=True)
    discount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    status: Mapped[str] = mapped_column(String(12), default="active", server_default="active", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TripMessage(Base):
    """A chat message between a passenger and their driver during a trip."""

    __tablename__ = "trip_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    ride_id: Mapped[int] = mapped_column(ForeignKey("rides.id", ondelete="CASCADE"), index=True)
    sender_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TripCall(Base):
    """An in-app voice call between a passenger and their driver.

    Audio goes directly between the two phones (WebRTC) and is never
    recorded. Only who called, when and for how long is kept.
    """

    __tablename__ = "trip_calls"
    __table_args__ = (
        CheckConstraint("status IN ('ringing', 'active', 'ended', 'declined', 'missed', 'cancelled', 'failed')",
                        name="ck_trip_calls_status"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    ride_id: Mapped[int] = mapped_column(ForeignKey("rides.id", ondelete="CASCADE"), index=True)
    caller_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    callee_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(12), default="ringing", nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    answered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)


class TripCallSignal(Base):
    """Connection details exchanged while a call is set up. Deleted as soon
    as the call ends (they contain network addresses)."""

    __tablename__ = "trip_call_signals"
    __table_args__ = (CheckConstraint("kind IN ('offer', 'answer', 'candidates')", name="ck_trip_call_signals_kind"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    call_id: Mapped[str] = mapped_column(ForeignKey("trip_calls.id", ondelete="CASCADE"), index=True)
    sender_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    kind: Mapped[str] = mapped_column(String(12))
    payload: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
