import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class HoneypotRegisterIn(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    profile_id: uuid.UUID


class HoneypotProfileRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    interaction_level: str
    version: int


class HoneypotOut(BaseModel):
    """Fleet row. ``status`` is derived at read time, so this model is built
    explicitly (no ``from_attributes``) rather than validated off the ORM row."""

    id: uuid.UUID
    name: str
    profile_id: uuid.UUID
    profile: HoneypotProfileRef
    config_version: int
    status: str
    last_seen_at: datetime | None
    created_at: datetime


class HoneypotRegisteredOut(BaseModel):
    id: uuid.UUID
    name: str
    profile_id: uuid.UUID
    agent_token: str
