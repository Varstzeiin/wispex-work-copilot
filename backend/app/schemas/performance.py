import uuid
from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

ErrorCategory = Literal[
    "TYPOGRAPHICAL",
    "DATA_READING",
    "DATA_ENTRY",
    "MISSING_INFORMATION",
    "CROSS_DOCUMENT",
    "SOP_PROCEDURE",
    "COMMUNICATION",
    "TIME_MANAGEMENT",
    "OTHER",
]
Severity = Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
ErrorStatus = Literal["REPORTED", "NOTIFIED", "CORRECTING", "RESOLVED"]
LearningCategory = Literal["SOP", "DOCUMENT", "TERMINOLOGY", "PROCEDURE", "SYSTEM", "LESSON", "OTHER"]
LearningStatus = Literal["TO_LEARN", "LEARNING", "UNDERSTOOD", "APPLIED"]

_SHORT = 200
_LONG = 2000


# ---------- Errors ----------


class ErrorCreate(BaseModel):
    task_id: Optional[uuid.UUID] = None
    shipment_reference: str = Field(default="", max_length=80)
    field_name: str = Field(min_length=1, max_length=120)
    incorrect_value: str = Field(default="", max_length=_SHORT)
    correct_value: str = Field(default="", max_length=_SHORT)
    source_document: str = Field(default="", max_length=120)
    # Naive datetimes are interpreted in the user's profile timezone
    submitted_at: Optional[datetime] = None
    discovered_at: Optional[datetime] = None
    category: ErrorCategory
    severity: Severity = "MEDIUM"
    impact: str = Field(default="", max_length=_LONG)
    # Step 1 of the workflow: stop and verify before reporting. Validated even when omitted.
    confirm_verified: bool = Field(default=False, validate_default=True)

    @field_validator("confirm_verified")
    @classmethod
    def _verified(cls, value: bool) -> bool:
        if not value:
            raise ValueError("Confirm that you stopped and verified the error before reporting it")
        return value


class ErrorUpdate(BaseModel):
    shipment_reference: Optional[str] = Field(default=None, max_length=80)
    field_name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    incorrect_value: Optional[str] = Field(default=None, max_length=_SHORT)
    correct_value: Optional[str] = Field(default=None, max_length=_SHORT)
    source_document: Optional[str] = Field(default=None, max_length=120)
    submitted_at: Optional[datetime] = None
    discovered_at: Optional[datetime] = None
    category: Optional[ErrorCategory] = None
    severity: Optional[Severity] = None
    impact: Optional[str] = Field(default=None, max_length=_LONG)
    notified_person: Optional[str] = Field(default=None, max_length=120)
    correction_notes: Optional[str] = Field(default=None, max_length=_LONG)
    instructions: Optional[str] = Field(default=None, max_length=_LONG)
    resolution: Optional[str] = Field(default=None, max_length=_LONG)
    root_cause: Optional[ErrorCategory | Literal[""]] = None
    root_cause_notes: Optional[str] = Field(default=None, max_length=_LONG)
    prevention_action: Optional[str] = Field(default=None, max_length=_LONG)


class ErrorStatusChange(BaseModel):
    status: ErrorStatus
    # Convenience: fill the field the next step needs in the same request
    notified_person: Optional[str] = Field(default=None, max_length=120)
    correction_notes: Optional[str] = Field(default=None, max_length=_LONG)
    resolution: Optional[str] = Field(default=None, max_length=_LONG)


# ---------- Reviews ----------


class ShiftReflection(BaseModel):
    review_date: date
    went_well: str = Field(default="", max_length=_LONG)
    to_improve: str = Field(default="", max_length=_LONG)
    tomorrow_focus: str = Field(default="", max_length=_LONG)


class WeeklyReflection(BaseModel):
    week_start: date
    went_well: str = Field(default="", max_length=_LONG)
    to_improve: str = Field(default="", max_length=_LONG)
    next_week_focus: str = Field(default="", max_length=_LONG)


# ---------- Learning ----------


class LearningIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    category: LearningCategory = "OTHER"
    source: str = Field(default="", max_length=200)
    notes: str = Field(default="", max_length=_LONG)
    status: LearningStatus = "TO_LEARN"


class LearningUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    category: Optional[LearningCategory] = None
    source: Optional[str] = Field(default=None, max_length=200)
    notes: Optional[str] = Field(default=None, max_length=_LONG)
    status: Optional[LearningStatus] = None


class FeedbackIn(BaseModel):
    received_at: Optional[datetime] = None
    from_role: str = Field(default="", max_length=80)
    summary: str = Field(min_length=1, max_length=_LONG)
    action_plan: str = Field(default="", max_length=_LONG)


class FeedbackUpdate(BaseModel):
    from_role: Optional[str] = Field(default=None, max_length=80)
    summary: Optional[str] = Field(default=None, min_length=1, max_length=_LONG)
    action_plan: Optional[str] = Field(default=None, max_length=_LONG)
    applied: Optional[bool] = None
    applied_evidence: Optional[str] = Field(default=None, max_length=_LONG)


class SkillIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    level: int = Field(default=0, ge=0, le=4)
    evidence: str = Field(default="", max_length=_LONG)


class SkillUpdate(BaseModel):
    level: Optional[int] = Field(default=None, ge=0, le=4)
    evidence: Optional[str] = Field(default=None, max_length=_LONG)


# ---------- Growth ----------


class PlanUpdate(BaseModel):
    start_date: date


class GoalIn(BaseModel):
    phase: Literal[30, 60, 90]
    title: str = Field(min_length=1, max_length=200)


class GoalUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    done: Optional[bool] = None
    evidence: Optional[str] = Field(default=None, max_length=_LONG)
