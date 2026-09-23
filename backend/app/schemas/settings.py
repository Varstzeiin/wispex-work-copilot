import re
from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, Field, field_validator

_HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


class DeadlineThresholds(BaseModel):
    critical_minutes: int = Field(ge=5, le=24 * 60)
    urgent_minutes: int = Field(ge=5, le=48 * 60)
    watch_minutes: int = Field(ge=5, le=72 * 60)
    warn_before_critical_minutes: int = Field(ge=0, le=6 * 60)


class PriorityWeights(BaseModel):
    deadline: float = Field(ge=0, le=100)
    eta: float = Field(ge=0, le=100)
    risk: float = Field(ge=0, le=100)
    missing_documents: float = Field(ge=0, le=100)
    client_priority: float = Field(ge=0, le=100)
    complexity: float = Field(ge=0, le=100)
    task_age: float = Field(ge=0, le=100)


class NotificationPrefs(BaseModel):
    in_app: bool = True
    browser: bool = False
    notify_new_critical: bool = True
    notify_approaching_critical: bool = True


class SettingsOut(BaseModel):
    timezone: str
    shift_start: str
    shift_end: str
    deadline_thresholds: DeadlineThresholds
    priority_weights: PriorityWeights
    level_thresholds: dict[str, int]
    notification_prefs: NotificationPrefs
    google_calendar_available: bool
    google_calendar_connected: bool


class SettingsUpdate(BaseModel):
    timezone: Optional[str] = None
    shift_start: Optional[str] = None
    shift_end: Optional[str] = None
    deadline_thresholds: Optional[DeadlineThresholds] = None
    priority_weights: Optional[PriorityWeights] = None
    notification_prefs: Optional[NotificationPrefs] = None

    @field_validator("timezone")
    @classmethod
    def _tz(cls, value):
        if value is None:
            return value
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError("Unknown timezone") from None
        return value

    @field_validator("shift_start", "shift_end")
    @classmethod
    def _hhmm(cls, value):
        if value is not None and not _HHMM.match(value):
            raise ValueError("Use HH:MM (24-hour) format")
        return value

    @field_validator("deadline_thresholds")
    @classmethod
    def _ordered(cls, value):
        if value and not (value.critical_minutes < value.urgent_minutes < value.watch_minutes):
            raise ValueError("Thresholds must be ordered: critical < urgent < watch")
        return value
