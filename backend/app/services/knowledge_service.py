"""Personal knowledge base and retrieval ("search before asking").

Search is lexical (BM25) over the user's own trusted material: knowledge notes, learning notes,
answered questions and resolved errors. It runs locally, so searching never sends anything to an
AI provider. An AI answer is generated only from the retrieved sources, and only when permitted.
"""

import hashlib
import logging
import math
import re
import uuid
from collections import Counter
from dataclasses import dataclass, field

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.ai.embeddings import cosine, get_embedder
from app.ai.provider import ProviderError, get_provider
from app.core.database import get_or_create_user_row
from app.models import (
    AssistantSettings,
    Clarification,
    ErrorReport,
    KnowledgeEmbedding,
    KnowledgeNote,
    LearningItem,
    User,
)
from app.services import audit_service

NO_SOURCE_MESSAGE = "No reliable source found. Please verify with the appropriate person."
NOT_ANSWERED_MESSAGE = (
    "The sources found do not clearly answer this question. Please verify with the appropriate person."
)

# Knowledge-first order: training -> SOP -> personal notes -> resolved cases -> senior notes.
# Used as a tie-break and shown to the user so they know where an answer came from.
ORIGIN_ORDER = {"TRAINING": 1, "SOP": 2, "PERSONAL": 3, "RESOLVED_CASE": 4, "SENIOR": 5}
ORIGIN_LABEL = {
    "TRAINING": "Training material",
    "SOP": "SOP reference",
    "PERSONAL": "Personal note",
    "RESOLVED_CASE": "Resolved case",
    "SENIOR": "Senior / team note",
}
CATEGORY_ORIGIN = {
    "TRAINING": "TRAINING",
    "SOP_REFERENCE": "SOP",
    "DOCUMENT_EXPLANATION": "PERSONAL",
    "TERMINOLOGY": "PERSONAL",
    "LESSON": "PERSONAL",
    "COMMON_MISTAKE": "PERSONAL",
    "PROCEDURE": "PERSONAL",
    "RESOLVED_QUESTION": "RESOLVED_CASE",
    "SENIOR_NOTE": "SENIOR",
}

STOP_WORDS = set(
    """a an and are as at be been but by can could do does for from has have how i if in into is it its
    me my no not of on or our should so than that the their them then there these they this to was we
    were what when where which who why will with would you your please about which""".split()
)
MIN_COVERAGE = 0.5  # at least half of the meaningful question words must appear in a source
MAX_SOURCES = 5
KEYWORD_BONUS = 0.3  # weight of shared words on top of meaning similarity
MEANING_MARGIN = 0.08  # meaning-only matches must be this close to the best one

logger = logging.getLogger("wispex.knowledge")


def tokenize(text: str) -> list[str]:
    tokens = []
    for raw in re.findall(r"[a-z0-9]+", text.lower()):
        if raw in STOP_WORDS or (len(raw) < 2 and not raw.isdigit()):
            continue
        # Light plural folding so "weights" finds "weight"
        if len(raw) > 3 and raw.endswith("s") and not raw.endswith("ss"):
            raw = raw[:-1]
        tokens.append(raw)
    return tokens


@dataclass
class Source:
    kind: str  # NOTE | LEARNING | CLARIFICATION | ERROR
    id: uuid.UUID
    title: str
    text: str
    origin: str
    source_label: str = ""
    verified: bool = False
    category: str = ""
    tokens: list[str] = field(default_factory=list)


