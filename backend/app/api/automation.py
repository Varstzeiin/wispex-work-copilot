"""MVP 5 endpoints: forecast, patterns, improvement suggestions, analytics and approved sending.

Sending a draft needs three things: the server is configured, the user confirmed that their
organization permits the channel, and the user approves this specific message. Nothing is ever
sent automatically.
"""

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.core.database import get_db, utcnow
from app.core.security import get_current_user, send_rate_limiter
from app.integrations.outbound import DeliveryError, get_email_sender, get_team_channel
from app.models import CommunicationDraft, LearningItem, User
from app.services import analytics_service as svc
from app.services import audit_service
from app.services.assistant_service import draft_out, get_draft

router = APIRouter(prefix="/automation", tags=["automation"])


# ---------- Status & permissions ----------


@router.get("/status")
def automation_status(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    s = svc.get_automation_settings(db, user)
    team = get_team_channel()
    db.commit()
    return {
        "is_demo": user.is_demo,
        "client_patterns_allowed": s.client_patterns_allowed,
        "email_configured": get_email_sender() is not None,
        "email_allowed": s.email_sending_allowed,
        "team_configured": team is not None,
        "team_channel_name": team.name if team else None,
        "team_allowed": s.team_channel_allowed,
    }


class PermissionIn(BaseModel):
    client_patterns_allowed: Optional[bool] = None
    email_sending_allowed: Optional[bool] = None
    team_channel_allowed: Optional[bool] = None
    # Required when switching anything on: the user confirms the organization permits it
    confirm_policy: bool = False


@router.put("/settings")
def update_permissions(data: PermissionIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    s = svc.get_automation_settings(db, user)
    now = utcnow()
    changes = {k: v for k, v in data.model_dump(exclude={"confirm_policy"}).items() if v is not None}
    for key, value in changes.items():
        if value and not getattr(s, key):
            if key != "client_patterns_allowed" and user.is_demo:
                raise HTTPException(status.HTTP_409_CONFLICT, "Demo accounts cannot send messages.")
            if key == "email_sending_allowed" and get_email_sender() is None:
                raise HTTPException(status.HTTP_409_CONFLICT, "Email is not configured on this server.")
            if key == "team_channel_allowed" and get_team_channel() is None:
                raise HTTPException(status.HTTP_409_CONFLICT, "No team channel is configured on this server.")
            if not data.confirm_policy:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST, "Confirm that your organization's policy explicitly permits this."
                )
            stamp = {"client_patterns_allowed": "client_patterns_confirmed_at",
                     "email_sending_allowed": "email_confirmed_at",
                     "team_channel_allowed": "team_channel_confirmed_at"}[key]
            setattr(s, stamp, now)
        setattr(s, key, value)
    if changes:
        audit_service.log(db, user.id, "AUTOMATION_PERMISSION_CHANGED", "settings", user.id, new_state=changes)
    db.commit()
    return automation_status(user, db)


# ---------- Forecast, patterns, analytics ----------


@router.get("/forecast")
def forecast(
    days: int = Query(default=5, ge=1, le=10), user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    out = svc.forecast(db, user, days)
    db.commit()
    return out


@router.get("/patterns")
def patterns(
    days: int = Query(default=90, ge=30, le=365), user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    out = svc.patterns(db, user, days)
    db.commit()
    return out


@router.get("/analytics")
def analytics(
    weeks: int = Query(default=8, ge=4, le=26), user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    return svc.analytics(db, user, weeks)


class SuggestionIn(BaseModel):
    key: str = Field(min_length=3, max_length=200)


@router.post("/suggestions/dismiss", status_code=204)
def dismiss_suggestion(data: SuggestionIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    svc.handle_suggestion(db, user, data.key)
    db.commit()


@router.post("/suggestions/learn", status_code=201)
def suggestion_to_learning(data: SuggestionIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Turns a suggestion into a learning item. The user decides whether and how to apply it."""
    finding = svc.find_suggestion(db, user, data.key)
    if finding is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This suggestion is no longer available.")
    item = LearningItem(
        user_id=user.id,
        title=finding["suggestion"][:200],
        category="LESSON",
        source="Process improvement suggestion",
        notes=f"{finding['title']}. {finding['evidence']}",
    )
    db.add(item)
    svc.handle_suggestion(db, user, data.key)
    db.flush()
    audit_service.log(db, user.id, "LEARNING_ITEM_CREATED", "learning", item.id, metadata={"source": "suggestion"})
    db.commit()
    return {"learning_item_id": item.id}


# ---------- Approved sending ----------


def _claim(db: Session, user: User, draft: CommunicationDraft) -> None:
    """Lock the draft for sending, so a double click or a retry never sends it twice."""
    result = db.execute(
        update(CommunicationDraft)
        .where(CommunicationDraft.id == draft.id, CommunicationDraft.status == "DRAFT")
        .values(status="SENDING")
    )
    db.commit()
    if result.rowcount != 1:
        raise HTTPException(status.HTTP_409_CONFLICT, "This draft was already sent or is being sent.")


def _release(db: Session, draft: CommunicationDraft) -> None:
    db.execute(update(CommunicationDraft).where(CommunicationDraft.id == draft.id).values(status="DRAFT"))
    db.commit()


class EmailIn(BaseModel):
    to: list[EmailStr] = Field(min_length=1, max_length=5)
    # The user reviewed this exact message and approves sending it now
    approve: bool = False


@router.post("/drafts/{draft_id}/email")
def send_email(
    draft_id: uuid.UUID, data: EmailIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    send_rate_limiter.check(str(user.id))
    draft = get_draft(db, user, draft_id)
    sender = get_email_sender()
    if user.is_demo:
        raise HTTPException(status.HTTP_409_CONFLICT, "Demo accounts cannot send messages.")
    if sender is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Email is not configured on this server (Integration Required).")
    if not svc.get_automation_settings(db, user).email_sending_allowed:
        raise HTTPException(status.HTTP_409_CONFLICT, "Email sending is off. Switch it on in Settings if permitted.")
    if not data.approve:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Review the message and approve sending it.")
    _claim(db, user, draft)
    try:
        sender.send([str(a) for a in data.to], draft.subject or draft.kind.replace("_", " ").title(), draft.body)
    except DeliveryError as exc:
        _release(db, draft)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
    db.refresh(draft)
    draft.status, draft.sent_at = "SENT_EMAIL", utcnow()
    # Only the number of recipients and their domains are logged, never addresses or content
    domains = sorted({str(a).rsplit("@", 1)[-1].lower() for a in data.to})
    audit_service.log(db, user.id, "EMAIL_SENT", "draft", draft.id, new_state={"status": "SENT_EMAIL"},
                      metadata={"recipients": len(data.to), "domains": domains})
    db.commit()
    return draft_out(draft)


class TeamIn(BaseModel):
    approve: bool = False


@router.post("/drafts/{draft_id}/team")
def post_to_team(
    draft_id: uuid.UUID, data: TeamIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    send_rate_limiter.check(str(user.id))
    draft = get_draft(db, user, draft_id)
    channel = get_team_channel()
    if user.is_demo:
        raise HTTPException(status.HTTP_409_CONFLICT, "Demo accounts cannot send messages.")
    if channel is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "No team channel is configured on this server (Integration Required)."
        )
    if not svc.get_automation_settings(db, user).team_channel_allowed:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Posting to the team channel is off. Switch it on in Settings if permitted."
        )
    if not data.approve:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Review the message and approve posting it.")
    _claim(db, user, draft)
    text = f"*{draft.subject}*\n\n{draft.body}" if draft.subject else draft.body
    try:
        channel.post(text)
    except DeliveryError as exc:
        _release(db, draft)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
    db.refresh(draft)
    draft.status, draft.sent_at = "POSTED_TEAM", utcnow()
    audit_service.log(db, user.id, "TEAM_MESSAGE_POSTED", "draft", draft.id, new_state={"status": "POSTED_TEAM"})
    db.commit()
    return draft_out(draft)
