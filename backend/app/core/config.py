from typing import Annotated

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://honeyforge:change-me@db:5432/honeyforge"
    test_database_url: str = (
        "postgresql+psycopg://honeyforge:change-me@db:5432/honeyforge_test"
    )
    agent_token_secret: str = "dev-secret"
    agent_ingest_secret: str = "dev-ingest-secret"
    dev_operator_token: str = "dev-operator-token"
    # NoDecode: let pydantic-settings pass the raw env string through so the
    # comma-split validator can run (the default source-level JSON decode raises
    # SettingsError for a plain "http://a,http://b" value).
    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:5173"]

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_cors(cls, v: object) -> object:
        if isinstance(v, str):
            return [x.strip() for x in v.split(",") if x.strip()]
        return v


settings = Settings()