"""Server text follows the X-Language header. Messages meant for other people stay English."""

from datetime import datetime, timedelta, timezone

from app.core.i18n import get_language, language, request_language, tr

ID = {"X-Language": "id"}


def future(hours: float) -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()


def create(client, **kw):
    body = dict(title="Import data prep", shipment_reference="SHP-100", client_name="Client A",
                submission_deadline=future(0.5), required_documents=["Commercial Invoice", "Packing List"],
                available_documents=["Commercial Invoice"])
    body.update(kw)
    response = client.post("/api/tasks", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def test_tr_and_language_context():
    with language("id"):
        assert get_language() == "id"
        assert tr("Hello", "Halo") == "Halo"
        with language("en"):
            assert tr("Hello", "Halo") == "Hello"
        assert tr("Hello", "Halo") == "Halo"
    assert request_language("id-ID") == "id"
    assert request_language("fr") == "en"
    assert request_language(None) == "en"


def test_english_is_the_default(client):
    create(client)
    task = client.get("/api/tasks").json()["items"][0]
    assert task["deadline"]["label"].endswith("remaining")
    assert client.get("/api/planner/next").json()["explanation"].startswith("SHP-100 is recommended")


def test_indonesian_header_translates_server_text(client):
    t = create(client)
    task = client.get(f"/api/tasks/{t['id']}", headers=ID).json()
    assert task["deadline"]["label"].startswith("sisa")
    assert any("dokumen" in r for r in task["priority_reasons"]), task["priority_reasons"]
    assert client.get("/api/planner/next", headers=ID).json()["explanation"].startswith("SHP-100 direkomendasikan")
    assert client.get("/api/planner/today", headers=ID).json()["summary"].startswith("Kamu punya 1 task terbuka.")
    alert = client.get("/api/notifications", headers=ID).json()["alerts"][0]
    assert "Deadline" in alert["message"] and "lagi" in alert["message"]


def test_error_messages_follow_the_language(client):
    missing = "00000000-0000-0000-0000-000000000000"
    assert client.get(f"/api/tasks/{missing}", headers=ID).json()["message"] == "Task tidak ditemukan."
    assert client.get(f"/api/tasks/{missing}").json()["message"] == "Task not found."
    r = client.post("/api/tasks", json={"title": ""}, headers=ID)
    assert r.status_code == 422 and r.json()["message"].startswith("Silakan cek isian formulir.")


def test_drafts_and_questions_stay_english(client):
    t = create(client)
    d = client.post("/api/assistant/drafts/generate", json={"kind": "MISSING_DOCUMENT", "task_id": t["id"]},
                    headers=ID).json()
    assert "I have not yet received the Packing List." in d["body"]
    assert "The submission deadline is" in d["body"] and "sisa" not in d["body"]

    r = client.post("/api/assistant/unsure", headers=ID, json={
        "task_id": t["id"], "field_name": "Quantity", "greeting": "Hi",
        "issue": "The Invoice and Packing List show different quantities", "evidence": "", "ask": "",
    }).json()
    assert r["draft"]["text"].startswith("Hi, I am working on shipment SHP-100")
    assert r["assessment"]["headline"] != "" and "Verify first" not in r["assessment"]["headline"]
    assert r["knowledge_message"].startswith("Belum ada sumber terpercaya")
