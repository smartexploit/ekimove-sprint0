"""Card checkouts for student travel bookings (Interswitch).

Revision ID: 20261127_0030
Revises: 20261127_0029
"""

from alembic import op
import sqlalchemy as sa

revision = "20261127_0030"
down_revision = "20261127_0029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "travel_card_checkouts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("booking_id", sa.Integer(), sa.ForeignKey("travel_bookings.id", ondelete="RESTRICT"),
                  nullable=False),
        sa.Column("reference", sa.String(60), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("status", sa.String(12), nullable=False, server_default="pending"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('pending', 'paid')", name="ck_travel_card_checkouts_status"),
        sa.CheckConstraint("amount > 0", name="ck_travel_card_checkouts_amount"),
    )
    op.create_index("ix_travel_card_checkouts_booking_id", "travel_card_checkouts", ["booking_id"])
    op.create_index("ix_travel_card_checkouts_reference", "travel_card_checkouts", ["reference"], unique=True)
    op.create_index("ix_travel_card_checkouts_status", "travel_card_checkouts", ["status"])


def downgrade() -> None:
    op.drop_index("ix_travel_card_checkouts_status", table_name="travel_card_checkouts")
    op.drop_index("ix_travel_card_checkouts_reference", table_name="travel_card_checkouts")
    op.drop_index("ix_travel_card_checkouts_booking_id", table_name="travel_card_checkouts")
    op.drop_table("travel_card_checkouts")
