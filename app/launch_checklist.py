"""Launch checklist for the operations console.

Shows the super-admin, in plain words, what is ready for real riders and
what still needs doing. It reports only whether a setting is present and
sensible; it never returns keys, tokens or passwords.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import require_super_admin
from app.calls import relay_configured
from app.config import settings
from app.database import get_db
from app.models import AppSetting, Driver, Place, PlaceFare, ServiceArea, User, Vehicle
from app.push import _stored_keys
from app.site_content import CONTENT_KEY, PUBLISHED_KEY, _hook_configured

router = APIRouter(prefix="/api/v1", tags=["launch checklist"])

OK, WARN, FAIL, MANUAL = "ok", "warn", "fail", "manual"


def _item(group: str, key: str, label: str, status: str, detail: str, fix: str = "") -> dict:
    return {"group": group, "key": key, "label": label, "status": status, "detail": detail,
            "fix": fix if status != OK else ""}


def _count(db: Session, query) -> int:
    return db.scalar(query) or 0


def checklist(db: Session) -> list[dict]:
    items: list[dict] = []
    add = items.append
    production = settings.app_env.lower() == "production"
    db_url = settings.database_url.lower()

    # ---- Server and security
    g = "Server and security"
    add(_item(g, "production", "Production mode", OK if production else FAIL,
              "APP_ENV is production." if production else f"APP_ENV is “{settings.app_env}”.",
              "On the ekimove-api service, set APP_ENV=production."))
    postgres = db_url.startswith(("postgres", "postgresql"))
    add(_item(g, "database", "Database", OK if postgres else FAIL,
              "PostgreSQL is connected." if postgres else "The API is using a local SQLite file, which is lost on "
                                                          "every deploy.",
              "Create a Render PostgreSQL database and set DATABASE_URL on the API."))
    add(_item(g, "database_plan", "Database plan and backups", MANUAL,
              "Render's free database is deleted after 30 days and has no backups.",
              "Upgrade the database to a paid plan (Basic, about $6/month) before launch so it keeps your data and "
              "takes daily backups."))
    add(_item(g, "server_plan", "Always-on API server", MANUAL,
              "On the free plan the API sleeps after 15 minutes, so the first booking can take up to a minute.",
              "Upgrade ekimove-api to the Starter plan (about $7/month) so riders never wait for it to wake up."))
    secret = settings.jwt_secret_key or ""
    add(_item(g, "jwt", "Sign-in secret", OK if len(secret) >= 32 else FAIL,
              "A strong sign-in secret is set." if len(secret) >= 32 else "The sign-in secret is missing or too short.",
              "Set JWT_SECRET_KEY to a long random value (Render can generate one)."))
    redis = bool(settings.redis_url or settings.redis_host)
    add(_item(g, "redis", "Shared rate limits (Redis)", OK if redis else WARN,
              "Redis is connected for sign-in and abuse limits." if redis else "Limits are kept in the server's "
                                                                              "memory and reset on every restart.",
              "Create a free Render Key Value (Redis) instance and set REDIS_URL on the API."))
    add(_item(g, "sentry", "Error alerts", OK if settings.sentry_dsn else WARN,
              "Sentry will email you when the API has an error." if settings.sentry_dsn
              else "You won't hear about errors unless someone reports them.",
              "Create a free Sentry project and set SENTRY_DSN on the API."))
    https = settings.frontend_url.startswith("https://")
    add(_item(g, "frontend_url", "Website address", OK if https else WARN,
              f"Links in texts and emails use {settings.frontend_url}.",
              "Set FRONTEND_URL=https://ekimove.com.ng on the API."))

    # ---- Messages
    g = "Texts, emails and notifications"
    sms_key = {"bulksmsnigeria": settings.bulksms_api_token, "termii": settings.termii_api_key}.get(
        (settings.sms_provider or "").lower())
    add(_item(g, "sms", "Text messages (SMS)", OK if sms_key else FAIL,
              f"Codes are sent by text through {settings.sms_provider}." if sms_key
              else "Sign-up and reset codes can't be sent by text yet.",
              "Fund a BulkSMS Nigeria (or Termii) account, then set SMS_PROVIDER and its API token on the API."))
    add(_item(g, "sms_sender", "SMS sender name", MANUAL,
              f"Texts are sent as “{settings.sms_sender_id}”. Nigerian networks only deliver this name once it is "
              "registered, which can take a few days.",
              "Register the sender ID with your SMS provider (usually needs CAC documents) before launch."))
    email = settings.email_provider and settings.email_from_address and (
        settings.brevo_api_key if (settings.email_provider or "").lower() == "brevo" else settings.smtp_host)
    add(_item(g, "email", "Emails", OK if email else WARN,
              f"Emails are sent from {settings.email_from_address}." if email
              else "Email codes and receipts are switched off.",
              "Set EMAIL_PROVIDER=brevo, BREVO_API_KEY and EMAIL_FROM_ADDRESS=hello@ekimove.com.ng on the API."))
    public, private = _stored_keys(db)
    push = settings.push_enabled and public and private
    add(_item(g, "push", "Phone notifications", OK if push else WARN,
              "Phone notifications are ready." if push else "Notification keys are created when the first person "
                                                            "turns notifications on.",
              "Turn on notifications on your own phone from Profile to create the keys."))

    # ---- Payments
    g = "Payments and payouts"
    key = settings.paystack_secret_key or ""
    if key.startswith("sk_live_"):
        status, detail = OK, "Paystack is in live mode."
    elif key.startswith("sk_test_"):
        status, detail = WARN, "Paystack is in test mode, so no real money moves."
    else:
        status, detail = FAIL, "Paystack isn't connected."
    add(_item(g, "paystack", "Paystack", status, detail,
              "Finish Paystack business verification, then set PAYSTACK_SECRET_KEY to your sk_live_ key and add the "
              "webhook address in Paystack."))
    accounts = bool(key) and settings.paystack_virtual_accounts_enabled
    add(_item(g, "virtual_accounts", "Personal account numbers", OK if accounts else WARN,
              "Passengers get their own account number for instant transfers." if accounts
              else "Passengers pay by transfer to the business account and staff confirm it.",
              "Ask Paystack to enable Dedicated Virtual Accounts, then set PAYSTACK_VIRTUAL_ACCOUNTS_ENABLED=true."))
    bank = bool(settings.bank_transfer_account_number and settings.bank_transfer_account_name
                and settings.bank_transfer_bank_name)
    add(_item(g, "bank", "Business bank account", OK if bank else WARN,
              f"Manual transfers go to {settings.bank_transfer_bank_name}." if bank
              else "No bank account is shown for manual transfers.",
              "Set BANK_TRANSFER_BANK_NAME, BANK_TRANSFER_ACCOUNT_NUMBER and BANK_TRANSFER_ACCOUNT_NAME (use the "
              "business account, not a personal one)."))
    add(_item(g, "payouts", "Automatic driver payouts", OK if settings.paystack_transfers_enabled and
              settings.payout_cron_token else WARN,
              "Drivers are paid automatically every day." if settings.paystack_transfers_enabled
              and settings.payout_cron_token else "Driver payouts are queued for staff to send by hand.",
              "Enable Paystack Transfers (with OTP off), set PAYSTACK_TRANSFERS_ENABLED=true and PAYOUT_CRON_TOKEN, "
              "and create the daily Render Cron Job."))

    # ---- Support and website
    g = "Support and website"
    contacts = [c for c in (settings.support_phone, settings.support_email, settings.support_whatsapp) if c]
    add(_item(g, "support", "Support contacts", OK if len(contacts) >= 2 else (WARN if contacts else FAIL),
              f"{len(contacts)} of 3 support channels are shown (phone, email, WhatsApp).",
              "Set SUPPORT_PHONE, SUPPORT_EMAIL=support@ekimove.com.ng and SUPPORT_WHATSAPP on the API."))
    saved = db.get(AppSetting, CONTENT_KEY) is not None
    published = db.get(AppSetting, PUBLISHED_KEY) is not None
    add(_item(g, "website", "Website text", OK if saved and published else WARN,
              "Website text has been reviewed and published." if saved and published
              else "The website still uses the starting text, or changes haven't been published.",
              "Open SEO & website, check every page, Save, then Publish to website."))
    add(_item(g, "publish", "Publish button", OK if _hook_configured() else WARN,
              "Publishing to the website works." if _hook_configured() else "Publishing isn't set up.",
              "Copy the static site's Deploy Hook into RENDER_DEPLOY_HOOK_URL on the API."))
    add(_item(g, "google", "Google Business Profile", MANUAL,
              "Verified profiles appear on Google Maps.",
              "Check business.google.com shows the profile as verified, and add real photos."))

    # ---- Service
    g = "Places, fares and drivers"
    areas = _count(db, select(func.count(ServiceArea.id)).where(ServiceArea.status == "active"))
    places = _count(db, select(func.count(Place.id)).where(Place.status == "active"))
    fares = _count(db, select(func.count(PlaceFare.id)).where(PlaceFare.is_active.is_(True)))
    add(_item(g, "areas", "Service area", OK if areas else FAIL, f"{areas} active service area(s).",
              "Add the service area in Places & fares."))
    add(_item(g, "places", "Pickup and drop-off places", OK if places >= 10 else (WARN if places >= 2 else FAIL),
              f"{places} active places.", "Add the places people use most (at least 10) in Places & fares."))
    unpinned = _count(db, select(func.count(Place.id)).where(Place.status == "active",
                                                            (Place.latitude.is_(None)) | (Place.longitude.is_(None))))
    add(_item(g, "pins", "Map pins", OK if places and not unpinned else WARN,
              f"{places - unpinned} of {places} active places have a map pin.",
              "Add a map pin to every place in Places & fares, so the Fare calculator can price its routes."))
    add(_item(g, "fares", "Fares", OK if fares >= 20 else (WARN if fares else FAIL), f"{fares} active fares.",
              "Price every route at once in Fare calculator."))
    drivers = _count(db, select(func.count(func.distinct(Driver.id)))
                     .join(User, User.id == Driver.user_id)
                     .join(Vehicle, Vehicle.driver_id == Driver.id)
                     .where(Driver.verification_status == "approved", User.is_active.is_(True),
                            Vehicle.is_approved.is_(True)))
    add(_item(g, "drivers", "Verified drivers", OK if drivers >= 5 else (WARN if drivers else FAIL),
              f"{drivers} verified driver(s) with an approved vehicle.",
              "Verify at least 5 drivers so riders aren't left waiting (Driver verification)."))
    online = _count(db, select(func.count(Driver.id)).where(Driver.is_online.is_(True)))
    add(_item(g, "online", "Drivers online now", OK if online else WARN, f"{online} driver(s) online right now.",
              "Ask drivers to open EkiMove and go online during pilot hours."))
    admins = _count(db, select(func.count(User.id)).where(User.role == "super_admin", User.is_active.is_(True)))
    add(_item(g, "admins", "Console accounts", OK if admins >= 2 else WARN,
              f"{admins} super-admin account(s).",
              "Add a second trusted super-admin, so someone can still run the console if you're unavailable."))

    # ---- In-app features
    g = "Calls and assistant"
    add(_item(g, "calls", "In-app calls", OK if settings.calls_enabled else WARN,
              "Passengers and drivers can call each other in the app." if settings.calls_enabled
              else "In-app calls are switched off.", "Set CALLS_ENABLED=true on the API."))
    add(_item(g, "relay", "Call relay (works on every network)", OK if relay_configured() else WARN,
              "Calls connect even on networks that block direct connections." if relay_configured()
              else "Some calls may fail to connect on mobile networks that block direct connections.",
              "Create a free Cloudflare TURN key and set CLOUDFLARE_TURN_KEY_ID and CLOUDFLARE_TURN_API_TOKEN."))
    atona = settings.atona_enabled and settings.groq_api_key
    add(_item(g, "atona", "Atọ́nà assistant", OK if atona else WARN,
              "Atọ́nà is answering questions." if atona else "Atọ́nà is switched off.",
              "Set ATONA_ENABLED=true and GROQ_API_KEY on the API."))
    return items


@router.get("/admin/launch-checklist")
def launch_checklist(db: Session = Depends(get_db), _admin: User = Depends(require_super_admin)) -> dict:
    items = checklist(db)
    counts = {status: sum(1 for i in items if i["status"] == status) for status in (OK, WARN, FAIL, MANUAL)}
    return {"ready": counts[FAIL] == 0, "counts": counts, "items": items}
