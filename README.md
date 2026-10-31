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

**To go live:** EkiMove needs a registered business on Paystack with dedicated virtual accounts enabled (some business types must validate the customer's BVN first; Paystack's default limit is 1,000 accounts). Set `PAYSTACK_SECRET_KEY` on the API and add the webhook URL in the Paystack dashboard. Until then the app keeps the existing manual bank-transfer and Interswitch flows. If Paystack hasn't enabled Dedicated Virtual Accounts yet (the app shows "Dedicated NUBAN is not available for your business"), set `PAYSTACK_VIRTUAL_ACCOUNTS_ENABLED=false`: passengers pay into the `BANK_TRANSFER_*` account as before, while the Paystack key keeps working for driver payouts. The Payments page also falls back to that account automatically if account creation is refused. Refunds are recorded in the app but sent by hand from the bank for now.

## Driver earnings and payouts
EkiMove keeps `COMMISSION_PERCENT` (10% by default) of every fare; the driver keeps the rest.

- **When drivers earn:** completing a paid trip credits the driver's balance with the fare minus commission. A kept cancellation fee is split the same way. Each entry records the fare, the commission and the rate used, so changing the rate later doesn't rewrite history.
- **Drivers** see their balance, today and this week, an itemised list ("₦600 − ₦60 EkiMove = +₦540") and their payouts on *Earnings*, and add the bank account to be paid into. With Paystack configured, the account name is confirmed with the bank.
- **Admins** see fares, EkiMove's commission, what's owed and what's been paid on *Admin → Earnings*, and can press **Pay drivers now**.
- **Payouts:** every balance of at least `PAYOUT_MINIMUM` is paid out. The debit is saved before any money moves. With `PAYSTACK_TRANSFERS_ENABLED=true`, Paystack Transfers sends it to verified accounts and the `transfer.success` / `transfer.failed` / `transfer.reversed` webhooks (same URL as above) settle it. Otherwise the payout waits for staff to send it from the bank and mark it sent. A failed or reversed payout returns the money to the driver's balance.
- **Daily schedule:** create a Render **Cron Job** (e.g. schedule `0 17 * * *`, 6 pm in Lagos) with command `curl -fsS -X POST -H "X-Cron-Token: $PAYOUT_CRON_TOKEN" https://ekimove-api.onrender.com/api/v1/internal/payouts/run`, and set the same `PAYOUT_CRON_TOKEN` on the API.
- Before automatic transfers: turn off the transfer OTP in the Paystack dashboard, keep the Paystack balance funded, and confirm VAT on commission with an accountant. Trips completed before this release have no earnings entries.

## Vehicles and passenger limits
- A **car** carries up to 4 passengers.
- A **motorcycle** carries 1 passenger. The super-admin can allow a **second passenger** at an extra charge under *Admin → Places & fares → Booking rules*. A route's own "extra passenger" amount for motorcycles, if above ₦0, overrides that default charge. The limits are enforced by the API, not just the app.
- Passengers can pick **Car**, **Motorcycle** or **Move a load** straight from their dashboard; the choice is kept while they pick the route.

## Automatic driver assignment
New requests (and accepted load quotes) are offered to one driver at a time:

- **Who is asked first:** among approved, online, free drivers with a matching approved vehicle, the **nearest** by straight-line distance, when the pickup place has coordinates (set them under *Places & fares*) and the driver's phone shared its location in the last 15 minutes. Otherwise the driver who has **waited longest** for a trip.
- **The offer:** a card pops up on every driver screen with the route, distance, passengers and what they'll earn after commission, with a countdown, vibration and a short beep. **Accept** creates the trip; **Decline** or no answer passes it to the next driver. A driver going offline or being suspended passes their offer on.
- **Fallback:** after the set number of drivers (5 by default) the request is marked **Needs you** on *Admin → Dispatch*, where admins can always assign by hand (that withdraws any live offer). The switch, the seconds to accept (30 by default) and the number of drivers to try are on that page.
- **No extra server needed:** the engine runs whenever drivers, passengers or admins have the app open (their pages check every few seconds). The database allows only one live offer per request and per driver. Optionally, a Render Cron Job every minute can call `POST /api/v1/internal/dispatch/run` with the same `X-Cron-Token` header as the payout job.
- Drivers share location only while online, and only if they allow it on their phone.

## Trust and safety
- **Pickup PIN:** every assigned trip gets a 4-digit PIN shown only in the passenger's app. The driver must enter it to start the trip; 5 wrong tries lock the trip (contact support). Trips from before PINs existed start without one.
- **Live tracking:** while online, drivers' phones share location every ~10 s (with permission). Passengers see the driver approaching on a map with distance and an estimated arrival time, then the route during the trip. Maps use OpenStreetMap tiles, or Geoapify's when `GEOAPIFY_API_KEY` is set (recommended for production traffic).
- **Trip sharing:** passengers can share a live link (`/t/…`) with someone they trust, or text it to their emergency contact. No sign-in needed; it never shows the PIN and stops working 2 hours after the trip ends or when sharing is stopped.
- **Traceability:** each trip records the exact vehicle, arrival/start/end times and the driver's GPS trail. Every sign-in is logged with time, IP address and device. Admins see all of this per person under *People* (“Trip record”, “Recent sign-ins”), and online drivers on *Live map*.
- **Ratings and receipts:** passengers and drivers rate each other after a completed trip; averages show on profiles and to the other side. Every ended trip has a printable receipt with a “Report a problem” link.
- **Passenger ID verification:** passengers can submit a NIN, voter's card, driver's licence or passport with a photo (stored privately in Cloudinary, so `CLOUDINARY_URL` must be set). Admins approve or reject under *People → ID to review*. Drivers see a “ID verified” badge. *Places & fares → Booking rules* can require verification before booking.
- **Emergency contact:** set on the profile; used for one-tap trip sharing.
- **Policies:** Terms of Service, Privacy Policy (Nigeria Data Protection Act 2023), Community & Safety Guidelines, Cancellation & Refund Policy and Driver Agreement at `/policies`. New users agree at sign-up; existing users are asked once. Acceptance is stored with time, IP and device. To publish a new version, update the text in `frontend/src/utils/policies.js` and bump `POLICY_VERSION` there **and** in `app/verification.py`; everyone is asked to accept again. Have a Nigerian lawyer review the policies before relying on them.

