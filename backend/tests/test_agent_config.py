from tests.helpers import auth


def test_config_returns_assigned_profile_version(client, honeypot_factory):
    hp, token = honeypot_factory(
        interaction_level="low", config={"ports": [2222], "banner": "SSH-2.0-x"}
    )
    r = client.get("/api/agent/config", headers=auth(token))
    body = r.json()
    assert body["interaction_level"] == "low"
    assert body["config"]["ports"] == [2222]
    assert body["config_version"] == 1


def test_config_is_scoped_to_the_authenticated_agent(client, honeypot_factory):
    a, ta = honeypot_factory(name="a", config={"ports": [2222]})
    b, tb = honeypot_factory(name="b", config={"ports": [2323]})
    ra = client.get("/api/agent/config", headers=auth(ta)).json()
    rb = client.get("/api/agent/config", headers=auth(tb)).json()
    assert ra["config"]["ports"] == [2222]
    assert rb["config"]["ports"] == [2323]
    assert ra["honeypot_id"] != rb["honeypot_id"]


def test_update_profile_increments_version(db, profile):
    from app.services import profile_service

    p = profile_service.update_profile(db, profile.id, {"config": {"ports": [22]}})
    assert p.version == 2