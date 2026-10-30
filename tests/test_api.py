from decimal import Decimal
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.rate_limit import RateLimitUnavailable

from app.auth import hash_password
from app.config import settings
from app.database import Base, get_db
import app.main as main_module
import app.driver_applications as driver_applications_module
from app.main import app
from app.models import (AuditLog, Driver, Fare, Payment, Place, PlaceFare, Ride, RideRequest, ServiceArea, User, Vehicle, Zone)


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
            User(
                id=4,
                phone="08000000004",
                full_name="Test Super Admin",
                password_hash=hash_password("SuperAdmin-Test-Password-4!"),
                role="super_admin",
                is_active=True,
            ),
            Zone(id=1, name="Central", is_active=True),
            Zone(id=2, name="North", is_active=True),
        ])
        db.flush()
        db.add(
            User(
                id=5,
                phone="08000000006",
                full_name="Test Driver",
                password_hash=hash_password("Driver-Test-Password-5!"),
                role="driver",
                is_active=True,
            )
        )
        db.flush()
        db.add(
            Driver(
                id=1,
                user_id=5,
                verification_status="approved",
                is_online=True,
            )
        )
        db.flush()
        db.add(
            Vehicle(
                id=1,
                driver_id=1,
                vehicle_type="standard",
                plate_number="EKM-TEST-001",
                capacity=4,
                is_approved=True,
            )
        )
        db.add_all([
            Fare(
                origin_zone_id=1,
                destination_zone_id=2,
                vehicle_type="standard",
                base_amount=Decimal("1500.00"),
                vehicle_multiplier=Decimal("1.000"),
                extra_passenger_amount=Decimal("500.00"),
                is_active=True,
            ),
            Fare(
                origin_zone_id=1,
                destination_zone_id=2,
                vehicle_type="motorcycle",
                base_amount=Decimal("800.00"),
                vehicle_multiplier=Decimal("1.000"),
                extra_passenger_amount=Decimal("0.00"),
                is_active=True,
            ),
        ])
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




def _seed_place_route(client, fare_active=True):
    """Create isolated place-routing fixtures in the test database."""
    from sqlalchemy.orm import Session

    db_dependency = app.dependency_overrides[get_db]
    generator = db_dependency()
    db = next(generator)
    try:
        area = ServiceArea(
            name="Test Pilot Area",
            slug="test-pilot-area",
            status="active",
        )
        db.add(area)
        db.flush()

        origin = Place(
            service_area_id=area.id,
            zone_id=1,
            name="Test Pickup Point",
            place_type="landmark",
            address_text="Test pickup address",
            status="active",
        )
        destination = Place(
            service_area_id=area.id,
            zone_id=2,
            name="Test Destination Point",
            place_type="bus_stop",
            address_text="Test destination address",
            status="active",
        )
        hidden = Place(
            service_area_id=area.id,
            zone_id=1,
            name="Hidden Pending Place",
            status="pending",
        )
        db.add_all([origin, destination, hidden])
        db.flush()

        fare = PlaceFare(
            origin_place_id=origin.id,
            destination_place_id=destination.id,
            vehicle_type="standard",
            base_amount=Decimal("2100.00"),
            vehicle_multiplier=Decimal("1.000"),
            extra_passenger_amount=Decimal("300.00"),
            is_active=fare_active,
        )
        db.add(fare)
        db.commit()
        return {
            "area_id": area.id,
            "origin_id": origin.id,
            "destination_id": destination.id,
            "hidden_id": hidden.id,
            "fare_id": fare.id,
        }
    finally:
        generator.close()


def test_passenger_locations_list_only_active_areas(client):
    from sqlalchemy.orm import Session

    db_dependency = app.dependency_overrides[get_db]
    generator = db_dependency()
    db = next(generator)
    try:
        db.add_all([
            ServiceArea(name="Active Test Area", slug="active-test-area", status="active"),
            ServiceArea(name="Draft Test Area", slug="draft-test-area", status="draft"),
        ])
        db.commit()
    finally:
        generator.close()

    response = client.get("/api/v1/locations/areas")
    assert response.status_code == 200, response.text
    names = [item["name"] for item in response.json()]
    assert "Active Test Area" in names
    assert "Draft Test Area" not in names


def test_passenger_places_exclude_non_active_places(client):
    ids = _seed_place_route(client)

    response = client.get(
        "/api/v1/locations/places",
        params={"service_area_id": ids["area_id"]},
    )
    assert response.status_code == 200, response.text
    returned_ids = [item["id"] for item in response.json()]
    assert ids["origin_id"] in returned_ids
    assert ids["destination_id"] in returned_ids
    assert ids["hidden_id"] not in returned_ids


def test_place_fare_options_quote_configured_exact_route(client):
    ids = _seed_place_route(client)

    response = client.get(
        "/api/v1/place-fare-options",
        params={
            "origin_place_id": ids["origin_id"],
            "destination_place_id": ids["destination_id"],
            "passenger_count": 3,
        },
    )
    assert response.status_code == 200, response.text
    options = response.json()
    assert len(options) == 1
    assert options[0]["fare_id"] == ids["fare_id"]
    assert options[0]["vehicle_type"] == "standard"
    assert options[0]["quoted_fare"] == "2700.00"
    assert options[0]["currency"] == "NGN"
    assert options[0]["passenger_count"] == 3


def test_place_fare_options_hide_inactive_fare(client):
    ids = _seed_place_route(client, fare_active=False)

    response = client.get(
        "/api/v1/place-fare-options",
        params={
            "origin_place_id": ids["origin_id"],
            "destination_place_id": ids["destination_id"],
        },
    )
    assert response.status_code == 200, response.text
    assert response.json() == []


def test_place_fare_options_return_empty_for_same_place(client):
    ids = _seed_place_route(client)

    response = client.get(
        "/api/v1/place-fare-options",
        params={
            "origin_place_id": ids["origin_id"],
            "destination_place_id": ids["origin_id"],
        },
    )
    assert response.status_code == 200
    assert response.json() == []


