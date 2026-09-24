"""Report an Error workflow and personal error analytics.

The workflow is ordered on purpose: REPORTED -> NOTIFIED -> CORRECTING -> RESOLVED.
There is no delete: an error report is never hidden. It can only be corrected or resolved.
"""

import uuid
from collections import Counter
from datetime import datetime, timedelta
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import utcnow
from app.models import ErrorReport, Task, User
from app.schemas.performance import ErrorCreate, ErrorStatusChange, ErrorUpdate
from app.services import audit_service
from app.services.settings_service import get_user_settings, to_utc

CATEGORY_LABEL = {
    "TYPOGRAPHICAL": "Typographical",
    "DATA_READING": "Data reading",
    "DATA_ENTRY": "Data entry",
    "MISSING_INFORMATION": "Missing information",
    "CROSS_DOCUMENT": "Cross-document discrepancy",
    "SOP_PROCEDURE": "SOP / procedure",
    "COMMUNICATION": "Communication",
    "TIME_MANAGEMENT": "Time management",
    "OTHER": "Other",
}
ORDER = ("REPORTED", "NOTIFIED", "CORRECTING", "RESOLVED")
RECURRING_WINDOW_DAYS = 14
RECURRING_THRESHOLD = 3
_WORDS = {1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight", 9: "nine", 10: "ten"}


def number_word(n: int) -> str:
    return _WORDS.get(n, str(n))


def get_error_for_user(db: Session, user: User, error_id: uuid.UUID) -> ErrorReport:
    report = db.get(ErrorReport, error_id)
    if report is None or report.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Error report not found.")
    return report


def create_error(db: Session, user: User, data: ErrorCreate) -> ErrorReport:
    tz = get_user_settings(db, user).timezone
    reference = data.shipment_reference.strip()
    task_id = None
    if data.task_id:
        task = db.get(Task, data.task_id)
        if task is None or task.user_id != user.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Linked task not found.")
        task_id = task.id
        if not reference and task.shipment:
            reference = task.shipment.reference

    report = ErrorReport(
        user_id=user.id,
        task_id=task_id,
        shipment_reference=reference,
        field_name=data.field_name.strip(),
        incorrect_value=data.incorrect_value.strip(),
        correct_value=data.correct_value.strip(),
        source_document=data.source_document.strip(),
        submitted_at=to_utc(data.submitted_at, tz),
        discovered_at=to_utc(data.discovered_at, tz) or utcnow(),
        category=data.category,
        severity=data.severity,
        impact=data.impact.strip(),
        status="REPORTED",
        created_at=utcnow(),
    )
    db.add(report)
    db.flush()
    # Only category/severity in the audit log, never the values themselves
    audit_service.log(
        db,
        user.id,
        "ERROR_REPORTED",
        "error",
        report.id,
        new_state={"status": "REPORTED", "category": report.category, "severity": report.severity},
    )
    db.commit()
    return report


def update_error(db: Session, user: User, report: ErrorReport, data: ErrorUpdate) -> ErrorReport:
    tz = get_user_settings(db, user).timezone
    fields = data.model_dump(exclude_unset=True)
    for key in ("submitted_at", "discovered_at"):
        if key in fields:
            value = to_utc(fields.pop(key), tz)
            if value is not None or key == "submitted_at":
                setattr(report, key, value)
    for key, value in fields.items():
        if value is not None:
            setattr(report, key, value.strip() if isinstance(value, str) else value)
    report.updated_at = utcnow()
    audit_service.log(db, user.id, "ERROR_UPDATED", "error", report.id, metadata={"fields": sorted(fields)})
    db.commit()
    return report


def change_status(db: Session, user: User, report: ErrorReport, data: ErrorStatusChange) -> ErrorReport:
    previous, new = report.status, data.status
    if previous == new:
        return report
    reopening = previous == "RESOLVED" and new == "CORRECTING"
    if not reopening and ORDER.index(new) != ORDER.index(previous) + 1:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Follow the steps in order. The next step after {previous.lower()} is "
            f"{ORDER[min(ORDER.index(previous) + 1, len(ORDER) - 1)].lower()}.",
        )

    now = utcnow()
    if data.notified_person:
        report.notified_person = data.notified_person.strip()
    if data.correction_notes:
        report.correction_notes = data.correction_notes.strip()
    if data.resolution:
        report.resolution = data.resolution.strip()

    if new == "NOTIFIED":
        if not report.notified_person:
            raise HTTPException(status.HTTP_409_CONFLICT, "Record who you notified (a role is enough).")
        report.notified_at = now
    elif new == "CORRECTING" and not reopening:
        if not report.correction_notes:
            raise HTTPException(status.HTTP_409_CONFLICT, "Describe the correction you are preparing.")
    elif new == "RESOLVED":
        if not report.resolution:
            raise HTTPException(status.HTTP_409_CONFLICT, "Record how the error was resolved.")
        report.resolved_at = now
    if reopening:
        report.resolved_at = None

    report.status = new
    report.updated_at = now
    action = "CORRECTION_COMPLETED" if new == "RESOLVED" else "ERROR_STATUS_CHANGED"
    audit_service.log(
        db, user.id, action, "error", report.id, previous_state={"status": previous}, new_state={"status": new}
    )
    db.commit()
    return report


