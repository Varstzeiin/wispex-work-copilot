from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.tasks import refresh_open_priorities
from app.core.database import get_db, utcnow
from app.core.i18n import tr
from app.core.security import get_current_user
from app.models import User
from app.rules.deadline_rules import format_duration, merged_thresholds
from app.services import planner_service
from app.services.settings_service import get_user_settings
from app.services.task_service import serialize_task

router = APIRouter(tags=["planner"])


@router.get("/planner/today")
def daily_plan(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    tasks = refresh_open_priorities(db, user)
    return planner_service.build_plan(tasks, get_user_settings(db, user), utcnow())


@router.get("/planner/next")
def what_should_i_work_on_now(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    tasks = refresh_open_priorities(db, user)
    return planner_service.recommend_next(tasks, get_user_settings(db, user), utcnow())


@router.get("/notifications")
def notifications(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Deadline alerts derived from current tasks. The client de-duplicates what it has shown.

    Only three kinds, to avoid notification fatigue: overdue, critical, approaching critical.
    """
    settings = get_user_settings(db, user)
    tasks = refresh_open_priorities(db, user)
    now = utcnow()
    thresholds = merged_thresholds(settings.deadline_thresholds)
    alerts = []
    for task in tasks:
        t = serialize_task(task, settings, now)
        d = t["deadline"]
        label = t["shipment_reference"] or t["title"]
        left = format_duration(d["minutes_remaining"]) if d["minutes_remaining"] is not None else ""
        if d["overdue"]:
            kind, message = "OVERDUE", tr(f"Deadline passed. {d['label']}", f"Deadline sudah lewat. {d['label']}")
        elif d["status"] == "CRITICAL":
            kind, message = "CRITICAL", tr(f"Deadline in {left}", f"Deadline {left} lagi")
        elif d["approaching_critical"]:
            kind, message = (
                "APPROACHING",
                tr(f"Becomes critical soon. Deadline in {left}", f"Segera jadi kritis. Deadline {left} lagi"),
            )
        else:
            continue
        alerts.append(
            {
                "task_id": t["id"],
                "kind": kind,
                "title": label,
                "message": message,
                "minutes_remaining": d["minutes_remaining"],
                "created_recently": (now - task.created_at).total_seconds() < 30 * 60,
            }
        )
    alerts.sort(key=lambda a: a["minutes_remaining"] if a["minutes_remaining"] is not None else 0)
    return {"alerts": alerts, "thresholds": thresholds, "prefs": settings.notification_prefs or {}}
