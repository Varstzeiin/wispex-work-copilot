import secrets
from datetime import timedelta

import jwt
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import create_user_rows, get_db, utcnow
from app.core.security import (
    AUTH_COOKIE,
    auth_rate_limiter,
    create_access_token,
    get_current_user,
    hash_password,
    verify_password,
)
from app.integrations.google_login import GoogleLoginError, get_google_login_client, pkce_pair
from app.models import OAuthIdentity, User
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
    create_user_rows(db, user.id)
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


# ---------- Sign in with Google ----------

GOOGLE_FLOW_COOKIE = "wispex_google_flow"
GOOGLE_FLOW_PATH = "/api/auth/google"


@router.get("/providers")
def providers():
    """Which sign-in methods this server offers (the login page shows only working buttons)."""
    return {"google": get_settings().google_login_configured}


def _login_error(code: str) -> RedirectResponse:
    # Relative redirects: the callback is served through the frontend's own domain
    response = RedirectResponse(f"/login?google={code}", status_code=302)
    response.delete_cookie(GOOGLE_FLOW_COOKIE, path=GOOGLE_FLOW_PATH)
    return response


@router.get("/google/start")
def google_start(request: Request):
    settings = get_settings()
    if not settings.google_login_configured:
        return _login_error("unavailable")
    auth_rate_limiter.check(f"google:{_client_key(request)}")
    state, nonce = secrets.token_urlsafe(24), secrets.token_urlsafe(24)
    verifier, challenge = pkce_pair()
    # One-time values live in a short, signed, httpOnly cookie that only this flow's paths receive
    flow = jwt.encode(
        {"state": state, "nonce": nonce, "verifier": verifier, "exp": utcnow() + timedelta(minutes=10)},
        settings.jwt_secret,
        algorithm="HS256",
    )
    response = RedirectResponse(get_google_login_client().authorization_url(state, nonce, challenge), status_code=302)
    response.set_cookie(
        GOOGLE_FLOW_COOKIE, flow, max_age=600, httponly=True, secure=settings.cookie_secure,
        samesite="lax", path=GOOGLE_FLOW_PATH,
    )
    return response


@router.get("/google/callback")
def google_callback(
    request: Request,
    code: str = Query(default="", max_length=2048),
    state: str = Query(default="", max_length=128),
    error: str = Query(default="", max_length=128),
    db: Session = Depends(get_db),
):
    settings = get_settings()
    if error:
        return _login_error("cancelled")
    try:
        flow = jwt.decode(request.cookies.get(GOOGLE_FLOW_COOKIE, ""), settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        return _login_error("expired")
    if not code or not secrets.compare_digest(state, str(flow.get("state", ""))):
        return _login_error("failed")
    try:
        profile = get_google_login_client().profile_from_code(code, flow["verifier"], flow["nonce"])
    except GoogleLoginError:
        return _login_error("failed")

    identity = db.scalar(
        select(OAuthIdentity).where(OAuthIdentity.provider == "google", OAuthIdentity.subject == profile.subject)
    )
    if identity is not None:
        user = db.get(User, identity.user_id)
        action = "USER_LOGGED_IN"
    else:
        if db.scalar(select(User).where(User.email == profile.email)):
            # Never attach Google to an existing password account automatically: someone could have
            # registered this address earlier without owning it.
            return _login_error("email_exists")
        # "!" is not a valid password hash, so this account can only sign in with Google
        user = User(email=profile.email, password_hash="!google", full_name=profile.name[:120])
        db.add(user)
        db.flush()
        db.add(OAuthIdentity(user_id=user.id, provider="google", subject=profile.subject, email=profile.email))
        get_user_settings(db, user)
        create_user_rows(db, user.id)
        action = "USER_REGISTERED"
    audit_service.log(db, user.id, action, "user", user.id, metadata={"method": "google"})
    db.commit()
    response = RedirectResponse("/", status_code=302)
    response.delete_cookie(GOOGLE_FLOW_COOKIE, path=GOOGLE_FLOW_PATH)
    set_session_cookie(response, user)
    return response
