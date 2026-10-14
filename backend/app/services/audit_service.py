import uuid
from datetime import datetime

import sqlalchemy as sa
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.models import AuditLog


class AuditFilters(BaseModel):
    operator_id: uuid.UUID | None = None
    action: str | None = None
    resource_type: str | None = None
    since: datetime | None = None
    until: datetime | None = None


def record(
    db: Session,
    *,
    operator_id: uuid.UUID | None,
    action: str,
    resource_type: str,
    resource_id: uuid.UUID | None = None,
) -> AuditLog:
    """Append one audit row.

    Identifiers and timestamps only: never a password, token, or request body.
    ``operator_id`` is the operator who *performed* the action, so a failed
    login is recorded with it unset rather than pointing at its target.
    """
    row = AuditLog(
        operator_id=operator_id,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def list_audit_logs(
    db: Session,
    filters: AuditFilters,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[AuditLog], int]:
    """Newest-first page of audit rows matching the filters, plus the total count."""
    conds = []
    if filters.operator_id:
        conds.append(AuditLog.operator_id == filters.operator_id)
    if filters.action:
        conds.append(AuditLog.action == filters.action)
    if filters.resource_type:
        conds.append(AuditLog.resource_type == filters.resource_type)
    if filters.since:
        conds.append(AuditLog.created_at >= filters.since)
    if filters.until:
        conds.append(AuditLog.created_at <= filters.until)

    total = db.execute(
        sa.select(sa.func.count()).select_from(AuditLog).where(*conds)
    ).scalar_one()
    stmt = (
        sa.select(AuditLog)
        .where(*conds)
        # id is a monotonic surrogate key, so it is a stable tie-break for rows
        # written in the same clock tick.
        .order_by(AuditLog.id.desc())
        .limit(limit)
        .offset(offset)
    )
    items = list(db.execute(stmt).scalars())
    return items, total
