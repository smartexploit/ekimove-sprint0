"""Driver application details, 72-hour review and inspection invitations.

Revision ID: 20261109_0019
Revises: 20261108_0018
"""
from alembic import op
import sqlalchemy as sa

revision = "20261109_0019"
down_revision = "20261108_0018"
branch_labels = None
depends_on = None

COLUMNS = [
    ("gender", sa.String(16)),
    ("date_of_birth", sa.Date()),
    ("home_address", sa.String(240)),
    ("town", sa.String(80)),
    ("licence_number", sa.String(32)),
    ("emergency_contact_name", sa.String(160)),
    ("emergency_contact_phone", sa.String(32)),
    ("safety_pledges", sa.JSON()),
    ("safety_pledged_at", sa.DateTime(timezone=True)),
    ("review_due_at", sa.DateTime(timezone=True)),
    ("reviewed_at", sa.DateTime(timezone=True)),
]


def upgrade() -> None:
    existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("drivers")}
    with op.batch_alter_table("drivers") as batch:
        for name, kind in COLUMNS:
            if name not in existing:
                batch.add_column(sa.Column(name, kind, nullable=True))
    op.create_index("ix_drivers_review_due_at", "drivers", ["review_due_at"])
    # Applications already waiting get 72 hours from now, not from when they applied.
    op.execute("UPDATE drivers SET review_due_at = CURRENT_TIMESTAMP WHERE verification_status = 'pending'")
    if op.get_bind().dialect.name == "postgresql":
        op.execute("UPDATE drivers SET review_due_at = review_due_at + INTERVAL '72 hours' "
                   "WHERE verification_status = 'pending'")
    else:
        op.execute("UPDATE drivers SET review_due_at = datetime(review_due_at, '+72 hours') "
                   "WHERE verification_status = 'pending'")

    op.create_table(
        "driver_invitations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("driver_id", sa.Integer(), sa.ForeignKey("drivers.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("scheduled_for", sa.DateTime(timezone=True), nullable=False),
        sa.Column("venue", sa.String(240), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="invited"),
        sa.Column("driver_note", sa.String(300), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("outcome_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("kind IN ('inspection', 'orientation', 'both')", name="ck_driver_invitations_kind"),
        sa.CheckConstraint("status IN ('invited', 'confirmed', 'reschedule', 'attended', 'missed', 'cancelled')",
                           name="ck_driver_invitations_status"),
    )
    op.create_index("ix_driver_invitations_driver_id", "driver_invitations", ["driver_id"])
    op.create_index("ix_driver_invitations_status", "driver_invitations", ["status"])


def downgrade() -> None:
    op.drop_index("ix_driver_invitations_status", table_name="driver_invitations")
    op.drop_index("ix_driver_invitations_driver_id", table_name="driver_invitations")
    op.drop_table("driver_invitations")
    op.drop_index("ix_drivers_review_due_at", table_name="drivers")
    with op.batch_alter_table("drivers") as batch:
        for name, _kind in reversed(COLUMNS):
            batch.drop_column(name)
