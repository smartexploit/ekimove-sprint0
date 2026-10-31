"""Driver earnings: payout accounts, payouts and the earnings ledger.

Revision ID: 20261031_0006
Revises: 20261031_0005
"""
from alembic import op
import sqlalchemy as sa

revision = "20261031_0006"
down_revision = "20261031_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())

    if "driver_payout_accounts" not in tables:
        op.create_table(
            "driver_payout_accounts",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("driver_id", sa.Integer(), sa.ForeignKey("drivers.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("bank_code", sa.String(20), nullable=False),
            sa.Column("bank_name", sa.String(120), nullable=False),
            sa.Column("account_number", sa.String(20), nullable=False),
            sa.Column("account_name", sa.String(160), nullable=False),
            sa.Column("verified", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("recipient_code", sa.String(64), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )
        op.create_index("ix_driver_payout_accounts_driver_id", "driver_payout_accounts", ["driver_id"], unique=True)

    if "driver_payouts" not in tables:
        op.create_table(
            "driver_payouts",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("driver_id", sa.Integer(), sa.ForeignKey("drivers.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("amount", sa.Numeric(12, 2), nullable=False),
            sa.Column("method", sa.String(16), nullable=False, server_default="manual"),
            sa.Column("status", sa.String(16), nullable=False, server_default="queued"),
            sa.Column("reference", sa.String(64), nullable=False),
            sa.Column("transfer_code", sa.String(64), nullable=True),
            sa.Column("bank_reference", sa.String(120), nullable=True),
            sa.Column("failure_reason", sa.Text(), nullable=True),
            sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.CheckConstraint("status IN ('queued', 'processing', 'paid', 'failed')", name="ck_driver_payouts_status"),
            sa.CheckConstraint("amount > 0", name="ck_driver_payouts_amount_positive"),
        )
        op.create_index("ix_driver_payouts_driver_id", "driver_payouts", ["driver_id"])
        op.create_index("ix_driver_payouts_status", "driver_payouts", ["status"])
        op.create_index("ix_driver_payouts_reference", "driver_payouts", ["reference"], unique=True)

    if "earning_entries" not in tables:
        op.create_table(
            "earning_entries",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("driver_id", sa.Integer(), sa.ForeignKey("drivers.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("kind", sa.String(24), nullable=False),
            sa.Column("ride_id", sa.Integer(), sa.ForeignKey("rides.id", ondelete="RESTRICT"), nullable=True),
            sa.Column("payout_id", sa.Integer(), sa.ForeignKey("driver_payouts.id", ondelete="RESTRICT"), nullable=True),
            sa.Column("gross", sa.Numeric(12, 2), nullable=False),
            sa.Column("commission", sa.Numeric(12, 2), nullable=False),
            sa.Column("commission_percent", sa.Numeric(5, 2), nullable=True),
            sa.Column("amount", sa.Numeric(12, 2), nullable=False),
            sa.Column("note", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.CheckConstraint(
                "kind IN ('trip', 'cancellation_fee', 'payout', 'payout_reversal', 'adjustment')",
                name="ck_earning_entries_kind",
            ),
            sa.UniqueConstraint("ride_id", "kind", name="uq_earning_entries_ride_kind"),
            sa.UniqueConstraint("payout_id", "kind", name="uq_earning_entries_payout_kind"),
        )
        for column in ("driver_id", "kind", "ride_id", "payout_id", "created_at"):
            op.create_index(f"ix_earning_entries_{column}", "earning_entries", [column])


def downgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    for table in ("earning_entries", "driver_payouts", "driver_payout_accounts"):
        if table in tables:
            op.drop_table(table)
