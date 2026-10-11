"""Heartbeat reporting to the control center."""

import time
from collections.abc import Callable

import httpx

from config_client import backoff_delay


class HeartbeatClient:
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

    def beat(self, config_version: int) -> dict:
        """POST /api/agent/heartbeat, retrying with capped jitter on failure."""
        attempt = 0
        while True:
            try:
                resp = httpx.post(
                    f"{self.base_url}/api/agent/heartbeat",
                    json={"config_version": config_version},
                    headers={"Authorization": f"Bearer {self.token}"},
                    timeout=self._timeout,
                )
                resp.raise_for_status()
                return resp.json()
            except (httpx.HTTPError, ValueError):
                attempt += 1
                time.sleep(self._delay(attempt))