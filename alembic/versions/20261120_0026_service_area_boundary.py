"""Service areas get a drawn boundary for dropped pins.

Revision ID: 20261120_0026
Revises: 20261114_0025
"""

from alembic import op
import sqlalchemy as sa

revision = "20261120_0026"
down_revision = "20261114_0025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("service_areas") as batch:
        batch.add_column(sa.Column("boundary", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("service_areas") as batch:
        batch.drop_column("boundary")
