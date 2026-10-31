"""Phone numbers and email addresses: cleaning, matching and display.

People can sign up and sign in with a phone number or an email address.
Phone numbers are matched in any common Nigerian form, so 0803…, 234803…
and +234803… all find the same account.
"""

from __future__ import annotations

import re

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models import User

EMAIL_RE = re.compile(r"[^\s@]+@[^\s@]+\.[^\s@]+")
PHONE_RE = re.compile(r"\+?\d{7,15}")


class ContactError(ValueError):
    """A phone number or email address that can't be used."""


def is_email(value: str | None) -> bool:
    return "@" in str(value or "")


def clean_email(value: str | None) -> str | None:
    cleaned = str(value or "").strip().lower()
    if not cleaned:
        return None
    if len(cleaned) > 254 or not EMAIL_RE.fullmatch(cleaned):
        raise ContactError("Enter a valid email address.")
    return cleaned


def clean_phone(value: str | None) -> str | None:
    """Drop spaces, dashes and brackets; keep a leading + and digits."""
    raw = str(value or "").strip()
    if not raw:
        return None
    cleaned = ("+" if raw.startswith("+") else "") + re.sub(r"\D", "", raw)
    if not PHONE_RE.fullmatch(cleaned):
        raise ContactError("Enter a valid phone number.")
    return cleaned


def phone_variants(phone: str) -> list[str]:
    """Every stored form that means the same Nigerian number."""
    raw = str(phone or "").strip()
    digits = re.sub(r"\D", "", raw)
    forms = {raw, digits, f"+{digits}"}
    if digits.startswith("234") and len(digits) >= 12:
        local = digits[3:].lstrip("0")
        forms |= {f"0{local}", f"234{local}", f"+234{local}"}
    elif digits.startswith("0") and len(digits) == 11:
        forms |= {f"234{digits[1:]}", f"+234{digits[1:]}"}
    return sorted(form for form in forms if form and form != "+")


def international_number(phone: str) -> str:
    """234XXXXXXXXXX form for SMS providers."""
    digits = re.sub(r"\D", "", str(phone or ""))
    if digits.startswith("234"):
        return f"234{digits[3:].lstrip('0')}"
    if digits.startswith("0"):
        return f"234{digits[1:]}"
    return digits


def find_user_by_phone(db: Session, phone: str) -> User | None:
    return db.scalars(select(User).where(User.phone.in_(phone_variants(phone))).order_by(User.id)).first()


def find_user_by_email(db: Session, email: str) -> User | None:
    return db.scalar(select(User).where(func.lower(User.email) == email.strip().lower()))


def find_user(db: Session, identifier: str) -> User | None:
    """Find an account by the phone number or email it signs in with."""
    identifier = str(identifier or "").strip()
    if not identifier:
        return None
    if is_email(identifier):
        return find_user_by_email(db, identifier)
    return find_user_by_phone(db, identifier)


def phone_taken(db: Session, phone: str, except_user_id: int | None = None) -> bool:
    query = select(User.id).where(User.phone.in_(phone_variants(phone)))
    if except_user_id is not None:
        query = query.where(User.id != except_user_id)
    return db.scalar(query) is not None


def email_taken(db: Session, email: str, except_user_id: int | None = None) -> bool:
    query = select(User.id).where(func.lower(User.email) == email.lower())
    if except_user_id is not None:
        query = query.where(User.id != except_user_id)
    return db.scalar(query) is not None


def mask_phone(phone: str | None) -> str | None:
    if not phone:
        return None
    return f"{phone[:4]}{'•' * max(0, len(phone) - 8)}{phone[-4:]}" if len(phone) > 8 else phone


def mask_email(email: str | None) -> str | None:
    if not email or "@" not in email:
        return email
    name, domain = email.split("@", 1)
    return f"{name[:2]}{'•' * max(1, len(name) - 2)}@{domain}"


def contact_label(user: User | None) -> str | None:
    """How staff screens show the person: their phone, else their email."""
    if user is None:
        return None
    return user.phone or user.email


def search_filter(like: str):
    return or_(User.full_name.ilike(like), User.phone.ilike(like), User.email.ilike(like))
