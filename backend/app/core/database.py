from datetime import datetime, timezone
from typing import Iterator

from sqlalchemy import DateTime, create_engine, event, make_url
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


def normalize_database_url(url: str) -> str:
    """Accept the URL exactly as Supabase, Render or Railway show it.

    They give `postgres://` or `postgresql://`. SQLAlchemy needs the driver name for psycopg 3.
    """
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


def engine_options(url: str) -> dict:
    """Connection settings per database. PostgreSQL settings are safe for Supabase's pooler."""
    if url.startswith("sqlite"):
        return {"connect_args": {"check_same_thread": False}}
    parsed = make_url(url)
    connect_args: dict = {
        # Supabase's pooler (port 6543, transaction mode) cannot keep prepared statements
        "prepare_threshold": None,
    }
    remote = parsed.host not in (None, "", "localhost", "127.0.0.1") and "host" not in parsed.query
    if remote and "sslmode" not in parsed.query:
        connect_args["sslmode"] = "require"  # never send data to a hosted database unencrypted
    return {
        "connect_args": connect_args,
        "pool_size": 5,
        "max_overflow": 5,
        "pool_recycle": 300,  # hosted databases close idle connections
    }


_settings = get_settings()
DATABASE_URL = normalize_database_url(_settings.database_url)
IS_SQLITE = DATABASE_URL.startswith("sqlite")
engine = create_engine(DATABASE_URL, pool_pre_ping=True, **engine_options(DATABASE_URL))

if IS_SQLITE:
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
