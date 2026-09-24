from datetime import date, datetime, timedelta, timezone

from tests.conftest import make_client, register


def report(client, **kw):
    body = dict(
        field_name="Weight",
        incorrect_value="850 KG",
        correct_value="890 KG",
        source_document="Packing List",
        category="DATA_ENTRY",
        severity="MEDIUM",
        impact="Weight differs",
        confirm_verified=True,
    )
    body.update(kw)
    r = client.post("/api/errors", json=body)
    assert r.status_code == 201, r.text
    return r.json()


# ---------- Report an Error workflow ----------


def test_report_requires_stop_and_verify(client):
    r = client.post("/api/errors", json={"field_name": "Weight", "category": "DATA_ENTRY"})
    assert r.status_code == 422 and "verified" in r.json()["message"]


def test_error_workflow_is_ordered_and_documented(client):
    e = report(client)
    assert e["status"] == "REPORTED"
    assert [s["done"] for s in e["steps"]][:7] == [True, True, True, True, False, True, False]
    url = f"/api/errors/{e['id']}/status"

    # Cannot skip notification
    assert client.post(url, json={"status": "RESOLVED", "resolution": "x"}).status_code == 409
    # Notification needs a person/role
    assert client.post(url, json={"status": "NOTIFIED"}).status_code == 409
    e = client.post(url, json={"status": "NOTIFIED", "notified_person": "Supervisor"}).json()
    assert e["notified_at"] and e["steps"][6]["done"]

    assert client.post(url, json={"status": "CORRECTING"}).status_code == 409
    client.post(url, json={"status": "CORRECTING", "correction_notes": "Amendment with 890 KG"})
    assert client.post(url, json={"status": "RESOLVED"}).status_code == 409
    e = client.post(url, json={"status": "RESOLVED", "resolution": "Amendment accepted"}).json()
    assert e["status"] == "RESOLVED" and e["correction_minutes"] is not None
    assert not e["steps"][10]["done"]  # root-cause analysis still open

    e = client.patch(
        f"/api/errors/{e['id']}", json={"root_cause": "DATA_READING", "prevention_action": "Check gross vs net"}
    ).json()
    assert e["steps"][10]["done"]

    actions = [a["action"] for a in client.get("/api/audit").json()["items"]]
    assert {"ERROR_REPORTED", "ERROR_STATUS_CHANGED", "CORRECTION_COMPLETED"} <= set(actions)


def test_error_reports_cannot_be_deleted(client):
    e = report(client)
    assert client.delete(f"/api/errors/{e['id']}").status_code == 405


def test_error_linked_task_must_be_own(client):
    other = make_client()
    register(other, "other@example.com")
    task = other.post("/api/tasks", json={"title": "x", "shipment_reference": "SHP-X"}).json()
    r = client.post(
        "/api/errors",
        json={"task_id": task["id"], "field_name": "Weight", "category": "OTHER", "confirm_verified": True},
    )
    assert r.status_code == 404
    mine = client.post("/api/tasks", json={"title": "x", "shipment_reference": "SHP-MINE"}).json()
    e = report(client, task_id=mine["id"])
    assert e["shipment_reference"] == "SHP-MINE"
    assert other.get(f"/api/errors/{e['id']}").status_code == 404


def test_recurring_errors_suggest_but_never_change_anything(client):
    for _ in range(3):
        report(client, field_name="weight ")
    a = client.get("/api/errors/analytics").json()
    assert a["total"] == 3
    assert a["recurring"][0]["message"].startswith("You have encountered three weight-related errors")
    # A suggestion only: nothing was added to the learning tracker
    assert client.get("/api/learning/items").json() == []


def test_error_rate_uses_completed_tasks(client):
    report(client)
    assert client.get("/api/errors/analytics").json()["error_rate"] is None
    t = client.post("/api/tasks", json={"title": "Done"}).json()
    client.post(f"/api/tasks/{t['id']}/status", json={"status": "COMPLETED", "confirm_verified": True})
    assert client.get("/api/errors/analytics").json()["error_rate"] == 100.0


# ---------- Reviews ----------


def test_shift_review_counts_today_and_saves_reflection(client):
    t = client.post(
        "/api/tasks", json={"title": "A", "issues": [{"type": "WEIGHT_MISMATCH", "description": "850 vs 890"}]}
    ).json()
    assert t["issues"][0]["created_at"]
    client.post(f"/api/tasks/{t['id']}/status", json={"status": "ESCALATED", "note": "Asked supervisor"})
    report(client)
    r = client.get("/api/reviews/shift").json()
    assert r["is_today"]
    s = r["stats"]
    assert (s["errors"], s["escalations"], s["discrepancies"]) == (1, 1, 1)
    assert "One error was recorded" in r["summary"]

    saved = client.put(
        "/api/reviews/shift",
        json={
            "review_date": r["review_date"],
            "went_well": "Reported early",
            "to_improve": "Weights",
            "tomorrow_focus": "Gross vs net",
        },
    ).json()
    assert saved["reflection"]["went_well"] == "Reported early" and saved["reflection"]["saved_at"]
    assert client.get("/api/reviews/history").json()["shift_reviews"][0]["has_reflection"]


