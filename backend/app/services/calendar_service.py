import logging
import secrets
from datetime import timedelta
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import utcnow
from app.core.security import decrypt, encrypt
from app.integrations.google_calendar import (
    CalendarProviderError,
    GoogleCalendarClient,
    build_event_body,
)
from app.models import CalendarConnection, CalendarEvent, Task, User
from app.services import audit_service
from app.services.settings_service import get_user_settings

logger = logging.getLogger("wispex.calendar")

DEFAULT_REMINDERS = [24 * 60, 4 * 60, 60, 30]
EVENT_DURATION = timedelta(minutes=15)

# Replaced in tests with a client that uses a mock transport
google_client = GoogleCalendarClient()


def event_title(task: Task) -> str:
    label = task.shipment.reference if task.shipment else task.title
    return f"WISPEX — {label} Submission Deadline"


def event_description(task: Task) -> str:
    # Keep it minimal: no document content or client details in an external calendar
    return f"Task: {task.title}\nCreated by Wispex Work Copilot. Open the app for details."


def google_event_id(task: Task) -> str:
    # Google accepts lowercase base32hex IDs; uuid hex (0-9a-f) is a subset of that alphabet
    return f"wispex{task.id.hex}"


def get_connection(db: Session, user: User) -> Optional[CalendarConnection]:
    conn = db.get(CalendarConnection, user.id)
    return conn if conn and conn.encrypted_refresh_token else None


def _access_token(db: Session, conn: CalendarConnection) -> str:
    token = decrypt(conn.encrypted_access_token)
    if token and conn.access_token_expires_at and conn.access_token_expires_at > utcnow():
        return token
    refreshed = google_client.refresh(decrypt(conn.encrypted_refresh_token))
    conn.encrypted_access_token = encrypt(refreshed["access_token"])
    conn.access_token_expires_at = refreshed["expires_at"]
    return refreshed["access_token"]


# ---------- OAuth ----------

def start_google_connect(db: Session, user: User) -> str:
    if not get_settings().google_calendar_configured:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Google Calendar integration is not configured on this server.",
        )
    conn = db.get(CalendarConnection, user.id) or CalendarConnection(user_id=user.id)
    conn.oauth_state = secrets.token_urlsafe(32)
    db.add(conn)
    db.commit()
    return google_client.authorization_url(conn.oauth_state)


def finish_google_connect(db: Session, user: User, state: str, code: str) -> None:
    conn = db.get(CalendarConnection, user.id)
    if conn is None or not state or not secrets.compare_digest(conn.oauth_state, state):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Calendar connection expired. Please try again.")
    tokens = google_client.exchange_code(code)
    if not tokens.get("refresh_token"):
        raise CalendarProviderError("Google did not return offline access. Please connect again.")
    conn.encrypted_refresh_token = encrypt(tokens["refresh_token"])
    conn.encrypted_access_token = encrypt(tokens["access_token"])
    conn.access_token_expires_at = tokens["expires_at"]
    conn.oauth_state = ""
    conn.connected_at = utcnow()
    audit_service.log(db, user.id, "CALENDAR_CONNECTED", "calendar", None, metadata={"provider": "google"})
    db.commit()


def disconnect_google(db: Session, user: User) -> None:
    conn = db.get(CalendarConnection, user.id)
    if conn is None:
        return
    try:
        refresh_token = decrypt(conn.encrypted_refresh_token)
        if refresh_token:
            google_client.revoke(refresh_token)
    except Exception:  # revoke is best effort, local tokens are removed anyway
        logger.warning("Google token revoke failed for user %s", user.id)
    db.delete(conn)
    audit_service.log(db, user.id, "CALENDAR_DISCONNECTED", "calendar", None)
    db.commit()


# ---------- Events ----------

def get_event_for_task(db: Session, task: Task) -> Optional[CalendarEvent]:
    return db.scalar(select(CalendarEvent).where(CalendarEvent.task_id == task.id))


def upsert_task_event(
    db: Session, user: User, task: Task, reminder_minutes: Optional[list[int]] = None
) -> CalendarEvent:
    """Create or update the single calendar event linked to a task (idempotent)."""
    if task.submission_deadline is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Set a submission deadline first.")

    reminders = sorted(set(reminder_minutes or DEFAULT_REMINDERS), reverse=True)[:5]
    event = get_event_for_task(db, task)
    created = event is None
    if event is None:
        event = CalendarEvent(user_id=user.id, task_id=task.id)
        db.add(event)
    event.title = event_title(task)
    event.event_start = task.submission_deadline
    event.event_end = task.submission_deadline + EVENT_DURATION
    event.reminder_minutes = reminders

    conn = get_connection(db, user)
    if conn is None:
        event.provider = "ics"
        event.sync_status = "LOCAL_ONLY"
        event.last_error = ""
    else:
        _push_to_google(db, user, conn, task, event)

    db.flush()
    audit_service.log(
        db, user.id, "CALENDAR_EVENT_CREATED" if created else "CALENDAR_EVENT_UPDATED",
        "calendar_event", event.id or None,
        new_state={"task_id": str(task.id), "sync_status": event.sync_status},
    )
    db.commit()
    return event


