import uuid
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session

from app.core.database import get_db, utcnow
from app.core.security import get_current_user
from app.models import CalendarEvent, Client, Shipment, Task, User
from app.models.task import CLOSED_STATUSES
from app.schemas.task import StatusChange, TaskCreate, TaskListOut, TaskOut, TaskUpdate
from app.services import calendar_service, task_service
from app.services.priority_service import LEVEL_RANK
from app.services.settings_service import get_user_settings

router = APIRouter(prefix="/tasks", tags=["tasks"])


def refresh_open_priorities(db: Session, user: User) -> list[Task]:
    """Priority depends on the current time, so recalculate and store it before listing."""
    settings = get_user_settings(db, user)
    now = utcnow()
    tasks = db.scalars(
        select(Task).where(Task.user_id == user.id, Task.status.not_in(CLOSED_STATUSES))
    ).all()
    changed = False
    for task in tasks:
        changed = task_service.refresh_priority(task, settings, now) or changed
    if changed:
        db.commit()
    return list(tasks)


def _events_by_task(db: Session, user: User, task_ids: list[uuid.UUID]) -> dict:
    if not task_ids:
        return {}
    events = db.scalars(
        select(CalendarEvent).where(CalendarEvent.user_id == user.id, CalendarEvent.task_id.in_(task_ids))
    ).all()
    return {e.task_id: e for e in events}


@router.get("", response_model=TaskListOut)
def list_tasks(
    view: Literal["open", "closed", "all"] = "open",
    status: Optional[str] = None,
    level: Optional[str] = None,
    q: Optional[str] = Query(default=None, max_length=100),
    sort: Literal["priority", "deadline", "created"] = "priority",
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    refresh_open_priorities(db, user)
    settings = get_user_settings(db, user)

    stmt = (
        select(Task)
        .outerjoin(Shipment, Task.shipment_id == Shipment.id)
        .outerjoin(Client, Task.client_id == Client.id)
        .where(Task.user_id == user.id)
    )
    if view == "open":
        stmt = stmt.where(Task.status.not_in(CLOSED_STATUSES))
    elif view == "closed":
        stmt = stmt.where(Task.status.in_(CLOSED_STATUSES))
    if status:
        stmt = stmt.where(Task.status.in_(status.upper().split(",")))
    if level:
        stmt = stmt.where(Task.priority_level.in_(level.upper().split(",")))
    if q and q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(Task.title.ilike(like), Shipment.reference.ilike(like), Client.name.ilike(like))
        )

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    # NULL deadlines sort last in both databases
    deadline_order = (Task.submission_deadline.is_(None), Task.submission_deadline)
    if sort == "deadline":
        stmt = stmt.order_by(*deadline_order)
    elif sort == "created":
        stmt = stmt.order_by(Task.created_at.desc())
    else:
        level_rank = case(LEVEL_RANK, value=Task.priority_level, else_=9)
        stmt = stmt.order_by(level_rank, Task.priority_score.desc(), *deadline_order)
    tasks = db.scalars(stmt.offset((page - 1) * page_size).limit(page_size)).all()

    now = utcnow()
    events = _events_by_task(db, user, [t.id for t in tasks])
    level_counts = dict(
        db.execute(
            select(Task.priority_level, func.count())
            .where(Task.user_id == user.id, Task.status.not_in(CLOSED_STATUSES))
            .group_by(Task.priority_level)
        ).all()
    )
    return {
        "items": [task_service.serialize_task(t, settings, now, events.get(t.id)) for t in tasks],
        "total": total,
        "page": page,
        "page_size": page_size,
        "counts": {k: level_counts.get(k, 0) for k in ("CRITICAL", "HIGH", "MEDIUM", "LOW")},
    }


@router.post("", response_model=TaskOut, status_code=201)
def create_task(data: TaskCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    task = task_service.create_task(db, user, data)
    return task_service.serialize_task(task, get_user_settings(db, user), utcnow(), include_factors=True)


@router.get("/{task_id}", response_model=TaskOut)
def get_task(task_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    task = task_service.get_task_for_user(db, user, task_id)
    event = calendar_service.get_event_for_task(db, task)
    return task_service.serialize_task(task, get_user_settings(db, user), utcnow(), event, include_factors=True)


@router.patch("/{task_id}", response_model=TaskOut)
def update_task(
    task_id: uuid.UUID, data: TaskUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    task = task_service.get_task_for_user(db, user, task_id)
    task = task_service.update_task(db, user, task, data)
    event = calendar_service.get_event_for_task(db, task)
    return task_service.serialize_task(task, get_user_settings(db, user), utcnow(), event, include_factors=True)


@router.post("/{task_id}/status", response_model=TaskOut)
def change_status(
    task_id: uuid.UUID, data: StatusChange, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    task = task_service.get_task_for_user(db, user, task_id)
    task = task_service.change_status(db, user, task, data)
    event = calendar_service.get_event_for_task(db, task)
    return task_service.serialize_task(task, get_user_settings(db, user), utcnow(), event, include_factors=True)


@router.delete("/{task_id}", status_code=204)
def delete_task(task_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    task = task_service.get_task_for_user(db, user, task_id)
    calendar_service.delete_task_event(db, user, task)  # also removes the Google event if synced
    task_service.delete_task(db, user, task)
