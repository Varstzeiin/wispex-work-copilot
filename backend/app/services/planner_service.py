"""Daily planner and "What should I work on now?".

The plan is a recommendation that is recalculated on every request, so a new urgent task
immediately changes the order. It never reassigns work or changes task status.
"""

from datetime import datetime, time, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

from app.models import Task, UserSettings
from app.rules.deadline_rules import format_duration
from app.services.priority_service import LEVEL_RANK
from app.services.task_service import serialize_task

WORKABLE = ("NEW", "IN_PROGRESS", "NEEDS_REVIEW")
BLOCKED = ("WAITING", "ESCALATED", "ON_HOLD")


def _parse_hhmm(value: str) -> time:
    hours, minutes = value.split(":")
    return time(int(hours), int(minutes))


def shift_window(now: datetime, settings: UserSettings) -> dict:
    """Find the current (or next) shift window. Handles overnight shifts like 22:00-06:00."""
    tz = ZoneInfo(settings.timezone)
    local_now = now.astimezone(tz)
    start_t, end_t = _parse_hhmm(settings.shift_start), _parse_hhmm(settings.shift_end)
    duration = (
        datetime.combine(local_now.date(), end_t) - datetime.combine(local_now.date(), start_t)
    ) % timedelta(days=1) or timedelta(days=1)

    windows = []
    for day_offset in (-1, 0, 1):
        day = local_now.date() + timedelta(days=day_offset)
        start = datetime.combine(day, start_t, tzinfo=tz)
        windows.append((start, start + duration))

    for start, end in windows:
        if start <= local_now < end:
            available = int((end - local_now).total_seconds() // 60)
            return {"status": "ON_SHIFT", "start": start, "end": end, "available_minutes": available}
    upcoming = [w for w in windows if w[0] > local_now]
    start, end = upcoming[0]
    # Only count the next shift as "available" if it starts today (local)
    if start.date() == local_now.date():
        return {
            "status": "BEFORE_SHIFT",
            "start": start,
            "end": end,
            "available_minutes": int(duration.total_seconds() // 60),
        }
    return {"status": "AFTER_SHIFT", "start": start, "end": end, "available_minutes": 0}


def _sort_key(task_dict: dict):
    # Level first, so a task with an imminent deadline is never ranked below a HIGH one
    deadline = task_dict["submission_deadline"]
    return (
        LEVEL_RANK.get(task_dict["priority_level"], 9),
        -task_dict["priority_score"],
        deadline.timestamp() if deadline else float("inf"),
    )


def _next_action(t: dict) -> str:
    if t["deadline"]["overdue"]:
        return "Deadline passed. Inform the appropriate person per the SOP, then complete carefully"
    if t["missing_documents"]:
        return f"Request missing: {', '.join(t['missing_documents'])}. Continue verified parts meanwhile"
    if t["open_issue_count"]:
        return "Verify the open issue against source documents"
    if t["status"] == "IN_PROGRESS":
        return "Continue processing"
    if t["status"] == "NEEDS_REVIEW":
        return "Review and verify before submission"
    return "Start processing"


def _label(t: dict) -> str:
    return t["shipment_reference"] or t["title"]


def build_plan(tasks: list[Task], settings: UserSettings, now: datetime) -> dict:
    serialized = [serialize_task(t, settings, now) for t in tasks if not t.is_closed]
    workable = sorted([t for t in serialized if t["status"] in WORKABLE], key=_sort_key)
    blocked = sorted([t for t in serialized if t["status"] in BLOCKED], key=_sort_key)

    shift = shift_window(now, settings)
    cursor = max(now, shift["start"])
    queue = []
    for index, t in enumerate(workable, start=1):
        start = cursor
        end = start + timedelta(minutes=t["estimated_minutes"])
        cursor = end
        deadline = t["submission_deadline"]
        queue.append(
            {
                "position": index,
                "task": t,
                "projected_start": start,
                "projected_end": end,
                "at_risk": bool(deadline and end > deadline),
                "next_action": _next_action(t),
            }
        )

    workload = sum(t["estimated_minutes"] for t in workable)
    available = shift["available_minutes"]
    shortfall = max(0, workload - available)
    at_risk = [q for q in queue if q["at_risk"]]
    follow_ups = [
        {"task_id": t["id"], "label": _label(t), "missing_documents": t["missing_documents"]}
        for t in workable
        if t["missing_documents"]
    ]

    suggestions = []
    if shortfall:
        suggestions = [
            "Prioritise the critical tasks at the top of the queue first",
            "Review pending and waiting tasks to see which can be closed quickly",
            "Consider escalating deadline risks according to the SOP",
            "Ask your supervisor for support or re-prioritisation if appropriate",
        ]

    counts = {
        "open": len(serialized),
        "workable": len(workable),
        "blocked": len(blocked),
        "critical": sum(1 for t in serialized if t["priority_level"] == "CRITICAL"),
        "high": sum(1 for t in serialized if t["priority_level"] == "HIGH"),
        "overdue": sum(1 for t in serialized if t["deadline"]["overdue"]),
        "at_risk": len(at_risk),
    }

    return {
        "generated_at": now,
        "shift": shift,
        "counts": counts,
        "summary": _plan_summary(counts, queue, shift),
        "estimated_workload_minutes": workload,
        "estimated_completion_time": cursor if queue else None,
        "overload": {
            "is_overloaded": shortfall > 0,
            "workload_minutes": workload,
            "available_minutes": available,
            "shortfall_minutes": shortfall,
            "suggestions": suggestions,
        },
        "follow_ups": follow_ups,
        "recommended_tasks": queue,
        "blocked_tasks": blocked,
    }


def _plan_summary(counts: dict, queue: list[dict], shift: dict) -> str:
    if counts["open"] == 0:
        return "You have no open tasks. Good moment to review notes or prepare for incoming work."
    parts = [f"You have {counts['open']} open task{'s' if counts['open'] != 1 else ''}."]
    if counts["critical"]:
        parts.append(f"{counts['critical']} {'is' if counts['critical'] == 1 else 'are'} critical.")
    if counts["blocked"]:
        parts.append(f"{counts['blocked']} {'is' if counts['blocked'] == 1 else 'are'} waiting on others.")
    if queue:
        parts.append(f"{_label(queue[0]['task'])} should be reviewed first.")
    if counts["at_risk"]:
        parts.append(
            f"At the current pace, {counts['at_risk']} task{'s' if counts['at_risk'] != 1 else ''} "
            "may miss the deadline."
        )
    if shift["status"] == "AFTER_SHIFT":
        parts.append("Your shift has ended for today.")
    return " ".join(parts)


def recommend_next(tasks: list[Task], settings: UserSettings, now: datetime) -> dict:
    """One clear recommendation, with the reasoning behind it."""
    plan = build_plan(tasks, settings, now)
    queue = plan["recommended_tasks"]
    if not queue:
        blocked = plan["blocked_tasks"]
        message = "There is no task you can work on right now."
        if blocked:
            message += (
                f" {len(blocked)} task{'s are' if len(blocked) != 1 else ' is'} waiting on others. "
                "Check whether any answers have arrived."
            )
        return {"recommendation": None, "follow_up": None, "explanation": message, "alternatives": []}

    top = queue[0]["task"]
    follow_up: Optional[dict] = None
    pick = top
    if top["missing_documents"]:
        follow_up = {
            "task": top,
            "action": f"Request the missing document(s) for {_label(top)}: {', '.join(top['missing_documents'])}",
            "why": "It is the most urgent task but cannot be fully completed without these documents. "
            "Sending the request now gives the sender time to respond.",
        }
        complete = next((q["task"] for q in queue[1:] if not q["task"]["missing_documents"]), None)
        if complete:
            pick = complete

    explanation = _explain(pick, follow_up is not None and pick is not top)
    alternatives = [
        {
            "task_id": q["task"]["id"],
            "label": _label(q["task"]),
            "priority_level": q["task"]["priority_level"],
            "priority_score": q["task"]["priority_score"],
            "deadline_label": q["task"]["deadline"]["label"],
        }
        for q in queue
        if q["task"]["id"] not in (pick["id"], top["id"])
    ][:3]
    return {
        "recommendation": pick,
        "follow_up": follow_up,
        "explanation": explanation,
        "alternatives": alternatives,
        "summary": plan["summary"],
    }


def _explain(t: dict, after_follow_up: bool) -> str:
    label = _label(t)
    reasons = [r[0].lower() + r[1:] for r in t["priority_reasons"][:2]]
    if reasons:
        text = f"{label} is recommended because {' and '.join(reasons)}."
    else:
        text = f"{label} is the highest priority workable task right now."
    if t["deadline"]["overdue"]:
        text += (
            " The deadline has already passed, so inform the appropriate person according to "
            "the SOP while you complete it."
        )
    if after_follow_up:
        text = "While waiting for the missing documents, continue with a task you can finish. " + text

    state = []
    if not t["missing_documents"]:
        state.append("the document set is complete")
    if t["open_issue_count"]:
        state.append(
            f"there {'is' if t['open_issue_count'] == 1 else 'are'} {t['open_issue_count']} "
            "open issue(s) to verify first"
        )
    else:
        state.append("no open issue has been recorded")
    text += " " + state[0][0].upper() + state[0][1:] + (f" and {state[1]}." if len(state) > 1 else ".")
    minutes = t["deadline"]["minutes_remaining"]
    if minutes is not None and minutes >= 0:
        text += f" Estimated processing time is {t['estimated_minutes']}m with {format_duration(minutes)} left."
    return text
