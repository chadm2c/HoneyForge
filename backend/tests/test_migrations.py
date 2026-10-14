import os

import sqlalchemy as sa
from alembic.config import Config

import app.models  # noqa: F401
from alembic import command
from app.core.config import settings
from app.db.base import Base

EXPECTED = {"operators", "profiles", "honeypots", "attack_events", "audit_logs"}


def test_migration_creates_tables():
    eng = sa.create_engine(settings.test_database_url)
    Base.metadata.drop_all(eng)  # start from empty so alembic is really the creator
    # drop_all does not know about alembic's own bookkeeping table; without this
    # the second run sees "already at head" and applies nothing (false GREEN).
    with eng.begin() as conn:
        conn.execute(sa.text("DROP TABLE IF EXISTS alembic_version"))
    os.environ["ALEMBIC_DATABASE_URL"] = settings.test_database_url
    command.upgrade(Config("alembic.ini"), "head")
    names = set(sa.inspect(eng).get_table_names())
    assert EXPECTED <= names
    eng.dispose()