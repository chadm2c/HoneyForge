import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ProfileIn(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    interaction_level: Literal["low", "medium"]
    config: dict = Field(default_factory=dict)


class ProfilePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    interaction_level: Literal["low", "medium"] | None = None
    config: dict | None = None


class ProfileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    interaction_level: str
    config: dict
    version: int
    created_at: datetime
    updated_at: datetime


class ProfileSummary(BaseModel):
    """List view: omits ``config`` so a page of profiles stays small."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    interaction_level: str
    version: int
    updated_at: datetime
