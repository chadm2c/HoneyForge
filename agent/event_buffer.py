"""Durable JSON Lines event spool.

Events are appended as JSON Lines to a single file. Reads never remove rows;
only an explicit ``ack`` does, and acks are atomic: the kept records are
written to a temp file in the same directory, then ``os.replace`` swaps it
over the live spool and the directory is fsynced. A reader can therefore
never observe a half-written spool, and a crash mid-ack loses at most the
very records that were being removed.
"""

import json
import os
import tempfile
import threading
from pathlib import Path


def _fsync_dir(path: Path) -> None:
    """Best-effort directory fsync (POSIX). No-op where a dir can't be opened."""
    try:
        fd = os.open(str(path), os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _dumps(event: dict) -> bytes:
    return (json.dumps(event, separators=(",", ":")) + "\n").encode("utf-8")


class EventBuffer:
    """Thread-safe, crash-safe JSON Lines spool keyed by event ``id``."""

    def __init__(self, path) -> None:
        self.path = Path(path)
        self._lock = threading.Lock()

    def append(self, event: dict) -> None:
        with self._lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with open(self.path, "ab") as fh:
                fh.write(_dumps(event))
                fh.flush()
                os.fsync(fh.fileno())

    def read_batch(self, max_items: int) -> list[dict]:
        """Return up to ``max_items`` events from the spool, oldest first.

        Read-only: nothing is removed here (removal only happens on ack).
        """
        with self._lock:
            events: list[dict] = []
            if not self.path.exists():
                return events
            with open(self.path, "r", encoding="utf-8") as fh:
                for i, line in enumerate(fh):
                    if i >= max_items:
                        break
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        events.append(json.loads(line))
                    except json.JSONDecodeError:
                        # A torn tail line (rare: fsync'd writes) is skipped.
                        continue
            return events

    def pending(self) -> int:
        with self._lock:
            if not self.path.exists():
                return 0
            count = 0
            with open(self.path, "r", encoding="utf-8") as fh:
                for line in fh:
                    if line.strip():
                        count += 1
            return count

    def ack(self, ids: list[str]) -> None:
        """Atomically remove events whose ``id`` is in ``ids``.

        The kept events are rewritten to a temp file in the same directory and
        swapped over the spool with ``os.replace``, so no reader can observe a
        partially-acknowledged file.
        """
        with self._lock:
            if not ids or not self.path.exists():
                return
            id_set = set(str(i) for i in ids)
            kept: list[dict] = []
            with open(self.path, "r", encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        ev = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if str(ev.get("id")) not in id_set:
                        kept.append(ev)
            self._atomic_rewrite(kept)

    def _atomic_rewrite(self, events: list[dict]) -> None:
        fd, tmp_name = tempfile.mkstemp(
            dir=str(self.path.parent), prefix=".spool-", suffix=".tmp"
        )
        try:
            with os.fdopen(fd, "wb") as fh:
                for ev in events:
                    fh.write(_dumps(ev))
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp_name, self.path)
            _fsync_dir(self.path.parent)
        except Exception:
            try:
                os.unlink(tmp_name)
            except OSError:
                pass
            raise