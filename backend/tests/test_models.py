import app.models  # noqa: F401  (ensures models are imported)
from app.db.base import Base

EXPECTED = {"operators", "profiles", "honeypots", "attack_events", "audit_logs"}


def test_core_tables_registered():
    assert EXPECTED <= set(Base.metadata.tables)


def test_attack_event_id_is_primary_key():
    assert Base.metadata.tables["attack_events"].c.id.primary_key