from tests.helpers import auth
from app.models import Honeypot


def test_heartbeat_updates_last_seen_and_ack(client, honeypot_factory, db):
    hp, token = honeypot_factory()
    hp_id = hp.id
    r = client.post(
        "/api/agent/heartbeat", headers=auth(token), json={"config_version": 1}
    )
    assert r.status_code == 200
    body = r.json()
    assert body["ack"] == 1
    assert body["profile_version"] == 1
    fresh = db.get(Honeypot, hp_id)
    db.expire(fresh)
    assert fresh.status == "online"
    assert fresh.config_version == 1
    assert fresh.last_seen_at is not None