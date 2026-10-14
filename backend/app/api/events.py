import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import require_operator
from app.db.session import get_db
from app.models import Operator
from app.schemas.event import EventOut, EventPage
from app.services.event_service import EventFilters, list_events

router = APIRouter(prefix="/api/events", tags=["events"])


@router.get("", response_model=EventPage)
def query_events(
    honeypot_id: uuid.UUID | None = None,
    event_type: str | None = None,
    source_ip: str | None = None,
    q: str | None = Query(default=None, max_length=200),
    since: datetime | None = None,
    until: datetime | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    _: Operator = Depends(require_operator),
    db: Session = Depends(get_db),
) -> EventPage:
    filters = EventFilters(
        honeypot_id=honeypot_id,
        event_type=event_type,
        source_ip=source_ip,
        q=q,
        since=since,
        until=until,
    )
    items, total = list_events(db, filters, limit=limit, offset=offset)
    return EventPage(items=[EventOut.model_validate(i) for i in items], total=total)