"""Sign in with Google (OpenID Connect, authorization code flow with PKCE).

Only the "openid email profile" scopes are requested. Nothing else from the Google account is
read or stored: the stable Google user id, the verified email address and the display name.
"""

import base64
import hashlib
import secrets
import time
from dataclasses import dataclass
from typing import Optional
from urllib.parse import urlencode

import httpx
import jwt

from app.core.config import get_settings

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
ISSUERS = {"accounts.google.com", "https://accounts.google.com"}


class GoogleLoginError(Exception):
    """A user-safe failure message."""


@dataclass
class GoogleProfile:
    subject: str
    email: str
    name: str


def pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


class GoogleLoginClient:
    def __init__(self, transport: Optional[httpx.BaseTransport] = None):
        self._transport = transport

    def authorization_url(self, state: str, nonce: str, code_challenge: str) -> str:
        s = get_settings()
        params = {
            "client_id": s.google_client_id,
            "redirect_uri": s.google_login_redirect,
            "response_type": "code",
            "scope": "openid email profile",
            "state": state,
            "nonce": nonce,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
            "prompt": "select_account",
        }
        return f"{AUTH_URL}?{urlencode(params)}"

    def profile_from_code(self, code: str, code_verifier: str, nonce: str) -> GoogleProfile:
        s = get_settings()
        try:
            with httpx.Client(timeout=15, transport=self._transport) as http:
                response = http.post(
                    TOKEN_URL,
                    data={
                        "code": code,
                        "client_id": s.google_client_id,
                        "client_secret": s.google_client_secret,
                        "redirect_uri": s.google_login_redirect,
                        "grant_type": "authorization_code",
                        "code_verifier": code_verifier,
                    },
                )
        except httpx.HTTPError as exc:
            raise GoogleLoginError("Could not reach Google. Please try again.") from exc
        if response.status_code != 200 or "id_token" not in response.json():
            raise GoogleLoginError("Google did not accept the sign-in. Please try again.")
        return parse_id_token(response.json()["id_token"], nonce)


def parse_id_token(id_token: str, nonce: str) -> GoogleProfile:
    """Validate the claims of an ID token received directly from Google's token endpoint.

    The token comes straight from Google over TLS in exchange for our client secret, so OpenID
    Connect Core 3.1.3.7 allows relying on TLS instead of checking the signature. Every claim that
    matters is still checked: audience, issuer, expiry, nonce and a verified email address.
    """
    s = get_settings()
    try:
        claims = jwt.decode(id_token, options={"verify_signature": False})
    except jwt.PyJWTError as exc:
        raise GoogleLoginError("Google returned an unreadable sign-in. Please try again.") from exc
    audience = claims.get("aud")
    audiences = audience if isinstance(audience, list) else [audience]
    if s.google_client_id not in audiences or claims.get("iss") not in ISSUERS:
        raise GoogleLoginError("This sign-in was not meant for this application.")
    if int(claims.get("exp", 0)) < time.time():
        raise GoogleLoginError("The Google sign-in expired. Please try again.")
    if not nonce or not secrets.compare_digest(str(claims.get("nonce", "")), nonce):
        raise GoogleLoginError("The Google sign-in could not be verified. Please try again.")
    if not claims.get("sub") or not claims.get("email") or claims.get("email_verified") is not True:
        raise GoogleLoginError("Your Google account has no verified email address.")
    return GoogleProfile(
        subject=str(claims["sub"]), email=str(claims["email"]).lower(), name=str(claims.get("name", ""))
    )


_client: Optional[GoogleLoginClient] = None


def get_google_login_client() -> GoogleLoginClient:
    return _client or GoogleLoginClient()


def set_google_login_client(client: Optional[GoogleLoginClient]) -> None:
    global _client
    _client = client
