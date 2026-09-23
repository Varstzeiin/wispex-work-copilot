"""Fictional history for MVP 2 screens (reviews, error analytics, growth).

Everything here is invented. Shipment references use the SHP-2xx range so they never clash
with the open demo tasks.
"""

import random
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.models import (
    AuditLog,
    DevelopmentGoal,
    DevelopmentPlan,
    ErrorReport,
    Feedback,
    LearningItem,
    ShiftReview,
    Skill,
    Task,
    User,
    UserSettings,
    WeeklyReview,
)
from app.services.growth_service import DEFAULT_GOALS, DEFAULT_SKILLS
from app.services.review_service import local_today, week_start_of

DOCS = ["Commercial Invoice", "Packing List", "Bill of Lading"]


def _history_tasks(db: Session, user: User, now: datetime, rng: random.Random) -> list[Task]:
    tasks = []
    number = 200
    for days_ago in range(1, 36):
        day = now - timedelta(days=days_ago)
        if day.weekday() >= 5:  # weekends off
            continue
        for _ in range(rng.randint(2, 4)):
            number += 1
            deadline = day.replace(hour=4, minute=0, second=0, microsecond=0) + timedelta(hours=rng.randint(0, 8))
            late = rng.random() < 0.08
            completed = (
                deadline + timedelta(minutes=rng.randint(5, 40))
                if late
                else deadline - timedelta(minutes=rng.randint(10, 180))
            )
            actual = rng.randint(15, 45)
            task = Task(
                user_id=user.id,
                title=f"Import declaration data prep (SHP-{number})",
                status="COMPLETED",
                submission_deadline=deadline,
                estimated_minutes=25,
                actual_minutes=actual,
                required_documents=list(DOCS),
                available_documents=list(DOCS),
                issues=[],
                created_at=completed - timedelta(hours=6),
                updated_at=completed,
                started_at=completed - timedelta(minutes=actual),
                completed_at=completed,
            )
            db.add(task)
            tasks.append(task)
    db.flush()
    return tasks


