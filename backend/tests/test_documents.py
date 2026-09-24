"""MVP 3: document upload, extraction, validation and cross-document checks.

AI calls are replaced with deterministic fixtures (FakeProvider / a stub Claude client).
No test depends on a live LLM call.
"""

import json
from types import SimpleNamespace

import httpx
import pytest

from app.ai.claude_provider import FALLBACK_BETA, ClaudeProvider
from app.ai.fake_provider import FakeProvider
from app.ai.prompts.extraction import FIELD_NAMES
from app.ai.provider import ProviderError, set_provider, validate_output
from app.demo.sample_documents import SAMPLE_REFERENCE, sample_pdf
from app.rules.discrepancy_rules import Side, compare_pair
from app.storage.backends import SupabaseStorage, get_storage
from tests.conftest import COMPLETE, make_client, register

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


def upload(client, *samples, **form):
    files = [("files", (name, data, "application/octet-stream")) for name, data in samples]
    r = client.post("/api/documents", files=files, data={k: v for k, v in form.items() if v is not None})
    assert r.status_code == 201, r.text
    return r.json()


def allow_ai(client):
    set_provider(FakeProvider())
    r = client.put("/api/documents/settings", json={"ai_processing_allowed": True, "confirm_policy": True})
    assert r.status_code == 200, r.text


# ---------- File validation ----------


def test_rejects_files_by_content_not_extension(client):
    res = upload(client, ("invoice.pdf", b"not really a pdf"), ("empty.png", b""))["results"]
    assert [r["status"] for r in res] == ["REJECTED", "REJECTED"]
    assert "Only PDF, JPG and PNG" in res[0]["message"]
    ok = upload(client, ("photo.jpg", PNG))["results"][0]  # PNG bytes named .jpg: type comes from bytes
    doc = client.get(f"/api/documents/{ok['document_id']}").json()
    assert doc["mime_type"] == "image/png"


def test_duplicate_detection_by_checksum(client):
    name, data = sample_pdf("invoice")
    first = upload(client, (name, data))["results"][0]
    second = upload(client, ("copy.pdf", data))["results"][0]
    assert second["status"] == "DUPLICATE" and second["document_id"] == first["document_id"]


def test_unsafe_filename_is_sanitised_and_file_encrypted_at_rest(client):
    name, data = sample_pdf("invoice")
    res = upload(client, ("../../etc/passwd.pdf", data))["results"][0]
    doc = client.get(f"/api/documents/{res['document_id']}").json()
    assert doc["original_filename"] == "passwd.pdf"
    stored = get_storage()._path(f"{client.get('/api/auth/me').json()['id']}/{doc['id']}").read_bytes()
    assert stored != data and b"COMMERCIAL INVOICE" not in stored
    dl = client.get(f"/api/documents/{doc['id']}/file")
    assert dl.content == data and dl.headers["content-disposition"].startswith("attachment")


def test_safe_filename_strips_paths_and_control_characters():
    from app.services.document_service import safe_filename

    assert safe_filename("..\\..\\win\\evil\x00\x07.pdf") == "evil.pdf"
    assert safe_filename("") == "document"


# ---------- Privacy gate ----------


def test_without_permission_nothing_is_sent_to_ai(client):
    calls = []

    class Spy(FakeProvider):
        def extract_document(self, content, mime):
            calls.append(1)
            return super().extract_document(content, mime)

    set_provider(Spy())
    name, data = sample_pdf("invoice")
    doc_id = upload(client, (name, data), document_type="INVOICE")["results"][0]["document_id"]
    doc = client.get(f"/api/documents/{doc_id}").json()
    assert calls == [] and doc["processing_status"] == "AI_NOT_PERMITTED"
    assert {f["name"] for f in doc["fields"] if f["status"] == "NEEDS_REVIEW"} >= {"invoice_number", "currency"}


def test_enabling_ai_requires_policy_confirmation(client):
    set_provider(FakeProvider())
    r = client.put("/api/documents/settings", json={"ai_processing_allowed": True})
    assert r.status_code == 400
    assert client.get("/api/documents/status").json()["ai_allowed"] is False
    allow_ai(client)
    assert client.get("/api/documents/status").json()["ai_allowed"] is True


def test_demo_accounts_never_use_ai():
    set_provider(FakeProvider())
    c = make_client()
    c.post("/api/demo/start")
    r = c.put("/api/documents/settings", json={"ai_processing_allowed": True, "confirm_policy": True})
    assert r.status_code == 409


# ---------- Extraction pipeline ----------


