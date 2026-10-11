import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.security import generate_agent_token, hash_agent_token
from app.db.base import Base
from app.core.config import settings
from app.db.session import get_db
from app.main import create_app
from app.models import Honeypot, Profile


@pytest.fixture(scope="session")
def engine():
    eng = create_engine(settings.test_database_url)
    Base.metadata.drop_all(eng)
    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.fixture
def db(engine):
    yield from _session(engine)


@pytest.fixture
def client(engine):
    app = create_app()

    def _override_get_db():
        # Non-destructive session: every HTTP request must NOT wipe the data
        # that earlier requests in the same test rely on (the `db` fixture's
        # truncation runs once at teardown).
        yield from _plain_session(engine)

    app.dependency_overrides[get_db] = _override_get_db
    return TestClient(app)


def _session(engine):
    TestingSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    s = TestingSession()
    try:
        yield s
    finally:
        s.rollback()
        for table in reversed(Base.metadata.sorted_tables):
            s.execute(table.delete())
        s.commit()
        s.close()


def _plain_session(engine):
    TestingSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    s = TestingSession()
    try:
        yield s
    finally:
        s.rollback()
        s.close()


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def honeypot_factory(db):
    def make(interaction_level="low", config=None, name="hp"):
        profile = Profile(
            name=name,
            interaction_level=interaction_level,
            config=config or {"ports": [2222], "banner": "SSH-2.0-x"},
            version=1,
        )
        db.add(profile)
        db.flush()
        token = generate_agent_token()
        hp = Honeypot(
            name=name,
            profile_id=profile.id,
            agent_token_hash=hash_agent_token(token),
            config_version=0,
        )
        db.add(hp)
        db.commit()
        return hp, token

    yield make


@pytest.fixture
def profile(db):
    p = Profile(name="low-profile", interaction_level="low", config={"ports": [2222]}, version=1)
    db.add(p)
    db.commit()
    return p


@pytest.fixture
def make_event():
    def make(**overrides):
        e = {
            "id": str(uuid.uuid4()),
            "event_type": "connection",
            "source_ip": "192.0.2.10",  # TEST-NET-1 documentation range
            "source_port": 51000,
            "target_port": 2222,
            "protocol": "tcp",
            "details": {},
            "occurred_at": datetime.now(timezone.utc).isoformat(),
        }
        e.update(overrides)
        return e

    return make