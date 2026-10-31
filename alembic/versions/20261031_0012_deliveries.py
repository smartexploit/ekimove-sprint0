"""Package deliveries: size, recipient and drop-off code.

Revision ID: 20261031_0012
Revises: 20261031_0011
"""
from alembic import op
import sqlalchemy as sa

revision = "20261031_0012"
down_revision = "20261031_0011"
branch_labels = None
depends_on = None

REQUEST_COLUMNS = (
    ("delivery_size", lambda: sa.Column("delivery_size", sa.String(8), nullable=True)),
    ("recipient_name", lambda: sa.Column("recipient_name", sa.String(160), nullable=True)),
    ("recipient_phone", lambda: sa.Column("recipient_phone", sa.String(32), nullable=True)),
    ("delivery_notes", lambda: sa.Column("delivery_notes", sa.Text(), nullable=True)),
    ("fragile", lambda: sa.Column("fragile", sa.Boolean(), nullable=False, server_default=sa.false())),
)
RIDE_COLUMNS = (
    ("delivery_code", lambda: sa.Column("delivery_code", sa.String(4), nullable=True)),
)


def _change(table: str, columns, add: bool) -> None:
    existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}
    with op.batch_alter_table(table) as batch:
        for name, column in columns:
            if add and name not in existing:
                batch.add_column(column())
            elif not add and name in existing:
                batch.drop_column(name)


def upgrade() -> None:
    _change("ride_requests", REQUEST_COLUMNS, True)
    _change("rides", RIDE_COLUMNS, True)


def downgrade() -> None:
    _change("rides", RIDE_COLUMNS, False)
    _change("ride_requests", REQUEST_COLUMNS, False)
