import uuid
from typing import Optional

from sqlalchemy.orm import Session

from app.models import AuditLog

AUDIT_ACTIONS = (
    "USER_REGISTERED",
    "USER_LOGGED_IN",
    "DEMO_SESSION_STARTED",
    "TASK_CREATED",
    "TASK_UPDATED",
    "TASK_STATUS_CHANGED",
    "TASK_ESCALATED",
    "TASK_COMPLETED",
    "TASK_DELETED",
    "SETTINGS_UPDATED",
    "CALENDAR_CONNECTED",
    "CALENDAR_DISCONNECTED",
    "CALENDAR_EVENT_CREATED",
    "CALENDAR_EVENT_UPDATED",
    "CALENDAR_EVENT_DELETED",
)


def log(
    db: Session,
    user_id: uuid.UUID,
    action: str,
    entity: str,
    entity_id: Optional[object] = None,
    previous_state: Optional[dict] = None,
    new_state: Optional[dict] = None,
    metadata: Optional[dict] = None,
) -> None:
    """Add an audit entry to the current transaction.

    Only store small, non-confidential state (status, level, dates). Never document content.
    """
    db.add(
        AuditLog(
            user_id=user_id,
            action=action,
            entity=entity,
            entity_id=str(entity_id) if entity_id else None,
            previous_state=previous_state,
            new_state=new_state,
            metadata_=metadata,
        )
    )
