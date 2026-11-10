"""Staff ID cards that the public can verify by QR code.

Revision ID: 20261114_0025
Revises: 20261113_0024
"""

from alembic import op
import sqlalchemy as sa

revision = "20261114_0025"
down_revision = "20261113_0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "staff_cards",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("staff_number", sa.String(length=16), nullable=False),
        sa.Column("code", sa.String(length=16), nullable=False),
        sa.Column("full_name", sa.String(length=120), nullable=False),
        sa.Column("title", sa.String(length=80), nullable=False),
        sa.Column("photo_ref", sa.String(length=255), nullable=True),
        sa.Column("issued_on", sa.Date(), nullable=False),
        sa.Column("expires_on", sa.Date(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_reason", sa.String(length=200), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_staff_cards_staff_number", "staff_cards", ["staff_number"])
    op.create_index("ix_staff_cards_code", "staff_cards", ["code"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_staff_cards_code", table_name="staff_cards")
    op.drop_index("ix_staff_cards_staff_number", table_name="staff_cards")
    op.drop_table("staff_cards")