## Load bookings (big cars, vans, dyna trucks)
Passengers describe the load and route on *Move a load*. That opens a support chat. EkiMove support agrees the price and terms there, then sends the quote from *Admin → Loads*. The customer accepts (the job joins the normal dispatch queue) or declines. Once a driver with a matching vehicle is assigned, the customer pays through EkiMove like any ride, and the driver's earnings and commission work the same way. Drivers can register big cars, vans/buses and dyna trucks.

## Support chat
Passengers and drivers can chat with the EkiMove team under *Support*; the team answers from *Admin → Support* (unanswered chats first, with a count in the menu). Conversations can be marked resolved and reopen when the customer writes again.

## Profiles, sessions and accounts
- Everyone has a *Profile* (tap your initials): name, sign-in details (phone and email), phone notifications, password change. Changing the password signs out other devices.
- **Session timeout:** after 15 minutes without activity the app (including the installed PWA) warns for one minute, then signs out. While people are active, their session renews silently (`POST /api/v1/auth/refresh`).
- **Super-admin:** *Overview* shows what needs attention, live trips, money and recent activity (refreshes every 20 seconds). *People* lists passengers and drivers with their profile, trips, vehicles, balance and activity, and can **suspend** (signed out at once, can't sign in or be assigned), **reactivate** or **remove** an account (name, phone and sign-in erased; trips, payments and earnings kept). Super-admin accounts can't be changed there, and people can't be removed mid-trip.

## Sign-up, codes and password reset
- **Phone or email:** passengers sign up with a phone number *or* an email address (drivers give a phone number, email optional) and sign in with either. Numbers match in any common form (`0803…`, `234803…`, `+234 803…`); emails are case-insensitive and unique.
- **Codes:** once text messages or email are set up, new and existing people confirm their phone number or email with a 6-digit code before they can book (super-admins are never asked). Codes last 10 minutes, allow 5 tries, can be re-sent once a minute and 5 times an hour per number, and only a hash is stored. `SMS_DAILY_LIMIT` (default 300) caps texts per 24 hours so abuse can't run up a bill. *Places & fares → Booking rules* can switch confirmation off at once if a provider has a problem.
- **Forgot password:** `/forgot-password` sends a code to the phone or email on the account (it says the same thing whether or not an account exists). Until a provider is set up, the page tells people to message support.
- **Changing phone or email:** from the profile, with the password; a code goes to the *new* number or address.
- **Admin reset:** *People → Reset password* gives a one-time temporary password to read out to the person (after checking it's really them). They must choose their own on next sign-in, and every device they were on is signed out.
- **Setting up text messages (recommended: BulkSMSNigeria, ₦6.49 per text, DND numbers included):** create an account, buy units, request the sender ID `EkiMove` (choose *transactional/OTP* so it reaches DND numbers), generate an API token, then in Render set `SMS_PROVIDER=bulksmsnigeria`, `BULKSMS_API_TOKEN` and `SMS_SENDER_ID=EkiMove`. Termii also works: `SMS_PROVIDER=termii`, `TERMII_API_KEY`, and `TERMII_BASE_URL` from your Termii dashboard.
- **Setting up email (optional):** Render's free plan blocks SMTP, so use Brevo's web API: `EMAIL_PROVIDER=brevo`, `BREVO_API_KEY`, `EMAIL_FROM_ADDRESS` (a sender verified in Brevo). Any SMTP server works on paid plans with `EMAIL_PROVIDER=smtp` and the `SMTP_*` settings. Email from a free Gmail address may land in spam; use an address on your own domain once you have one.

## Phone notifications
People turn notifications on from *Profile* (drivers also on *My driver status*, super-admins on *Overview*). They get: trip offers (drivers), driver assigned/arrived, trip started/completed and cancellations, payment confirmed (both sides), load quotes, support replies, ID and driver-application decisions; super-admins get new support messages and SOS alerts. On iPhone, notifications need iOS 16.4+ and EkiMove added to the Home Screen first. The server's signing keys are created automatically and stored in the database; nothing to set up (`PUSH_ENABLED=false` turns notifications off). Notifications are sent only after the change is saved, in the background.

## Reports
*Admin → Reports* shows daily totals (Lagos days): requests, completed trips and fares, cancellations, payments received, refunds, commission, driver earnings, payouts and new sign-ups, for any range up to a year. CSV downloads (daily summary, trips, payments, payouts) open in Excel or Google Sheets.

## Running in production
- **Error alerts (optional):** set `SENTRY_DSN` from a free Sentry project to be emailed when the API crashes. No personal data is sent.
- **Uptime:** add a free monitor (e.g. UptimeRobot) on `https://<api>/health` every 5 minutes. On Render's free plan this also stops the API from sleeping.
- **Backups:** Render's paid Postgres plans take daily backups with point-in-time recovery; free databases have no backups and expire, so move to a paid database before real money flows. Before big changes, download a backup from the database's *Recovery* page.

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
