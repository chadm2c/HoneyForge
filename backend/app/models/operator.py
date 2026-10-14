import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Operator(Base):
    __tablename__ = "operators"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    username: Mapped[str] = mapped_column(String, unique=True)
    password_hash: Mapped[str] = mapped_column(Text)
    role: Mapped[str] = mapped_column(String, default="admin")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )