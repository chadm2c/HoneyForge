import jwt as pyjwt
import pytest
from pydantic import ValidationError

from app.core import security
from app.core.config import Settings


def test_token_round_trip_carries_subject_and_role():
    token = security.create_access_token("11111111-1111-4111-8111-111111111111", "admin")
    claims = security.decode_access_token(token)
    assert claims["sub"] == "11111111-1111-4111-8111-111111111111"
    assert claims["role"] == "admin"
    assert claims["exp"] > claims["iat"]
    assert claims["jti"]


def test_token_rejects_a_tampered_signature():
    token = security.create_access_token("11111111-1111-4111-8111-111111111111", "admin")
    with pytest.raises(pyjwt.PyJWTError):
        security.decode_access_token(token[:-2] + "xy")


def test_token_rejects_the_none_algorithm():
    # A JWT with alg=none (unsigned) must never validate.
    unsigned = (
        "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0."
        "eyJzdWIiOiIxIiwicm9sZSI6ImFkbWluIn0."
    )
    with pytest.raises(pyjwt.PyJWTError):
        security.decode_access_token(unsigned)


def test_expired_token_is_rejected():
    token = pyjwt.encode(
        {"sub": "1", "role": "admin", "exp": 1},
        Settings().jwt_secret,
        algorithm="HS256",
    )
    with pytest.raises(pyjwt.PyJWTError):
        security.decode_access_token(token)


def test_blank_jwt_secret_is_rejected():
    with pytest.raises(ValidationError):
        Settings(jwt_secret="")
