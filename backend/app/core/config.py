from typing import Annotated

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

# Documented dev placeholder for JWT_SECRET. `.env.example` and
# `docker-compose.yml` (`${JWT_SECRET:-...}`) ship this exact string, and it is
# also the Settings default, so a stack started without a real secret warns in
# create_app() whichever of those three paths sets it. Kept >= 32 bytes because
# HS256 warns on shorter HMAC keys (RFC 7518 s3.2).
DEV_JWT_SECRET = "change-me-jwt-secret-at-least-32-bytes-long"

# Every spelling ever shipped as a placeholder. The older one is kept so a stale
# `.env` written before the values were aligned cannot silently keep a published
# signing key. tests/test_config_secrets.py holds the shipped defaults to this set.
DEV_JWT_SECRETS = frozenset(
    {DEV_JWT_SECRET, "dev-jwt-secret-change-me-at-least-32-bytes"}
)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://honeyforge:change-me@db:5432/honeyforge"
    test_database_url: str = (
        "postgresql+psycopg://honeyforge:change-me@db:5432/honeyforge_test"
    )
    agent_token_secret: str = "dev-secret"
    agent_ingest_secret: str = "dev-ingest-secret"
    jwt_secret: str = DEV_JWT_SECRET
    jwt_expires_minutes: int = 60
    fleet_offline_after_s: int = 45
    operator_username: str = "admin"
    operator_password: str = "change-me-operator-password"
    analyst_username: str = "analyst"
    analyst_password: str = ""
    # NoDecode: let pydantic-settings pass the raw env string through so the
    # comma-split validator can run (the default source-level JSON decode raises
    # SettingsError for a plain "http://a,http://b" value).
    cors_origins: Annotated[list[str], NoDecode] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_cors(cls, v: object) -> object:
        if isinstance(v, str):
            return [x.strip() for x in v.split(",") if x.strip()]
        return v

    @field_validator("jwt_secret")
    @classmethod
    def _jwt_secret_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("JWT_SECRET must not be blank")
        return v


settings = Settings()