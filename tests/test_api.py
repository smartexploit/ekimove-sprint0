from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.rate_limit import RateLimitUnavailable

from app.auth import hash_password
from app.config import settings
from app.database import Base, get_db
import app.main as main_module
from app.main import app
from app.models import Fare, User, Zone


@pytest.fixture()
def client():
    previous_secret = settings.jwt_secret_key
    settings.jwt_secret_key = "test-only-secret-not-for-production"

    test_engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(
        bind=test_engine,
        autoflush=False,
        autocommit=False,
    )
    Base.metadata.create_all(bind=test_engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db

    with TestingSessionLocal() as db:
        db.add_all([
            User(
                id=1,
                phone="08000000001",
                full_name="Test Passenger",
                password_hash=hash_password("Passenger-Test-Password-1!"),
                role="passenger",
                is_active=True,
            ),
            User(
                id=2,
                phone="08000000002",
                full_name="Second Passenger",
                password_hash=hash_password("Second-Test-Password-2!"),
                role="passenger",
                is_active=True,
            ),
            User(
                id=3,
                phone="08000000003",
                full_name="Inactive Passenger",
                password_hash=hash_password("Inactive-Test-Password-3!"),
                role="passenger",
                is_active=False,
            ),
            Zone(id=1, name="Central", is_active=True),
            Zone(id=2, name="North", is_active=True),
        ])
        db.flush()
        db.add(Fare(
            origin_zone_id=1,
            destination_zone_id=2,
            vehicle_type="standard",
            base_amount=Decimal("1000.00"),
            vehicle_multiplier=Decimal("1.000"),
            extra_passenger_amount=Decimal("200.00"),
            is_active=True,
        ))
        db.commit()

    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=test_engine)
        test_engine.dispose()
        settings.jwt_secret_key = previous_secret

@pytest.fixture(autouse=True)
def bypass_redis_rate_limiter_in_tests(monkeypatch):
    monkeypatch.setattr(
        main_module,
        "check_login_allowed",
        lambda ip, phone: (True, 0),
    )
    monkeypatch.setattr(
        main_module,
        "record_failed_login",
        lambda ip, phone: (True, 0),
    )


def login_as_passenger(client, phone="08000000001",
                       password="Passenger-Test-Password-1!"):
    response = client.post(
        "/api/v1/auth/login",
        json={"phone": phone, "password": password},
    )
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def ride_payload(**overrides):
    payload = {
        "origin_zone_id": 1,
        "destination_zone_id": 2,
        "origin_text": "Central Market gate",
        "destination_text": "North Estate entrance",
        "vehicle_type": "standard",
        "passenger_count": 2,
    }
    payload.update(overrides)
    return payload


