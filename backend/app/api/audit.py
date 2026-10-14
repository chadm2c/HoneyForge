import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import require_operator
from app.db.session import get_db
from app.models import Operator
from app.schemas.audit import AuditLogOut, AuditLogPage
from app.services.audit_service import AuditFilters, list_audit_logs

router = APIRouter(prefix="/api/audit-logs", tags=["audit"])


@router.get("", response_model=AuditLogPage)
def query_audit_logs(
    operator_id: uuid.UUID | None = None,
    action: str | None = None,
    resource_type: str | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    _: Operator = Depends(require_operator),
    db: Session = Depends(get_db),
) -> AuditLogPage:
    filters = AuditFilters(
        operator_id=operator_id,
        action=action,
        resource_type=resource_type,
        since=since,
        until=until,
    )
    items, total = list_audit_logs(db, filters, limit=limit, offset=offset)
    return AuditLogPage(items=[AuditLogOut.model_validate(i) for i in items], total=total)
