"""Sign up with phone or email, verification codes, push notifications.

* users.phone becomes optional (email-only accounts); emails are stored in
  lower case and must be unique.
* users gain phone_verified_at, email_verified_at and must_change_password.
* New tables: verification_codes and push_subscriptions.

Revision ID: 20261031_0010
Revises: 20261031_0009
"""
from alembic import op
import sqlalchemy as sa

revision = "20261031_0010"
down_revision = "20261031_0009"
branch_labels = None
depends_on = None

USER_COLUMNS = (
    ("phone_verified_at", lambda: sa.Column("phone_verified_at", sa.DateTime(timezone=True), nullable=True)),
    ("email_verified_at", lambda: sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True)),
    ("must_change_password", lambda: sa.Column("must_change_password", sa.Boolean(), nullable=False,
                                               server_default=sa.false())),
)


def _clean_emails(bind) -> None:
    """Lower-case emails and blank out later duplicates so the unique
    index can be created. The earliest account keeps the address."""
    users = sa.table("users", sa.column("id", sa.Integer), sa.column("email", sa.String))
    rows = bind.execute(sa.select(users.c.id, users.c.email).where(users.c.email.is_not(None))
                        .order_by(users.c.id)).all()
    seen: set[str] = set()
    for user_id, email in rows:
        cleaned = (email or "").strip().lower() or None
        if cleaned in seen:
            cleaned = None
        if cleaned:
            seen.add(cleaned)
        if cleaned != email:
            bind.execute(users.update().where(users.c.id == user_id).values(email=cleaned))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    existing = {c["name"]: c for c in inspector.get_columns("users")}
    with op.batch_alter_table("users") as batch:
        for name, column in USER_COLUMNS:
            if name not in existing:
                batch.add_column(column())
        if not existing["phone"]["nullable"]:
            batch.alter_column("phone", existing_type=sa.String(32), nullable=True)

    _clean_emails(bind)
    indexes = {i["name"] for i in sa.inspect(bind).get_indexes("users")}
    if "ix_users_email" not in indexes:
        op.create_index("ix_users_email", "users", ["email"], unique=True)

    if "verification_codes" not in tables:
        op.create_table(
            "verification_codes",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True),
            sa.Column("purpose", sa.String(24), nullable=False),
            sa.Column("channel", sa.String(8), nullable=False),
            sa.Column("destination", sa.String(254), nullable=False),
            sa.Column("code_hash", sa.String(64), nullable=False),
            sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.CheckConstraint("channel IN ('sms', 'email')", name="ck_verification_codes_channel"),
            sa.CheckConstraint("purpose IN ('verify_contact', 'reset_password', 'change_contact')",
                               name="ck_verification_codes_purpose"),
        )
        op.create_index("ix_verification_codes_user_id", "verification_codes", ["user_id"])
        op.create_index("ix_verification_codes_destination", "verification_codes", ["destination"])
        op.create_index("ix_verification_codes_created_at", "verification_codes", ["created_at"])

    if "push_subscriptions" not in tables:
        op.create_table(
            "push_subscriptions",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("endpoint", sa.String(1024), nullable=False),
            sa.Column("p256dh", sa.String(255), nullable=False),
            sa.Column("auth", sa.String(255), nullable=False),
            sa.Column("user_agent", sa.String(255), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("last_sent_at", sa.DateTime(timezone=True), nullable=True),
            sa.UniqueConstraint("endpoint", name="uq_push_subscriptions_endpoint"),
        )
        op.create_index("ix_push_subscriptions_user_id", "push_subscriptions", ["user_id"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    for table in ("push_subscriptions", "verification_codes"):
        if table in tables:
            op.drop_table(table)
    if "ix_users_email" in {i["name"] for i in inspector.get_indexes("users")}:
        op.drop_index("ix_users_email", table_name="users")
    existing = {c["name"] for c in inspector.get_columns("users")}
    # Email-only accounts have no phone; give them a placeholder so the
    # column can be made required again.
    users = sa.table("users", sa.column("id", sa.Integer), sa.column("phone", sa.String))
    for (user_id,) in bind.execute(sa.select(users.c.id).where(users.c.phone.is_(None))).all():
        bind.execute(users.update().where(users.c.id == user_id).values(phone=f"no-phone-{user_id}"))
    with op.batch_alter_table("users") as batch:
        batch.alter_column("phone", existing_type=sa.String(32), nullable=False)
        for name, _ in USER_COLUMNS:
            if name in existing:
                batch.drop_column(name)
