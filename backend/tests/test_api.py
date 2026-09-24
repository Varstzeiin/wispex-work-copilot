from datetime import datetime, timedelta, timezone

from tests.conftest import COMPLETE, make_client, register

DOCS = ["Commercial Invoice", "Packing List"]


def future(hours: float) -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()


def create(client, **kw):
    body = dict(title="Import data prep", shipment_reference="SHP-100", client_name="Client A",
                submission_deadline=future(2), required_documents=DOCS, available_documents=DOCS)
    body.update(kw)
    response = client.post("/api/tasks", json=body)
    assert response.status_code == 201, response.text
    return response.json()


# ---------- Authentication ----------

def test_register_login_logout_flow():
    c = make_client()
    register(c, "a@example.com")
    assert c.get("/api/auth/me").json()["email"] == "a@example.com"
    c.post("/api/auth/logout")
    assert c.get("/api/auth/me").status_code == 401
    assert c.post("/api/auth/login", json={"email": "a@example.com", "password": "wrong-password"}).status_code == 401
    assert c.post("/api/auth/login", json={"email": "A@example.com", "password": "a-long-password"}).status_code == 200


def test_short_password_rejected_with_friendly_message():
    c = make_client()
    r = c.post("/api/auth/register", json={"email": "b@example.com", "password": "short"})
    assert r.status_code == 422 and r.json()["message"].startswith("Please check the form")


def test_protected_endpoints_require_login():
    c = make_client()
    for path in ("/api/tasks", "/api/planner/today", "/api/settings", "/api/audit", "/api/calendar/events"):
        assert c.get(path).status_code == 401


def test_state_change_without_csrf_header_is_blocked(client):
    raw = make_client()
    raw.headers.pop("X-Requested-With")
    raw.cookies = client.cookies
    r = raw.post("/api/tasks", json={"title": "x"})
    assert r.status_code == 403


def test_login_is_rate_limited():
    c = make_client()
    codes = [c.post("/api/auth/login", json={"email": "x@example.com", "password": "p"}).status_code
             for _ in range(12)]
    assert 429 in codes


# ---------- Authorization ----------

def test_users_cannot_see_each_others_tasks():
    alice, bob = make_client(), make_client()
    register(alice, "alice@example.com")
    register(bob, "bob@example.com")
    task = create(alice)
    assert bob.get(f"/api/tasks/{task['id']}").status_code == 404
    assert bob.patch(f"/api/tasks/{task['id']}", json={"title": "hijack"}).status_code == 404
    assert bob.delete(f"/api/tasks/{task['id']}").status_code == 404
    assert bob.put(f"/api/calendar/tasks/{task['id']}/event", json={}).status_code == 404
    assert bob.get("/api/tasks").json()["total"] == 0
    assert alice.get("/api/tasks").json()["total"] == 1


# ---------- Tasks ----------

def test_create_task_calculates_priority_on_backend(client):
    task = create(client, submission_deadline=future(0.5))
    assert task["priority_level"] == "CRITICAL"
    assert task["priority_reasons"]
    assert task["deadline"]["status"] == "CRITICAL"
    assert task["document_completeness"] == 1.0


def test_naive_datetime_is_interpreted_in_profile_timezone(client):
    task = create(client, submission_deadline="2026-12-01T10:00")
    # 10:00 Asia/Jakarta (UTC+7) == 03:00 UTC
    assert task["submission_deadline"].startswith("2026-12-01T03:00")


def test_missing_documents_are_listed(client):
    task = create(client, available_documents=["Commercial Invoice"])
    assert task["missing_documents"] == ["Packing List"]
    assert task["document_completeness"] == 0.5
    assert task["guidance"] == "ASK"


def test_list_search_filter_and_pagination(client):
    for i in range(5):
        create(client, shipment_reference=f"SHP-{i}", submission_deadline=future(i + 1))
    page = client.get("/api/tasks", params={"page_size": 2}).json()
    assert page["total"] == 5 and len(page["items"]) == 2
    assert client.get("/api/tasks", params={"q": "SHP-3"}).json()["total"] == 1
    assert client.get("/api/tasks", params={"view": "closed"}).json()["total"] == 0


