"""Add private driver photo reference.
Revision ID: 20261022_0002
Revises: 20261017_0002
"""
from alembic import op
import sqlalchemy as sa

revision = "20261022_0002"
down_revision = "20261017_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "photo_path" not in {c["name"] for c in inspector.get_columns("drivers")}:
        op.add_column(
        "drivers",
        sa.Column("photo_path", sa.String(length=500), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("drivers", "photo_path")
