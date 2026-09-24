"""Personal Reliability Indicators, skill matrix defaults and the 30 / 60 / 90 day plan.

Every indicator comes with the evidence it is based on. There is deliberately no single
overall score, and none of this is an official company evaluation.
"""

from collections import Counter
from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import utcnow
from app.models import (
    AuditLog,
    Clarification,
    DevelopmentGoal,
    DevelopmentPlan,
    ErrorReport,
    Feedback,
    LearningItem,
    ShiftReview,
    Skill,
    Task,
    User,
)
from app.services.error_service import report_delay_minutes
from app.services.review_service import day_window, local_today
from app.services.settings_service import get_user_settings

DEFAULT_SKILLS = [
    "Reading a Commercial Invoice",
    "Reading a Packing List",
    "Reading a Bill of Lading / Air Waybill",
    "Cross-checking documents",
    "Accurate data entry",
    "Deadline and ETA management",
    "Knowing when to escalate",
    "Professional written communication",
]

DEFAULT_GOALS = {
    30: [
        "Can explain each main document (Invoice, Packing List, BL / AWB) and its key fields",
        "Knows where training materials and SOP references are kept",
        "Knows who to ask for which kind of question",
        "Completes an end-of-shift review on most working days",
    ],
    60: [
        "Completes routine tasks without reminders about verification steps",
        "Error count is stable or going down",
        "Asks questions with context, evidence and deadline",
        "Applies feedback and records the evidence",
    ],
    90: [
        "Handles standard shipments independently",
        "Knows when to proceed and when to escalate",
        "Reports own errors early and documents the correction",
        "Can explain the main procedures to a new colleague",
    ],
}

PHASES = [
    (30, "Understanding", 1, 30),
    (60, "Consistency", 31, 60),
    (90, "Independence and reliability", 61, 90),
]


# ---------- Defaults ----------


def ensure_default_skills(db: Session, user: User) -> None:
    existing = set(db.scalars(select(Skill.name).where(Skill.user_id == user.id)).all())
    if existing:
        return
    for name in DEFAULT_SKILLS:
        db.add(Skill(user_id=user.id, name=name, is_default=True, history=[]))
    db.commit()


def ensure_plan(db: Session, user: User) -> DevelopmentPlan:
    plan = db.get(DevelopmentPlan, user.id)
    if plan is None:
        plan = DevelopmentPlan(user_id=user.id)
        db.add(plan)
        for phase, titles in DEFAULT_GOALS.items():
            for position, title in enumerate(titles):
                db.add(DevelopmentGoal(user_id=user.id, phase=phase, title=title, is_default=True, position=position))
        db.commit()
    return plan


# ---------- Reliability indicators ----------


def _indicator(key: str, label: str, value: str, status: str, evidence: list[str], note: str = "") -> dict:
    return {"key": key, "label": label, "value": value, "status": status, "evidence": evidence, "note": note}


def _pct(part: int, whole: int) -> str:
    return f"{round(100 * part / whole)}%" if whole else "—"


