"""Daily log (end-of-shift review) and weekly review.

The numbers are calculated from recorded work. Reflections are written by the user.
"""

from collections import Counter
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import utcnow
from app.models import (
    AuditLog,
    ErrorReport,
    Feedback,
    LearningItem,
    ShiftReview,
    Task,
    User,
    UserSettings,
    WeeklyReview,
)
from app.models.task import CLOSED_STATUSES
from app.services.error_service import CATEGORY_LABEL, number_word
from app.services.planner_service import build_plan
from app.services.settings_service import get_user_settings

ISSUE_LABEL = {
    "QUANTITY_MISMATCH": "quantity mismatch",
    "WEIGHT_MISMATCH": "weight verification",
    "DESCRIPTION_MISMATCH": "description mismatch",
    "VALUE_MISMATCH": "value mismatch",
    "MISSING_INFORMATION": "missing information",
    "LOW_CONFIDENCE": "hard-to-read documents",
    "COMPLIANCE_QUESTION": "compliance questions",
    "OTHER": "other issues",
}


def local_today(settings: UserSettings) -> date:
    return utcnow().astimezone(ZoneInfo(settings.timezone)).date()


def day_window(day: date, tz_name: str) -> tuple[datetime, datetime]:
    tz = ZoneInfo(tz_name)
    start = datetime.combine(day, time.min, tzinfo=tz)
    return start, datetime.combine(day + timedelta(days=1), time.min, tzinfo=tz)


def week_start_of(day: date) -> date:
    return day - timedelta(days=day.weekday())


def _parse(value) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def period_stats(db: Session, user: User, start: datetime, end: datetime) -> dict:
    """Counts for work recorded in [start, end)."""
    completed = db.scalars(
        select(Task).where(
            Task.user_id == user.id,
            Task.status == "COMPLETED",
            Task.completed_at >= start,
            Task.completed_at < end,
        )
    ).all()
    with_deadline = [t for t in completed if t.submission_deadline]
    on_time = sum(1 for t in with_deadline if t.completed_at <= t.submission_deadline)
    durations = [t.actual_minutes for t in completed if t.actual_minutes]

    errors = db.scalars(
        select(ErrorReport).where(
            ErrorReport.user_id == user.id, ErrorReport.created_at >= start, ErrorReport.created_at < end
        )
    ).all()
    escalations = db.scalars(
        select(AuditLog.id).where(
            AuditLog.user_id == user.id,
            AuditLog.action == "TASK_ESCALATED",
            AuditLog.timestamp >= start,
            AuditLog.timestamp < end,
        )
    ).all()

    # Issues live inside tasks; count the ones recorded in this period
    issue_types: Counter = Counter()
    for issues in db.scalars(select(Task.issues).where(Task.user_id == user.id)).all():
        for issue in issues or []:
            created = _parse(issue.get("created_at"))
            if created and start <= created < end:
                issue_types[issue.get("type", "OTHER")] += 1

    learned = db.scalars(
        select(LearningItem.id).where(
            LearningItem.user_id == user.id, LearningItem.understood_at >= start, LearningItem.understood_at < end
        )
    ).all()
    feedback_applied = db.scalars(
        select(Feedback.id).where(Feedback.user_id == user.id, Feedback.applied_at >= start, Feedback.applied_at < end)
    ).all()

    return {
        "tasks_completed": len(completed),
        "completed_on_time": on_time,
        "completed_with_deadline": len(with_deadline),
        "avg_processing_minutes": round(sum(durations) / len(durations)) if durations else None,
        "errors": len(errors),
        "error_categories": dict(Counter(e.category for e in errors)),
        "escalations": len(escalations),
        "discrepancies": sum(issue_types.values()),
        "issue_types": dict(issue_types),
        "learning_completed": len(learned),
        "feedback_applied": len(feedback_applied),
    }


