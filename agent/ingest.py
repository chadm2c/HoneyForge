"""Agent-internal ingest API.

Only reachable from ``agent_low_net`` / ``agent_medium_net``: each decoy posts
observed events here with the shared ingest secret, and the agent validates +
appends them to the durable buffer. This is deliberately NOT exposed on the
attacker-facing ``decoy_net`` (see AGENTS.md §6).
"""

import hmac
import json
import uuid
from datetime import datetime

from fastapi import FastAPI, Header, HTTPException, Request

from event_buffer import EventBuffer

INGEST_SECRET_HEADER = "X-Agent-Ingest-Secret"
MAX_DETAILS_BYTES = 65_536
MAX_EVENT_TYPE = 64
MAX_PROTOCOL = 16


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
    """Mirror the control center's TelemetryEventIn constraints.

    Anything accepted here must also be accepted by the center: the agent's
    drainer retries a rejected batch forever, so a field the center would 422
    must be refused at the door rather than let into the spool (Review Focus:
    poisoning the buffer would wedge telemetry permanently).
    """
    if not isinstance(ev, dict):
        raise HTTPException(status_code=422, detail="event must be an object")

    # id -> the center's idempotency key is uuid.UUID
    try:
        uuid.UUID(str(ev.get("id", "")))
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(status_code=422, detail="id must be a UUID") from None

    # occurred_at -> the center parses it as a datetime
    occurred_at = ev.get("occurred_at")
    if not isinstance(occurred_at, str):
        raise HTTPException(status_code=422, detail="occurred_at must be an ISO-8601 string")
    try:
        datetime.fromisoformat(occurred_at.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=422, detail="occurred_at must be an ISO-8601 string") from None

    for field, cap in (("event_type", MAX_EVENT_TYPE), ("protocol", MAX_PROTOCOL)):
        value = ev.get(field)
        if not isinstance(value, str) or not value or len(value) > cap:
            raise HTTPException(
                status_code=422, detail=f"{field} must be a string of 1..{cap} chars"
            )

    source_ip = ev.get("source_ip")
    if source_ip is not None and not isinstance(source_ip, str):
        raise HTTPException(status_code=422, detail="source_ip must be a string")

    details = ev.get("details", {})
    if not isinstance(details, dict):
        raise HTTPException(status_code=422, detail="details must be an object")
    if len(json.dumps(details)) > MAX_DETAILS_BYTES:
        raise HTTPException(status_code=422, detail="details too large (max 64KB)")

    for field in ("source_port", "target_port"):
        value = ev.get(field)
        if value is not None and (not isinstance(value, int) or not 1 <= value <= 65535):
            raise HTTPException(
                status_code=422, detail=f"{field} must be an integer in 1..65535"
            )


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