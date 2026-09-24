"""Sign in with Google. Google's token endpoint is mocked: no network, no real Google account."""

import base64
import hashlib
import time
from urllib.parse import parse_qs, urlparse

import httpx
import jwt
import pytest

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.integrations.google_login import (
    GoogleLoginClient,
    GoogleLoginError,
    parse_id_token,
    set_google_login_client,
)
from app.models import OAuthIdentity
from tests.conftest import make_client, register

CLIENT_ID = "test-client.apps.googleusercontent.com"


@pytest.fixture
def google(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", CLIENT_ID)
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "test-secret")
    monkeypatch.setenv("FRONTEND_URL", "https://app.example.com")
    get_settings.cache_clear()
    seen = {}
    profile = {"sub": "google-123", "email": "Vito@Example.com", "email_verified": True, "name": "Vito"}

    def token_endpoint(request: httpx.Request) -> httpx.Response:
        form = parse_qs(request.content.decode())
        seen["form"] = {k: v[0] for k, v in form.items()}
        claims = {"iss": "https://accounts.google.com", "aud": CLIENT_ID, "exp": int(time.time()) + 300,
                  "nonce": seen["nonce"], **profile}
        return httpx.Response(200, json={"id_token": jwt.encode(claims, "any-key", algorithm="HS256")})

    set_google_login_client(GoogleLoginClient(transport=httpx.MockTransport(token_endpoint)))
    yield {"seen": seen, "profile": profile}
    set_google_login_client(None)
    get_settings.cache_clear()


def start(client, seen) -> dict:
    r = client.get("/api/auth/google/start", follow_redirects=False)
    assert r.status_code == 302
    query = {k: v[0] for k, v in parse_qs(urlparse(r.headers["location"]).query).items()}
    seen["nonce"] = query["nonce"]
    return query


def callback(client, state, code="auth-code"):
    return client.get("/api/auth/google/callback", params={"code": code, "state": state}, follow_redirects=False)


def test_providers_and_unconfigured_server():
    c = make_client()
    assert c.get("/api/auth/providers").json() == {"google": False}
    r = c.get("/api/auth/google/start", follow_redirects=False)
    assert r.status_code == 302 and r.headers["location"] == "/login?google=unavailable"


def test_start_uses_pkce_state_nonce_and_minimal_scope(google):
    c = make_client()
    assert c.get("/api/auth/providers").json() == {"google": True}
    q = start(c, google["seen"])
    assert q["client_id"] == CLIENT_ID and q["scope"] == "openid email profile"
    assert q["redirect_uri"] == "https://app.example.com/api/auth/google/callback"
    assert q["code_challenge_method"] == "S256" and q["state"] and q["nonce"]
    assert "wispex_google_flow" in c.cookies


def test_first_google_sign_in_creates_the_account(google):
    c = make_client()
    q = start(c, google["seen"])
    r = callback(c, q["state"])
    assert r.status_code == 302 and r.headers["location"] == "/"
    me = c.get("/api/auth/me").json()
    assert me["email"] == "vito@example.com" and me["full_name"] == "Vito"
    # PKCE: the verifier sent to Google matches the challenge from the start
    verifier = google["seen"]["form"]["code_verifier"]
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    assert challenge == q["code_challenge"]
    # Account is ready to use, like a password sign-up
    assert c.get("/api/documents/settings").json()["final_checklist"]


def test_second_sign_in_uses_the_same_account(google):
    c = make_client()
    callback(c, start(c, google["seen"])["state"])
    first = c.get("/api/auth/me").json()["id"]
    c2 = make_client()
    callback(c2, start(c2, google["seen"])["state"])
    assert c2.get("/api/auth/me").json()["id"] == first
    with SessionLocal() as db:
        assert db.query(OAuthIdentity).count() == 1


def test_google_account_cannot_sign_in_with_a_password(google):
    c = make_client()
    callback(c, start(c, google["seen"])["state"])
    r = make_client().post("/api/auth/login", json={"email": "vito@example.com", "password": "!google"})
    assert r.status_code == 401


def test_existing_password_account_is_never_taken_over(google):
    register(make_client(), email="vito@example.com")  # e.g. someone registered this address first
    c = make_client()
    r = callback(c, start(c, google["seen"])["state"])
    assert r.headers["location"] == "/login?google=email_exists"
    assert c.get("/api/auth/me").status_code == 401
    with SessionLocal() as db:
        assert db.query(OAuthIdentity).count() == 0


def test_forged_or_missing_state_is_rejected(google):
    c = make_client()
    start(c, google["seen"])
    assert callback(c, "attacker-state").headers["location"] == "/login?google=failed"
    fresh = make_client()  # no flow cookie: the request did not start here
    assert callback(fresh, "whatever").headers["location"] == "/login?google=expired"
    cancelled = c.get("/api/auth/google/callback", params={"error": "access_denied"}, follow_redirects=False)
    assert cancelled.headers["location"] == "/login?google=cancelled"


def test_unverified_google_email_is_rejected(google):
    google["profile"]["email_verified"] = False
    c = make_client()
    assert callback(c, start(c, google["seen"])["state"]).headers["location"] == "/login?google=failed"


def test_id_token_claims_are_checked(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", CLIENT_ID)
    get_settings.cache_clear()
    good = {"iss": "accounts.google.com", "aud": CLIENT_ID, "exp": int(time.time()) + 60, "nonce": "n1",
            "sub": "1", "email": "a@example.com", "email_verified": True}

    def token(**changes):
        return jwt.encode({**good, **changes}, "k", algorithm="HS256")

    assert parse_id_token(token(), "n1").email == "a@example.com"
    for bad, nonce in (
        (token(aud="someone-else"), "n1"),
        (token(iss="https://evil.example.com"), "n1"),
        (token(exp=int(time.time()) - 5), "n1"),
        (token(), "other-nonce"),
        (token(email_verified=False), "n1"),
        ("not-a-jwt", "n1"),
    ):
        with pytest.raises(GoogleLoginError):
            parse_id_token(bad, nonce)
    get_settings.cache_clear()
