"""Public "Map a place" survey: contact phone and sender key on readings and suggestions.

Revision ID: 20261112_0023
Revises: 20261111_0022
"""
from alembic import op
import sqlalchemy as sa

revision = "20261112_0023"
down_revision = "20261111_0022"
branch_labels = None
depends_on = None


def _columns(table):
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    existing = _columns("place_pin_evidence")
    with op.batch_alter_table("place_pin_evidence") as batch:
        if "contact_phone" not in existing:
            batch.add_column(sa.Column("contact_phone", sa.String(32), nullable=True))
        if "client_key" not in existing:
            batch.add_column(sa.Column("client_key", sa.String(64), nullable=True))
    op.create_index("ix_place_pin_evidence_contact_phone", "place_pin_evidence", ["contact_phone"])
    op.create_index("ix_place_pin_evidence_client_key", "place_pin_evidence", ["client_key"])
    existing = _columns("place_suggestions")
    with op.batch_alter_table("place_suggestions") as batch:
        if "source" not in existing:
            batch.add_column(sa.Column("source", sa.String(12), nullable=False, server_default="rider"))
        if "contact_phone" not in existing:
            batch.add_column(sa.Column("contact_phone", sa.String(32), nullable=True))
        if "client_key" not in existing:
            batch.add_column(sa.Column("client_key", sa.String(64), nullable=True))
    op.create_index("ix_place_suggestions_contact_phone", "place_suggestions", ["contact_phone"])
    op.create_index("ix_place_suggestions_client_key", "place_suggestions", ["client_key"])


def downgrade() -> None:
    op.drop_index("ix_place_suggestions_client_key", table_name="place_suggestions")
    op.drop_index("ix_place_suggestions_contact_phone", table_name="place_suggestions")
    with op.batch_alter_table("place_suggestions") as batch:
        batch.drop_column("client_key")
        batch.drop_column("contact_phone")
        batch.drop_column("source")
    op.drop_index("ix_place_pin_evidence_client_key", table_name="place_pin_evidence")
    op.drop_index("ix_place_pin_evidence_contact_phone", table_name="place_pin_evidence")
    with op.batch_alter_table("place_pin_evidence") as batch:
        batch.drop_column("client_key")
        batch.drop_column("contact_phone")
