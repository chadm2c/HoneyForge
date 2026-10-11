from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://honeyforge:change-me@db:5432/honeyforge"
    test_database_url: str = (
        "postgresql+psycopg://honeyforge:change-me@db:5432/honeyforge_test"
    )
    agent_token_secret: str = "dev-secret"
    agent_ingest_secret: str = "dev-ingest-secret"
    dev_operator_token: str = "dev-operator-token"
    cors_origins: list[str] = ["http://localhost:5173"]

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_cors(cls, v: object) -> object:
        if isinstance(v, str):
            return [x.strip() for x in v.split(",") if x.strip()]
        return v


settings = Settings()