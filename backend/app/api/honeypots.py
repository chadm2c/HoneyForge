import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import require_admin, require_operator
from app.db.session import get_db
from app.models import Honeypot, Operator
from app.schemas.honeypot import (
    HoneypotOut,
    HoneypotProfileRef,
    HoneypotRegisteredOut,
    HoneypotRegisterIn,
)
from app.services import audit_service
from app.services.fleet_service import (
    derive_status,
    list_honeypots,
    register_honeypot,
)

router = APIRouter(prefix="/api/honeypots", tags=["honeypots"])


def _to_out(hp: Honeypot) -> HoneypotOut:
    # status is derived from last_seen_at, not the legacy column, so the row is
    # built explicitly instead of validated off the ORM object.
    return HoneypotOut(
        id=hp.id,
        name=hp.name,
        profile_id=hp.profile_id,
        profile=HoneypotProfileRef.model_validate(hp.profile),
        config_version=hp.config_version,
        status=derive_status(hp),
        last_seen_at=hp.last_seen_at,
        created_at=hp.created_at,
    )


@router.post("/register", response_model=HoneypotRegisteredOut, status_code=201)
def register(
    body: HoneypotRegisterIn,
    admin: Operator = Depends(require_admin),
    db: Session = Depends(get_db),
) -> HoneypotRegisteredOut:
    hp, token = register_honeypot(db, name=body.name, profile_id=body.profile_id)
    audit_service.record(
        db,
        operator_id=admin.id,
        action="honeypot_registered",
        resource_type="honeypot",
        resource_id=hp.id,
    )
    # The plaintext token is returned exactly once and never stored.
    return HoneypotRegisteredOut(
        id=hp.id,
        name=hp.name,
        profile_id=hp.profile_id,
        agent_token=token,
    )


@router.get("", response_model=list[HoneypotOut])
def query_honeypots(
    _: Operator = Depends(require_operator),
    db: Session = Depends(get_db),
) -> list[HoneypotOut]:
    return [_to_out(hp) for hp in list_honeypots(db)]


@router.get("/{honeypot_id}", response_model=HoneypotOut)
def read_honeypot(
    honeypot_id: uuid.UUID,
    _: Operator = Depends(require_operator),
    db: Session = Depends(get_db),
) -> HoneypotOut:
    hp = db.get(Honeypot, honeypot_id)
    if hp is None:
        raise HTTPException(status_code=404, detail="Honeypot not found")
    return _to_out(hp)
