from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """All configuration comes from environment variables (or a local .env file).

    Secrets are never hard-coded. Defaults are only safe for local development.
    """

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: str = "development"  # development | staging | production
    database_url: str = "sqlite:///./wispex_dev.db"

    # Auth
    jwt_secret: str = "dev-only-change-me-dev-only-change-me"
    jwt_expire_minutes: int = 60 * 12
    cookie_secure: bool = False  # must be True in production (HTTPS)

    # CORS: only needed if the frontend calls the API directly (not through the Next.js proxy)
    cors_origins: str = "http://localhost:3000"

    # Encryption key (Fernet) for OAuth tokens at rest
    encryption_key: str = ""

    # Google Calendar (optional, integration is disabled when empty)
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = ""
    frontend_url: str = "http://localhost:3000"

    # Demo mode can be switched off in production
    demo_mode_enabled: bool = True

    # Placeholders for later MVP phases. Not used in MVP 1.
    ai_provider: str = ""
    ai_api_key: str = ""
    supabase_url: str = ""
    supabase_service_role_key: str = ""

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def google_calendar_configured(self) -> bool:
        return bool(self.google_client_id and self.google_client_secret and self.google_redirect_uri)


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    if settings.is_production:
        if settings.jwt_secret.startswith("dev-only"):
            raise RuntimeError("JWT_SECRET must be set in production")
        if not settings.cookie_secure:
            raise RuntimeError("COOKIE_SECURE must be true in production")
    return settings
