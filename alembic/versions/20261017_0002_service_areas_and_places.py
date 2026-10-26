"""Restore service-area migration in the EkiMove revision chain."""
from alembic import op
import sqlalchemy as sa
from app.database import Base
import app.models  # noqa: F401

revision = "20261017_0002"
down_revision = "20261017_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if "users" in inspector.get_table_names():
        columns = {c["name"] for c in inspector.get_columns("users")}
        if "password_hash" not in columns:
            op.add_column(
                "users",
                sa.Column("password_hash", sa.String(255), nullable=True),
            )

    # Create these tables only if missing; preserve existing data.
    for name in ("service_areas", "places"):
        table = Base.metadata.tables.get(name)
        if table is not None:
            table.create(bind=bind, checkfirst=True)


def downgrade() -> None:
    raise RuntimeError(
        "Automatic downgrade disabled to protect EkiMove data. "
        "Use a reviewed, explicit rollback plan."
    )
