from datetime import datetime, timezone
from typing import Iterator

from sqlalchemy import DateTime, create_engine, event
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.types import TypeDecorator

from app.core.config import get_settings


class UTCDateTime(TypeDecorator):
    """Always store and return timezone-aware UTC datetimes.

    SQLite drops tzinfo, PostgreSQL keeps it. This keeps behaviour identical on both.
    """

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            raise ValueError("Naive datetime passed to the database. Convert to UTC first.")
        return value.astimezone(timezone.utc)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)


class Base(DeclarativeBase):
    pass


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


_settings = get_settings()
_connect_args = {"check_same_thread": False} if _settings.database_url.startswith("sqlite") else {}
engine = create_engine(_settings.database_url, connect_args=_connect_args, pool_pre_ping=True)

if _settings.database_url.startswith("sqlite"):
    # SQLite ignores ON DELETE CASCADE unless foreign keys are switched on per connection
    @event.listens_for(engine, "connect")
    def _enable_sqlite_fk(dbapi_connection, _):
        dbapi_connection.execute("PRAGMA foreign_keys=ON")

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_or_create_user_row(db: Session, model, user_id):
    """Per-user settings row, created on first use.

    New accounts get their rows at sign-up (see create_user_rows), so this only creates rows for
    accounts that existed before a feature was added. If two parallel requests both create it, the
    loser rolls back its (read-only) request transaction and uses the row the other one created.
    """
    row = db.get(model, user_id)
    if row is not None:
        return row
    row = model(user_id=user_id)
    db.add(row)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        row = db.get(model, user_id)
    return row


def create_user_rows(db: Session, user_id) -> None:
    """Settings rows every account needs, created together with the account."""
    from app.models import AssistantSettings, AutomationSettings, DocumentSettings

    db.add_all(
        [
            DocumentSettings(user_id=user_id),
            AssistantSettings(user_id=user_id),
            AutomationSettings(user_id=user_id, handled_suggestions=[]),
        ]
    )
    db.flush()


def init_db() -> None:
    # Import models so they register on Base.metadata
    from app import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
