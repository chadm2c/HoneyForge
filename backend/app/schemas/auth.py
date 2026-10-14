import uuid

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.security import MAX_PASSWORD_BYTES


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=1)

    @field_validator("password")
    @classmethod
    def _within_bcrypt_limit(cls, v: str) -> str:
        # Without this a 73-byte password would be silently truncated by bcrypt
        # and accepted as equal to its 72-byte prefix.
        if len(v.encode("utf-8")) > MAX_PASSWORD_BYTES:
            raise ValueError(f"password must be at most {MAX_PASSWORD_BYTES} bytes")
        return v


class OperatorOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    username: str
    role: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    operator: OperatorOut