def reliability_indicators(db: Session, user: User, days: int = 30) -> dict:
    now = utcnow()
    start = now - timedelta(days=days)

    completed = db.scalars(
        select(Task).where(Task.user_id == user.id, Task.status == "COMPLETED", Task.completed_at >= start)
    ).all()
    with_deadline = [t for t in completed if t.submission_deadline]
    on_time = [t for t in with_deadline if t.completed_at <= t.submission_deadline]
    escalated_ids = set(
        db.scalars(
            select(AuditLog.entity_id).where(AuditLog.user_id == user.id, AuditLog.action == "TASK_ESCALATED")
        ).all()
    )
    independent = [t for t in completed if str(t.id) not in escalated_ids]

    errors = db.scalars(
        select(ErrorReport).where(ErrorReport.user_id == user.id, ErrorReport.created_at >= start)
    ).all()
    fields = Counter(" ".join(e.field_name.lower().split()) for e in errors)
    repeated = {f: c for f, c in fields.items() if c >= 2}
    early = [e for e in errors if report_delay_minutes(e) <= 60]
    resolved = [e for e in errors if e.status == "RESOLVED"]
    documented = [e for e in resolved if e.root_cause and e.prevention_action]

    feedback = db.scalars(select(Feedback).where(Feedback.user_id == user.id, Feedback.received_at >= start)).all()
    questions = db.scalars(
        select(Clarification).where(Clarification.user_id == user.id, Clarification.created_at >= start)
    ).all()
    # "Clear" = linked to a task (context) and carrying evidence: typed evidence or concrete values in the text
    clear = [q for q in questions if q.task_id and (q.evidence.strip() or any(ch.isdigit() for ch in q.question))]
    applied = [f for f in feedback if f.applied]
    applied_with_evidence = [f for f in applied if f.applied_evidence]

    sop_items = db.scalars(
        select(LearningItem).where(LearningItem.user_id == user.id, LearningItem.category.in_(("SOP", "PROCEDURE")))
    ).all()
    sop_known = [i for i in sop_items if i.status in ("UNDERSTOOD", "APPLIED")]

    half = now - timedelta(days=days / 2)
    recent_errors = sum(1 for e in errors if e.created_at >= half)
    earlier_errors = len(errors) - recent_errors
    reviews = db.scalars(
        select(ShiftReview.id).where(
            ShiftReview.user_id == user.id, ShiftReview.review_date >= (now - timedelta(days=days)).date()
        )
    ).all()

    def status_for(ratio: float | None, good: float, watch: float) -> str:
        if ratio is None:
            return "NO_DATA"
        return "GOOD" if ratio >= good else "WATCH" if ratio >= watch else "NEEDS_ATTENTION"

    indicators = [
        _indicator(
            "on_time",
            "Tasks completed on time",
            _pct(len(on_time), len(with_deadline)),
            status_for(len(on_time) / len(with_deadline) if with_deadline else None, 0.95, 0.85),
            [f"{len(on_time)} of {len(with_deadline)} tasks with a deadline were completed before it"],
        ),
        _indicator(
            "repeated_errors",
            "Repeated errors",
            str(len(repeated)),
            "NO_DATA"
            if not errors and not completed
            else "GOOD"
            if not repeated
            else "WATCH"
            if len(repeated) == 1
            else "NEEDS_ATTENTION",
            [f"{field}: {count} errors" for field, count in sorted(repeated.items(), key=lambda x: -x[1])]
            or [f"{len(errors)} error(s) recorded, none repeated on the same field"],
        ),
        _indicator(
            "feedback_applied",
            "Feedback applied",
            _pct(len(applied), len(feedback)),
            status_for(len(applied) / len(feedback) if feedback else None, 0.8, 0.5),
            [
                f"{len(applied)} of {len(feedback)} feedback items marked as applied",
                f"{len(applied_with_evidence)} with written evidence",
            ],
        ),
        _indicator(
            "questions",
            "Questions asked clearly",
            _pct(len(clear), len(questions)),
            status_for(len(clear) / len(questions) if questions else None, 0.8, 0.5),
            [
                f"{len(clear)} of {len(questions)} recorded questions were linked to a task and included evidence",
                f"{sum(1 for q in questions if q.status == 'ANSWERED')} answered",
            ],
            note="Only questions recorded through “I'm not sure” are counted. Asking is never counted against you.",
        ),
        _indicator(
            "reported_early",
            "Issues reported early",
            _pct(len(early), len(errors)),
            status_for(len(early) / len(errors) if errors else None, 0.9, 0.7),
            [f"{len(early)} of {len(errors)} errors were reported within 1 hour of discovery"],
            note="No errors in this period is also fine. Reporting early matters more than the count.",
        ),
        _indicator(
            "independent",
            "Tasks completed independently",
            _pct(len(independent), len(completed)),
            # Escalating when needed is correct behaviour, so this is never marked as a problem
            "NO_DATA" if not completed else "GOOD",
            [f"{len(independent)} of {len(completed)} completed tasks needed no escalation"],
            note="Escalating when the SOP requires it is the right call, not a weakness.",
        ),
        _indicator(
            "sop_knowledge",
            "SOP knowledge",
            f"{len(sop_known)} / {len(sop_items)}",
            status_for(len(sop_known) / len(sop_items) if sop_items else None, 0.8, 0.5),
            [f"{len(sop_known)} SOP / procedure topics marked understood or applied in your learning tracker"],
        ),
        _indicator(
            "consistency",
            "Consistency",
            "Improving"
            if earlier_errors > recent_errors
            else "Stable"
            if earlier_errors == recent_errors
            else "More errors",
            "NO_DATA" if not errors and not completed else "GOOD" if recent_errors <= earlier_errors else "WATCH",
            [
                f"Errors in the earlier {days // 2} days: {earlier_errors}",
                f"Errors in the last {days // 2} days: {recent_errors}",
                f"End-of-shift reviews written: {len(reviews)}",
            ],
        ),
        _indicator(
            "documentation",
            "Documentation quality",
            _pct(len(documented), len(resolved)),
            status_for(len(documented) / len(resolved) if resolved else None, 0.9, 0.6),
            [f"{len(documented)} of {len(resolved)} resolved errors have a root cause and a prevention step"],
        ),
    ]
    return {"days": days, "indicators": indicators}