def _corpus(db: Session, user: User) -> list[Source]:
    out: list[Source] = []
    for n in db.scalars(select(KnowledgeNote).where(KnowledgeNote.user_id == user.id)).all():
        out.append(
            Source("NOTE", n.id, n.title, n.body, CATEGORY_ORIGIN.get(n.category, "PERSONAL"),
                   n.source_label, n.verified, n.category)
        )
    for item in db.scalars(select(LearningItem).where(LearningItem.user_id == user.id)).all():
        if item.notes.strip():
            origin = "SENIOR" if "senior" in item.source.lower() else "TRAINING"
            out.append(Source("LEARNING", item.id, item.title, item.notes, origin, item.source, False, item.category))
    answered = db.scalars(
        select(Clarification).where(
            Clarification.user_id == user.id,
            Clarification.status == "ANSWERED",
            Clarification.knowledge_note_id.is_(None),  # saved answers are already searchable as notes
        )
    ).all()
    for c in answered:
        title = f"{c.shipment_reference}: {c.field_name or 'question'}".strip(": ")
        text = f"Question: {c.issue or c.question}\nAnswer: {c.answer}"
        out.append(Source("CLARIFICATION", c.id, title, text, "RESOLVED_CASE", c.asked_to, False, c.kind))
    resolved = db.scalars(
        select(ErrorReport).where(ErrorReport.user_id == user.id, ErrorReport.status == "RESOLVED")
    ).all()
    for e in resolved:
        parts = [e.resolution, e.root_cause_notes, e.prevention_action, e.instructions]
        text = " ".join(p for p in parts if p)
        if text.strip():
            title = f"Resolved error: {e.field_name}" + (f" ({e.shipment_reference})" if e.shipment_reference else "")
            out.append(Source("ERROR", e.id, title, text, "RESOLVED_CASE", "Error log", False, e.category))
    for s in out:
        # The title counts twice: it usually names the topic
        s.tokens = tokenize(f"{s.title} {s.title} {s.text}")
    return out


def _snippet(text: str, terms: set[str], limit: int = 240) -> str:
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+|\n+", text) if s.strip()]
    if not sentences:
        return ""
    best = max(sentences, key=lambda s: len(terms & set(tokenize(s))))
    return best if len(best) <= limit else best[: limit - 1].rstrip() + "…"


def _source_text(s: Source) -> str:
    return f"{s.title}. {s.text}"[:2000]


def _vectors(db: Session, user: User, corpus: list[Source], embedder) -> list[list[float]]:
    """Embeddings for every source, cached per user and recomputed only when the text changes."""
    rows = {
        (r.source_kind, r.source_id): r
        for r in db.scalars(
            select(KnowledgeEmbedding).where(
                KnowledgeEmbedding.user_id == user.id, KnowledgeEmbedding.model == embedder.name
            )
        ).all()
    }
    hashes = [hashlib.sha256(_source_text(s).encode()).hexdigest() for s in corpus]
    stale = [
        i for i, s in enumerate(corpus)
        if (row := rows.get((s.kind, s.id))) is None or row.content_hash != hashes[i]
    ]
    fresh = embedder.embed([_source_text(corpus[i]) for i in stale]) if stale else []
    stale_set = set(stale)
    vectors = [None if i in stale_set else rows[(s.kind, s.id)].vector for i, s in enumerate(corpus)]

    for i, vector in zip(stale, fresh, strict=True):
        vectors[i] = vector
        s = corpus[i]
        row = rows.get((s.kind, s.id))
        if row is None:
            db.add(KnowledgeEmbedding(user_id=user.id, source_kind=s.kind, source_id=s.id, model=embedder.name,
                                      content_hash=hashes[i], vector=vector))
        else:
            row.content_hash, row.vector = hashes[i], vector
    live = {(s.kind, s.id) for s in corpus}
    orphans = [r for key, r in rows.items() if key not in live]
    for r in orphans:
        db.delete(r)
    if stale or orphans:
        try:
            db.commit()
        except IntegrityError:
            db.rollback()  # a parallel search cached the same source first. The vectors above are still valid.
    return vectors


def _best_sentence(text: str, query_vector: list[float], embedder, limit: int = 240) -> str:
    sentences = [x.strip() for x in re.split(r"(?<=[.!?])\s+|\n+", text) if x.strip()][:12]
    if not sentences:
        return ""
    scores = [cosine(v, query_vector) for v in embedder.embed(sentences)]
    best = sentences[scores.index(max(scores))]
    return best if len(best) <= limit else best[: limit - 1].rstrip() + "…"


