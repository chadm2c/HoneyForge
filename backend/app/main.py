import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.agent import router as agent_router
from app.api.audit import router as audit_router
from app.api.auth import router as auth_router
from app.api.events import router as events_router
from app.api.honeypots import router as honeypots_router
from app.api.profiles import router as profiles_router
from app.api.telemetry import router as telemetry_router
from app.api.ws import router as ws_router
from app.core.config import DEV_JWT_SECRETS, settings

logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    if settings.jwt_secret in DEV_JWT_SECRETS:
        logger.warning(
            "JWT_SECRET is the documented dev placeholder; set a real secret "
            "before exposing the control center."
        )

    app = FastAPI(title="HoneyForge Control Center")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,  # explicit origins, never "*"
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(auth_router)
    app.include_router(agent_router)
    app.include_router(telemetry_router)
    app.include_router(events_router)
    app.include_router(audit_router)
    app.include_router(honeypots_router)
    app.include_router(profiles_router)
    app.include_router(ws_router)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app
