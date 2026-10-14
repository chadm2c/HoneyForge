from app.core import security


def test_hash_is_not_plaintext_and_verifies():
    h = security.hash_password("correct-horse")
    assert h != "correct-horse"
    assert "correct-horse" not in h
    assert security.verify_password("correct-horse", h)
    assert not security.verify_password("wrong", h)


def test_two_hashes_of_the_same_password_differ():
    # bcrypt salts: the seed relies on this to detect "already set" cheaply.
    assert security.hash_password("pw") != security.hash_password("pw")


def test_verify_rejects_a_malformed_hash():
    # The S2 placeholder hash is not bcrypt; it must verify False, not raise.
    assert security.verify_password("pw", "not-a-bcrypt-hash") is False
