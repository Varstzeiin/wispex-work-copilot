import logging
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import RedirectResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.security import get_current_user
from app.models import CalendarEvent, Task, User
from app.services import calendar_service, task_service

router = APIRouter(prefix="/calendar", tags=["calendar"])
logger = logging.getLogger("wispex.calendar")


class EventIn(BaseModel):
    reminder_minutes: Optional[list[int]] = Field(default=None, max_length=5)


def _event_out(event: CalendarEvent, task: Optional[Task]) -> dict:
    return {
        "id": event.id,
        "task_id": event.task_id,
        "task_title": task.title if task else None,
        "shipment_reference": task.shipment.reference if task and task.shipment else None,
        "title": event.title,
        "provider": event.provider,
        "event_start": event.event_start,
        "event_end": event.event_end,
        "reminder_minutes": event.reminder_minutes,
        "sync_status": event.sync_status,
        "last_error": event.last_error,
    }


@router.get("/status")
def calendar_status(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    conn = calendar_service.get_connection(db, user)
    return {
        "google_available": get_settings().google_calendar_configured,
        "google_connected": conn is not None,
        "connected_at": conn.connected_at if conn else None,
        "default_reminders": calendar_service.DEFAULT_REMINDERS,
    }


@router.get("/events")
def list_events(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    events = db.scalars(
        select(CalendarEvent).where(CalendarEvent.user_id == user.id).order_by(CalendarEvent.event_start)
    ).all()
    return [_event_out(e, db.get(Task, e.task_id)) for e in events]


@router.put("/tasks/{task_id}/event")
def upsert_event(
    task_id: uuid.UUID, data: EventIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    task = task_service.get_task_for_user(db, user, task_id)
    reminders = [m for m in (data.reminder_minutes or []) if 0 <= m <= 40320] or None
    event = calendar_service.upsert_task_event(db, user, task, reminders)
    return _event_out(event, task)


@router.delete("/tasks/{task_id}/event", status_code=204)
def delete_event(task_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    task = task_service.get_task_for_user(db, user, task_id)
    calendar_service.delete_task_event(db, user, task)


@router.get("/tasks/{task_id}/event.ics")
def download_ics(task_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    task = task_service.get_task_for_user(db, user, task_id)
    # GET must not change state: use the saved event, or a transient one with default reminders
    event = calendar_service.get_event_for_task(db, task) or calendar_service.preview_event(task)
    filename = f"wispex-deadline-{str(task.id)[:8]}.ics"
    return Response(
        calendar_service.build_ics(task, event),
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/sync")
def sync(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return calendar_service.resync_events(db, user)


@router.post("/google/connect")
def google_connect(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return {"authorization_url": calendar_service.start_google_connect(db, user)}


@router.get("/google/callback")
def google_callback(
    state: str = Query(default="", max_length=128),
    code: str = Query(default="", max_length=2048),
    error: str = Query(default="", max_length=100),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """OAuth redirect target.

    The one-time state value must belong to the signed-in user, so nobody can attach
    their own Google account (or someone else's) to another session.
    """
    target = f"{get_settings().frontend_url}/calendar"
    if error or not code:
        return RedirectResponse(f"{target}?google=cancelled")
    try:
        calendar_service.finish_google_connect(db, user, state, code)
    except Exception as exc:
        logger.warning("Google OAuth callback failed: %s", type(exc).__name__)
        return RedirectResponse(f"{target}?google=failed")
    return RedirectResponse(f"{target}?google=connected")


@router.post("/google/disconnect", status_code=204)
def google_disconnect(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    calendar_service.disconnect_google(db, user)
