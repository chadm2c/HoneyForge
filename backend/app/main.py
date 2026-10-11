from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.agent import router as agent_router
from app.api.deps import require_operator
from app.api.telemetry import router as telemetry_router
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

    app.include_router(agent_router)
    app.include_router(telemetry_router)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    # S2 dev diagnostic; replaced by real S4 routes.
    @app.get("/api/operator/whoami")
    def operator_whoami(_: None = Depends(require_operator)) -> dict[str, str]:
        return {"ok": "true"}

    return app