def search(db: Session, user: User, query: str, limit: int = 8) -> list[dict]:
    """Hybrid search: keyword matching (BM25) and, when the local model is ready, matching by meaning.

    A source counts only if it covers enough of the question's words OR is close enough in meaning.
    With the model, the ranking is meaning similarity plus a bonus for shared words.
    """
    terms = list(dict.fromkeys(tokenize(query)))
    corpus = _corpus(db, user) if query.strip() else []
    if not corpus:
        return []
    n = len(corpus)

    # Keyword ranking (BM25)
    keyword: dict[int, tuple[float, float]] = {}
    if terms:
        avg_len = sum(len(s.tokens) for s in corpus) / n or 1
        df = Counter(t for s in corpus for t in set(s.tokens))
        k1, b = 1.2, 0.75
        for i, s in enumerate(corpus):
            tf = Counter(s.tokens)
            matched = [t for t in terms if tf[t]]
            if not matched:
                continue
            score = 0.0
            for t in matched:
                idf = math.log(1 + (n - df[t] + 0.5) / (df[t] + 0.5))
                score += idf * tf[t] * (k1 + 1) / (tf[t] + k1 * (1 - b + b * len(s.tokens) / avg_len))
            keyword[i] = (score, len(matched) / len(terms))

    # Meaning ranking (local embeddings)
    meaning: dict[int, float] = {}
    embedder = get_embedder()
    query_vector = None
    if embedder is not None:
        try:
            vectors = _vectors(db, user, corpus, embedder)
            query_vector = embedder.embed([query])[0]
            meaning = {i: cosine(v, query_vector) for i, v in enumerate(vectors)}
        except Exception as exc:  # never let the optional model break search
            logger.warning("Semantic search failed, keyword results only: %s", type(exc).__name__)
            meaning, query_vector = {}, None

    by_keyword = {i for i, (_, cov) in keyword.items() if cov >= MIN_COVERAGE}
    by_meaning: set[int] = set()
    if meaning:
        close = [sim for sim in meaning.values() if sim >= embedder.min_similarity]
        if close:
            # Meaning-only matches must also be near the best one, so loosely related notes stay out
            cutoff = max(embedder.min_similarity, max(close) - MEANING_MARGIN)
            by_meaning = {i for i, sim in meaning.items() if sim >= cutoff}
    eligible = by_keyword | by_meaning
    if not eligible:
        return []

    if meaning:
        # Similarity in meaning, plus a bonus for sharing the question's words
        scores = {i: meaning[i] + KEYWORD_BONUS * keyword.get(i, (0.0, 0.0))[1] for i in eligible}
    else:
        scores = {i: keyword[i][0] for i in eligible}
    for i in eligible:
        if corpus[i].verified:
            scores[i] *= 1.1  # confirmed knowledge first when relevance is similar
    ranked = sorted(eligible, key=lambda i: (-scores[i], ORIGIN_ORDER[corpus[i].origin]))[:limit]

    results = []
    for i in ranked:
        s = corpus[i]
        match = "both" if i in by_keyword and i in by_meaning else "keyword" if i in by_keyword else "meaning"
        if match == "meaning" and query_vector is not None:
            snippet = _best_sentence(s.text, query_vector, embedder)
        else:
            snippet = _snippet(s.text, set(terms))
        results.append(
            {
                "kind": s.kind,
                "id": s.id,
                "title": s.title,
                "snippet": snippet,
                "origin": s.origin,
                "origin_label": ORIGIN_LABEL[s.origin],
                "source_label": s.source_label,
                "verified": s.verified,
                "category": s.category,
                "match": match,
                "coverage": round(keyword.get(i, (0.0, 0.0))[1], 2),
                "similarity": round(meaning[i], 2) if i in meaning else None,
                "score": round(scores[i], 4),
                "_text": s.text,
            }
        )
    return results


def public(results: list[dict]) -> list[dict]:
    return [{k: v for k, v in r.items() if not k.startswith("_")} for r in results]


# ---------- AI permission for assistant text ----------


def get_assistant_settings(db: Session, user: User) -> AssistantSettings:
    return get_or_create_user_row(db, AssistantSettings, user.id)


def ai_assist_allowed(db: Session, user: User) -> bool:
    """Notes and task text go to an AI provider only if the server has one AND the user confirmed permission.

    Demo accounts never use the AI provider.
    """
    if user.is_demo or get_provider() is None:
        return False
    return get_assistant_settings(db, user).ai_assist_allowed


