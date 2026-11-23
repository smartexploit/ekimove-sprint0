"""Student travel safety: trip-share links on tickets and SOS from a bus.

Revision ID: 20261123_0028
Revises: 20261123_0027
"""

from alembic import op
import sqlalchemy as sa

revision = "20261123_0028"
down_revision = "20261123_0027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("travel_bookings") as batch:
        batch.add_column(sa.Column("share_token", sa.String(48), nullable=True))
        batch.create_index("ix_travel_bookings_share_token", ["share_token"], unique=True)
    with op.batch_alter_table("incidents") as batch:
        batch.add_column(sa.Column("travel_booking_id", sa.Integer(), nullable=True))
        batch.create_foreign_key("fk_incidents_travel_booking", "travel_bookings", ["travel_booking_id"], ["id"],
                                 ondelete="RESTRICT")
        batch.create_index("ix_incidents_travel_booking_id", ["travel_booking_id"])


def downgrade() -> None:
    with op.batch_alter_table("incidents") as batch:
        batch.drop_index("ix_incidents_travel_booking_id")
        batch.drop_constraint("fk_incidents_travel_booking", type_="foreignkey")
        batch.drop_column("travel_booking_id")
    with op.batch_alter_table("travel_bookings") as batch:
        batch.drop_index("ix_travel_bookings_share_token")
        batch.drop_column("share_token")
