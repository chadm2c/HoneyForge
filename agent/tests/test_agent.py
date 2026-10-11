import json

from fastapi.testclient import TestClient

from event_buffer import EventBuffer
from heartbeat import HeartbeatClient
from ingest import AppliedConfig, create_ingest_app

INGEST_SECRET = "s3cret"
AUTH = {"X-Agent-Ingest-Secret": INGEST_SECRET}


def _event(**overrides):
    ev = {
        "id": "00000000-0000-4000-8000-000000000001",
        "event_type": "connection",
        "protocol": "tcp",
        "details": {},
        "occurred_at": "2026-01-01T00:00:00Z",
    }
    ev.update(overrides)
    return ev


def test_ingest_appends_to_buffer(tmp_path):
    buf = EventBuffer(tmp_path / "s.jsonl")
    c = TestClient(create_ingest_app(buf, ingest_secret=INGEST_SECRET))
    r = c.post("/ingest", json=_event(), headers=AUTH)
    assert r.status_code == 202
    assert buf.pending() == 1


def test_ingest_rejects_bad_secret(tmp_path):
    buf = EventBuffer(tmp_path / "s.jsonl")
    c = TestClient(create_ingest_app(buf, ingest_secret=INGEST_SECRET))
    r = c.post("/ingest", json=_event())
    assert r.status_code == 401
    assert buf.pending() == 0


def test_ingest_rejects_malformed_event(tmp_path):
    buf = EventBuffer(tmp_path / "s.jsonl")
    c = TestClient(create_ingest_app(buf, ingest_secret=INGEST_SECRET))
    r = c.post("/ingest", json=_event(id=None), headers=AUTH)
    assert r.status_code == 422
    assert buf.pending() == 0


def test_ingest_rejects_non_uuid_id(tmp_path):
    # The center's idempotency key is a UUID; a non-UUID here would be accepted
    # into the spool and then 422 forever, wedging the drain loop.
    buf = EventBuffer(tmp_path / "s.jsonl")
    c = TestClient(create_ingest_app(buf, ingest_secret=INGEST_SECRET))
    r = c.post("/ingest", json=_event(id="not-a-uuid"), headers=AUTH)
    assert r.status_code == 422
    assert buf.pending() == 0


def test_ingest_rejects_bad_timestamp(tmp_path):
    buf = EventBuffer(tmp_path / "s.jsonl")
    c = TestClient(create_ingest_app(buf, ingest_secret=INGEST_SECRET))
    r = c.post("/ingest", json=_event(occurred_at="not-a-date"), headers=AUTH)
    assert r.status_code == 422
    assert buf.pending() == 0


def test_ingest_rejects_oversized_event_type(tmp_path):
    buf = EventBuffer(tmp_path / "s.jsonl")
    c = TestClient(create_ingest_app(buf, ingest_secret=INGEST_SECRET))
    r = c.post("/ingest", json=_event(event_type="x" * 65), headers=AUTH)
    assert r.status_code == 422
    assert buf.pending() == 0


def test_ingest_rejects_out_of_range_port(tmp_path):
    buf = EventBuffer(tmp_path / "s.jsonl")
    c = TestClient(create_ingest_app(buf, ingest_secret=INGEST_SECRET))
    r = c.post("/ingest", json=_event(source_port=70000), headers=AUTH)
    assert r.status_code == 422
    assert buf.pending() == 0


def test_config_endpoint_returns_applied(tmp_path):
    holder = AppliedConfig()
    holder.set(
        {
            "honeypot_id": "hp",
            "config_version": 2,
            "interaction_level": "low",
            "config": {"ports": [2222]},
        }
    )
    c = TestClient(
        create_ingest_app(EventBuffer(tmp_path / "s.jsonl"), ingest_secret="s", applied=holder)
    )
    body = c.get("/config").json()
    assert body["config_version"] == 2
    assert body["config"]["ports"] == [2222]


def test_heartbeat_posts_version(httpx_mock):
    httpx_mock.add_response(json={"ack": 3, "profile_version": 3})
    hb = HeartbeatClient("http://center", "tok")
    body = hb.beat(3)
    req = httpx_mock.get_requests()[-1]
    assert req.url.path == "/api/agent/heartbeat"
    assert json.loads(req.content) == {"config_version": 3}
    assert body["profile_version"] == 3