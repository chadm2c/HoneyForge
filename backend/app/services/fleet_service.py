from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models import Honeypot


def record_heartbeat(
    db: Session, honeypot: Honeypot, config_version: int
) -> Honeypot:
    honeypot.last_seen_at = datetime.now(timezone.utc)
    honeypot.config_version = config_version
    honeypot.status = "online"
    db.add(honeypot)
    db.commit()
    db.refresh(honeypot)
    return honeypot