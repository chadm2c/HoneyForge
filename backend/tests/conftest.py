import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from app.core.security import generate_agent_token, hash_agent_token
from app.db.base import Base
from app.core.config import settings
from app.db.session import get_db
from app.main import create_app
from app.models import AttackEvent, Honeypot, Profile


@pytest.fixture(scope="session")
def engine():
    _ensure_test_database()
    eng = create_engine(settings.test_database_url)
    Base.metadata.drop_all(eng)
    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()


def _ensure_test_database() -> None:
    """Create the test database if it doesn't exist.

    ``create_all`` can create tables but not the database itself, so on a fresh
    Compose stack (or a bare local Postgres) the very first test run needs this.
    Connects to the server's default ``postgres`` database to issue the CREATE.
    """
    url = make_url(settings.test_database_url)
    db_name = url.database
    if not db_name:
        return
    admin_engine = create_engine(url.set(database="postgres"), isolation_level="AUTOCOMMIT")
    try:
        with admin_engine.connect() as conn:
            exists = conn.exec_driver_sql(
                "SELECT 1 FROM pg_database WHERE datname = %s", (db_name,)
            ).scalar()
            if not exists:
                conn.exec_driver_sql(f'CREATE DATABASE "{db_name}"')
    finally:
        admin_engine.dispose()


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


@pytest.fixture
def seed_events(honeypot_factory, db):
    a, _ = honeypot_factory(name="seed-a")
    b, _ = honeypot_factory(name="seed-b")
    events = [
        AttackEvent(
            id=uuid.uuid4(),
            honeypot_id=a.id,
            event_type="connection",
            source_ip="192.0.2.1",
            source_port=40000 + i,
            target_port=2222,
            protocol="tcp",
            details={"user": "root"} if i else {},
            occurred_at=datetime(2026, 1, 1, 12, 0, i, tzinfo=timezone.utc),
        )
        for i in range(3)
    ]
    events += [
        AttackEvent(
            id=uuid.uuid4(),
            honeypot_id=b.id,
            event_type="scan",
            source_ip="198.51.100.9",
            source_port=40000 + i,
            target_port=22,
            protocol="tcp",
            details={},
            occurred_at=datetime(2026, 1, 1, 12, 1, i, tzinfo=timezone.utc),
        )
        for i in range(2)
    ]
    db.add_all(events)
    db.commit()
    return {"a": str(a.id), "b": str(b.id)}