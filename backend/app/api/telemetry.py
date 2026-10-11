from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_agent
from app.db.session import get_db
from app.models import Honeypot
from app.realtime.websocket_manager import manager
from app.schemas.event import EventOut
from app.schemas.telemetry import TelemetryBatch
from app.services.event_service import IngestResult, ingest_events

router = APIRouter(prefix="/api/telemetry", tags=["telemetry"])


@router.post("/events")
async def submit_events(
    body: TelemetryBatch,
    hp: Honeypot = Depends(get_current_agent),
    db: Session = Depends(get_db),
) -> IngestResult:
    try:
        result = ingest_events(db, hp, body.events)
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=f"Event rejected: {exc}") from exc

    # Push each newly-accepted event to dashboard subscribers in near-real time.
    if result.accepted:
        accepted_ids = set(result.accepted)
        for ev in body.events:
            if ev.id in accepted_ids:
                payload = EventOut(
                    id=ev.id,
                    honeypot_id=hp.id,
                    event_type=ev.event_type,
                    source_ip=ev.source_ip,
                    source_port=ev.source_port,
                    target_port=ev.target_port,
                    protocol=ev.protocol,
                    details=ev.details,
                    occurred_at=ev.occurred_at,
                    received_at=datetime.now(timezone.utc),
                )
                await manager.broadcast(payload.model_dump(mode="json"))
    return result