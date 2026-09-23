from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.api.auth import _client_key, set_session_cookie, user_out
from app.core.config import get_settings
from app.core.database import get_db
from app.core.security import demo_rate_limiter
from app.demo.seed import create_demo_user
from app.schemas.auth import UserOut

router = APIRouter(prefix="/demo", tags=["demo"])


@router.post("/start", response_model=UserOut)
def start_demo(request: Request, response: Response, db: Session = Depends(get_db)):
    """Create a throwaway account filled with fictional data. Removed after 24 hours."""
    if not get_settings().demo_mode_enabled:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Demo mode is not available.")
    demo_rate_limiter.check(f"demo:{_client_key(request)}")
    user = create_demo_user(db)
    set_session_cookie(response, user)
    return user_out(user)
