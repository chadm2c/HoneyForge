import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def client():
    return TestClient(create_app())


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}