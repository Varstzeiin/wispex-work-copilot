from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.security import (
    AUTH_COOKIE,
    auth_rate_limiter,
    create_access_token,
    get_current_user,
    hash_password,
    verify_password,
)
from app.models import User
from app.schemas.auth import LoginIn, RegisterIn, UserOut
from app.services import audit_service, calendar_service
from app.services.settings_service import get_user_settings

router = APIRouter(prefix="/auth", tags=["auth"])


def set_session_cookie(response: Response, user: User) -> None:
    settings = get_settings()
    response.set_cookie(
        AUTH_COOKIE,
        create_access_token(user.id),
        max_age=settings.jwt_expire_minutes * 60,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )


def user_out(user: User) -> UserOut:
    return UserOut(id=user.id, email=user.email, full_name=user.full_name, is_demo=user.is_demo)


def _client_key(request: Request) -> str:
    return request.client.host if request.client else "unknown"


@router.post("/register", response_model=UserOut, status_code=201)
def register(data: RegisterIn, request: Request, response: Response, db: Session = Depends(get_db)):
    auth_rate_limiter.check(f"register:{_client_key(request)}")
    email = data.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists.")
    user = User(email=email, password_hash=hash_password(data.password), full_name=data.full_name.strip())
    db.add(user)
    db.flush()
    get_user_settings(db, user)
    audit_service.log(db, user.id, "USER_REGISTERED", "user", user.id)
    db.commit()
    set_session_cookie(response, user)
    return user_out(user)


@router.post("/login", response_model=UserOut)
def login(data: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    auth_rate_limiter.check(f"login:{_client_key(request)}")
    user = db.scalar(select(User).where(User.email == data.email.lower()))
    if user is None or user.is_demo or not verify_password(data.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Email or password is incorrect.")
    audit_service.log(db, user.id, "USER_LOGGED_IN", "user", user.id)
    db.commit()
    set_session_cookie(response, user)
    return user_out(user)


@router.post("/logout", status_code=204)
def logout(response: Response):
    response.delete_cookie(AUTH_COOKIE, path="/")


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user_out(user)


@router.delete("/me", status_code=204)
def delete_account(response: Response, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Permanently delete the account and every record linked to it."""
    calendar_service.disconnect_google(db, user)  # revoke Google access first, if connected
    db.delete(user)
    db.commit()
    response.delete_cookie(AUTH_COOKIE, path="/")
