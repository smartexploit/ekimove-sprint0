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

## Business details (bank account, support contacts)
Passengers see the bank-transfer account and EkiMove's support contacts in the app. These are settings, not code, so they can be filled in or changed later without a release. Set them in `.env` locally or in the deployment environment:

```dotenv
BANK_TRANSFER_BANK_NAME=
BANK_TRANSFER_ACCOUNT_NUMBER=
BANK_TRANSFER_ACCOUNT_NAME=
SUPPORT_PHONE=
SUPPORT_EMAIL=
SUPPORT_WHATSAPP=
```

Until all three bank fields are set, the payments page tells passengers the account details aren't available yet and points them to support. Any support contact left blank is simply not shown. The values are served by `GET /api/v1/business-info`; restart the API after changing them.

Driver plate numbers come from each driver's application (`plate_number` on the vehicle record). Passengers see the assigned driver's first name, last initial and plate on My rides once a ride is assigned.

## Instant payments and cancellations
Passengers pay by bank transfer into a **personal EkiMove account number** (a Paystack dedicated virtual account), so nobody has to type a reference or wait for staff.

1. On *Payments* the passenger agrees once and gets an account number that stays theirs.
2. Paystack sends a signed `charge.success` webhook to `POST /api/v1/payments/paystack/webhook`. The signature is checked, the transaction is re-verified with Paystack, and the deposit is matched to the passenger's oldest unpaid ride with exactly that fare. The payment is confirmed and the driver can start the trip. Webhook replays are ignored.
3. Anything that doesn't match (wrong amount, no unpaid ride, unknown account) is listed for admins under **Deposits to check** on *Admin → Payments*, where it can be matched to a ride or closed after refunding.

**Cancelling:** passengers can cancel from *My rides*. It's free before a driver is assigned and for `CANCELLATION_FREE_SECONDS` after. Later, while the driver is still on the way, a paid ride keeps `CANCELLATION_FEE_MOTORCYCLE` / `CANCELLATION_FEE_CAR` for the driver's time and the rest becomes a refund listed under **Refunds to send**. Unpaid rides cancel free. Started trips can't be cancelled (use SOS or support).

**To go live:** EkiMove needs a registered business on Paystack with dedicated virtual accounts enabled (some business types must validate the customer's BVN first; Paystack's default limit is 1,000 accounts). Set `PAYSTACK_SECRET_KEY` on the API and add the webhook URL in the Paystack dashboard. Until then the app keeps the existing manual bank-transfer and Interswitch flows. Refunds are recorded in the app but sent by hand from the bank for now.

## Driver earnings and payouts
EkiMove keeps `COMMISSION_PERCENT` (10% by default) of every fare; the driver keeps the rest.

- **When drivers earn:** completing a paid trip credits the driver's balance with the fare minus commission. A kept cancellation fee is split the same way. Each entry records the fare, the commission and the rate used, so changing the rate later doesn't rewrite history.
- **Drivers** see their balance, today and this week, an itemised list ("₦600 − ₦60 EkiMove = +₦540") and their payouts on *Earnings*, and add the bank account to be paid into. With Paystack configured, the account name is confirmed with the bank.
- **Admins** see fares, EkiMove's commission, what's owed and what's been paid on *Admin → Earnings*, and can press **Pay drivers now**.
- **Payouts:** every balance of at least `PAYOUT_MINIMUM` is paid out. The debit is saved before any money moves. With `PAYSTACK_TRANSFERS_ENABLED=true`, Paystack Transfers sends it to verified accounts and the `transfer.success` / `transfer.failed` / `transfer.reversed` webhooks (same URL as above) settle it. Otherwise the payout waits for staff to send it from the bank and mark it sent. A failed or reversed payout returns the money to the driver's balance.
- **Daily schedule:** create a Render **Cron Job** (e.g. schedule `0 17 * * *`, 6 pm in Lagos) with command `curl -fsS -X POST -H "X-Cron-Token: $PAYOUT_CRON_TOKEN" https://ekimove-api.onrender.com/api/v1/internal/payouts/run`, and set the same `PAYOUT_CRON_TOKEN` on the API.
- Before automatic transfers: turn off the transfer OTP in the Paystack dashboard, keep the Paystack balance funded, and confirm VAT on commission with an accountant. Trips completed before this release have no earnings entries.

## Atọ́nà assistant
Atọ́nà is EkiMove's chat guide, available to everyone on the homepage and on every passenger and driver screen. It chats naturally in English or Nigerian Pidgin, and answers EkiMove questions from live data through tools instead of guessing:

- **Places and fares:** quotes the approved fare for an exact route and shows a "Trip ready" card that opens Book a ride prefilled.
- **Your rides:** a passenger's latest rides with status, driver and plate; a driver's trips and approval status. Guests are asked to sign in, with buttons in the chat.
- **Payments and support:** how to pay, plus the bank details and contacts from the business settings above.
- **Map lookups (optional):** with `GEOAPIFY_API_KEY`, it can check landmarks and estimate driving distance and time.

It never books rides, assigns drivers or confirms payments. To switch it on, set `ATONA_ENABLED=true` and `GROQ_API_KEY`; the chat button stays hidden until both are set (`GET /api/v1/atona/status`). Messages are rate-limited per account and per guest IP (`ATONA_*_MESSAGE_LIMIT`), using Redis when configured.

## Installable app (PWA)
The frontend is a Progressive Web App: people can add EkiMove to their phone's home screen and it opens full screen like a native app.

- **Android / Chrome:** an "Install app" card appears on the homepage and passenger home; the browser menu also offers *Install app*.
- **iPhone / Safari:** the card explains *Share → Add to Home Screen*.
- The service worker (built by `vite-plugin-pwa`) caches only the app itself, so it opens instantly and works on a weak connection. Ride, fare and payment data always come live from the API and are never cached. New releases install in the background and apply on the next launch.
- PWAs need HTTPS (Render provides it). Icons live in `frontend/public/brand/`.

## Deploying the frontend on Render
The frontend is a separate Render **Static Site** (`ekimove.onrender.com`), not part of `render.yaml`. Its settings should be:

- **Branch:** `master`, with **Auto-Deploy** on
- **Root directory:** `frontend`
- **Build command:** `npm ci && npm run build`
- **Publish directory:** `dist`
- **Environment:** `VITE_API_BASE_URL=https://ekimove-api.onrender.com`
- **Redirects/Rewrites:** source `/*`, destination `/index.html`, action **Rewrite**, so links such as `/login` or `/my-rides` open directly.

## Brand assets
- Logo, app icon and favicon: `frontend/public/favicon.svg`, `frontend/public/brand/`
- Design system (colours, type, components): `frontend/src/styles/ekimove.css`

## Next implementation stages
1. Phone verification and role-based authorization.
2. Admin-only zone/fare management and audit logging for changes.
3. Driver verification and dispatch workflow.
4. Ride lifecycle, safety workflows and incident handling.
5. Trusted bank-transfer reconciliation; no screenshot-only confirmation and no cash pathway.
6. Frontend, notifications, privacy controls and production hardening.