def seed_performance(db: Session, user: User, settings: UserSettings, now: datetime) -> None:
    rng = random.Random(7)  # deterministic demo
    history = _history_tasks(db, user, now, rng)

    # A few recorded discrepancies on past tasks, weight related
    for i, task in enumerate(history[:3]):
        task.issues = [
            {
                "id": f"demo-w{i}",
                "type": "WEIGHT_MISMATCH",
                "description": "Gross weight on Invoice and Packing List differed. Confirmed with senior",
                "resolved": True,
                "created_at": (task.completed_at - timedelta(minutes=20)).isoformat(),
                "resolved_at": task.completed_at.isoformat(),
            }
        ]

    # Escalations on some past tasks (escalating when needed is good behaviour)
    for task in history[5:9]:
        db.add(
            AuditLog(
                user_id=user.id,
                action="TASK_ESCALATED",
                entity="task",
                entity_id=str(task.id),
                timestamp=task.completed_at - timedelta(minutes=30),
                previous_state={"status": "IN_PROGRESS"},
                new_state={"status": "ESCALATED"},
            )
        )

    def err(days_ago: float, **kw) -> ErrorReport:
        discovered = now - timedelta(days=days_ago)
        delay = kw.pop("delay", 10)
        report = ErrorReport(
            user_id=user.id,
            discovered_at=discovered,
            created_at=discovered + timedelta(minutes=delay),
            updated_at=discovered,
            **kw,
        )
        db.add(report)
        return report

    resolved = dict(
        status="RESOLVED",
        notified_person="Supervisor",
        correction_notes="Corrected value prepared",
        instructions="Supervisor asked to submit an amendment",
        resolution="Amendment submitted and confirmed",
    )
    errors = [
        err(
            26,
            shipment_reference="SHP-204",
            field_name="Invoice number",
            incorrect_value="INV-0O12",
            correct_value="INV-0012",
            source_document="Commercial Invoice",
            category="TYPOGRAPHICAL",
            severity="LOW",
            impact="Reference mismatch in the declaration",
            root_cause="TYPOGRAPHICAL",
            root_cause_notes="Letter O typed instead of zero",
            prevention_action="Read references character by character",
            **resolved,
        ),
        err(
            19,
            shipment_reference="SHP-219",
            field_name="Currency",
            incorrect_value="USD",
            correct_value="EUR",
            source_document="Commercial Invoice",
            category="DATA_ENTRY",
            severity="HIGH",
            impact="Declared value would be wrong",
            root_cause="DATA_ENTRY",
            root_cause_notes="Copied from the previous shipment of the same client",
            prevention_action="Never copy values from a previous shipment without checking the source",
            **resolved,
        ),
        err(
            12,
            shipment_reference="SHP-231",
            field_name="Weight",
            incorrect_value="850 KG",
            correct_value="890 KG",
            source_document="Packing List",
            category="DATA_READING",
            severity="MEDIUM",
            impact="Weight differs from the transport document",
            root_cause="DATA_READING",
            root_cause_notes="Used net weight instead of gross weight",
            prevention_action="",
            **resolved,
        ),
        err(
            8,
            shipment_reference="SHP-238",
            field_name="Weight",
            incorrect_value="1,250 KG",
            correct_value="1,205 KG",
            source_document="Packing List",
            category="DATA_ENTRY",
            severity="MEDIUM",
            impact="Weight differs from the transport document",
            **resolved,
        ),
        err(
            3,
            shipment_reference="SHP-244",
            field_name="Weight",
            incorrect_value="12.5 KG",
            correct_value="125 KG",
            source_document="Air Waybill",
            category="DATA_ENTRY",
            severity="HIGH",
            impact="Large difference that could delay clearance",
            status="CORRECTING",
            notified_person="Senior officer",
            correction_notes="Amendment prepared with 125 KG",
            delay=25,
        ),
        err(
            0.05,
            shipment_reference="SHP-009",
            field_name="Package count",
            incorrect_value="12",
            correct_value="21",
            source_document="Packing List",
            category="DATA_READING",
            severity="MEDIUM",
            impact="Package count differs from the Packing List",
            status="NOTIFIED",
            notified_person="Supervisor",
            delay=5,
        ),
    ]
    db.flush()
    for report in errors:
        if report.status in ("NOTIFIED", "CORRECTING", "RESOLVED"):
            report.notified_at = report.created_at + timedelta(minutes=10)
        if report.status == "RESOLVED":
            report.resolved_at = report.created_at + timedelta(hours=rng.randint(1, 5))
        report.submitted_at = report.discovered_at - timedelta(hours=3)

    # Learning tracker
    def learn(title, category, status, days_ago, source="Training", notes=""):
        item = LearningItem(
            user_id=user.id,
            title=title,
            category=category,
            status=status,
            source=source,
            notes=notes,
            created_at=now - timedelta(days=days_ago),
            understood_at=now - timedelta(days=max(days_ago - 3, 0)) if status in ("UNDERSTOOD", "APPLIED") else None,
        )
        db.add(item)

    learn("Commercial Invoice: key fields and where to find them", "DOCUMENT", "APPLIED", 38)
    learn("Packing List: gross vs net weight", "DOCUMENT", "APPLIED", 30, notes="Gross weight includes packaging")
    learn("Bill of Lading vs Air Waybill", "DOCUMENT", "UNDERSTOOD", 25)
    learn("Submission deadline procedure (SOP reference)", "SOP", "UNDERSTOOD", 20, source="Team SOP folder")
    learn("When to escalate a document discrepancy", "SOP", "LEARNING", 10, source="Supervisor")
    learn("Amendment procedure after submission", "PROCEDURE", "LEARNING", 3, source="Senior officer")
    learn("Incoterms basics", "TERMINOLOGY", "TO_LEARN", 2, source="Self-study")
    learn("Explicit weight verification step before submission", "LESSON", "TO_LEARN", 1, source="Error analysis")

    # Feedback (roles only, no names)
    fb = [
        (
            "Supervisor",
            28,
            "Questions are clearer when they include the shipment reference and the deadline",
            "Use Context, Issue, Evidence, Deadline, Question",
            True,
            "Last 5 questions followed the format",
        ),
        (
            "Senior officer",
            17,
            "Double-check currency against the invoice header, not the previous shipment",
            "Check currency on the source document every time",
            True,
            "No currency errors since",
        ),
        (
            "Supervisor",
            6,
            "Report errors immediately, even if you are not fully sure yet",
            "Report first, verify details in parallel",
            False,
            "",
        ),
    ]
    for role, days_ago, summary, plan, applied, evidence in fb:
        received = now - timedelta(days=days_ago)
        db.add(
            Feedback(
                user_id=user.id,
                from_role=role,
                received_at=received,
                summary=summary,
                action_plan=plan,
                applied=applied,
                applied_at=received + timedelta(days=4) if applied else None,
                applied_evidence=evidence,
                created_at=received,
            )
        )

    # Skill matrix with history
    levels = [3, 3, 2, 2, 2, 3, 1, 2]
    for name, level in zip(DEFAULT_SKILLS, levels, strict=True):
        history = [{"level": lv, "at": (now - timedelta(days=35 - 10 * lv)).isoformat()} for lv in range(1, level + 1)]
        db.add(
            Skill(
                user_id=user.id,
                name=name,
                level=level,
                is_default=True,
                history=history,
                evidence="Confirmed during daily work" if level >= 3 else "",
            )
        )

    # 30 / 60 / 90 plan: currently in the 60-day phase
    today = local_today(settings)
    db.add(DevelopmentPlan(user_id=user.id, start_date=today - timedelta(days=40)))
    done_map = {30: [True, True, True, False], 60: [False, False, False, True], 90: [False] * 4}
    for phase, titles in DEFAULT_GOALS.items():
        for position, title in enumerate(titles):
            done = done_map[phase][position]
            db.add(
                DevelopmentGoal(
                    user_id=user.id,
                    phase=phase,
                    title=title,
                    is_default=True,
                    position=position,
                    done=done,
                    done_at=now - timedelta(days=15 - position) if done else None,
                    evidence=(
                        "Checked with supervisor in week 3"
                        if done and phase == 30
                        else "2 of 3 feedback items applied, with evidence"
                        if done
                        else ""
                    ),
                )
            )

    # A few saved reflections
    for days_ago in (1, 2, 5):
        day = today - timedelta(days=days_ago)
        db.add(
            ShiftReview(
                user_id=user.id,
                review_date=day,
                stats={"tasks_completed": 3, "errors": 0},
                went_well="Checked all weights against the Packing List",
                to_improve="Ask earlier when a document is unclear",
                tomorrow_focus="Start with the earliest deadline",
            )
        )
    db.add(
        WeeklyReview(
            user_id=user.id,
            week_start=week_start_of(today) - timedelta(days=7),
            stats={"tasks_completed": 14},
            went_well="All deadlines met",
            to_improve="Weight verification",
            next_week_focus="Weight check before submit",
        )
    )
