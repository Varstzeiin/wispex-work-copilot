import base64
import hashlib
import hmac
import secrets
import time
import uuid
from collections import defaultdict, deque
from datetime import timedelta

import jwt
from cryptography.fernet import Fernet, InvalidToken
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db, utcnow
from app.models import User

AUTH_COOKIE = "wispex_session"
CSRF_HEADER = "x-requested-with"
_PBKDF2_ITERATIONS = 390_000


# ---------- Passwords ----------

def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${_PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, iterations, salt_hex, digest_hex = stored.split("$")
        digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), bytes.fromhex(salt_hex), int(iterations)
        )
        return hmac.compare_digest(digest.hex(), digest_hex)
    except ValueError:
        return False


# ---------- Session tokens ----------

def create_access_token(user_id: uuid.UUID) -> str:
    settings = get_settings()
    now = utcnow()
    payload = {
        "sub": str(user_id),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.jwt_expire_minutes)).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def _decode_token(token: str) -> uuid.UUID | None:
    try:
        payload = jwt.decode(token, get_settings().jwt_secret, algorithms=["HS256"])
        return uuid.UUID(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        return None


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    """Authentication for every protected endpoint.

    The session token lives in an httpOnly cookie so page scripts cannot read it.
    A Bearer header is also accepted for API clients and tests.
    """
    token = request.cookies.get(AUTH_COOKIE)
    auth_header = request.headers.get("authorization", "")
    if not token and auth_header.lower().startswith("bearer "):
        token = auth_header[7:]
    user_id = _decode_token(token) if token else None
    user = db.get(User, user_id) if user_id else None
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Please sign in again.")
    return user


# ---------- CSRF ----------

async def require_csrf_header(request: Request) -> None:
    """Cookie-authenticated state changes must carry a custom header.

    Browsers cannot add custom headers to cross-site requests without a CORS preflight,
    which our CORS policy does not allow for foreign origins.
    """
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return
    if request.cookies.get(AUTH_COOKIE) and request.headers.get(CSRF_HEADER) != "wispex":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Request blocked by CSRF protection.")


# ---------- Rate limiting (in-memory, per process) ----------

class RateLimiter:
    """Simple sliding-window limiter. Good enough for a single instance MVP.

    For multiple instances, replace with a Redis-backed limiter.
    """

    def __init__(self, max_calls: int, window_seconds: int):
        self.max_calls = max_calls
        self.window = window_seconds
        self.calls: dict[str, deque] = defaultdict(deque)

    def check(self, key: str) -> None:
        now = time.monotonic()
        q = self.calls[key]
        while q and now - q[0] > self.window:
            q.popleft()
        if len(q) >= self.max_calls:
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS, "Too many attempts. Please wait a minute."
            )
        q.append(now)

    def reset(self) -> None:
        self.calls.clear()


auth_rate_limiter = RateLimiter(max_calls=10, window_seconds=60)
demo_rate_limiter = RateLimiter(max_calls=get_settings().demo_rate_limit_per_minute, window_seconds=60)
# Approved sending (email / team channel), per user
send_rate_limiter = RateLimiter(max_calls=10, window_seconds=60)
# AI-backed assistant calls, per user
ai_rate_limiter = RateLimiter(max_calls=20, window_seconds=60)


# ---------- Encryption for OAuth tokens ----------

def _fernet() -> Fernet:
    key = get_settings().encryption_key
    if not key:
        # Derive a development key from the JWT secret so local dev works out of the box.
        if get_settings().is_production:
            raise RuntimeError("ENCRYPTION_KEY must be set in production")
        key = base64.urlsafe_b64encode(hashlib.sha256(get_settings().jwt_secret.encode()).digest())
    return Fernet(key)


def encrypt(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode() if value else ""


def decrypt(value: str) -> str:
    if not value:
        return ""
    try:
        return _fernet().decrypt(value.encode()).decode()
    except InvalidToken:
        return ""


def encrypt_bytes(data: bytes) -> bytes:
    """Encrypt file contents at rest (local storage backend)."""
    return _fernet().encrypt(data)


def decrypt_bytes(data: bytes) -> bytes:
    return _fernet().decrypt(data)
