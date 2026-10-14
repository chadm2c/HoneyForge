import hashlib
import hmac
import secrets
import uuid
from datetime import UTC, datetime, timedelta

import bcrypt
import jwt

from app.core.config import settings

# bcrypt hashes at most 72 bytes of input; longer passwords are rejected by the
# login schema rather than silently truncated to their first 72 bytes.
MAX_PASSWORD_BYTES = 72


def generate_agent_token() -> str:
    return secrets.token_urlsafe(32)


def hash_agent_token(token: str) -> str:
    return hmac.new(
        settings.agent_token_secret.encode(),
        token.encode(),
        hashlib.sha256,
    ).hexdigest()


def verify_agent_token(token: str, token_hash: str) -> bool:
    expected = hash_agent_token(token)
    return hmac.compare_digest(expected, token_hash)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("ascii")


def verify_password(password: str, password_hash: str) -> bool:
    """Constant-time bcrypt check. A malformed/legacy hash verifies False, never raises."""
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("ascii"))
    except (ValueError, TypeError):
        return False


def create_access_token(subject: str, role: str) -> str:
    """Mint a short-lived HS256 operator access token."""
    now = datetime.now(UTC)
    claims = {
        "sub": subject,
        "role": role,
        "iat": now,
        "exp": now + timedelta(minutes=settings.jwt_expires_minutes),
        "jti": uuid.uuid4().hex,
    }
    return jwt.encode(claims, settings.jwt_secret, algorithm="HS256")


def decode_access_token(token: str) -> dict:
    """Validate a token and return its claims.

    ``algorithms`` is pinned to HS256, so an ``alg=none`` or asymmetric token can
    never be accepted, and ``exp``/``sub`` are required.
    """
    return jwt.decode(
        token,
        settings.jwt_secret,
        algorithms=["HS256"],
        options={"require": ["exp", "sub"]},
    )