# ---------- Ask ----------


def ask(db: Session, user: User, question: str) -> dict:
    """Retrieval first. Generation only from what was retrieved, and only when permitted."""
    results = search(db, user, question, limit=MAX_SOURCES)
    base = {"question": question, "sources": public(results), "answer": "", "used_source_ids": [], "ai_used": False}
    if not results:
        return {**base, "status": "NO_SOURCE", "message": NO_SOURCE_MESSAGE}
    if not ai_assist_allowed(db, user):
        return {
            **base,
            "status": "SOURCES_ONLY",
            "message": "These are the closest matches in your trusted sources. Read them and decide if they answer "
            "your question. If not, verify with the appropriate person.",
        }

    numbered = [
        {"id": str(i + 1), "title": r["title"], "text": r["_text"][:3000]} for i, r in enumerate(results)
    ]
    try:
        answer = get_provider().answer_knowledge_question(question, numbered)
    except ProviderError as exc:
        return {**base, "status": "SOURCES_ONLY", "message": f"{exc} The matching sources are shown below."}
    audit_service.log(db, user.id, "KNOWLEDGE_ANSWER_GENERATED", "assistant", None,
                      metadata={"sources": len(results), "answered": answer.sufficient})
    db.commit()
    if not answer.sufficient:
        return {**base, "status": "NOT_ANSWERED", "message": NOT_ANSWERED_MESSAGE, "ai_used": True}
    used = [str(results[int(i) - 1]["id"]) for i in answer.used_source_ids]
    unverified = any(not results[int(i) - 1]["verified"] for i in answer.used_source_ids)
    message = "Generated only from your sources. Check the cited sources before relying on it."
    if unverified:
        message += " At least one cited source is a personal note that has not been confirmed."
    return {
        **base,
        "status": "ANSWERED",
        "answer": answer.answer,
        "used_source_ids": used,
        "ai_used": True,
        "message": message,
    }


# ---------- Notes CRUD ----------


def get_note(db: Session, user: User, note_id: uuid.UUID) -> KnowledgeNote:
    note = db.get(KnowledgeNote, note_id)
    if note is None or note.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Knowledge note not found")
    return note


def note_out(n: KnowledgeNote) -> dict:
    return {
        "id": n.id,
        "title": n.title,
        "body": n.body,
        "category": n.category,
        "origin_label": ORIGIN_LABEL[CATEGORY_ORIGIN.get(n.category, "PERSONAL")],
        "source_label": n.source_label,
        "verified": n.verified,
        "tags": n.tags,
        "created_at": n.created_at,
        "updated_at": n.updated_at,
    }


def create_note(
    db: Session,
    user: User,
    title: str,
    body: str,
    category: str,
    source_label: str = "",
    verified: bool = False,
    tags: str = "",
) -> KnowledgeNote:
    note = KnowledgeNote(
        user_id=user.id, title=title.strip(), body=body.strip(), category=category,
        source_label=source_label.strip(), verified=verified, tags=tags.strip(),
    )
    db.add(note)
    db.flush()
    audit_service.log(db, user.id, "KNOWLEDGE_NOTE_CREATED", "knowledge", note.id,
                      new_state={"category": category, "verified": verified})
    return note


def update_note(db: Session, user: User, note: KnowledgeNote, changes: dict) -> KnowledgeNote:
    for key, value in changes.items():
        setattr(note, key, value.strip() if isinstance(value, str) else value)
    audit_service.log(db, user.id, "KNOWLEDGE_NOTE_UPDATED", "knowledge", note.id,
                      metadata={"fields": sorted(changes)})
    db.commit()
    return note


def delete_note(db: Session, user: User, note: KnowledgeNote) -> None:
    for c in db.scalars(select(Clarification).where(Clarification.knowledge_note_id == note.id)).all():
        c.knowledge_note_id = None
    db.execute(
        delete(KnowledgeEmbedding).where(
            KnowledgeEmbedding.source_kind == "NOTE", KnowledgeEmbedding.source_id == note.id
        )
    )
    db.delete(note)
    audit_service.log(db, user.id, "KNOWLEDGE_NOTE_DELETED", "knowledge", note.id)
    db.commit()

