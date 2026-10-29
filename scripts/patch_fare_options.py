from pathlib import Path

main_path = Path("app/main.py")
main = main_path.read_text(encoding="utf-8")

anchor = '''@app.post(
    "/api/v1/ride-requests",
'''

endpoint = '''@app.get("/api/v1/fare-options", tags=["booking"])
def list_active_fare_options(
    origin_zone_id: int,
    destination_zone_id: int,
    db: Session = Depends(get_db),
) -> list[str]:
    """List vehicle types with active fares for a valid route."""
    if origin_zone_id <= 0 or destination_zone_id <= 0:
        raise HTTPException(status_code=422, detail="Zone IDs must be positive")

    if origin_zone_id == destination_zone_id:
        return []

    origin = db.get(Zone, origin_zone_id)
    destination = db.get(Zone, destination_zone_id)

    if (
        origin is None
        or destination is None
        or not origin.is_active
        or not destination.is_active
    ):
        return []

    vehicle_types = db.scalars(
        select(Fare.vehicle_type)
        .where(
            Fare.origin_zone_id == origin_zone_id,
            Fare.destination_zone_id == destination_zone_id,
            Fare.is_active.is_(True),
        )
        .distinct()
        .order_by(Fare.vehicle_type)
    ).all()

    return list(vehicle_types)


'''

if endpoint.strip() not in main:
    if main.count(anchor) != 1:
        raise SystemExit("Could not safely identify the ride-request route. No changes made.")
    main = main.replace(anchor, endpoint + anchor, 1)
    main_path.write_text(main, encoding="utf-8")
    print("Added fare-options endpoint.")
else:
    print("Fare-options endpoint already exists; left it unchanged.")

test_path = Path("tests/test_api.py")
tests = test_path.read_text(encoding="utf-8")

test_anchor = '''def test_login_returns_bearer_token(client):
'''

new_tests = '''def test_fare_options_returns_only_active_route_vehicle_types(client):
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


'''

if all(name in tests for name in (
    "def test_fare_options_returns_only_active_route_vehicle_types",
    "def test_fare_options_returns_empty_for_same_zone",
    "def test_fare_options_returns_empty_for_unknown_zone",
)):
    print("Fare-options tests already exist; left them unchanged.")
else:
    if tests.count(test_anchor) != 1:
        raise SystemExit("Could not safely identify the test insertion point.")
    tests = tests.replace(test_anchor, new_tests + test_anchor, 1)
    test_path.write_text(tests, encoding="utf-8")
    print("Added three fare-options tests.")