def test_health_endpoint(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_transfer_only_payment_policy(client):
    response = client.get("/api/v1/policy/payments")
    assert response.status_code == 200
    body = response.json()
    assert body["supported_methods"] == ["bank_transfer"]
    assert body["cash_enabled"] is False
    assert body["screenshot_alone_confirms_payment"] is False


def test_database_health_endpoint(client):
    response = client.get("/health/database")
    assert response.status_code in (200, 503)
    if response.status_code == 200:
        assert response.json()["status"] == "ok"
        assert "password" not in response.text.lower()


def test_active_zones_endpoint(client):
    response = client.get("/api/v1/zones")
    assert response.status_code == 200
    assert response.json() == [
        {"id": 1, "name": "Central"},
        {"id": 2, "name": "North"},
    ]


def test_login_returns_bearer_token(client):
    response = client.post(
        "/api/v1/auth/login",
        json={
            "phone": "08000000001",
            "password": "Passenger-Test-Password-1!",
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["access_token"]
    assert body["token_type"] == "bearer"
    assert body["expires_in"] == settings.access_token_expire_minutes * 60


def test_login_rejects_wrong_password(client):
    response = client.post(
        "/api/v1/auth/login",
        json={"phone": "08000000001", "password": "incorrect-password"},
    )
    assert response.status_code == 401


def test_login_rejects_inactive_account(client):
    response = client.post(
        "/api/v1/auth/login",
        json={
            "phone": "08000000003",
            "password": "Inactive-Test-Password-3!",
        },
    )
    assert response.status_code == 401


def test_current_user_comes_from_token(client):
    token = login_as_passenger(client)
    response = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    assert response.json()["id"] == 1
    assert response.json()["role"] == "passenger"


def test_password_change_invalidates_existing_token(client):
    old_token = login_as_passenger(client)
    old_headers = {"Authorization": f"Bearer {old_token}"}

    before_change = client.get("/api/v1/auth/me", headers=old_headers)
    assert before_change.status_code == 200

    new_password = "Passenger-New-Password-4!"

    db_generator = app.dependency_overrides[get_db]()
    db = next(db_generator)
    try:
        user = db.get(User, 1)
        assert user is not None
        user.password_hash = hash_password(new_password)
        db.commit()
    finally:
        db_generator.close()

    old_token_response = client.get(
        "/api/v1/auth/me",
        headers=old_headers,
    )
    assert old_token_response.status_code == 401

    new_token = login_as_passenger(client, password=new_password)
    new_response = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {new_token}"},
    )
    assert new_response.status_code == 200
    assert new_response.json()["id"] == 1

def test_ride_request_requires_authentication(client):
    response = client.post(
        "/api/v1/ride-requests",
        json=ride_payload(),
    )
    assert response.status_code == 401


def test_create_ride_request_uses_server_fare_and_token_identity(client):
    token = login_as_passenger(client)
    response = client.post(
        "/api/v1/ride-requests",
        json=ride_payload(),
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["passenger_user_id"] == 1
    assert body["quoted_fare"] == "1200.00"
    assert body["currency"] == "NGN"
    assert body["status"] == "requested"


def test_ride_request_rejects_client_supplied_passenger_id(client):
    token = login_as_passenger(client)
    response = client.post(
        "/api/v1/ride-requests",
        json=ride_payload(passenger_user_id=2),
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 422


def test_ride_request_rejects_unconfigured_fare(client):
    token = login_as_passenger(client)
    response = client.post(
        "/api/v1/ride-requests",
        json=ride_payload(vehicle_type="motorcycle", passenger_count=1),
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 422
    assert "No active fare" in response.json()["detail"]


def test_ride_request_rejects_invalid_token(client):
    response = client.post(
        "/api/v1/ride-requests",
        json=ride_payload(),
        headers={"Authorization": "Bearer not-a-valid-token"},
    )
    assert response.status_code == 401


def test_login_rate_limit_returns_429(client, monkeypatch):
    monkeypatch.setattr(
        main_module,
        "check_login_allowed",
        lambda ip, phone: (False, 120),
    )

    response = client.post(
        "/api/v1/auth/login",
        json={
            "phone": "08000000001",
            "password": "Wrong-Test-Password!",
        },
    )

    assert response.status_code == 429
    assert response.headers["Retry-After"] == "120"


def test_login_returns_429_if_limit_reached_during_failure_recording(
    client, monkeypatch
):
    monkeypatch.setattr(
        main_module,
        "check_login_allowed",
        lambda ip, phone: (True, 0),
    )
    monkeypatch.setattr(
        main_module,
        "record_failed_login",
        lambda ip, phone: (False, 90),
    )

    response = client.post(
        "/api/v1/auth/login",
        json={
            "phone": "08000000001",
            "password": "Wrong-Test-Password!",
        },
    )

    assert response.status_code == 429
    assert response.headers["Retry-After"] == "90"


def test_login_returns_503_when_redis_is_unavailable(
    client, monkeypatch
):
    def unavailable(ip, phone):
        raise RateLimitUnavailable()

    monkeypatch.setattr(
        main_module, "check_login_allowed", unavailable
    )

    response = client.post(
        "/api/v1/auth/login",
        json={
            "phone": "08000000001",
            "password": "Passenger-Test-Password-1!",
        },
    )

    assert response.status_code == 503


def test_successful_login_does_not_record_failure(
    client, monkeypatch
):
    def unexpected_failure_record(ip, phone):
        raise AssertionError(
            "Successful login must not record a failed attempt"
        )

    monkeypatch.setattr(
        main_module,
        "record_failed_login",
        unexpected_failure_record,
    )

    response = client.post(
        "/api/v1/auth/login",
        json={
            "phone": "08000000001",
            "password": "Passenger-Test-Password-1!",
        },
    )

    assert response.status_code == 200
    assert "access_token" in response.json()


def test_five_failed_logins_block_the_next_attempt(client, monkeypatch):
    failures = {"count": 0}
    limit = settings.login_rate_limit_attempts
    window = settings.login_rate_limit_window_seconds

    def fake_check(ip_address, phone):
        if failures["count"] >= limit:
            return False, window
        return True, 0

    def fake_record(ip_address, phone):
        if failures["count"] >= limit:
            return False, window
        failures["count"] += 1
        return True, 0

    monkeypatch.setattr(main_module, "check_login_allowed", fake_check)
    monkeypatch.setattr(main_module, "record_failed_login", fake_record)

    for attempt in range(limit):
        response = client.post(
            "/api/v1/auth/login",
            json={
                "phone": "08000000001",
                "password": "Definitely-Wrong-Password!",
            },
        )
        assert response.status_code == 401, (
            f"Attempt {attempt + 1} returned {response.status_code}"
        )

    assert failures["count"] == limit

    blocked_response = client.post(
        "/api/v1/auth/login",
        json={
            "phone": "08000000001",
            "password": "Passenger-Test-Password-1!",
        },
    )

    assert blocked_response.status_code == 429
    assert blocked_response.headers["Retry-After"] == str(window)
    assert failures["count"] == limit
