"""Demo provisioning seed.

Creates the golden-path rows: one ``admin`` operator, a ``low`` profile +
honeypot whose token hash matches ``AGENT_TOKEN``, and (when a
``medium_agent_token`` is supplied) a ``medium`` profile + honeypot whose token
hash matches it.

Idempotent by name: re-running matches existing rows (updating a honeypot's
token hash if the provided token changed), so the demo is exactly repeatable.
Tokens are read from env and never printed.
"""

import os

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import hash_agent_token
from app.models import Honeypot, Operator, Profile

DEFAULT_BANNER = "SSH-2.0-OpenSSH_8.9"
DEFAULT_MEDIUM_TITLE = "Admin Panel"


def _upsert_honeypot(
    db: Session,
    name: str,
    interaction_level: str,
    config: dict,
    token: str,
):
    """Idempotently create the profile + honeypot pair named ``name``.

    Re-seeding with a new token updates the stored token hash.
    """
    profile = db.scalar(select(Profile).where(Profile.name == name))
    if profile is None:
        profile = Profile(
            name=name,
            interaction_level=interaction_level,
            config=config,
            version=1,
        )
        db.add(profile)
        db.flush()

    expected_hash = hash_agent_token(token)
    honeypot = db.scalar(select(Honeypot).where(Honeypot.name == name))
    if honeypot is None:
        honeypot = Honeypot(
            name=name,
            profile_id=profile.id,
            agent_token_hash=expected_hash,
        )
        db.add(honeypot)
    elif honeypot.agent_token_hash != expected_hash:
        honeypot.agent_token_hash = expected_hash  # re-seed with a new token updates the hash
    return profile, honeypot


def seed_demo(
    db: Session,
    agent_token: str,
    operator_token: str,
    medium_agent_token: str | None = None,
) -> dict:
    operator = db.scalar(select(Operator).where(Operator.username == "admin"))
    if operator is None:
        operator = Operator(
            username="admin",
            password_hash=hash_agent_token(operator_token),  # S2 placeholder, replaced by JWT auth in S4
            role="admin",
        )
        db.add(operator)

    profile, honeypot = _upsert_honeypot(
        db,
        name="low",
        interaction_level="low",
        config={"ports": [2222], "banner": DEFAULT_BANNER},
        token=agent_token,
    )
    out: dict = {"operator": operator, "profile": profile, "honeypot": honeypot}

    if medium_agent_token is not None:
        medium_profile, medium_honeypot = _upsert_honeypot(
            db,
            name="medium",
            interaction_level="medium",
            config={"ports": [8080], "title": DEFAULT_MEDIUM_TITLE, "login_enabled": True},
            token=medium_agent_token,
        )
        out["medium_profile"] = medium_profile
        out["medium_honeypot"] = medium_honeypot

    db.commit()
    for obj in (operator, *[v for k, v in out.items() if k != "operator"]):
        db.refresh(obj)
    return out


if __name__ == "__main__":
    from app.db.session import SessionLocal

    agent_token = os.environ["AGENT_TOKEN"]
    operator_token = os.environ["DEV_OPERATOR_TOKEN"]
    medium_agent_token = os.environ.get("MEDIUM_AGENT_TOKEN")
    with SessionLocal() as session:
        out = seed_demo(
            session,
            agent_token=agent_token,
            operator_token=operator_token,
            medium_agent_token=medium_agent_token,
        )
    line = "seeded operator=%s profile=%s (v%s) honeypot=%s" % (
        out["operator"].username,
        out["profile"].name,
        out["profile"].version,
        out["honeypot"].name,
    )
    if "medium_honeypot" in out:
        line += " profile=%s (v%s) honeypot=%s" % (
            out["medium_profile"].name,
            out["medium_profile"].version,
            out["medium_honeypot"].name,
        )
    print(line)