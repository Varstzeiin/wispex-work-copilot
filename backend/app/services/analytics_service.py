"""MVP 5: workload forecast, pattern detection, process improvement suggestions and analytics.

Everything is calculated from the user's own records with simple, explainable rules. Nothing here
changes tasks, settings or assignments: forecasts and suggestions are information for the user.
Patterns per named client are only calculated when the user confirmed that this is permitted.
"""

import statistics
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_or_create_user_row, utcnow
from app.models import AutomationSettings, ErrorReport, Task, User, UserSettings
from app.services.planner_service import _parse_hhmm, shift_window
from app.services.settings_service import get_user_settings

HISTORY_DAYS = 56  # 8 weeks
MIN_SAMPLE = 5  # never draw a conclusion from fewer tasks than this
WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
MISMATCH_LABEL = {
    "QUANTITY_MISMATCH": "Quantity",
    "WEIGHT_MISMATCH": "Weight",
    "DESCRIPTION_MISMATCH": "Description",
    "VALUE_MISMATCH": "Value",
}


def get_automation_settings(db: Session, user: User) -> AutomationSettings:
    return get_or_create_user_row(db, AutomationSettings, user.id)


def _shift_minutes(settings: UserSettings) -> int:
    start, end = _parse_hhmm(settings.shift_start), _parse_hhmm(settings.shift_end)
    minutes = (end.hour * 60 + end.minute) - (start.hour * 60 + start.minute)
    return minutes % (24 * 60) or 24 * 60


def _history(db: Session, user: User, now: datetime, days: int = HISTORY_DAYS) -> list[Task]:
    return list(
        db.scalars(
            select(Task).where(
                Task.user_id == user.id,
                Task.status == "COMPLETED",
                Task.completed_at >= now - timedelta(days=days),
            )
        ).all()
    )


def _mode(task: Task) -> Optional[str]:
    return task.shipment.transport_mode if task.shipment else None


def _ratio(tasks: list[Task]) -> tuple[float, int]:
    """Median of actual / estimated minutes."""
    ratios = [t.actual_minutes / t.estimated_minutes for t in tasks if t.actual_minutes and t.estimated_minutes]
    return (statistics.median(ratios), len(ratios)) if ratios else (1.0, 0)


def calibration(history: list[Task]) -> dict:
    overall, n = _ratio(history)
    by_mode = {}
    for mode in ("SEA", "AIR"):
        ratio, count = _ratio([t for t in history if _mode(t) == mode])
        if count >= MIN_SAMPLE:
            by_mode[mode] = {"ratio": round(ratio, 2), "tasks": count}
    return {"ratio": round(overall, 2), "tasks": n, "by_mode": by_mode}


def _factor(task: Task, cal: dict) -> float:
    mode = _mode(task)
    if mode in cal["by_mode"]:
        ratio = cal["by_mode"][mode]["ratio"]
    elif cal["tasks"] >= MIN_SAMPLE:
        ratio = cal["ratio"]
    else:
        ratio = 1.0
    return min(2.0, max(0.5, ratio))  # a few extreme tasks never distort the forecast


# ---------- Workload forecast ----------


