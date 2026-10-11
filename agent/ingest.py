"""Agent-internal ingest API.

Only reachable from ``agent_decoy_net``: the decoys post observed events here
with the shared ingest secret, and the agent validates + appends them to the
durable buffer. This is deliberately NOT exposed on the attacker-facing
``decoy_net`` (see AGENTS.md §6).
"""

import hmac
import json

from fastapi import FastAPI, Header, HTTPException, Request

from event_buffer import EventBuffer

INGEST_SECRET_HEADER = "X-Agent-Ingest-Secret"
MAX_DETAILS_BYTES = 65_536


class AppliedConfig:
    """Mutable holder for the currently applied firmware config.

    The agent updates it as it adopts new profile versions; the decoys read it
    via ``GET /config``.
    """

    def __init__(self) -> None:
        self._value: dict = {}

    def set(self, value: dict) -> None:
        self._value = value

    def get(self) -> dict:
        return self._value


def _validate_event(ev) -> None:
    if not isinstance(ev, dict):
        raise HTTPException(status_code=422, detail="event must be an object")
    for field in ("id", "event_type", "protocol", "occurred_at"):
        if field not in ev or not isinstance(ev[field], str):
            raise HTTPException(status_code=422, detail=f"missing or invalid field: {field}")
    details = ev.get("details", {})
    if not isinstance(details, dict):
        raise HTTPException(status_code=422, detail="details must be an object")
    if len(json.dumps(details)) > MAX_DETAILS_BYTES:
        raise HTTPException(status_code=422, detail="details too large (max 64KB)")
    for field in ("source_port", "target_port"):
        if field in ev and ev[field] is not None and not isinstance(ev[field], int):
            raise HTTPException(status_code=422, detail=f"{field} must be an integer")


def create_ingest_app(
    buffer: EventBuffer,
    ingest_secret: str = "",
    applied: AppliedConfig | None = None,
) -> FastAPI:
    app = FastAPI(title="HoneyForge Agent Ingest")
    holder = applied or AppliedConfig()

    @app.post("/ingest", status_code=202)
    async def ingest(
        request: Request,
        x_agent_ingest_secret: str | None = Header(default=None),
    ) -> dict:
        if not hmac.compare_digest(x_agent_ingest_secret or "", ingest_secret):
            raise HTTPException(status_code=401, detail="bad ingest secret")
        ev = await request.json()
        _validate_event(ev)
        buffer.append(ev)
        return {"status": "accepted"}

    @app.get("/config")
    def config() -> dict:
        return holder.get()

    return app