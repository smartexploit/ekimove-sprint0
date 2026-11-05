"""Public website content for search engines and link previews.

The super-admin edits page titles, descriptions, area pages and the FAQ in
the operations console ("SEO & website"). The text is kept as one JSON
document in app_settings. "Publish to website" asks Render to rebuild the
static site, whose build step fetches GET /api/v1/public/site and writes a
ready-made HTML page per public address, plus sitemap.xml and robots.txt.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

import requests
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.app_settings import booking_rules, max_passengers, quote_amount
from app.auth import require_super_admin
from app.config import settings
from app.database import get_db
from app.models import AppSetting, AuditLog, Place, PlaceFare, ServiceArea, User, Zone

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1", tags=["website"])

CONTENT_KEY = "site_content"
PUBLISHED_KEY = "site_content_published_at"
DEFAULTS_PATH = Path(__file__).with_name("site_defaults.json")
SLUG_RE = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
RESERVED_SLUGS = {"fares", "faq", "admin", "api", "login", "register", "driver", "policies"}
DEPLOY_HOOK_RE = re.compile(r"https://api\.render\.com/deploy/[A-Za-z0-9_-]+\?key=[A-Za-z0-9_-]+")


def defaults() -> dict:
    return json.loads(DEFAULTS_PATH.read_text(encoding="utf-8"))


def _clean(value: str) -> str:
    """Plain text: no control characters, tidy spaces (blank lines kept)."""
    text = "".join(ch for ch in str(value) if ch == "\n" or ch.isprintable())
    lines = [" ".join(line.split()) for line in text.replace("\r", "").split("\n")]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


class Text(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @field_validator("*", mode="before")
    @classmethod
    def tidy(cls, value):
        return _clean(value) if isinstance(value, str) else value


class SiteInfo(Text):
    name: str = Field(min_length=2, max_length=40)
    tagline: str = Field(min_length=5, max_length=90)
    description: str = Field(min_length=50, max_length=170)
    # "coming_soon" before launch, "live" from launch day (shown on the home page).
    launch_status: Literal["coming_soon", "live"] = "coming_soon"


class PageMeta(Text):
    title: str = Field(min_length=10, max_length=70)
    description: str = Field(min_length=50, max_length=170)


class ContentPage(PageMeta):
    heading: str = Field(min_length=3, max_length=100)
    intro: str = Field(min_length=10, max_length=400)


class Pages(BaseModel):
    model_config = ConfigDict(extra="forbid")
    home: PageMeta
    fares: ContentPage
    faq: ContentPage
    drive: PageMeta
    policies: PageMeta


class AreaPage(ContentPage):
    slug: str = Field(min_length=3, max_length=60)
    body: str = Field(min_length=20, max_length=4000)
    published: bool = True

    @field_validator("slug")
    @classmethod
    def valid_slug(cls, value: str) -> str:
        value = value.strip().lower()
        if not SLUG_RE.fullmatch(value):
            raise ValueError("Use lower-case letters, numbers and hyphens, like eksu-iworoko.")
        if value in RESERVED_SLUGS:
            raise ValueError("That address is used by another page.")
        return value


class FaqItem(Text):
    question: str = Field(min_length=8, max_length=160)
    answer: str = Field(min_length=10, max_length=1000)


class SiteContent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    site: SiteInfo
    pages: Pages
    areas: list[AreaPage] = Field(default_factory=list, max_length=20)
    faq: list[FaqItem] = Field(default_factory=list, max_length=30)

    @field_validator("areas")
    @classmethod
    def unique_slugs(cls, areas: list[AreaPage]) -> list[AreaPage]:
        slugs = [area.slug for area in areas]
        if len(slugs) != len(set(slugs)):
            raise ValueError("Each area page needs its own address.")
        return areas


def current(db: Session) -> dict:
    """Saved content, with any missing part taken from the defaults."""
    content = defaults()
    row = db.get(AppSetting, CONTENT_KEY)
    if row is not None:
        try:
            saved = json.loads(row.value)
            content = SiteContent.model_validate({**content, **saved}).model_dump()
        except (ValueError, TypeError):
            logger.warning("Saved website content is unreadable; using the defaults")
    return content


def public_fares(db: Session, limit: int = 300) -> list[dict]:
    """Active one-passenger fares between bookable places, cheapest first."""
    rows = db.execute(
        select(PlaceFare, Place, ServiceArea, Zone)
        .join(Place, Place.id == PlaceFare.origin_place_id)
        .join(ServiceArea, ServiceArea.id == Place.service_area_id)
        .join(Zone, Zone.id == Place.zone_id)
        .where(PlaceFare.is_active.is_(True), Place.status == "active", ServiceArea.status == "active",
               Zone.is_active.is_(True))
    ).all()
    destinations = {
        place.id: place for place in db.scalars(select(Place).where(
            Place.id.in_({fare.destination_place_id for fare, *_ in rows}), Place.status == "active"))
    }
    rules = booking_rules(db)
    result = []
    for fare, origin, area, _zone in rows:
        destination = destinations.get(fare.destination_place_id)
        if destination is None or max_passengers(rules, fare.vehicle_type) < 1:
            continue
        result.append({
            "area": area.name, "from": origin.name, "to": destination.name, "vehicle_type": fare.vehicle_type,
            "amount": str(quote_amount(rules, fare, fare.vehicle_type, 1)),
        })
    result.sort(key=lambda item: (item["area"], item["from"], item["to"], item["vehicle_type"]))
    return result[:limit]


@router.get("/public/site")
def public_site(db: Session = Depends(get_db)) -> dict:
    content = current(db)
    published = db.get(AppSetting, PUBLISHED_KEY)
    return {
        **content,
        "areas": [area for area in content["areas"] if area.get("published")],
        "fares": public_fares(db),
        "contact": {"email": settings.support_email, "phone": settings.support_phone,
                    "whatsapp": settings.support_whatsapp},
        "site_url": settings.frontend_url.rstrip("/"),
        "published_at": published.value if published else None,
    }


def _hook_configured() -> bool:
    return bool(settings.render_deploy_hook_url and DEPLOY_HOOK_RE.fullmatch(settings.render_deploy_hook_url))


@router.get("/admin/site")
def admin_get_site(db: Session = Depends(get_db), _admin: User = Depends(require_super_admin)) -> dict:
    published = db.get(AppSetting, PUBLISHED_KEY)
    saved = db.get(AppSetting, CONTENT_KEY)
    return {
        "content": current(db),
        "saved_at": saved.updated_at.isoformat() if saved and saved.updated_at else None,
        "published_at": published.value if published else None,
        "publish_available": _hook_configured(),
        "site_url": settings.frontend_url.rstrip("/"),
    }


@router.put("/admin/site")
def admin_save_site(payload: SiteContent, db: Session = Depends(get_db),
                    admin: User = Depends(require_super_admin)) -> dict:
    value = json.dumps(payload.model_dump(), ensure_ascii=False)
    row = db.get(AppSetting, CONTENT_KEY)
    if row is None:
        db.add(AppSetting(key=CONTENT_KEY, value=value, updated_by_user_id=admin.id))
    else:
        row.value, row.updated_by_user_id = value, admin.id
    db.add(AuditLog(actor_user_id=admin.id, action="website.saved", entity_type="website", entity_id="site",
                    details=f"Website content saved: {len(payload.areas)} area pages, {len(payload.faq)} FAQ items."))
    db.commit()
    return admin_get_site(db, admin)


@router.post("/admin/site/publish")
def admin_publish_site(db: Session = Depends(get_db), admin: User = Depends(require_super_admin)) -> dict:
    if not _hook_configured():
        raise HTTPException(status_code=503, detail="Publishing isn't set up yet. In Render, copy the static site's "
                                                    "Deploy Hook and save it as RENDER_DEPLOY_HOOK_URL on the API.")
    try:
        response = requests.post(settings.render_deploy_hook_url, timeout=15)
        response.raise_for_status()
    except requests.RequestException:
        logger.warning("Website publish request failed")
        raise HTTPException(status_code=502, detail="Render didn't accept the publish request. Please try again "
                                                    "in a minute.") from None
    now = datetime.now(timezone.utc).isoformat()
    row = db.get(AppSetting, PUBLISHED_KEY)
    if row is None:
        db.add(AppSetting(key=PUBLISHED_KEY, value=now, updated_by_user_id=admin.id))
    else:
        row.value, row.updated_by_user_id = now, admin.id
    db.add(AuditLog(actor_user_id=admin.id, action="website.published", entity_type="website", entity_id="site",
                    details="Website rebuild requested."))
    db.commit()
    return {"published_at": now, "message": "Publishing started. The website updates in about 2 to 5 minutes."}
