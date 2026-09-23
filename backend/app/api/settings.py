from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.security import get_current_user
from app.models import User
from app.rules.deadline_rules import merged_thresholds
from app.schemas.settings import NotificationPrefs, SettingsOut, SettingsUpdate
from app.services import audit_service, calendar_service
from app.services.priority_service import merged_level_thresholds, merged_weights
from app.services.settings_service import get_user_settings

router = APIRouter(prefix="/settings", tags=["settings"])


def _out(db: Session, user: User) -> SettingsOut:
    s = get_user_settings(db, user)
    return SettingsOut(
        timezone=s.timezone,
        shift_start=s.shift_start,
        shift_end=s.shift_end,
        deadline_thresholds=merged_thresholds(s.deadline_thresholds),
        priority_weights=merged_weights(s.priority_weights),
        level_thresholds=merged_level_thresholds(s.priority_weights),
        notification_prefs=NotificationPrefs(**(s.notification_prefs or {})),
        google_calendar_available=get_settings().google_calendar_configured,
        google_calendar_connected=calendar_service.get_connection(db, user) is not None,
    )


@router.get("", response_model=SettingsOut)
def read_settings(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    out = _out(db, user)
    db.commit()  # persists default settings row on first access
    return out


@router.put("", response_model=SettingsOut)
def update_settings(data: SettingsUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    s = get_user_settings(db, user)
    fields = data.model_dump(exclude_unset=True, exclude_none=True)
    for key in ("timezone", "shift_start", "shift_end"):
        if key in fields:
            setattr(s, key, fields[key])
    if "deadline_thresholds" in fields:
        s.deadline_thresholds = fields["deadline_thresholds"]
    if "priority_weights" in fields:
        s.priority_weights = fields["priority_weights"]
    if "notification_prefs" in fields:
        s.notification_prefs = fields["notification_prefs"]
    audit_service.log(db, user.id, "SETTINGS_UPDATED", "settings", user.id, metadata={"fields": sorted(fields)})
    db.commit()
    return _out(db, user)


@router.post("/reset", response_model=SettingsOut)
def reset_rules(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Restore default thresholds and weights (keeps timezone and shift)."""
    s = get_user_settings(db, user)
    s.deadline_thresholds = {}
    s.priority_weights = {}
    audit_service.log(db, user.id, "SETTINGS_UPDATED", "settings", user.id, metadata={"fields": ["reset_rules"]})
    db.commit()
    return _out(db, user)
