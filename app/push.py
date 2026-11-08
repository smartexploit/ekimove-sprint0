"""Phone notifications (Web Push) for the EkiMove app.

People turn notifications on from their profile or the driver screen; the
browser gives us a subscription for that phone, which is stored here.

The server's signing keys (VAPID) are created automatically the first
time the app asks for them and kept in app_settings, so no setup is
needed. VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in the environment
override them.

Notifications are queued on the database session and only sent after it
commits, from a background thread, so a request that fails never sends
one and a slow push service never slows the app. Subscriptions the push
service reports as gone (HTTP 404/410) are deleted.
"""

from __future__ import annotations

import base64
import json
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, event, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.config import settings
from app.database import get_db
from app.models import AppSetting, PushSubscription, User

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/push", tags=["notifications"])
_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="ekimove-push")

PUBLIC_KEY = "vapid_public_key"
PRIVATE_KEY = "vapid_private_pem"
# Only real browser push services, so the server never posts to other hosts.
PUSH_HOSTS = (
    "fcm.googleapis.com",
    "android.googleapis.com",
    "push.apple.com",
    "push.services.mozilla.com",
    "notify.windows.com",
)
DEFAULT_SUBJECT = "https://ekimove.com.ng"


# --------------------------------------------------------------------------
# Keys
# --------------------------------------------------------------------------


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _generate_pair() -> tuple[str, str]:
    from cryptography.hazmat.primitives import serialization
    from py_vapid import Vapid01

    vapid = Vapid01()
    vapid.generate_keys()
    public = vapid.public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return _b64url(public), vapid.private_pem().decode("ascii")


def _stored_keys(db: Session) -> tuple[str | None, str | None]:
    if settings.vapid_public_key and settings.vapid_private_key:
        return settings.vapid_public_key, settings.vapid_private_key
    public = db.get(AppSetting, PUBLIC_KEY)
    private = db.get(AppSetting, PRIVATE_KEY)
    return (public.value if public else None), (private.value if private else None)


def ensure_keys(db: Session) -> str:
    """Return the public key, creating the pair once (in its own
    transaction, so two servers starting together can't clash)."""
    public, private = _stored_keys(db)
    if public and private:
        return public
    new_public, new_private = _generate_pair()
    with Session(bind=db.get_bind()) as own:
        try:
            own.add_all([AppSetting(key=PUBLIC_KEY, value=new_public), AppSetting(key=PRIVATE_KEY, value=new_private)])
            own.commit()
        except IntegrityError:
            own.rollback()
    db.expire_all()
    public, _ = _stored_keys(db)
    return public or new_public


def _signer(private: str):
    from py_vapid import Vapid01

    text = private.strip()
    if text.startswith("-----BEGIN"):
        return Vapid01.from_pem(text.encode("ascii"))
    return Vapid01.from_string(private_key=text)


def _subject() -> str:
    if settings.vapid_subject:
        return settings.vapid_subject
    if settings.support_email:
        return f"mailto:{settings.support_email}"
    return DEFAULT_SUBJECT


# --------------------------------------------------------------------------
# Sending
# --------------------------------------------------------------------------


def notify(
    db: Session,
    user_ids,
    title: str,
    body: str,
    url: str = "/",
    tag: str | None = None,
    urgent: bool = False,
    ttl: int = 3600,
    extra: dict | None = None,
) -> None:
    """Queue a notification to everyone in user_ids. Sent after commit."""
    if not settings.push_enabled:
        return
    ids = {user_ids} if isinstance(user_ids, int) else {i for i in user_ids if i}
    if not ids:
        return
    try:
        subs = db.scalars(select(PushSubscription).where(PushSubscription.user_id.in_(ids))).all()
        if not subs:
            return
        public, private = _stored_keys(db)
    except Exception:  # never let a notification break the request
        logger.exception("Could not prepare push notification")
        return
    if not (public and private):
        return
    payload = json.dumps({"title": title, "body": body, "url": url, "tag": tag, **(extra or {})}, ensure_ascii=False)
    queue = db.info.setdefault("push_queue", [])
    for sub in subs:
        queue.append({"id": sub.id, "endpoint": sub.endpoint, "p256dh": sub.p256dh, "auth": sub.auth,
                      "payload": payload, "urgent": urgent, "ttl": ttl})
    db.info["push_signing"] = (db.get_bind(), private)


def notify_admins(db: Session, title: str, body: str, url: str, tag: str | None = None, urgent: bool = False,
                  permission: str | tuple[str, ...] | None = None) -> None:
    """Notify super-admins, plus staff who hold any of `permission` (if given)."""
    ids = list(db.scalars(select(User.id).where(User.role == "super_admin", User.is_active.is_(True))).all())
    wanted = {permission} if isinstance(permission, str) else set(permission or ())
    if wanted:
        for user in db.scalars(select(User).where(User.role == "staff", User.is_active.is_(True))).all():
            if wanted.intersection(user.staff_permissions or []):
                ids.append(user.id)
    notify(db, ids, title, body, url=url, tag=tag, urgent=urgent)