def forecast(db: Session, user: User, days: int = 5) -> dict:
    """Known work (deadlines) versus typical work (history) versus shift capacity, per working day."""
    now = utcnow()
    settings = get_user_settings(db, user)
    tz = ZoneInfo(settings.timezone)
    today = now.astimezone(tz).date()
    history = _history(db, user, now)
    cal = calibration(history)
    shift = _shift_minutes(settings)

    # Typical load per weekday: minutes actually spent on tasks due that weekday, per occurrence
    first = min((t.submission_deadline or t.completed_at for t in history), default=None)
    window_start = max(today - timedelta(days=HISTORY_DAYS), first.astimezone(tz).date()) if first else today
    occurrences = Counter((window_start + timedelta(days=i)).weekday() for i in range((today - window_start).days))
    spent: dict[int, int] = defaultdict(int)
    active_weeks: dict[int, set] = defaultdict(set)
    for t in history:
        local = (t.submission_deadline or t.completed_at).astimezone(tz).date()
        spent[local.weekday()] += t.actual_minutes or t.estimated_minutes
        active_weeks[local.weekday()].add(local.isocalendar()[:2])
    typical = {wd: round(spent[wd] / occurrences[wd]) if occurrences[wd] else 0 for wd in range(7)}
    # Working days: weekdays with work in at least two different weeks. Without history: Monday to Friday.
    if len(history) >= 10:
        working = {wd for wd, weeks in active_weeks.items() if len(weeks) >= 2}
    else:
        working = {0, 1, 2, 3, 4}

    open_tasks = db.scalars(
        select(Task).where(Task.user_id == user.id, Task.status.not_in(("COMPLETED", "CANCELLED")))
    ).all()
    committed: dict[date, list[Task]] = defaultdict(list)
    unscheduled = []
    for t in open_tasks:
        if t.submission_deadline is None:
            unscheduled.append(t)
            continue
        due = t.submission_deadline.astimezone(tz).date()
        committed[max(due, today)].append(t)  # overdue work lands on today

    current = shift_window(now, settings)
    out_days = []
    day = today
    while len(out_days) < days and (day - today).days < 14:
        if day.weekday() in working or committed.get(day):
            tasks = committed.get(day, [])
            known = round(sum(t.estimated_minutes * _factor(t, cal) for t in tasks))
            if day == today:
                capacity = current["available_minutes"]
                # Only the part of a typical day that is still ahead
                usual = round(typical[day.weekday()] * (capacity / shift)) if shift else 0
            else:
                capacity = shift if day.weekday() in working else 0
                usual = typical[day.weekday()]
            expected = max(known, usual)
            if expected == 0:
                status = "OK"
            elif capacity == 0 or expected > capacity:
                status = "OVER"
            elif expected > 0.85 * capacity:
                status = "TIGHT"
            else:
                status = "OK"
            out_days.append(
                {
                    "date": day.isoformat(),
                    "label": "Today" if day == today else f"{WEEKDAYS[day.weekday()]} {day:%d %b}",
                    "known_minutes": known,
                    "known_tasks": len(tasks),
                    "typical_minutes": usual,
                    "expected_minutes": expected,
                    "capacity_minutes": capacity,
                    "status": status,
                    "explanation": _day_explanation(len(tasks), known, usual, capacity, status),
                    "task_refs": [
                        {"id": t.id, "label": t.shipment.reference if t.shipment else t.title} for t in tasks[:8]
                    ],
                }
            )
        day += timedelta(days=1)

    advice = []
    over = [d for d in out_days if d["status"] == "OVER"]
    if over:
        first_over = over[0]
        advice.append(
            f"{first_over['label']} looks over capacity. Consider starting some of its tasks earlier, and tell "
            "your supervisor early if you will need support. Work is never reassigned automatically."
        )
    if unscheduled:
        advice.append(f"{len(unscheduled)} open task(s) have no deadline and are not in the forecast.")
    if cal["tasks"] >= MIN_SAMPLE and cal["ratio"] >= 1.15:
        advice.append(
            f"Your tasks usually take {round((cal['ratio'] - 1) * 100)}% longer than estimated, "
            "so the forecast already scales your estimates up."
        )

    return {
        "days": out_days,
        "shift_minutes": shift,
        "calibration": cal,
        "unscheduled_tasks": len(unscheduled),
        "history_tasks": len(history),
        "advice": advice,
        "note": "A forecast from your own history and deadlines. It can be wrong: new urgent work is not known yet.",
    }


def _day_explanation(count: int, known: int, usual: int, capacity: int, status: str) -> str:
    parts = [f"{count} task(s) due, about {known} min" if count else "No tasks due yet"]
    if usual > known:
        parts.append(f"a typical day like this needs about {usual} min")
    parts.append(f"{capacity} min of shift available" if capacity else "outside your shift")
    return ". ".join(p[0].upper() + p[1:] for p in parts) + "."


# ---------- Patterns and improvement suggestions ----------


def _issue_types(task: Task) -> list[str]:
    return [i.get("type", "OTHER") for i in task.issues or []]


def _had_missing_documents(task: Task) -> bool:
    return "MISSING_INFORMATION" in _issue_types(task) or (task.status == "WAITING" and bool(task.missing_documents))


def _pct(part: int, whole: int) -> int:
    return round(100 * part / whole) if whole else 0


