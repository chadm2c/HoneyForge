import hmac

from fastapi import APIRouter, WebSocket
from starlette.websockets import WebSocketDisconnect

from app.core.config import settings
from app.realtime.websocket_manager import manager

router = APIRouter()


@router.websocket("/api/ws/events")
async def ws_events(websocket: WebSocket) -> None:
    # First-message authentication: the socket is accepted, then the client
    # must send {"type": "auth", "token": ...} before it becomes a subscriber.
    # Credentials never appear in URLs this way.
    await websocket.accept()
    try:
        first = await websocket.receive_json()
    except Exception:
        await websocket.close(code=1008)
        return
    raw_token = first.get("token") if isinstance(first, dict) else None
    authed = (
        isinstance(first, dict)
        and first.get("type") == "auth"
        and isinstance(raw_token, str)
        and hmac.compare_digest(raw_token, settings.dev_operator_token)
    )
    if not authed:
        await websocket.close(code=1008)
        return

    manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    else:
        manager.disconnect(websocket)