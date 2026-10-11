import hmac

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import hash_agent_token
from app.db.session import get_db
from app.models import Honeypot


def _bearer_token(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    return authorization.removeprefix("Bearer ").strip()


def get_current_agent(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> Honeypot:
    """Resolve the per-agent token to that agent's Honeypot row (one agent, one token)."""
    token = _bearer_token(authorization)
    hp = (
        db.query(Honeypot)
        .filter(Honeypot.agent_token_hash == hash_agent_token(token))
        .first()
    )
    if hp is None:
        raise HTTPException(status_code=401, detail="Unknown agent token")
    return hp


async def require_operator(
    authorization: str | None = Header(default=None),
) -> None:
    """S2 operator seam: static DEV_OPERATOR_TOKEN. S4 swaps this for JWT in place."""
    token = _bearer_token(authorization)
    if not hmac.compare_digest(token, settings.dev_operator_token):
        raise HTTPException(status_code=401, detail="Invalid operator token")