def patterns(db: Session, user: User, days: int = 90) -> dict:
    now = utcnow()
    start = now - timedelta(days=days)
    settings = get_user_settings(db, user)
    tz = ZoneInfo(settings.timezone)
    auto = get_automation_settings(db, user)
    tasks = list(db.scalars(select(Task).where(Task.user_id == user.id, Task.created_at >= start)).all())
    completed = [t for t in tasks if t.status == "COMPLETED" and t.completed_at]
    findings: list[dict] = []

    # 1. Estimate accuracy per transport mode
    for mode, label in (("AIR", "Air"), ("SEA", "Sea")):
        ratio, n = _ratio([t for t in completed if _mode(t) == mode])
        if n >= MIN_SAMPLE and ratio >= 1.2:
            est = statistics.median(t.estimated_minutes for t in completed if _mode(t) == mode and t.actual_minutes)
            findings.append(
                {
                    "key": f"ESTIMATE:{mode}",
                    "kind": "ESTIMATE",
                    "scope": "all",
                    "title": f"{label} shipments take longer than estimated",
                    "evidence": f"Median {round((ratio - 1) * 100)}% over the estimate across {n} completed "
                    f"{label.lower()} tasks.",
                    "suggestion": f"Use about {round(est * ratio)} min instead of {round(est)} min when you estimate "
                    f"{label.lower()} tasks, so your daily plan stays realistic.",
                }
            )

    # 2. Missing documents
    with_missing = [t for t in tasks if _had_missing_documents(t)]
    if len(tasks) >= MIN_SAMPLE and _pct(len(with_missing), len(tasks)) >= 20:
        findings.append(
            {
                "key": "MISSING:all",
                "kind": "MISSING_DOCUMENTS",
                "scope": "all",
                "title": "Documents are often missing when work starts",
                "evidence": f"{len(with_missing)} of {len(tasks)} tasks in the last {days} days had missing documents.",
                "suggestion": "Request the complete document set (Invoice, Packing List, BL/AWB) as soon as a "
                "shipment is announced, not when you start the task.",
            }
        )

    # 3. Most common discrepancy type
    mismatches = Counter(x for t in tasks for x in _issue_types(t) if x in MISMATCH_LABEL)
    if mismatches:
        kind, count = mismatches.most_common(1)[0]
        if count >= 3:
            findings.append(
                {
                    "key": f"MISMATCH:{kind}",
                    "kind": "DISCREPANCY",
                    "scope": "all",
                    "title": f"{MISMATCH_LABEL[kind]} is your most common document discrepancy",
                    "evidence": f"{count} {MISMATCH_LABEL[kind].lower()} mismatches recorded in the last {days} days.",
                    "suggestion": f"Compare {MISMATCH_LABEL[kind].lower()} across Invoice, Packing List and BL/AWB "
                    "first, before entering other fields.",
                }
            )

    # 4. When errors happen (time the work was submitted)
    errors = db.scalars(
        select(ErrorReport).where(ErrorReport.user_id == user.id, ErrorReport.created_at >= start)
    ).all()
    hours = [(e.submitted_at or e.discovered_at).astimezone(tz).hour for e in errors]
    if len(hours) >= 4:
        late = [h for h in hours if h >= _parse_hhmm(settings.shift_end).hour - 2]
        if _pct(len(late), len(hours)) >= 50:
            findings.append(
                {
                    "key": "ERRORS:late_shift",
                    "kind": "TIMING",
                    "scope": "all",
                    "title": "Errors cluster at the end of your shift",
                    "evidence": f"{len(late)} of {len(hours)} errors came from work submitted in the last two "
                    "hours of your shift.",
                    "suggestion": "Plan a short second check for work you submit near the end of your shift.",
                }
            )

    # 5. Busiest weekday
    load: dict[int, list[int]] = defaultdict(list)
    for t in completed:
        load[(t.submission_deadline or t.completed_at).astimezone(tz).weekday()].append(t.actual_minutes or 0)
    totals = {wd: sum(v) for wd, v in load.items()}
    if len(completed) >= 15 and len(totals) >= 3:
        busiest = max(totals, key=totals.get)
        share = _pct(totals[busiest], sum(totals.values()))
        if share >= 100 / len(totals) * 1.25:
            findings.append(
                {
                    "key": f"PEAK:{busiest}",
                    "kind": "WORKLOAD",
                    "scope": "all",
                    "title": f"{WEEKDAYS[busiest]} is your busiest day",
                    "evidence": f"{share}% of your processing time in the last {days} days fell on "
                    f"{WEEKDAYS[busiest]}s.",
                    "suggestion": f"Keep {WEEKDAYS[busiest]}s free of non-urgent work such as learning or admin.",
                }
            )

    # 6. Per named client, only when permitted
    if auto.client_patterns_allowed:
        findings += _client_findings(tasks, days)

    handled = set(auto.handled_suggestions or [])
    return {
        "days": days,
        "tasks_analysed": len(tasks),
        "client_patterns_allowed": auto.client_patterns_allowed,
        "findings": [{**f, "handled": f["key"] in handled} for f in findings],
        "note": "Patterns from your own records. They describe what happened, not who is to blame.",
    }


