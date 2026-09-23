import secrets
import uuid
from datetime import datetime
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import utcnow
from app.models import CalendarEvent, Client, Shipment, Task, User, UserSettings
from app.rules.deadline_rules import evaluate_deadline
from app.schemas.task import StatusChange, TaskCreate, TaskUpdate
from app.services import audit_service
from app.services.priority_service import apply_priority, calculate_priority
from app.services.settings_service import get_user_settings, to_utc

# ---------- Lookups (always scoped to the user) ----------

def get_task_for_user(db: Session, user: User, task_id: uuid.UUID) -> Task:
    task = db.get(Task, task_id)
    # Same response for "missing" and "not yours" so IDs cannot be probed
    if task is None or task.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found.")
    return task


def _get_or_create_client(
    db: Session, user: User, name: Optional[str], sla_tier: Optional[str]
) -> Optional[Client]:
    if not name or not name.strip():
        return None
    name = name.strip()
    client = db.scalar(select(Client).where(Client.user_id == user.id, Client.name == name))
    if client is None:
        client = Client(user_id=user.id, name=name, sla_tier=sla_tier)
        db.add(client)
        db.flush()
    elif sla_tier is not None:
        client.sla_tier = sla_tier
    return client


def _get_or_create_shipment(
    db: Session,
    user: User,
    reference: Optional[str],
    client: Optional[Client],
    eta: Optional[datetime],
    mode: Optional[str],
) -> Optional[Shipment]:
    if not reference or not reference.strip():
        return None
    reference = reference.strip()
    shipment = db.scalar(
        select(Shipment).where(Shipment.user_id == user.id, Shipment.reference == reference)
    )
    if shipment is None:
        shipment = Shipment(user_id=user.id, reference=reference)
        db.add(shipment)
    if client is not None:
        shipment.client_id = client.id
    if eta is not None:
        shipment.eta = eta
    if mode is not None:
        shipment.transport_mode = mode
    db.flush()
    return shipment


def _normalise_issues(issues) -> list[dict]:
    out = []
    for issue in issues:
        data = issue.model_dump()
        data["id"] = data.get("id") or secrets.token_hex(6)
        out.append(data)
    return out


# ---------- Priority ----------

def refresh_priority(task: Task, settings: UserSettings, now: Optional[datetime] = None) -> bool:
    result = calculate_priority(
        task,
        now or utcnow(),
        client_sla_tier=task.client.sla_tier if task.client else None,
        weights=settings.priority_weights,
        deadline_thresholds=settings.deadline_thresholds,
    )
    return apply_priority(task, result)


# ---------- Commands ----------

def create_task(db: Session, user: User, data: TaskCreate) -> Task:
    settings = get_user_settings(db, user)
    tz = settings.timezone
    eta = to_utc(data.eta, tz)
    deadline = to_utc(data.submission_deadline, tz)
    client = _get_or_create_client(db, user, data.client_name, data.client_sla_tier)
    shipment = _get_or_create_shipment(db, user, data.shipment_reference, client, eta, data.transport_mode)

    task = Task(
        user_id=user.id,
        title=data.title.strip(),
        description=data.description,
        notes=data.notes,
        status=data.status,
        shipment=shipment,
        client=client,
        eta=eta,
        submission_deadline=deadline,
        estimated_minutes=data.estimated_minutes,
        required_documents=data.required_documents,
        available_documents=data.available_documents,
        issues=_normalise_issues(data.issues),
        assigned_action=data.assigned_action,
        created_at=utcnow(),
    )
    if task.status == "IN_PROGRESS":
        task.started_at = utcnow()
    db.add(task)
    db.flush()
    refresh_priority(task, settings)
    audit_service.log(
        db, user.id, "TASK_CREATED", "task", task.id,
        new_state={"status": task.status, "priority_level": task.priority_level},
    )
    db.commit()
    return task


def update_task(db: Session, user: User, task: Task, data: TaskUpdate) -> Task:
    settings = get_user_settings(db, user)
    tz = settings.timezone
    fields = data.model_dump(exclude_unset=True)
    before = {"priority_level": task.priority_level, "deadline": _iso(task.submission_deadline)}

    if "client_name" in fields or "client_sla_tier" in fields:
        name = fields.get("client_name", task.client.name if task.client else None)
        task.client = _get_or_create_client(db, user, name, fields.get("client_sla_tier"))
    if "eta" in fields:
        task.eta = to_utc(data.eta, tz)
    if "submission_deadline" in fields:
        task.submission_deadline = to_utc(data.submission_deadline, tz)
    if {"shipment_reference", "eta", "transport_mode"} & fields.keys():
        ref = fields.get(
            "shipment_reference", task.shipment.reference if task.shipment else None
        )
        task.shipment = _get_or_create_shipment(
            db, user, ref, task.client, task.eta, fields.get("transport_mode")
        )
    if "issues" in fields:
        task.issues = _normalise_issues(data.issues or [])

    for name in (
        "title", "description", "notes", "estimated_minutes", "actual_minutes",
        "required_documents", "available_documents", "assigned_action",
    ):
        if name in fields and fields[name] is not None:
            setattr(task, name, fields[name])

    task.updated_at = utcnow()
    refresh_priority(task, settings)
    changed_fields = sorted(k for k in fields if k not in ("notes", "description"))
    audit_service.log(
        db, user.id, "TASK_UPDATED", "task", task.id,
        previous_state=before,
        new_state={"priority_level": task.priority_level, "deadline": _iso(task.submission_deadline)},
        metadata={"fields": changed_fields},
    )
    _mark_calendar_out_of_date(db, task)
    db.commit()
    return task