def recurring_issue(db: Session, user: User, end: datetime) -> dict | None:
    """Most frequent problem in the 14 days up to `end`: own errors first, then recorded issues."""
    start = end - timedelta(days=14)
    stats = period_stats(db, user, start, end)
    errors = db.scalars(
        select(ErrorReport).where(
            ErrorReport.user_id == user.id, ErrorReport.created_at >= start, ErrorReport.created_at < end
        )
    ).all()
    fields = Counter(" ".join(e.field_name.lower().split()) for e in errors)
    if fields:
        topic, count = fields.most_common(1)[0]
        if count >= 2:
            return {"source": "errors", "label": f"{topic} verification", "count": count}
    if stats["issue_types"]:
        kind, count = Counter(stats["issue_types"]).most_common(1)[0]
        if count >= 2:
            return {"source": "issues", "label": ISSUE_LABEL.get(kind, kind.lower()), "count": count}
    if stats["error_categories"]:
        cat, count = Counter(stats["error_categories"]).most_common(1)[0]
        return {"source": "errors", "label": CATEGORY_LABEL[cat].lower(), "count": count}
    return None


def _plural(n: int, singular: str, plural: str | None = None) -> str:
    word = number_word(n) if n <= 10 else str(n)
    return f"{word} {singular if n == 1 else (plural or singular + 's')}"


def shift_summary(stats: dict, recurring: dict | None, is_today: bool) -> str:
    when = "Today" if is_today else "That day"
    parts = [f"{when} you completed {_plural(stats['tasks_completed'], 'task')}."]
    e = stats["errors"]
    parts.append(
        f"{_plural(e, 'error').capitalize()} {'was' if e == 1 else 'were'} recorded."
        if e
        else "No errors were recorded."
    )
    if stats["discrepancies"]:
        parts.append(f"{_plural(stats['discrepancies'], 'discrepancy', 'discrepancies').capitalize()} recorded.")
    if stats["escalations"]:
        s = stats["escalations"]
        parts.append(f"{_plural(s, 'task').capitalize()} {'was' if s == 1 else 'were'} escalated.")
    if recurring:
        parts.append(f"Your most frequent issue was {recurring['label']}.")
        parts.append(f"Tomorrow, prioritise reviewing the {recurring['label']} process.")
    return " ".join(parts)


def shift_review(db: Session, user: User, day: date | None = None) -> dict:
    settings = get_user_settings(db, user)
    today = local_today(settings)
    day = day or today
    start, end = day_window(day, settings.timezone)
    stats = period_stats(db, user, start, end)
    recurring = recurring_issue(db, user, min(end, utcnow()) if day == today else end)

    extra: dict = {}
    if day == today:
        open_tasks = db.scalars(select(Task).where(Task.user_id == user.id, Task.status.not_in(CLOSED_STATUSES))).all()
        plan = build_plan(list(open_tasks), settings, utcnow())
        priorities = [
            {
                "task_id": item["task"]["id"],
                "label": item["task"]["shipment_reference"] or item["task"]["title"],
                "reason": (item["task"]["priority_reasons"] or [item["task"]["deadline"]["label"]])[0],
            }
            for item in plan["recommended_tasks"][:3]
        ]
        extra = {
            "pending": plan["counts"]["open"],
            "critical": plan["counts"]["critical"],
            "waiting": plan["counts"]["blocked"],
            "tomorrow_priorities": priorities,
        }

    saved = db.scalar(select(ShiftReview).where(ShiftReview.user_id == user.id, ShiftReview.review_date == day))
    return {
        "review_date": day,
        "is_today": day == today,
        "stats": {**stats, **extra},
        "recurring_issue": recurring,
        "summary": shift_summary(stats, recurring, day == today),
        "reflection": _reflection(saved, ("went_well", "to_improve", "tomorrow_focus")),
    }


