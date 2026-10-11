from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_agent
from app.db.session import get_db
from app.models import Honeypot
from app.schemas.telemetry import TelemetryBatch
from app.services.event_service import IngestResult, ingest_events

router = APIRouter(prefix="/api/telemetry", tags=["telemetry"])


@router.post("/events")
def submit_events(
    body: TelemetryBatch,
    hp: Honeypot = Depends(get_current_agent),
    db: Session = Depends(get_db),
) -> IngestResult:
    try:
        return ingest_events(db, hp, body.events)
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=f"Event rejected: {exc}") from exc