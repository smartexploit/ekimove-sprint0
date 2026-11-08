"""Pin checks: verified pins, evidence from trips and site visits, rider suggestions.

Revision ID: 20261111_0022
Revises: 20261110_0021
"""
from alembic import op
import sqlalchemy as sa

revision = "20261111_0022"
down_revision = "20261110_0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("places")}
    with op.batch_alter_table("places") as batch:
        if "pin_verified_at" not in existing:
            batch.add_column(sa.Column("pin_verified_at", sa.DateTime(timezone=True), nullable=True))
        if "pin_verified_by_user_id" not in existing:
            batch.add_column(sa.Column("pin_verified_by_user_id", sa.Integer(),
                                       sa.ForeignKey("users.id", ondelete="SET NULL",
                                                     name="fk_places_pin_verified_by"), nullable=True))
    op.create_table(
        "place_pin_evidence",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("place_id", sa.Integer(), sa.ForeignKey("places.id", ondelete="CASCADE"), nullable=False),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column("accuracy_m", sa.Integer(), nullable=True),
        sa.Column("source", sa.String(16), nullable=False),
        sa.Column("ride_id", sa.Integer(), sa.ForeignKey("rides.id", ondelete="SET NULL"), nullable=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_place_pin_evidence_place_id", "place_pin_evidence", ["place_id"])
    op.create_index("ix_place_pin_evidence_created_at", "place_pin_evidence", ["created_at"])
    op.create_table(
        "place_suggestions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column("accuracy_m", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(12), nullable=False, server_default="pending"),
        sa.Column("place_id", sa.Integer(), sa.ForeignKey("places.id", ondelete="SET NULL"), nullable=True),
        sa.Column("reviewed_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint("status IN ('pending', 'approved', 'rejected')", name="ck_place_suggestions_status"),
    )
    op.create_index("ix_place_suggestions_user_id", "place_suggestions", ["user_id"])
    op.create_index("ix_place_suggestions_status", "place_suggestions", ["status"])


def downgrade() -> None:
    op.drop_index("ix_place_suggestions_status", table_name="place_suggestions")
    op.drop_index("ix_place_suggestions_user_id", table_name="place_suggestions")
    op.drop_table("place_suggestions")
    op.drop_index("ix_place_pin_evidence_created_at", table_name="place_pin_evidence")
    op.drop_index("ix_place_pin_evidence_place_id", table_name="place_pin_evidence")
    op.drop_table("place_pin_evidence")
    with op.batch_alter_table("places") as batch:
        batch.drop_column("pin_verified_by_user_id")
        batch.drop_column("pin_verified_at")
