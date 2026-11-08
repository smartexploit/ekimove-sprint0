"""Bookings to places that aren't on the list: dropped pins priced per km.

Revision ID: 20261108_0016
Revises: 20261108_0015
"""
from alembic import op
import sqlalchemy as sa

revision = "20261108_0016"
down_revision = "20261108_0015"
branch_labels = None
depends_on = None

COLUMNS = [
    ("origin_latitude", sa.Float()), ("origin_longitude", sa.Float()),
    ("destination_latitude", sa.Float()), ("destination_longitude", sa.Float()),
    ("distance_m", sa.Integer()), ("pricing", sa.String(12)),
]


def upgrade() -> None:
    existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("ride_requests")}
    with op.batch_alter_table("ride_requests") as batch:
        for name, kind in COLUMNS:
            if name not in existing:
                batch.add_column(sa.Column(name, kind, nullable=True))


def downgrade() -> None:
    existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("ride_requests")}
    with op.batch_alter_table("ride_requests") as batch:
        for name, _kind in reversed(COLUMNS):
            if name in existing:
                batch.drop_column(name)