def test_cannot_review_the_future(client):
    tomorrow = (date.today() + timedelta(days=3)).isoformat()
    assert client.get("/api/reviews/shift", params={"review_date": tomorrow}).status_code == 400
    assert client.put("/api/reviews/shift", json={"review_date": tomorrow}).status_code == 400


def test_weekly_review_has_seven_days_and_normalises_to_monday(client):
    today = datetime.now(timezone.utc).date()
    w = client.get("/api/reviews/weekly", params={"week_start": today.isoformat()}).json()
    assert len(w["days"]) == 7
    assert date.fromisoformat(w["week_start"]).weekday() == 0
    saved = client.put("/api/reviews/weekly", json={"week_start": today.isoformat(), "went_well": "ok"}).json()
    assert saved["reflection"]["went_well"] == "ok"


# ---------- Learning, feedback, skills ----------


def test_learning_progress_sets_understood_date(client):
    item = client.post("/api/learning/items", json={"title": "Gross vs net weight", "category": "DOCUMENT"}).json()
    assert item["understood_at"] is None
    item = client.patch(f"/api/learning/items/{item['id']}", json={"status": "UNDERSTOOD"}).json()
    assert item["understood_at"]
    item = client.patch(f"/api/learning/items/{item['id']}", json={"status": "LEARNING"}).json()
    assert item["understood_at"] is None


def test_feedback_applied(client):
    f = client.post("/api/learning/feedback", json={"from_role": "Supervisor", "summary": "Ask earlier"}).json()
    f = client.patch(
        f"/api/learning/feedback/{f['id']}", json={"applied": True, "applied_evidence": "Asked within 10m"}
    ).json()
    assert f["applied"] and f["applied_at"]


def test_skill_matrix_defaults_and_history(client):
    data = client.get("/api/learning/skills").json()
    assert len(data["skills"]) == 8 and data["levels"]["3"] == "Independent"
    skill = data["skills"][0]
    updated = client.patch(f"/api/learning/skills/{skill['id']}", json={"level": 2, "evidence": "With senior"}).json()
    assert updated["level"] == 2 and updated["history"][-1]["level"] == 2
    assert client.post("/api/learning/skills", json={"name": skill["name"]}).status_code == 409


def test_learning_is_private_per_user(client):
    item = client.post("/api/learning/items", json={"title": "x"}).json()
    other = make_client()
    register(other, "other@example.com")
    assert other.patch(f"/api/learning/items/{item['id']}", json={"title": "y"}).status_code == 404
    assert other.get("/api/learning/items").json() == []


# ---------- Growth ----------


def test_indicators_show_evidence_not_a_score(client):
    data = client.get("/api/growth/indicators").json()
    keys = {i["key"] for i in data["indicators"]}
    assert {
        "on_time",
        "repeated_errors",
        "feedback_applied",
        "reported_early",
        "independent",
        "sop_knowledge",
        "consistency",
        "documentation",
        "questions",
    } == keys
    assert all(i["evidence"] for i in data["indicators"])
    assert "score" not in data


def test_development_plan_phases(client):
    p = client.get("/api/growth/plan").json()
    assert p["start_date"] is None and [ph["status"] for ph in p["phases"]] == ["NOT_STARTED"] * 3
    start = (datetime.now(timezone.utc).date() - timedelta(days=40)).isoformat()
    p = client.put("/api/growth/plan", json={"start_date": start}).json()
    assert [ph["status"] for ph in p["phases"]] == ["PAST", "CURRENT", "UPCOMING"]
    goal = p["phases"][1]["goals"][0]
    p = client.patch(f"/api/growth/goals/{goal['id']}", json={"done": True, "evidence": "Checked"}).json()
    assert p["phases"][1]["goals_done"] == 1
    p = client.post("/api/growth/goals", json={"phase": 90, "title": "Train a new colleague"}).json()
    assert p["phases"][2]["goals"][-1]["title"] == "Train a new colleague"


def test_demo_has_performance_history():
    c = make_client()
    c.post("/api/demo/start")
    assert c.get("/api/errors/analytics").json()["recurring"]
    assert c.get("/api/growth/plan").json()["day_number"] == 41
    assert len(c.get("/api/learning/items").json()) >= 5
