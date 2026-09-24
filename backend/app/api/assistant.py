"""AI copilot endpoints (MVP 4). Drafts only: nothing here sends a message to anyone."""

import uuid
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai import embeddings
from app.ai.provider import get_provider
from app.core.config import get_settings
from app.core.database import get_db, utcnow
from app.core.security import ai_rate_limiter, get_current_user
from app.models import Clarification, CommunicationDraft, KnowledgeNote, User
from app.services import assistant_service as svc
from app.services import audit_service, knowledge_service

router = APIRouter(prefix="/assistant", tags=["assistant"])

DraftKind = Literal["CLARIFICATION", "MISSING_DOCUMENT", "DISCREPANCY", "ESCALATION", "CORRECTION", "STATUS_UPDATE"]


# ---------- Status & settings ----------


@router.get("/status")
def assistant_status(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    provider = get_provider()
    s = knowledge_service.get_assistant_settings(db, user)
    notes = db.scalars(select(KnowledgeNote.id).where(KnowledgeNote.user_id == user.id)).all()
    db.commit()
    return {
        "ai_configured": provider is not None,
        "ai_provider": provider.name if provider else None,
        "ai_model": get_settings().ai_model if provider and provider.name == "anthropic" else None,
        "ai_allowed": knowledge_service.ai_assist_allowed(db, user),
        "ai_permission_confirmed": s.ai_assist_allowed,
        "is_demo": user.is_demo,
        "knowledge_notes": len(notes),
        # READY | LOADING | UNAVAILABLE | OFF. Local model, no data leaves the server.
        "semantic_search": embeddings.status(),
    }


class AssistantSettingsIn(BaseModel):
    ai_assist_allowed: bool
    confirm_policy: bool = False


@router.put("/settings")
def update_assistant_settings(
    data: AssistantSettingsIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    s = knowledge_service.get_assistant_settings(db, user)
    if data.ai_assist_allowed != s.ai_assist_allowed:
        if data.ai_assist_allowed:
            if user.is_demo:
                raise HTTPException(status.HTTP_409_CONFLICT, "Demo accounts never use an AI provider.")
            if not data.confirm_policy:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    "Confirm that your organization permits sending notes and task details to this AI provider.",
                )
            s.ai_assist_confirmed_at = utcnow()
        s.ai_assist_allowed = data.ai_assist_allowed
        audit_service.log(db, user.id, "AI_ASSIST_PERMISSION_CHANGED", "settings", user.id,
                          new_state={"ai_assist_allowed": s.ai_assist_allowed})
    db.commit()
    return {"ai_assist_allowed": s.ai_assist_allowed, "ai_assist_confirmed_at": s.ai_assist_confirmed_at}


# ---------- Knowledge answer ----------


class AskIn(BaseModel):
    question: str = Field(min_length=3, max_length=500)


@router.post("/ask")
def ask(data: AskIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ai_rate_limiter.check(str(user.id))
    return knowledge_service.ask(db, user, data.question.strip())


# ---------- "I'm not sure" ----------


class UnsureIn(BaseModel):
    task_id: Optional[uuid.UUID] = None
    field_name: str = Field(default="", max_length=120)
    issue: str = Field(min_length=3, max_length=1000)
    evidence: str = Field(default="", max_length=1000)
    ask: str = Field(default="", max_length=500)
    greeting: str = Field(default="Hi", max_length=60)
    compliance_impact: bool = False
    financial_impact: bool = False


@router.post("/unsure")
def unsure(data: UnsureIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return svc.analyze_unsure(
        db, user, data.task_id, data.field_name.strip(), data.issue.strip(), data.evidence.strip(),
        data.ask.strip(), data.greeting, data.compliance_impact, data.financial_impact,
    )


# ---------- Clarifications ----------


class ClarificationIn(BaseModel):
    task_id: Optional[uuid.UUID] = None
    kind: Literal["QUESTION", "ESCALATION"] = "QUESTION"
    field_name: str = Field(default="", max_length=120)
    issue: str = Field(default="", max_length=1000)
    evidence: str = Field(default="", max_length=1000)
    question: str = Field(min_length=5, max_length=3000)
    asked_to: str = Field(default="", max_length=80)
    compliance_impact: bool = False


@router.get("/clarifications")
def list_clarifications(
    state: Literal["open", "all"] = "open",
    task_id: Optional[uuid.UUID] = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    stmt = select(Clarification).where(Clarification.user_id == user.id)
    if state == "open":
        stmt = stmt.where(Clarification.status == "OPEN")
    if task_id:
        stmt = stmt.where(Clarification.task_id == task_id)
    rows = db.scalars(stmt.order_by(Clarification.created_at.desc()).limit(100)).all()
    return {"items": [svc.clarification_out(c) for c in rows]}


@router.post("/clarifications", status_code=201)
def create_clarification(data: ClarificationIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    c = svc.create_clarification(
        db, user, data.task_id, data.kind, data.field_name, data.issue, data.evidence, data.question,
        data.asked_to, data.compliance_impact,
    )
    return svc.clarification_out(c)


class AnswerIn(BaseModel):
    answer: str = Field(min_length=1, max_length=3000)
    save_to_knowledge: bool = True
    verified: bool = False


@router.post("/clarifications/{clarification_id}/answer")
def answer_clarification(
    clarification_id: uuid.UUID, data: AnswerIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    c = svc.get_clarification(db, user, clarification_id)
    c = svc.answer_clarification(db, user, c, data.answer, data.save_to_knowledge, data.verified)
    return svc.clarification_out(c)


@router.post("/clarifications/{clarification_id}/cancel")
def cancel_clarification(
    clarification_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    c = svc.get_clarification(db, user, clarification_id)
    return svc.clarification_out(svc.cancel_clarification(db, user, c))


# ---------- Communication drafts ----------


class GenerateIn(BaseModel):
    kind: DraftKind
    task_id: Optional[uuid.UUID] = None
    discrepancy_id: Optional[uuid.UUID] = None
    error_id: Optional[uuid.UUID] = None
    greeting: str = Field(default="Hi", max_length=60)
    note: str = Field(default="", max_length=1000)


@router.post("/drafts/generate")
def generate_draft(data: GenerateIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return svc.generate_draft(
        db, user, data.kind, data.task_id, data.discrepancy_id, data.error_id, data.greeting, data.note
    )


class DraftIn(BaseModel):
    kind: DraftKind
    task_id: Optional[uuid.UUID] = None
    recipient: str = Field(default="", max_length=120)
    subject: str = Field(default="", max_length=200)
    body: str = Field(min_length=5, max_length=5000)


class DraftUpdate(BaseModel):
    recipient: Optional[str] = Field(default=None, max_length=120)
    subject: Optional[str] = Field(default=None, max_length=200)
    body: Optional[str] = Field(default=None, min_length=5, max_length=5000)


@router.get("/drafts")
def list_drafts(
    task_id: Optional[uuid.UUID] = None,
    page_size: int = Query(default=30, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    stmt = select(CommunicationDraft).where(CommunicationDraft.user_id == user.id)
    if task_id:
        stmt = stmt.where(CommunicationDraft.task_id == task_id)
    rows = db.scalars(stmt.order_by(CommunicationDraft.created_at.desc()).limit(page_size)).all()
    return {"items": [svc.draft_out(d) for d in rows]}


@router.post("/drafts", status_code=201)
def save_draft(data: DraftIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    d = svc.save_draft(db, user, data.kind, data.task_id, data.recipient, data.subject, data.body)
    return svc.draft_out(d)


@router.patch("/drafts/{draft_id}")
def update_draft(
    draft_id: uuid.UUID, data: DraftUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    d = svc.get_draft(db, user, draft_id)
    for key, value in data.model_dump(exclude_none=True).items():
        setattr(d, key, value.strip())
    db.commit()
    return svc.draft_out(d)


@router.post("/drafts/{draft_id}/sent")
def mark_draft_sent(draft_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """The user confirms they sent the message themselves. The application never sends it."""
    return svc.draft_out(svc.mark_sent(db, user, svc.get_draft(db, user, draft_id)))


@router.delete("/drafts/{draft_id}", status_code=204)
def delete_draft(draft_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    d = svc.get_draft(db, user, draft_id)
    db.delete(d)
    audit_service.log(db, user.id, "DRAFT_DELETED", "draft", d.id)
    db.commit()


class RewriteIn(BaseModel):
    text: str = Field(min_length=5, max_length=5000)


@router.post("/rewrite")
def rewrite(data: RewriteIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ai_rate_limiter.check(str(user.id))
    return svc.rewrite(db, user, data.text)


# ---------- Error analysis & adaptive checklist ----------


@router.get("/insights")
def insights(
    days: int = Query(default=30, ge=7, le=365),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    out = svc.insights(db, user, days)
    db.commit()
    return out


class SuggestionIn(BaseModel):
    key: str = Field(min_length=3, max_length=200)
    item: str = Field(default="", max_length=120)


@router.post("/checklist-suggestions/accept")
def accept_suggestion(data: SuggestionIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return {"final_checklist": svc.accept_suggestion(db, user, data.key, data.item)}


@router.post("/checklist-suggestions/dismiss", status_code=204)
def dismiss_suggestion(data: SuggestionIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    svc.dismiss_suggestion(db, user, data.key)
