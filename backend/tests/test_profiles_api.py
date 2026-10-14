import uuid

from app.models import Honeypot, Profile
from tests.helpers import auth

LOW = {"ports": [2222], "banner": "SSH-2.0-OpenSSH_9.0"}


def _new_profile_payload(request_overrides: dict | None = None) -> dict:
    payload = {"name": "p", "interaction_level": "low", "config": LOW}
    if request_overrides:
        payload.update(request_overrides)
    return payload


def test_create_requires_admin(client, operator_factory):
    _, _, analyst = operator_factory(role="analyst", username="an")
    r = client.post(
        "/api/profiles", headers=auth(analyst), json=_new_profile_payload()
    )
    assert r.status_code == 403


def test_create_list_get_with_version_one(client, operator_factory):
    _, _, admin = operator_factory()
    created = client.post("/api/profiles", headers=auth(admin), json=_new_profile_payload())
    assert created.status_code == 201
    body = created.json()
    assert body["version"] == 1 and body["config"]["banner"] == LOW["banner"]
    pid = body["id"]
    listed = client.get("/api/profiles", headers=auth(admin)).json()
    assert [p["name"] for p in listed] == ["p"] and "config" not in listed[0]
    assert client.get(f"/api/profiles/{pid}", headers=auth(admin)).json()["id"] == pid


def test_duplicate_name_is_409(client, operator_factory):
    _, _, admin = operator_factory()
    payload = _new_profile_payload()
    client.post("/api/profiles", headers=auth(admin), json=payload)
    again = client.post("/api/profiles", headers=auth(admin), json=payload)
    assert again.status_code == 409


def test_invalid_config_is_422(client, operator_factory):
    _, _, admin = operator_factory()
    r = client.post(
        "/api/profiles",
        headers=auth(admin),
        json=_new_profile_payload({"config": {"ports": [70000]}}),
    )
    assert r.status_code == 422


def test_patch_bumps_version_and_revalidates(client, operator_factory):
    _, _, admin = operator_factory()
    created = client.post("/api/profiles", headers=auth(admin), json=_new_profile_payload())
    pid = created.json()["id"]
    patched = client.patch(
        f"/api/profiles/{pid}",
        headers=auth(admin),
        json={"config": {"ports": [2223], "banner": "x"}},
    )
    assert patched.status_code == 200
    assert patched.json()["version"] == 2
    assert patched.json()["config"]["ports"] == [2223]
    invalid = client.patch(
        f"/api/profiles/{pid}", headers=auth(admin), json={"config": {"ports": [0]}}
    )
    assert invalid.status_code == 422


def test_patch_duplicate_name_is_409(client, operator_factory):
    """Renaming onto a taken name is a conflict, not an unhandled DB error."""
    _, _, admin = operator_factory()
    client.post("/api/profiles", headers=auth(admin), json=_new_profile_payload())
    other = client.post(
        "/api/profiles", headers=auth(admin), json=_new_profile_payload({"name": "q"})
    )
    renamed = client.patch(
        f"/api/profiles/{other.json()['id']}", headers=auth(admin), json={"name": "p"}
    )
    assert renamed.status_code == 409


def test_patch_explicit_null_is_422_not_500(client, operator_factory):
    """An explicit null must be rejected: it would clear a NOT NULL column."""
    _, _, admin = operator_factory()
    created = client.post("/api/profiles", headers=auth(admin), json=_new_profile_payload())
    pid = created.json()["id"]
    r = client.patch(f"/api/profiles/{pid}", headers=auth(admin), json={"name": None})
    assert r.status_code == 422
    # ...and the stored row is untouched (the 500 path left it half-applied).
    assert client.get(f"/api/profiles/{pid}", headers=auth(admin)).json()["name"] == "p"


def test_patch_and_delete_require_admin(client, operator_factory):
    """Read-only means read-only on the whole profile surface, not just create."""
    _, _, admin = operator_factory()
    _, _, analyst = operator_factory(role="analyst", username="an")
    created = client.post("/api/profiles", headers=auth(admin), json=_new_profile_payload())
    pid = created.json()["id"]
    assert (
        client.patch(
            f"/api/profiles/{pid}", headers=auth(analyst), json={"name": "nope"}
        ).status_code
        == 403
    )
    assert client.delete(f"/api/profiles/{pid}", headers=auth(analyst)).status_code == 403
    # reads stay open to the analyst role
    assert client.get(f"/api/profiles/{pid}", headers=auth(analyst)).status_code == 200
    assert client.get("/api/profiles", headers=auth(analyst)).status_code == 200


def test_delete_and_conflict_when_in_use(client, operator_factory, db):
    _, _, admin = operator_factory()
    created = client.post("/api/profiles", headers=auth(admin), json=_new_profile_payload())
    pid = created.json()["id"]
    db.add(Honeypot(name="hp", profile_id=uuid.UUID(pid), agent_token_hash="h"))
    db.commit()
    in_use = client.delete(f"/api/profiles/{pid}", headers=auth(admin))
    assert in_use.status_code == 409
    assert db.get(Profile, uuid.UUID(pid)) is not None
    assert db.query(Honeypot).filter_by(name="hp").count() == 1


def test_delete_then_gone(client, operator_factory):
    _, _, admin = operator_factory()
    created = client.post("/api/profiles", headers=auth(admin), json=_new_profile_payload())
    pid = created.json()["id"]
    assert client.delete(f"/api/profiles/{pid}", headers=auth(admin)).status_code == 204
    assert client.get(f"/api/profiles/{pid}", headers=auth(admin)).status_code == 404


def test_writes_are_audited(client, operator_factory):
    _, _, admin = operator_factory()
    created = client.post("/api/profiles", headers=auth(admin), json=_new_profile_payload())
    pid = created.json()["id"]
    client.patch(f"/api/profiles/{pid}", headers=auth(admin), json={"name": "p2"})
    client.delete(f"/api/profiles/{pid}", headers=auth(admin))
    rows = client.get(
        "/api/audit-logs", headers=auth(admin), params={"resource_type": "profile"}
    ).json()["items"]
    assert [r["action"] for r in rows] == [
        "profile_deleted",
        "profile_updated",
        "profile_created",
    ]
    assert all(r["resource_id"] == pid for r in rows)