# ---------- Serialisation ----------


def workflow_steps(r: ErrorReport) -> list[dict]:
    steps = [
        ("Stop and verify", True),
        ("Identify the exact field", bool(r.field_name)),
        ("Identify the correct value", bool(r.correct_value)),
        ("Identify the source document", bool(r.source_document)),
        ("Record when it was submitted", r.submitted_at is not None),
        ("Assess potential impact", bool(r.impact)),
        ("Notify the appropriate person", r.notified_at is not None),
        ("Prepare the correction", bool(r.correction_notes)),
        ("Follow the instructions received", bool(r.instructions)),
        ("Record the resolution", r.resolved_at is not None),
        ("Root-cause analysis", bool(r.root_cause)),
    ]
    return [{"step": i, "label": label, "done": done} for i, (label, done) in enumerate(steps, start=1)]


def correction_minutes(r: ErrorReport) -> Optional[int]:
    if r.resolved_at is None:
        return None
    return max(0, int((r.resolved_at - r.discovered_at).total_seconds() // 60))


def report_delay_minutes(r: ErrorReport) -> int:
    return max(0, int((r.created_at - r.discovered_at).total_seconds() // 60))


def serialize(r: ErrorReport) -> dict:
    return {
        "id": r.id,
        "task_id": r.task_id,
        "shipment_reference": r.shipment_reference,
        "field_name": r.field_name,
        "incorrect_value": r.incorrect_value,
        "correct_value": r.correct_value,
        "source_document": r.source_document,
        "submitted_at": r.submitted_at,
        "discovered_at": r.discovered_at,
        "category": r.category,
        "category_label": CATEGORY_LABEL.get(r.category, r.category),
        "severity": r.severity,
        "impact": r.impact,
        "notified_person": r.notified_person,
        "notified_at": r.notified_at,
        "correction_notes": r.correction_notes,
        "instructions": r.instructions,
        "resolution": r.resolution,
        "resolved_at": r.resolved_at,
        "root_cause": r.root_cause,
        "root_cause_notes": r.root_cause_notes,
        "prevention_action": r.prevention_action,
        "status": r.status,
        "steps": workflow_steps(r),
        "correction_minutes": correction_minutes(r),
        "report_delay_minutes": report_delay_minutes(r),
        "created_at": r.created_at,
        "updated_at": r.updated_at,
    }


# ---------- Analytics ----------


def errors_between(db: Session, user: User, start: datetime, end: datetime) -> list[ErrorReport]:
    return list(
        db.scalars(
            select(ErrorReport).where(
                ErrorReport.user_id == user.id, ErrorReport.created_at >= start, ErrorReport.created_at < end
            )
        ).all()
    )


def _topic(field_name: str) -> str:
    return " ".join(field_name.lower().split())


def recurring_patterns(errors: list[ErrorReport], now: datetime) -> list[dict]:
    """Recurring fields or categories in the last 14 days. Suggestions only, never automatic changes."""
    cutoff = now - timedelta(days=RECURRING_WINDOW_DAYS)
    recent = [e for e in errors if e.created_at >= cutoff]
    patterns: list[dict] = []

    for topic, count in Counter(_topic(e.field_name) for e in recent).most_common():
        if count < RECURRING_THRESHOLD:
            break
        patterns.append(
            {
                "kind": "FIELD",
                "key": topic,
                "count": count,
                "message": (
                    f"You have encountered {number_word(count)} {topic}-related errors in the last "
                    f"{RECURRING_WINDOW_DAYS} days. Consider adding an explicit {topic} verification step "
                    "to your personal checklist."
                ),
                "suggested_learning": f"Explicit {topic} verification step before submission",
            }
        )
    covered = {p["key"] for p in patterns}
    for category, count in Counter(e.category for e in recent).most_common():
        if count < RECURRING_THRESHOLD:
            break
        # Skip a category whose errors are all already explained by a recurring field above
        if all(_topic(e.field_name) in covered for e in recent if e.category == category):
            continue
        label = CATEGORY_LABEL[category].lower()
        patterns.append(
            {
                "kind": "CATEGORY",
                "key": category,
                "count": count,
                "message": (
                    f"{number_word(count).capitalize()} {label} errors in the last {RECURRING_WINDOW_DAYS} days. "
                    "Review what these have in common and agree a prevention step."
                ),
                "suggested_learning": f"Prevent {label} errors",
            }
        )
    return patterns


def analytics(db: Session, user: User, days: int) -> dict:
    now = utcnow()
    start = now - timedelta(days=days)
    all_errors = list(db.scalars(select(ErrorReport).where(ErrorReport.user_id == user.id)).all())
    period = [e for e in all_errors if e.created_at >= start]
    completed = db.scalars(
        select(Task.id).where(Task.user_id == user.id, Task.status == "COMPLETED", Task.completed_at >= start)
    ).all()

    corrections = [m for m in (correction_minutes(e) for e in period) if m is not None]
    resolved = [e for e in period if e.status == "RESOLVED"]

    # Weekly trend for the last 8 weeks (oldest first)
    trend = []
    for weeks_ago in range(7, -1, -1):
        w_end = now - timedelta(weeks=weeks_ago)
        w_start = w_end - timedelta(weeks=1)
        trend.append(
            {
                "week_start": w_start,
                "count": sum(1 for e in all_errors if w_start <= e.created_at < w_end),
            }
        )

    def count_by(attr: str, keys) -> list[dict]:
        counts = Counter(getattr(e, attr) for e in period if getattr(e, attr))
        return [{"key": k, "label": CATEGORY_LABEL.get(k, k.title()), "count": counts.get(k, 0)} for k in keys]

    return {
        "days": days,
        "total": len(period),
        "open": sum(1 for e in period if e.status != "RESOLVED"),
        "tasks_completed": len(completed),
        # Errors per 100 completed tasks. None when there is nothing to compare against.
        "error_rate": round(100 * len(period) / len(completed), 1) if completed else None,
        "by_category": sorted(count_by("category", CATEGORY_LABEL), key=lambda x: -x["count"]),
        "by_severity": count_by("severity", ("CRITICAL", "HIGH", "MEDIUM", "LOW")),
        "by_root_cause": [c for c in count_by("root_cause", CATEGORY_LABEL) if c["count"]],
        "avg_correction_minutes": round(sum(corrections) / len(corrections)) if corrections else None,
        "rca_completed": sum(1 for e in resolved if e.root_cause),
        "resolved": len(resolved),
        "reported_within_hour": sum(1 for e in period if report_delay_minutes(e) <= 60),
        "trend": trend,
        "recurring": recurring_patterns(all_errors, now),
    }
