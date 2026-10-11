import json

import httpx

from event_buffer import EventBuffer
from telemetry_client import Drainer, TelemetryClient


def _client() -> TelemetryClient:
    return TelemetryClient("http://center", "tok", delay_fn=lambda _attempt: 0.0)


def test_retries_then_succeeds_and_only_removes_acked(httpx_mock, tmp_path):
    httpx_mock.add_exception(httpx.ConnectError("down"))
    httpx_mock.add_response(json={"accepted": ["1"], "duplicates": []})
    buf = EventBuffer(tmp_path / "s.jsonl")
    buf.append({"id": "1"})
    buf.append({"id": "2"})
    ack = Drainer(_client(), buf).drain_once()
    assert ack is not None
    assert ack.accepted == ["1"]
    assert buf.pending() == 1
    assert [e["id"] for e in buf.read_batch(10)] == ["2"]


def test_duplicate_ack_also_removes(httpx_mock, tmp_path):
    httpx_mock.add_response(json={"accepted": [], "duplicates": ["1"]})
    buf = EventBuffer(tmp_path / "s.jsonl")
    buf.append({"id": "1"})
    buf.append({"id": "2"})
    Drainer(_client(), buf).drain_once()
    assert [e["id"] for e in buf.read_batch(10)] == ["2"]


def test_send_posts_events_payload_and_parses_ack(httpx_mock):
    httpx_mock.add_response(json={"accepted": ["a", "b"], "duplicates": []})
    ack = _client().send([{"id": "a"}, {"id": "b"}])
    req = httpx_mock.get_requests()[-1]
    assert req.url.path == "/api/telemetry/events"
    assert req.headers["authorization"] == "Bearer tok"
    assert json.loads(req.content) == {"events": [{"id": "a"}, {"id": "b"}]}
    assert ack.accepted == ["a", "b"]
    assert ack.duplicates == []


def test_empty_spool_drains_to_nothing(httpx_mock, tmp_path):
    buf = EventBuffer(tmp_path / "s.jsonl")
    assert Drainer(_client(), buf).drain_once() is None