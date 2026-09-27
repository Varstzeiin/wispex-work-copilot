"""Readiness checks for hosting platforms and a clear warning for settings that lose data."""

import logging

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.database import IS_SQLITE

logger = logging.getLogger("wispex.readiness")


def config_warnings(settings: Settings) -> list[str]:
    """Settings that work, but lose data or features on typical cloud hosts."""
    warnings = []
    if not settings.is_production:
        return warnings
    if IS_SQLITE:
        warnings.append(
            "The database is SQLite on this server's disk. On most hosts (Render, Railway, Cloud Run) that disk "
            "is wiped on every restart or deploy, so accounts and tasks disappear. Set DATABASE_URL to PostgreSQL "
            "(for example Supabase)."
        )
    if settings.storage_backend == "local":
        warnings.append(
            "Uploaded documents are stored on this server's disk and are lost on restart on most hosts. "
            "Set STORAGE_BACKEND=database (encrypted, in PostgreSQL) or STORAGE_BACKEND=supabase "
            "with a private Supabase Storage bucket."
        )
    return warnings


def log_config_warnings(settings: Settings) -> None:
    for warning in config_warnings(settings):
        logger.warning("CONFIGURATION: %s", warning)


# Known connection failures, matched on the driver's message. Only these fixed hints are shown,
# never the message itself (it can contain the host and user name).
_DATABASE_HINTS = (
    ("tenant or user not found", "The pooler host or the user name in DATABASE_URL is wrong."),
    ("password authentication failed", "The password in DATABASE_URL is wrong."),
    ("could not translate host name", "The host in DATABASE_URL does not exist."),
    ("name or service not known", "The host in DATABASE_URL does not exist."),
    ("timeout", "The database did not answer in time. Check the host and port in DATABASE_URL."),
    ("timed out", "The database did not answer in time. Check the host and port in DATABASE_URL."),
    ("connection refused", "The database refused the connection. Check the host and port in DATABASE_URL."),
    ("permission denied", "The database user lacks permission on its schema."),
)


def database_hint(exc: Exception) -> str:
    message = str(exc).lower()
    for needle, hint in _DATABASE_HINTS:
        if needle in message:
            return hint
    return f"Database error ({type(exc).__name__})."


def readiness(db: Session, settings: Settings) -> tuple[bool, dict]:
    """Is the app able to serve users right now? Used as the health check on the hosting platform."""
    problem = ""
    try:
        db.execute(text("SELECT 1"))
        database_ok = True
    except Exception as exc:  # the message may contain connection details, so only the type is logged
        logger.error("Database check failed: %s", type(exc).__name__)
        database_ok = False
        problem = database_hint(exc)
    from app.ai import embeddings  # local import: keeps start-up order simple

    body = {
        "status": "ready" if database_ok else "unavailable",
        "database": {"kind": "sqlite" if IS_SQLITE else "postgresql", "ok": database_ok, "problem": problem},
        "storage": settings.storage_backend,
        "semantic_search": embeddings.status(),
        "warnings": config_warnings(settings),
    }
    return database_ok, body