def test_completion_requires_resolved_issues_and_confirmation(client):
    task = create(client, issues=[{"type": "QUANTITY_MISMATCH", "description": "1500 vs 1550"}])
    url = f"/api/tasks/{task['id']}/status"
    r = client.post(url, json=COMPLETE)
    assert r.status_code == 409 and "open issue" in r.json()["message"]

    issues = task["issues"]
    issues[0]["resolved"] = True
    client.patch(f"/api/tasks/{task['id']}", json={"issues": issues})
    assert client.post(url, json={"status": "COMPLETED"}).status_code == 409  # not confirmed
    # The personal final checklist must be fully ticked
    partial = {**COMPLETE, "checklist_confirmed": COMPLETE["checklist_confirmed"][:-1]}
    r = client.post(url, json=partial)
    assert r.status_code == 409 and "Required clarification completed" in r.json()["message"]
    done = client.post(url, json=COMPLETE).json()
    assert done["status"] == "COMPLETED" and done["completed_at"]
    assert done["priority_level"] == "NONE"


def test_status_note_is_recorded_and_audited(client):
    task = create(client)
    client.post(f"/api/tasks/{task['id']}/status", json={"status": "ESCALATED", "note": "Asked supervisor"})
    detail = client.get(f"/api/tasks/{task['id']}").json()
    assert "ESCALATED: Asked supervisor" in detail["notes"]
    actions = [a["action"] for a in client.get("/api/audit").json()["items"]]
    assert "TASK_ESCALATED" in actions and "TASK_CREATED" in actions


def test_delete_task(client):
    task = create(client)
    assert client.delete(f"/api/tasks/{task['id']}").status_code == 204
    assert client.get(f"/api/tasks/{task['id']}").status_code == 404


# ---------- Settings ----------

def test_settings_validation_and_update(client):
    s = client.get("/api/settings").json()
    assert s["timezone"] == "Asia/Jakarta"
    bad = client.put("/api/settings", json={"deadline_thresholds": {
        "critical_minutes": 300, "urgent_minutes": 100, "watch_minutes": 400, "warn_before_critical_minutes": 30}})
    assert bad.status_code == 422
    assert client.put("/api/settings", json={"timezone": "Mars/Base"}).status_code == 422
    ok = client.put("/api/settings", json={"shift_start": "07:00", "timezone": "Asia/Singapore"}).json()
    assert ok["shift_start"] == "07:00" and ok["timezone"] == "Asia/Singapore"


def test_delete_account_removes_data(client):
    create(client)
    assert client.delete("/api/auth/me").status_code == 204
    assert client.get("/api/tasks").status_code == 401


# ---------- Planner & demo ----------

def test_demo_mode_has_realistic_scenarios():
    c = make_client()
    user = c.post("/api/demo/start").json()
    assert user["is_demo"]
    tasks = c.get("/api/tasks", params={"view": "all", "page_size": 100}).json()["items"]
    statuses = {t["status"] for t in tasks}
    assert {"COMPLETED", "ESCALATED", "WAITING", "ON_HOLD"} <= statuses
    assert any(t["missing_documents"] for t in tasks)
    assert any(t["deadline"]["overdue"] for t in tasks)
    types = {i["type"] for t in tasks for i in t["issues"]}
    assert {"QUANTITY_MISMATCH", "WEIGHT_MISMATCH", "LOW_CONFIDENCE"} <= types
    # Demo accounts cannot be used with a password login
    assert c.post("/api/auth/login", json={"email": user["email"], "password": "x"}).status_code == 401


def test_planner_and_next_endpoints(client):
    create(client, shipment_reference="LATER", submission_deadline=future(6))
    create(client, shipment_reference="SOON", submission_deadline=future(0.6))
    plan = client.get("/api/planner/today").json()
    assert plan["recommended_tasks"][0]["task"]["shipment_reference"] == "SOON"
    nxt = client.get("/api/planner/next").json()
    assert nxt["recommendation"]["shipment_reference"] == "SOON"
    assert "SOON is recommended because" in nxt["explanation"]


def test_new_urgent_task_changes_recommendation(client):
    create(client, shipment_reference="FIRST", submission_deadline=future(3))
    assert client.get("/api/planner/next").json()["recommendation"]["shipment_reference"] == "FIRST"
    create(client, shipment_reference="NEW-URGENT", submission_deadline=future(0.4))
    assert client.get("/api/planner/next").json()["recommendation"]["shipment_reference"] == "NEW-URGENT"


def test_notifications_only_for_deadline_alerts(client):
    create(client, shipment_reference="CALM", submission_deadline=future(10))
    create(client, shipment_reference="HOT", submission_deadline=future(0.3))
    alerts = client.get("/api/notifications").json()["alerts"]
    assert [a["title"] for a in alerts] == ["HOT"]