def weekly_review(db: Session, user: User, week_start: date | None = None) -> dict:
    settings = get_user_settings(db, user)
    week_start = week_start_of(week_start or local_today(settings))
    start, _ = day_window(week_start, settings.timezone)
    _, end = day_window(week_start + timedelta(days=6), settings.timezone)
    stats = period_stats(db, user, start, end)

    days = []
    for offset in range(7):
        d = week_start + timedelta(days=offset)
        d_start, d_end = day_window(d, settings.timezone)
        s = period_stats(db, user, d_start, d_end)
        days.append(
            {"date": d, "completed": s["tasks_completed"], "errors": s["errors"], "escalations": s["escalations"]}
        )

    prev_start, _ = day_window(week_start - timedelta(days=7), settings.timezone)
    previous = period_stats(db, user, prev_start, start)
    recurring = recurring_issue(db, user, min(end, utcnow()))
    saved = db.scalar(
        select(WeeklyReview).where(WeeklyReview.user_id == user.id, WeeklyReview.week_start == week_start)
    )
    return {
        "week_start": week_start,
        "week_end": week_start + timedelta(days=6),
        "stats": stats,
        "previous_week": previous,
        "days": days,
        "recurring_issue": recurring,
        "shift_reviews_logged": len(
            db.scalars(
                select(ShiftReview.id).where(
                    ShiftReview.user_id == user.id,
                    ShiftReview.review_date >= week_start,
                    ShiftReview.review_date <= week_start + timedelta(days=6),
                )
            ).all()
        ),
        "reflection": _reflection(saved, ("went_well", "to_improve", "next_week_focus")),
    }


def _reflection(saved, keys: tuple[str, ...]) -> dict:
    data = {k: getattr(saved, k) if saved else "" for k in keys}
    data["saved_at"] = saved.updated_at if saved else None
    return data


def save_shift_reflection(db: Session, user: User, day: date, values: dict) -> ShiftReview:
    review = db.scalar(select(ShiftReview).where(ShiftReview.user_id == user.id, ShiftReview.review_date == day))
    if review is None:
        review = ShiftReview(user_id=user.id, review_date=day)
        db.add(review)
    settings = get_user_settings(db, user)
    start, end = day_window(day, settings.timezone)
    review.stats = period_stats(db, user, start, end)  # snapshot at the time of saving
    for key in ("went_well", "to_improve", "tomorrow_focus"):
        setattr(review, key, values.get(key, "").strip())
    review.updated_at = utcnow()
    return review


def save_weekly_reflection(db: Session, user: User, week_start: date, values: dict) -> WeeklyReview:
    week_start = week_start_of(week_start)
    review = db.scalar(
        select(WeeklyReview).where(WeeklyReview.user_id == user.id, WeeklyReview.week_start == week_start)
    )
    if review is None:
        review = WeeklyReview(user_id=user.id, week_start=week_start)
        db.add(review)
    settings = get_user_settings(db, user)
    start, _ = day_window(week_start, settings.timezone)
    _, end = day_window(week_start + timedelta(days=6), settings.timezone)
    review.stats = period_stats(db, user, start, end)
    for key in ("went_well", "to_improve", "next_week_focus"):
        setattr(review, key, values.get(key, "").strip())
    review.updated_at = utcnow()
    return review


def history(db: Session, user: User) -> dict:
    shifts = db.scalars(
        select(ShiftReview).where(ShiftReview.user_id == user.id).order_by(ShiftReview.review_date.desc()).limit(14)
    ).all()
    weeks = db.scalars(
        select(WeeklyReview).where(WeeklyReview.user_id == user.id).order_by(WeeklyReview.week_start.desc()).limit(8)
    ).all()
    return {
        "shift_reviews": [
            {
                "review_date": s.review_date,
                "tasks_completed": s.stats.get("tasks_completed", 0),
                "errors": s.stats.get("errors", 0),
                "has_reflection": bool(s.went_well or s.to_improve),
            }
            for s in shifts
        ],
        "weekly_reviews": [
            {
                "week_start": w.week_start,
                "tasks_completed": w.stats.get("tasks_completed", 0),
                "errors": w.stats.get("errors", 0),
                "has_reflection": bool(w.went_well or w.to_improve),
            }
            for w in weeks
        ],
    }
