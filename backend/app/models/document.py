"""MVP 3 models: uploaded documents, extracted fields, discrepancies and document settings.

Only metadata lives in the database. File bytes live in object storage (see app/storage).
"""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import JSON, Boolean, Float, ForeignKey, Integer, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base, UTCDateTime, utcnow

DOCUMENT_TYPES = ("INVOICE", "PACKING_LIST", "BILL_OF_LADING", "AIR_WAYBILL", "OTHER", "UNKNOWN")

# UPLOADED -> QUEUED -> PROCESSING -> EXTRACTED | NEEDS_REVIEW | FAILED ; VERIFIED after human review.
# AI_NOT_PERMITTED: stored, but not sent to any AI provider. Fields are entered by hand.
PROCESSING_STATUSES = (
    "UPLOADED",
    "QUEUED",
    "PROCESSING",
    "EXTRACTED",
    "NEEDS_REVIEW",
    "VERIFIED",
    "FAILED",
    "AI_NOT_PERMITTED",
)


class Document(Base):
    __tablename__ = "documents"
    __table_args__ = (UniqueConstraint("user_id", "checksum_sha256"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    task_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        Uuid, ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True, index=True
    )
    shipment_reference: Mapped[str] = mapped_column(String(80), default="", index=True)

    # Display only. Never used to build a path or to decide the file type.
    original_filename: Mapped[str] = mapped_column(String(160), default="")
    mime_type: Mapped[str] = mapped_column(String(40))  # detected from the file's bytes
    size_bytes: Mapped[int] = mapped_column(Integer)
    page_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    checksum_sha256: Mapped[str] = mapped_column(String(64), index=True)
    storage_key: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)  # None for demo records

    document_type: Mapped[str] = mapped_column(String(20), default="UNKNOWN")
    type_source: Mapped[str] = mapped_column(String(10), default="AI")  # USER | AI | HUMAN
    type_confidence: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Versions: several documents of the same type for the same shipment. The user picks the
    # one that applies. The newest is never assumed to be correct.
    is_active_version: Mapped[bool] = mapped_column(Boolean, default=True)

    processing_status: Mapped[str] = mapped_column(String(20), default="UPLOADED", index=True)
    processing_error: Mapped[str] = mapped_column(String(300), default="")
    ai_provider: Mapped[str] = mapped_column(String(30), default="")
    ai_model: Mapped[str] = mapped_column(String(60), default="")
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)

    uploaded_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    processed_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)
    verified_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)

    fields: Mapped[list["ExtractedField"]] = relationship(
        back_populates="document", cascade="all, delete-orphan", order_by="ExtractedField.position"
    )


FIELD_STATUSES = ("OK", "NEEDS_REVIEW", "VERIFIED")


class ExtractedField(Base):
    __tablename__ = "extracted_fields"
    __table_args__ = (UniqueConstraint("document_id", "name"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(40))
    position: Mapped[int] = mapped_column(Integer, default=0)
    value: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # as written on the document
    normalized: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # machine-comparable form
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    source: Mapped[str] = mapped_column(String(10), default="AI")  # AI | HUMAN
    status: Mapped[str] = mapped_column(String(15), default="NEEDS_REVIEW")
    rule_messages: Mapped[list] = mapped_column(JSON, default=list)
    evidence: Mapped[str] = mapped_column(String(300), default="")  # short location hint, never full text
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)

    document: Mapped[Document] = relationship(back_populates="fields")


DISCREPANCY_STATUSES = ("OPEN", "RESOLVED", "DISMISSED", "SUPERSEDED")


class Discrepancy(Base):
    """A potential mismatch between two documents. The system never decides which one is right."""

    __tablename__ = "discrepancies"
    __table_args__ = (UniqueConstraint("user_id", "signature"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    shipment_reference: Mapped[str] = mapped_column(String(80), index=True)
    task_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        Uuid, ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True
    )
    field: Mapped[str] = mapped_column(String(40))
    document_a_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("documents.id", ondelete="CASCADE"))
    document_b_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("documents.id", ondelete="CASCADE"))
    value_a: Mapped[str] = mapped_column(String(300), default="")
    value_b: Mapped[str] = mapped_column(String(300), default="")
    difference: Mapped[str] = mapped_column(String(120), default="")
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    potential_impact: Mapped[str] = mapped_column(Text, default="")
    recommended_action: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(12), default="OPEN", index=True)
    resolution_note: Mapped[str] = mapped_column(Text, default="")
    signature: Mapped[str] = mapped_column(String(64))
    task_issue_id: Mapped[str] = mapped_column(String(40), default="")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)


DEFAULT_FINAL_CHECKLIST = [
    "Invoice number verified",
    "Invoice date verified",
    "Currency verified",
    "Quantity verified",
    "Weight verified",
    "Value verified",
    "Packing List checked",
    "Supporting documents checked",
    "Discrepancies resolved",
    "Required clarification completed",
]


class DocumentSettings(Base):
    """Per-user document settings. Separate table so existing databases need no migration."""

    __tablename__ = "document_settings"

    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    # The user confirms their organization permits sending documents to the configured AI provider
    ai_processing_allowed: Mapped[bool] = mapped_column(Boolean, default=False)
    ai_permission_confirmed_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)
    review_threshold: Mapped[float] = mapped_column(Float, default=0.85)
    weight_tolerance_pct: Mapped[float] = mapped_column(Float, default=0.0)
    # Personal pre-completion checklist. It never replaces official SOP.
    final_checklist: Mapped[list] = mapped_column(JSON, default=lambda: list(DEFAULT_FINAL_CHECKLIST))
