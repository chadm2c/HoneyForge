from typing import Annotated

from pydantic import BaseModel, Field, ValidationError

PortNumber = Annotated[int, Field(ge=1, le=65535)]


class LowConfig(BaseModel):
    ports: list[PortNumber] = Field(default_factory=lambda: [2222], min_length=1)
    banner: str = Field(default="", max_length=512)


class MediumConfig(BaseModel):
    ports: list[PortNumber] = Field(default_factory=lambda: [8080], min_length=1)
    title: str = Field(default="Admin Panel", max_length=128)
    login_enabled: bool = True


_MODELS = {
    "low": LowConfig,
    "medium": MediumConfig,
}


def validate_config(interaction_level: str, config: dict) -> dict:
    """Validate a profile config for its interaction level.

    Raises pydantic.ValidationError on bad input so the caller can map it to a
    422. The same models are used to re-validate stored config before it is
    handed to an agent.
    """
    model = _MODELS.get(interaction_level)
    if model is None:
        raise ValueError(f"unknown interaction level: {interaction_level}")
    return model.model_validate(config).model_dump()


__all__ = ["LowConfig", "MediumConfig", "PortNumber", "ValidationError", "validate_config"]