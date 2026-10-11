from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import Profile
from app.schemas.config import validate_config


def get_profile(db: Session, profile_id) -> Profile:
    p = db.get(Profile, profile_id)
    if p is None:
        raise HTTPException(status_code=404, detail="Profile not found")
    return p


def update_profile(db: Session, profile_id, patch: dict) -> Profile:
    """Apply a config/name/level patch and bump the profile version.

    The whole new configuration is validated together before anything is
    written, so a profile can never hold an invalid config. Invalid input
    raises HTTPException(422).
    """
    p = get_profile(db, profile_id)

    interaction_level = patch.get("interaction_level", p.interaction_level)
    config = patch.get("config", p.config)
    try:
        validated = validate_config(interaction_level, config)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Invalid profile config: {exc}")

    p.interaction_level = interaction_level
    p.config = validated
    if "name" in patch:
        p.name = patch["name"]
    p.version += 1
    db.add(p)
    db.commit()
    db.refresh(p)
    return p