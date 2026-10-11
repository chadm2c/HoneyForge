"""Control-center config client with version tracking.

Fetches the honeypot's assigned profile config over the per-agent bearer
token, and tracks which version the local decoy has applied so a version
bump on the center can be detected and adopted.
"""

import random
import time
from collections.abc import Callable
from dataclasses import dataclass

import httpx

BASE_BACKOFF_S = 1.0
MAX_BACKOFF_S = 30.0


def backoff_delay(attempt: int, base: float = BASE_BACKOFF_S, cap: float = MAX_BACKOFF_S) -> float:
    """Exponential backoff with full jitter, capped at ``cap`` seconds."""
    delay = min(base * (2 ** max(0, attempt - 1)), cap)
    return random.uniform(0.0, delay)


@dataclass(frozen=True)
class AgentConfig:
    honeypot_id: str
    config_version: int
    interaction_level: str
    config: dict


class ConfigClient:
    """Small HTTP client for ``GET /api/agent/config``."""

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
        self._applied_version: int | None = None

    @property
    def applied_version(self) -> int | None:
        return self._applied_version

    @applied_version.setter
    def applied_version(self, value: int | None) -> None:
        self._applied_version = value

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"}

    def fetch_config(self) -> AgentConfig:
        """Fetch the assigned config, retrying forever with capped jitter."""
        attempt = 0
        while True:
            try:
                resp = httpx.get(
                    f"{self.base_url}/api/agent/config",
                    headers=self._headers(),
                    timeout=self._timeout,
                )
                resp.raise_for_status()
                data = resp.json()
                return AgentConfig(
                    honeypot_id=str(data["honeypot_id"]),
                    config_version=int(data["config_version"]),
                    interaction_level=str(data["interaction_level"]),
                    config=dict(data["config"]),
                )
            except (httpx.HTTPError, KeyError, ValueError, TypeError):
                attempt += 1
                time.sleep(self._delay(attempt))

    def version_changed(self, cfg: AgentConfig) -> bool:
        """True when ``cfg`` differs from the applied version.

        A config is always a change until one has been applied (applied is
        ``None`` on first contact), so the initial adoption happens naturally.
        """
        return self.applied_version != cfg.config_version