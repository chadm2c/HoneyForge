from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import generate_agent_token, hash_agent_token
from app.models import Honeypot, Profile


def record_heartbeat(
    db: Session, honeypot: Honeypot, config_version: int
) -> Honeypot:
    """Record a heartbeat. ``status`` is derived at read time, never stored."""
    honeypot.last_seen_at = datetime.now(timezone.utc)
    honeypot.config_version = config_version
    db.add(honeypot)
    db.commit()
    db.refresh(honeypot)
    return honeypot


def derive_status(hp: Honeypot, now: datetime | None = None) -> str:
    """Online/offline/never, computed from ``last_seen_at`` against the clock.

    A stored ``status`` column would go stale the moment an agent stopped
    reporting, so nothing writes it; the legacy column is left in place to avoid
    a migration but is never read.
    """
    if hp.last_seen_at is None:
        return "never"
    reference = now or datetime.now(timezone.utc)
    age = reference - hp.last_seen_at
    return (
        "online"
        if age <= timedelta(seconds=settings.fleet_offline_after_s)
        else "offline"
    )


def list_honeypots(db: Session) -> list[Honeypot]:
    return list(db.scalars(select(Honeypot).order_by(Honeypot.name)))


def register_honeypot(
    db: Session, *, name: str, profile_id
) -> tuple[Honeypot, str]:
    """Provision a honeypot and return it with its one-time plaintext agent token.

    The token is generated and returned here once; only its hash is stored, so
    the plaintext exists solely in this response (and the operator's secret
    store). An agent can only ever read its own config.
    """
    if db.get(Profile, profile_id) is None:
        raise HTTPException(status_code=404, detail="Profile not found")
    if db.scalar(select(Honeypot).where(Honeypot.name == name)) is not None:
        raise HTTPException(status_code=409, detail="Honeypot name already exists")

    token = generate_agent_token()
    hp = Honeypot(
        name=name,
        profile_id=profile_id,
        agent_token_hash=hash_agent_token(token),
        config_version=0,
    )
    db.add(hp)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Honeypot name already exists")
    db.refresh(hp)
    return hp, token
