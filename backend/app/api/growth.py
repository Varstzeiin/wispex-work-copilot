import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models import DevelopmentGoal, User
from app.schemas.performance import GoalIn, GoalUpdate, PlanUpdate
from app.services import audit_service, growth_service

router = APIRouter(prefix="/growth", tags=["growth"])


@router.get("/indicators")
def indicators(
    days: int = Query(default=30, ge=7, le=180),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return growth_service.reliability_indicators(db, user, days)


@router.get("/plan")
def plan(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return growth_service.development_plan(db, user)


@router.put("/plan")
def set_start_date(data: PlanUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p = growth_service.ensure_plan(db, user)
    p.start_date = data.start_date
    audit_service.log(db, user.id, "DEVELOPMENT_PLAN_UPDATED", "plan", None, metadata={"start": str(data.start_date)})
    db.commit()
    return growth_service.development_plan(db, user)


def _goal(db: Session, goal_id: uuid.UUID, user: User) -> DevelopmentGoal:
    goal = db.get(DevelopmentGoal, goal_id)
    if goal is None or goal.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Goal not found.")
    return goal


@router.post("/goals", status_code=201)
def add_goal(data: GoalIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    growth_service.ensure_plan(db, user)
    position = db.scalar(
        select(func.count()).where(DevelopmentGoal.user_id == user.id, DevelopmentGoal.phase == data.phase)
    )
    db.add(DevelopmentGoal(user_id=user.id, phase=data.phase, title=data.title.strip(), position=position or 0))
    db.commit()
    return growth_service.development_plan(db, user)


@router.patch("/goals/{goal_id}")
def update_goal(
    goal_id: uuid.UUID, data: GoalUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    goal = _goal(db, goal_id, user)
    if data.title is not None:
        goal.title = data.title.strip()
    if data.evidence is not None:
        goal.evidence = data.evidence.strip()
    if data.done is not None and data.done != goal.done:
        growth_service.mark_goal(goal, data.done)
        audit_service.log(db, user.id, "GOAL_UPDATED", "goal", goal.id, new_state={"done": goal.done})
    db.commit()
    return growth_service.development_plan(db, user)


@router.delete("/goals/{goal_id}")
def delete_goal(goal_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.delete(_goal(db, goal_id, user))
    db.commit()
    return growth_service.development_plan(db, user)
