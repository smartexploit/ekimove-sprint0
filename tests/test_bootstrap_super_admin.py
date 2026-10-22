import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.auth import hash_password
from app.models import AuditLog, User
from scripts.bootstrap_super_admin import (
    BootstrapRefused,
    bootstrap,
)


@pytest.fixture
def test_db(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'bootstrap_test.db'}"
    )
    User.__table__.create(engine)
    AuditLog.__table__.create(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)

    with factory.begin() as db:
        db.add(
            User(
                id=1,
                phone="08000000001",
                full_name="Test Passenger",
                password_hash=hash_password("Passenger-Test-Password-1!"),
                role="passenger",
                is_active=True,
            )
        )

    yield factory
    engine.dispose()


def test_dry_run_does_not_change_role_or_write_audit(test_db):
    result = bootstrap(
        test_db, "08000000001", "Passenger-Test-Password-1!"
    )

    assert "DRY RUN" in result
    with test_db() as db:
        user = db.get(User, 1)
        assert user.role == "passenger"
        assert db.scalars(select(AuditLog)).all() == []


def test_wrong_password_is_refused(test_db):
    with pytest.raises(BootstrapRefused):
        bootstrap(test_db, "08000000001", "wrong-password", apply=True)

    with test_db() as db:
        assert db.get(User, 1).role == "passenger"
        assert db.scalars(select(AuditLog)).all() == []


def test_inactive_account_is_refused(test_db):
    with test_db.begin() as db:
        db.get(User, 1).is_active = False

    with pytest.raises(BootstrapRefused):
        bootstrap(
            test_db, "08000000001", "Passenger-Test-Password-1!", apply=True
        )

    with test_db() as db:
        assert db.get(User, 1).role == "passenger"
        assert db.scalars(select(AuditLog)).all() == []


def test_existing_super_admin_blocks_bootstrap(test_db):
    with test_db.begin() as db:
        db.add(
            User(
                id=2,
                phone="08000000002",
                full_name="Existing Administrator",
                password_hash=hash_password("Existing-Admin-Password-2!"),
                role="super_admin",
                is_active=True,
            )
        )

    with pytest.raises(BootstrapRefused):
        bootstrap(
            test_db, "08000000001", "Passenger-Test-Password-1!", apply=True
        )

    with test_db() as db:
        assert db.get(User, 1).role == "passenger"
        assert db.scalars(select(AuditLog)).all() == []


def test_success_commits_role_and_audit_together(test_db):
    result = bootstrap(
        test_db,
        "08000000001",
        "Passenger-Test-Password-1!",
        apply=True,
    )

    assert "committed" in result.lower()
    with test_db() as db:
        user = db.get(User, 1)
        logs = db.scalars(select(AuditLog)).all()

        assert user.role == "super_admin"
        assert len(logs) == 1
        assert logs[0].action == "bootstrap_super_admin"
        assert logs[0].entity_id == "1"
        assert logs[0].actor_user_id is None


def test_second_bootstrap_is_refused(test_db):
    bootstrap(
        test_db,
        "08000000001",
        "Passenger-Test-Password-1!",
        apply=True,
    )

    with pytest.raises(BootstrapRefused):
        bootstrap(
            test_db,
            "08000000001",
            "Passenger-Test-Password-1!",
            apply=True,
        )

    with test_db() as db:
        assert db.get(User, 1).role == "super_admin"
        assert len(db.scalars(select(AuditLog)).all()) == 1
