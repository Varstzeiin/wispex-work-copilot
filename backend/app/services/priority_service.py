"""Priority engine.

Calculates a 0-100 priority score with human-readable reasons. The weights are personal
defaults that the user can change in Settings. They are NOT official company rules.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

from app.models import Task
from app.rules.deadline_rules import evaluate_deadline, format_duration, merged_thresholds

# Max points each factor can contribute. The score is normalised to 0-100.
DEFAULT_PRIORITY_WEIGHTS = {
    "deadline": 40,
    "eta": 15,
    "risk": 15,
    "missing_documents": 10,
    "client_priority": 10,
    "complexity": 5,
    "task_age": 5,
}
DEFAULT_LEVEL_THRESHOLDS = {"critical": 70, "high": 50, "medium": 30}

LEVEL_RANK = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3, "NONE": 4}

# Guidance status model (display labels live in the frontend)
GUIDANCE = ("SAFE_TO_PROCEED", "VERIFY", "ASK", "ESCALATE", "HOLD")


def merged_weights(custom: Optional[dict]) -> dict:
    merged = dict(DEFAULT_PRIORITY_WEIGHTS)
    for key, value in (custom or {}).items():
        if key in merged and isinstance(value, (int, float)) and 0 <= value <= 100:
            merged[key] = value
    return merged


def merged_level_thresholds(custom: Optional[dict]) -> dict:
    merged = dict(DEFAULT_LEVEL_THRESHOLDS)
    for key, value in ((custom or {}).get("levels") or {}).items():
        if key in merged and isinstance(value, int) and 0 <= value <= 100:
            merged[key] = value
    return merged


@dataclass
class Factor:
    name: str
    points: float
    max_points: float
    reason: Optional[str] = None


@dataclass
class PriorityResult:
    score: int
    level: str
    risk_level: str
    guidance: str
    guidance_reason: str
    reasons: list[str]
    factors: list[Factor] = field(default_factory=list)


def _deadline_fraction(minutes_remaining: int, slack: int, t: dict) -> float:
    if minutes_remaining < 0 or slack <= 0:
        return 1.0
    if slack <= t["critical_minutes"]:
        return 0.9
    if slack <= t["urgent_minutes"]:
        return 0.65
    if slack <= t["watch_minutes"]:
        return 0.4
    if slack <= 24 * 60:
        return 0.2
    return 0.05


def calculate_priority(
    task: Task,
    now: datetime,
    client_sla_tier: Optional[str] = None,
    weights: Optional[dict] = None,
    deadline_thresholds: Optional[dict] = None,
) -> PriorityResult:
    w = merged_weights(weights)
    levels = merged_level_thresholds(weights)
    t = merged_thresholds(deadline_thresholds)

    if task.is_closed:
        return PriorityResult(
            0, "NONE", "LOW", "SAFE_TO_PROCEED", "Task is closed.", [f"Task is {task.status.lower()}"]
        )

    factors: list[Factor] = []
    deadline = evaluate_deadline(task.submission_deadline, now, t)
    est = max(task.estimated_minutes or 0, 0)

    # 1. Deadline proximity (uses slack = time remaining minus estimated processing time)
    if deadline.minutes_remaining is None:
        factors.append(Factor("deadline", 0, w["deadline"], None))
        slack = None
    else:
        slack = deadline.minutes_remaining - est
        frac = _deadline_fraction(deadline.minutes_remaining, slack, t)
        if deadline.overdue:
            reason = f"Submission deadline passed {format_duration(deadline.minutes_remaining)} ago"
        elif slack <= 0:
            reason = (
                f"Deadline in {format_duration(deadline.minutes_remaining)} but the task needs "
                f"about {est}m. Not enough time unless started now"
            )
        elif frac >= 0.65:
            reason = f"Submission deadline is approaching ({format_duration(deadline.minutes_remaining)} left)"
        elif frac >= 0.2:
            reason = f"Deadline within {format_duration(deadline.minutes_remaining)}"
        else:
            reason = None
        factors.append(Factor("deadline", frac * w["deadline"], w["deadline"], reason))

    # 2. ETA proximity
    if task.eta is None:
        factors.append(Factor("eta", 0, w["eta"]))
    else:
        eta_minutes = (task.eta - now).total_seconds() / 60
        if eta_minutes <= 0:
            frac, reason = 1.0, "Shipment ETA has passed (cargo may already be waiting)"
        elif eta_minutes <= 240:
            frac, reason = 0.8, f"ETA is within the next {format_duration(int(eta_minutes))}"
        elif eta_minutes <= 720:
            frac, reason = 0.5, f"ETA in {format_duration(int(eta_minutes))}"
        elif eta_minutes <= 1440:
            frac, reason = 0.25, None
        else:
            frac, reason = 0.0, None
        factors.append(Factor("eta", frac * w["eta"], w["eta"], reason))

    # 3. Detected risks / open issues
    open_issues = task.open_issues
    if open_issues:
        frac = min(1.0, 0.5 * len(open_issues))
        first = open_issues[0].get("description") or open_issues[0].get("type", "issue")
        extra = f" (+{len(open_issues) - 1} more)" if len(open_issues) > 1 else ""
        reason = f"Open issue: {first}{extra}"
        factors.append(Factor("risk", frac * w["risk"], w["risk"], reason))
    else:
        factors.append(Factor("risk", 0, w["risk"]))

    # 4. Document completeness
    missing = task.missing_documents
    required = task.required_documents or []
    if missing and required:
        frac = len(missing) / len(required)
        reason = (
            f"{len(missing)} of {len(required)} required documents missing "
            f"({', '.join(missing)}). Follow-up needed"
        )
        factors.append(Factor("missing_documents", frac * w["missing_documents"], w["missing_documents"], reason))
    else:
        factors.append(Factor("missing_documents", 0, w["missing_documents"]))

    # 5. Client / SLA priority (only if the user entered one)
    tier = (client_sla_tier or "").upper()
    frac = {"HIGH": 1.0, "STANDARD": 0.4}.get(tier, 0.0)
    reason = "Client marked as high SLA priority (your setting)" if tier == "HIGH" else None
    factors.append(Factor("client_priority", frac * w["client_priority"], w["client_priority"], reason))

    # 6. Processing complexity
    if est >= 60:
        frac, reason = 1.0, f"Long processing time (~{est}m). Start early"
    elif est >= 30:
        frac, reason = 0.5, None
    else:
        frac, reason = 0.0, None
    factors.append(Factor("complexity", frac * w["complexity"], w["complexity"], reason))

    # 7. Task age
    age_hours = (now - task.created_at).total_seconds() / 3600 if task.created_at else 0
    if age_hours >= 48:
        frac, reason = 1.0, f"Task has been open for {int(age_hours // 24)} days"
    elif age_hours >= 24:
        frac, reason = 0.5, None
    else:
        frac, reason = 0.0, None
    factors.append(Factor("task_age", frac * w["task_age"], w["task_age"], reason))

    total_max = sum(f.max_points for f in factors) or 1
    score = round(100 * sum(f.points for f in factors) / total_max)

    # Level from score, with a deadline floor so an imminent deadline is never shown as LOW
    if score >= levels["critical"] or deadline.status in ("OVERDUE", "CRITICAL"):
        level = "CRITICAL"
    elif score >= levels["high"] or deadline.status == "URGENT":
        level = "HIGH"
    elif score >= levels["medium"]:
        level = "MEDIUM"
    else:
        level = "LOW"

    # Risk level (separate from priority: how likely something goes wrong)
    tight = deadline.status in ("OVERDUE", "CRITICAL", "URGENT")
    if deadline.overdue or (open_issues and tight) or (missing and tight):
        risk_level = "HIGH"
    elif open_issues or missing or (slack is not None and slack <= t["critical_minutes"]):
        risk_level = "MEDIUM"
    else:
        risk_level = "LOW"

    guidance, guidance_reason = _guidance(task, deadline.status, missing, open_issues)
    reasons = [f.reason for f in sorted(factors, key=lambda f: -f.points) if f.reason]
    return PriorityResult(score, level, risk_level, guidance, guidance_reason, reasons, factors)


def _guidance(task: Task, deadline_status: str, missing: list, open_issues: list) -> tuple[str, str]:
    """Suggested next posture. This is guidance only and never replaces the applicable SOP."""
    if task.status == "ON_HOLD":
        return "HOLD", "Task is on hold. Wait for instructions before continuing."
    if task.status == "ESCALATED":
        return "HOLD", "Already escalated. Continue only the parts that are not affected."
    tight = deadline_status in ("OVERDUE", "CRITICAL")
    if tight and (missing or open_issues):
        return (
            "ESCALATE",
            "Deadline is very close and the task still has unresolved items. "
            "Consider escalating according to the applicable SOP.",
        )
    if deadline_status == "OVERDUE":
        return "ESCALATE", "Deadline has passed. Inform the appropriate person according to the SOP."
    if missing:
        return "ASK", f"Request the missing document(s): {', '.join(missing)}."
    if open_issues:
        return "VERIFY", "Verify the open issue against the source documents before submitting."
    return "SAFE_TO_PROCEED", "Documents complete and no open issues recorded. Still verify before submission."


def apply_priority(task: Task, result: PriorityResult) -> bool:
    """Store the calculated values on the task. Returns True if anything changed."""
    changed = (
        task.priority_score != result.score
        or task.priority_level != result.level
        or task.risk_level != result.risk_level
        or task.priority_reasons != result.reasons
    )
    task.priority_score = result.score
    task.priority_level = result.level
    task.risk_level = result.risk_level
    task.priority_reasons = result.reasons
    return changed