def _push_to_google(db: Session, user: User, conn: CalendarConnection, task: Task, event: CalendarEvent) -> None:
    settings = get_user_settings(db, user)
    event.provider = "google"
    event.calendar_id = conn.calendar_id
    try:
        token = _access_token(db, conn)
        body = build_event_body(
            event.title,
            event_description(task),
            event.event_start,
            event.event_end,
            settings.timezone,
            event.reminder_minutes,
            str(task.id),
        )
        event.external_event_id = google_client.upsert_event(
            token, conn.calendar_id, google_event_id(task), body
        )
        event.sync_status = "SYNCED"
        event.last_error = ""
    except Exception as exc:  # never lose the local record because of a sync failure
        logger.warning("Google Calendar sync failed for task %s: %s", task.id, type(exc).__name__)
        event.sync_status = "FAILED"
        event.last_error = str(exc)[:250] if isinstance(exc, CalendarProviderError) else "Sync failed"


def delete_task_event(db: Session, user: User, task: Task) -> None:
    event = get_event_for_task(db, task)
    if event is None:
        return
    if event.provider == "google" and event.external_event_id:
        conn = get_connection(db, user)
        if conn is not None:
            try:
                google_client.delete_event(_access_token(db, conn), event.calendar_id, event.external_event_id)
            except CalendarProviderError as exc:
                raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
    audit_service.log(db, user.id, "CALENDAR_EVENT_DELETED", "calendar_event", event.id,
                      previous_state={"task_id": str(task.id)})
    db.delete(event)
    db.commit()


def resync_events(db: Session, user: User) -> dict:
    """Push every event that is out of date or failed. Deadline changes mark events OUT_OF_DATE."""
    statuses = ["OUT_OF_DATE", "FAILED"]
    if get_connection(db, user) is not None:
        statuses.append("LOCAL_ONLY")  # push events created before Google was connected
    events = db.scalars(
        select(CalendarEvent).where(
            CalendarEvent.user_id == user.id, CalendarEvent.sync_status.in_(statuses)
        )
    ).all()
    synced = failed = 0
    for event in events:
        task = db.get(Task, event.task_id)
        if task is None or task.submission_deadline is None:
            continue
        upsert_task_event(db, user, task, event.reminder_minutes)
        if event.sync_status in ("SYNCED", "LOCAL_ONLY"):
            synced += 1
        else:
            failed += 1
    return {"updated": synced, "failed": failed}


def preview_event(task: Task) -> CalendarEvent:
    """An unsaved event with default reminders, used for ICS download before saving."""
    if task.submission_deadline is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Set a submission deadline first.")
    return CalendarEvent(
        title=event_title(task),
        event_start=task.submission_deadline,
        event_end=task.submission_deadline + EVENT_DURATION,
        reminder_minutes=DEFAULT_REMINDERS,
    )


# ---------- ICS export (works without any integration) ----------

def _ics_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def build_ics(task: Task, event: CalendarEvent) -> str:
    fmt = "%Y%m%dT%H%M%SZ"
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Wispex Work Copilot//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        # Stable UID: re-importing updates the same event instead of duplicating it
        f"UID:{task.id}@wispex-work-copilot",
        f"DTSTAMP:{utcnow().strftime(fmt)}",
        f"DTSTART:{event.event_start.strftime(fmt)}",
        f"DTEND:{event.event_end.strftime(fmt)}",
        f"SUMMARY:{_ics_escape(event.title)}",
        f"DESCRIPTION:{_ics_escape(event_description(task))}",
    ]
    for minutes in event.reminder_minutes:
        lines += [
            "BEGIN:VALARM",
            "ACTION:DISPLAY",
            f"DESCRIPTION:{_ics_escape(event.title)}",
            f"TRIGGER:-PT{minutes}M",
            "END:VALARM",
        ]
    lines += ["END:VEVENT", "END:VCALENDAR"]
    return "\r\n".join(lines) + "\r\n"
