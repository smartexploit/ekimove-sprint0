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

    # Redis connection settings for shared login rate limiting
    redis_url: str | None = None
    redis_host: str | None = None
    redis_port: int = 6379
    redis_username: str | None = None
    redis_password: str | None = None
    redis_ssl: bool = True

    # Atọ́nà AI booking assistant
    groq_api_key: str | None = None
    groq_model: str = "llama-3.3-70b-versatile"
    atona_enabled: bool = False
    # Messages allowed per rolling window, per signed-in account or per
    # guest IP address. Protects the paid AI service from abuse.
    atona_user_message_limit: int = 40
    atona_guest_message_limit: int = 20
    atona_rate_limit_window_seconds: int = 600
    # Optional map and geocoding provider; disabled without a key.
    geoapify_api_key: str | None = None

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

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