def _client_findings(tasks: list[Task], days: int) -> list[dict]:
    out = []
    by_client: dict[str, list[Task]] = defaultdict(list)
    names = {}
    for t in tasks:
        if t.client:
            by_client[str(t.client.id)].append(t)
            names[str(t.client.id)] = t.client.name
    for cid, items in sorted(by_client.items(), key=lambda kv: names[kv[0]]):
        if len(items) < MIN_SAMPLE:
            continue
        name = names[cid]
        miss = [t for t in items if _had_missing_documents(t)]
        if _pct(len(miss), len(items)) >= 30:
            out.append(
                {
                    "key": f"MISSING:{cid}",
                    "kind": "MISSING_DOCUMENTS",
                    "scope": name,
                    "title": f"{name}: documents often arrive late",
                    "evidence": f"{len(miss)} of {len(items)} {name} tasks in the last {days} days had "
                    "missing documents.",
                    "suggestion": f"Ask {name} (or their forwarder) for the complete document set at booking.",
                }
            )
        mism = Counter(x for t in items for x in _issue_types(t) if x in MISMATCH_LABEL)
        if mism:
            kind, count = mism.most_common(1)[0]
            if count >= 3 and _pct(count, len(items)) >= 20:
                out.append(
                    {
                        "key": f"MISMATCH:{cid}:{kind}",
                        "kind": "DISCREPANCY",
                        "scope": name,
                        "title": f"{name}: frequent {MISMATCH_LABEL[kind].lower()} discrepancies",
                        "evidence": f"{count} {MISMATCH_LABEL[kind].lower()} mismatches on {len(items)} {name} tasks.",
                        "suggestion": f"For {name} shipments, check {MISMATCH_LABEL[kind].lower()} across all "
                        "documents first.",
                    }
                )
        done = [t for t in items if t.status == "COMPLETED" and t.submission_deadline and t.completed_at]
        if len(done) >= MIN_SAMPLE:
            on_time = sum(1 for t in done if t.completed_at <= t.submission_deadline)
            if _pct(on_time, len(done)) < 80:
                out.append(
                    {
                        "key": f"ONTIME:{cid}",
                        "kind": "DEADLINES",
                        "scope": name,
                        "title": f"{name}: deadlines are harder to meet",
                        "evidence": f"{on_time} of {len(done)} {name} tasks were completed before the deadline.",
                        "suggestion": f"Start {name} tasks earlier in the day, and flag missing items to them early.",
                    }
                )
    return out


def handle_suggestion(db: Session, user: User, key: str) -> None:
    auto = get_automation_settings(db, user)
    if key not in (auto.handled_suggestions or []):
        auto.handled_suggestions = [*(auto.handled_suggestions or []), key]


def find_suggestion(db: Session, user: User, key: str) -> Optional[dict]:
    return next((f for f in patterns(db, user)["findings"] if f["key"] == key), None)


# ---------- Analytics ----------


def analytics(db: Session, user: User, weeks: int = 8) -> dict:
    now = utcnow()
    settings = get_user_settings(db, user)
    tz = ZoneInfo(settings.timezone)
    history = _history(db, user, now, days=weeks * 7)
    today = now.astimezone(tz).date()
    monday = today - timedelta(days=today.weekday())

    weekly = []
    for back in range(weeks - 1, -1, -1):
        start = monday - timedelta(weeks=back)
        items = [t for t in history if start <= t.completed_at.astimezone(tz).date() < start + timedelta(days=7)]
        with_deadline = [t for t in items if t.submission_deadline]
        on_time = sum(1 for t in with_deadline if t.completed_at <= t.submission_deadline)
        actual = [t.actual_minutes for t in items if t.actual_minutes]
        weekly.append(
            {
                "week_start": start.isoformat(),
                "completed": len(items),
                "on_time_pct": _pct(on_time, len(with_deadline)) if with_deadline else None,
                "avg_minutes": round(statistics.mean(actual)) if actual else None,
            }
        )

    by_mode = []
    for mode, label in (("SEA", "Sea"), ("AIR", "Air"), (None, "Not set")):
        items = [t for t in history if _mode(t) == mode and t.actual_minutes]
        if items:
            by_mode.append(
                {
                    "mode": label,
                    "tasks": len(items),
                    "avg_estimate": round(statistics.mean(t.estimated_minutes for t in items)),
                    "avg_actual": round(statistics.mean(t.actual_minutes for t in items)),
                }
            )

    issues = Counter(x for t in history for x in _issue_types(t))
    weekday_minutes: dict[int, int] = defaultdict(int)
    for t in history:
        weekday_minutes[t.completed_at.astimezone(tz).weekday()] += t.actual_minutes or 0
    return {
        "weeks": weeks,
        "weekly": weekly,
        "by_mode": by_mode,
        "issues": [{"type": k, "count": v} for k, v in issues.most_common()],
        "weekday_minutes": [{"day": WEEKDAYS[wd][:3], "minutes": weekday_minutes.get(wd, 0)} for wd in range(7)],
        "total_completed": len(history),
    }
