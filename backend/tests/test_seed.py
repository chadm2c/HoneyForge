from app import seed
from app.core.security import hash_agent_token, verify_password


def test_seed_creates_low_profile_and_honeypot(db):
    out = seed.seed_demo(db, agent_token="tok-a", operator_password="op-tok")
    assert out["profile"].interaction_level == "low"
    assert out["profile"].config["ports"] == [2222]
    assert hash_agent_token("tok-a") == out["honeypot"].agent_token_hash
    assert out["operator"].username == "admin"
    assert out["operator"].role == "admin"
    assert verify_password("op-tok", out["operator"].password_hash)


def test_seed_is_idempotent(db):
    first = seed.seed_demo(db, agent_token="tok-a", operator_password="op-tok")
    second = seed.seed_demo(db, agent_token="tok-a", operator_password="op-tok")
    assert second["honeypot"].id == first["honeypot"].id
    assert second["profile"].id == first["profile"].id
    assert second["operator"].id == first["operator"].id
    # count stays at one honeypot, one profile, one operator
    assert db.query(seed.Honeypot).count() == 1
    assert db.query(seed.Profile).count() == 1
    assert db.query(seed.Operator).count() == 1


def test_reseed_keeps_the_hash_and_rotates_only_on_change(db):
    # bcrypt salts differ on every call, so a blind re-hash would rewrite the
    # row on each seed run; verify-before-rehash keeps re-seeding a no-op.
    first = seed.seed_demo(db, agent_token="tok-a", operator_password="op-tok")
    stored = first["operator"].password_hash
    again = seed.seed_demo(db, agent_token="tok-a", operator_password="op-tok")
    assert again["operator"].password_hash == stored

    rotated = seed.seed_demo(db, agent_token="tok-a", operator_password="new-tok")
    assert rotated["operator"].password_hash != stored
    assert verify_password("new-tok", rotated["operator"].password_hash)


def test_seed_provisions_an_optional_analyst(db):
    out = seed.seed_demo(
        db,
        agent_token="tok-a",
        operator_password="op-tok",
        analyst_username="analyst",
        analyst_password="read-only-tok",
    )
    assert out["analyst"].username == "analyst"
    assert out["analyst"].role == "analyst"
    assert verify_password("read-only-tok", out["analyst"].password_hash)
    assert db.query(seed.Operator).count() == 2


def test_seed_without_analyst_password_creates_no_analyst(db):
    seed.seed_demo(db, agent_token="tok-a", operator_password="op-tok")
    assert db.query(seed.Operator).count() == 1


def test_seed_without_medium_token_stays_low_only(db):
    seed.seed_demo(db, agent_token="tok-a", operator_password="op-tok")
    assert db.query(seed.Profile).count() == 1
    assert db.query(seed.Honeypot).count() == 1


def test_seed_creates_medium_profile_and_honeypot(db):
    out = seed.seed_demo(
        db,
        agent_token="tok-a",
        operator_password="op-tok",
        medium_agent_token="tok-b",
    )
    medium_profile = out["medium_profile"]
    medium_honeypot = out["medium_honeypot"]
    assert medium_profile.interaction_level == "medium"
    assert medium_profile.config["ports"] == [8080]
    assert medium_profile.config["title"] == "Admin Panel"
    assert medium_profile.config["login_enabled"] is True
    assert medium_honeypot.name == "medium"
    assert medium_honeypot.profile_id == medium_profile.id
    assert hash_agent_token("tok-b") == medium_honeypot.agent_token_hash
    assert db.query(seed.Profile).count() == 2
    assert db.query(seed.Honeypot).count() == 2


def test_seed_rotates_medium_token_hash(db):
    seed.seed_demo(
        db, agent_token="tok-a", operator_password="op-tok", medium_agent_token="old"
    )
    out = seed.seed_demo(
        db, agent_token="tok-a", operator_password="op-tok", medium_agent_token="new"
    )
    assert hash_agent_token("new") == out["medium_honeypot"].agent_token_hash
    assert db.query(seed.Honeypot).count() == 2
