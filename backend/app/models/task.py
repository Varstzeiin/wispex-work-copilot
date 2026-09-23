import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import JSON, ForeignKey, Integer, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base, UTCDateTime, utcnow

TASK_STATUSES = (
    "NEW",
    "IN_PROGRESS",
    "WAITING",
    "NEEDS_REVIEW",
    "ESCALATED",
    "COMPLETED",
    "ON_HOLD",
    "CANCELLED",
)
CLOSED_STATUSES = ("COMPLETED", "CANCELLED")


class Client(Base):
    __tablename__ = "clients"
    __table_args__ = (UniqueConstraint("user_id", "name"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(120))
    # Optional, entered by the user. HIGH | STANDARD | LOW
    sla_tier: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class Shipment(Base):
    __tablename__ = "shipments"
    __table_args__ = (UniqueConstraint("user_id", "reference"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    client_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        Uuid, ForeignKey("clients.id", ondelete="SET NULL"), nullable=True
    )
    reference: Mapped[str] = mapped_column(String(80))
    transport_mode: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)  # SEA | AIR
    eta: Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    client: Mapped[Optional[Client]] = relationship()


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    shipment_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        Uuid, ForeignKey("shipments.id", ondelete="SET NULL"), nullable=True
    )
    client_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        Uuid, ForeignKey("clients.id", ondelete="SET NULL"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="NEW", index=True)

    eta: Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)
    submission_deadline: Mapped[Optional[datetime]] = mapped_column(
        UTCDateTime, nullable=True, index=True
    )
    estimated_minutes: Mapped[int] = mapped_column(Integer, default=15)
    actual_minutes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Document tracking. Names like "Commercial Invoice", "Packing List", "Bill of Lading"
    required_documents: Mapped[list] = mapped_column(JSON, default=list)
    available_documents: Mapped[list] = mapped_column(JSON, default=list)
    # Known issues entered by the user: [{"id", "type", "description", "resolved"}]
    issues: Mapped[list] = mapped_column(JSON, default=list)
    assigned_action: Mapped[str] = mapped_column(String(200), default="")

    # Calculated by the backend priority engine
    priority_score: Mapped[int] = mapped_column(Integer, default=0, index=True)
    priority_level: Mapped[str] = mapped_column(String(10), default="LOW")
    priority_reasons: Mapped[list] = mapped_column(JSON, default=list)
    risk_level: Mapped[str] = mapped_column(String(10), default="LOW")

    started_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
    completed_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)

    shipment: Mapped[Optional[Shipment]] = relationship()
    client: Mapped[Optional[Client]] = relationship()

    @property
    def missing_documents(self) -> list[str]:
        available = {d.strip().lower() for d in self.available_documents or []}
        return [d for d in self.required_documents or [] if d.strip().lower() not in available]

    @property
    def document_completeness(self) -> float:
        required = self.required_documents or []
        if not required:
            return 1.0
        return round((len(required) - len(self.missing_documents)) / len(required), 2)

    @property
    def open_issues(self) -> list[dict]:
        return [i for i in self.issues or [] if not i.get("resolved")]

    @property
    def is_closed(self) -> bool:
        return self.status in CLOSED_STATUSES
