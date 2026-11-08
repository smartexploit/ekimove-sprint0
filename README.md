# EkiMove API Sprint 1 booking foundation

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

**Removing locations.** In *Places & fares*, every service area, zone, place and route fare has a **Remove** button. It first shows what would go with it (an area takes its places, their route fares and passengers' saved shortcuts; a zone takes its zone fares) and asks to confirm. Anything a trip has used can't be removed, so receipts and reports keep their place names: set it to **Inactive** instead (one tap from the same panel), which hides it from booking. A zone still used by places must have them moved or removed first. Every removal is recorded in the audit log.

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
- **Daily schedule:** create a Render **Cron Job** (e.g. schedule `0 17 * * *`, 6 pm in Lagos) with command `curl -fsS -X POST -H "X-Cron-Token: $PAYOUT_CRON_TOKEN" https://api.ekimove.com.ng/api/v1/internal/payouts/run`, and set the same `PAYOUT_CRON_TOKEN` on the API.
- Before automatic transfers: turn off the transfer OTP in the Paystack dashboard, keep the Paystack balance funded, and confirm VAT on commission with an accountant. Trips completed before this release have no earnings entries.

## Vehicles and passenger limits
- A **car** carries up to 4 passengers.
- A **motorcycle** carries 1 passenger. The super-admin can allow a **second passenger** at an extra charge under *Admin → Places & fares → Booking rules*. A route's own "extra passenger" amount for motorcycles, if above ₦0, overrides that default charge. The limits are enforced by the API, not just the app.
- Passengers can pick **Car**, **Motorcycle** or **Move a load** straight from their dashboard; the choice is kept while they pick the route.

## Automatic driver assignment
*Admin → Dispatch → Automatic dispatch* has two modes:

- **All free drivers at once (default, fastest):** a new request (or accepted load quote) rings at the same moment on every approved, online driver with a matching approved vehicle (motorcycle requests go to motorcycle drivers, car requests to car drivers) who is **not on a trip** and not already looking at another offer. The first to accept gets it; the offer disappears from everyone else's screen and they get a "taken" notice. Drivers who come online or finish a trip during the countdown join the round. If nobody accepts, a new round starts, up to the set number of rounds, then the request is marked **Needs you** and admins get a notification.
- **One driver at a time:** the nearest free driver (when the pickup has coordinates and the driver's location is fresh), otherwise the one who has waited longest, is asked first; decline or no answer passes it on.
- **The offer:** a full-screen card with the route, distance, passengers, earnings after commission, a countdown, vibration and a ringing tone that repeats until the driver answers. With notifications on, a phone notification rings even when the app is closed.
- **Admins** can always assign by hand (that withdraws live offers). The **Drivers** list on the same page shows who is free, on a trip or offline, with **Call** and **Message** buttons (messages open a support conversation the driver sees in the app).
- **No extra server needed:** the engine runs whenever drivers, passengers or admins have the app open. The database allows only one live offer per driver, and only one trip per request, so two drivers can't both win. Optionally, a Render Cron Job every minute can call `POST /api/v1/internal/dispatch/run` with the same `X-Cron-Token` header as the payout job.
- **Passenger guide:** after booking, a pop-up walks the passenger through each step: finding a driver (and how many phones it is ringing on), driver accepted → pay, driver on the way, driver arrived (with the pickup PIN), on the trip, and rate. "Got it" shrinks it to a bar they can reopen.
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
- **Phone or email:** passengers sign up with a Nigerian mobile number *or* an email address (drivers give a phone number, email optional) and sign in with either. Numbers match in any common form (`0803…`, `234803…`, `+234 803…`); emails are case-insensitive and unique. See *Security controls* for exactly what each field accepts.
- **Codes:** once text messages or email are set up, new and existing people confirm their phone number or email with a 6-digit code before they can book (super-admins are never asked). Codes last 10 minutes, allow 5 tries, can be re-sent once a minute, 5 times an hour and 10 times a day per number, and only a hash is stored. `SMS_DAILY_LIMIT` (default 300) caps texts per 24 hours so abuse can't run up a bill. *Places & fares → Booking rules* can switch confirmation off at once if a provider has a problem.
- **Forgot password:** `/forgot-password` sends a code to the phone or email on the account (it says the same thing whether or not an account exists). Until a provider is set up, the page tells people to message support.
- **Changing phone or email:** from the profile, with the password; a code goes to the *new* number or address.
- **Admin reset:** *People → Reset password* gives a one-time temporary password to read out to the person (after checking it's really them). They must choose their own on next sign-in, and every device they were on is signed out.
- **Setting up text messages (recommended: BulkSMSNigeria, ₦6.49 per text, DND numbers included):** create an account, buy units, request the sender ID `EkiMove` (choose *transactional/OTP* so it reaches DND numbers), generate an API token, then in Render set `SMS_PROVIDER=bulksmsnigeria`, `BULKSMS_API_TOKEN` and `SMS_SENDER_ID=EkiMove`. Termii also works: `SMS_PROVIDER=termii`, `TERMII_API_KEY`, and `TERMII_BASE_URL` from your Termii dashboard.
- **Setting up email (optional):** Render's free plan blocks SMTP, so use Brevo's web API: `EMAIL_PROVIDER=brevo`, `BREVO_API_KEY`, `EMAIL_FROM_ADDRESS` (a sender verified in Brevo). Any SMTP server works on paid plans with `EMAIL_PROVIDER=smtp` and the `SMTP_*` settings. Email from a free Gmail address may land in spam; use an address on your own domain once you have one.

## Book for later, saved places, promos, invites, trip chat
- **Book for later:** passengers choose *Later* and a pickup time 30 minutes to 7 days ahead. The ride waits as “booked ahead” and is offered to drivers a set time before pickup (*Places & fares → Booking rules*, default 20 minutes); the passenger gets a notification when the search starts. Dispatch runs whenever someone has the app open; for reliable early-morning bookings, also call `POST /api/v1/internal/dispatch/run` (header `X-Cron-Token: <PAYOUT_CRON_TOKEN>`) every few minutes from a cron job or a free uptime monitor.
- **Saved places and ride again:** passengers save Home, Work or any named place from the booking form and pick it in one tap later. *My rides* has **Ride again** on past trips.
- **Promo codes:** create them under *Admin → Promos & invites*: naira or percent off, optional cap, minimum fare, last day, total uses, uses per person and “first ride only”. Passengers enter a code when booking. The discount comes off what they pay; drivers still earn on the full fare and EkiMove covers the difference from its commission. Every ride still costs at least ₦100. A code used on a booking cancelled before payment can be used again. Reports show discounts given.
- **Invites:** every passenger has an invite code and link (*Invite friends*). A friend who signs up with it gets ₦300 off their first ride; when they finish it, the inviter gets ₦300 off their next one (amounts and on/off under *Promos & invites*; at most 20 rewards per inviter a month).
- **Trip chat:** the passenger and driver can message each other in the app from assignment until the trip ends (with quick replies like “I’ve arrived”), so they never need to share numbers. Messages notify the other person’s phone and are kept in the trip record for safety reviews.

## Package deliveries
Customers choose *Send a package*: pickup and drop-off places, size, what's inside, the recipient's name and phone, optional directions and "fragile", now or later, and a promo code. They must confirm the package holds no banned items.
- **Price:** small and medium go by motorcycle (by car where the route has no motorcycle fare), large by car. Price = that route fare + an extra for medium and large (default ₦200 and ₦300; *Places & fares → Booking rules*, where deliveries can also be switched off).
- **Hand-over safety:** the rider collects with the sender's pickup PIN and can finish only with the recipient's 4-digit delivery code (5 wrong tries lock it). The sender sees the code in *My rides* and can forward it; when text messages are set up, the recipient is texted the code and a tracking link (`/t/…`, no sign-in) the moment the package is picked up. The rider never sees the code.
- **Payment, dispatch, earnings, chat, receipts and reports** work as for rides. If the recipient got the package but can't give the code, staff can mark it delivered from *Live map* after calling them (kept in the log).
- `FRONTEND_URL` (default `https://ekimove.com.ng`) is used in the recipient's text.

## Data rights
From *Profile → Your data*, anyone can download a copy of their data (JSON) or ask for their account to be deleted (password needed, can be cancelled). Requests open a support chat and appear under *People → Deletion requested*; staff settle refunds or driver balances, then use **Remove account**, which erases the name, contacts, sign-in, saved places and devices and keeps trips and payments anonymised.

## Phone notifications
People turn notifications on from *Profile* (drivers also on *My driver status*, super-admins on *Overview*). They get: trip offers (drivers), driver assigned/arrived, trip started/completed and cancellations, payment confirmed (both sides), load quotes, support replies, ID and driver-application decisions; super-admins get new support messages and SOS alerts. On iPhone, notifications need iOS 16.4+ and EkiMove added to the Home Screen first. The server's signing keys are created automatically and stored in the database; nothing to set up (`PUSH_ENABLED=false` turns notifications off). Notifications are sent only after the change is saved, in the background.

## Reports
*Admin → Reports* shows daily totals (Lagos days): requests, completed trips and fares, cancellations, payments received, refunds, commission, driver earnings, payouts and new sign-ups, for any range up to a year. CSV downloads (daily summary, trips, payments, payouts) open in Excel or Google Sheets.

## Security controls
- **What the sign-up, sign-in and contact fields accept** (checked on the phone and again by the server, `app/contacts.py`):
  - *Phone:* Nigerian mobile numbers only (070/080/081/090/091, typed as `0803…`, `234803…` or `+234 803…`, spaces and dashes allowed), saved as `0803…`. Foreign and landline numbers are refused, which also blocks "SMS pumping" fraud on code texts.
  - *Email:* a plain address (`name@example.com`), lower-cased.
  - *Names* (people, recipients, emergency contacts): letters in any language including Yoruba tone marks, spaces, hyphens, apostrophes and "Dr."-style full stops, up to 80 characters. No digits, links or symbols, because names appear in texts and on drivers' screens.
  - *Passwords:* 12–128 characters; not only numbers, not a common password, not a run of keys, and not containing the person's phone number, email or just their name.
  - *Invite codes:* letters, numbers and hyphens. Unknown fields are refused everywhere.
- **Limits:** 5 wrong passwords per account and 30 per connection in 15 minutes; 10 new accounts and 10 code requests per connection per hour; 5 driver applications per connection per hour; codes 5 per hour and 10 per day per number; current-password checks 5 per 15 minutes. Change them with `LOGIN_RATE_LIMIT_ATTEMPTS`, `LOGIN_IP_RATE_LIMIT_ATTEMPTS`, `SIGNUP_IP_LIMIT_PER_HOUR`, `CODE_IP_LIMIT_PER_HOUR`, `DRIVER_APPLY_IP_LIMIT_PER_HOUR` and `CODE_CHECK_IP_LIMIT`.
- **Real visitor address:** Render's edge sets `True-Client-IP`, which the API uses for limits and sign-in logs; `X-Forwarded-For` is never trusted. Keep `TRUST_EDGE_IP_HEADERS=true` on Render.
- **API:** browser safety headers and `Cache-Control: no-store` on every answer, a 6 MB request cap, and the `/docs` page off in production (`API_DOCS_ENABLED=true` turns it on).
- **Dependencies:** `.github/dependabot.yml` checks weekly; switch on *Dependabot alerts* and *security updates* under the repository's Settings → Code security.
  - `frontend/package.json` `overrides` pin `minimatch` 11 (fixes GHSA-g3hv-75wg-m249) with `glob` 14 (glob 11 can't match files with minimatch 11, which would empty the offline cache). Remove them once `workbox-build` and `eslint` ship these versions themselves. After any change here, check `npm run build` still reports about 52 precache entries.
  - `deepmerge` 4.3.1 (CVE-2026-93753) has no fixed release yet; it runs only inside the build tool on its own settings, never in the app, so the alert can be dismissed as "vulnerable code not used" until a fix ships.

## Running in production
- **Error alerts (optional):** set `SENTRY_DSN` from a free Sentry project to be emailed when the API crashes. No personal data is sent.
- **Uptime:** add a free monitor (e.g. UptimeRobot) on `https://<api>/health` every 5 minutes. On Render's free plan this also stops the API from sleeping.
- **Backups:** Render's paid Postgres plans take daily backups with point-in-time recovery; free databases have no backups and expire, so move to a paid database before real money flows. Before big changes, download a backup from the database's *Recovery* page.

## Atọ́nà assistant
Atọ́nà is EkiMove's chat guide, available to everyone on the homepage and on every passenger and driver screen. It opens from a floating button: a pill in the corner on laptops, and a round button above the tab bar on phones and small tablets. On phones the button can be dragged up or down either edge (it snaps to the nearest side and remembers the spot), hides while someone types in a form, and steps aside, to the other side or tucked into the screen edge, when it would cover a small control such as a password eye icon. It chats naturally in English or Nigerian Pidgin, and answers EkiMove questions from live data through tools instead of guessing:

- **Places and fares:** quotes the approved fare for an exact route and shows a "Trip ready" card that opens Book a ride prefilled.
- **Your rides:** a passenger's latest rides with status, driver and plate; a driver's trips and approval status. Guests are asked to sign in, with buttons in the chat.
- **Payments and support:** how to pay, plus the bank details and contacts from the business settings above.
- **Map lookups (optional):** with `GEOAPIFY_API_KEY`, it can check landmarks and estimate driving distance and time.

It only talks about EkiMove (rides, deliveries, loads, places, routes, fares, payments, accounts, support and policies, plus greetings); anything else gets a fixed reply pointing back to trips. Clear attempts to misuse it ("ignore your instructions", "write a poem/code", homework, "pretend you are…") are answered with that reply without calling the AI at all. It never books rides, assigns drivers or confirms payments. To switch it on, set `ATONA_ENABLED=true` and `GROQ_API_KEY`; the chat button stays hidden until both are set (`GET /api/v1/atona/status`). The model is GPT OSS 120B (`GROQ_MODEL=openai/gpt-oss-120b`, the default), which works on Groq's free plan (no card; about 30 requests and 8,000 tokens a minute, 1,000 requests a day). For regular passenger use, switch the Groq account to the pay-as-you-go Developer plan: about $0.15 per million input and $0.60 per million output tokens, roughly ₦1 a message. If `GROQ_MODEL` is set in Render to an older Llama model, delete it: Groq made Llama enterprise-only on 26 August 2026. When the per-minute allowance runs out, Atọ́nà asks people to try again in a minute. Messages are rate-limited per account and per guest IP (`ATONA_*_MESSAGE_LIMIT`), using Redis when configured.

## Installable app (PWA)
The frontend is a Progressive Web App: people can add EkiMove to their phone's home screen and it opens full screen like a native app.

- **Android / Chrome:** an "Install app" card appears on the homepage and passenger home; the browser menu also offers *Install app*.
- **iPhone / Safari:** the card explains *Share → Add to Home Screen*.
- The service worker (built by `vite-plugin-pwa`) caches only the app itself, so it opens instantly and works on a weak connection. Ride, fare and payment data always come live from the API and are never cached. New releases install in the background and apply on the next launch.
- PWAs need HTTPS (Render provides it). Icons live in `frontend/public/brand/`.

## Custom domain (ekimove.com.ng)
**Live since 3 November 2026.** Bought from Truehost; DNS is managed at Cloudflare (free plan, nameservers `elle` and `yisroel.ns.cloudflare.com`).

| DNS record | Points to | Serves |
| --- | --- | --- |
| `@` (CNAME on Cloudflare, or A `216.24.57.1` elsewhere) | `ekimove.onrender.com` | the app, ekimove.com.ng |
| CNAME `www` | `ekimove.onrender.com` | www.ekimove.com.ng |
| CNAME `api` | `ekimove-api.onrender.com` | the API, api.ekimove.com.ng |

On Cloudflare, keep these records **DNS only** (grey cloud) so Render can issue the HTTPS certificates. Remove AAAA records and any registrar forwarding or parking. In Render, add `ekimove.com.ng` and `www.ekimove.com.ng` to the static site and `api.ekimove.com.ng` to the API service (Settings → Custom Domains). Once all three show **Verified**:

1. API service → Environment: `FRONTEND_URL=https://ekimove.com.ng` (links in texts and receipts).
2. Static site → Environment: `VITE_API_BASE_URL=https://api.ekimove.com.ng`, then **Manual Deploy → Clear build cache & deploy**.
3. Paystack dashboard → Settings → API Keys & Webhooks: webhook URL `https://api.ekimove.com.ng/api/v1/payments/paystack/webhook`.
4. Uptime monitor: `https://api.ekimove.com.ng/health`.

The API already accepts requests from the new domain, and the old `onrender.com` addresses keep working, so links people already have don't break.

## Deploying the frontend on Render
The frontend is a separate Render **Static Site** (`ekimove.com.ng`, also `ekimove.onrender.com`), not part of `render.yaml`. Its settings should be:

- **Branch:** `master`, with **Auto-Deploy** on
- **Root directory:** `frontend`
- **Build command:** `npm ci && npm run build`
- **Publish directory:** `dist`
- **Environment:** `VITE_API_BASE_URL=https://api.ekimove.com.ng`
- **Redirects/Rewrites:** source `/*`, destination `/index.html`, action **Rewrite**, so links such as `/login` or `/my-rides` open directly.
- **Headers** (Settings → Headers, path `/*`): `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Strict-Transport-Security: max-age=31536000`, and `Content-Security-Policy: frame-ancestors 'none'`. These stop other sites showing EkiMove inside a frame to trick people into tapping. The full content security policy is already built into the page itself.

## Welcome messages and driver onboarding
- **Welcome on sign-up (free):** every new passenger and driver gets a welcome message in their EkiMove inbox (Support), and a branded email if they gave an email address and email is set up (Brevo's free plan allows 300 emails a day). No welcome SMS is sent, because each text costs money. The inbox conversation starts closed, so it doesn't fill the staff support queue; it reopens if the person replies.
- **Driver application:** besides name, phone, photo and vehicle, drivers must give gender, date of birth (18 or older), home address, town, an emergency contact, and tick six safety promises (documents, no alcohol or drugs, helmets or seat belts, road rules, respect, roadworthy vehicle). A driver's licence number is required for cars, minibuses, big cars, vans and dyna trucks, and optional for motorcycles and tricycles. Drivers who applied earlier are asked to complete these details on *My driver status*.
- **72-hour review:** each application gets a review deadline 72 hours after it's sent (applications already waiting when this shipped got 72 hours from deployment). Drivers see the deadline; admins get a notification for each new application, and *Admin → Drivers* lists the soonest deadline first, with overdue reviews marked. Approval or rejection (with an optional reason) reaches the driver by notification, inbox and email.
- **Inspection and orientation:** on *Admin → Drivers*, invite one driver or tick several for the same session: choose inspection, orientation or both, a date and time (Nigeria time) and a venue. Drivers get a notification, an inbox message and an email listing what to bring, and answer "I'll be there" or "I need another time" in the app. Admins mark each invitation attended, missed or cancelled. Sending a new time replaces the open invitation.

## Fare calculator
**Fare calculator** in the console (`/admin/fares`) prices every place-to-place route from its road distance: starting fare + price per km, never below a minimum, rounded (e.g. to ₦50), set per vehicle. Places need a map pin: new places get one automatically from their name when possible (Geoapify geocoding with `GEOAPIFY_API_KEY`, otherwise OpenStreetMap Nominatim, limited to 25 km around the area; marked "found automatically: check it"), the Fare calculator's **Find pins automatically** pins every place without one, and staff can tap the map or use "Use where I am now" in Places & fares. Pins placed by staff are never overwritten. Road distances come from the Geoapify route matrix when `GEOAPIFY_API_KEY` is set (measured once and stored, re-measured only when a pin moves); otherwise straight-line distance × 1.35. "Match today's prices" suggests a formula from a few routes and what they cost today. The preview shows every price before **Apply**; applied fares are ordinary route fares marked as calculated. Fares set or edited by hand are never changed unless "Replace" is ticked.

## Places not on the list (dropped pins)
When **Riders can drop a pin** is ticked in the Fare calculator, the pickup and destination search ends with "Not on the list? Drop a pin on the map". The rider taps the spot (or uses their location for pickup) and describes it ("blue gate opposite Mercy Pharmacy"); a street name is suggested from the map. The price is worked out on the server with the per-km formula from the road distance (Geoapify routing with `GEOAPIFY_API_KEY`, otherwise the straight line × 1.35). Pins must be within 8 km of an active listed place. The booking stores the pin's coordinates, so tracking, the live map and dispatch use it like a listed place. **Send a package** works the same way (for the pickup and the drop-off); the package-size extras are added to the per-km price.

## Keep me signed in
Passengers and drivers can tick **Keep me signed in on this phone** (on by default). Closing the app then doesn't sign them out: next time they see **Welcome back** and unlock with their password, or a 4–6 digit PIN they set on that phone (`app/device_sessions.py`). The phone keeps a random token; only its hash is stored. A PIN works only with that phone's token; five wrong tries forget the phone; changing or resetting the password, signing out, or suspension ends remembered phones; they expire after 60 days unused. The inactivity timeout locks to the same screen. Staff accounts always sign in fully.

## In-app calls
During a trip (from driver assignment until it ends), the passenger and driver can call each other with **Call driver** / **Call passenger**, next to the trip chat. Calls use WebRTC: the audio goes directly between the two phones, numbers stay private, and nothing is recorded. The API (`app/calls.py`) only passes the connection details between the phones and deletes them when the call ends; it keeps who called, when and for how long (shown in the admin trip record and in "Download my data"). Unanswered calls ring for 45 seconds (`CALL_RING_SECONDS`), calls end after 30 minutes (`CALL_MAX_MINUTES`), and `CALLS_ENABLED=false` switches calls off. The other phone is notified by push even if EkiMove is closed, re-sent every 5 seconds while it rings (`CALL_RING_REPEAT_SECONDS`) so it keeps sounding and vibrating; chat messages also arrive as notifications. Both need notifications turned on (the app shows a prompt until they are).

Most networks connect directly. Some Nigerian mobile networks block direct connections, so add a relay: Cloudflare dashboard → **Realtime** → **TURN Server** → **Create**, then set `CLOUDFLARE_TURN_KEY_ID` and `CLOUDFLARE_TURN_API_TOKEN` on the API (keep the token secret). The first 1,000 GB a month is free, then $0.05/GB; a voice call uses roughly 0.5–1 MB a minute.

## Launch checklist
**Launch checklist** in the console (`/admin/launch`) checks production settings, messaging, payments, support contacts, website, places, fares, drivers and calls, and says what to do for each gap. It only reports whether a setting is present; keys are never shown.

## Search engines and link previews (SEO)
The public pages are `/`, `/fares`, `/faq`, `/areas/<name>` (for example `/areas/eksu-iworoko`), `/driver/apply` and `/policies`. Their search titles, descriptions, area pages and FAQ are edited by the super-admin under **SEO & website** in the console (`/admin/website`). Starting text is in `app/site_defaults.json` (kept identical to `frontend/src/content/siteDefaults.json`; a test checks this).

`npm run build` runs `scripts/prerender.mjs` after Vite. It reads `GET /api/v1/public/site` (from `VITE_API_BASE_URL`) and writes a ready-made HTML file for each public page with its own title, description, link-preview image (`public/brand/ekimove-share.png`), canonical address and Google structured data (business, FAQ, service areas), plus `sitemap.xml` and `robots.txt`. If the API can't be reached, it uses the starting text and the build still succeeds. App screens are marked `noindex`.

**Publish to website** rebuilds the static site through its Deploy Hook. To turn it on: Render → the static site → Settings → **Deploy Hook** → copy it, then on the `ekimove-api` service add the environment variable `RENDER_DEPLOY_HOOK_URL` with that value. Keep it secret (anyone with it can trigger rebuilds).

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
