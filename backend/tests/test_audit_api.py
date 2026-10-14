from tests.helpers import auth


def _audit_rows(client, token, **params):
    return client.get("/api/audit-logs", headers=auth(token), params=params).json()


def test_login_writes_an_audit_row(client, operator_factory):
    op, _, token = operator_factory(username="alice", password="hunter2")
    client.post("/api/auth/login", json={"username": "alice", "password": "hunter2"})
    body = _audit_rows(client, token, action="login")
    assert body["total"] == 1
    row = body["items"][0]
    assert row["operator_id"] == str(op.id)
    assert row["resource_type"] == "operator"
    assert row["resource_id"] == str(op.id)


def test_failed_login_is_audited_without_an_operator(client, operator_factory):
    _, _, token = operator_factory()
    client.post("/api/auth/login", json={"username": "ghost", "password": "nope"})
    body = _audit_rows(client, token, action="login_failed")
    assert body["total"] == 1
    assert body["items"][0]["operator_id"] is None
    assert body["items"][0]["resource_id"] is None


def test_audit_never_stores_the_password(client, operator_factory):
    _, _, token = operator_factory(username="alice", password="utterly-unique-secret")
    client.post(
        "/api/auth/login",
        json={"username": "alice", "password": "utterly-unique-secret"},
    )
    rows = _audit_rows(client, token)["items"]
    assert all("utterly-unique-secret" not in str(row) for row in rows)


def test_audit_filters_and_pagination(client, operator_factory):
    _, _, token = operator_factory()
    for _ in range(3):
        client.post("/api/auth/login", json={"username": "ghost", "password": "x"})
    page = _audit_rows(client, token, resource_type="operator", limit=2, offset=0)
    assert page["total"] == 3 and len(page["items"]) == 2
    assert page["items"][0]["id"] > page["items"][1]["id"]  # newest first


def test_audit_requires_a_token(client):
    assert client.get("/api/audit-logs").status_code == 401
