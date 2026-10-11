import uuid

import sqlalchemy as sa
from pydantic import BaseModel
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models import AttackEvent, Honeypot
from app.schemas.telemetry import TelemetryEventIn


class IngestResult(BaseModel):
    accepted: list[uuid.UUID]
    duplicates: list[uuid.UUID]


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