import jwt
from fastapi import APIRouter, WebSocket
from starlette.websockets import WebSocketDisconnect

from app.core.security import decode_access_token
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
    # A closed socket (WebSocketDisconnect) or a malformed frame (ValueError,
    # which covers json.JSONDecodeError) is the peer's fault and both close the
    # socket unauthenticated; anything else is a bug and should surface.
    except (WebSocketDisconnect, ValueError):
        await websocket.close(code=1008)
        return
    raw_token = first.get("token") if isinstance(first, dict) else None
    claims = None
    if (
        isinstance(first, dict)
        and first.get("type") == "auth"
        and isinstance(raw_token, str)
    ):
        try:
            claims = decode_access_token(raw_token)
        except jwt.PyJWTError:
            claims = None
    authed = claims is not None and "sub" in claims
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