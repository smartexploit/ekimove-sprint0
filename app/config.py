from pydantic import field_validator

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "EkiMove API"
    app_env: str = "development"
    database_url: str = "sqlite:///./ekimove_dev.db"
    jwt_secret_key: str | None = None
    access_token_expire_minutes: int = 15
    login_rate_limit_attempts: int = 5
    login_rate_limit_window_seconds: int = 900
    # Failed sign-ins allowed from one IP address in the same window. Higher
    # than the per-account limit because mobile networks share addresses.
    login_ip_rate_limit_attempts: int = 30
    # New accounts, code requests (texts/emails) and driver applications
    # allowed from one IP address per hour, and code checks per 15 minutes.
    signup_ip_limit_per_hour: int = 10
    code_ip_limit_per_hour: int = 10
    driver_apply_ip_limit_per_hour: int = 5
    code_check_ip_limit: int = 30
    # Read the visitor's address from the header Render's edge sets
    # (True-Client-IP / CF-Connecting-IP). Keep on when hosted on Render.
    trust_edge_ip_headers: bool = True
    # Interactive API docs (/docs). Off in production unless switched on.
    api_docs_enabled: bool | None = None
    # Largest request body accepted, in bytes (driver photos are up to 5 MB).
    max_request_bytes: int = 6 * 1024 * 1024

    # Redis connection settings for shared login rate limiting
    redis_url: str | None = None
    redis_host: str | None = None
    redis_port: int = 6379
    redis_username: str | None = None
    redis_password: str | None = None
    redis_ssl: bool = True

    # Atọ́nà AI booking assistant
    groq_api_key: str | None = None
    # GPT OSS 120B: open to every Groq account, including the free plan.
    # (Groq made the Llama models enterprise-only on 26 August 2026.)
    groq_model: str = "openai/gpt-oss-120b"
    atona_enabled: bool = False
    # Messages allowed per rolling window, per signed-in account or per
    # guest IP address. Protects the paid AI service from abuse.
    atona_user_message_limit: int = 40
    atona_guest_message_limit: int = 20
    atona_rate_limit_window_seconds: int = 600
    # Optional map and geocoding provider; disabled without a key.
    geoapify_api_key: str | None = None
    # Find map pins for new places automatically from their names
    # (Geoapify when its key is set, otherwise OpenStreetMap Nominatim).
    geocoding_enabled: bool = True

    @field_validator("geoapify_api_key", mode="before")
    @classmethod
    def clean_geoapify_api_key(cls, value):
        if value is None:
            return None
        cleaned = str(value).strip()
        return cleaned or None

    # Business details shown to passengers. Leave blank until confirmed;
    # the app shows "not yet available" instead of placeholder values.
    bank_transfer_bank_name: str | None = None
    bank_transfer_account_number: str | None = None
    bank_transfer_account_name: str | None = None
    support_phone: str | None = None
    support_email: str | None = None
    support_whatsapp: str | None = None

    @field_validator(
        "bank_transfer_bank_name",
        "bank_transfer_account_number",
        "bank_transfer_account_name",
        "support_phone",
        "support_email",
        "support_whatsapp",
        mode="before",
    )
    @classmethod
    def clean_business_detail(cls, value):
        if value is None:
            return None
        cleaned = str(value).strip()
        return cleaned or None

    # Interswitch Web Checkout. TEST is the safe default.
    # Card checkout is off until EkiMove has a live Interswitch merchant account.
    interswitch_enabled: bool = False
    interswitch_merchant_code: str | None = None
    interswitch_pay_item_id: str | None = None
    interswitch_mode: str = "TEST"
    interswitch_requery_base_url: str = "https://sandbox.interswitchng.com/collections/api/v1/gettransaction.json"
    interswitch_live_requery_base_url: str = "https://webpay.interswitchng.com/collections/api/v1/gettransaction.json"

    # Paystack dedicated virtual accounts: every passenger gets a personal
    # account number, and transfers to it confirm payments automatically
    # through a signed webhook. Disabled until the secret key is set.
    paystack_secret_key: str | None = None
    paystack_base_url: str = "https://api.paystack.co"
    # "wema-bank" or "titan-paystack" live; "test-bank" with test keys.
    paystack_preferred_bank: str = "wema-bank"
    # Personal account numbers need Paystack to enable Dedicated Virtual
    # Accounts for the business. Set false until they have; the Paystack
    # key keeps working for webhooks and driver payouts.
    paystack_virtual_accounts_enabled: bool = True
    # Paystack customers need an email; passengers sign up with a phone
    # number, so a stable per-account address on this domain is used.
    paystack_customer_email_domain: str = "passengers.ekimove.app"

    @field_validator("paystack_secret_key", mode="before")
    @classmethod
    def clean_paystack_secret_key(cls, value):
        if value is None:
            return None
        cleaned = str(value).strip()
        return cleaned or None

    # Cancellation policy. Cancelling is free before a driver is assigned
    # and for this many seconds after; later cancellations of a paid ride
    # keep a fee for the driver's time and refund the rest.
    cancellation_free_seconds: int = 120
    cancellation_fee_motorcycle: int = 200
    cancellation_fee_car: int = 500

    # Driver earnings. EkiMove keeps this percentage of every fare (and of
    # cancellation fees); the rest is credited to the driver's balance.
    commission_percent: float = 10.0
    # Balances below this are carried to the next payout run.
    payout_minimum: int = 500
    # Send payouts automatically with Paystack Transfers (needs
    # PAYSTACK_SECRET_KEY and transfers enabled, with OTP turned off, on the
    # Paystack account). When off, payouts are queued for staff to send.
    paystack_transfers_enabled: bool = False
    # Secret for the scheduled daily payout job (Render Cron Job). The
    # internal endpoint is disabled while this is empty.
    payout_cron_token: str | None = None

    @field_validator("payout_cron_token", mode="before")
    @classmethod
    def clean_payout_cron_token(cls, value):
        if value is None:
            return None
        cleaned = str(value).strip()
        return cleaned or None

    # Text messages (SMS) for sign-up codes and password resets.
    # sms_provider: "bulksmsnigeria" (recommended, cheapest) or "termii".
    # Codes are switched off until a provider and its key are set.
    sms_provider: str | None = None
    sms_sender_id: str = "EkiMove"
    bulksms_api_token: str | None = None
    bulksms_api_url: str = "https://www.bulksmsnigeria.com/api/v1/sms/create"
    termii_api_key: str | None = None
    termii_base_url: str = "https://api.ng.termii.com"
    # Most code texts sent in any 24 hours (caps cost if sign-up is abused).
    sms_daily_limit: int = 300

    # Email for codes. "brevo" uses Brevo's web API (works on Render's
    # free plan, which blocks SMTP); "smtp" uses any SMTP server.
    email_provider: str | None = None
    email_from_address: str | None = None
    email_from_name: str = "EkiMove"
    brevo_api_key: str | None = None
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_use_ssl: bool = False

    # Phone push notifications. Keys are created automatically and kept
    # in the database; set these only to supply your own pair.
    push_enabled: bool = True
    vapid_public_key: str | None = None
    vapid_private_key: str | None = None
    vapid_subject: str | None = None

    # Public address of the app, used in links sent by text (e.g. a
    # delivery's tracking link). Render sets FRONTEND_URL too.
    frontend_url: str = "https://ekimove.com.ng"
    # Team accounts must use an email address on this domain.
    staff_email_domain: str = "ekimove.com.ng"

    # The static site's Render Deploy Hook (Render > ekimove static site >
    # Settings > Deploy Hook). "Publish to website" in the console calls it
    # so the public pages are rebuilt with the latest text. Keep it secret.
    render_deploy_hook_url: str | None = None

    # In-app voice calls between a passenger and their driver (WebRTC).
    # Calls work without a relay on most networks; for networks that block
    # direct connections, add a free Cloudflare TURN key (Cloudflare >
    # Realtime > TURN Server) as CLOUDFLARE_TURN_KEY_ID and
    # CLOUDFLARE_TURN_API_TOKEN. Keep the token secret.
    calls_enabled: bool = True
    call_ring_seconds: int = 45
    # While a call rings, the phone notification is sent again this often so
    # the other phone keeps ringing/vibrating even when EkiMove is closed.
    call_ring_repeat_seconds: int = 5
    call_max_minutes: int = 30
    cloudflare_turn_key_id: str | None = None
    cloudflare_turn_api_token: str | None = None

    # Optional error monitoring with Sentry.
    sentry_dsn: str | None = None

    @field_validator(
        "sms_provider", "bulksms_api_token", "termii_api_key", "email_provider", "email_from_address",
        "brevo_api_key", "smtp_host", "smtp_username", "smtp_password", "vapid_public_key",
        "vapid_private_key", "vapid_subject", "sentry_dsn", "render_deploy_hook_url", "cloudflare_turn_key_id",
        "cloudflare_turn_api_token",
        mode="before",
    )
    @classmethod
    def clean_optional_text(cls, value):
        if value is None:
            return None
        cleaned = str(value).strip()
        return cleaned or None

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
