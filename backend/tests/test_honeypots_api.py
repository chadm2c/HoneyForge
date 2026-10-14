import uuid
from datetime import datetime, timedelta, timezone

from app.core.config import settings
from app.core.security import hash_agent_token
from app.models import Honeypot
from app.services.fleet_service import derive_status
from tests.helpers import auth

LOW = {"ports": [2222], "banner": "SSH-2.0-x"}


def _profile(client, token, name="p"):
    return client.post(
        "/api/profiles",
        headers=auth(token),
        json={"name": name, "interaction_level": "low", "config": LOW},
    ).json()["id"]


def _register(client, token, pid, name="hp"):
    return client.post(
        "/api/honeypots/register",
        headers=auth(token),
        json={"name": name, "profile_id": pid},
    )


def test_register_requires_admin(client, operator_factory):
    _, _, admin = operator_factory()
    _, _, analyst = operator_factory(role="analyst", username="an")
    pid = _profile(client, admin)
    assert _register(client, analyst, pid).status_code == 403


def test_register_returns_a_token_that_authenticates(
    client, operator_factory, db
):
    _, _, admin = operator_factory()
    pid = _profile(client, admin)
    body = _register(client, admin, pid).json()
    whoami = client.get("/api/agent/whoami", headers=auth(body["agent_token"]))
    assert whoami.json()["id"] == body["id"]
    # Only the hash is stored; the plaintext exists solely in this response.
    stored = db.get(Honeypot, uuid.UUID(body["id"]))
    assert stored.agent_token_hash == hash_agent_token(body["agent_token"])
    assert body["agent_token"] not in stored.agent_token_hash


def test_register_unknown_profile_and_duplicate_name(client, operator_factory):
    _, _, admin = operator_factory()
    pid = _profile(client, admin)
    missing = _register(
        client, admin, "11111111-1111-4111-8111-111111111111"
    )
    assert missing.status_code == 404
    _register(client, admin, pid)
    assert _register(client, admin, pid).status_code == 409


def test_fleet_status_is_derived_from_last_seen(client, operator_factory, db):
    _, _, admin = operator_factory()
    pid = _profile(client, admin)
    hid = _register(client, admin, pid).json()["id"]

    hp = db.get(Honeypot, uuid.UUID(hid))
    fleet = client.get("/api/honeypots", headers=auth(admin)).json()
    assert fleet[0]["status"] == "never"

    hp.last_seen_at = datetime.now(timezone.utc)
    db.commit()
    assert (
        client.get("/api/honeypots", headers=auth(admin)).json()[0]["status"]
        == "online"
    )

    hp.last_seen_at = datetime.now(timezone.utc) - timedelta(
        seconds=settings.fleet_offline_after_s + 1
    )
    db.commit()
    assert (
        client.get("/api/honeypots", headers=auth(admin)).json()[0]["status"]
        == "offline"
    )


def test_status_boundary_at_the_threshold_is_online():
    # Unit-level: derive_status accepts `now` so the exact boundary is testable
    # without racing the clock. Through HTTP the read always lands a few
    # milliseconds after the write, i.e. just past an exact-threshold stamp.
    hp = Honeypot(name="hp", profile_id=uuid.uuid4(), agent_token_hash="h")
    now = datetime.now(timezone.utc)
    hp.last_seen_at = now - timedelta(seconds=settings.fleet_offline_after_s)
    assert derive_status(hp, now=now) == "online"
    hp.last_seen_at = now - timedelta(seconds=settings.fleet_offline_after_s + 1)
    assert derive_status(hp, now=now) == "offline"


def test_heartbeat_makes_the_fleet_show_online(client, operator_factory):
    _, _, admin = operator_factory()
    pid = _profile(client, admin)
    body = _register(client, admin, pid).json()
    client.post(
        "/api/agent/heartbeat",
        headers=auth(body["agent_token"]),
        json={"config_version": 1},
    )
    row = client.get("/api/honeypots", headers=auth(admin)).json()[0]
    assert row["status"] == "online" and row["config_version"] == 1
    assert row["profile"]["interaction_level"] == "low"
    assert row["profile"]["version"] == 1


def test_register_is_audited(client, operator_factory):
    _, _, admin = operator_factory()
    pid = _profile(client, admin)
    _register(client, admin, pid)
    rows = client.get(
        "/api/audit-logs",
        headers=auth(admin),
        params={"action": "honeypot_registered"},
    ).json()["items"]
    assert len(rows) == 1 and rows[0]["resource_type"] == "honeypot"