def change_status(db: Session, user: User, task: Task, data: StatusChange) -> Task:
    settings = get_user_settings(db, user)
    previous = task.status
    new = data.status
    if previous == new:
        return task

    if new == "COMPLETED":
        blockers = []
        if task.missing_documents:
            blockers.append(f"Missing documents: {', '.join(task.missing_documents)}")
        if task.open_issues:
            blockers.append(f"{len(task.open_issues)} open issue(s) not resolved")
        if blockers:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "This task cannot be completed yet. " + ". ".join(blockers)
                + ". Resolve them, or record the instruction you received, first.",
            )
        if not data.confirm_verified:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "Please confirm that you verified the task before completing it.",
            )

    now = utcnow()
    task.status = new
    if new == "IN_PROGRESS" and task.started_at is None:
        task.started_at = now
    if new == "COMPLETED":
        task.completed_at = now
        if task.actual_minutes is None and task.started_at is not None:
            task.actual_minutes = max(1, int((now - task.started_at).total_seconds() // 60))
    elif previous == "COMPLETED":
        task.completed_at = None

    if data.note:
        stamp = now.strftime("%Y-%m-%d %H:%M UTC")
        task.notes = (task.notes + "\n" if task.notes else "") + f"[{stamp}] {new}: {data.note}"

    task.updated_at = now
    refresh_priority(task, settings, now)
    action = {"ESCALATED": "TASK_ESCALATED", "COMPLETED": "TASK_COMPLETED"}.get(new, "TASK_STATUS_CHANGED")
    audit_service.log(
        db, user.id, action, "task", task.id,
        previous_state={"status": previous}, new_state={"status": new},
    )
    _mark_calendar_out_of_date(db, task)
    db.commit()
    return task


def delete_task(db: Session, user: User, task: Task) -> None:
    audit_service.log(
        db, user.id, "TASK_DELETED", "task", task.id, previous_state={"status": task.status}
    )
    db.delete(task)
    db.commit()


def _mark_calendar_out_of_date(db: Session, task: Task) -> None:
    event = db.scalar(select(CalendarEvent).where(CalendarEvent.task_id == task.id))
    if event and task.submission_deadline and event.event_end != task.submission_deadline:
        event.sync_status = "OUT_OF_DATE"


def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


# ---------- Serialisation ----------

def serialize_task(
    task: Task,
    settings: UserSettings,
    now: datetime,
    calendar_event: Optional[CalendarEvent] = None,
    include_factors: bool = False,
) -> dict:
    result = calculate_priority(
        task,
        now,
        client_sla_tier=task.client.sla_tier if task.client else None,
        weights=settings.priority_weights,
        deadline_thresholds=settings.deadline_thresholds,
    )
    deadline = evaluate_deadline(task.submission_deadline, now, settings.deadline_thresholds)
    return {
        "id": task.id,
        "title": task.title,
        "description": task.description,
        "notes": task.notes,
        "status": task.status,
        "shipment_reference": task.shipment.reference if task.shipment else None,
        "client_name": task.client.name if task.client else None,
        "client_sla_tier": task.client.sla_tier if task.client else None,
        "transport_mode": task.shipment.transport_mode if task.shipment else None,
        "eta": task.eta,
        "submission_deadline": task.submission_deadline,
        "estimated_minutes": task.estimated_minutes,
        "actual_minutes": task.actual_minutes,
        "required_documents": task.required_documents or [],
        "available_documents": task.available_documents or [],
        "missing_documents": task.missing_documents,
        "document_completeness": task.document_completeness,
        "issues": task.issues or [],
        "open_issue_count": len(task.open_issues),
        "assigned_action": task.assigned_action,
        "priority_score": result.score,
        "priority_level": result.level,
        "priority_reasons": result.reasons,
        "risk_level": result.risk_level,
        "guidance": result.guidance,
        "guidance_reason": result.guidance_reason,
        "deadline": deadline.as_dict(),
        "factors": [f.__dict__ for f in result.factors] if include_factors else [],
        "calendar_event": (
            {
                "id": calendar_event.id,
                "provider": calendar_event.provider,
                "sync_status": calendar_event.sync_status,
                "event_start": calendar_event.event_start,
            }
            if calendar_event
            else None
        ),
        "created_at": task.created_at,
        "updated_at": task.updated_at,
        "started_at": task.started_at,
        "completed_at": task.completed_at,
    }
