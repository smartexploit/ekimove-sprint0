""""Keep me signed in": remembered phones with password or PIN unlock.

Revision ID: 20261108_0017
Revises: 20261108_0016
"""
from alembic import op
import sqlalchemy as sa

revision = "20261108_0017"
down_revision = "20261108_0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "device_sessions" in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        "device_sessions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("pin_hash", sa.String(255), nullable=True),
        sa.Column("label", sa.String(120), nullable=True),
        sa.Column("failed_attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_device_sessions_user_id", "device_sessions", ["user_id"])
    op.create_index("ix_device_sessions_token_hash", "device_sessions", ["token_hash"], unique=True)


def downgrade() -> None:
    if "device_sessions" in sa.inspect(op.get_bind()).get_table_names():
        op.drop_table("device_sessions")
