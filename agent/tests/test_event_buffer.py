import pytest

from event_buffer import EventBuffer


def test_no_loss_across_reopen(tmp_path):
    p = tmp_path / "spool.jsonl"
    b = EventBuffer(p)
    b.append({"id": "1"})
    b.append({"id": "2"})
    b.append({"id": "3"})
    batch = b.read_batch(2)
    b.ack([e["id"] for e in batch])
    reopened = EventBuffer(p)
    assert reopened.pending() == 1
    assert [e["id"] for e in reopened.read_batch(10)] == ["3"]


def test_append_and_pending_count(tmp_path):
    b = EventBuffer(tmp_path / "s.jsonl")
    assert b.pending() == 0
    b.append({"id": "a"})
    b.append({"id": "b"})
    assert b.pending() == 2


def test_read_batch_preserves_order_and_bounds(tmp_path):
    b = EventBuffer(tmp_path / "s.jsonl")
    for i in range(5):
        b.append({"id": str(i)})
    assert [e["id"] for e in b.read_batch(3)] == ["0", "1", "2"]
    assert [e["id"] for e in b.read_batch(10)] == ["0", "1", "2", "3", "4"]


def test_ack_keeps_unacknowledged(tmp_path):
    b = EventBuffer(tmp_path / "s.jsonl")
    for ev in ({"id": "1", "v": 1}, {"id": "2", "v": 2}, {"id": "3", "v": 3}):
        b.append(ev)
    b.ack(["1", "3"])
    remaining = b.read_batch(10)
    assert [e["id"] for e in remaining] == ["2"]
    assert remaining[0]["v"] == 2


def test_append_after_ack(tmp_path):
    b = EventBuffer(tmp_path / "s.jsonl")
    b.append({"id": "1"})
    b.ack(["1"])
    b.append({"id": "2"})
    assert [e["id"] for e in b.read_batch(10)] == ["2"]

    # ack on an empty (or already-acked) spool must not raise
    b.ack(["1"])