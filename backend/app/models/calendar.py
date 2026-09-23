import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import JSON, ForeignKey, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, UTCDateTime, utcnow


class CalendarConnection(Base):
    """OAuth connection to Google Calendar. Tokens are encrypted at rest."""

    __tablename__ = "calendar_connections"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    provider: Mapped[str] = mapped_column(String(20), default="google")
    calendar_id: Mapped[str] = mapped_column(String(255), default="primary")
    encrypted_refresh_token: Mapped[str] = mapped_column(Text, default="")
    encrypted_access_token: Mapped[str] = mapped_column(Text, default="")
    access_token_expires_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)
    oauth_state: Mapped[str] = mapped_column(String(128), default="")
    connected_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)


class CalendarEvent(Base):
    """Links a task deadline to a calendar event. One event per task (idempotent)."""

    __tablename__ = "calendar_events"
    __table_args__ = (UniqueConstraint("task_id"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    task_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("tasks.id", ondelete="CASCADE"))
    provider: Mapped[str] = mapped_column(String(20), default="ics")  # google | ics
    calendar_id: Mapped[str] = mapped_column(String(255), default="")
    external_event_id: Mapped[str] = mapped_column(String(255), default="")
    title: Mapped[str] = mapped_column(String(255))
    event_start: Mapped[datetime] = mapped_column(UTCDateTime)
    event_end: Mapped[datetime] = mapped_column(UTCDateTime)
    reminder_minutes: Mapped[list] = mapped_column(JSON, default=list)
    # SYNCED | PENDING | FAILED | LOCAL_ONLY | OUT_OF_DATE
    sync_status: Mapped[str] = mapped_column(String(20), default="LOCAL_ONLY")
    last_error: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
