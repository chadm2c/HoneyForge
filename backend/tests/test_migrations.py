import os

import sqlalchemy as sa
from alembic import command
from alembic.config import Config

import app.models  # noqa: F401
from app.core.config import settings
from app.db.base import Base

EXPECTED = {"operators", "profiles", "honeypots", "attack_events", "audit_logs"}


def test_migration_creates_tables():
    eng = sa.create_engine(settings.test_database_url)
    Base.metadata.drop_all(eng)  # start from empty so alembic is really the creator
    os.environ["ALEMBIC_DATABASE_URL"] = settings.test_database_url
    command.upgrade(Config("alembic.ini"), "head")
    names = set(sa.inspect(eng).get_table_names())
    assert EXPECTED <= names
    eng.dispose()