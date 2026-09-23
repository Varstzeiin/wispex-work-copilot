"""MVP 2 models: error log, reviews, learning, feedback, skills and 30/60/90 development.

These are personal records for the employee's own improvement. They are never presented as
an official company evaluation.
"""

import uuid
from datetime import date, datetime
from typing import Optional

from sqlalchemy import JSON, Boolean, Date, ForeignKey, Integer, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, UTCDateTime, utcnow

ERROR_CATEGORIES = (
    "TYPOGRAPHICAL",
    "DATA_READING",
    "DATA_ENTRY",
    "MISSING_INFORMATION",
    "CROSS_DOCUMENT",
    "SOP_PROCEDURE",
    "COMMUNICATION",
    "TIME_MANAGEMENT",
    "OTHER",
)
ERROR_SEVERITIES = ("LOW", "MEDIUM", "HIGH", "CRITICAL")
ERROR_STATUSES = ("REPORTED", "NOTIFIED", "CORRECTING", "RESOLVED")


class ErrorReport(Base):
    """One error in already-submitted work, following the Report an Error workflow."""

    __tablename__ = "errors"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    task_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        Uuid, ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True
    )
    # Snapshot, so the report stays readable even if the task is deleted later
    shipment_reference: Mapped[str] = mapped_column(String(80), default="")

    # Steps 2-5: what exactly is wrong, and where the correct value comes from
    field_name: Mapped[str] = mapped_column(String(120))
    incorrect_value: Mapped[str] = mapped_column(String(200), default="")
    correct_value: Mapped[str] = mapped_column(String(200), default="")
    source_document: Mapped[str] = mapped_column(String(120), default="")
    submitted_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)
    discovered_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    # Step 6: impact
    category: Mapped[str] = mapped_column(String(30), index=True)
    severity: Mapped[str] = mapped_column(String(10), default="MEDIUM")
    impact: Mapped[str] = mapped_column(Text, default="")

    # Step 7: notification
    notified_person: Mapped[str] = mapped_column(String(120), default="")
    notified_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)
    # Steps 8-9: correction and instructions received
    correction_notes: Mapped[str] = mapped_column(Text, default="")
    instructions: Mapped[str] = mapped_column(Text, default="")
    # Step 10: resolution
    resolution: Mapped[str] = mapped_column(Text, default="")
    resolved_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)
    # Step 11: root-cause analysis
    root_cause: Mapped[str] = mapped_column(String(30), default="")
    root_cause_notes: Mapped[str] = mapped_column(Text, default="")
    prevention_action: Mapped[str] = mapped_column(Text, default="")

    status: Mapped[str] = mapped_column(String(12), default="REPORTED", index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)


class ShiftReview(Base):
    """End-of-shift review (daily log). Numbers are calculated; reflections are the user's."""

    __tablename__ = "shift_reviews"
    __table_args__ = (UniqueConstraint("user_id", "review_date"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    review_date: Mapped[date] = mapped_column(Date)
    stats: Mapped[dict] = mapped_column(JSON, default=dict)
    went_well: Mapped[str] = mapped_column(Text, default="")
    to_improve: Mapped[str] = mapped_column(Text, default="")
    tomorrow_focus: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)


class WeeklyReview(Base):
    __tablename__ = "weekly_reviews"
    __table_args__ = (UniqueConstraint("user_id", "week_start"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    week_start: Mapped[date] = mapped_column(Date)  # Monday, in the user's timezone
    stats: Mapped[dict] = mapped_column(JSON, default=dict)
    went_well: Mapped[str] = mapped_column(Text, default="")
    to_improve: Mapped[str] = mapped_column(Text, default="")
    next_week_focus: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)


LEARNING_CATEGORIES = ("SOP", "DOCUMENT", "TERMINOLOGY", "PROCEDURE", "SYSTEM", "LESSON", "OTHER")
LEARNING_STATUSES = ("TO_LEARN", "LEARNING", "UNDERSTOOD", "APPLIED")


class LearningItem(Base):
    __tablename__ = "learning_items"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(20), default="OTHER")
    source: Mapped[str] = mapped_column(String(200), default="")  # e.g. "Training week 1", "Senior"
    notes: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(12), default="TO_LEARN")
    understood_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)


class Feedback(Base):
    """Feedback received, and how it was applied."""

    __tablename__ = "feedback"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    received_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    from_role: Mapped[str] = mapped_column(String(80), default="")  # a role, not a person's name
    summary: Mapped[str] = mapped_column(Text)
    action_plan: Mapped[str] = mapped_column(Text, default="")
    applied: Mapped[bool] = mapped_column(Boolean, default=False)
    applied_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)
    applied_evidence: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


SKILL_LEVELS = {0: "Not yet", 1: "Aware", 2: "With guidance", 3: "Independent", 4: "Can teach others"}


class Skill(Base):
    """Skill matrix row. Self-assessed, with evidence."""

    __tablename__ = "skills"
    __table_args__ = (UniqueConstraint("user_id", "name"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    level: Mapped[int] = mapped_column(Integer, default=0)
    evidence: Mapped[str] = mapped_column(Text, default="")
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    history: Mapped[list] = mapped_column(JSON, default=list)  # [{"level", "at"}]
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)


class DevelopmentPlan(Base):
    """30 / 60 / 90 day plan. The start date is the first working day in the role."""

    __tablename__ = "development_plans"

    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    start_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class DevelopmentGoal(Base):
    __tablename__ = "development_goals"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    phase: Mapped[int] = mapped_column(Integer)  # 30, 60 or 90
    title: Mapped[str] = mapped_column(String(200))
    done: Mapped[bool] = mapped_column(Boolean, default=False)
    done_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)
    evidence: Mapped[str] = mapped_column(Text, default="")
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
