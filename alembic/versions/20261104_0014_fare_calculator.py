"""Fare calculator: measured place distances and where each fare came from.

Revision ID: 20261104_0014
Revises: 20261104_0013
"""
from alembic import op
import sqlalchemy as sa

revision = "20261104_0014"
down_revision = "20261104_0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "pricing_source" not in {c["name"] for c in inspector.get_columns("place_fares")}:
        with op.batch_alter_table("place_fares") as batch:
            batch.add_column(sa.Column("pricing_source", sa.String(8), nullable=False, server_default="manual"))
    if "place_distances" not in inspector.get_table_names():
        op.create_table(
            "place_distances",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("origin_place_id", sa.Integer(), sa.ForeignKey("places.id", ondelete="CASCADE"), nullable=False),
            sa.Column("destination_place_id", sa.Integer(), sa.ForeignKey("places.id", ondelete="CASCADE"),
                      nullable=False),
            sa.Column("meters", sa.Integer(), nullable=False),
            sa.Column("seconds", sa.Integer(), nullable=True),
            sa.Column("source", sa.String(8), nullable=False),
            sa.Column("pins", sa.String(80), nullable=False),
            sa.Column("computed_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.UniqueConstraint("origin_place_id", "destination_place_id", name="uq_place_distances_route"),
            sa.CheckConstraint("source IN ('road', 'estimate')", name="ck_place_distances_source"),
        )
        op.create_index("ix_place_distances_origin_place_id", "place_distances", ["origin_place_id"])
        op.create_index("ix_place_distances_destination_place_id", "place_distances", ["destination_place_id"])


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "place_distances" in inspector.get_table_names():
        op.drop_table("place_distances")
    if "pricing_source" in {c["name"] for c in inspector.get_columns("place_fares")}:
        with op.batch_alter_table("place_fares") as batch:
            batch.drop_column("pricing_source")
