"""Personal knowledge base. Search runs locally and never sends anything to an AI provider."""

import uuid
from typing import Literal, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models import KnowledgeNote, User
from app.services import knowledge_service as ks

router = APIRouter(prefix="/knowledge", tags=["knowledge"])

Category = Literal[
    "TRAINING",
    "SOP_REFERENCE",
    "DOCUMENT_EXPLANATION",
    "TERMINOLOGY",
    "RESOLVED_QUESTION",
    "LESSON",
    "COMMON_MISTAKE",
    "PROCEDURE",
    "SENIOR_NOTE",
]


class NoteIn(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    body: str = Field(default="", max_length=10000)
    category: Category = "TRAINING"
    source_label: str = Field(default="", max_length=200)
    verified: bool = False
    tags: str = Field(default="", max_length=200)


class NoteUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=2, max_length=200)
    body: Optional[str] = Field(default=None, max_length=10000)
    category: Optional[Category] = None
    source_label: Optional[str] = Field(default=None, max_length=200)
    verified: Optional[bool] = None
    tags: Optional[str] = Field(default=None, max_length=200)


@router.get("")
def list_notes(
    q: str = "",
    category: Optional[Category] = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if q.strip():
        # Searches notes, learning notes, answered questions and resolved errors
        results = ks.search(db, user, q, limit=20)
        if category:
            results = [r for r in results if r["kind"] == "NOTE" and r["category"] == category]
        return {"mode": "search", "results": ks.public(results), "message": "" if results else ks.NO_SOURCE_MESSAGE}
    stmt = select(KnowledgeNote).where(KnowledgeNote.user_id == user.id)
    if category:
        stmt = stmt.where(KnowledgeNote.category == category)
    rows = db.scalars(stmt.order_by(KnowledgeNote.updated_at.desc()).limit(200)).all()
    return {"mode": "list", "items": [ks.note_out(n) for n in rows]}


@router.post("", status_code=201)
def create_note(data: NoteIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    note = ks.create_note(
        db, user, data.title, data.body, data.category, data.source_label, data.verified, data.tags
    )
    db.commit()
    return ks.note_out(note)


@router.get("/{note_id}")
def get_note(note_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return ks.note_out(ks.get_note(db, user, note_id))


@router.patch("/{note_id}")
def update_note(
    note_id: uuid.UUID, data: NoteUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    note = ks.get_note(db, user, note_id)
    return ks.note_out(ks.update_note(db, user, note, data.model_dump(exclude_none=True)))


@router.delete("/{note_id}", status_code=204)
def delete_note(note_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ks.delete_note(db, user, ks.get_note(db, user, note_id))
