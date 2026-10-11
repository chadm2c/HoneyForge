from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings


def create_app() -> FastAPI:
    app = FastAPI(title="HoneyForge Control Center")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,  # explicit origins, never "*"
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app