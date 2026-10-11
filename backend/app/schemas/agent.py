import uuid

from pydantic import BaseModel


class AgentConfigOut(BaseModel):
    honeypot_id: uuid.UUID
    config_version: int
    interaction_level: str
    config: dict