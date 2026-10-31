"""Accounts admin, support chat, haulage quotes and app settings.

Revision ID: 20261031_0007
Revises: 20261031_0006
"""
from alembic import op
import sqlalchemy as sa

revision = "20261031_0007"
down_revision = "20261031_0006"
branch_labels = None
depends_on = None

USER_COLUMNS = (
    ("email", lambda: sa.Column("email", sa.String(254), nullable=True)),
    ("suspended_at", lambda: sa.Column("suspended_at", sa.DateTime(timezone=True), nullable=True)),
    ("suspension_reason", lambda: sa.Column("suspension_reason", sa.Text(), nullable=True)),
    ("removed_at", lambda: sa.Column("removed_at", sa.DateTime(timezone=True), nullable=True)),
)
REQUEST_COLUMNS = (
    ("service_type", lambda: sa.Column("service_type", sa.String(16), nullable=False, server_default="ride")),
    ("load_description", lambda: sa.Column("load_description", sa.Text(), nullable=True)),
    ("scheduled_for", lambda: sa.Column("scheduled_for", sa.DateTime(timezone=True), nullable=True)),
    ("quote_terms", lambda: sa.Column("quote_terms", sa.Text(), nullable=True)),
    ("quoted_at", lambda: sa.Column("quoted_at", sa.DateTime(timezone=True), nullable=True)),
)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    existing = {c["name"] for c in inspector.get_columns("users")}
    with op.batch_alter_table("users") as batch:
        for name, column in USER_COLUMNS:
            if name not in existing:
                batch.add_column(column())

    existing = {c["name"] for c in inspector.get_columns("ride_requests")}
    with op.batch_alter_table("ride_requests") as batch:
        for name, column in REQUEST_COLUMNS:
            if name not in existing:
                batch.add_column(column())
    indexes = {i["name"] for i in sa.inspect(bind).get_indexes("ride_requests")}
    if "ix_ride_requests_service_type" not in indexes:
        op.create_index("ix_ride_requests_service_type", "ride_requests", ["service_type"])

    if "app_settings" not in tables:
        op.create_table(
            "app_settings",
            sa.Column("key", sa.String(64), primary_key=True),
            sa.Column("value", sa.Text(), nullable=False),
            sa.Column("updated_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )

    if "support_threads" not in tables:
        op.create_table(
            "support_threads",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("subject", sa.String(160), nullable=False),
            sa.Column("status", sa.String(16), nullable=False, server_default="open"),
            sa.Column("ride_request_id", sa.Integer(), sa.ForeignKey("ride_requests.id", ondelete="RESTRICT"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("user_last_read_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("staff_last_read_at", sa.DateTime(timezone=True), nullable=True),
            sa.CheckConstraint("status IN ('open', 'closed')", name="ck_support_threads_status"),
        )
        for column in ("user_id", "status", "ride_request_id", "last_message_at"):
            op.create_index(f"ix_support_threads_{column}", "support_threads", [column])

    if "support_messages" not in tables:
        op.create_table(
            "support_messages",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("thread_id", sa.Integer(), sa.ForeignKey("support_threads.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("sender_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=True),
            sa.Column("from_staff", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("body", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )
        op.create_index("ix_support_messages_thread_id", "support_messages", ["thread_id"])
        op.create_index("ix_support_messages_created_at", "support_messages", ["created_at"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    for table in ("support_messages", "support_threads", "app_settings"):
        if table in tables:
            op.drop_table(table)
    indexes = {i["name"] for i in inspector.get_indexes("ride_requests")}
    if "ix_ride_requests_service_type" in indexes:
        op.drop_index("ix_ride_requests_service_type", table_name="ride_requests")
    existing = {c["name"] for c in inspector.get_columns("ride_requests")}
    with op.batch_alter_table("ride_requests") as batch:
        for name, _ in REQUEST_COLUMNS:
            if name in existing:
                batch.drop_column(name)
    existing = {c["name"] for c in inspector.get_columns("users")}
    with op.batch_alter_table("users") as batch:
        for name, _ in USER_COLUMNS:
            if name in existing:
                batch.drop_column(name)
