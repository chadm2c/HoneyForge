import jwt as pyjwt
import pytest
from starlette.websockets import WebSocketDisconnect

from tests.helpers import auth


def make_event_and_post(client, token) -> None:
    payload = {
        "events": [
            {
                "id": "11111111-1111-4111-8111-111111111111",
                "event_type": "connection",
                "source_ip": "192.0.2.11",
                "source_port": 50001,
                "target_port": 2222,
                "protocol": "tcp",
                "details": {"banner": "SSH-2.0-OpenSSH_9.0"},
                "occurred_at": "2026-01-01T12:00:00Z",
            }
        ]
    }
    r = client.post("/api/telemetry/events", headers=auth(token), json=payload)
    assert r.status_code == 200


def test_ws_receives_new_event(client, honeypot_factory, operator_factory):
    _, _, jwt_token = operator_factory()
    _, token = honeypot_factory()
    with client.websocket_connect("/api/ws/events") as ws:
        ws.send_json({"type": "auth", "token": jwt_token})
        make_event_and_post(client, token)
        msg = ws.receive_json()
        assert msg["event_type"] == "connection"
        assert msg["source_ip"] == "192.0.2.11"


def test_ws_rejects_a_forged_token(client):
    forged = pyjwt.encode(
        {"sub": "1", "role": "admin", "exp": 9999999999},
        "wrong-secret-but-long-enough-for-hs256",
        algorithm="HS256",
    )
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect("/api/ws/events") as ws:
            ws.send_json({"type": "auth", "token": forged})
            ws.receive_json()
    assert exc.value.code == 1008


def test_ws_rejects_bad_token(client):
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect("/api/ws/events") as ws:
            ws.send_json({"type": "auth", "token": "nope"})
            ws.receive_json()
    assert exc.value.code == 1008


def test_ws_rejects_non_string_token(client):
    # A non-str token must close cleanly (1008), not blow up the handler:
    # decode_access_token expects a str and the type check must come first.
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect("/api/ws/events") as ws:
            ws.send_json({"type": "auth", "token": 12345})
            ws.receive_json()
    assert exc.value.code == 1008