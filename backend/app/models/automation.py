"""MVP 5 settings: permissions for client-level analysis and approved outbound integrations."""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import JSON, Boolean, ForeignKey, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, UTCDateTime


class AutomationSettings(Base):
    """Every switch here needs the user's explicit confirmation that their organization permits it."""

    __tablename__ = "automation_settings"

    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    # Patterns per named client (otherwise clients are shown anonymised)
    client_patterns_allowed: Mapped[bool] = mapped_column(Boolean, default=False)
    client_patterns_confirmed_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)
    # Sending a reviewed draft by email through the organization's SMTP server
    email_sending_allowed: Mapped[bool] = mapped_column(Boolean, default=False)
    email_confirmed_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)
    # Posting a reviewed draft to the team channel (incoming webhook)
    team_channel_allowed: Mapped[bool] = mapped_column(Boolean, default=False)
    team_channel_confirmed_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)
    # Improvement suggestions the user dismissed or already turned into a learning item
    handled_suggestions: Mapped[list] = mapped_column(JSON, default=list)
