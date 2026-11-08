"""Sending text messages and emails (sign-up codes, password resets).

Nothing is sent until a provider is configured in the environment:

* SMS: SMS_PROVIDER=bulksmsnigeria with BULKSMS_API_TOKEN (recommended,
  the lowest price per message), or SMS_PROVIDER=termii with
  TERMII_API_KEY. SMS_SENDER_ID must be a sender ID approved for the
  account (up to 11 letters, e.g. EkiMove).
* Email: EMAIL_PROVIDER=brevo with BREVO_API_KEY (an HTTPS API, so it
  works on hosts that block SMTP), or EMAIL_PROVIDER=smtp with SMTP_HOST,
  SMTP_USERNAME and SMTP_PASSWORD. EMAIL_FROM_ADDRESS is the sender.
"""

from __future__ import annotations

import logging
import smtplib
import ssl
from email.message import EmailMessage

import requests

from app.config import settings
from app.contacts import international_number

logger = logging.getLogger(__name__)
TIMEOUT_SECONDS = 15


class MessagingError(Exception):
    """The provider refused or couldn't be reached."""


def sms_provider() -> str | None:
    provider = (settings.sms_provider or "").strip().lower()
    if provider == "bulksmsnigeria" and settings.bulksms_api_token:
        return provider
    if provider == "termii" and settings.termii_api_key:
        return provider
    return None


def email_provider() -> str | None:
    provider = (settings.email_provider or "").strip().lower()
    if not settings.email_from_address:
        return None
    if provider == "brevo" and settings.brevo_api_key:
        return provider
    if provider == "smtp" and settings.smtp_host:
        return provider
    return None


def sms_configured() -> bool:
    return sms_provider() is not None


def email_configured() -> bool:
    return email_provider() is not None


def _json(response: requests.Response) -> dict:
    try:
        data = response.json()
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


def _send_bulksmsnigeria(to: str, body: str) -> None:
    response = requests.post(
        settings.bulksms_api_url,
        data={
            "api_token": settings.bulksms_api_token,
            "from": settings.sms_sender_id[:11],
            "to": to,
            "body": body,
            # 2 = deliver to Do-Not-Disturb numbers through the corporate route.
            "dnd": "2",
        },
        headers={"Accept": "application/json"},
        timeout=TIMEOUT_SECONDS,
    )
    data = _json(response)
    error = data.get("error")
    status = str((data.get("data") or {}).get("status") or data.get("status") or "").lower()
    if response.status_code >= 400 or error or status in ("error", "failed"):
        message = (error or {}).get("message") if isinstance(error, dict) else error
        raise MessagingError(str(message or data.get("message") or f"HTTP {response.status_code}"))


def _send_termii(to: str, body: str) -> None:
    response = requests.post(
        f"{settings.termii_base_url.rstrip('/')}/api/sms/send",
        json={
            "api_key": settings.termii_api_key,
            "to": to,
            "from": settings.sms_sender_id[:11],
            "sms": body,
            "type": "plain",
            # The "dnd" route reaches numbers on Do-Not-Disturb.
            "channel": "dnd",
        },
        timeout=TIMEOUT_SECONDS,
    )
    data = _json(response)
    if response.status_code >= 400 or not (data.get("message_id") or data.get("code") == "ok"):
        raise MessagingError(str(data.get("message") or f"HTTP {response.status_code}"))


def send_sms(phone: str, body: str) -> None:
    provider = sms_provider()
    if provider is None:
        raise MessagingError("Text messages are not set up.")
    to = international_number(phone)
    try:
        if provider == "bulksmsnigeria":
            _send_bulksmsnigeria(to, body)
        else:
            _send_termii(to, body)
    except requests.RequestException as exc:
        logger.warning("SMS provider unreachable: %s", exc)
        raise MessagingError("The text message service couldn't be reached.") from None
    except MessagingError as exc:
        logger.warning("SMS provider refused a message: %s", exc)
        raise


def _send_brevo(to: str, subject: str, text: str, html: str | None = None) -> None:
    body = {
        "sender": {"name": settings.email_from_name, "email": settings.email_from_address},
        "to": [{"email": to}],
        "subject": subject,
        "textContent": text,
    }
    if html:
        body["htmlContent"] = html
    response = requests.post(
        "https://api.brevo.com/v3/smtp/email",
        json=body,
        headers={"api-key": settings.brevo_api_key, "Accept": "application/json"},
        timeout=TIMEOUT_SECONDS,
    )
    if response.status_code >= 400:
        raise MessagingError(str(_json(response).get("message") or f"HTTP {response.status_code}"))


def _send_smtp(to: str, subject: str, text: str, html: str | None = None) -> None:
    message = EmailMessage()
    message["From"] = f"{settings.email_from_name} <{settings.email_from_address}>"
    message["To"] = to
    message["Subject"] = subject
    message.set_content(text)
    if html:
        message.add_alternative(html, subtype="html")
    context = ssl.create_default_context()
    if settings.smtp_use_ssl:
        server = smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=TIMEOUT_SECONDS, context=context)
    else:
        server = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=TIMEOUT_SECONDS)
    with server:
        if not settings.smtp_use_ssl:
            server.starttls(context=context)
        if settings.smtp_username:
            server.login(settings.smtp_username, settings.smtp_password or "")
        server.send_message(message)


def send_email(to: str, subject: str, text: str, html: str | None = None) -> None:
    provider = email_provider()
    if provider is None:
        raise MessagingError("Email is not set up.")
    try:
        if provider == "brevo":
            _send_brevo(to, subject, text, html)
        else:
            _send_smtp(to, subject, text, html)
    except requests.RequestException as exc:
        logger.warning("Email provider unreachable: %s", exc)
        raise MessagingError("The email service couldn't be reached.") from None
    except (smtplib.SMTPException, OSError) as exc:
        logger.warning("SMTP send failed: %s", exc)
        raise MessagingError("The email service couldn't send the message.") from None
    except MessagingError as exc:
        logger.warning("Email provider refused a message: %s", exc)
        raise
