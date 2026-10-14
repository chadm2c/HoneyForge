from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Honeypot, Profile
from app.schemas.config import validate_config


def get_profile(db: Session, profile_id) -> Profile:
    p = db.get(Profile, profile_id)
    if p is None:
        raise HTTPException(status_code=404, detail="Profile not found")
    return p


def list_profiles(db: Session) -> list[Profile]:
    return list(db.scalars(select(Profile).order_by(Profile.name)))


def create_profile(
    db: Session, *, name: str, interaction_level: str, config: dict
) -> Profile:
    """Validate and insert a new profile at version 1.

    Same validation path as ``update_profile``, so an invalid config can never
    reach the table (422); a duplicate name is mapped to 409 rather than
    surfacing a database error.
    """
    try:
        validated = validate_config(interaction_level, config)
    except ValueError as exc:  # pydantic's ValidationError subclasses ValueError
        raise HTTPException(status_code=422, detail=f"Invalid profile config: {exc}")

    profile = Profile(
        name=name,
        interaction_level=interaction_level,
        config=validated,
        version=1,
    )
    db.add(profile)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Profile name already exists")
    db.refresh(profile)
    return profile


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
    except ValueError as exc:  # pydantic's ValidationError subclasses ValueError
        raise HTTPException(status_code=422, detail=f"Invalid profile config: {exc}")

    p.interaction_level = interaction_level
    p.config = validated
    if "name" in patch:
        p.name = patch["name"]
    p.version += 1
    db.add(p)
    try:
        db.commit()
    except IntegrityError:
        # Renaming onto a name another profile already holds. Rolled back so the
        # session stays usable and the row keeps its previous state.
        db.rollback()
        raise HTTPException(status_code=409, detail="Profile name already exists")
    db.refresh(p)
    return p


def delete_profile(db: Session, profile_id) -> None:
    """Delete a profile, refusing while any honeypot still points at it."""
    profile = get_profile(db, profile_id)
    in_use = db.scalar(select(Honeypot).where(Honeypot.profile_id == profile_id))
    if in_use is not None:
        raise HTTPException(status_code=409, detail="Profile is in use by a honeypot")
    db.delete(profile)
    db.commit()
