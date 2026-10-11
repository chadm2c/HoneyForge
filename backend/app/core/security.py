import hashlib
import hmac
import secrets

from app.core.config import settings


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