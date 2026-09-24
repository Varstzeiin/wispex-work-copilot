"""Approved outbound channels: email over the organization's SMTP server and a team-channel webhook.

These modules only deliver a message. The decision is always the user's: the API requires server
configuration, the user's organization-policy confirmation and an explicit approval for every send.
"""

import logging
import smtplib
import ssl
from email.message import EmailMessage
from typing import Optional, Protocol
from urllib.parse import urlparse

import httpx

from app.core.config import get_settings

logger = logging.getLogger("wispex.outbound")


class DeliveryError(Exception):
    """A user-safe failure message. Nothing was sent."""


class EmailSender(Protocol):
    def send(self, to: list[str], subject: str, body: str) -> None: ...


class TeamChannel(Protocol):
    name: str

    def post(self, text: str) -> None: ...


class SmtpEmailSender:
    def __init__(self, host: str, port: int, username: str, password: str, sender: str, starttls: bool = True):
        self.host, self.port, self.username, self.password = host, port, username, password
        self.sender, self.starttls = sender, starttls

    def send(self, to: list[str], subject: str, body: str) -> None:
        msg = EmailMessage()
        msg["From"] = self.sender
        msg["To"] = ", ".join(to)
        msg["Subject"] = " ".join(subject.split())  # no line breaks in headers
        msg.set_content(body)
        try:
            with smtplib.SMTP(self.host, self.port, timeout=20) as smtp:
                if self.starttls:
                    smtp.starttls(context=ssl.create_default_context())
                if self.username:
                    smtp.login(self.username, self.password)
                smtp.send_message(msg)
        except (smtplib.SMTPException, OSError) as exc:
            logger.warning("Email delivery failed: %s", type(exc).__name__)
            raise DeliveryError("The email could not be sent. Nothing was delivered. Please try again later.") from exc


class WebhookTeamChannel:
    def __init__(self, url: str, name: str, transport: Optional[httpx.BaseTransport] = None):
        self.url, self.name, self.transport = url, name, transport

    def post(self, text: str) -> None:
        try:
            with httpx.Client(timeout=15, transport=self.transport) as client:
                response = client.post(self.url, json={"text": text})
        except httpx.HTTPError as exc:
            raise DeliveryError("The team channel could not be reached. Nothing was posted.") from exc
        if response.status_code >= 300:
            logger.warning("Team channel webhook answered %s", response.status_code)
            raise DeliveryError("The team channel refused the message. Nothing was posted.")


_email: Optional[EmailSender] = None
_team: Optional[TeamChannel] = None
_overridden = False


def get_email_sender() -> Optional[EmailSender]:
    if _overridden:
        return _email
    s = get_settings()
    if s.email_provider == "smtp" and s.smtp_host and s.email_from:
        return SmtpEmailSender(
            s.smtp_host, s.smtp_port, s.smtp_username, s.smtp_password, s.email_from, s.smtp_starttls
        )
    return None


def get_team_channel() -> Optional[TeamChannel]:
    if _overridden:
        return _team
    s = get_settings()
    if s.team_webhook_url and urlparse(s.team_webhook_url).scheme == "https":
        return WebhookTeamChannel(s.team_webhook_url, s.team_channel_name)
    return None


def set_outbound(email: Optional[EmailSender], team: Optional[TeamChannel]) -> None:
    """Inject fakes (tests)."""
    global _email, _team, _overridden
    _email, _team, _overridden = email, team, True


def reset_outbound() -> None:
    global _email, _team, _overridden
    _email, _team, _overridden = None, None, False
