"""Vehicle details: make and model, year, colour and a private vehicle photo.

Revision ID: 20261127_0029
Revises: 20261123_0028
"""

from alembic import op
import sqlalchemy as sa

revision = "20261127_0029"
down_revision = "20261123_0028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("vehicles") as batch:
        batch.add_column(sa.Column("make_model", sa.String(80), nullable=True))
        batch.add_column(sa.Column("year", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("color", sa.String(40), nullable=True))
        batch.add_column(sa.Column("photo_path", sa.String(255), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("vehicles") as batch:
        batch.drop_column("photo_path")
        batch.drop_column("color")
        batch.drop_column("year")
        batch.drop_column("make_model")
