import json
import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

MAX_DETAILS_BYTES = 65_536


class TelemetryEventIn(BaseModel):
    id: uuid.UUID  # agent-generated idempotency key
    event_type: str = Field(max_length=64)
    source_ip: str | None = None
    source_port: int | None = Field(default=None, ge=1, le=65535)
    target_port: int | None = Field(default=None, ge=1, le=65535)
    protocol: str = Field(max_length=16)
    details: dict = Field(default_factory=dict)
    occurred_at: datetime

    @field_validator("details")
    @classmethod
    def _cap_details_size(cls, v: dict) -> dict:
        if len(json.dumps(v)) > MAX_DETAILS_BYTES:
            raise ValueError("details too large (max 64KB)")
        return v


class TelemetryBatch(BaseModel):
    events: list[TelemetryEventIn] = Field(max_length=500)