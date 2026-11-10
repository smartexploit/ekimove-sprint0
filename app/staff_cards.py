"""Staff ID cards with public verification.

Each printed card carries a QR code for https://ekimove.com.ng/verify/<code>
and the same code in text. Anyone (a driver, a rider, a shop) can scan it or
type the code to see whether the holder is current EkiMove staff. A card can
be cancelled at any time (lost card, someone leaves), and the check then says
so. Only owners/super admins manage cards; the public check shows just the
name, job title, staff number, photo and validity, nothing else.
"""

from __future__ import annotations

import io
import json
import re
import secrets
from datetime import date, datetime, timedelta, timezone

import segno
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import require_super_admin
from app.client_ip import client_ip
from app.config import settings
from app.database import get_db
from app.driver_applications import ALLOWED_IMAGES, MAX_PHOTO_BYTES
from app.models import AuditLog, StaffCard, User
from app.photo_storage import PhotoStorageError, delete_driver_photo, download_driver_photo, upload_driver_photo
from app.rate_limit import enforce as enforce_rate_limit

router = APIRouter(prefix="/api/v1/admin/staff-cards", tags=["staff ID cards"])
public_router = APIRouter(prefix="/api/v1/staff-cards", tags=["staff ID cards"])

# No 0/O or 1/I/L, so a code typed from a card can't be misread.
ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 8
PREFIX = "EKM"


def _today() -> date:
    return (datetime.now(timezone.utc) + timedelta(hours=1)).date()  # Lagos time


def new_code(db: Session) -> str:
    while True:
        code = "".join(secrets.choice(ALPHABET) for _ in range(CODE_LENGTH))
        if db.scalar(select(StaffCard.id).where(StaffCard.code == code)) is None:
            return code


def clean_code(value: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (value or "").upper())[:CODE_LENGTH + 4]


def pretty_code(code: str) -> str:
    return f"{code[:4]}-{code[4:]}"


def verify_url(code: str) -> str:
    return f"{settings.frontend_url.rstrip('/')}/verify/{code}"


def status_of(card: StaffCard) -> str:
    if card.revoked_at is not None:
        return "revoked"
    if card.expires_on < _today():
        return "expired"
    return "valid"


def _next_number(db: Session) -> str:
    numbers = [int(n.split("-")[-1]) for n in db.scalars(select(StaffCard.staff_number)).all()
               if re.fullmatch(rf"{PREFIX}-\d+", n or "")]
    return f"{PREFIX}-{(max(numbers) + 1) if numbers else 1:03d}"


def _row(card: StaffCard) -> dict:
    return {
        "id": card.id, "staff_number": card.staff_number, "full_name": card.full_name, "title": card.title,
        "code": pretty_code(card.code), "verify_url": verify_url(card.code), "has_photo": bool(card.photo_ref),
        "issued_on": card.issued_on.isoformat(), "expires_on": card.expires_on.isoformat(),
        "status": status_of(card), "revoked_reason": card.revoked_reason,
        "revoked_at": card.revoked_at.isoformat() if card.revoked_at else None,
    }


def _audit(db: Session, admin: User, action: str, card: StaffCard, **details) -> None:
    db.add(AuditLog(actor_user_id=admin.id, action=action, entity_type="staff_card", entity_id=str(card.id),
                    details=json.dumps({"staff_number": card.staff_number, "name": card.full_name, **details})))


def _text(value: str, label: str, limit: int) -> str:
    cleaned = " ".join((value or "").split())
    if len(cleaned) < 2 or len(cleaned) > limit:
        raise HTTPException(status_code=422, detail=f"Enter the {label} (2–{limit} characters).")
    return cleaned


def _dates(issued_on: date | None, expires_on: date | None) -> tuple[date, date]:
    issued = issued_on or _today()
    expires = expires_on or issued.replace(year=issued.year + 1) - timedelta(days=1)
    if expires <= issued:
        raise HTTPException(status_code=422, detail="The expiry date must be after the issue date.")
    if expires > issued + timedelta(days=366 * 3):
        raise HTTPException(status_code=422, detail="Cards can be valid for at most 3 years.")
    return issued, expires


