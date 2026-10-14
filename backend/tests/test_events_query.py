from tests.helpers import auth


def test_filters_and_pagination(client, seed_events, operator_factory):
    _, _, jwt_token = operator_factory()
    r = client.get(
        "/api/events",
        headers=auth(jwt_token),
        params={"honeypot_id": seed_events["a"], "limit": 2, "offset": 0},
    )
    body = r.json()
    assert len(body["items"]) == 2 and body["total"] >= 2
    assert all(i["honeypot_id"] == seed_events["a"] for i in body["items"])


def test_events_rejects_unauthenticated(client):
    assert client.get("/api/events").status_code == 401
