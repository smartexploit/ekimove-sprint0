"""Student travel: bus departures, seat bookings and their payments.

Revision ID: 20261123_0027
Revises: 20261120_0026
"""

from alembic import op
import sqlalchemy as sa

revision = "20261123_0027"
down_revision = "20261120_0026"
branch_labels = None
depends_on = None

OLD_KINDS = "kind IN ('trip', 'cancellation_fee', 'payout', 'payout_reversal', 'adjustment')"
NEW_KINDS = "kind IN ('trip', 'cancellation_fee', 'payout', 'payout_reversal', 'adjustment', 'travel')"


def upgrade() -> None:
    op.create_table(
        "travel_departures",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("origin", sa.String(80), nullable=False),
        sa.Column("pickup_spot", sa.String(160), nullable=False),
        sa.Column("destination", sa.String(80), nullable=False),
        sa.Column("drop_off", sa.String(160), nullable=True),
        sa.Column("departs_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("seats_total", sa.Integer(), nullable=False),
        sa.Column("price_per_seat", sa.Numeric(12, 2), nullable=False),
        sa.Column("allow_deposit", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("deposit_percent", sa.Integer(), nullable=False, server_default="50"),
        sa.Column("balance_due_hours", sa.Integer(), nullable=False, server_default="24"),
        sa.Column("refund_cutoff_hours", sa.Integer(), nullable=False, server_default="48"),
        sa.Column("operator_name", sa.String(160), nullable=True),
        sa.Column("driver_id", sa.Integer(), sa.ForeignKey("drivers.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("vehicle_id", sa.Integer(), sa.ForeignKey("vehicles.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="open"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("departed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('open', 'closed', 'departed', 'completed', 'cancelled')",
                           name="ck_travel_departures_status"),
        sa.CheckConstraint("seats_total >= 1", name="ck_travel_departures_seats"),
        sa.CheckConstraint("price_per_seat >= 0", name="ck_travel_departures_price"),
        sa.CheckConstraint("deposit_percent BETWEEN 10 AND 100", name="ck_travel_departures_deposit"),
    )
    op.create_index("ix_travel_departures_origin", "travel_departures", ["origin"])
    op.create_index("ix_travel_departures_destination", "travel_departures", ["destination"])
    op.create_index("ix_travel_departures_departs_at", "travel_departures", ["departs_at"])
    op.create_index("ix_travel_departures_driver_id", "travel_departures", ["driver_id"])
    op.create_index("ix_travel_departures_status", "travel_departures", ["status"])

    op.create_table(
        "travel_bookings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("departure_id", sa.Integer(), sa.ForeignKey("travel_departures.id", ondelete="RESTRICT"),
                  nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("ticket_code", sa.String(16), nullable=False),
        sa.Column("seats", sa.Integer(), nullable=False),
        sa.Column("traveller_names", sa.JSON(), nullable=True),
        sa.Column("payment_option", sa.String(8), nullable=False, server_default="full"),
        sa.Column("amount_total", sa.Numeric(12, 2), nullable=False),
        sa.Column("deposit_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("amount_paid", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("status", sa.String(20), nullable=False, server_default="awaiting_payment"),
        sa.Column("matric_number", sa.String(40), nullable=True),
        sa.Column("kin_phone", sa.String(32), nullable=True),
        sa.Column("share_with_school", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("checked_in_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("refund_amount", sa.Numeric(12, 2), nullable=True),
        sa.Column("refund_status", sa.String(16), nullable=True),
        sa.Column("refund_reference", sa.String(120), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('awaiting_payment', 'reserved', 'paid', 'cancelled', 'expired')",
                           name="ck_travel_bookings_status"),
        sa.CheckConstraint("payment_option IN ('full', 'deposit')", name="ck_travel_bookings_option"),
        sa.CheckConstraint("seats BETWEEN 1 AND 10", name="ck_travel_bookings_seats"),
        sa.CheckConstraint("amount_paid >= 0", name="ck_travel_bookings_paid"),
    )
    op.create_index("ix_travel_bookings_departure_id", "travel_bookings", ["departure_id"])
    op.create_index("ix_travel_bookings_user_id", "travel_bookings", ["user_id"])
    op.create_index("ix_travel_bookings_ticket_code", "travel_bookings", ["ticket_code"], unique=True)
    op.create_index("ix_travel_bookings_status", "travel_bookings", ["status"])
    op.create_index("ix_travel_bookings_refund_status", "travel_bookings", ["refund_status"])

    op.create_table(
        "travel_payments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("booking_id", sa.Integer(), sa.ForeignKey("travel_bookings.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("method", sa.String(24), nullable=False),
        sa.Column("reference", sa.String(120), nullable=True, unique=True),
        sa.Column("recorded_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("amount > 0", name="ck_travel_payments_amount"),
    )
    op.create_index("ix_travel_payments_booking_id", "travel_payments", ["booking_id"])

    with op.batch_alter_table("bank_deposits") as batch:
        batch.add_column(sa.Column("travel_booking_id", sa.Integer(), nullable=True))
        batch.create_foreign_key("fk_bank_deposits_travel_booking", "travel_bookings", ["travel_booking_id"], ["id"],
                                 ondelete="RESTRICT")
        batch.create_index("ix_bank_deposits_travel_booking_id", ["travel_booking_id"])

    with op.batch_alter_table("earning_entries") as batch:
        batch.add_column(sa.Column("travel_departure_id", sa.Integer(), nullable=True))
        batch.create_foreign_key("fk_earning_entries_travel_departure", "travel_departures",
                                 ["travel_departure_id"], ["id"], ondelete="RESTRICT")
        batch.create_index("ix_earning_entries_travel_departure_id", ["travel_departure_id"])
        batch.create_unique_constraint("uq_earning_entries_travel_kind", ["travel_departure_id", "kind"])
        batch.drop_constraint("ck_earning_entries_kind", type_="check")
        batch.create_check_constraint("ck_earning_entries_kind", NEW_KINDS)


def downgrade() -> None:
    with op.batch_alter_table("earning_entries") as batch:
        batch.drop_constraint("ck_earning_entries_kind", type_="check")
        batch.create_check_constraint("ck_earning_entries_kind", OLD_KINDS)
        batch.drop_constraint("uq_earning_entries_travel_kind", type_="unique")
        batch.drop_index("ix_earning_entries_travel_departure_id")
        batch.drop_constraint("fk_earning_entries_travel_departure", type_="foreignkey")
        batch.drop_column("travel_departure_id")
    with op.batch_alter_table("bank_deposits") as batch:
        batch.drop_index("ix_bank_deposits_travel_booking_id")
        batch.drop_constraint("fk_bank_deposits_travel_booking", type_="foreignkey")
        batch.drop_column("travel_booking_id")
    op.drop_table("travel_payments")
    op.drop_table("travel_bookings")
    op.drop_table("travel_departures")
