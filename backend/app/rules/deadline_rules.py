"""Deadline engine: deterministic rules for time remaining and urgency.

Thresholds are personal settings, not company policy.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Optional

DEFAULT_DEADLINE_THRESHOLDS = {
    "critical_minutes": 60,  # <= 1h remaining
    "urgent_minutes": 180,  # <= 3h remaining
    "watch_minutes": 360,  # <= 6h remaining
    "warn_before_critical_minutes": 30,  # early warning before a task becomes critical
}

DEADLINE_STATUSES = ("OVERDUE", "CRITICAL", "URGENT", "WATCH", "SAFE", "NO_DEADLINE")


def merged_thresholds(custom: Optional[dict]) -> dict:
    merged = dict(DEFAULT_DEADLINE_THRESHOLDS)
    for key, value in (custom or {}).items():
        if key in merged and isinstance(value, int) and value >= 0:
            merged[key] = value
    return merged


@dataclass
class DeadlineInfo:
    status: str
    minutes_remaining: Optional[int]
    overdue: bool
    approaching_critical: bool
    label: str

    def as_dict(self) -> dict:
        return {
            "status": self.status,
            "minutes_remaining": self.minutes_remaining,
            "overdue": self.overdue,
            "approaching_critical": self.approaching_critical,
            "label": self.label,
        }


def format_duration(minutes: int) -> str:
    minutes = abs(int(minutes))
    days, rem = divmod(minutes, 60 * 24)
    hours, mins = divmod(rem, 60)
    if days:
        return f"{days}d {hours}h"
    if hours:
        return f"{hours}h {mins}m"
    return f"{mins}m"


def evaluate_deadline(
    deadline: Optional[datetime], now: datetime, thresholds: Optional[dict] = None
) -> DeadlineInfo:
    t = merged_thresholds(thresholds)
    if deadline is None:
        return DeadlineInfo("NO_DEADLINE", None, False, False, "No deadline set")

    # Floor to whole minutes so the label never claims more time than there is
    seconds = (deadline - now).total_seconds()
    minutes = int(seconds // 60)

    if seconds < 0:
        return DeadlineInfo("OVERDUE", minutes, True, False, f"Overdue by {format_duration(minutes)}")
    if minutes <= t["critical_minutes"]:
        status = "CRITICAL"
    elif minutes <= t["urgent_minutes"]:
        status = "URGENT"
    elif minutes <= t["watch_minutes"]:
        status = "WATCH"
    else:
        status = "SAFE"

    approaching = (
        status != "CRITICAL"
        and minutes <= t["critical_minutes"] + t["warn_before_critical_minutes"]
    )
    return DeadlineInfo(status, minutes, False, approaching, f"{format_duration(minutes)} remaining")
