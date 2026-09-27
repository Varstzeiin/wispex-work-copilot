"""Deployment support: database URLs, connection options, readiness and production checks."""

import pytest
from cryptography.fernet import Fernet

from app.core.config import Settings, get_settings
from app.core.database import engine_options, normalize_database_url
from app.core.readiness import config_warnings
from tests.conftest import make_client


def test_hosted_database_urls_are_accepted_as_shown():
    supabase = "postgresql://postgres.abc:pw@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres"
    assert normalize_database_url(supabase).startswith("postgresql+psycopg://postgres.abc:pw@")
    assert normalize_database_url("postgres://u:p@host/db") == "postgresql+psycopg://u:p@host/db"
    assert normalize_database_url("sqlite:///./x.db") == "sqlite:///./x.db"
    assert normalize_database_url("postgresql+psycopg://u@h/d") == "postgresql+psycopg://u@h/d"


def test_connection_options_for_supabase_pooler_and_ssl():
    remote = engine_options("postgresql+psycopg://u:p@db.example.supabase.co:6543/postgres")
    assert remote["connect_args"] == {"prepare_threshold": None, "sslmode": "require"}
    assert remote["pool_recycle"] == 300
    explicit = engine_options("postgresql+psycopg://u:p@db.example.com/postgres?sslmode=verify-full")
    assert "sslmode" not in explicit["connect_args"]  # an explicit choice is respected
    local = engine_options("postgresql+psycopg://postgres:postgres@localhost:5432/wispex")
    assert "sslmode" not in local["connect_args"]
    assert engine_options("sqlite:///./x.db") == {"connect_args": {"check_same_thread": False}}


def test_readiness_checks_the_database():
    r = make_client().get("/api/health/ready")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ready" and body["database"]["ok"] is True
    assert body["database"]["kind"] in ("sqlite", "postgresql")
    assert body["warnings"] == []  # not production


def test_production_warns_about_settings_that_lose_data():
    prod = Settings(app_env="production", storage_backend="local")
    warnings = config_warnings(prod)
    assert any("Uploaded documents" in w for w in warnings)
    assert config_warnings(Settings(app_env="production", storage_backend="supabase")) == [
        w for w in warnings if "SQLite" in w
    ]


def _production_env(monkeypatch, **extra):
    env = {
        "APP_ENV": "production",
        "JWT_SECRET": "a-real-secret-a-real-secret-a-real-secret",
        "COOKIE_SECURE": "true",
        "ENCRYPTION_KEY": Fernet.generate_key().decode(),
        **extra,
    }
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    get_settings.cache_clear()


def test_production_refuses_to_start_without_a_valid_encryption_key(monkeypatch):
    _production_env(monkeypatch)
    assert get_settings().is_production
    for bad in ("", "not-a-fernet-key"):
        _production_env(monkeypatch, ENCRYPTION_KEY=bad)
        with pytest.raises(RuntimeError, match="ENCRYPTION_KEY"):
            get_settings()
    _production_env(monkeypatch, JWT_SECRET="dev-only-change-me-dev-only-change-me")
    with pytest.raises(RuntimeError, match="JWT_SECRET"):
        get_settings()
    monkeypatch.setenv("APP_ENV", "test")
    get_settings.cache_clear()


def test_database_storage_keeps_files_encrypted_in_the_database():
    from app.core.database import SessionLocal
    from app.models import StoredFile
    from app.storage.backends import DatabaseEncryptedStorage, StorageError

    store = DatabaseEncryptedStorage()
    store.save("u1/d1", b"%PDF-1.4 invoice", "application/pdf")
    with SessionLocal() as db:
        assert b"invoice" not in db.get(StoredFile, "u1/d1").data  # encrypted at rest
    assert store.load("u1/d1") == b"%PDF-1.4 invoice"
    store.delete("u1/d1")
    with pytest.raises(StorageError):
        store.load("u1/d1")


def test_database_problems_are_explained_without_connection_details():
    from app.core.readiness import database_hint

    leaky = Exception('connection to server at "aws-1.pooler.example.com" failed: FATAL: Tenant or user not found')
    assert database_hint(leaky) == "The pooler host or the user name in DATABASE_URL is wrong."
    assert "pooler.example.com" not in database_hint(leaky)
    assert database_hint(ValueError("something else")) == "Database error (ValueError)."


def test_backend_root_points_to_the_health_check():
    assert make_client().get("/").json()["health"] == "/api/health/ready"


def test_vercel_dependencies_match_requirements():
    import tomllib
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    listed = {
        line.strip() for line in (root / "requirements.txt").read_text().splitlines()
        if line.strip() and not line.startswith("#")
    }
    project = tomllib.loads((root / "pyproject.toml").read_text())
    assert set(project["project"]["dependencies"]) == listed  # update both files together
    assert project["tool"]["vercel"]["entrypoint"] == "index:app"


def test_vercelignore_keeps_all_app_code():
    """An unanchored pattern like "models/" also drops app/models/ from the Vercel upload."""
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    patterns = [p.strip() for p in (root / ".vercelignore").read_text().splitlines()]
    unanchored = {p.rstrip("/") for p in patterns if p.endswith("/") and not p.startswith(("/", "#"))}
    code_dirs = {d.name for d in (root / "app").rglob("*") if d.is_dir() and d.name != "__pycache__"}
    assert not unanchored & code_dirs, f"these patterns would drop app code: {unanchored & code_dirs}"
