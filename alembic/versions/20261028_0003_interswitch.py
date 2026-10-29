"""Support Interswitch checkout references and payment method.

Revision ID: 20261028_0003
Revises: 20261022_0002
"""
from alembic import op
import sqlalchemy as sa

revision = "20261028_0003"
down_revision = "20261022_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {c["name"] for c in inspector.get_columns("payments")}
    checks = {c["name"] for c in inspector.get_check_constraints("payments")}

    if "ck_payments_bank_transfer_only" in checks:
        op.drop_constraint(
            "ck_payments_bank_transfer_only", "payments", type_="check"
        )

    if "ck_payments_method" not in checks:
        op.create_check_constraint(
            "ck_payments_method",
            "payments",
            "method IN ('bank_transfer', 'interswitch')",
        )

    if "provider_transaction_ref" not in columns:
        op.add_column(
            "payments",
            sa.Column("provider_transaction_ref", sa.String(120), nullable=True),
        )

    indexes = {i["name"] for i in sa.inspect(bind).get_indexes("payments")}
    if "ix_payments_provider_transaction_ref" not in indexes:
        op.create_index(
            "ix_payments_provider_transaction_ref",
            "payments",
            ["provider_transaction_ref"],
            unique=True,
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    indexes = {i["name"] for i in inspector.get_indexes("payments")}
    checks = {c["name"] for c in inspector.get_check_constraints("payments")}
    columns = {c["name"] for c in inspector.get_columns("payments")}

    if "ix_payments_provider_transaction_ref" in indexes:
        op.drop_index("ix_payments_provider_transaction_ref", table_name="payments")

    if "provider_transaction_ref" in columns:
        op.drop_column("payments", "provider_transaction_ref")

    if "ck_payments_method" in checks:
        op.drop_constraint("ck_payments_method", "payments", type_="check")

    op.create_check_constraint(
        "ck_payments_bank_transfer_only",
        "payments",
        "method = 'bank_transfer'",
    )
