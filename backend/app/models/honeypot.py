import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    # Relationship targets resolved by SQLAlchemy's class registry; type-checker
    # only, so the models keep importing each other without a runtime cycle.
    from app.models.attack_event import AttackEvent
    from app.models.profile import Profile


class Honeypot(Base):
    __tablename__ = "honeypots"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String, unique=True)
    agent_token_hash: Mapped[str] = mapped_column(Text, unique=True, index=True)
    profile_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("profiles.id"))
    status: Mapped[str] = mapped_column(String, default="offline")
    last_seen_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    config_version: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    profile: Mapped["Profile"] = relationship(back_populates="honeypots")
    events: Mapped[list["AttackEvent"]] = relationship(
        back_populates="honeypot",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )