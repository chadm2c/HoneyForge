import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import require_admin, require_operator
from app.db.session import get_db
from app.models import Operator
from app.schemas.profile import ProfileIn, ProfileOut, ProfilePatch, ProfileSummary
from app.services import audit_service
from app.services.profile_service import (
    create_profile,
    delete_profile,
    get_profile,
    list_profiles,
    update_profile,
)

router = APIRouter(prefix="/api/profiles", tags=["profiles"])


@router.get("", response_model=list[ProfileSummary])
def query_profiles(
    _: Operator = Depends(require_operator),
    db: Session = Depends(get_db),
) -> list[ProfileSummary]:
    return [ProfileSummary.model_validate(p) for p in list_profiles(db)]


@router.post("", response_model=ProfileOut, status_code=201)
def add_profile(
    body: ProfileIn,
    admin: Operator = Depends(require_admin),
    db: Session = Depends(get_db),
) -> ProfileOut:
    profile = create_profile(
        db,
        name=body.name,
        interaction_level=body.interaction_level,
        config=body.config,
    )
    audit_service.record(
        db,
        operator_id=admin.id,
        action="profile_created",
        resource_type="profile",
        resource_id=profile.id,
    )
    return ProfileOut.model_validate(profile)


@router.get("/{profile_id}", response_model=ProfileOut)
def read_profile(
    profile_id: uuid.UUID,
    _: Operator = Depends(require_operator),
    db: Session = Depends(get_db),
) -> ProfileOut:
    return ProfileOut.model_validate(get_profile(db, profile_id))


@router.patch("/{profile_id}", response_model=ProfileOut)
def patch_profile(
    profile_id: uuid.UUID,
    body: ProfilePatch,
    admin: Operator = Depends(require_admin),
    db: Session = Depends(get_db),
) -> ProfileOut:
    profile = update_profile(db, profile_id, body.model_dump(exclude_unset=True))
    audit_service.record(
        db,
        operator_id=admin.id,
        action="profile_updated",
        resource_type="profile",
        resource_id=profile.id,
    )
    return ProfileOut.model_validate(profile)


@router.delete("/{profile_id}", status_code=204)
def remove_profile(
    profile_id: uuid.UUID,
    admin: Operator = Depends(require_admin),
    db: Session = Depends(get_db),
) -> None:
    delete_profile(db, profile_id)
    audit_service.record(
        db,
        operator_id=admin.id,
        action="profile_deleted",
        resource_type="profile",
        resource_id=profile_id,
    )
