"""Offer a request to all free matching drivers at once.

Drops the one-live-offer-per-request index; one live offer per driver stays.

Revision ID: 20261108_0018
Revises: 20261108_0017
"""
from alembic import op
import sqlalchemy as sa

revision = "20261108_0018"
down_revision = "20261108_0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    indexes = {i["name"] for i in sa.inspect(op.get_bind()).get_indexes("ride_offers")}
    if "uq_ride_offers_pending_request" in indexes:
        op.drop_index("uq_ride_offers_pending_request", table_name="ride_offers")


def downgrade() -> None:
    # Only safe when no request has more than one live offer.
    op.execute("UPDATE ride_offers SET status = 'withdrawn' WHERE status = 'pending' AND id NOT IN "
               "(SELECT MIN(id) FROM ride_offers WHERE status = 'pending' GROUP BY request_id)")
    indexes = {i["name"] for i in sa.inspect(op.get_bind()).get_indexes("ride_offers")}
    if "uq_ride_offers_pending_request" not in indexes:
        op.create_index("uq_ride_offers_pending_request", "ride_offers", ["request_id"], unique=True,
                        sqlite_where=sa.text("status = 'pending'"), postgresql_where=sa.text("status = 'pending'"))
