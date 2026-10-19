# EkiMove API â€” Sprint 1 booking foundation

Provisional brand for the Ride & Share Ekiti mobility platform. Initial pilot target: Ado-Ekiti, Ekiti State.

## Product decisions
- Bank transfer only. Cash is not supported, including as a fallback.
- Payment screenshots or user claims do not, by themselves, confirm receipt.
- Do not use real-money payment processing until the business account/provider and reconciliation procedure are approved.

## Implemented
- FastAPI process and database health checks.
- PostgreSQL connection configured through `.env`, SQLAlchemy sessions, initial Alembic migration.
- Initial data models for users, drivers, vehicles, zones, fares, ride requests, rides, payments, ratings, incidents and audit logs.
- `GET /api/v1/zones`: list active configured zones.
- `POST /api/v1/ride-requests`: validates an active passenger and active route zones, looks up an active fare on the server, calculates a quote, and stores the request.
- Explicit bank-transfer-only payment policy.
- Automated tests for the booking workflow and validation cases.

## Important MVP security limitation
Authentication uses JWTs, and ride requests derive the passenger identity from the authenticated user rather than trusting a client-supplied user ID. This is an MVP, not a complete production-ready transport platform. Phone verification, administrative fare management, driver verification, dispatch, incident handling, and payment reconciliation still require implementation or further validation. The ride-request endpoint creates a quote/request; it does not confirm a bank transfer or process payment.

## Fare setup prerequisite
Ride requests require active records in `zones` and `fares`. The API deliberately does not invent fares or accept a fare amount from the client. Configure the pilot zones and approved fare schedule before testing against your local PostgreSQL database.

A fare is selected by `origin_zone_id`, `destination_zone_id`, and `vehicle_type`. Quote calculation is:

`(base_amount Ã— vehicle_multiplier) + (extra_passenger_amount Ã— (passenger_count - 1))`

The final amount is rounded to two decimal places and returned in NGN. Only configured, active fares are used.

## Windows + PowerShell setup

Activate your virtual environment and install dependencies:

```powershell
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Configure `.env` locally (never commit or share it):

```dotenv
APP_NAME=EkiMove API
APP_ENV=development
DATABASE_URL=postgresql+psycopg://ekimove_app:YOUR_PASSWORD@127.0.0.1:5432/ekimove
```

Keep your existing working `.env`; do not replace it with `.env.example`.

Apply migrations (only when a new migration is provided):

```powershell
alembic upgrade head
```

Run tests:

```powershell
python -m pytest -q
```

Run the local API on port 8011:

```powershell
python -m uvicorn app.main:app --host 127.0.0.1 --port 8011 --reload
```

Interactive API documentation: `http://127.0.0.1:8011/docs`

Endpoints:
- `GET /health`
- `GET /health/database`
- `GET /api/v1/policy/payments`
- `GET /api/v1/zones`
- `POST /api/v1/ride-requests`

## Next implementation stages
1. Phone verification and role-based authorization.
2. Admin-only zone/fare management and audit logging for changes.
3. Driver verification and dispatch workflow.
4. Ride lifecycle, safety workflows and incident handling.
5. Trusted bank-transfer reconciliation; no screenshot-only confirmation and no cash pathway.
6. Frontend, notifications, privacy controls and production hardening.
