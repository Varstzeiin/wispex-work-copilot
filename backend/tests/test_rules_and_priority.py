from datetime import datetime, timedelta, timezone

from app.models import Task, UserSettings
from app.rules.deadline_rules import evaluate_deadline
from app.services.planner_service import build_plan, recommend_next, shift_window
from app.services.priority_service import calculate_priority

NOW = datetime(2026, 9, 23, 3, 0, tzinfo=timezone.utc)  # 10:00 in Asia/Jakarta
DOCS = ["Commercial Invoice", "Packing List", "Bill of Lading"]


def make_task(**kw) -> Task:
    defaults = dict(
        title="Import data prep",
        status="NEW",
        estimated_minutes=20,
        required_documents=list(DOCS),
        available_documents=list(DOCS),
        issues=[],
        created_at=NOW - timedelta(hours=1),
    )
    defaults.update(kw)
    return Task(**defaults)


def settings(**kw) -> UserSettings:
    base = dict(timezone="Asia/Jakarta", shift_start="08:00", shift_end="17:00",
                deadline_thresholds={}, priority_weights={}, notification_prefs={})
    base.update(kw)
    return UserSettings(**base)


# ---------- Deadline engine ----------

def test_deadline_statuses_follow_default_thresholds():
    assert evaluate_deadline(NOW + timedelta(minutes=32), NOW).status == "CRITICAL"
    assert evaluate_deadline(NOW + timedelta(hours=2), NOW).status == "URGENT"
    assert evaluate_deadline(NOW + timedelta(hours=5), NOW).status == "WATCH"
    assert evaluate_deadline(NOW + timedelta(hours=7), NOW).status == "SAFE"
    assert evaluate_deadline(None, NOW).status == "NO_DEADLINE"


def test_overdue_is_detected_with_label():
    info = evaluate_deadline(NOW - timedelta(minutes=15), NOW)
    assert info.overdue and info.status == "OVERDUE"
    assert info.label == "Overdue by 15m"


def test_early_warning_before_critical():
    info = evaluate_deadline(NOW + timedelta(minutes=80), NOW)
    assert info.status == "URGENT" and info.approaching_critical


def test_custom_thresholds_are_respected():
    custom = {"critical_minutes": 120, "urgent_minutes": 240, "watch_minutes": 480}
    assert evaluate_deadline(NOW + timedelta(minutes=100), NOW, custom).status == "CRITICAL"


# ---------- Priority engine ----------

def test_imminent_deadline_is_critical_with_reason():
    task = make_task(submission_deadline=NOW + timedelta(minutes=40))
    result = calculate_priority(task, NOW)
    assert result.level == "CRITICAL"
    assert any("approaching" in r for r in result.reasons)
    assert result.guidance == "SAFE_TO_PROCEED"


def test_missing_documents_raise_priority_and_suggest_asking():
    complete = make_task(submission_deadline=NOW + timedelta(hours=5))
    missing = make_task(submission_deadline=NOW + timedelta(hours=5),
                        available_documents=["Commercial Invoice"])
    r_complete, r_missing = calculate_priority(complete, NOW), calculate_priority(missing, NOW)
    assert r_missing.score > r_complete.score
    assert r_missing.guidance == "ASK"
    assert any("2 of 3 required documents missing" in r for r in r_missing.reasons)


def test_open_issue_near_deadline_suggests_escalation():
    task = make_task(
        submission_deadline=NOW + timedelta(minutes=30),
        issues=[{"id": "1", "type": "WEIGHT_MISMATCH", "description": "850 vs 890 KG", "resolved": False}],
    )
    result = calculate_priority(task, NOW)
    assert result.guidance == "ESCALATE" and result.risk_level == "HIGH"


def test_resolved_issues_do_not_count():
    task = make_task(issues=[{"id": "1", "type": "OTHER", "description": "x", "resolved": True}])
    assert calculate_priority(task, NOW).guidance == "SAFE_TO_PROCEED"


def test_closed_tasks_have_no_priority():
    result = calculate_priority(make_task(status="COMPLETED"), NOW)
    assert result.score == 0 and result.level == "NONE"


def test_weights_are_configurable():
    task = make_task(eta=NOW + timedelta(hours=1), submission_deadline=NOW + timedelta(hours=10))
    default = calculate_priority(task, NOW).score
    no_eta = calculate_priority(task, NOW, weights={"eta": 0}).score
    assert no_eta < default


def test_high_sla_client_adds_reason():
    task = make_task(submission_deadline=NOW + timedelta(hours=10))
    result = calculate_priority(task, NOW, client_sla_tier="HIGH")
    assert "Client marked as high SLA priority (your setting)" in result.reasons


# ---------- Planner ----------

def test_shift_window_day_shift():
    window = shift_window(NOW, settings())
    assert window["status"] == "ON_SHIFT"
    assert window["available_minutes"] == 7 * 60  # 10:00 -> 17:00


def test_shift_window_overnight_shift():
    late = datetime(2026, 9, 23, 17, 0, tzinfo=timezone.utc)  # 00:00 Jakarta
    window = shift_window(late, settings(shift_start="22:00", shift_end="06:00"))
    assert window["status"] == "ON_SHIFT"
    assert window["available_minutes"] == 6 * 60


def test_plan_orders_critical_first_and_detects_overload():
    tasks = [make_task(title=f"T{i}", estimated_minutes=120, submission_deadline=NOW + timedelta(hours=8))
             for i in range(4)]
    urgent = make_task(title="Urgent", estimated_minutes=10, submission_deadline=NOW + timedelta(minutes=30))
    plan = build_plan(tasks + [urgent], settings(), NOW)
    assert plan["recommended_tasks"][0]["task"]["title"] == "Urgent"
    assert plan["overload"]["is_overloaded"]
    assert plan["overload"]["shortfall_minutes"] == 490 - 420
    assert plan["overload"]["suggestions"]


def test_waiting_tasks_are_not_in_the_queue():
    plan = build_plan([make_task(status="WAITING"), make_task(status="ON_HOLD")], settings(), NOW)
    assert plan["recommended_tasks"] == [] and len(plan["blocked_tasks"]) == 2


def test_recommendation_follows_up_missing_docs_then_picks_complete_task():
    blocked = make_task(title="Needs PL", submission_deadline=NOW + timedelta(minutes=45),
                        available_documents=["Commercial Invoice"])
    ready = make_task(title="Ready", submission_deadline=NOW + timedelta(hours=2))
    rec = recommend_next([blocked, ready], settings(), NOW)
    assert rec["follow_up"]["task"]["title"] == "Needs PL"
    assert rec["recommendation"]["title"] == "Ready"
    assert "document set is complete" in rec["explanation"]


def test_recommendation_explains_why():
    task = make_task(title="A", submission_deadline=NOW + timedelta(minutes=50))
    rec = recommend_next([task], settings(), NOW)
    assert rec["explanation"].startswith("A is recommended because")
