import uuid
from datetime import datetime

import sqlalchemy as sa
from pydantic import BaseModel
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models import AttackEvent, Honeypot
from app.schemas.telemetry import TelemetryEventIn


class IngestResult(BaseModel):
    accepted: list[uuid.UUID]
    duplicates: list[uuid.UUID]


class EventFilters(BaseModel):
    honeypot_id: uuid.UUID | None = None
    event_type: str | None = None
    source_ip: str | None = None
    q: str | None = None
    since: datetime | None = None
    until: datetime | None = None


def ingest_events(
    db: Session, honeypot: Honeypot, events: list[TelemetryEventIn]
) -> IngestResult:
    """Insert events idempotently in one statement.

    The agent-generated UUID primary key is the idempotency key: a single
    ``INSERT ... ON CONFLICT DO NOTHING ... RETURNING`` inserts the new rows and
    skips the existing ones, so ``RETURNING`` is exactly the accepted set.
    """
    if not events:
        return IngestResult(accepted=[], duplicates=[])
    rows = [
        {
            "id": ev.id,
            "honeypot_id": honeypot.id,
            "event_type": ev.event_type,
            "source_ip": ev.source_ip,
            "source_port": ev.source_port,
            "target_port": ev.target_port,
            "protocol": ev.protocol,
            "details": ev.details,
            "occurred_at": ev.occurred_at,
        }
        for ev in events
    ]
    inserted = [
        row[0]
        for row in db.execute(
            pg_insert(AttackEvent).values(rows).on_conflict_do_nothing().returning(
                AttackEvent.id
            )
        ).all()
    ]
    db.commit()
    inserted_set = set(inserted)
    accepted = [ev.id for ev in events if ev.id in inserted_set]
    duplicates = [ev.id for ev in events if ev.id not in inserted_set]
    return IngestResult(accepted=accepted, duplicates=duplicates)


def _like_pattern(q: str) -> str:
    """Wrap a search term in %...% with LIKE's metacharacters escaped.

    The backslash is replaced first, so a term that already contains one cannot
    turn into an escape character for the escapes added after it. Without this,
    ``q=%`` would match every row instead of only rows containing a literal %.
    """
    escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def list_events(
    db: Session,
    filters: EventFilters,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[AttackEvent], int]:
    """Newest-first page of events matching the filters, plus the total count."""
    conds = []
    if filters.q:
        pattern = _like_pattern(filters.q)
        conds.append(
            sa.or_(
                AttackEvent.event_type.ilike(pattern, escape="\\"),
                sa.cast(AttackEvent.details, sa.Text).ilike(pattern, escape="\\"),
            )
        )
    if filters.honeypot_id:
        conds.append(AttackEvent.honeypot_id == filters.honeypot_id)
    if filters.event_type:
        conds.append(AttackEvent.event_type == filters.event_type)
    if filters.source_ip:
        conds.append(AttackEvent.source_ip == filters.source_ip)
    if filters.since:
        conds.append(AttackEvent.occurred_at >= filters.since)
    if filters.until:
        conds.append(AttackEvent.occurred_at <= filters.until)

    total = db.execute(
        sa.select(sa.func.count()).select_from(AttackEvent).where(*conds)
    ).scalar_one()
    stmt = (
        sa.select(AttackEvent)
        .where(*conds)
        .order_by(AttackEvent.occurred_at.desc(), AttackEvent.id.desc())
        .limit(limit)
        .offset(offset)
    )
    items = list(db.execute(stmt).scalars())
    return items, total