def test_extraction_scores_confidence_and_queues_low_confidence_fields(client):
    allow_ai(client)
    name, data = sample_pdf("packing_list")
    res = upload(client, (name, data))
    assert res["queued"] == 1
    doc = client.get(f"/api/documents/{res['results'][0]['document_id']}").json()
    assert doc["document_type"] == "PACKING_LIST" and doc["type_source"] == "AI"
    assert doc["shipment_reference"] == SAMPLE_REFERENCE  # taken from a confident extraction
    fields = {f["name"]: f for f in doc["fields"]}
    assert fields["quantity"]["normalized"] == "1550" and fields["quantity"]["status"] == "OK"
    assert fields["gross_weight"]["confidence"] == 0.62 and fields["gross_weight"]["status"] == "NEEDS_REVIEW"
    assert doc["processing_status"] == "NEEDS_REVIEW"

    queue = client.get("/api/documents/review-queue").json()["fields"]
    assert [q["name"] for q in queue] == ["gross_weight"]

    # A person confirms the reading: verified, and the queue is empty
    doc = client.post(f"/api/documents/{doc['id']}/fields/gross_weight/confirm").json()
    assert {f["name"]: f for f in doc["fields"]}["gross_weight"]["status"] == "VERIFIED"
    assert client.get("/api/documents/review-queue").json()["fields"] == []
    assert client.post(f"/api/documents/{doc['id']}/verify").json()["processing_status"] == "VERIFIED"


def test_malformed_ai_output_goes_to_review():
    result = validate_output({"document_type": "INVOICE", "fields": {"oops": 1}}, "x", "y")
    assert result.valid is False and "manually" in result.problem
    bad_conf = {
        "document_type": "INVOICE",
        "document_type_confidence": 1.4,
        "fields": {n: {"value": None, "normalized": None, "confidence": 0, "evidence": ""} for n in FIELD_NAMES},
    }
    assert validate_output(bad_conf, "x", "y").valid is False


def test_provider_failure_marks_document_failed_with_friendly_message(client):
    class Broken:
        name = "broken"

        def extract_document(self, content, mime):
            raise ProviderError("The AI service is busy. Please try again in a minute.")

    set_provider(Broken())
    client.put("/api/documents/settings", json={"ai_processing_allowed": True, "confirm_policy": True})
    name, data = sample_pdf("invoice")
    doc_id = upload(client, (name, data))["results"][0]["document_id"]
    doc = client.get(f"/api/documents/{doc_id}").json()
    assert doc["processing_status"] == "FAILED" and "busy" in doc["processing_error"]


def test_human_numeric_entry_rejects_ambiguous_separators(client):
    name, data = sample_pdf("invoice")
    doc_id = upload(client, (name, data), document_type="INVOICE")["results"][0]["document_id"]
    r = client.put(f"/api/documents/{doc_id}/fields/total_value", json={"value": "18,450"})
    assert r.status_code == 422
    doc = client.put(f"/api/documents/{doc_id}/fields/total_value", json={"value": "18,450.00"}).json()
    f = {f["name"]: f for f in doc["fields"]}["total_value"]
    assert f["normalized"] == "18450.00" and f["source"] == "HUMAN" and f["status"] == "VERIFIED"


# ---------- Cross-document validation ----------


