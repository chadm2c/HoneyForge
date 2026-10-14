import jwt as pyjwt

from app.core.config import settings
from app.core.security import create_access_token
from tests.helpers import auth


def test_login_returns_a_usable_token(client, operator_factory):
    op, _, _ = operator_factory(username="alice", password="hunter2")
    r = client.post("/api/auth/login", json={"username": "alice", "password": "hunter2"})
    assert r.status_code == 200
    body = r.json()
    assert body["token_type"] == "bearer"
    # expires_in is seconds (OAuth convention), not minutes.
    assert body["expires_in"] == settings.jwt_expires_minutes * 60
    assert body["operator"] == {"id": str(op.id), "username": "alice", "role": "admin"}
    me = client.get("/api/auth/me", headers=auth(body["access_token"]))
    assert me.status_code == 200 and me.json()["username"] == "alice"


def test_login_wrong_password_and_unknown_user_are_indistinguishable(
    client, operator_factory
):
    operator_factory(username="bob", password="hunter2")
    wrong = client.post("/api/auth/login", json={"username": "bob", "password": "nope"})
    unknown = client.post(
        "/api/auth/login", json={"username": "nobody", "password": "nope"}
    )
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()  # no user enumeration


def test_login_rejects_a_password_longer_than_72_bytes(client, operator_factory):
    # bcrypt would silently truncate at 72 bytes, so 73 bytes must be refused
    # rather than accepted as its 72-byte prefix.
    operator_factory(username="carol", password="x" * 72)
    r = client.post("/api/auth/login", json={"username": "carol", "password": "x" * 73})
    assert r.status_code == 422


def test_me_requires_a_token(client):
    assert client.get("/api/auth/me").status_code == 401


def test_forged_token_is_401(client, operator_factory):
    operator_factory()
    forged = pyjwt.encode(
        {"sub": "1", "role": "admin", "exp": 9999999999},
        "wrong-secret-but-long-enough-for-hs256",
        algorithm="HS256",
    )
    assert client.get("/api/auth/me", headers=auth(forged)).status_code == 401


def test_expired_token_is_401(client):
    expired = pyjwt.encode(
        {"sub": "1", "role": "admin", "exp": 1},
        settings.jwt_secret,
        algorithm="HS256",
    )
    assert client.get("/api/auth/me", headers=auth(expired)).status_code == 401


def test_token_for_an_unknown_operator_is_401(client):
    token = create_access_token("11111111-1111-4111-8111-111111111111", "admin")
    assert client.get("/api/auth/me", headers=auth(token)).status_code == 401


def test_agent_token_is_not_an_operator_token(client, honeypot_factory):
    _, agent_token = honeypot_factory()
    assert client.get("/api/auth/me", headers=auth(agent_token)).status_code == 401
