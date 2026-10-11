from pydantic import BaseModel


class HeartbeatIn(BaseModel):
    config_version: int


class HeartbeatOut(BaseModel):
    ack: int
    profile_version: int