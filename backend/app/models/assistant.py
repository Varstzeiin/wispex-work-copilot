"""MVP 4 models: personal knowledge base, clarifications, message drafts and assistant settings.

Everything here is the employee's own working record. Nothing is sent to anyone automatically.
"""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import JSON, Boolean, ForeignKey, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, UTCDateTime, utcnow

KNOWLEDGE_CATEGORIES = (
    "TRAINING",
    "SOP_REFERENCE",
    "DOCUMENT_EXPLANATION",
    "TERMINOLOGY",
    "RESOLVED_QUESTION",
    "LESSON",
    "COMMON_MISTAKE",
    "PROCEDURE",
    "SENIOR_NOTE",
)


class KnowledgeNote(Base):
    """One entry in the personal knowledge base.

    `verified` means the user confirmed it against an official source or with a senior.
    Unverified notes are still searchable but are always labelled as personal notes.
    """

    __tablename__ = "knowledge_notes"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(30), default="TRAINING")
    # Where the knowledge comes from, e.g. "SOP-CUS-04 v3, section 2" or "Senior, 12 Sep"
    source_label: Mapped[str] = mapped_column(String(200), default="")
    verified: Mapped[bool] = mapped_column(Boolean, default=False)
    tags: Mapped[str] = mapped_column(String(200), default="")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)


CLARIFICATION_KINDS = ("QUESTION", "ESCALATION")
CLARIFICATION_STATUSES = ("OPEN", "ANSWERED", "CANCELLED")


class Clarification(Base):
    """A question the employee asked (or an escalation they raised) and the answer they received."""

    __tablename__ = "clarifications"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    task_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        Uuid, ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True
    )
    shipment_reference: Mapped[str] = mapped_column(String(80), default="")
    kind: Mapped[str] = mapped_column(String(12), default="QUESTION")
    field_name: Mapped[str] = mapped_column(String(120), default="")
    issue: Mapped[str] = mapped_column(Text, default="")
    evidence: Mapped[str] = mapped_column(Text, default="")
    question: Mapped[str] = mapped_column(Text)  # the final text the employee sends themselves
    asked_to: Mapped[str] = mapped_column(String(80), default="")  # a role, e.g. "Senior", "Supervisor"
    status: Mapped[str] = mapped_column(String(10), default="OPEN", index=True)
    answer: Mapped[str] = mapped_column(Text, default="")
    answered_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)
    task_issue_id: Mapped[str] = mapped_column(String(40), default="")
    knowledge_note_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        Uuid, ForeignKey("knowledge_notes.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)


DRAFT_KINDS = ("CLARIFICATION", "MISSING_DOCUMENT", "DISCREPANCY", "ESCALATION", "CORRECTION", "STATUS_UPDATE")
DRAFT_STATUSES = ("DRAFT", "SENT_MANUALLY")


class CommunicationDraft(Base):
    """A message draft. The application never sends it: the employee copies and sends it themselves."""

    __tablename__ = "communication_drafts"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    task_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        Uuid, ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True
    )
    shipment_reference: Mapped[str] = mapped_column(String(80), default="")
    kind: Mapped[str] = mapped_column(String(20))
    recipient: Mapped[str] = mapped_column(String(120), default="")
    subject: Mapped[str] = mapped_column(String(200), default="")
    body: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(15), default="DRAFT", index=True)
    sent_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)


class AssistantSettings(Base):
    """Per-user assistant settings. Separate table so existing databases need no migration."""

    __tablename__ = "assistant_settings"

    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    # The user confirms their organization permits sending notes and task text to the AI provider.
    # This is separate from document AI: the two can be governed by different policies.
    ai_assist_allowed: Mapped[bool] = mapped_column(Boolean, default=False)
    ai_assist_confirmed_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)
    # Checklist suggestions the user dismissed, so they are not suggested again
    dismissed_suggestions: Mapped[list] = mapped_column(JSON, default=list)
