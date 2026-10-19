"""Initial EkiMove schema.

Revision ID: 20261017_0001
Revises:
Create Date: 2026-10-17
"""
from alembic import op

from app.database import Base
import app.models  # noqa: F401 - registers model metadata

revision = "20261017_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind)


def downgrade() -> None:
    bind = op.get_bind()
    Base.metadata.drop_all(bind=bind)
