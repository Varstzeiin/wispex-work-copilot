import uuid
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models import ErrorReport, User
from app.schemas.performance import ErrorCreate, ErrorStatusChange, ErrorUpdate
from app.services import error_service

router = APIRouter(prefix="/errors", tags=["errors"])


@router.get("")
def list_errors(
    status: Optional[Literal["open", "resolved", "all"]] = "all",
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    stmt = select(ErrorReport).where(ErrorReport.user_id == user.id)
    if status == "open":
        stmt = stmt.where(ErrorReport.status != "RESOLVED")
    elif status == "resolved":
        stmt = stmt.where(ErrorReport.status == "RESOLVED")
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(
        stmt.order_by(ErrorReport.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    ).all()
    return {"items": [error_service.serialize(r) for r in rows], "total": total, "page": page, "page_size": page_size}


@router.get("/analytics")
def error_analytics(
    days: int = Query(default=30, ge=7, le=365),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return error_service.analytics(db, user, days)


@router.post("", status_code=201)
def report_error(data: ErrorCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return error_service.serialize(error_service.create_error(db, user, data))


@router.get("/{error_id}")
def get_error(error_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return error_service.serialize(error_service.get_error_for_user(db, user, error_id))


@router.patch("/{error_id}")
def update_error(
    error_id: uuid.UUID, data: ErrorUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    report = error_service.get_error_for_user(db, user, error_id)
    return error_service.serialize(error_service.update_error(db, user, report, data))


@router.post("/{error_id}/status")
def change_status(
    error_id: uuid.UUID, data: ErrorStatusChange, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    report = error_service.get_error_for_user(db, user, error_id)
    return error_service.serialize(error_service.change_status(db, user, report, data))


# There is intentionally no DELETE endpoint: error reports are corrected, never hidden.