@event.listens_for(Session, "after_commit")
def _after_commit(session: Session) -> None:
    queue = session.info.pop("push_queue", None)
    signing = session.info.pop("push_signing", None)
    if queue and signing:
        _dispatch(signing[0], signing[1], queue)


@event.listens_for(Session, "after_rollback")
def _after_rollback(session: Session) -> None:
    session.info.pop("push_queue", None)
    session.info.pop("push_signing", None)


def _dispatch(bind, private: str, queue: list[dict]) -> None:
    """Hand the queue to a background thread (tests replace this)."""
    _executor.submit(deliver, bind, private, queue)


def deliver(bind, private: str, queue: list[dict]) -> None:
    from pywebpush import WebPushException, webpush

    try:
        signer = _signer(private)
    except Exception:
        logger.exception("Push signing key is not usable")
        return
    sent, gone = set(), set()
    for item in queue:
        try:
            webpush(
                subscription_info={"endpoint": item["endpoint"], "keys": {"p256dh": item["p256dh"], "auth": item["auth"]}},
                data=item["payload"],
                vapid_private_key=signer,
                vapid_claims={"sub": _subject()},
                ttl=item["ttl"],
                headers={"Urgency": "high" if item["urgent"] else "normal"},
                timeout=10,
            )
            sent.add(item["id"])
        except WebPushException as exc:
            code = getattr(exc.response, "status_code", None)
            if code in (404, 410):
                gone.add(item["id"])
            else:
                logger.warning("Push failed (%s): %s", code, exc)
        except Exception:
            logger.exception("Push failed")
    if not (sent or gone):
        return
    try:
        with Session(bind=bind) as db:
            if gone:
                db.execute(delete(PushSubscription).where(PushSubscription.id.in_(gone)))
            if sent:
                db.execute(update(PushSubscription).where(PushSubscription.id.in_(sent))
                           .values(last_sent_at=datetime.now(timezone.utc)))
            db.commit()
    except Exception:
        logger.exception("Could not update push subscriptions")


# --------------------------------------------------------------------------
# Endpoints
# --------------------------------------------------------------------------


@router.get("/config")
def push_config(db: Session = Depends(get_db)) -> dict:
    if not settings.push_enabled:
        return {"enabled": False, "public_key": None}
    return {"enabled": True, "public_key": ensure_keys(db)}


class SubscriptionKeys(BaseModel):
    model_config = ConfigDict(extra="ignore")
    p256dh: str = Field(min_length=20, max_length=255)
    auth: str = Field(min_length=8, max_length=255)


class SubscriptionIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    endpoint: str = Field(min_length=12, max_length=1024)
    keys: SubscriptionKeys


def _valid_endpoint(endpoint: str) -> bool:
    parts = urlsplit(endpoint)
    host = (parts.hostname or "").lower()
    return parts.scheme == "https" and any(host == h or host.endswith(f".{h}") for h in PUSH_HOSTS)


@router.post("/subscriptions")
def subscribe(payload: SubscriptionIn, request: Request, current_user: User = Depends(get_current_user),
              db: Session = Depends(get_db)) -> dict:
    if not settings.push_enabled:
        raise HTTPException(status_code=503, detail="Notifications are switched off.")
    if not _valid_endpoint(payload.endpoint):
        raise HTTPException(status_code=422, detail="This browser's notification service isn't supported.")
    agent = request.headers.get("user-agent", "")[:255] or None
    existing = db.scalar(select(PushSubscription).where(PushSubscription.endpoint == payload.endpoint))
    if existing is None:
        db.add(PushSubscription(user_id=current_user.id, endpoint=payload.endpoint, p256dh=payload.keys.p256dh,
                                auth=payload.keys.auth, user_agent=agent))
    else:
        # Same phone, possibly a different person signed in now.
        existing.user_id = current_user.id
        existing.p256dh = payload.keys.p256dh
        existing.auth = payload.keys.auth
        existing.user_agent = agent
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
    count = len(db.scalars(select(PushSubscription.id).where(PushSubscription.user_id == current_user.id)).all())
    return {"subscribed": True, "devices": count}


class Unsubscribe(BaseModel):
    model_config = ConfigDict(extra="ignore")
    endpoint: str = Field(min_length=12, max_length=1024)


@router.post("/unsubscribe")
def unsubscribe(payload: Unsubscribe, current_user: User = Depends(get_current_user),
                db: Session = Depends(get_db)) -> dict:
    db.execute(delete(PushSubscription).where(PushSubscription.endpoint == payload.endpoint,
                                              PushSubscription.user_id == current_user.id))
    db.commit()
    return {"subscribed": False}


@router.post("/test")
def test_notification(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    count = len(db.scalars(select(PushSubscription.id).where(PushSubscription.user_id == current_user.id)).all())
    if not count:
        raise HTTPException(status_code=409, detail="Turn on notifications on this phone first.")
    notify(db, current_user.id, "Notifications are on", "You'll hear from EkiMove about your trips here.",
           url="/profile", tag="test")
    db.commit()
    return {"sent_to_devices": count}
