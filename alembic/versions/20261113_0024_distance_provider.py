"""Record which map service measured each road distance (Google or Geoapify).

Revision ID: 20261113_0024
Revises: 20261112_0023
"""

from alembic import op
import sqlalchemy as sa

revision = "20261113_0024"
down_revision = "20261112_0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("place_distances", sa.Column("provider", sa.String(length=12), nullable=True))
    # Every road distance so far came from Geoapify.
    op.execute("UPDATE place_distances SET provider = 'geoapify' WHERE source = 'road'")


def downgrade() -> None:
    op.drop_column("place_distances", "provider")
