"""Add place-specific fare rules for EkiMove.

Revision ID: 20261029_0004
Revises: 20261028_0003
"""
from alembic import op
import sqlalchemy as sa

revision = "20261029_0004"
down_revision = "20261028_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ride_requests",
        sa.Column(
            "origin_place_id",
            sa.Integer(),
            sa.ForeignKey("places.id", ondelete="RESTRICT"),
            nullable=True,
        ),
    )
    op.add_column(
        "ride_requests",
        sa.Column(
            "destination_place_id",
            sa.Integer(),
            sa.ForeignKey("places.id", ondelete="RESTRICT"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_ride_requests_origin_place_id",
        "ride_requests",
        ["origin_place_id"],
    )
    op.create_index(
        "ix_ride_requests_destination_place_id",
        "ride_requests",
        ["destination_place_id"],
    )
    op.create_table(
        "place_fares",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "origin_place_id",
            sa.Integer(),
            sa.ForeignKey("places.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "destination_place_id",
            sa.Integer(),
            sa.ForeignKey("places.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("vehicle_type", sa.String(32), nullable=False),
        sa.Column("base_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column(
            "vehicle_multiplier",
            sa.Numeric(6, 3),
            nullable=False,
            server_default="1.000",
        ),
        sa.Column(
            "extra_passenger_amount",
            sa.Numeric(12, 2),
            nullable=False,
            server_default="0.00",
        ),
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "origin_place_id <> destination_place_id",
            name="ck_place_fares_distinct_places",
        ),
        sa.CheckConstraint(
            "base_amount >= 0",
            name="ck_place_fares_base_amount_nonnegative",
        ),
        sa.CheckConstraint(
            "vehicle_multiplier > 0",
            name="ck_place_fares_multiplier_positive",
        ),
        sa.CheckConstraint(
            "extra_passenger_amount >= 0",
            name="ck_place_fares_extra_passenger_nonnegative",
        ),
        sa.UniqueConstraint(
            "origin_place_id",
            "destination_place_id",
            "vehicle_type",
            name="uq_place_fares_route_vehicle",
        ),
    )
    op.create_index(
        "ix_place_fares_origin_place_id",
        "place_fares",
        ["origin_place_id"],
    )
    op.create_index(
        "ix_place_fares_destination_place_id",
        "place_fares",
        ["destination_place_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_ride_requests_destination_place_id",
        table_name="ride_requests",
    )
    op.drop_index(
        "ix_ride_requests_origin_place_id",
        table_name="ride_requests",
    )
    op.drop_column("ride_requests", "destination_place_id")
    op.drop_column("ride_requests", "origin_place_id")
    op.drop_index(
        "ix_place_fares_destination_place_id",
        table_name="place_fares",
    )
    op.drop_index(
        "ix_place_fares_origin_place_id",
        table_name="place_fares",
    )
    op.drop_table("place_fares")

