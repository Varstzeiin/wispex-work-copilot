import json
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

import httpx
import pytest

from app.core.config import get_settings
from app.integrations.google_calendar import GoogleCalendarClient
from app.services import calendar_service
from tests.conftest import make_client, register


def future(hours: float) -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()


def create_task(client, deadline=None):
    r = client.post("/api/tasks", json={"title": "Import", "shipment_reference": "SHP-777",
                                        "submission_deadline": deadline or future(5)})
    return r.json()


# ---------- Without Google (ICS fallback) ----------

def test_event_is_idempotent_per_task(client):
    task = create_task(client)
    first = client.put(f"/api/calendar/tasks/{task['id']}/event", json={}).json()
    second = client.put(f"/api/calendar/tasks/{task['id']}/event", json={"reminder_minutes": [60, 30]}).json()
    assert first["id"] == second["id"]
    assert first["title"] == "WISPEX — SHP-777 Submission Deadline"
    assert first["reminder_minutes"] == [1440, 240, 60, 30]
    assert second["reminder_minutes"] == [60, 30]
    assert second["sync_status"] == "LOCAL_ONLY"
    assert len(client.get("/api/calendar/events").json()) == 1


def test_ics_download_has_reminders_and_stable_uid(client):
    task = create_task(client)
    r = client.get(f"/api/calendar/tasks/{task['id']}/event.ics")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/calendar")
    body = r.text
    assert f"UID:{task['id']}@wispex-work-copilot" in body
    assert body.count("BEGIN:VALARM") == 4 and "TRIGGER:-PT30M" in body
    # Downloading does not create a saved event (GET has no side effects)
    assert client.get("/api/calendar/events").json() == []


def test_event_requires_deadline(client):
    r = client.post("/api/tasks", json={"title": "No deadline"}).json()
    assert client.put(f"/api/calendar/tasks/{r['id']}/event", json={}).status_code == 400


def test_deadline_change_marks_event_out_of_date(client):
    task = create_task(client)
    client.put(f"/api/calendar/tasks/{task['id']}/event", json={})
    client.patch(f"/api/tasks/{task['id']}", json={"submission_deadline": future(8)})
    assert client.get("/api/calendar/events").json()[0]["sync_status"] == "OUT_OF_DATE"
    client.post("/api/calendar/sync")
    assert client.get("/api/calendar/events").json()[0]["sync_status"] == "LOCAL_ONLY"


def test_delete_event(client):
    task = create_task(client)
    client.put(f"/api/calendar/tasks/{task['id']}/event", json={})
    assert client.delete(f"/api/calendar/tasks/{task['id']}/event").status_code == 204
    assert client.get("/api/calendar/events").json() == []


def test_google_connect_unavailable_without_configuration(client):
    assert client.post("/api/calendar/google/connect").status_code == 503


# ---------- With a mocked Google API ----------

class FakeGoogle:
    def __init__(self):
        self.events: dict[str, dict] = {}
        self.calls: list[tuple[str, str]] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.calls.append((request.method, request.url.path))
        if request.url.path == "/token":
            return httpx.Response(200, json={"access_token": "at", "refresh_token": "rt", "expires_in": 3600})
        if request.url.path == "/revoke":
            return httpx.Response(200)
        assert request.headers["authorization"] == "Bearer at"
        if request.method == "POST":
            body = json.loads(request.content)
            if body["id"] in self.events:
                return httpx.Response(409)
            self.events[body["id"]] = body
            return httpx.Response(200, json=body)
        event_id = request.url.path.rsplit("/", 1)[-1]
        if request.method == "PUT":
            self.events[event_id] = json.loads(request.content)
            return httpx.Response(200, json={"id": event_id})
        if request.method == "DELETE":
            self.events.pop(event_id, None)
            return httpx.Response(204)
        return httpx.Response(400)


@pytest.fixture
def google(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "cid")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "secret")
    monkeypatch.setenv("GOOGLE_REDIRECT_URI", "http://localhost:3000/api/calendar/google/callback")
    get_settings.cache_clear()
    fake = FakeGoogle()
    monkeypatch.setattr(calendar_service, "google_client", GoogleCalendarClient(httpx.MockTransport(fake.handler)))
    yield fake
    get_settings.cache_clear()


def connect(client) -> None:
    url = client.post("/api/calendar/google/connect").json()["authorization_url"]
    state = parse_qs(urlparse(url).query)["state"][0]
    r = client.get("/api/calendar/google/callback", params={"state": state, "code": "abc"}, follow_redirects=False)
    assert r.headers["location"].endswith("google=connected")


def test_google_sync_is_idempotent(client, google):
    connect(client)
    task = create_task(client)
    first = client.put(f"/api/calendar/tasks/{task['id']}/event", json={}).json()
    assert first["sync_status"] == "SYNCED" and first["provider"] == "google"
    client.put(f"/api/calendar/tasks/{task['id']}/event", json={})
    assert len(google.events) == 1
    event = next(iter(google.events.values()))
    assert event["summary"] == "WISPEX — SHP-777 Submission Deadline"
    assert [o["minutes"] for o in event["reminders"]["overrides"]] == [1440, 240, 60, 30]

    client.delete(f"/api/calendar/tasks/{task['id']}/event")
    assert google.events == {}


def test_google_callback_rejects_wrong_state(client, google):
    client.post("/api/calendar/google/connect")
    r = client.get("/api/calendar/google/callback", params={"state": "forged", "code": "abc"}, follow_redirects=False)
    assert r.headers["location"].endswith("google=failed")
    assert client.get("/api/calendar/status").json()["google_connected"] is False


def test_google_state_cannot_be_used_by_another_user(client, google):
    url = client.post("/api/calendar/google/connect").json()["authorization_url"]
    state = parse_qs(urlparse(url).query)["state"][0]
    other = make_client()
    register(other, "other@example.com")
    r = other.get("/api/calendar/google/callback", params={"state": state, "code": "abc"}, follow_redirects=False)
    assert r.headers["location"].endswith("google=failed")


def test_tokens_are_encrypted_at_rest(client, google):
    connect(client)
    from app.core.database import SessionLocal
    from app.core.security import decrypt
    from app.models import CalendarConnection

    with SessionLocal() as db:
        conn = db.query(CalendarConnection).one()
        assert conn.encrypted_refresh_token != "rt"
        assert conn.encrypted_refresh_token.startswith("gAAAAA")  # Fernet token
        assert decrypt(conn.encrypted_refresh_token) == "rt"
