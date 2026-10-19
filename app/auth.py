import hashlib
import hmac
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt.exceptions import InvalidTokenError
from pwdlib import PasswordHash
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import User


password_hasher = PasswordHash.recommended()
bearer_scheme = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    """Hash a password using the recommended password-hashing algorithm."""
    if not password:
        raise ValueError("Password must not be empty")
    return password_hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    """Verify a password without accepting accounts lacking a stored hash."""
    if not password_hash:
        return False

    try:
        return password_hasher.verify(password, password_hash)
    except (ValueError, TypeError):
        return False


def _password_fingerprint(password_hash: str) -> str:
    """Create a non-secret fingerprint used to invalidate old access tokens."""
    return hashlib.sha256(password_hash.encode("utf-8")).hexdigest()


def create_access_token(user: User) -> str:
    """Create a short-lived JWT bound to the account's current password hash."""
    if not settings.jwt_secret_key:
        raise RuntimeError("JWT_SECRET_KEY is not configured")

    if not user.password_hash:
        raise RuntimeError("Cannot issue a token without a password hash")

    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(minutes=settings.access_token_expire_minutes)

    return jwt.encode(
        {
            "sub": str(user.id),
            "iat": now,
            "exp": expires_at,
            "pwdv": _password_fingerprint(user.password_hash),
        },
        settings.jwt_secret_key,
        algorithm="HS256",
    )


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    """Resolve an active account and reject tokens issued before password changes."""
    if not settings.jwt_secret_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication is not configured",
        )

    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or missing authentication credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    if credentials is None or credentials.scheme.lower() != "bearer":
        raise unauthorized

    try:
        claims = jwt.decode(
            credentials.credentials,
            settings.jwt_secret_key,
            algorithms=["HS256"],
            options={"require": ["sub", "iat", "exp", "pwdv"]},
        )
        subject = claims.get("sub")
        fingerprint = claims.get("pwdv")

        if (
            not isinstance(subject, str)
            or not subject.isdigit()
            or not isinstance(fingerprint, str)
        ):
            raise unauthorized

        user_id = int(subject)

    except (InvalidTokenError, ValueError, TypeError):
        raise unauthorized from None

    user = db.get(User, user_id)

    if user is None or not user.is_active or not user.password_hash:
        raise unauthorized

    expected_fingerprint = _password_fingerprint(user.password_hash)
    if not hmac.compare_digest(fingerprint, expected_fingerprint):
        raise unauthorized

    return user
