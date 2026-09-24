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

    # Document AI (MVP 3). "anthropic" | "fake" (development/tests only) | "" (disabled)
    ai_provider: str = ""
    # Read by the Anthropic SDK. Leave empty to use ANTHROPIC_API_KEY from the environment.
    ai_api_key: str = ""
    ai_model: str = "claude-opus-5"
    ai_timeout_seconds: float = 120.0

    # File storage. "local" keeps encrypted files on disk; "supabase" uses Supabase Storage.
    storage_backend: str = "local"
    storage_dir: str = "./storage"
    max_upload_mb: int = 15
    max_pdf_pages: int = 50
    # Demo sessions per minute per client address. Raise only for automated end-to-end tests.
    demo_rate_limit_per_minute: int = 30
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    supabase_bucket: str = "documents"

    # Knowledge search by meaning (MVP 4). "local" runs a small embedding model on this server,
    # so no knowledge text leaves it. "off" keeps keyword search only.
    semantic_search: str = "local"
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    embedding_model_path: str = ""  # a pre-downloaded model folder (offline servers)
    embedding_cache_dir: str = "./models"
    semantic_min_similarity: float = 0.0  # 0 = the tested default for the chosen model

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def ai_configured(self) -> bool:
        return self.ai_provider in ("anthropic", "fake")

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
        if settings.ai_provider == "fake":
            raise RuntimeError("AI_PROVIDER=fake is for development and tests only")
    return settings