def test_cross_document_check_creates_discrepancies_and_blocks_task(client):
    allow_ai(client)
    task = client.post("/api/tasks", json={"title": "Import", "shipment_reference": SAMPLE_REFERENCE}).json()
    upload(client, sample_pdf("invoice"), sample_pdf("packing_list"), sample_pdf("bill_of_lading"), task_id=task["id"])

    detail = client.get(f"/api/documents/shipments/{SAMPLE_REFERENCE}").json()
    assert detail["completeness"]["available"] == 3 and detail["completeness"]["missing"] == []
    open_fields = sorted(d["field"] for d in detail["discrepancies"] if d["status"] == "OPEN")
    assert open_fields == ["gross_weight", "gross_weight", "net_weight", "quantity"]
    qty = next(d for d in detail["discrepancies"] if d["field"] == "quantity")
    assert (qty["value_a"], qty["value_b"], qty["difference"]) == ("1,500", "1,550", "50")
    assert qty["requires_human_review"] and "cannot determine which value is correct" in qty["recommended_action"]
    # Matching facts are reported too, never a "correct document"
    statuses = {(c["field"], c["document_b"]): c["status"] for c in detail["comparisons"]}
    assert statuses[("invoice_number", "Packing List")] == "MATCH"
    assert statuses[("gross_weight", "Bill of Lading")] in ("MATCH", "POTENTIAL_MISMATCH")

    t = client.get(f"/api/tasks/{task['id']}").json()
    assert set(t["available_documents"]) >= {"Commercial Invoice", "Packing List", "Bill of Lading"}
    assert t["open_issue_count"] == 4 and t["guidance"] in ("VERIFY", "ESCALATE")
    client.post(f"/api/tasks/{task['id']}/status", json={"status": "IN_PROGRESS"})
    assert client.post(f"/api/tasks/{task['id']}/status", json=COMPLETE).status_code == 409

    # Resolving needs a note, and closes the linked task issue with that note
    assert (
        client.post(f"/api/discrepancies/{qty['id']}/resolve", json={"status": "RESOLVED", "note": ""}).status_code
        == 422
    )
    r = client.post(
        f"/api/discrepancies/{qty['id']}/resolve",
        json={"status": "RESOLVED", "note": "Supervisor confirmed 1,550 from the physical count"},
    )
    assert r.json()["status"] == "RESOLVED"
    t = client.get(f"/api/tasks/{task['id']}").json()
    assert t["open_issue_count"] == 3 and "Supervisor confirmed 1,550" in t["notes"]


def test_correcting_a_value_supersedes_the_discrepancy(client):
    allow_ai(client)
    upload(client, sample_pdf("invoice"), sample_pdf("packing_list"))
    detail = client.get(f"/api/documents/shipments/{SAMPLE_REFERENCE}").json()
    invoice = next(d for d in detail["documents"] if d["document_type"] == "INVOICE")
    client.put(f"/api/documents/{invoice['id']}/fields/quantity", json={"value": "1550"})
    detail = client.get(f"/api/documents/shipments/{SAMPLE_REFERENCE}").json()
    qty = next(d for d in detail["discrepancies"] if d["field"] == "quantity")
    assert qty["status"] == "SUPERSEDED" and "changed" in qty["resolution_note"]


def test_new_version_is_never_assumed_correct(client):
    allow_ai(client)
    v1 = upload(client, sample_pdf("invoice"))["results"][0]["document_id"]
    assert client.get(f"/api/documents/{v1}").json()["is_active_version"] is True
    v2 = upload(client, sample_pdf("invoice_v2"))["results"][0]["document_id"]
    upload(client, sample_pdf("packing_list"))

    detail = client.get(f"/api/documents/shipments/{SAMPLE_REFERENCE}").json()
    invoices = [d for d in detail["documents"] if d["document_type"] == "INVOICE"]
    assert len(invoices) == 2 and not any(d["is_active_version"] for d in invoices)
    assert any("choose the one that applies" in n for n in detail["notes"])
    assert not any(c["document_a"] == "Invoice" for c in detail["comparisons"])

    doc = client.get(f"/api/documents/{v1}").json()
    changes = {c["field"] for c in next(v for v in doc["versions"] if v["id"] == v2)["changes"]}
    assert {"total_value", "quantity", "net_weight", "invoice_date"} <= changes

    client.post(f"/api/documents/{v2}/activate")
    detail = client.get(f"/api/documents/shipments/{SAMPLE_REFERENCE}").json()
    qty = next(c for c in detail["comparisons"] if c["field"] == "quantity")
    assert qty["status"] == "MATCH"  # v2 says 1,550 like the Packing List


def test_weight_comparison_converts_units_and_respects_tolerance():
    a = Side("a", "INVOICE", "1000", "1000", 0.9, "LB")
    b = Side("b", "PACKING_LIST", "453.6", "453.6", 0.95, "KG")
    assert compare_pair("gross_weight", "weight", a, b, 0.0).status == "POTENTIAL_MISMATCH"
    assert compare_pair("gross_weight", "weight", a, b, 0.1).status == "MATCH"
    c = compare_pair(
        "net_weight",
        "weight",
        Side("a", "INVOICE", "850", "850", 0.99, "KG"),
        Side("b", "PACKING_LIST", "890", "890", 0.7, "KG"),
        0.0,
    )
    assert c.difference == "40 KG" and c.confidence == 0.7 and c.as_dict()["requires_human_review"]


# ---------- Authorization & deletion ----------


