from tests.helpers import auth


def test_missing_token_is_401(client):
    assert client.get("/api/agent/whoami").status_code == 401


def test_unknown_token_is_401(client):
    r = client.get("/api/agent/whoami", headers=auth("nope"))
    assert r.status_code == 401


def test_valid_token_returns_its_own_honeypot(client, honeypot_factory):
    hp, token = honeypot_factory()
    r = client.get("/api/agent/whoami", headers=auth(token))
    assert r.status_code == 200
    assert r.json()["id"] == str(hp.id)


def test_operator_endpoint_rejects_agent_token(client, honeypot_factory):
    _, agent_token = honeypot_factory()
    assert client.get("/api/auth/me", headers=auth(agent_token)).status_code == 401


def test_operator_endpoint_accepts_operator_jwt(client, operator_factory):
    _, _, jwt_token = operator_factory()
    r = client.get("/api/auth/me", headers=auth(jwt_token))
    assert r.status_code == 200
    assert r.json()["role"] == "admin"