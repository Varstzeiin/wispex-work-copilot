import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db, utcnow
from app.core.security import get_current_user
from app.models import Feedback, LearningItem, Skill, User
from app.models.performance import SKILL_LEVELS
from app.schemas.performance import FeedbackIn, FeedbackUpdate, LearningIn, LearningUpdate, SkillIn, SkillUpdate
from app.services import audit_service, growth_service
from app.services.settings_service import get_user_settings, to_utc

router = APIRouter(prefix="/learning", tags=["learning"])


def _owned(db: Session, model, obj_id: uuid.UUID, user: User, name: str):
    obj = db.get(model, obj_id)
    if obj is None or obj.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{name} not found.")
    return obj


# ---------- Learning items ----------


def learning_out(item: LearningItem) -> dict:
    return {
        "id": item.id,
        "title": item.title,
        "category": item.category,
        "source": item.source,
        "notes": item.notes,
        "status": item.status,
        "understood_at": item.understood_at,
        "created_at": item.created_at,
        "updated_at": item.updated_at,
    }


def _apply_learning_status(item: LearningItem, new_status: str) -> None:
    understood = new_status in ("UNDERSTOOD", "APPLIED")
    if understood and item.understood_at is None:
        item.understood_at = utcnow()
    elif not understood:
        item.understood_at = None
    item.status = new_status


@router.get("/items")
def list_items(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    items = db.scalars(
        select(LearningItem).where(LearningItem.user_id == user.id).order_by(LearningItem.created_at.desc())
    ).all()
    return [learning_out(i) for i in items]


@router.post("/items", status_code=201)
def create_item(data: LearningIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    item = LearningItem(
        user_id=user.id,
        title=data.title.strip(),
        category=data.category,
        source=data.source.strip(),
        notes=data.notes.strip(),
        created_at=utcnow(),
    )
    _apply_learning_status(item, data.status)
    db.add(item)
    db.flush()
    audit_service.log(db, user.id, "LEARNING_ITEM_CREATED", "learning", item.id, new_state={"status": item.status})
    db.commit()
    return learning_out(item)


@router.patch("/items/{item_id}")
def update_item(
    item_id: uuid.UUID, data: LearningUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    item = _owned(db, LearningItem, item_id, user, "Learning item")
    fields = data.model_dump(exclude_unset=True, exclude_none=True)
    previous = item.status
    if "status" in fields:
        _apply_learning_status(item, fields.pop("status"))
    for key, value in fields.items():
        setattr(item, key, value.strip() if isinstance(value, str) else value)
    if previous != item.status:
        audit_service.log(
            db,
            user.id,
            "LEARNING_PROGRESS",
            "learning",
            item.id,
            previous_state={"status": previous},
            new_state={"status": item.status},
        )
    db.commit()
    return learning_out(item)


@router.delete("/items/{item_id}", status_code=204)
def delete_item(item_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.delete(_owned(db, LearningItem, item_id, user, "Learning item"))
    db.commit()


# ---------- Feedback ----------


def feedback_out(f: Feedback) -> dict:
    return {
        "id": f.id,
        "received_at": f.received_at,
        "from_role": f.from_role,
        "summary": f.summary,
        "action_plan": f.action_plan,
        "applied": f.applied,
        "applied_at": f.applied_at,
        "applied_evidence": f.applied_evidence,
    }


@router.get("/feedback")
def list_feedback(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(Feedback).where(Feedback.user_id == user.id).order_by(Feedback.received_at.desc())).all()
    return [feedback_out(f) for f in rows]


@router.post("/feedback", status_code=201)
def create_feedback(data: FeedbackIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    tz = get_user_settings(db, user).timezone
    f = Feedback(
        user_id=user.id,
        received_at=to_utc(data.received_at, tz) or utcnow(),
        from_role=data.from_role.strip(),
        summary=data.summary.strip(),
        action_plan=data.action_plan.strip(),
        created_at=utcnow(),
    )
    db.add(f)
    db.flush()
    audit_service.log(db, user.id, "FEEDBACK_RECORDED", "feedback", f.id)
    db.commit()
    return feedback_out(f)


@router.patch("/feedback/{feedback_id}")
def update_feedback(
    feedback_id: uuid.UUID, data: FeedbackUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    f = _owned(db, Feedback, feedback_id, user, "Feedback")
    fields = data.model_dump(exclude_unset=True, exclude_none=True)
    if "applied" in fields:
        applied = fields.pop("applied")
        if applied and not f.applied:
            f.applied_at = utcnow()
            audit_service.log(db, user.id, "FEEDBACK_APPLIED", "feedback", f.id)
        elif not applied:
            f.applied_at = None
        f.applied = applied
    for key, value in fields.items():
        setattr(f, key, value.strip())
    db.commit()
    return feedback_out(f)


@router.delete("/feedback/{feedback_id}", status_code=204)
def delete_feedback(feedback_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.delete(_owned(db, Feedback, feedback_id, user, "Feedback"))
    db.commit()


# ---------- Skill matrix ----------


@router.get("/skills")
def list_skills(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    growth_service.ensure_default_skills(db, user)
    skills = db.scalars(
        select(Skill).where(Skill.user_id == user.id).order_by(Skill.is_default.desc(), Skill.name)
    ).all()
    return {"levels": SKILL_LEVELS, "skills": [growth_service.skill_out(s) for s in skills]}


@router.post("/skills", status_code=201)
def create_skill(data: SkillIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    name = data.name.strip()
    if db.scalar(select(Skill).where(Skill.user_id == user.id, Skill.name == name)):
        raise HTTPException(status.HTTP_409_CONFLICT, "This skill is already in your matrix.")
    skill = Skill(user_id=user.id, name=name, level=0, evidence=data.evidence.strip(), history=[])
    growth_service.record_skill_level(skill, data.level)
    db.add(skill)
    db.commit()
    return growth_service.skill_out(skill)


@router.patch("/skills/{skill_id}")
def update_skill(
    skill_id: uuid.UUID, data: SkillUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    skill = _owned(db, Skill, skill_id, user, "Skill")
    if data.level is not None:
        previous = skill.level
        growth_service.record_skill_level(skill, data.level)
        if previous != skill.level:
            audit_service.log(
                db,
                user.id,
                "SKILL_LEVEL_CHANGED",
                "skill",
                skill.id,
                previous_state={"level": previous},
                new_state={"level": skill.level},
            )
    if data.evidence is not None:
        skill.evidence = data.evidence.strip()
    skill.updated_at = utcnow()
    db.commit()
    return growth_service.skill_out(skill)


@router.delete("/skills/{skill_id}", status_code=204)
def delete_skill(skill_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.delete(_owned(db, Skill, skill_id, user, "Skill"))
    db.commit()
