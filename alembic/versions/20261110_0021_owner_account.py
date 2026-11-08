"""Mark the founder's super-admin account as the owner.

Revision ID: 20261110_0021
Revises: 20261110_0020
"""
from alembic import op
import sqlalchemy as sa

revision = "20261110_0021"
down_revision = "20261110_0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("users")}
    if "is_owner" not in existing:
        with op.batch_alter_table("users") as batch:
            batch.add_column(sa.Column("is_owner", sa.Boolean(), nullable=False, server_default=sa.false()))
    # The first super-admin account created is the founder's.
    op.execute("""
        UPDATE users SET is_owner = TRUE WHERE id = (
            SELECT MIN(id) FROM users WHERE role = 'super_admin' AND removed_at IS NULL
        )
    """)


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_column("is_owner")
