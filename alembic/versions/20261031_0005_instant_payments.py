"""Instant payments: passenger virtual accounts, deposits, cancellations and refunds.

Revision ID: 20261031_0005
Revises: 20261029_0004
"""
from alembic import op
import sqlalchemy as sa

revision = "20261031_0005"
down_revision = "20261029_0004"
branch_labels = None
depends_on = None


RIDE_COLUMNS = (
    ("assigned_at", lambda: sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.func.now())),
    ("cancelled_at", lambda: sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True)),
    ("cancelled_by_user_id", lambda: sa.Column("cancelled_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="RESTRICT", name="fk_rides_cancelled_by_user_id"), nullable=True)),
    ("cancellation_fee", lambda: sa.Column("cancellation_fee", sa.Numeric(12, 2), nullable=True)),
)

PAYMENT_COLUMNS = (
    ("refund_amount", lambda: sa.Column("refund_amount", sa.Numeric(12, 2), nullable=True)),
    ("refund_status", lambda: sa.Column("refund_status", sa.String(16), nullable=True)),
    ("refund_reference", lambda: sa.Column("refund_reference", sa.String(120), nullable=True)),
    ("refunded_at", lambda: sa.Column("refunded_at", sa.DateTime(timezone=True), nullable=True)),
)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    ride_columns = {c["name"] for c in inspector.get_columns("rides")}
    with op.batch_alter_table("rides") as batch:
        for name, column in RIDE_COLUMNS:
            if name not in ride_columns:
                batch.add_column(column())

    payment_columns = {c["name"] for c in inspector.get_columns("payments")}
    with op.batch_alter_table("payments") as batch:
        for name, column in PAYMENT_COLUMNS:
            if name not in payment_columns:
                batch.add_column(column())
    payment_indexes = {i["name"] for i in sa.inspect(bind).get_indexes("payments")}
    if "ix_payments_refund_status" not in payment_indexes:
        op.create_index("ix_payments_refund_status", "payments", ["refund_status"])

    if "passenger_virtual_accounts" not in tables:
        op.create_table(
            "passenger_virtual_accounts",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("provider", sa.String(24), nullable=False, server_default="paystack"),
            sa.Column("customer_code", sa.String(64), nullable=False),
            sa.Column("account_number", sa.String(20), nullable=False),
            sa.Column("account_name", sa.String(160), nullable=False),
            sa.Column("bank_name", sa.String(120), nullable=False),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )
        op.create_index("ix_passenger_virtual_accounts_user_id", "passenger_virtual_accounts", ["user_id"], unique=True)
        op.create_index("ix_passenger_virtual_accounts_customer_code", "passenger_virtual_accounts", ["customer_code"], unique=True)
        op.create_index("ix_passenger_virtual_accounts_account_number", "passenger_virtual_accounts", ["account_number"], unique=True)

    if "bank_deposits" not in tables:
        op.create_table(
            "bank_deposits",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("provider", sa.String(24), nullable=False, server_default="paystack"),
            sa.Column("reference", sa.String(120), nullable=False),
            sa.Column("amount", sa.Numeric(12, 2), nullable=False),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=True),
            sa.Column("account_number", sa.String(20), nullable=True),
            sa.Column("sender_name", sa.String(160), nullable=True),
            sa.Column("payment_id", sa.Integer(), sa.ForeignKey("payments.id", ondelete="RESTRICT"), nullable=True),
            sa.Column("status", sa.String(16), nullable=False, server_default="unmatched"),
            sa.Column("note", sa.Text(), nullable=True),
            sa.Column("resolved_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.CheckConstraint("status IN ('matched', 'unmatched', 'resolved')", name="ck_bank_deposits_status"),
            sa.CheckConstraint("amount >= 0", name="ck_bank_deposits_amount_nonnegative"),
        )
        op.create_index("ix_bank_deposits_reference", "bank_deposits", ["reference"], unique=True)
        op.create_index("ix_bank_deposits_user_id", "bank_deposits", ["user_id"])
        op.create_index("ix_bank_deposits_payment_id", "bank_deposits", ["payment_id"])
        op.create_index("ix_bank_deposits_status", "bank_deposits", ["status"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "bank_deposits" in tables:
        op.drop_table("bank_deposits")
    if "passenger_virtual_accounts" in tables:
        op.drop_table("passenger_virtual_accounts")

    payment_indexes = {i["name"] for i in inspector.get_indexes("payments")}
    if "ix_payments_refund_status" in payment_indexes:
        op.drop_index("ix_payments_refund_status", table_name="payments")
    payment_columns = {c["name"] for c in inspector.get_columns("payments")}
    with op.batch_alter_table("payments") as batch:
        for name, _ in PAYMENT_COLUMNS:
            if name in payment_columns:
                batch.drop_column(name)

    ride_columns = {c["name"] for c in inspector.get_columns("rides")}
    with op.batch_alter_table("rides") as batch:
        for name, _ in RIDE_COLUMNS:
            if name in ride_columns:
                batch.drop_column(name)
