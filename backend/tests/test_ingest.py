from tests.helpers import auth


def test_ingest_is_idempotent(client, honeypot_factory, make_event):
    hp, token = honeypot_factory()
    e1, e2 = make_event(), make_event()
    r1 = client.post(
        "/api/telemetry/events", headers=auth(token), json={"events": [e1, e2]}
    )
    assert set(r1.json()["accepted"]) == {e1["id"], e2["id"]}
    r2 = client.post(
        "/api/telemetry/events", headers=auth(token), json={"events": [e1, e2]}
    )
    assert r2.json()["accepted"] == []
    assert set(r2.json()["duplicates"]) == {e1["id"], e2["id"]}


def test_oversized_details_rejected(client, honeypot_factory, make_event):
    hp, token = honeypot_factory()
    e = make_event(details={"blob": "x" * 70_000})
    r = client.post(
        "/api/telemetry/events", headers=auth(token), json={"events": [e]}
    )
    assert r.status_code == 422