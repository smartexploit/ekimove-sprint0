"""Book for later, saved places, promo and invite codes, trip chat,
account deletion requests.

Revision ID: 20261031_0011
Revises: 20261031_0010
"""
from alembic import op
import sqlalchemy as sa

revision = "20261031_0011"
down_revision = "20261031_0010"
branch_labels = None
depends_on = None

USER_COLUMNS = (
    ("referral_code", lambda: sa.Column("referral_code", sa.String(16), nullable=True)),
    ("referred_by_user_id", lambda: sa.Column("referred_by_user_id", sa.Integer(),
                                              sa.ForeignKey("users.id", ondelete="SET NULL",
                                                            name="fk_users_referred_by_user_id"), nullable=True)),
    ("referral_rewarded_at", lambda: sa.Column("referral_rewarded_at", sa.DateTime(timezone=True), nullable=True)),
    ("deletion_requested_at", lambda: sa.Column("deletion_requested_at", sa.DateTime(timezone=True), nullable=True)),
    ("deletion_reason", lambda: sa.Column("deletion_reason", sa.Text(), nullable=True)),
)
RIDE_COLUMNS = (
    ("passenger_chat_read_at", lambda: sa.Column("passenger_chat_read_at", sa.DateTime(timezone=True), nullable=True)),
    ("driver_chat_read_at", lambda: sa.Column("driver_chat_read_at", sa.DateTime(timezone=True), nullable=True)),
)


def _add_columns(table: str, columns) -> None:
    existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}
    with op.batch_alter_table(table) as batch:
        for name, column in columns:
            if name not in existing:
                batch.add_column(column())


def _index(name: str, table: str, columns: list[str], unique: bool = False) -> None:
    if name not in {i["name"] for i in sa.inspect(op.get_bind()).get_indexes(table)}:
        op.create_index(name, table, columns, unique=unique)


def upgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())

    _add_columns("users", USER_COLUMNS)
    _index("ix_users_referral_code", "users", ["referral_code"], unique=True)
    _index("ix_users_deletion_requested_at", "users", ["deletion_requested_at"])
    _add_columns("ride_requests", (
        ("discount_amount", lambda: sa.Column("discount_amount", sa.Numeric(12, 2), nullable=False,
                                              server_default="0")),
    ))
    _add_columns("rides", RIDE_COLUMNS)

    if "saved_places" not in tables:
        op.create_table(
            "saved_places",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("label", sa.String(40), nullable=False),
            sa.Column("place_id", sa.Integer(), sa.ForeignKey("places.id", ondelete="CASCADE"), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint("user_id", "label", name="uq_saved_places_user_label"),
        )
        op.create_index("ix_saved_places_user_id", "saved_places", ["user_id"])

    if "promo_codes" not in tables:
        op.create_table(
            "promo_codes",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("code", sa.String(32), nullable=False),
            sa.Column("description", sa.String(160), nullable=True),
            sa.Column("kind", sa.String(8), nullable=False),
            sa.Column("value", sa.Numeric(12, 2), nullable=False),
            sa.Column("max_discount", sa.Numeric(12, 2), nullable=True),
            sa.Column("min_fare", sa.Numeric(12, 2), nullable=True),
            sa.Column("starts_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("max_uses", sa.Integer(), nullable=True),
            sa.Column("per_user_limit", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("first_ride_only", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("source", sa.String(12), nullable=False, server_default="admin"),
            sa.Column("owner_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True),
            sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.CheckConstraint("kind IN ('amount', 'percent')", name="ck_promo_codes_kind"),
            sa.CheckConstraint("source IN ('admin', 'referral')", name="ck_promo_codes_source"),
            sa.CheckConstraint("value > 0", name="ck_promo_codes_value_positive"),
        )
        op.create_index("ix_promo_codes_code", "promo_codes", ["code"], unique=True)
        op.create_index("ix_promo_codes_owner_user_id", "promo_codes", ["owner_user_id"])

    if "promo_redemptions" not in tables:
        op.create_table(
            "promo_redemptions",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("promo_id", sa.Integer(), sa.ForeignKey("promo_codes.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("ride_request_id", sa.Integer(), sa.ForeignKey("ride_requests.id", ondelete="CASCADE"),
                      nullable=False),
            sa.Column("discount", sa.Numeric(12, 2), nullable=False),
            sa.Column("status", sa.String(12), nullable=False, server_default="active"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.CheckConstraint("status IN ('active', 'released')", name="ck_promo_redemptions_status"),
            sa.UniqueConstraint("ride_request_id"),
        )
        op.create_index("ix_promo_redemptions_promo_id", "promo_redemptions", ["promo_id"])
        op.create_index("ix_promo_redemptions_user_id", "promo_redemptions", ["user_id"])

    if "trip_messages" not in tables:
        op.create_table(
            "trip_messages",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("ride_id", sa.Integer(), sa.ForeignKey("rides.id", ondelete="CASCADE"), nullable=False),
            sa.Column("sender_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("body", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )
        op.create_index("ix_trip_messages_ride_id", "trip_messages", ["ride_id"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    for table in ("trip_messages", "promo_redemptions", "promo_codes", "saved_places"):
        if table in tables:
            op.drop_table(table)
    for table, columns in (("rides", RIDE_COLUMNS), ("ride_requests", (("discount_amount", None),))):
        existing = {c["name"] for c in inspector.get_columns(table)}
        with op.batch_alter_table(table) as batch:
            for name, _ in columns:
                if name in existing:
                    batch.drop_column(name)
    indexes = {i["name"] for i in inspector.get_indexes("users")}
    for name in ("ix_users_referral_code", "ix_users_deletion_requested_at"):
        if name in indexes:
            op.drop_index(name, table_name="users")
    existing = {c["name"] for c in inspector.get_columns("users")}
    foreign_keys = {fk["name"] for fk in inspector.get_foreign_keys("users")}
    with op.batch_alter_table("users") as batch:
        if "fk_users_referred_by_user_id" in foreign_keys:
            batch.drop_constraint("fk_users_referred_by_user_id", type_="foreignkey")
        for name, _ in USER_COLUMNS:
            if name in existing:
                batch.drop_column(name)
