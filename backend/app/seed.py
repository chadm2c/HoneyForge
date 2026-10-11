"""Demo provisioning seed.

Creates the S2 golden-path rows: one ``admin`` operator, one ``low`` profile,
and one ``low`` honeypot whose per-agent token hash matches ``AGENT_TOKEN``.

Idempotent by name: re-running matches existing rows (updating the honeypot's
token hash if the provided token changed), so the demo is exactly repeatable.
Tokens are read from env and never printed.
"""

import os

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import hash_agent_token
from app.models import Honeypot, Operator, Profile

DEFAULT_BANNER = "SSH-2.0-OpenSSH_8.9"


def seed_demo(db: Session, agent_token: str, operator_token: str) -> dict:
    operator = db.scalar(select(Operator).where(Operator.username == "admin"))
    if operator is None:
        operator = Operator(
            username="admin",
            password_hash=hash_agent_token(operator_token),  # S2 placeholder, replaced by JWT auth in S4
            role="admin",
        )
        db.add(operator)

    profile = db.scalar(select(Profile).where(Profile.name == "low"))
    if profile is None:
        profile = Profile(
            name="low",
            interaction_level="low",
            config={"ports": [2222], "banner": DEFAULT_BANNER},
            version=1,
        )
        db.add(profile)
        db.flush()

    honeypot = db.scalar(select(Honeypot).where(Honeypot.name == "low"))
    expected_hash = hash_agent_token(agent_token)
    if honeypot is None:
        honeypot = Honeypot(
            name="low",
            profile_id=profile.id,
            agent_token_hash=expected_hash,
        )
        db.add(honeypot)
    elif honeypot.agent_token_hash != expected_hash:
        honeypot.agent_token_hash = expected_hash  # re-seed with a new token updates the hash

    db.commit()
    db.refresh(operator)
    db.refresh(profile)
    db.refresh(honeypot)
    return {"operator": operator, "profile": profile, "honeypot": honeypot}


if __name__ == "__main__":
    from app.db.session import SessionLocal

    agent_token = os.environ["AGENT_TOKEN"]
    operator_token = os.environ["DEV_OPERATOR_TOKEN"]
    with SessionLocal() as session:
        out = seed_demo(session, agent_token=agent_token, operator_token=operator_token)
    print(
        "seeded operator=%s profile=%s (v%s) honeypot=%s"
        % (
            out["operator"].username,
            out["profile"].name,
            out["profile"].version,
            out["honeypot"].name,
        )
    )