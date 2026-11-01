"""Phone numbers and email addresses: cleaning, matching and display.

People can sign up and sign in with a phone number or an email address.
Phone numbers are matched in any common Nigerian form, so 0803…, 234803…
and +234803… all find the same account.
"""

from __future__ import annotations

import re
import unicodedata

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models import User

# Plain addresses only: letters, digits and . _ % + - before the @, and a
# domain of letters, digits and hyphens with a 2+ letter ending.
EMAIL_RE = re.compile(
    r"[a-z0-9](?:[a-z0-9._%+-]{0,62}[a-z0-9_%+-])?@"
    r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}"
)
# Nigerian mobile numbers: 070x, 080x, 081x, 090x, 091x (11 digits), also
# written 234… or +234…. EkiMove texts these numbers, so foreign and
# landline numbers are refused (they cost more and invite SMS fraud).
NIGERIAN_MOBILE_RE = re.compile(r"0[789][01]\d{8}")
# Characters a phone number may be typed with.
PHONE_TYPING_RE = re.compile(r"\+?[\d\s().-]{7,24}")
NAME_PUNCTUATION = set(" '’-.")
NAME_MAX = 80


class ContactError(ValueError):
    """A phone number, email address or name that can't be used."""


def is_email(value: str | None) -> bool:
    return "@" in str(value or "")


def clean_email(value: str | None) -> str | None:
    cleaned = str(value or "").strip().lower()
    if not cleaned:
        return None
    if (len(cleaned) > 254 or ".." in cleaned or not EMAIL_RE.fullmatch(cleaned)
            or len(cleaned.split("@", 1)[0]) > 64):
        raise ContactError("Enter a valid email address, like name@example.com.")
    return cleaned


def local_phone(value: str | None) -> str | None:
    """0XXXXXXXXXX for a Nigerian mobile number in any common form, else None."""
    raw = str(value or "").strip()
    if not raw or not PHONE_TYPING_RE.fullmatch(raw):
        return None
    digits = re.sub(r"\D", "", raw)
    if digits.startswith("234"):
        digits = "0" + digits[3:].lstrip("0")
    elif len(digits) == 10 and digits[0] in "789":
        digits = "0" + digits
    return digits if NIGERIAN_MOBILE_RE.fullmatch(digits) else None


def clean_phone(value: str | None) -> str | None:
    """A Nigerian mobile number, saved as 0XXXXXXXXXX. Spaces, dashes,
    brackets and a +234 / 234 start are accepted while typing."""
    raw = str(value or "").strip()
    if not raw:
        return None
    cleaned = local_phone(raw)
    if cleaned is None:
        raise ContactError("Enter a Nigerian mobile number, like 0803 123 4567.")
    return cleaned


def clean_name(value: str | None, *, label: str = "name") -> str:
    """A person's name: letters (any language, with accents and Yoruba tone
    marks), spaces, apostrophes, hyphens and full stops. No digits, links
    or symbols, because names appear in texts and on drivers' screens."""
    text = unicodedata.normalize("NFC", str(value or ""))
    text = " ".join(text.split())
    if len(text) > NAME_MAX:
        raise ContactError(f"Keep the {label} to {NAME_MAX} characters or fewer.")
    letters = 0
    for ch in text:
        if ch.isalpha():
            letters += 1
        elif ch in NAME_PUNCTUATION or unicodedata.category(ch).startswith("M"):
            continue
        else:
            raise ContactError(f"Use only letters, spaces, hyphens and apostrophes in the {label}.")
    if letters < 2:
        raise ContactError(f"Enter the {label}.")
    if not text[0].isalpha():
        raise ContactError(f"Start the {label} with a letter.")
    if re.search(r"\.\w", text):
        # "Dr. Ade" is fine; "www.site.com" is not a name.
        raise ContactError(f"Use only letters, spaces, hyphens and apostrophes in the {label}.")
    return text


COMMON_PASSWORD_WORDS = {
    "password", "passw0rd", "qwerty", "qwertyuiop", "asdfgh", "asdfghjkl", "zxcvbnm", "letmein", "welcome",
    "iloveyou", "admin", "administrator", "ekimove", "ekiti", "abc", "abcdef", "abcdefgh", "abcdefghijkl",
    "monkey", "dragon", "football", "sunshine", "princess", "master", "jesus", "godisgood", "blessing",
    "changeme", "secret", "nigeria", "lagos", "test", "user", "login",
}
SEQUENCES = ("abcdefghijklmnopqrstuvwxyz", "qwertyuiopasdfghjklzxcvbnm", "01234567890", "09876543210")


def password_problem(password: str, *, name: str | None = None, phone: str | None = None,
                     email: str | None = None) -> str | None:
    """Why a new password is too easy to guess, or None if it's fine."""
    if len(password) < 12:
        return "Use at least 12 characters for your password."
    if len(password) > 128:
        return "Use 128 characters or fewer for your password."
    if password != password.strip():
        return "Don't start or end your password with a space."
    lowered = password.lower()
    if len(set(lowered)) < 5:
        return "Your password repeats too few characters. Mix in more different letters or words."
    core = re.sub(r"[^a-z0-9]", "", lowered)
    if core.isdigit():
        return "Don't use only numbers. Add some words — a short phrase is easy to remember."
    letters = re.sub(r"[^a-z]", "", lowered)
    if letters in COMMON_PASSWORD_WORDS or core in COMMON_PASSWORD_WORDS:
        return "That password is too common. Try a short phrase only you would know."
    if core and any(core in seq * 2 or (len(letters) >= 8 and letters in seq * 2) for seq in SEQUENCES):
        return "Don't use a run of keys like abcdef or qwerty."
    digits = re.sub(r"\D", "", str(phone or ""))
    if len(digits) >= 7 and digits[-7:] in re.sub(r"\D", "", password):
        return "Don't put your phone number in your password."
    local = str(email or "").split("@", 1)[0].lower()
    if len(local) >= 4 and local in lowered:
        return "Don't put your email address in your password."
    name_parts = [part for part in re.split(r"[^a-z]+", str(name or "").lower()) if len(part) >= 3]
    if name_parts and letters and (letters in name_parts or letters == "".join(name_parts)):
        return "Don't use just your name. Add other words."
    return None


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
