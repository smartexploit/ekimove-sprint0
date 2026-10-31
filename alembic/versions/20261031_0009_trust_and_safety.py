"""Trust and safety: pickup PIN, trip vehicle, GPS trail, share links,
ratings per author, passenger ID verification, emergency contact, policies.

Revision ID: 20261031_0009
Revises: 20261031_0008
"""
from alembic import op
import sqlalchemy as sa

revision = "20261031_0009"
down_revision = "20261031_0008"
branch_labels = None
depends_on = None

USER_COLUMNS = (
    ("emergency_contact_name", lambda: sa.Column("emergency_contact_name", sa.String(160), nullable=True)),
    ("emergency_contact_phone", lambda: sa.Column("emergency_contact_phone", sa.String(32), nullable=True)),
    ("policies_version", lambda: sa.Column("policies_version", sa.String(20), nullable=True)),
    ("policies_accepted_at", lambda: sa.Column("policies_accepted_at", sa.DateTime(timezone=True), nullable=True)),
)
RIDE_COLUMNS = (
    ("vehicle_id", lambda: sa.Column("vehicle_id", sa.Integer(), sa.ForeignKey("vehicles.id", ondelete="RESTRICT", name="fk_rides_vehicle_id"), nullable=True)),
    ("pickup_pin", lambda: sa.Column("pickup_pin", sa.String(4), nullable=True)),
    ("arrived_at", lambda: sa.Column("arrived_at", sa.DateTime(timezone=True), nullable=True)),
    ("share_token", lambda: sa.Column("share_token", sa.String(48), nullable=True)),
)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    existing = {c["name"] for c in inspector.get_columns("users")}
    with op.batch_alter_table("users") as batch:
        for name, column in USER_COLUMNS:
            if name not in existing:
                batch.add_column(column())

    existing = {c["name"] for c in inspector.get_columns("rides")}
    with op.batch_alter_table("rides") as batch:
        for name, column in RIDE_COLUMNS:
            if name not in existing:
                batch.add_column(column())
    indexes = {i["name"] for i in sa.inspect(bind).get_indexes("rides")}
    if "ix_rides_vehicle_id" not in indexes:
        op.create_index("ix_rides_vehicle_id", "rides", ["vehicle_id"])
    if "ix_rides_share_token" not in indexes:
        op.create_index("ix_rides_share_token", "rides", ["share_token"], unique=True)

    rating_columns = {c["name"] for c in inspector.get_columns("ratings")}
    rating_uniques = {u["name"] for u in inspector.get_unique_constraints("ratings")}
    with op.batch_alter_table("ratings") as batch:
        if "ratee_user_id" not in rating_columns:
            batch.add_column(sa.Column("ratee_user_id", sa.Integer(),
                                       sa.ForeignKey("users.id", ondelete="RESTRICT", name="fk_ratings_ratee_user_id"),
                                       nullable=True))
        if "uq_ratings_ride_author" not in rating_uniques:
            batch.create_unique_constraint("uq_ratings_ride_author", ["ride_id", "author_user_id"])
    if "ix_ratings_ratee_user_id" not in {i["name"] for i in sa.inspect(bind).get_indexes("ratings")}:
        op.create_index("ix_ratings_ratee_user_id", "ratings", ["ratee_user_id"])

    if "ride_location_points" not in tables:
        op.create_table(
            "ride_location_points",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("ride_id", sa.Integer(), sa.ForeignKey("rides.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("latitude", sa.Float(), nullable=False),
            sa.Column("longitude", sa.Float(), nullable=False),
            sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )
        op.create_index("ix_ride_location_points_ride_id", "ride_location_points", ["ride_id"])
        op.create_index("ix_ride_location_points_recorded_at", "ride_location_points", ["recorded_at"])

    if "passenger_verifications" not in tables:
        op.create_table(
            "passenger_verifications",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("id_type", sa.String(20), nullable=False),
            sa.Column("id_number", sa.String(40), nullable=False),
            sa.Column("id_photo_ref", sa.String(500), nullable=True),
            sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
            sa.Column("review_note", sa.Text(), nullable=True),
            sa.Column("reviewed_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=True),
            sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
            sa.CheckConstraint("status IN ('pending', 'approved', 'rejected')", name="ck_passenger_verifications_status"),
            sa.CheckConstraint("id_type IN ('nin', 'voters_card', 'drivers_licence', 'passport')",
                               name="ck_passenger_verifications_id_type"),
        )
        op.create_index("ix_passenger_verifications_user_id", "passenger_verifications", ["user_id"], unique=True)
        op.create_index("ix_passenger_verifications_status", "passenger_verifications", ["status"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    for table in ("passenger_verifications", "ride_location_points"):
        if table in tables:
            op.drop_table(table)
    if "ix_ratings_ratee_user_id" in {i["name"] for i in inspector.get_indexes("ratings")}:
        op.drop_index("ix_ratings_ratee_user_id", table_name="ratings")
    rating_columns = {c["name"] for c in inspector.get_columns("ratings")}
    rating_uniques = {u["name"] for u in inspector.get_unique_constraints("ratings")}
    with op.batch_alter_table("ratings") as batch:
        if "uq_ratings_ride_author" in rating_uniques:
            batch.drop_constraint("uq_ratings_ride_author", type_="unique")
        if "ratee_user_id" in rating_columns:
            batch.drop_column("ratee_user_id")
    indexes = {i["name"] for i in inspector.get_indexes("rides")}
    for name in ("ix_rides_share_token", "ix_rides_vehicle_id"):
        if name in indexes:
            op.drop_index(name, table_name="rides")
    existing = {c["name"] for c in inspector.get_columns("rides")}
    with op.batch_alter_table("rides") as batch:
        for name, _ in RIDE_COLUMNS:
            if name in existing:
                batch.drop_column(name)
    existing = {c["name"] for c in inspector.get_columns("users")}
    with op.batch_alter_table("users") as batch:
        for name, _ in USER_COLUMNS:
            if name in existing:
                batch.drop_column(name)
