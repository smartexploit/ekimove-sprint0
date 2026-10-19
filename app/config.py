
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

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
