"""HoneyForge agent entry point.

Runs one process containing:
- an internal FastAPI ingest app (uvicorn thread) that decoys talk to on
  ``agent_decoy_net``;
- a config poller that adopts profile versions from the control center;
- a drainer that ships buffered events and removes only acked ones;
- a heartbeat reporter.

EventBuffer's ``threading.Lock`` is sufficient because ingest and drainer
share one process (see AGENTS.md §10 concurrency decision).
"""

import logging
import os
import threading
import time

import uvicorn

from config_client import ConfigClient
from event_buffer import EventBuffer
from heartbeat import HeartbeatClient
from ingest import AppliedConfig, create_ingest_app
from telemetry_client import Drainer, TelemetryClient

log = logging.getLogger("honeyforge.agent")


def _env_float(name: str, default: float) -> float:
    value = os.environ.get(name)
    return float(value) if value is not None else default


class Settings:
    def __init__(self) -> None:
        self.center_url = os.environ.get("HF_CENTER_URL", "http://backend:8000")
        self.agent_token = os.environ.get("HF_AGENT_TOKEN", "")
        self.ingest_secret = os.environ.get("HF_AGENT_INGEST_SECRET", "")
        self.spool_path = os.environ.get("HF_SPOOL_PATH", "/data/agent-spool.jsonl")
        self.poll_interval = _env_float("HF_POLL_INTERVAL", 15.0)
        self.drain_interval = _env_float("HF_DRAIN_INTERVAL", 5.0)
        self.heartbeat_interval = _env_float("HF_HEARTBEAT_INTERVAL", 15.0)
        self.ingest_host = os.environ.get("HF_INGEST_HOST", "0.0.0.0")
        self.ingest_port = int(os.environ.get("HF_INGEST_PORT", "8000"))


def run_ingest_server(app, host: str, port: int) -> threading.Thread:
    thread = threading.Thread(
        target=uvicorn.run,
        kwargs={"app": app, "host": host, "port": port, "log_level": "warning"},
        daemon=True,
    )
    thread.start()
    return thread


def main() -> None:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s"
    )
    s = Settings()

    buffer = EventBuffer(s.spool_path)
    config_client = ConfigClient(s.center_url, s.agent_token)
    heartbeat_client = HeartbeatClient(s.center_url, s.agent_token)
    drainer = Drainer(TelemetryClient(s.center_url, s.agent_token), buffer)
    applied = AppliedConfig()

    ingest_app = create_ingest_app(buffer, ingest_secret=s.ingest_secret, applied=applied)
    run_ingest_server(ingest_app, s.ingest_host, s.ingest_port)
    log.info(
        "agent started: center=%s spool=%s ingest on %s:%s",
        s.center_url, s.spool_path, s.ingest_host, s.ingest_port,
    )

    last_drain = last_heartbeat = 0.0
    while True:
        now = time.monotonic()
        try:
            cfg = config_client.fetch_config()
            if config_client.version_changed(cfg):
                applied.set(
                    {
                        "honeypot_id": cfg.honeypot_id,
                        "config_version": cfg.config_version,
                        "interaction_level": cfg.interaction_level,
                        "config": cfg.config,
                    }
                )
                config_client.applied_version = cfg.config_version
                log.info(
                    "adopted config version %s (%s)", cfg.config_version, cfg.interaction_level
                )
            if now - last_drain >= s.drain_interval:
                ack = drainer.drain_once()
                if ack:
                    log.info(
                        "drained: %s accepted, %s duplicate", len(ack.accepted), len(ack.duplicates)
                    )
                last_drain = now
            if now - last_heartbeat >= s.heartbeat_interval:
                heartbeat_client.beat(cfg.config_version)
                last_heartbeat = now
        except Exception:  # noqa: BLE001 - keep the agent alive through any tick error
            log.exception("agent tick failed")
        time.sleep(1.0)


if __name__ == "__main__":
    main()