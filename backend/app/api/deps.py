import uuid

import jwt
from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.core.security import decode_access_token, hash_agent_token
from app.db.session import get_db
from app.models import Honeypot, Operator


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


def require_operator(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> Operator:
    """Resolve the bearer JWT to its Operator row. 401 on any invalid token."""
    token = _bearer_token(authorization)
    try:
        claims = decode_access_token(token)
        operator_id = uuid.UUID(str(claims["sub"]))
    except (jwt.PyJWTError, KeyError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid or expired token") from None
    operator = db.get(Operator, operator_id)
    if operator is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return operator


def require_admin(operator: Operator = Depends(require_operator)) -> Operator:
    """Layer on require_operator: analyst is read-only, every write needs admin."""
    if operator.role != "admin":
        raise HTTPException(status_code=403, detail="Admin role required")
    return operator