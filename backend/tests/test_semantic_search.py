"""Search by meaning (hybrid keyword + local embeddings).

A deterministic concept embedder stands in for the real model, so these tests never download
anything. One optional test runs the real model when WISPEX_EMBEDDING_MODEL_PATH points to it.
"""

import math
import os

import pytest

from app.ai import embeddings
from app.core.database import SessionLocal
from app.models import KnowledgeEmbedding

# Words that mean the same thing share a concept. Words outside every concept are ignored.
CONCEPTS = {
    "weight": {"weight", "heavier", "heavy", "kg", "berat"},
    "packaging": {"packaging", "boxes", "box", "carton", "cartons", "kemasan"},
    "receive": {"receives", "receive", "receiving", "consignee", "recipient", "penerima"},
    "quantity": {"quantity", "units", "pieces", "number", "jumlah"},
    "unreadable": {"unclear", "blurry", "unreadable", "scan", "photo"},
    "lunch": {"lunch", "canteen", "food"},
}


class ConceptEmbedder:
    name = "test-concepts"
    min_similarity = 0.5

    def __init__(self):
        self.calls = 0

    def embed(self, texts):
        self.calls += 1
        out = []
        for text in texts:
            words = {w.strip(".,?!:;'\"").lower() for w in text.split()}
            vec = [float(len(words & group)) for group in CONCEPTS.values()] + [0.01]
            norm = math.sqrt(sum(x * x for x in vec))
            out.append([x / norm for x in vec])
        return out


@pytest.fixture
def embedder():
    e = ConceptEmbedder()
    embeddings.set_embedder(e)
    return e


def note(client, title, body, **kw):
    r = client.post("/api/knowledge", json={"title": title, "body": body, "category": "TRAINING", **kw})
    assert r.status_code == 201, r.text
    return r.json()


def search(client, q):
    return client.get("/api/knowledge", params={"q": q}).json()["results"]


def test_finds_notes_by_meaning_without_shared_words(client, embedder):
    n = note(client, "Gross weight vs net weight", "Gross weight includes packaging.")
    note(client, "Consignee vs buyer", "The consignee receives the goods.")
    # No word of the question appears in the note, but the meaning does
    res = search(client, "is the heavier figure with the boxes?")
    assert [r["id"] for r in res] == [n["id"]]
    assert res[0]["match"] == "meaning" and res[0]["similarity"] >= 0.5
    # Keyword search alone finds nothing for this question
    embeddings.set_embedder(None)
    assert search(client, "is the heavier figure with the boxes?") == []


def test_unrelated_questions_still_get_no_reliable_source(client, embedder):
    note(client, "Gross weight vs net weight", "Gross weight includes packaging.")
    r = client.post("/api/assistant/ask", json={"question": "Where is the canteen for lunch?"}).json()
    assert r["status"] == "NO_SOURCE"


def test_keyword_and_meaning_are_merged(client, embedder):
    note(client, "Consignee vs buyer", "The consignee receives the goods. The buyer pays for them.")
    note(client, "Unclear scan", "If a scan is unreadable, ask for a clearer copy.")
    res = search(client, "who is the recipient of the goods")
    assert res[0]["title"] == "Consignee vs buyer" and res[0]["match"] == "both"


def test_snippet_for_meaning_match_is_the_closest_sentence(client, embedder):
    note(client, "Scans", "Always file scans by shipment. If a photo is blurry, ask for a clearer copy.")
    res = search(client, "the picture is unreadable")
    assert res[0]["match"] == "meaning"
    assert res[0]["snippet"] == "If a photo is blurry, ask for a clearer copy."


def test_embeddings_are_cached_and_follow_changes(client, embedder):
    n = note(client, "Gross weight", "Gross weight includes packaging.")
    search(client, "heavier with boxes")
    calls = embedder.calls
    search(client, "heavier with boxes")
    # Second search only embeds the question (plus the snippet), never the unchanged notes again
    with SessionLocal() as db:
        rows = db.query(KnowledgeEmbedding).all()
        assert len(rows) == 1 and rows[0].model == "test-concepts"
        first_hash = rows[0].content_hash
    assert embedder.calls - calls <= 2

    client.patch(f"/api/knowledge/{n['id']}", json={"body": "Consignee receives the goods."})
    assert search(client, "who is the recipient")[0]["id"] == n["id"]
    with SessionLocal() as db:
        assert db.query(KnowledgeEmbedding).one().content_hash != first_hash

    client.delete(f"/api/knowledge/{n['id']}")
    search(client, "anything heavy")
    with SessionLocal() as db:
        assert db.query(KnowledgeEmbedding).count() == 0  # no vectors kept for deleted notes


def test_unsure_flow_uses_meaning_too(client, embedder):
    note(client, "Quantity differs between Invoice and Packing List", "Do not choose a value yourself.")
    r = client.post("/api/assistant/unsure", json={"issue": "the number of pieces is not the same"}).json()
    assert r["knowledge"] and r["knowledge"][0]["match"] == "meaning"


def test_failing_embedder_falls_back_to_keywords(client):
    class Broken(ConceptEmbedder):
        def embed(self, texts):
            raise RuntimeError("model crashed")

    embeddings.set_embedder(Broken())
    note(client, "Gross weight vs net weight", "Gross weight includes packaging.")
    res = search(client, "gross weight packaging")
    assert res and res[0]["match"] == "keyword"


def test_status_is_reported(client, embedder):
    assert client.get("/api/assistant/status").json()["semantic_search"] == "READY"
    embeddings.reset()
    assert client.get("/api/assistant/status").json()["semantic_search"] == "OFF"


@pytest.mark.skipif(not os.environ.get("WISPEX_EMBEDDING_MODEL_PATH"), reason="real model not available")
def test_real_model_finds_paraphrases(client):
    model_path = os.environ["WISPEX_EMBEDDING_MODEL_PATH"]
    embeddings.set_embedder(embeddings.FastEmbedEmbedder("sentence-transformers/all-MiniLM-L6-v2", model_path))
    note(client, "Gross weight vs net weight", "Gross weight is the weight of the goods including packaging.")
    note(client, "Consignee vs buyer", "The consignee receives the goods. The buyer pays for them.")
    note(client, "Unclear scan", "If a value on a scan is hard to read, do not guess. Ask for a clearer copy.")
    assert search(client, "does the heavier figure include the boxes?")[0]["title"] == "Gross weight vs net weight"
    assert search(client, "the photo is blurry and I cannot read the value")[0]["title"] == "Unclear scan"
    assert search(client, "what time is lunch") == []
