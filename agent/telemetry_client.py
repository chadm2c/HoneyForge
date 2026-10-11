"""Retrying telemetry client with ack-gated removal.

Events leave the local buffer only when the control center acknowledges them
(accepted or duplicate). On transport errors the client retries forever with
bounded exponential backoff + jitter, so a center outage never causes data
loss — the events simply stay buffered until the channel is back.
"""

import time
from collections.abc import Callable
from dataclasses import dataclass, field

import httpx

from config_client import backoff_delay
from event_buffer import EventBuffer


@dataclass(frozen=True)
class IngestAck:
    accepted: list[str]
    duplicates: list[str] = field(default_factory=list)

    @property
    def all_acked(self) -> list[str]:
        return self.accepted + self.duplicates


class TelemetryClient:
    """Small HTTP client for ``POST /api/telemetry/events``."""

    def __init__(
        self,
        base_url: str,
        token: str,
        timeout: float = 5.0,
        delay_fn: Callable[[int], float] | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self._timeout = timeout
        self._delay = delay_fn or backoff_delay

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"}

    def send(self, batch: list[dict]) -> IngestAck:
        attempt = 0
        while True:
            try:
                resp = httpx.post(
                    f"{self.base_url}/api/telemetry/events",
                    json={"events": batch},
                    headers=self._headers(),
                    timeout=self._timeout,
                )
                resp.raise_for_status()
                data = resp.json()
                return IngestAck(
                    accepted=[str(i) for i in data.get("accepted", [])],
                    duplicates=[str(i) for i in data.get("duplicates", [])],
                )
            except (httpx.HTTPError, KeyError, ValueError, TypeError):
                attempt += 1
                time.sleep(self._delay(attempt))


class Drainer:
    """Pulls a batch off the buffer, ships it, and acks only confirmed ids."""

    def __init__(self, client: TelemetryClient, buffer: EventBuffer, max_items: int = 50) -> None:
        self.client = client
        self.buffer = buffer
        self.max_items = max_items

    def drain_once(self) -> IngestAck | None:
        batch = self.buffer.read_batch(self.max_items)
        if not batch:
            return None
        ack = self.client.send(batch)
        # Ack-gated removal: accepted + duplicates only. Anything the center
        # did not confirm (e.g. it crashed mid-processing) stays buffered and
        # will be retried on the next drain.
        self.buffer.ack(ack.all_acked)
        return ack