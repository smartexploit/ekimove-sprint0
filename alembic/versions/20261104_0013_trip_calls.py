"""In-app voice calls between passengers and drivers.

Revision ID: 20261104_0013
Revises: 20261031_0012
"""
from alembic import op
import sqlalchemy as sa

revision = "20261104_0013"
down_revision = "20261031_0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if "trip_calls" not in tables:
        op.create_table(
            "trip_calls",
            sa.Column("id", sa.String(32), primary_key=True),
            sa.Column("ride_id", sa.Integer(), sa.ForeignKey("rides.id", ondelete="CASCADE"), nullable=False),
            sa.Column("caller_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("callee_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("status", sa.String(12), nullable=False, server_default="ringing"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("answered_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("ended_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.CheckConstraint("status IN ('ringing', 'active', 'ended', 'declined', 'missed', 'cancelled', 'failed')",
                               name="ck_trip_calls_status"),
        )
        for column in ("ride_id", "caller_user_id", "callee_user_id", "status", "created_at"):
            op.create_index(f"ix_trip_calls_{column}", "trip_calls", [column])
    if "trip_call_signals" not in tables:
        op.create_table(
            "trip_call_signals",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("call_id", sa.String(32), sa.ForeignKey("trip_calls.id", ondelete="CASCADE"), nullable=False),
            sa.Column("sender_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("kind", sa.String(12), nullable=False),
            sa.Column("payload", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.CheckConstraint("kind IN ('offer', 'answer', 'candidates')", name="ck_trip_call_signals_kind"),
        )
        op.create_index("ix_trip_call_signals_call_id", "trip_call_signals", ["call_id"])


def downgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if "trip_call_signals" in tables:
        op.drop_table("trip_call_signals")
    if "trip_calls" in tables:
        op.drop_table("trip_calls")
