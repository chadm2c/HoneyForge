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


def _token(operator_factory):
    return operator_factory()[2]


def test_q_matches_event_type_or_details(client, operator_factory, seed_events):
    token = _token(operator_factory)

    by_type = client.get("/api/events", headers=auth(token), params={"q": "scan"})
    body = by_type.json()
    assert body["total"] == 2
    assert all(i["event_type"] == "scan" for i in body["items"])

    # seed rows on honeypot `a` with details {"user": "root"}
    by_detail = client.get("/api/events", headers=auth(token), params={"q": "root"})
    assert by_detail.json()["total"] == 2


def test_q_wildcard_is_literal(client, operator_factory, seed_events):
    token = _token(operator_factory)
    # A bare % must match only rows literally containing %, i.e. none here.
    body = client.get("/api/events", headers=auth(token), params={"q": "%"}).json()
    assert body["total"] == 0


def test_q_other_wildcards_are_literal(client, operator_factory, seed_events):
    token = _token(operator_factory)
    # Unescaped, `_` matches any single character and would match every row;
    # an unescaped `\` is LIKE's own escape character. No seed row contains
    # either literally, so both must come back empty rather than match-all.
    for char in ("_", "\\"):
        body = client.get("/api/events", headers=auth(token), params={"q": char})
        assert body.json()["total"] == 0, char
