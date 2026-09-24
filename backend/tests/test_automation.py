"""MVP 5: workload forecast, patterns, improvement suggestions, analytics and approved sending.

Email and webhook delivery use fakes or mocked transports. Nothing is sent over the network.
"""

import smtplib
import uuid
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import httpx
import pytest

from app.core.database import SessionLocal
from app.integrations.outbound import (
    DeliveryError,
    SmtpEmailSender,
    WebhookTeamChannel,
    set_outbound,
)
from app.models import Shipment, Task, User
from tests.conftest import make_client

TZ = ZoneInfo("Asia/Jakarta")


def next_weekday(days_ahead: int = 1):
    day = datetime.now(TZ).date() + timedelta(days=days_ahead)
    while day.weekday() >= 5:
        day += timedelta(days=1)
    return day


def at(day, hour=10) -> str:
    return datetime.combine(day, time(hour), tzinfo=TZ).isoformat()


def task(client, **kw):
    body = dict(title="Import data prep", shipment_reference="SHP-1", client_name="Client A",
                submission_deadline=at(next_weekday()), estimated_minutes=30)
    body.update(kw)
    r = client.post("/api/tasks", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def add_history(n: int, mode: str, estimated: int, actual: int, client_name: str = "", issues=None):
    """Completed past tasks, inserted directly (the API only completes tasks one by one)."""
    now = datetime.now(timezone.utc)
    with SessionLocal() as db:
        user = db.query(User).first()
        for i in range(n):
            done = now - timedelta(days=1 + i % 20, hours=2)
            shipment = Shipment(user_id=user.id, reference=f"SHP-H{mode}{i}", transport_mode=mode)
            db.add(Task(user_id=user.id, title="History", status="COMPLETED", shipment=shipment,
                        estimated_minutes=estimated, actual_minutes=actual,
                        submission_deadline=done + timedelta(hours=1), created_at=done - timedelta(hours=3),
                        completed_at=done, issues=issues or []))
        db.commit()


# ---------- Forecast ----------


def test_forecast_places_known_work_on_the_right_day(client):
    day = next_weekday(2)
    task(client, shipment_reference="SHP-F1", submission_deadline=at(day), estimated_minutes=40)
    task(client, shipment_reference="SHP-F2", submission_deadline=at(day, 14), estimated_minutes=20)
    task(client, shipment_reference="SHP-OLD", submission_deadline=at(datetime.now(TZ).date() - timedelta(days=2)))
    task(client, shipment_reference="SHP-NONE", submission_deadline=None)

    f = client.get("/api/automation/forecast").json()
    target = next(d for d in f["days"] if d["date"] == day.isoformat())
    assert target["known_tasks"] == 2 and target["known_minutes"] == 60
    assert {r["label"] for r in target["task_refs"]} == {"SHP-F1", "SHP-F2"}
    assert f["days"][0]["label"] == "Today" and any(r["label"] == "SHP-OLD" for r in f["days"][0]["task_refs"])
    assert f["unscheduled_tasks"] == 1
    # No overload on the coming days. Today is skipped: after the shift ends, the overdue task
    # correctly makes today "over capacity", so the result depends on the time the test runs.
    assert all(d["status"] != "OVER" for d in f["days"][1:])


def test_forecast_flags_overload_and_never_reassigns(client):
    day = next_weekday(2)
    for i in range(12):  # 12 x 60 min on a 540 min shift
        task(client, shipment_reference=f"SHP-O{i}", submission_deadline=at(day), estimated_minutes=60)
    f = client.get("/api/automation/forecast").json()
    target = next(d for d in f["days"] if d["date"] == day.isoformat())
    assert target["status"] == "OVER" and target["capacity_minutes"] == 540
    assert "never reassigned automatically" in f["advice"][0]


def test_forecast_scales_estimates_with_personal_history(client):
    add_history(6, "AIR", estimated=20, actual=30)
    day = next_weekday(2)
    t = task(client, shipment_reference="SHP-AIR", submission_deadline=at(day), estimated_minutes=20)
    with SessionLocal() as db:  # the transport mode comes from the shipment
        db.get(Task, uuid.UUID(t["id"])).shipment.transport_mode = "AIR"
        db.commit()
    f = client.get("/api/automation/forecast").json()
    assert f["calibration"]["by_mode"]["AIR"] == {"ratio": 1.5, "tasks": 6}
    target = next(d for d in f["days"] if d["date"] == day.isoformat())
    assert target["known_minutes"] == 30


# ---------- Patterns and suggestions ----------


def test_patterns_find_estimate_gap_and_hide_clients_without_permission(client):
    add_history(6, "AIR", estimated=20, actual=32)
    issue = [{"id": "x", "type": "WEIGHT_MISMATCH", "description": "Weight differed", "resolved": True}]
    add_history(4, "SEA", estimated=25, actual=25, issues=issue)
    p = client.get("/api/automation/patterns").json()
    keys = {f["key"] for f in p["findings"]}
    assert "ESTIMATE:AIR" in keys and "MISMATCH:WEIGHT_MISMATCH" in keys
    assert p["client_patterns_allowed"] is False
    assert all(f["scope"] == "all" for f in p["findings"])


def test_client_patterns_need_confirmation(client):
    for i in range(6):
        task(client, shipment_reference=f"SHP-C{i}", client_name="Client B",
             issues=[{"type": "MISSING_INFORMATION", "description": "Packing List missing"}])
    r = client.put("/api/automation/settings", json={"client_patterns_allowed": True})
    assert r.status_code == 400
    r = client.put("/api/automation/settings", json={"client_patterns_allowed": True, "confirm_policy": True})
    assert r.json()["client_patterns_allowed"]
    findings = client.get("/api/automation/patterns").json()["findings"]
    named = [f for f in findings if f["scope"] == "Client B"]
    assert named and named[0]["title"] == "Client B: documents often arrive late"


def test_suggestions_can_be_dismissed_or_turned_into_learning(client):
    add_history(6, "AIR", estimated=20, actual=32)
    r = client.post("/api/automation/suggestions/learn", json={"key": "ESTIMATE:AIR"})
    assert r.status_code == 201
    items = client.get("/api/learning/items").json()
    assert items[0]["source"] == "Process improvement suggestion" and "air" in items[0]["title"].lower()
    handled = {f["key"]: f["handled"] for f in client.get("/api/automation/patterns").json()["findings"]}
    assert handled["ESTIMATE:AIR"] is True
    assert client.post("/api/automation/suggestions/learn", json={"key": "NOPE:x"}).status_code == 404
    assert client.post("/api/automation/suggestions/dismiss", json={"key": "PEAK:0"}).status_code == 204


def test_analytics_summarises_history(client):
    add_history(6, "AIR", estimated=20, actual=30)
    a = client.get("/api/automation/analytics").json()
    assert a["total_completed"] == 6 and len(a["weekly"]) == 8
    assert a["by_mode"] == [{"mode": "Air", "tasks": 6, "avg_estimate": 20, "avg_actual": 30}]


def test_demo_has_patterns_and_forecast():
    c = make_client()
    assert c.post("/api/demo/start").status_code == 200
    keys = {f["key"] for f in c.get("/api/automation/patterns").json()["findings"]}
    assert "ESTIMATE:AIR" in keys
    assert c.get("/api/automation/forecast").json()["days"][0]["label"] == "Today"


# ---------- Approved sending ----------


class FakeEmail:
    def __init__(self, fail=False):
        self.sent, self.fail = [], fail

    def send(self, to, subject, body):
        if self.fail:
            raise DeliveryError("The email could not be sent. Nothing was delivered. Please try again later.")
        self.sent.append((to, subject, body))


class FakeTeam:
    name = "Ops channel"

    def __init__(self):
        self.posts = []

    def post(self, text):
        self.posts.append(text)


def saved_draft(client) -> dict:
    t = task(client)
    r = client.post("/api/assistant/drafts", json={"kind": "STATUS_UPDATE", "task_id": t["id"],
                                                    "subject": "SHP-1: Status update", "body": "Hi, status update."})
    return r.json()


def test_email_is_integration_required_until_configured(client):
    s = client.get("/api/automation/status").json()
    assert s["email_configured"] is False and s["team_configured"] is False
    d = saved_draft(client)
    r = client.post(f"/api/automation/drafts/{d['id']}/email", json={"to": ["ops@example.com"], "approve": True})
    assert r.status_code == 409 and "Integration Required" in r.json()["message"]
    r = client.put("/api/automation/settings", json={"email_sending_allowed": True, "confirm_policy": True})
    assert r.status_code == 409


def test_email_needs_permission_and_approval_and_sends_once(client):
    fake = FakeEmail()
    set_outbound(fake, None)
    d = saved_draft(client)
    url = f"/api/automation/drafts/{d['id']}/email"
    assert client.post(url, json={"to": ["ops@example.com"], "approve": True}).status_code == 409  # not permitted yet
    assert client.put("/api/automation/settings", json={"email_sending_allowed": True}).status_code == 400
    client.put("/api/automation/settings", json={"email_sending_allowed": True, "confirm_policy": True})

    assert client.post(url, json={"to": ["ops@example.com"]}).status_code == 400  # not approved
    assert client.post(url, json={"to": ["not-an-email"], "approve": True}).status_code == 422
    assert fake.sent == []

    r = client.post(url, json={"to": ["ops@example.com", "lead@Example.com"], "approve": True})
    assert r.status_code == 200 and r.json()["status"] == "SENT_EMAIL" and r.json()["sent_at"]
    assert fake.sent == [(["ops@example.com", "lead@example.com"], "SHP-1: Status update", "Hi, status update.")]
    assert client.post(url, json={"to": ["ops@example.com"], "approve": True}).status_code == 409
    assert client.post(f"/api/assistant/drafts/{d['id']}/sent").status_code == 409
    assert len(fake.sent) == 1

    entry = next(a for a in client.get("/api/audit").json()["items"] if a["action"] == "EMAIL_SENT")
    assert entry["metadata"] == {"recipients": 2, "domains": ["example.com"]}  # never the addresses


def test_failed_delivery_keeps_the_draft(client):
    set_outbound(FakeEmail(fail=True), None)
    client.put("/api/automation/settings", json={"email_sending_allowed": True, "confirm_policy": True})
    d = saved_draft(client)
    r = client.post(f"/api/automation/drafts/{d['id']}/email", json={"to": ["ops@example.com"], "approve": True})
    assert r.status_code == 502 and "Nothing was delivered" in r.json()["message"]
    assert client.get("/api/assistant/drafts").json()["items"][0]["status"] == "DRAFT"


def test_team_channel_post(client):
    team = FakeTeam()
    set_outbound(None, team)
    assert client.get("/api/automation/status").json()["team_channel_name"] == "Ops channel"
    client.put("/api/automation/settings", json={"team_channel_allowed": True, "confirm_policy": True})
    d = saved_draft(client)
    r = client.post(f"/api/automation/drafts/{d['id']}/team", json={"approve": True})
    assert r.json()["status"] == "POSTED_TEAM"
    assert team.posts == ["*SHP-1: Status update*\n\nHi, status update."]


def test_demo_accounts_cannot_send():
    set_outbound(FakeEmail(), FakeTeam())
    c = make_client()
    c.post("/api/demo/start")
    r = c.put("/api/automation/settings", json={"email_sending_allowed": True, "confirm_policy": True})
    assert r.status_code == 409
    d = c.get("/api/assistant/drafts").json()["items"][0]
    r = c.post(f"/api/automation/drafts/{d['id']}/email", json={"to": ["ops@example.com"], "approve": True})
    assert r.status_code == 409


# ---------- Delivery adapters ----------


def test_smtp_sender_uses_tls_and_single_line_subject(monkeypatch):
    seen = {}

    class FakeSMTP:
        def __init__(self, host, port, timeout):
            seen["host"] = (host, port)

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def starttls(self, context):
            seen["tls"] = True

        def login(self, user, password):
            seen["login"] = user

        def send_message(self, msg):
            seen["msg"] = msg

    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)
    SmtpEmailSender("smtp.example.com", 587, "bot", "secret", "wispex@example.com").send(
        ["ops@example.com"], "Line one\r\nBcc: attacker@example.com", "Body"
    )
    msg = seen["msg"]
    assert seen["tls"] and seen["login"] == "bot" and seen["host"] == ("smtp.example.com", 587)
    assert msg["Subject"] == "Line one Bcc: attacker@example.com" and msg["Bcc"] is None


def test_smtp_failure_becomes_delivery_error(monkeypatch):
    def boom(*a, **k):
        raise OSError("connection refused")

    monkeypatch.setattr(smtplib, "SMTP", boom)
    with pytest.raises(DeliveryError):
        SmtpEmailSender("smtp.example.com", 587, "", "", "wispex@example.com").send(["a@example.com"], "S", "B")


def test_webhook_channel_posts_json_text():
    received = []

    def handler(request: httpx.Request) -> httpx.Response:
        received.append(request.content)
        return httpx.Response(200)

    WebhookTeamChannel("https://hooks.example.com/x", "Ops", transport=httpx.MockTransport(handler)).post("Hello")
    assert received == [b'{"text":"Hello"}']
    forbidden = httpx.MockTransport(lambda r: httpx.Response(403))
    refuse = WebhookTeamChannel("https://hooks.example.com/x", "Ops", transport=forbidden)
    with pytest.raises(DeliveryError):
        refuse.post("Hello")
