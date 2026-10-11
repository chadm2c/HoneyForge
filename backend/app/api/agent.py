from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_agent
from app.db.session import get_db
from app.models import Honeypot
from app.schemas.agent import AgentConfigOut
from app.schemas.config import validate_config
from app.services.profile_service import get_profile

router = APIRouter(prefix="/api/agent", tags=["agent"])


@router.get("/whoami")
def whoami(hp: Honeypot = Depends(get_current_agent)) -> dict[str, str]:
    return {"id": str(hp.id)}


@router.get("/config", response_model=AgentConfigOut)
def get_config(
    hp: Honeypot = Depends(get_current_agent),
    db: Session = Depends(get_db),
) -> AgentConfigOut:
    profile = get_profile(db, hp.profile_id)
    # Re-validate stored config with the same models; the agent never receives
    # an unvalidated payload.
    return AgentConfigOut(
        honeypot_id=hp.id,
        config_version=profile.version,
        interaction_level=profile.interaction_level,
        config=validate_config(profile.interaction_level, profile.config),
    )