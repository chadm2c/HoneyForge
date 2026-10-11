from app.core.config import settings
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
    _, token = honeypot_factory()
    assert client.get("/api/operator/whoami", headers=auth(token)).status_code == 401


def test_operator_endpoint_accepts_operator_token(client):
    assert (
        client.get(
            "/api/operator/whoami", headers=auth(settings.dev_operator_token)
        ).status_code
        == 200
    )