from app.core import security


def test_hash_is_deterministic_and_secret_keyed():
    t = security.generate_agent_token()
    assert security.hash_agent_token(t) == security.hash_agent_token(t)
    assert security.verify_agent_token(t, security.hash_agent_token(t))
    assert not security.verify_agent_token("wrong", security.hash_agent_token(t))