from app import seed
from app.core.security import hash_agent_token


def test_seed_creates_low_profile_and_honeypot(db):
    out = seed.seed_demo(db, agent_token="tok-a", operator_token="op-tok")
    assert out["profile"].interaction_level == "low"
    assert out["profile"].config["ports"] == [2222]
    assert hash_agent_token("tok-a") == out["honeypot"].agent_token_hash
    assert out["operator"].username == "admin"
    assert out["operator"].role == "admin"


def test_seed_is_idempotent(db):
    first = seed.seed_demo(db, agent_token="tok-a", operator_token="op-tok")
    second = seed.seed_demo(db, agent_token="tok-a", operator_token="op-tok")
    assert second["honeypot"].id == first["honeypot"].id
    assert second["profile"].id == first["profile"].id
    assert second["operator"].id == first["operator"].id
    # count stays at one honeypot, one profile, one operator
    assert db.query(seed.Honeypot).count() == 1
    assert db.query(seed.Profile).count() == 1
    assert db.query(seed.Operator).count() == 1