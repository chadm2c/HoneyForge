"""Low-interaction TCP decoy.

Listens on the ports from its applied agent config, greets every connection
with the configured banner (never a shell, never a forward), reads only a
bounded amount of client data, and posts one ``connection`` event per accepted
connection to its agent on ``agent_low_net``.

The attacker-facing ``decoy_net`` never contains the agent: see AGENTS.md §6.
"""

import logging
import os
import socket
import threading
import time
import uuid
from collections.abc import Callable
from datetime import datetime, timezone

import httpx

log = logging.getLogger("honeyforge.low")

DEFAULT_BANNER = "SSH-2.0-OpenSSH_8.9"
MAX_READ = 4096  # bounded read: garbage probes never get buffered past this

# Module-level ingest endpoint, set by main(). The default post_event posts
# here; tests replace post_event directly.
INGEST_ENDPOINT = ""
INGEST_SECRET = ""


def _now_utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def post_event(event: dict) -> None:
    """Default event sink: POST to the shared agent's /ingest. Best-effort."""
    try:
        resp = httpx.post(
            INGEST_ENDPOINT,
            json=event,
            headers={"X-Agent-Ingest-Secret": INGEST_SECRET},
            timeout=5.0,
        )
        resp.raise_for_status()
    except Exception:  # noqa: BLE001 - a failed telemetry post must not crash the decoy
        log.warning("failed to post event to agent: %s", INGEST_ENDPOINT, exc_info=True)


class DecoyServer:
    """Owns one listener per configured port and posts events on connections."""

    def __init__(
        self,
        ports: list[int],
        banner: str = DEFAULT_BANNER,
        on_event: Callable[[dict], None] | None = None,
        read_limit: int = MAX_READ,
    ) -> None:
        self.ports = list(ports)
        self.banner = banner
        self.on_event = on_event or post_event
        self.read_limit = read_limit
        self.listeners: list[socket.socket] = []
        self._threads: list[threading.Thread] = []
        self._stop = threading.Event()

    def start(self) -> None:
        for port in self.ports:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind(("0.0.0.0", port))
            sock.listen(16)
            sock.settimeout(1.0)
            self.listeners.append(sock)
            thread = threading.Thread(target=self._accept_loop, args=(sock,), daemon=True)
            thread.start()
            self._threads.append(thread)

    @property
    def bound_ports(self) -> list[int]:
        return [sock.getsockname()[1] for sock in self.listeners]

    def _accept_loop(self, sock: socket.socket) -> None:
        target_port = sock.getsockname()[1]
        while not self._stop.is_set():
            try:
                conn, addr = sock.accept()
            except socket.timeout:
                continue
            except OSError:
                return
            self._handle(conn, addr, target_port)

    def _handle(self, conn: socket.socket, addr: tuple[str, int], target_port: int) -> None:
        with conn:
            try:
                conn.sendall(self.banner.encode("ascii", errors="replace") + b"\r\n")
                conn.settimeout(2.0)
                total = 0
                while total < self.read_limit:
                    chunk = conn.recv(4096)
                    if not chunk:
                        break
                    total += len(chunk)
            except OSError:
                pass
            finally:
                self.on_event(
                    {
                        "id": str(uuid.uuid4()),  # agent-generated before transmission
                        "event_type": "connection",
                        "protocol": "tcp",
                        "source_ip": addr[0],
                        "source_port": addr[1],
                        "target_port": target_port,
                        "details": {},
                        "occurred_at": _now_utc(),
                    }
                )

    def close(self) -> None:
        self._stop.set()
        for sock in self.listeners:
            try:
                sock.close()
            except OSError:
                pass
        for thread in self._threads:
            thread.join(timeout=2.0)


def fetch_config(agent_url: str) -> dict:
    resp = httpx.get(f"{agent_url}/config", timeout=5.0)
    resp.raise_for_status()
    return resp.json()


def main() -> None:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s"
    )
    agent_url = os.environ.get("HF_AGENT_URL", "http://agent:8000")
    poll_interval = float(os.environ.get("HF_DECOY_POLL_INTERVAL", "15"))

    global INGEST_ENDPOINT, INGEST_SECRET
    INGEST_ENDPOINT = f"{agent_url}/ingest"
    INGEST_SECRET = os.environ.get("HF_AGENT_INGEST_SECRET", "")

    decoy: DecoyServer | None = None
    current_version: int | None = None
    while True:
        try:
            cfg = fetch_config(agent_url)
        except Exception:  # noqa: BLE001
            log.warning("config fetch failed; retrying in %.0fs", poll_interval, exc_info=True)
            time.sleep(poll_interval)
            continue

        if not cfg or cfg.get("interaction_level") != "low":
            log.info("no low config yet: %s", cfg)
        elif cfg.get("config_version") != current_version:
            if decoy is not None:
                decoy.close()
            ports = [int(p) for p in cfg["config"].get("ports", [2222])]
            banner = cfg["config"].get("banner") or DEFAULT_BANNER
            decoy = DecoyServer(ports, banner)
            decoy.start()
            log.info(
                "listening on ports=%s banner=%r (config v%s)",
                decoy.bound_ports, banner, cfg["config_version"],
            )
            current_version = cfg["config_version"]
        time.sleep(poll_interval)


if __name__ == "__main__":
    main()