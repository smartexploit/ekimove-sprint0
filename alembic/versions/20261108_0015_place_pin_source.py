"""Remember whether a place's map pin was set by staff or found automatically.

Revision ID: 20261108_0015
Revises: 20261104_0014
"""
from alembic import op
import sqlalchemy as sa

revision = "20261108_0015"
down_revision = "20261104_0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("places")}
    with op.batch_alter_table("places") as batch:
        if "pin_source" not in columns:
            batch.add_column(sa.Column("pin_source", sa.String(8), nullable=True))
        if "pin_label" not in columns:
            batch.add_column(sa.Column("pin_label", sa.String(200), nullable=True))
    # Pins that already exist were placed by staff.
    op.execute("UPDATE places SET pin_source = 'manual' WHERE latitude IS NOT NULL AND longitude IS NOT NULL "
               "AND pin_source IS NULL")


def downgrade() -> None:
    columns = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("places")}
    with op.batch_alter_table("places") as batch:
        if "pin_label" in columns:
            batch.drop_column("pin_label")
        if "pin_source" in columns:
            batch.drop_column("pin_source")
