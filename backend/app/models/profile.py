import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Integer, String, Uuid, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    # The relationship target is resolved by name through SQLAlchemy's class
    # registry, so this import exists for type checkers and never at runtime.
    from app.models.honeypot import Honeypot


class Profile(Base):
    __tablename__ = "profiles"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String, unique=True)
    interaction_level: Mapped[str] = mapped_column(String)  # constrained: low | medium
    config: Mapped[dict] = mapped_column(JSONB, default=dict)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    honeypots: Mapped[list["Honeypot"]] = relationship(back_populates="profile")