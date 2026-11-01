"""The visitor's real IP address.

On Render every request reaches the app through Render's own proxy, so
``request.client.host`` is the proxy's address and is shared by everyone.
Render's edge (Cloudflare) writes the visitor's address into
``True-Client-IP`` / ``CF-Connecting-IP`` and overwrites any value a
visitor tries to send, so those are used when present. ``X-Forwarded-For``
is never trusted: a visitor can put anything at its start.
"""

from __future__ import annotations

import ipaddress

from fastapi import Request

from app.config import settings

EDGE_HEADERS = ("true-client-ip", "cf-connecting-ip")


def _valid_ip(value: str | None) -> str | None:
    text = str(value or "").strip()
    if not text or "," in text:
        return None
    try:
        return str(ipaddress.ip_address(text))
    except ValueError:
        return None


def client_ip(request: Request) -> str:
    if settings.trust_edge_ip_headers:
        for header in EDGE_HEADERS:
            found = _valid_ip(request.headers.get(header))
            if found:
                return found
    return request.client.host if request.client is not None else "unknown"
