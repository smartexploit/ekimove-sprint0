"""Automatic dispatch: ride offers, driver location, dispatch state.

Revision ID: 20261031_0008
Revises: 20261031_0007
"""
from alembic import op
import sqlalchemy as sa

revision = "20261031_0008"
down_revision = "20261031_0007"
branch_labels = None
depends_on = None

DRIVER_COLUMNS = (
    ("last_latitude", lambda: sa.Column("last_latitude", sa.Float(), nullable=True)),
    ("last_longitude", lambda: sa.Column("last_longitude", sa.Float(), nullable=True)),
    ("location_updated_at", lambda: sa.Column("location_updated_at", sa.DateTime(timezone=True), nullable=True)),
    ("online_since", lambda: sa.Column("online_since", sa.DateTime(timezone=True), nullable=True)),
)
REQUEST_COLUMNS = (
    ("dispatch_status", lambda: sa.Column("dispatch_status", sa.String(16), nullable=True)),
    ("dispatch_attempts", lambda: sa.Column("dispatch_attempts", sa.Integer(), nullable=False, server_default="0")),
)
PENDING = sa.text("status = 'pending'")


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    existing = {c["name"] for c in inspector.get_columns("drivers")}
    with op.batch_alter_table("drivers") as batch:
        for name, column in DRIVER_COLUMNS:
            if name not in existing:
                batch.add_column(column())

    existing = {c["name"] for c in inspector.get_columns("ride_requests")}
    with op.batch_alter_table("ride_requests") as batch:
        for name, column in REQUEST_COLUMNS:
            if name not in existing:
                batch.add_column(column())
    if "ix_ride_requests_dispatch_status" not in {i["name"] for i in sa.inspect(bind).get_indexes("ride_requests")}:
        op.create_index("ix_ride_requests_dispatch_status", "ride_requests", ["dispatch_status"])

    if "ride_offers" not in set(inspector.get_table_names()):
        op.create_table(
            "ride_offers",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("request_id", sa.Integer(), sa.ForeignKey("ride_requests.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("driver_id", sa.Integer(), sa.ForeignKey("drivers.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
            sa.Column("distance_m", sa.Integer(), nullable=True),
            sa.Column("offered_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
            sa.CheckConstraint("status IN ('pending', 'accepted', 'declined', 'expired', 'withdrawn')",
                               name="ck_ride_offers_status"),
        )
        for column in ("request_id", "driver_id", "status"):
            op.create_index(f"ix_ride_offers_{column}", "ride_offers", [column])
        op.create_index("uq_ride_offers_pending_request", "ride_offers", ["request_id"], unique=True,
                        sqlite_where=PENDING, postgresql_where=PENDING)
        op.create_index("uq_ride_offers_pending_driver", "ride_offers", ["driver_id"], unique=True,
                        sqlite_where=PENDING, postgresql_where=PENDING)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "ride_offers" in set(inspector.get_table_names()):
        op.drop_table("ride_offers")
    if "ix_ride_requests_dispatch_status" in {i["name"] for i in inspector.get_indexes("ride_requests")}:
        op.drop_index("ix_ride_requests_dispatch_status", table_name="ride_requests")
    existing = {c["name"] for c in inspector.get_columns("ride_requests")}
    with op.batch_alter_table("ride_requests") as batch:
        for name, _ in REQUEST_COLUMNS:
            if name in existing:
                batch.drop_column(name)
    existing = {c["name"] for c in inspector.get_columns("drivers")}
    with op.batch_alter_table("drivers") as batch:
        for name, _ in DRIVER_COLUMNS:
            if name in existing:
                batch.drop_column(name)
