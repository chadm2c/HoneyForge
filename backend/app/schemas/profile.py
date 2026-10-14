import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ProfileIn(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    interaction_level: Literal["low", "medium"]
    config: dict = Field(default_factory=dict)


class ProfilePatch(BaseModel):
    """Partial profile update.

    Absent fields are left unchanged. An explicit ``null`` is rejected (422)
    rather than treated as "clear it": ``name`` maps to a NOT NULL column and
    the other two have no sensible null meaning, so a null is a client error.
    """

    name: str | None = Field(default=None, min_length=1, max_length=128)
    interaction_level: Literal["low", "medium"] | None = None
    config: dict | None = None

    @model_validator(mode="after")
    def _reject_explicit_nulls(self) -> "ProfilePatch":
        nulls = sorted(f for f in self.model_fields_set if getattr(self, f) is None)
        if nulls:
            raise ValueError(f"fields must not be null: {', '.join(nulls)}")
        return self


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
    created_at: datetime
    updated_at: datetime
