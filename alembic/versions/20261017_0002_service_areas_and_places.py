# EkiMove: add service areas, places, and password-hash preparation.
revision = "20261017_0002"
down_revision = "20261017_0001"
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa


def upgrade() -> None:
    # Nullable so existing users remain valid during staged authentication rollout.
    op.add_column(
        "users",
        sa.Column("password_hash", sa.String(length=255), nullable=True),
    )

    op.create_table(
        "service_areas",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=120), nullable=False, unique=True),
        sa.Column("slug", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.String(length=16),
            nullable=False,
            server_default="draft",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status IN ('draft', 'active', 'inactive')",
            name="ck_service_areas_status",
        ),
    )
    op.create_index(
        "ix_service_areas_slug", "service_areas", ["slug"], unique=True
    )
    op.create_index(
        "ix_service_areas_status", "service_areas", ["status"], unique=False
    )

    op.create_table(
        "places",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("service_area_id", sa.Integer(), nullable=False),
        sa.Column("zone_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column(
            "place_type",
            sa.String(length=24),
            nullable=False,
            server_default="other",
        ),
        sa.Column("address_text", sa.String(length=255), nullable=True),
        sa.Column("aliases", sa.Text(), nullable=True),
        sa.Column("latitude", sa.Float(), nullable=True),
        sa.Column("longitude", sa.Float(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.String(length=16),
            nullable=False,
            server_default="pending",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["service_area_id"],
            ["service_areas.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["zone_id"],
            ["zones.id"],
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint(
            "service_area_id",
            "name",
            name="uq_places_service_area_name",
        ),
        sa.CheckConstraint(
            "place_type IN ('street', 'landmark', 'junction', "
            "'bus_stop', 'neighbourhood', 'other')",
            name="ck_places_place_type",
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'active', 'inactive')",
            name="ck_places_status",
        ),
    )
    op.create_index(
        "ix_places_service_area_id",
        "places",
        ["service_area_id"],
        unique=False,
    )
    op.create_index(
        "ix_places_zone_id", "places", ["zone_id"], unique=False
    )
    op.create_index(
        "ix_places_status", "places", ["status"], unique=False
    )


def downgrade() -> None:
    # Reverses only this revision. Dropping these tables removes their data.
    op.drop_index("ix_places_status", table_name="places")
    op.drop_index("ix_places_zone_id", table_name="places")
    op.drop_index("ix_places_service_area_id", table_name="places")
    op.drop_table("places")

    op.drop_index("ix_service_areas_status", table_name="service_areas")
    op.drop_index("ix_service_areas_slug", table_name="service_areas")
    op.drop_table("service_areas")

    op.drop_column("users", "password_hash")