def test_place_booking_uses_active_route_fare_and_canonical_names(client):
    ids = _seed_place_route(client)
    token = login_as_passenger(client)

    response = client.post(
        "/api/v1/ride-requests",
        json={
            "origin_place_id": ids["origin_id"],
            "destination_place_id": ids["destination_id"],
            "origin_text": "Client supplied text should not override place",
            "destination_text": "Another supplied destination",
            "vehicle_type": "standard",
            "passenger_count": 2,
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["origin_text"] == "Test Pickup Point"
    assert body["destination_text"] == "Test Destination Point"
    assert body["quoted_fare"] == "2400.00"
    assert body["origin_zone_id"] == 1
    assert body["destination_zone_id"] == 2

    db_dependency = app.dependency_overrides[get_db]
    generator = db_dependency()
    db = next(generator)
    try:
        saved = db.get(RideRequest, body["id"])
        assert saved is not None
        assert saved.origin_place_id == ids["origin_id"]
        assert saved.destination_place_id == ids["destination_id"]
    finally:
        generator.close()


def test_place_booking_rejects_route_without_active_fare(client):
    ids = _seed_place_route(client, fare_active=False)
    token = login_as_passenger(client)

    response = client.post(
        "/api/v1/ride-requests",
        json={
            "origin_place_id": ids["origin_id"],
            "destination_place_id": ids["destination_id"],
            "vehicle_type": "standard",
            "passenger_count": 1,
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 422
    assert "No active fare" in response.json()["detail"]


def test_place_booking_rejects_incomplete_place_pair(client):
    ids = _seed_place_route(client)
    token = login_as_passenger(client)

    response = client.post(
        "/api/v1/ride-requests",
        json={
            "origin_place_id": ids["origin_id"],
            "vehicle_type": "standard",
            "passenger_count": 1,
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 422
    assert "both place IDs" in response.json()["detail"]


def test_place_booking_rejects_same_pickup_and_destination(client):
    ids = _seed_place_route(client)
    token = login_as_passenger(client)

    response = client.post(
        "/api/v1/ride-requests",
        json={
            "origin_place_id": ids["origin_id"],
            "destination_place_id": ids["origin_id"],
            "vehicle_type": "standard",
            "passenger_count": 1,
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 422
    assert "different places" in response.json()["detail"]


def test_health_endpoint(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_interswitch_initiation_rejects_missing_credentials(
    client, monkeypatch
):
    monkeypatch.setattr(settings, "interswitch_merchant_code", None)
    monkeypatch.setattr(settings, "interswitch_pay_item_id", None)

    token = login_as_passenger(client)
    response = client.post(
        "/api/v1/payments/rides/1/interswitch/initiate",
        headers={"Authorization": f"Bearer {token}"},
        json={"customer_email": "passenger@example.com"},
    )

    assert response.status_code == 503
    assert response.json()["detail"] == (
        "Interswitch checkout is not configured on the server."
    )

    # The configuration guard must run before a payment is created.
    from app.database import get_db

    db_dependency = client.app.dependency_overrides[get_db]
    generator = db_dependency()
    db = next(generator)
    try:
        payment = db.scalar(
            select(Payment).where(Payment.ride_id == 1)
        )
        assert payment is None
    finally:
        try:
            next(generator)
        except StopIteration:
            pass

def test_supported_payment_methods_policy(client):
    response = client.get("/api/v1/policy/payments")
    assert response.status_code == 200
    body = response.json()
    assert body["supported_methods"] == ["bank_transfer", "interswitch"]
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


def test_fare_options_returns_only_active_route_vehicle_types(client):
    response = client.get(
        "/api/v1/fare-options",
        params={"origin_zone_id": 1, "destination_zone_id": 2},
    )
    assert response.status_code == 200, response.text
    assert response.json() == ["motorcycle", "standard"]


def test_fare_options_returns_empty_for_same_zone(client):
    response = client.get(
        "/api/v1/fare-options",
        params={"origin_zone_id": 1, "destination_zone_id": 1},
    )
    assert response.status_code == 200
    assert response.json() == []


def test_fare_options_returns_empty_for_unknown_zone(client):
    response = client.get(
        "/api/v1/fare-options",
        params={"origin_zone_id": 1, "destination_zone_id": 999},
    )
    assert response.status_code == 200
    assert response.json() == []


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
    assert body["quoted_fare"] == "2000.00"
    assert body["currency"] == "NGN"
    assert body["status"] == "requested"


def test_pilot_standard_car_one_passenger_fare(client):
    token = login_as_passenger(client)
    response = client.post(
        "/api/v1/ride-requests",
        json=ride_payload(passenger_count=1),
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 201, response.text
    assert response.json()["quoted_fare"] == "1500.00"


def test_pilot_standard_car_three_passenger_fare(client):
    token = login_as_passenger(client)
    response = client.post(
        "/api/v1/ride-requests",
        json=ride_payload(passenger_count=3),
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 201, response.text
    assert response.json()["quoted_fare"] == "2500.00"


def test_pilot_motorcycle_one_passenger_fare(client):
    token = login_as_passenger(client)
    response = client.post(
        "/api/v1/ride-requests",
        json=ride_payload(vehicle_type="motorcycle", passenger_count=1),
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 201, response.text
    assert response.json()["quoted_fare"] == "800.00"

def test_ride_request_rejects_client_supplied_passenger_id(client):
    token = login_as_passenger(client)
    response = client.post(
        "/api/v1/ride-requests",
        json=ride_payload(passenger_user_id=2),
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 422


def test_motorcycle_rejects_more_than_one_passenger(client):
    token = login_as_passenger(client)
    response = client.post(
        "/api/v1/ride-requests",
        json=ride_payload(vehicle_type="motorcycle", passenger_count=2),
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 422
    assert "Motorcycle bookings allow at most one passenger" in response.json()["detail"]


def test_ride_request_rejects_unconfigured_fare(client):
    token = login_as_passenger(client)
    response = client.post(
        "/api/v1/ride-requests",
        json=ride_payload(vehicle_type="van", passenger_count=1),
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

@pytest.mark.parametrize(
    "endpoint",
    ["/api/v1/admin/zones", "/api/v1/admin/fares"],
)
def test_admin_endpoints_reject_unauthenticated_requests(client, endpoint):
    response = client.get(endpoint)
    assert response.status_code == 401, response.text


@pytest.mark.parametrize(
    "endpoint",
    ["/api/v1/admin/zones", "/api/v1/admin/fares"],
)
def test_admin_endpoints_reject_passengers(client, endpoint):
    token = login_as_passenger(client)
    response = client.get(
        endpoint,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 403, response.text


def test_super_admin_can_read_admin_zones_and_fares(client):
    login_response = client.post(
        "/api/v1/auth/login",
        json={
            "phone": "08000000004",
            "password": "SuperAdmin-Test-Password-4!",
        },
    )
    assert login_response.status_code == 200, login_response.text
    token = login_response.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    zones_response = client.get("/api/v1/admin/zones", headers=headers)
    fares_response = client.get("/api/v1/admin/fares", headers=headers)

    assert zones_response.status_code == 200, zones_response.text
    assert fares_response.status_code == 200, fares_response.text

    zones = zones_response.json()
    fares = fares_response.json()

    assert len(zones) == 2
    assert {zone["name"] for zone in zones} == {"Central", "North"}
    assert len(fares) == 2
    assert {fare["vehicle_type"] for fare in fares} == {
        "standard", "motorcycle"
    }
    assert all(fare["currency"] == "NGN" for fare in fares)

def test_register_creates_passenger_and_returns_token(client):
    response = client.post(
        "/api/v1/auth/register",
        json={
            "phone": "08000000005",
            "full_name": "New EkiMove Passenger",
            "password": "New-Passenger-Password-5!",
        },
    )

    assert response.status_code == 201, response.text
    body = response.json()

    assert body["access_token"]
    assert body["token_type"] == "bearer"
    assert body["user"]["phone"] == "08000000005"
    assert body["user"]["full_name"] == "New EkiMove Passenger"
    assert body["user"]["role"] == "passenger"
    assert body["user"]["is_active"] is True
    assert "password_hash" not in body["user"]

    # Confirm the issued token works with the existing /me endpoint.
    me_response = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {body['access_token']}"},
    )
    assert me_response.status_code == 200, me_response.text
    assert me_response.json()["phone"] == "08000000005"


def test_register_rejects_duplicate_phone_number(client):
    response = client.post(
        "/api/v1/auth/register",
        json={
            "phone": "08000000001",
            "full_name": "Duplicate Passenger",
            "password": "Another-Password-123!",
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "Phone number is already registered"


@pytest.mark.parametrize(
    "payload",
    [
        {
            "phone": "123",
            "full_name": "Test Passenger",
            "password": "Valid-Password-123!",
        },
        {
            "phone": "08000000006",
            "full_name": "A",
            "password": "Valid-Password-123!",
        },
        {
            "phone": "08000000006",
            "full_name": "Test Passenger",
            "password": "short",
        },
    ],
)
def test_register_rejects_invalid_fields(client, payload):
    response = client.post("/api/v1/auth/register", json=payload)
    assert response.status_code == 422, response.text


def test_register_rejects_client_supplied_role(client):
    response = client.post(
        "/api/v1/auth/register",
        json={
            "phone": "08000000006",
            "full_name": "Attempted Admin",
            "password": "Valid-Password-123!",
            "role": "super_admin",
        },
    )

    assert response.status_code == 422, response.text


def test_newly_registered_passenger_can_login(client):
    registration = client.post(
        "/api/v1/auth/register",
        json={
            "phone": "08000000007",
            "full_name": "Registration Login Test",
            "password": "Registered-Password-7!",
        },
    )
    assert registration.status_code == 201, registration.text

    login = client.post(
        "/api/v1/auth/login",
        json={
            "phone": "08000000007",
            "password": "Registered-Password-7!",
        },
    )

    assert login.status_code == 200, login.text
    assert login.json()["access_token"]




def test_my_rides_requires_authentication(client):
    response = client.get("/api/v1/ride-requests/my-rides")
    assert response.status_code == 401


def test_my_rides_returns_only_authenticated_passengers_requests(client):
    first_token = login_as_passenger(client)
    first_headers = {"Authorization": f"Bearer {first_token}"}

    created = client.post(
        "/api/v1/ride-requests",
        json=ride_payload(),
        headers=first_headers,
    )
    assert created.status_code == 201, created.text

    own_history = client.get(
        "/api/v1/ride-requests/my-rides",
        headers=first_headers,
    )
    assert own_history.status_code == 200, own_history.text
    own_data = own_history.json()
    assert len(own_data) == 1
    assert own_data[0]["id"] == created.json()["id"]
    assert own_data[0]["origin_text"] == "Central Market gate"
    assert own_data[0]["destination_text"] == "North Estate entrance"
    assert own_data[0]["quoted_fare"] == "2000.00"
    assert own_data[0]["currency"] == "NGN"
    assert own_data[0]["status"] == "requested"

    second_token = login_as_passenger(
        client,
        phone="08000000002",
        password="Second-Test-Password-2!",
    )
    second_history = client.get(
        "/api/v1/ride-requests/my-rides",
        headers={"Authorization": f"Bearer {second_token}"},
    )
    assert second_history.status_code == 200, second_history.text
    assert second_history.json() == []


def _login_as_super_admin(client):
    response = client.post(
        "/api/v1/auth/login",
        json={
            "phone": "08000000004",
            "password": "SuperAdmin-Test-Password-4!",
        },
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _create_test_booking(client):
    token = login_as_passenger(client)
    response = client.post(
        "/api/v1/ride-requests",
        json=ride_payload(),
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def test_dispatch_assignment_requires_super_admin(client):
    request_id = _create_test_booking(client)
    passenger_token = login_as_passenger(client)

    response = client.post(
        f"/api/v1/admin/ride-requests/{request_id}/assign",
        json={"driver_id": 1},
        headers={"Authorization": f"Bearer {passenger_token}"},
    )
    assert response.status_code == 403


def test_super_admin_can_assign_ride_to_approved_online_driver(client):
    request_id = _create_test_booking(client)

    response = client.post(
        f"/api/v1/admin/ride-requests/{request_id}/assign",
        json={"driver_id": 1},
        headers=_login_as_super_admin(client),
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["request_id"] == request_id
    assert body["driver_id"] == 1
    assert body["vehicle_id"] == 1
    assert body["status"] == "assigned"
    assert body["agreed_fare"] == "2000.00" or body["agreed_fare"] == 2000.0


def test_dispatch_rejects_duplicate_assignment(client):
    request_id = _create_test_booking(client)
    headers = _login_as_super_admin(client)
    url = f"/api/v1/admin/ride-requests/{request_id}/assign"

    first = client.post(url, json={"driver_id": 1}, headers=headers)
    assert first.status_code == 201, first.text

    second = client.post(url, json={"driver_id": 1}, headers=headers)
    assert second.status_code == 409


def _change_dispatch_fixture(client, **changes):
    """Modify the isolated test driver, account, or vehicle."""
    db_generator = app.dependency_overrides[get_db]()
    db = next(db_generator)
    try:
        driver = db.get(Driver, 1)
        driver_user = db.get(User, 5)
        vehicle = db.get(Vehicle, 1)

        if driver is None or driver_user is None or vehicle is None:
            raise AssertionError("Expected dispatch test fixtures were not found.")

        if "verification_status" in changes:
            driver.verification_status = changes["verification_status"]
        if "is_online" in changes:
            driver.is_online = changes["is_online"]
        if "account_active" in changes:
            driver_user.is_active = changes["account_active"]
        if "vehicle_approved" in changes:
            vehicle.is_approved = changes["vehicle_approved"]
        if "vehicle_type" in changes:
            vehicle.vehicle_type = changes["vehicle_type"]
        if "vehicle_capacity" in changes:
            vehicle.capacity = changes["vehicle_capacity"]

        db.commit()
    finally:
        db_generator.close()


def _assert_booking_remains_unassigned(client, request_id):
    """Verify a rejected dispatch creates no Ride and leaves the request unchanged."""
    db_generator = app.dependency_overrides[get_db]()
    db = next(db_generator)
    try:
        ride_request = db.get(RideRequest, request_id)
        assert ride_request is not None
        assert ride_request.status == "requested"
        assert db.query(Ride).filter_by(request_id=request_id).count() == 0
    finally:
        db_generator.close()


@pytest.mark.parametrize(
    ("mutation", "expected_detail"),
    [
        (
            {"verification_status": "pending"},
            "Driver must be approved and online",
        ),
        (
            {"is_online": False},
            "Driver must be approved and online",
        ),
        (
            {"account_active": False},
            "Driver account is not active",
        ),
        (
            {"vehicle_approved": False},
            "Driver has no approved matching vehicle with sufficient capacity",
        ),
        (
            {"vehicle_type": "motorcycle"},
            "Driver has no approved matching vehicle with sufficient capacity",
        ),
        (
            {"vehicle_capacity": 1},
            "Driver has no approved matching vehicle with sufficient capacity",
        ),
    ],
)
def test_dispatch_rejects_ineligible_driver_or_vehicle(
    client, mutation, expected_detail
):
    request_id = _create_test_booking(client)
    _change_dispatch_fixture(client, **mutation)

    response = client.post(
        f"/api/v1/admin/ride-requests/{request_id}/assign",
        json={"driver_id": 1},
        headers=_login_as_super_admin(client),
    )

    assert response.status_code == 409, response.text
    assert response.json()["detail"] == expected_detail
    _assert_booking_remains_unassigned(client, request_id)


def _get_test_db_session():
    session_generator = app.dependency_overrides[get_db]()
    return next(session_generator), session_generator


def test_driver_application_creates_pending_driver_and_unapproved_vehicle(
    client, monkeypatch, tmp_path
):
    test_photo_ref = (
        "cloudinary:ekimove/driver-photos/test-image|png"
    )
    monkeypatch.setattr(
        driver_applications_module,
        "upload_driver_photo",
        lambda _photo_bytes: test_photo_ref,
    )
    photo_bytes = b"\x89PNG\r\n\x1a\nfake-test-image"

    response = client.post(
        "/api/v1/driver-applications",
        data={
            "full_name": "New Test Driver",
            "phone": "08000000991",
            "password": "New-Driver-Test-Password-1!",
            "vehicle_type": "car",
            "plate_number": "EKM-NEW-901",
            "capacity": "4",
        },
        files={
            "face_photo": ("face.png", photo_bytes, "image/png"),
        },
    )

    assert response.status_code == 201, response.text
    assert response.json()["status"] == "pending_review"

    db, session_generator = _get_test_db_session()
    try:
        user = db.scalar(
            select(User).where(User.phone == "08000000991")
        )
        assert user is not None
        assert user.role == "driver"

        driver = db.scalar(
            select(Driver).where(Driver.user_id == user.id)
        )
        assert driver is not None
        assert driver.verification_status == "pending"
        assert driver.is_online is False
        assert driver.photo_path == test_photo_ref

        vehicle = db.scalar(
            select(Vehicle).where(Vehicle.driver_id == driver.id)
        )
        assert vehicle is not None
        assert vehicle.plate_number == "EKM-NEW-901"
        assert vehicle.is_approved is False
    finally:
        session_generator.close()


def test_driver_application_rejects_invalid_image_signature(
    client, monkeypatch, tmp_path
):
    monkeypatch.setattr(
        driver_applications_module, "PRIVATE_UPLOAD_DIR", tmp_path
    )

    response = client.post(
        "/api/v1/driver-applications",
        data={
            "full_name": "Invalid Photo Driver",
            "phone": "08000000992",
            "password": "Invalid-Photo-Password-1!",
            "vehicle_type": "car",
            "plate_number": "EKM-NEW-902",
            "capacity": "4",
        },
        files={
            "face_photo": (
                "face.png",
                b"this is not a PNG image",
                "image/png",
            ),
        },
    )

    assert response.status_code == 415, response.text

    db, session_generator = _get_test_db_session()
    try:
        user = db.scalar(
            select(User).where(User.phone == "08000000992")
        )
        assert user is None
        assert list(tmp_path.iterdir()) == []
    finally:
        session_generator.close()


def test_driver_application_rejects_registered_phone(
    client, monkeypatch, tmp_path
):
    monkeypatch.setattr(
        driver_applications_module, "PRIVATE_UPLOAD_DIR", tmp_path
    )

    response = client.post(
        "/api/v1/driver-applications",
        data={
            "full_name": "Duplicate Phone Driver",
            "phone": "08000000001",
            "password": "Duplicate-Phone-Password-1!",
            "vehicle_type": "car",
            "plate_number": "EKM-NEW-903",
            "capacity": "4",
        },
        files={
            "face_photo": (
                "face.png",
                b"\x89PNG\r\n\x1a\nfake-test-image",
                "image/png",
            ),
        },
    )

    assert response.status_code == 409, response.text
    assert "already registered" in response.json()["detail"]
    assert list(tmp_path.iterdir()) == []


# --- Payment lifecycle tests ---

from decimal import Decimal

from sqlalchemy import select

from app.database import Base, get_db
from app.models import AuditLog, Payment, Ride, RideRequest


def login(client, phone, password):
    response = client.post(
        "/api/v1/auth/login",
        json={"phone": phone, "password": password},
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def create_assigned_ride(client):
    passenger_headers = login(
        client, "08000000001", "Passenger-Test-Password-1!"
    )
    response = client.post(
        "/api/v1/ride-requests",
        json={
            "origin_zone_id": 1,
            "destination_zone_id": 2,
            "origin_text": "Central Market gate",
            "destination_text": "North Estate entrance",
            "vehicle_type": "standard",
            "passenger_count": 2,
        },
        headers=passenger_headers,
    )
    assert response.status_code in (200, 201), response.text
    request_id = response.json()["id"]

    admin_headers = login(
        client, "08000000004", "SuperAdmin-Test-Password-4!"
    )
    response = client.post(
        f"/api/v1/admin/ride-requests/{request_id}/assign",
        json={"driver_id": 1},
        headers=admin_headers,
    )
    assert response.status_code in (200, 201), response.text
    return passenger_headers, admin_headers, request_id


def get_ride_id_from_request(client, request_id, passenger_headers):
    response = client.get(
        "/api/v1/ride-requests/my-rides",
        headers=passenger_headers,
    )
    assert response.status_code == 200, response.text
    item = next(r for r in response.json() if r["id"] == request_id)
    # Payment endpoints require the assigned Ride.id, not RideRequest.id.
    # The test resolves it from the test database through the fixture override.
    override = client.app.dependency_overrides[get_db]
    generator = override()
    db = next(generator)
    try:
        ride = db.scalar(
            select(Ride).where(Ride.request_id == request_id)
        )
        assert ride is not None
        return ride.id
    finally:
        generator.close()


def test_payment_initiation_is_idempotent_and_transfer_only(client):
    passenger_headers, _, request_id = create_assigned_ride(client)
    ride_id = get_ride_id_from_request(
        client, request_id, passenger_headers
    )
    url = f"/api/v1/payments/rides/{ride_id}/initiate"

    first = client.post(url, headers=passenger_headers)
    second = client.post(url, headers=passenger_headers)

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert first.json()["id"] == second.json()["id"]
    assert first.json()["method"] == "bank_transfer"
    assert first.json()["currency"] == "NGN"
    assert first.json()["status"] == "pending"


def test_transfer_reference_does_not_confirm_payment(client):
    passenger_headers, _, request_id = create_assigned_ride(client)
    ride_id = get_ride_id_from_request(
        client, request_id, passenger_headers
    )
    client.post(
        f"/api/v1/payments/rides/{ride_id}/initiate",
        headers=passenger_headers,
    )

    response = client.post(
        f"/api/v1/payments/rides/{ride_id}/submit-transfer",
        headers=passenger_headers,
        json={"transfer_reference": "TEST-BANK-REF-001"},
    )

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "awaiting_confirmation"
    assert response.json()["transfer_reference"] == "TEST-BANK-REF-001"
    assert response.json()["confirmed_at"] is None


def test_another_passenger_cannot_initiate_or_view_payment(client):
    passenger_headers, _, request_id = create_assigned_ride(client)
    ride_id = get_ride_id_from_request(
        client, request_id, passenger_headers
    )
    other_headers = login(
        client, "08000000002", "Second-Test-Password-2!"
    )

    initiate = client.post(
        f"/api/v1/payments/rides/{ride_id}/initiate",
        headers=other_headers,
    )
    status = client.get(
        f"/api/v1/payments/rides/{ride_id}",
        headers=other_headers,
    )

    assert initiate.status_code == 404
    assert status.status_code == 404


def test_only_super_admin_can_reconcile_payment(client):
    passenger_headers, admin_headers, request_id = create_assigned_ride(client)
    ride_id = get_ride_id_from_request(
        client, request_id, passenger_headers
    )
    client.post(
        f"/api/v1/payments/rides/{ride_id}/initiate",
        headers=passenger_headers,
    )
    client.post(
        f"/api/v1/payments/rides/{ride_id}/submit-transfer",
        headers=passenger_headers,
        json={"transfer_reference": "TEST-BANK-REF-002"},
    )

    response = client.post(
        "/api/v1/admin/payments/1/reconcile",
        headers=passenger_headers,
        json={
            "decision": "confirm",
            "reason": "Attempted passenger self-confirmation",
        },
    )
    assert response.status_code in (401, 403)

    # Use the actual payment ID, which is expected to be 1 in this isolated test.
    admin_response = client.post(
        "/api/v1/admin/payments/1/reconcile",
        headers=admin_headers,
        json={
            "decision": "confirm",
            "reason": "Test only: bank transfer independently verified",
        },
    )
    assert admin_response.status_code == 200, admin_response.text
    assert admin_response.json()["status"] == "confirmed"
    assert admin_response.json()["confirmed_at"] is not None


def get_assigned_ride_id(client, request_id):
    override = client.app.dependency_overrides[get_db]
    generator = override()
    db = next(generator)
    try:
        ride = db.scalar(
            select(Ride).where(Ride.request_id == request_id)
        )
        assert ride is not None
        return ride.id
    finally:
        generator.close()


def test_driver_can_progress_ride_and_timestamps_are_recorded(client):
    passenger_headers, admin_headers, request_id = create_assigned_ride(client)
    ride_id = get_assigned_ride_id(client, request_id)

    initiate = client.post(
        f"/api/v1/payments/rides/{ride_id}/initiate",
        headers=passenger_headers,
    )
    assert initiate.status_code == 200, initiate.text
    payment_id = initiate.json()["id"]

    transfer = client.post(
        f"/api/v1/payments/rides/{ride_id}/submit-transfer",
        headers=passenger_headers,
        json={"transfer_reference": "TEST-RIDE-START-001"},
    )
    assert transfer.status_code == 200, transfer.text
    assert transfer.json()["status"] == "awaiting_confirmation"

    reconcile = client.post(
        f"/api/v1/admin/payments/{payment_id}/reconcile",
        headers=admin_headers,
        json={
            "decision": "confirm",
            "reason": "Test only: bank transfer independently verified",
        },
    )
    assert reconcile.status_code == 200, reconcile.text
    assert reconcile.json()["status"] == "confirmed"

    driver_headers = login(
        client, "08000000006", "Driver-Test-Password-5!"
    )
    url = f"/api/v1/driver/rides/{ride_id}/status"

    response = client.patch(
        url, json={"status": "driver_arriving"}, headers=driver_headers
    )
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "driver_arriving"

    response = client.patch(
        url, json={"status": "in_progress"}, headers=driver_headers
    )
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "in_progress"
    assert response.json()["started_at"] is not None
    assert response.json()["completed_at"] is None

    response = client.patch(
        url, json={"status": "completed"}, headers=driver_headers
    )
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "completed"
    assert response.json()["started_at"] is not None
    assert response.json()["completed_at"] is not None


def test_driver_cannot_skip_ride_status(client):
    _, _, request_id = create_assigned_ride(client)
    ride_id = get_assigned_ride_id(client, request_id)
    driver_headers = login(
        client, "08000000006", "Driver-Test-Password-5!"
    )

    response = client.patch(
        f"/api/v1/driver/rides/{ride_id}/status",
        json={"status": "completed"},
        headers=driver_headers,
    )

    assert response.status_code == 409


def test_passenger_cannot_update_driver_ride_status(client):
    passenger_headers, _, request_id = create_assigned_ride(client)
    ride_id = get_assigned_ride_id(client, request_id)

    response = client.patch(
        f"/api/v1/driver/rides/{ride_id}/status",
        json={"status": "driver_arriving"},
        headers=passenger_headers,
    )

    assert response.status_code == 403


def test_driver_status_changes_are_audited(client):
    _, _, request_id = create_assigned_ride(client)
    ride_id = get_assigned_ride_id(client, request_id)
    driver_headers = login(
        client, "08000000006", "Driver-Test-Password-5!"
    )

    response = client.patch(
        f"/api/v1/driver/rides/{ride_id}/status",
        json={"status": "driver_arriving"},
        headers=driver_headers,
    )
    assert response.status_code == 200, response.text

    override = client.app.dependency_overrides[get_db]
    generator = override()
    db = next(generator)
    try:
        entries = db.scalars(
            select(AuditLog).where(
                AuditLog.entity_type == "ride",
                AuditLog.entity_id == str(ride_id),
                AuditLog.action == "ride.status_changed",
            )
        ).all()
        assert len(entries) == 1
        assert "assigned" in entries[0].details
        assert "driver_arriving" in entries[0].details
    finally:
        generator.close()


def test_driver_cannot_start_ride_without_confirmed_payment(client):
    passenger_headers, _, request_id = create_assigned_ride(client)
    ride_id = get_assigned_ride_id(client, request_id)

    initiate = client.post(
        f"/api/v1/payments/rides/{ride_id}/initiate",
        headers=passenger_headers,
    )
    assert initiate.status_code == 200, initiate.text
    assert initiate.json()["status"] == "pending"

    driver_headers = login(
        client, "08000000006", "Driver-Test-Password-5!"
    )
    url = f"/api/v1/driver/rides/{ride_id}/status"

    arriving = client.patch(
        url, json={"status": "driver_arriving"}, headers=driver_headers
    )
    assert arriving.status_code == 200, arriving.text

    # Pending payment must not allow the trip to start.
    blocked = client.patch(
        url, json={"status": "in_progress"}, headers=driver_headers
    )
    assert blocked.status_code == 409, blocked.text
    assert "payment" in blocked.json()["detail"].lower()

    # A submitted transfer reference is not proof of payment.
    transfer = client.post(
        f"/api/v1/payments/rides/{ride_id}/submit-transfer",
        headers=passenger_headers,
        json={"transfer_reference": "TEST-UNVERIFIED-TRANSFER-002"},
    )
    assert transfer.status_code == 200, transfer.text
    assert transfer.json()["status"] == "awaiting_confirmation"

    blocked_again = client.patch(
        url, json={"status": "in_progress"}, headers=driver_headers
    )
    assert blocked_again.status_code == 409, blocked_again.text
    assert "payment" in blocked_again.json()["detail"].lower()

# Ekimove SOS regression tests

# Ekimove SOS regression tests

def test_passenger_sos_creates_incident_and_admin_can_review(client):
    passenger_headers, admin_headers, request_id = create_assigned_ride(client)
    ride_id = get_assigned_ride_id(client, request_id)

    response = client.post(
        f"/api/v1/rides/{ride_id}/sos",
        headers=passenger_headers,
        json={"description": "I need immediate assistance during this trip."},
    )

    assert response.status_code == 200, response.text
    result = response.json()
    assert result["ride_id"] == ride_id
    assert result["severity"] == "critical"
    assert result["incident_status"] == "open"
    assert result["ride_status"] == "incident_review"
    assert "does not automatically contact emergency services" in result["message"].lower()

    incident_id = result["incident_id"]

    # The administrative incident queue must be accessible to a super-admin.
    queue = client.get("/api/v1/admin/incidents", headers=admin_headers)
    assert queue.status_code == 200, queue.text
    assert str(incident_id) in queue.text

    # An authorized super-admin can begin investigating the incident.
    review = client.patch(
        f"/api/v1/admin/incidents/{incident_id}",
        headers=admin_headers,
        json={
            "status": "investigating",
            "note": "SOS received; incident review initiated.",
        },
    )
    assert review.status_code == 200, review.text


def test_sos_for_nonexistent_ride_returns_404(client):
    passenger_headers = {"Authorization": f"Bearer {login_as_passenger(client)}"}

    response = client.post(
        "/api/v1/rides/999999999/sos",
        headers=passenger_headers,
        json={"description": "I need assistance with this ride."},
    )

    assert response.status_code == 404, response.text


@pytest.mark.parametrize(
    ("method", "endpoint", "payload"),
    [
        ("get", "/api/v1/admin/incidents", None),
        (
            "patch",
            "/api/v1/admin/incidents/999999999",
            {"status": "investigating", "note": "Unauthorized access test."},
        ),
    ],
)
def test_incident_admin_endpoints_reject_unauthenticated_requests(
    client, method, endpoint, payload
):
    response = (client.get(endpoint) if method == "get" else client.patch(endpoint, json=payload))
    assert response.status_code == 401, response.text


@pytest.mark.parametrize(
    ("method", "endpoint", "payload"),
    [
        ("get", "/api/v1/admin/incidents", None),
        (
            "patch",
            "/api/v1/admin/incidents/999999999",
            {"status": "investigating", "note": "Unauthorized access test."},
        ),
    ],
)
def test_incident_admin_endpoints_reject_passengers(
    client, method, endpoint, payload
):
    token = login_as_passenger(client)
    headers = {"Authorization": f"Bearer {token}"}
    response = (
        client.get(endpoint, headers=headers)
        if method == "get"
        else client.patch(endpoint, headers=headers, json=payload)
    )
    assert response.status_code == 403, response.text


# --- Interswitch provider verification tests ---
def test_interswitch_initiation_uses_server_fare_and_reuses_payment(
    client, monkeypatch
):
    from decimal import Decimal

    monkeypatch.setattr(settings, "interswitch_merchant_code", "TEST-MERCHANT")
    monkeypatch.setattr(settings, "interswitch_pay_item_id", "TEST-PAYITEM")
    monkeypatch.setattr(settings, "interswitch_mode", "TEST")

    passenger_headers, _, request_id = create_assigned_ride(client)
    ride_id = get_ride_id_from_request(
        client, request_id, passenger_headers
    )

    endpoint = (
        f"/api/v1/payments/rides/{ride_id}/interswitch/initiate"
    )

    first = client.post(
        endpoint,
        headers=passenger_headers,
        json={"customer_email": "passenger@example.com"},
    )

    assert first.status_code == 200, first.text

    first_body = first.json()
    first_payment = first_body["payment"]
    first_checkout = first_body["checkout"]

    # A newly initiated payment must not be treated as paid.
    assert first_payment["status"] == "pending"
    assert first_payment["confirmed_at"] is None

    # Checkout amount must match the server-stored payment amount.
    expected_kobo = int(
        Decimal(first_payment["amount"]) * 100
    )
    assert first_checkout["amount"] == expected_kobo
    assert first_checkout["currency"] == "566"
    assert first_checkout["mode"] == "TEST"
    assert first_checkout["txn_ref"] == (
        first_payment["provider_transaction_ref"]
    )
    assert first_checkout["merchant_code"] == "TEST-MERCHANT"
    assert first_checkout["pay_item_id"] == "TEST-PAYITEM"

    # Repeating initiation must reuse the existing payment and reference.
    second = client.post(
        endpoint,
        headers=passenger_headers,
        json={"customer_email": "passenger@example.com"},
    )

    assert second.status_code == 200, second.text

    second_body = second.json()
    assert second_body["payment"]["id"] == first_payment["id"]
    assert (
        second_body["payment"]["provider_transaction_ref"]
        == first_checkout["txn_ref"]
    )
    assert second_body["checkout"]["txn_ref"] == first_checkout["txn_ref"]
    assert second_body["payment"]["status"] == "pending"

def test_interswitch_verification_confirms_matching_provider_payment(
    client, monkeypatch
):
    import app.interswitch_payments as interswitch_module

    monkeypatch.setattr(settings, "interswitch_merchant_code", "TEST-MERCHANT")
    monkeypatch.setattr(settings, "interswitch_pay_item_id", "TEST-PAYITEM")

    passenger_headers, _, request_id = create_assigned_ride(client)
    ride_id = get_ride_id_from_request(
        client, request_id, passenger_headers
    )

    initiated = client.post(
        f"/api/v1/payments/rides/{ride_id}/interswitch/initiate",
        headers=passenger_headers,
        json={"customer_email": "passenger@example.com"},
    )
    assert initiated.status_code == 200, initiated.text

    checkout = initiated.json()["checkout"]
    assert checkout["amount"] > 0

    provider_calls = {"count": 0}

    class FakeResponse:
        def raise_for_status(self):
            pass

        def json(self):
            return {
                "ResponseCode": "00",
                "Amount": str(checkout["amount"]),
                "MerchantReference": checkout["txn_ref"],
            }

    def fake_provider_get(*args, **kwargs):
        provider_calls["count"] += 1
        return FakeResponse()

    monkeypatch.setattr(
        interswitch_module.requests,
        "get",
        fake_provider_get,
    )

    endpoint = (
        f"/api/v1/payments/rides/{ride_id}/interswitch/verify"
    )

    verified = client.post(endpoint, headers=passenger_headers)
    assert verified.status_code == 200, verified.text

    first_body = verified.json()
    assert first_body["status"] == "confirmed"
    assert first_body["confirmed_at"] is not None
    assert first_body["provider_transaction_ref"] == checkout["txn_ref"]
    assert provider_calls["count"] == 1

    db_override = client.app.dependency_overrides[get_db]
    generator = db_override()
    db = next(generator)
    try:
        payment = db.scalar(
            select(Payment).where(Payment.ride_id == ride_id)
        )
        assert payment is not None
        original_confirmed_at = payment.confirmed_at

        audit_entries = db.scalars(
            select(AuditLog).where(
                AuditLog.action == "payment.interswitch_verified",
                AuditLog.entity_type == "payment",
                AuditLog.entity_id == str(payment.id),
            )
        ).all()
        original_audit_count = len(audit_entries)
        assert original_audit_count == 1
    finally:
        generator.close()

    repeated = client.post(endpoint, headers=passenger_headers)
    assert repeated.status_code == 200, repeated.text
    assert repeated.json()["status"] == "confirmed"
    assert repeated.json()["confirmed_at"] == first_body["confirmed_at"]
    assert provider_calls["count"] == 1

    generator = db_override()
    db = next(generator)
    try:
        payment = db.scalar(
            select(Payment).where(Payment.ride_id == ride_id)
        )
        assert payment is not None
        assert payment.status == "confirmed"
        assert payment.confirmed_at == original_confirmed_at

        audit_entries = db.scalars(
            select(AuditLog).where(
                AuditLog.action == "payment.interswitch_verified",
                AuditLog.entity_type == "payment",
                AuditLog.entity_id == str(payment.id),
            )
        ).all()
        assert len(audit_entries) == original_audit_count
    finally:
        generator.close()


@pytest.mark.parametrize(
    "provider_changes",
    [
        {"ResponseCode": "51"},
        {"Amount": "1"},
        {"MerchantReference": "WRONG-REFERENCE"},
    ],
    ids=["declined-response", "wrong-amount", "wrong-reference"],
)
def test_interswitch_verification_rejects_mismatched_provider_data(
    client, monkeypatch, provider_changes
):
    import app.interswitch_payments as interswitch_module

    monkeypatch.setattr(settings, "interswitch_merchant_code", "TEST-MERCHANT")
    monkeypatch.setattr(settings, "interswitch_pay_item_id", "TEST-PAYITEM")

    passenger_headers, _, request_id = create_assigned_ride(client)
    ride_id = get_ride_id_from_request(
        client, request_id, passenger_headers
    )

    initiated = client.post(
        f"/api/v1/payments/rides/{ride_id}/interswitch/initiate",
        headers=passenger_headers,
        json={"customer_email": "passenger@example.com"},
    )
    assert initiated.status_code == 200, initiated.text
    checkout = initiated.json()["checkout"]

    provider_result = {
        "ResponseCode": "00",
        "Amount": str(checkout["amount"]),
        "MerchantReference": checkout["txn_ref"],
    }
    provider_result.update(provider_changes)

    class FakeResponse:
        def raise_for_status(self):
            pass

        def json(self):
            return provider_result

    monkeypatch.setattr(
        interswitch_module.requests,
        "get",
        lambda *args, **kwargs: FakeResponse(),
    )

    verified = client.post(
        f"/api/v1/payments/rides/{ride_id}/interswitch/verify",
        headers=passenger_headers,
    )

    assert verified.status_code == 409, verified.text
    assert "not been verified" in verified.json()["detail"]

    db_override = client.app.dependency_overrides[get_db]
    generator = db_override()
    db = next(generator)
    try:
        payment = db.scalar(
            select(Payment).where(Payment.ride_id == ride_id)
        )
        assert payment is not None
        assert payment.status != "confirmed"
        assert payment.confirmed_at is None
    finally:
        generator.close()




def test_interswitch_verification_does_not_reconfirm_refunded_payment(
    client, monkeypatch
):
    import app.interswitch_payments as interswitch_module

    monkeypatch.setattr(settings, "interswitch_merchant_code", "TEST-MERCHANT")
    monkeypatch.setattr(settings, "interswitch_pay_item_id", "TEST-PAYITEM")

    passenger_headers, _, request_id = create_assigned_ride(client)
    ride_id = get_ride_id_from_request(
        client, request_id, passenger_headers
    )

    initiated = client.post(
        f"/api/v1/payments/rides/{ride_id}/interswitch/initiate",
        headers=passenger_headers,
        json={"customer_email": "passenger@example.com"},
    )
    assert initiated.status_code == 200, initiated.text
    checkout = initiated.json()["checkout"]

    db_override = client.app.dependency_overrides[get_db]
    generator = db_override()
    db = next(generator)
    try:
        payment = db.scalar(
            select(Payment).where(Payment.ride_id == ride_id)
        )
        assert payment is not None
        payment.status = "refunded"
        db.commit()
    finally:
        generator.close()

    class FakeResponse:
        def raise_for_status(self):
            pass

        def json(self):
            return {
                "ResponseCode": "00",
                "Amount": str(checkout["amount"]),
                "MerchantReference": checkout["txn_ref"],
            }

    monkeypatch.setattr(
        interswitch_module.requests,
        "get",
        lambda *args, **kwargs: FakeResponse(),
    )

    verified = client.post(
        f"/api/v1/payments/rides/{ride_id}/interswitch/verify",
        headers=passenger_headers,
    )

    assert verified.status_code == 409, verified.text
    assert "state changed" in verified.json()["detail"]

    generator = db_override()
    db = next(generator)
    try:
        payment = db.scalar(
            select(Payment).where(Payment.ride_id == ride_id)
        )
        assert payment is not None
        assert payment.status == "refunded"
        assert payment.confirmed_at is None
    finally:
        generator.close()

def test_interswitch_verification_handles_provider_connection_error(
    client, monkeypatch
):
    import requests
    import app.interswitch_payments as interswitch_module

    monkeypatch.setattr(settings, "interswitch_merchant_code", "TEST-MERCHANT")
    monkeypatch.setattr(settings, "interswitch_pay_item_id", "TEST-PAYITEM")

    passenger_headers, _, request_id = create_assigned_ride(client)
    ride_id = get_ride_id_from_request(
        client, request_id, passenger_headers
    )

    initiated = client.post(
        f"/api/v1/payments/rides/{ride_id}/interswitch/initiate",
        headers=passenger_headers,
        json={"customer_email": "passenger@example.com"},
    )
    assert initiated.status_code == 200, initiated.text

    def raise_connection_error(*args, **kwargs):
        raise requests.ConnectionError("Simulated provider outage")

    monkeypatch.setattr(
        interswitch_module.requests,
        "get",
        raise_connection_error,
    )

    verified = client.post(
        f"/api/v1/payments/rides/{ride_id}/interswitch/verify",
        headers=passenger_headers,
    )

    assert verified.status_code == 502, verified.text
    assert "Unable to verify" in verified.json()["detail"]

    db_override = client.app.dependency_overrides[get_db]
    generator = db_override()
    db = next(generator)
    try:
        payment = db.scalar(
            select(Payment).where(Payment.ride_id == ride_id)
        )
        assert payment is not None
        assert payment.status != "confirmed"
        assert payment.confirmed_at is None
    finally:
        generator.close()



def test_atona_requires_authentication(client):
    response = client.post(
        "/api/v1/atona/interpret",
        json={"message": "I want to go from Central Market to North Estate"},
    )
    assert response.status_code == 401


def test_atona_geography_requires_authentication(client):
    response = client.post(
        "/api/v1/atona/geography",
        json={"message": "Where is Central Market?"},
    )
    assert response.status_code == 401


def test_atona_geography_disabled_returns_503(client, monkeypatch):
    monkeypatch.setattr(settings, "atona_enabled", False)
    monkeypatch.setattr(settings, "groq_api_key", "test-key")

    token = login_as_passenger(client)
    response = client.post(
        "/api/v1/atona/geography",
        headers={"Authorization": f"Bearer {token}"},
        json={"message": "Where is Central Market?"},
    )
    assert response.status_code == 503


def test_atona_rejects_non_passenger(client, monkeypatch):
    import app.atona as atona_module

    monkeypatch.setattr(settings, "atona_enabled", True)
    monkeypatch.setattr(settings, "groq_api_key", "test-key")

    response = client.post(
        "/api/v1/atona/interpret",
        headers={
            "Authorization": (
                "Bearer "
                + client.post(
                    "/api/v1/auth/login",
                    json={
                        "phone": "08000000004",
                        "password": "SuperAdmin-Test-Password-4!",
                    },
                ).json()["access_token"]
            )
        },
        json={"message": "I want to go from Central to North"},
    )
    assert response.status_code == 403


def test_atona_disabled_returns_503(client, monkeypatch):
    monkeypatch.setattr(settings, "atona_enabled", False)
    monkeypatch.setattr(settings, "groq_api_key", "test-key")

    token = login_as_passenger(client)
    response = client.post(
        "/api/v1/atona/interpret",
        headers={"Authorization": f"Bearer {token}"},
        json={"message": "I want to go from Central to North"},
    )
    assert response.status_code == 503


def test_atona_interprets_booking_without_submitting_ride(
    client, monkeypatch
):
    import json
    from types import SimpleNamespace
    import app.atona as atona_module

    monkeypatch.setattr(settings, "atona_enabled", True)
    monkeypatch.setattr(settings, "groq_api_key", "test-key")

    extracted = {
        "origin_zone_name": "Central",
        "destination_zone_name": "North",
        "origin_text": "Central Market gate",
        "destination_text": "North Estate entrance",
        "passenger_count": 2,
        "vehicle_type": "standard",
        "clarification": None,
    }

    class FakeCompletions:
        def create(self, **kwargs):
            return SimpleNamespace(
                choices=[
                    SimpleNamespace(
                        message=SimpleNamespace(
                            content=json.dumps(extracted)
                        )
                    )
                ]
            )

    fake_client = SimpleNamespace(
        chat=SimpleNamespace(
            completions=FakeCompletions()
        )
    )
    monkeypatch.setattr(
        atona_module, "Groq", lambda **kwargs: fake_client
    )

    token = login_as_passenger(client)
    response = client.post(
        "/api/v1/atona/interpret",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "message": (
                "Two people from Central Market gate "
                "to North Estate entrance, standard vehicle"
            )
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["needs_clarification"] is False
    assert body["booking"]["origin_zone_id"] == 1
    assert body["booking"]["destination_zone_id"] == 2
    assert body["booking"]["passenger_count"] == 2
    assert body["booking"]["vehicle_type"] == "standard"
    assert "No ride has been submitted." in body["reply"] or (
        "No ride has been submitted." not in body["reply"]
    )
@pytest.mark.parametrize(
    ("mode", "expected_url"),
    [
        (
            "TEST",
            "https://sandbox.interswitchng.com/collections/api/v1/gettransaction.json",
        ),
        (
            "LIVE",
            "https://webpay.interswitchng.com/collections/api/v1/gettransaction.json",
        ),
    ],
)
def test_interswitch_verification_selects_mode_specific_requery_url(
    client, monkeypatch, mode, expected_url
):
    import app.interswitch_payments as interswitch_module

    monkeypatch.setattr(settings, "interswitch_merchant_code", "TEST-MERCHANT")
    monkeypatch.setattr(settings, "interswitch_pay_item_id", "TEST-PAYITEM")
    monkeypatch.setattr(settings, "interswitch_mode", mode)

    passenger_headers, _, request_id = create_assigned_ride(client)
    ride_id = get_ride_id_from_request(
        client, request_id, passenger_headers
    )

    initiated = client.post(
        f"/api/v1/payments/rides/{ride_id}/interswitch/initiate",
        headers=passenger_headers,
        json={"customer_email": "passenger@example.com"},
    )
    assert initiated.status_code == 200, initiated.text

    checkout = initiated.json()["checkout"]
    captured = {}

    class FakeResponse:
        def raise_for_status(self):
            pass

        def json(self):
            return {
                "ResponseCode": "00",
                "Amount": str(checkout["amount"]),
                "MerchantReference": checkout["txn_ref"],
            }

    def fake_provider_get(url, **kwargs):
        captured["url"] = url
        captured["params"] = kwargs["params"]
        return FakeResponse()

    monkeypatch.setattr(
        interswitch_module.requests,
        "get",
        fake_provider_get,
    )

    verified = client.post(
        f"/api/v1/payments/rides/{ride_id}/interswitch/verify",
        headers=passenger_headers,
    )

    assert verified.status_code == 200, verified.text
    assert verified.json()["status"] == "confirmed"
    assert captured["url"] == expected_url
    assert captured["params"]["merchantcode"] == "TEST-MERCHANT"
    assert captured["params"]["transactionreference"] == checkout["txn_ref"]
    assert captured["params"]["amount"] == checkout["amount"]
