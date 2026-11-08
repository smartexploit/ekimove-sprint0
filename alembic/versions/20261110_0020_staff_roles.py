"""Staff accounts with limited console permissions.

Revision ID: 20261110_0020
Revises: 20261109_0019
"""
from alembic import op
import sqlalchemy as sa

revision = "20261110_0020"
down_revision = "20261109_0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("users")}
    if "staff_permissions" not in existing:
        with op.batch_alter_table("users") as batch:
            batch.add_column(sa.Column("staff_permissions", sa.JSON(), nullable=True))


def downgrade() -> None:
    # Staff accounts become ordinary passenger accounts again.
    op.execute("UPDATE users SET role = 'passenger' WHERE role = 'staff'")
    with op.batch_alter_table("users") as batch:
        batch.drop_column("staff_permissions")