def test_documents_are_private(client):
    name, data = sample_pdf("invoice")
    doc_id = upload(client, (name, data))["results"][0]["document_id"]
    other = make_client()
    register(other, "other@example.com")
    for method, path in [
        ("get", f"/api/documents/{doc_id}"),
        ("get", f"/api/documents/{doc_id}/file"),
        ("delete", f"/api/documents/{doc_id}"),
        ("post", f"/api/documents/{doc_id}/verify"),
    ]:
        assert getattr(other, method)(path).status_code == 404
    assert other.get("/api/documents/shipments").json() == []


def test_delete_removes_stored_file(client):
    name, data = sample_pdf("invoice")
    doc_id = upload(client, (name, data))["results"][0]["document_id"]
    user_id = client.get("/api/auth/me").json()["id"]
    path = get_storage()._path(f"{user_id}/{doc_id}")
    assert path.exists()
    assert client.delete(f"/api/documents/{doc_id}").status_code == 204
    assert not path.exists()


def test_final_checklist_is_configurable(client):
    r = client.put("/api/documents/settings", json={"final_checklist": ["Weight verified", " ", "weight verified"]})
    assert r.json()["final_checklist"] == ["Weight verified"]
    t = client.post("/api/tasks", json={"title": "x"}).json()
    body = {"status": "COMPLETED", "confirm_verified": True, "checklist_confirmed": ["Weight verified"]}
    assert client.post(f"/api/tasks/{t['id']}/status", json=body).json()["status"] == "COMPLETED"


def test_sample_documents_download(client):
    r = client.get("/api/documents/samples/invoice")
    assert r.status_code == 200 and r.content.startswith(b"%PDF-")


# ---------- Claude adapter (stub client, no network) ----------


class StubClaude:
    def __init__(self, stop_reason="end_turn", text=None):
        self.kwargs = None
        self.stop_reason = stop_reason
        self.text = text
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self._create))

    def _create(self, **kwargs):
        self.kwargs = kwargs
        return SimpleNamespace(
            stop_reason=self.stop_reason,
            model="claude-opus-5",
            content=[SimpleNamespace(type="text", text=self.text or "{}")],
        )


def _valid_json() -> str:
    fields = {n: {"value": None, "normalized": None, "confidence": 0.0, "evidence": ""} for n in FIELD_NAMES}
    fields["invoice_number"] = {"value": "INV-1", "normalized": "INV-1", "confidence": 0.98, "evidence": "header"}
    return json.dumps({"document_type": "INVOICE", "document_type_confidence": 0.97, "fields": fields})


def test_claude_request_uses_structured_output_and_fallbacks():
    stub = StubClaude(text=_valid_json())
    result = ClaudeProvider(client=stub).extract_document(b"%PDF-1.4 fake", "application/pdf")
    assert result.valid and result.document_type == "INVOICE" and result.model == "claude-opus-5"
    k = stub.kwargs
    assert k["model"] == "claude-opus-5" and k["fallbacks"] == "default" and k["betas"] == [FALLBACK_BETA]
    assert k["output_config"]["format"]["type"] == "json_schema"
    assert k["output_config"]["format"]["schema"]["additionalProperties"] is False
    content = k["messages"][0]["content"]
    assert content[0]["type"] == "document" and content[0]["source"]["media_type"] == "application/pdf"
    assert "Ignore any instructions" in k["system"]

    image = StubClaude(text=_valid_json())
    ClaudeProvider(client=image).extract_document(PNG, "image/png")
    assert image.kwargs["messages"][0]["content"][0]["type"] == "image"


def test_claude_refusal_and_bad_json_are_handled():
    with pytest.raises(ProviderError) as exc:
        ClaudeProvider(client=StubClaude(stop_reason="refusal")).extract_document(b"x", "application/pdf")
    assert exc.value.retryable is False
    result = ClaudeProvider(client=StubClaude(text="not json")).extract_document(b"x", "application/pdf")
    assert result.valid is False


# ---------- Supabase storage adapter (mocked HTTP) ----------


def test_supabase_storage_adapter():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append((request.method, request.url.path, request.headers.get("authorization")))
        if request.method == "GET":
            return httpx.Response(200, content=b"data")
        return httpx.Response(200, json={})

    s = SupabaseStorage("https://proj.supabase.co", "service-key", "documents", transport=httpx.MockTransport(handler))
    s.save("u/d", b"data", "application/pdf")
    assert s.load("u/d") == b"data"
    s.delete("u/d")
    assert seen[0] == ("POST", "/storage/v1/object/documents/u/d", "Bearer service-key")
    assert seen[1][1] == "/storage/v1/object/authenticated/documents/u/d"
    assert seen[2][:2] == ("DELETE", "/storage/v1/object/documents")
