"""Daily planner and "What should I work on now?".

The plan is a recommendation that is recalculated on every request, so a new urgent task
immediately changes the order. It never reassigns work or changes task status.
"""

from datetime import datetime, time, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

from app.core.i18n import tr
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
        return tr(
            "Deadline passed. Inform the appropriate person per the SOP, then complete carefully",
            "Deadline sudah lewat. Beri tahu orang yang tepat sesuai SOP, lalu selesaikan dengan teliti",
        )
    if t["missing_documents"]:
        missing = ", ".join(t["missing_documents"])
        return tr(
            f"Request missing: {missing}. Continue verified parts meanwhile",
            f"Minta yang kurang: {missing}. Sambil menunggu, lanjutkan bagian yang sudah terverifikasi",
        )
    if t["open_issue_count"]:
        return tr("Verify the open issue against source documents", "Verifikasi masalah terbuka dengan dokumen sumber")
    if t["status"] == "IN_PROGRESS":
        return tr("Continue processing", "Lanjutkan pengerjaan")
    if t["status"] == "NEEDS_REVIEW":
        return tr("Review and verify before submission", "Cek dan verifikasi sebelum mengirim")
    return tr("Start processing", "Mulai kerjakan")


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
            tr(
                "Prioritise the critical tasks at the top of the queue first",
                "Dahulukan task kritis di urutan teratas",
            ),
            tr(
                "Review pending and waiting tasks to see which can be closed quickly",
                "Cek task yang tertunda dan menunggu, mana yang bisa cepat diselesaikan",
            ),
            tr(
                "Consider escalating deadline risks according to the SOP",
                "Pertimbangkan eskalasi risiko deadline sesuai SOP",
            ),
            tr(
                "Ask your supervisor for support or re-prioritisation if appropriate",
                "Minta bantuan atau penyesuaian prioritas ke supervisor kalau perlu",
            ),
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
        return tr(
            "You have no open tasks. Good moment to review notes or prepare for incoming work.",
            "Tidak ada task terbuka. Waktu yang pas untuk meninjau catatan atau bersiap untuk pekerjaan berikutnya.",
        )
    n = counts["open"]
    parts = [tr(f"You have {n} open task{'s' if n != 1 else ''}.", f"Kamu punya {n} task terbuka.")]
    if counts["critical"]:
        c = counts["critical"]
        parts.append(tr(f"{c} {'is' if c == 1 else 'are'} critical.", f"{c} di antaranya kritis."))
    if counts["blocked"]:
        b = counts["blocked"]
        parts.append(tr(f"{b} {'is' if b == 1 else 'are'} waiting on others.", f"{b} menunggu pihak lain."))
    if queue:
        first = _label(queue[0]["task"])
        parts.append(tr(f"{first} should be reviewed first.", f"{first} sebaiknya dicek lebih dulu."))
    if counts["at_risk"]:
        r = counts["at_risk"]
        parts.append(
            tr(
                f"At the current pace, {r} task{'s' if r != 1 else ''} may miss the deadline.",
                f"Dengan kecepatan sekarang, {r} task bisa melewati deadline.",
            )
        )
    if shift["status"] == "AFTER_SHIFT":
        parts.append(tr("Your shift has ended for today.", "Shift kamu hari ini sudah selesai."))
    return " ".join(parts)


def recommend_next(tasks: list[Task], settings: UserSettings, now: datetime) -> dict:
    """One clear recommendation, with the reasoning behind it."""
    plan = build_plan(tasks, settings, now)
    queue = plan["recommended_tasks"]
    if not queue:
        blocked = plan["blocked_tasks"]
        message = tr("There is no task you can work on right now.", "Belum ada task yang bisa dikerjakan sekarang.")
        if blocked:
            n = len(blocked)
            message += tr(
                f" {n} task{'s are' if n != 1 else ' is'} waiting on others. Check whether any answers have arrived.",
                f" {n} task menunggu pihak lain. Cek apakah sudah ada jawaban yang masuk.",
            )
        return {"recommendation": None, "follow_up": None, "explanation": message, "alternatives": []}

    top = queue[0]["task"]
    follow_up: Optional[dict] = None
    pick = top
    if top["missing_documents"]:
        follow_up = {
            "task": top,
            "action": tr(
                f"Request the missing document(s) for {_label(top)}: {', '.join(top['missing_documents'])}",
                f"Minta dokumen yang kurang untuk {_label(top)}: {', '.join(top['missing_documents'])}",
            ),
            "why": tr(
                "It is the most urgent task but cannot be fully completed without these documents. "
                "Sending the request now gives the sender time to respond.",
                "Ini task paling mendesak, tapi tidak bisa diselesaikan tanpa dokumen tersebut. "
                "Meminta sekarang memberi waktu pengirim untuk merespons.",
            ),
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
        text = tr(
            f"{label} is recommended because {' and '.join(reasons)}.",
            f"{label} direkomendasikan karena {' dan '.join(reasons)}.",
        )
    else:
        text = tr(
            f"{label} is the highest priority workable task right now.",
            f"{label} adalah task dengan prioritas tertinggi yang bisa dikerjakan sekarang.",
        )
    if t["deadline"]["overdue"]:
        text += tr(
            " The deadline has already passed, so inform the appropriate person according to "
            "the SOP while you complete it.",
            " Deadline sudah lewat, jadi beri tahu orang yang tepat sesuai SOP sambil kamu menyelesaikannya.",
        )
    if after_follow_up:
        text = (
            tr(
                "While waiting for the missing documents, continue with a task you can finish. ",
                "Sambil menunggu dokumen yang kurang, lanjutkan task yang bisa kamu selesaikan. ",
            )
            + text
        )

    state = []
    if not t["missing_documents"]:
        state.append(tr("the document set is complete", "dokumennya sudah lengkap"))
    if t["open_issue_count"]:
        n = t["open_issue_count"]
        state.append(
            tr(
                f"there {'is' if n == 1 else 'are'} {n} open issue(s) to verify first",
                f"ada {n} masalah terbuka yang perlu diverifikasi dulu",
            )
        )
    else:
        state.append(tr("no open issue has been recorded", "belum ada masalah terbuka yang dicatat"))
    joined = state[0][0].upper() + state[0][1:] + (tr(
        f" and {state[1]}.",
        f" dan {state[1]}.",
    ) if len(state) > 1 else ".")
    text += " " + joined
    minutes = t["deadline"]["minutes_remaining"]
    if minutes is not None and minutes >= 0:
        est, left = t["estimated_minutes"], format_duration(minutes)
        text += tr(
            f" Estimated processing time is {est}m with {left} left.",
            f" Perkiraan waktu pengerjaan {est}m dengan sisa waktu {left}.",
        )
    return text
