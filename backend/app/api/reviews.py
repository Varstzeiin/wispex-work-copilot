from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models import User
from app.schemas.performance import ShiftReflection, WeeklyReflection
from app.services import audit_service, review_service
from app.services.settings_service import get_user_settings

router = APIRouter(prefix="/reviews", tags=["reviews"])


def _not_future(day: date, db: Session, user: User) -> None:
    if day > review_service.local_today(get_user_settings(db, user)):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot review a day that has not happened yet.")


@router.get("/shift")
def shift_review(
    review_date: Optional[date] = None, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    if review_date:
        _not_future(review_date, db, user)
    return review_service.shift_review(db, user, review_date)


@router.put("/shift")
def save_shift_review(data: ShiftReflection, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _not_future(data.review_date, db, user)
    review_service.save_shift_reflection(db, user, data.review_date, data.model_dump())
    audit_service.log(db, user.id, "SHIFT_REVIEW_SAVED", "review", None, metadata={"date": str(data.review_date)})
    db.commit()
    return review_service.shift_review(db, user, data.review_date)


@router.get("/weekly")
def weekly_review(
    week_start: Optional[date] = None, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    if week_start:
        _not_future(week_start, db, user)
    return review_service.weekly_review(db, user, week_start)


@router.put("/weekly")
def save_weekly_review(data: WeeklyReflection, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _not_future(data.week_start, db, user)
    review = review_service.save_weekly_reflection(db, user, data.week_start, data.model_dump())
    audit_service.log(db, user.id, "WEEKLY_REVIEW_SAVED", "review", None, metadata={"week": str(review.week_start)})
    db.commit()
    return review_service.weekly_review(db, user, review.week_start)


@router.get("/history")
def review_history(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return review_service.history(db, user)
