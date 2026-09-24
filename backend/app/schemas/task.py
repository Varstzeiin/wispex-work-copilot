import uuid
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

TaskStatus = Literal[
    "NEW", "IN_PROGRESS", "WAITING", "NEEDS_REVIEW", "ESCALATED", "COMPLETED", "ON_HOLD", "CANCELLED"
]
IssueType = Literal[
    "QUANTITY_MISMATCH",
    "WEIGHT_MISMATCH",
    "DESCRIPTION_MISMATCH",
    "VALUE_MISMATCH",
    "MISSING_INFORMATION",
    "LOW_CONFIDENCE",
    "COMPLIANCE_QUESTION",
    "OTHER",
]
SlaTier = Literal["HIGH", "STANDARD", "LOW"]


class IssueIn(BaseModel):
    id: Optional[str] = Field(default=None, max_length=40)
    type: IssueType = "OTHER"
    description: str = Field(min_length=1, max_length=500)
    resolved: bool = False
    created_at: Optional[datetime] = None
    resolved_at: Optional[datetime] = None


def _clean_doc_list(value: list[str]) -> list[str]:
    seen, out = set(), []
    for item in value:
        name = item.strip()[:80]
        if name and name.lower() not in seen:
            seen.add(name.lower())
            out.append(name)
    return out[:20]


class TaskBase(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=4000)
    notes: str = Field(default="", max_length=4000)
    shipment_reference: Optional[str] = Field(default=None, max_length=80)
    client_name: Optional[str] = Field(default=None, max_length=120)
    client_sla_tier: Optional[SlaTier] = None
    transport_mode: Optional[Literal["SEA", "AIR"]] = None
    # Naive datetimes are interpreted in the user's profile timezone
    eta: Optional[datetime] = None
    submission_deadline: Optional[datetime] = None
    estimated_minutes: int = Field(default=15, ge=1, le=24 * 60)
    required_documents: list[str] = Field(default_factory=list)
    available_documents: list[str] = Field(default_factory=list)
    issues: list[IssueIn] = Field(default_factory=list, max_length=30)
    assigned_action: str = Field(default="", max_length=200)

    @field_validator("required_documents", "available_documents")
    @classmethod
    def _docs(cls, value):
        return _clean_doc_list(value)


class TaskCreate(TaskBase):
    status: TaskStatus = "NEW"


class TaskUpdate(BaseModel):
    """Partial update. Only fields that are sent are changed."""

    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=4000)
    notes: Optional[str] = Field(default=None, max_length=4000)
    shipment_reference: Optional[str] = Field(default=None, max_length=80)
    client_name: Optional[str] = Field(default=None, max_length=120)
    client_sla_tier: Optional[SlaTier] = None
    transport_mode: Optional[Literal["SEA", "AIR"]] = None
    eta: Optional[datetime] = None
    submission_deadline: Optional[datetime] = None
    estimated_minutes: Optional[int] = Field(default=None, ge=1, le=24 * 60)
    actual_minutes: Optional[int] = Field(default=None, ge=0, le=24 * 60)
    required_documents: Optional[list[str]] = None
    available_documents: Optional[list[str]] = None
    issues: Optional[list[IssueIn]] = Field(default=None, max_length=30)
    assigned_action: Optional[str] = Field(default=None, max_length=200)

    @field_validator("required_documents", "available_documents")
    @classmethod
    def _docs(cls, value):
        return None if value is None else _clean_doc_list(value)


class StatusChange(BaseModel):
    status: TaskStatus
    note: str = Field(default="", max_length=500)
    # Completing a task requires an explicit human confirmation
    confirm_verified: bool = False
    # Items of the personal final checklist that the user ticked
    checklist_confirmed: list[str] = Field(default_factory=list, max_length=30)


class DeadlineOut(BaseModel):
    status: str
    minutes_remaining: Optional[int]
    overdue: bool
    approaching_critical: bool
    label: str


class FactorOut(BaseModel):
    name: str
    points: float
    max_points: float
    reason: Optional[str]


class CalendarLinkOut(BaseModel):
    id: uuid.UUID
    provider: str
    sync_status: str
    event_start: datetime
    reminder_minutes: list[int] = []


class TaskOut(BaseModel):
    id: uuid.UUID
    title: str
    description: str
    notes: str
    status: str
    shipment_reference: Optional[str]
    client_name: Optional[str]
    client_sla_tier: Optional[str]
    transport_mode: Optional[str]
    eta: Optional[datetime]
    submission_deadline: Optional[datetime]
    estimated_minutes: int
    actual_minutes: Optional[int]
    required_documents: list[str]
    available_documents: list[str]
    missing_documents: list[str]
    document_completeness: float
    issues: list[dict]
    open_issue_count: int
    assigned_action: str
    priority_score: int
    priority_level: str
    priority_reasons: list[str]
    risk_level: str
    guidance: str
    guidance_reason: str
    deadline: DeadlineOut
    factors: list[FactorOut] = []
    calendar_event: Optional[CalendarLinkOut] = None
    created_at: datetime
    updated_at: datetime
    started_at: Optional[datetime]
    completed_at: Optional[datetime]


class TaskListOut(BaseModel):
    items: list[TaskOut]
    total: int
    page: int
    page_size: int
    counts: dict[str, int]
