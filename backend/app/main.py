from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.deps import get_current_agent, require_operator
from app.core.config import settings
from app.models import Honeypot


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

    # S2 dev diagnostics so auth can be proven; replaced by real S4 routes.
    @app.get("/api/agent/whoami")
    def agent_whoami(hp: Honeypot = Depends(get_current_agent)) -> dict[str, str]:
        return {"id": str(hp.id)}

    @app.get("/api/operator/whoami")
    def operator_whoami(_: None = Depends(require_operator)) -> dict[str, str]:
        return {"ok": "true"}

    return app