async def _read_photo(photo: UploadFile) -> bytes:
    rule = ALLOWED_IMAGES.get((photo.content_type or "").lower())
    if rule is None:
        raise HTTPException(status_code=415, detail="Upload a JPEG, PNG or WebP photo.")
    try:
        data = await photo.read(MAX_PHOTO_BYTES + 1)
    finally:
        await photo.close()
    if not data or len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=413, detail="The photo must be no larger than 5 MB.")
    if not rule[1](data):
        raise HTTPException(status_code=415, detail="The file doesn’t look like a real photo.")
    return data


def _store(data: bytes) -> str:
    try:
        return upload_driver_photo(data, folder="staff-photos")
    except PhotoStorageError:
        raise HTTPException(status_code=503, detail="Photo storage isn’t available right now. Try again later.") from None


def _card(db: Session, card_id: int) -> StaffCard:
    card = db.get(StaffCard, card_id)
    if card is None:
        raise HTTPException(status_code=404, detail="Card not found.")
    return card


# --------------------------------------------------------------------------
# Admin: issue, edit, cancel, reissue, QR
# --------------------------------------------------------------------------


@router.get("")
def list_cards(db: Session = Depends(get_db), admin: User = Depends(require_super_admin)) -> dict:
    cards = db.scalars(select(StaffCard).order_by(StaffCard.staff_number, StaffCard.id.desc())).all()
    rows = [_row(c) for c in cards]
    return {"cards": rows, "next_number": _next_number(db),
            "counts": {s: sum(1 for r in rows if r["status"] == s) for s in ("valid", "expired", "revoked")}}


@router.post("", status_code=201)
async def issue_card(full_name: str = Form(...), title: str = Form(...), issued_on: date | None = Form(None),
                     expires_on: date | None = Form(None), photo: UploadFile | None = File(None),
                     db: Session = Depends(get_db), admin: User = Depends(require_super_admin)) -> dict:
    name, job = _text(full_name, "full name", 120), _text(title, "job title", 80)
    issued, expires = _dates(issued_on, expires_on)
    photo_ref = _store(await _read_photo(photo)) if photo is not None and photo.filename else None
    card = StaffCard(staff_number=_next_number(db), code=new_code(db), full_name=name, title=job, photo_ref=photo_ref,
                     issued_on=issued, expires_on=expires, created_by_user_id=admin.id)
    db.add(card)
    try:
        db.flush()
        _audit(db, admin, "staff_card.issued", card)
        db.commit()
    except Exception:
        db.rollback()
        delete_driver_photo(photo_ref)
        raise
    return _row(card)


class CardUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    full_name: str | None = Field(default=None, max_length=200)
    title: str | None = Field(default=None, max_length=200)
    expires_on: date | None = None


@router.patch("/{card_id}")
def update_card(card_id: int, payload: CardUpdate, db: Session = Depends(get_db),
                admin: User = Depends(require_super_admin)) -> dict:
    card = _card(db, card_id)
    if card.revoked_at is not None:
        raise HTTPException(status_code=409, detail="This card is cancelled. Issue a new one instead.")
    if payload.full_name is not None:
        card.full_name = _text(payload.full_name, "full name", 120)
    if payload.title is not None:
        card.title = _text(payload.title, "job title", 80)
    if payload.expires_on is not None:
        _dates(card.issued_on, payload.expires_on)
        card.expires_on = payload.expires_on
    _audit(db, admin, "staff_card.updated", card)
    db.commit()
    return _row(card)


@router.post("/{card_id}/photo")
async def replace_photo(card_id: int, photo: UploadFile = File(...), db: Session = Depends(get_db),
                        admin: User = Depends(require_super_admin)) -> dict:
    card = _card(db, card_id)
    new_ref = _store(await _read_photo(photo))
    old_ref, card.photo_ref = card.photo_ref, new_ref
    _audit(db, admin, "staff_card.photo_changed", card)
    db.commit()
    # Reissued cards share a photo; only delete it when nothing else uses it.
    if old_ref and db.scalar(select(StaffCard.id).where(StaffCard.photo_ref == old_ref)) is None:
        delete_driver_photo(old_ref)
    return _row(card)


class RevokeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(min_length=3, max_length=200)


@router.post("/{card_id}/revoke")
def revoke_card(card_id: int, payload: RevokeIn, db: Session = Depends(get_db),
                admin: User = Depends(require_super_admin)) -> dict:
    card = _card(db, card_id)
    if card.revoked_at is None:
        card.revoked_at = datetime.now(timezone.utc)
        card.revoked_reason = " ".join(payload.reason.split())
        _audit(db, admin, "staff_card.revoked", card, reason=card.revoked_reason)
        db.commit()
    return _row(card)


class ReissueIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expires_on: date | None = None


@router.post("/{card_id}/reissue", status_code=201)
def reissue_card(card_id: int, payload: ReissueIn | None = None, db: Session = Depends(get_db),
                 admin: User = Depends(require_super_admin)) -> dict:
    """A replacement card (lost, damaged or renewed): same staff number and
    photo, a new code; the old card is cancelled so it stops verifying."""
    old = _card(db, card_id)
    issued, expires = _dates(None, payload.expires_on if payload else None)
    card = StaffCard(staff_number=old.staff_number, code=new_code(db), full_name=old.full_name, title=old.title,
                     photo_ref=old.photo_ref, issued_on=issued, expires_on=expires, created_by_user_id=admin.id)
    db.add(card)
    if old.revoked_at is None:
        old.revoked_at = datetime.now(timezone.utc)
        old.revoked_reason = "Replaced by a new card"
    db.flush()
    _audit(db, admin, "staff_card.reissued", card, replaces=old.id)
    db.commit()
    return _row(card)


@router.get("/{card_id}/photo")
def card_photo(card_id: int, db: Session = Depends(get_db), admin: User = Depends(require_super_admin)) -> Response:
    return _photo_response(_card(db, card_id))


@router.get("/{card_id}/qr.{fmt}")
def card_qr(card_id: int, fmt: str, db: Session = Depends(get_db),
            admin: User = Depends(require_super_admin)) -> Response:
    """The QR code to print on the card (SVG for print shops, PNG otherwise)."""
    card = _card(db, card_id)
    if fmt not in {"svg", "png"}:
        raise HTTPException(status_code=404, detail="Use .svg or .png")
    qr = segno.make(verify_url(card.code), error="q")
    out = io.BytesIO()
    if fmt == "svg":
        qr.save(out, kind="svg", scale=10, border=2, dark="#0A3A2C", xmldecl=False)
        media = "image/svg+xml"
    else:
        qr.save(out, kind="png", scale=20, border=2, dark="#0A3A2C")
        media = "image/png"
    name = f"EkiMove-{card.staff_number}-QR.{fmt}"
    return Response(out.getvalue(), media_type=media,
                    headers={"Content-Disposition": f'attachment; filename="{name}"', "Cache-Control": "no-store"})


def _photo_response(card: StaffCard) -> Response:
    if not card.photo_ref:
        raise HTTPException(status_code=404, detail="No photo on this card.")
    try:
        data, content_type = download_driver_photo(card.photo_ref)
    except (PhotoStorageError, FileNotFoundError, ValueError):
        raise HTTPException(status_code=404, detail="Photo not available.") from None
    return Response(content=data, media_type=content_type,
                    headers={"Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff"})


# --------------------------------------------------------------------------
# Public check
# --------------------------------------------------------------------------


def _lookup(db: Session, request: Request, code: str) -> StaffCard | None:
    enforce_rate_limit("staff-verify", client_ip(request), 30, 600,
                       "Too many checks. Please wait a few minutes and try again.")
    cleaned = clean_code(code)
    if len(cleaned) != CODE_LENGTH:
        return None
    return db.scalar(select(StaffCard).where(StaffCard.code == cleaned))


@public_router.get("/verify/{code}")
def verify(code: str, request: Request, db: Session = Depends(get_db)) -> dict:
    card = _lookup(db, request, code)
    if card is None:
        return {"status": "not_found"}
    status = status_of(card)
    out = {"status": status, "full_name": card.full_name, "title": card.title, "staff_number": card.staff_number,
           "expires_on": card.expires_on.isoformat(), "has_photo": bool(card.photo_ref) and status != "revoked"}
    if status == "revoked":
        out["revoked_on"] = card.revoked_at.date().isoformat() if card.revoked_at else None
    return out


@public_router.get("/verify/{code}/photo")
def verify_photo(code: str, request: Request, db: Session = Depends(get_db)) -> Response:
    card = _lookup(db, request, code)
    if card is None or status_of(card) == "revoked":
        raise HTTPException(status_code=404, detail="Photo not available.")
    return _photo_response(card)