# ---------- 30 / 60 / 90 ----------


def development_plan(db: Session, user: User) -> dict:
    plan = ensure_plan(db, user)
    settings = get_user_settings(db, user)
    today = local_today(settings)
    goals = db.scalars(
        select(DevelopmentGoal)
        .where(DevelopmentGoal.user_id == user.id)
        .order_by(DevelopmentGoal.phase, DevelopmentGoal.position, DevelopmentGoal.created_at)
    ).all()

    day_number = (today - plan.start_date).days + 1 if plan.start_date else None
    phases = []
    for phase, title, first_day, last_day in PHASES:
        window = None
        evidence: dict | None = None
        if plan.start_date:
            p_start = plan.start_date + timedelta(days=first_day - 1)
            p_end = plan.start_date + timedelta(days=last_day - 1)
            window = {"start": p_start, "end": p_end}
            if p_start <= today:
                evidence = _phase_evidence(db, user, p_start, min(p_end, today), settings.timezone)
        phase_goals = [g for g in goals if g.phase == phase]
        phases.append(
            {
                "phase": phase,
                "title": title,
                "window": window,
                "status": _phase_status(day_number, first_day, last_day),
                "goals": [
                    {
                        "id": g.id,
                        "title": g.title,
                        "done": g.done,
                        "done_at": g.done_at,
                        "evidence": g.evidence,
                        "is_default": g.is_default,
                    }
                    for g in phase_goals
                ],
                "goals_done": sum(1 for g in phase_goals if g.done),
                "evidence": evidence,
            }
        )
    return {"start_date": plan.start_date, "day_number": day_number, "today": today, "phases": phases}


def _phase_status(day_number: int | None, first: int, last: int) -> str:
    if day_number is None:
        return "NOT_STARTED"
    if day_number > last:
        return "PAST"
    if day_number >= first:
        return "CURRENT"
    return "UPCOMING"


def _phase_evidence(db: Session, user: User, start_day: date, end_day: date, tz: str) -> dict:
    start, _ = day_window(start_day, tz)
    _, end = day_window(end_day, tz)

    def count(model, column) -> int:
        return len(db.scalars(select(model.id).where(model.user_id == user.id, column >= start, column < end)).all())

    completed = db.scalars(
        select(Task).where(
            Task.user_id == user.id, Task.status == "COMPLETED", Task.completed_at >= start, Task.completed_at < end
        )
    ).all()
    with_deadline = [t for t in completed if t.submission_deadline]
    return {
        "tasks_completed": len(completed),
        "on_time_rate": round(
            100 * sum(1 for t in with_deadline if t.completed_at <= t.submission_deadline) / len(with_deadline)
        )
        if with_deadline
        else None,
        "errors": count(ErrorReport, ErrorReport.created_at),
        "learning_completed": count(LearningItem, LearningItem.understood_at),
        "feedback_applied": count(Feedback, Feedback.applied_at),
        "shift_reviews": len(
            db.scalars(
                select(ShiftReview.id).where(
                    ShiftReview.user_id == user.id,
                    ShiftReview.review_date >= start_day,
                    ShiftReview.review_date <= end_day,
                )
            ).all()
        ),
    }


def mark_goal(goal: DevelopmentGoal, done: bool) -> None:
    goal.done = done
    goal.done_at = utcnow() if done else None


def skill_out(skill: Skill) -> dict:
    return {
        "id": skill.id,
        "name": skill.name,
        "level": skill.level,
        "evidence": skill.evidence,
        "is_default": skill.is_default,
        "history": skill.history or [],
        "updated_at": skill.updated_at,
    }


def record_skill_level(skill: Skill, level: int, when: datetime | None = None) -> None:
    if skill.level == level:
        return
    skill.level = level
    skill.history = [*(skill.history or []), {"level": level, "at": (when or utcnow()).isoformat()}]
