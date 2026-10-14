import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Uuid, func
from sqlalchemy.dialects.postgresql import INET, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    # Resolved by name through SQLAlchemy's class registry; type-checker only.
    from app.models.honeypot import Honeypot


class AttackEvent(Base):
    __tablename__ = "attack_events"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True
    )  # agent-supplied idempotency key
    honeypot_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("honeypots.id", ondelete="CASCADE")
    )
    event_type: Mapped[str] = mapped_column(String)
    source_ip: Mapped[str | None] = mapped_column(INET, nullable=True)
    source_port: Mapped[int | None] = mapped_column(Integer, nullable=True)
    target_port: Mapped[int | None] = mapped_column(Integer, nullable=True)
    protocol: Mapped[str] = mapped_column(String)
    details: Mapped[dict] = mapped_column(JSONB, default=dict)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    honeypot: Mapped["Honeypot"] = relationship(back_populates="events")

    __table_args__ = (
        Index("ix_attack_events_honeypot_occurred", "honeypot_id", "occurred_at"),
        Index("ix_attack_events_source_ip", "source_ip"),
        Index("ix_attack_events_type_occurred", "event_type", "occurred_at"),
    )