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
    # Optional map and geocoding provider; disabled without a key.
    geoapify_api_key: str | None = None

    @field_validator("geoapify_api_key", mode="before")
    @classmethod
    def clean_geoapify_api_key(cls, value):
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

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
