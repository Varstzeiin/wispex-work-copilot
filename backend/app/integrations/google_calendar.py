"""Google Calendar adapter (OAuth 2.0 + REST).

Only active when GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI are set.
Scope is limited to calendar events. Tokens are stored encrypted (see core/security.py).
"""

from datetime import datetime, timedelta
from typing import Optional
from urllib.parse import urlencode

import httpx

from app.core.config import get_settings
from app.core.database import utcnow

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"
API_BASE = "https://www.googleapis.com/calendar/v3"
SCOPE = "https://www.googleapis.com/auth/calendar.events"


class CalendarProviderError(Exception):
    """Raised with a user-safe message. Technical details are logged separately."""


class GoogleCalendarClient:
    def __init__(self, transport: Optional[httpx.BaseTransport] = None):
        self._transport = transport

    def _http(self) -> httpx.Client:
        return httpx.Client(timeout=15, transport=self._transport)

    # ----- OAuth -----

    def authorization_url(self, state: str) -> str:
        s = get_settings()
        params = {
            "client_id": s.google_client_id,
            "redirect_uri": s.google_redirect_uri,
            "response_type": "code",
            "scope": SCOPE,
            "access_type": "offline",
            "prompt": "consent",
            "include_granted_scopes": "true",
            "state": state,
        }
        return f"{AUTH_URL}?{urlencode(params)}"

    def exchange_code(self, code: str) -> dict:
        s = get_settings()
        return self._token_request(
            {
                "code": code,
                "client_id": s.google_client_id,
                "client_secret": s.google_client_secret,
                "redirect_uri": s.google_redirect_uri,
                "grant_type": "authorization_code",
            }
        )

    def refresh(self, refresh_token: str) -> dict:
        s = get_settings()
        return self._token_request(
            {
                "refresh_token": refresh_token,
                "client_id": s.google_client_id,
                "client_secret": s.google_client_secret,
                "grant_type": "refresh_token",
            }
        )

    def revoke(self, token: str) -> None:
        with self._http() as http:
            http.post(REVOKE_URL, data={"token": token})

    def _token_request(self, data: dict) -> dict:
        with self._http() as http:
            response = http.post(TOKEN_URL, data=data)
        if response.status_code != 200:
            raise CalendarProviderError("Google did not accept the authorization. Please connect again.")
        body = response.json()
        body["expires_at"] = utcnow() + timedelta(seconds=int(body.get("expires_in", 3600)) - 60)
        return body

    # ----- Events -----

    def upsert_event(self, access_token: str, calendar_id: str, event_id: str, body: dict) -> str:
        """Create the event with a deterministic ID. If it already exists, update it instead.

        The deterministic ID makes this idempotent: retries never create duplicates.
        """
        headers = {"Authorization": f"Bearer {access_token}"}
        with self._http() as http:
            response = http.post(
                f"{API_BASE}/calendars/{calendar_id}/events",
                json={**body, "id": event_id},
                headers=headers,
            )
            if response.status_code == 409:
                response = http.put(
                    f"{API_BASE}/calendars/{calendar_id}/events/{event_id}",
                    json={**body, "status": "confirmed"},
                    headers=headers,
                )
        if response.status_code not in (200, 201):
            raise CalendarProviderError("Google Calendar could not save the event.")
        return response.json().get("id", event_id)

    def delete_event(self, access_token: str, calendar_id: str, event_id: str) -> None:
        with self._http() as http:
            response = http.delete(
                f"{API_BASE}/calendars/{calendar_id}/events/{event_id}",
                headers={"Authorization": f"Bearer {access_token}"},
            )
        # 404/410 means it is already gone, which is the desired end state
        if response.status_code not in (200, 204, 404, 410):
            raise CalendarProviderError("Google Calendar could not delete the event.")


def build_event_body(
    title: str, description: str, start: datetime, end: datetime, tz: str, reminders: list[int], task_id: str
) -> dict:
    return {
        "summary": title,
        "description": description,
        "start": {"dateTime": start.isoformat(), "timeZone": tz},
        "end": {"dateTime": end.isoformat(), "timeZone": tz},
        "reminders": {
            "useDefault": False,
            "overrides": [{"method": "popup", "minutes": m} for m in reminders[:5]],
        },
        "extendedProperties": {"private": {"wispexTaskId": task_id}},
    }
