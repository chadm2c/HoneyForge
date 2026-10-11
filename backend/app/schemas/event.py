import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, field_validator


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    honeypot_id: uuid.UUID
    event_type: str
    source_ip: str | None
    source_port: int | None
    target_port: int | None
    protocol: str
    details: dict
    occurred_at: datetime
    received_at: datetime

    @field_validator("source_ip", mode="before")
    @classmethod
    def _as_str(cls, v: object) -> object:
        # psycopg3 may hand back an ipaddress object for INET columns.
        return str(v) if v is not None else None


class EventPage(BaseModel):
    items: list[EventOut]
    total: int