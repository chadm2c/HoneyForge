from fastapi import WebSocket


class ConnectionManager:
    """In-process subscriber set for the event WebSocket.

    Deliberately simple (no Redis): one FastAPI process, one manager. S4/S6 may
    revisit if the deployment changes.
    """

    def __init__(self) -> None:
        self._connections: set[WebSocket] = set()

    def connect(self, ws: WebSocket) -> None:
        self._connections.add(ws)

    def disconnect(self, ws: WebSocket) -> None:
        self._connections.discard(ws)

    async def broadcast(self, payload: dict) -> None:
        dead: list[WebSocket] = []
        for ws in self._connections:
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


manager = ConnectionManager()