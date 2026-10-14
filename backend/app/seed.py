"""Demo provisioning seed.

Creates the golden-path rows: the ``admin`` operator (bcrypt-hashed password),
an optional ``analyst`` operator, a ``low`` profile + honeypot whose token hash
matches ``AGENT_TOKEN``, and (when a ``medium_agent_token`` is supplied) a
``medium`` profile + honeypot whose token hash matches it.

Idempotent: re-running matches existing rows by name. An operator's password is
re-hashed only when the configured password no longer verifies, so a re-seed
does not rotate the stored hash (bcrypt salts differ on every call). A
honeypot's token hash is updated when the provided token changed. Tokens and
passwords are read from env and never printed.
"""

import os

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import hash_agent_token, hash_password, verify_password
from app.models import Honeypot, Operator, Profile

DEFAULT_BANNER = "SSH-2.0-OpenSSH_8.9"
DEFAULT_MEDIUM_TITLE = "Admin Panel"


def _upsert_operator(db: Session, username: str, password: str, role: str) -> Operator:
    """Idempotently create the operator, re-hashing only if the password changed."""
    operator = db.scalar(select(Operator).where(Operator.username == username))
    if operator is None:
        operator = Operator(
            username=username,
            password_hash=hash_password(password),
            role=role,
        )
        db.add(operator)
    elif not verify_password(password, operator.password_hash):
        operator.password_hash = hash_password(password)
    return operator


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
    *,
    agent_token: str,
    operator_password: str,
    medium_agent_token: str | None = None,
    operator_username: str = "admin",
    analyst_username: str = "analyst",
    analyst_password: str | None = None,
) -> dict:
    out: dict = {
        "operator": _upsert_operator(db, operator_username, operator_password, "admin")
    }

    if analyst_password:
        out["analyst"] = _upsert_operator(
            db, analyst_username, analyst_password, "analyst"
        )

    profile, honeypot = _upsert_honeypot(
        db,
        name="low",
        interaction_level="low",
        config={"ports": [2222], "banner": DEFAULT_BANNER},
        token=agent_token,
    )
    out["profile"] = profile
    out["honeypot"] = honeypot

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
    for obj in out.values():
        db.refresh(obj)
    return out


if __name__ == "__main__":
    from app.db.session import SessionLocal

    with SessionLocal() as session:
        out = seed_demo(
            session,
            agent_token=os.environ["AGENT_TOKEN"],
            operator_password=os.environ["OPERATOR_PASSWORD"],
            medium_agent_token=os.environ.get("MEDIUM_AGENT_TOKEN"),
            operator_username=os.environ.get("OPERATOR_USERNAME", "admin"),
            analyst_username=os.environ.get("ANALYST_USERNAME", "analyst"),
            analyst_password=os.environ.get("ANALYST_PASSWORD") or None,
        )
    line = (
        f"seeded operator={out['operator'].username}"
        f" profile={out['profile'].name} (v{out['profile'].version})"
        f" honeypot={out['honeypot'].name}"
    )
    if "analyst" in out:
        line += f" analyst={out['analyst'].username}"
    if "medium_honeypot" in out:
        line += (
            f" profile={out['medium_profile'].name}"
            f" (v{out['medium_profile'].version})"
            f" honeypot={out['medium_honeypot'].name}"
        )
    print(line)
