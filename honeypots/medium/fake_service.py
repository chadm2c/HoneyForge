"""Medium-interaction fake HTTP admin decoy.

Serves a synthetic admin panel (login page, a couple of post-login pages) on
the ports from its applied agent config, records ``http_request`` /
``path_probe`` / ``auth_attempt`` events, and posts them to its agent on
``agent_medium_net``. It never executes commands, opens a shell, forwards to a
real service, or stores submitted credentials.

The login is **decorative**: a hardcoded, clearly-synthetic credential pair
issues an opaque dummy cookie that merely gates the fake admin pages. It is not
an authentication control (see docs/threat-model.md).
"""

import html
import http.server
import logging
import os
import secrets
import threading
import time
import uuid
from collections.abc import Callable
from datetime import datetime, timezone
from urllib.parse import parse_qs, urlsplit

import httpx

log = logging.getLogger("honeyforge.medium")

DEFAULT_TITLE = "Admin Panel"
DEFAULT_PORT = 8080
MAX_BODY = 8192  # bodies are never stored; keep the read bounded
MAX_PATH_RECORDED = 1024  # cap the recorded path so details stay small
COOKIE_NAME = "hf_admin"

# Clearly-synthetic, hardcoded, non-secret demo credentials. They exist only to
# make the fake login interactive and are never stored in the DB or config.
SYNTHETIC_USERNAME = "admin"
SYNTHETIC_PASSWORD = "demo-password"

# Module-level ingest endpoint, set by main(). Tests replace on_event directly.
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


def _split_path(raw: str) -> tuple[str, bool]:
    """Return (path-without-query, had_query). The query is never recorded."""
    split = urlsplit(raw)
    path = split.path or "/"
    return path[:MAX_PATH_RECORDED], bool(split.query)


def _classify_username(value: str) -> str:
    v = value.strip()
    if not v:
        return "empty"
    if "@" in v:
        return "email"
    if len(v) <= 3:
        return "short"
    if len(v) <= 20:
        return "medium"
    return "long"


def _parse_credentials(raw: bytes, content_type: str) -> tuple[str, str]:
    """Extract (username, password) from a form-encoded body.

    The fake login only understands the form it renders: any other content type
    (JSON, multipart, none) is not interpreted. Values are used only to decide
    success and to compute lengths; callers must never record them.
    """
    ctype = content_type.split(";", 1)[0].strip().lower()
    if ctype != "application/x-www-form-urlencoded" or not raw:
        return "", ""
    text = raw.decode("utf-8", errors="replace")
    form = parse_qs(text, keep_blank_values=True)
    return form.get("username", [""])[0], form.get("password", [""])[0]


class _Server(http.server.ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, addr, handler, decoy, request_timeout: float) -> None:
        self.decoy = decoy
        self.request_timeout = request_timeout
        super().__init__(addr, handler)


class _Handler(http.server.BaseHTTPRequestHandler):
    server_version = "nginx/1.24.0"
    sys_version = ""
    protocol_version = "HTTP/1.0"

    def setup(self) -> None:
        self.timeout = self.server.request_timeout
        super().setup()

    def version_string(self) -> str:
        return self.server_version

    def log_message(self, fmt: str, *args) -> None:
        # Never let the stdlib handler write the request line (which includes the
        # query string) to stderr.
        return

    def log_error(self, fmt: str, *args) -> None:
        # The stdlib calls log_error("Request timed out: %r", exc) when a client
        # stalls mid-request. Remember it so handle_one_request can record
        # exactly one aborted probe.
        if args and isinstance(args[0], BaseException):
            self._last_exc = args[0]

    def handle_one_request(self) -> None:
        self._emitted = False
        self._last_exc = None
        super().handle_one_request()
        if not self._emitted and isinstance(getattr(self, "_last_exc", None), TimeoutError):
            self._record("path_probe", "unknown", {"reason": "aborted"})

    def log_request(self, code="-", size="-") -> None:
        # Sanitized, bounded access log: no query string, no headers.
        path = getattr(self, "path", "")
        safe = path.split("?", 1)[0][:128]
        log.info("http %s %s -> %s", getattr(self, "command", "?"), safe, code)

    # -- helpers ------------------------------------------------------------

    def _record(self, event_type: str, category: str, extra: dict | None = None) -> None:
        self._emitted = True
        raw_path = getattr(self, "path", "")
        clean_path, has_query = _split_path(raw_path) if raw_path else ("", False)
        details = {
            "method": getattr(self, "command", "") or "",
            "path": clean_path,
            "category": category,
            "has_query": has_query,
        }
        if extra:
            details.update(extra)
        self.server.decoy.emit(
            {
                "id": str(uuid.uuid4()),
                "event_type": event_type,
                "protocol": "http",
                "source_ip": self.client_address[0],
                "source_port": self.client_address[1],
                "target_port": self.server.server_address[1],
                "details": details,
                "occurred_at": _now_utc(),
            }
        )

    def _send_html(self, code: int, body: str) -> None:
        payload = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _redirect(self, location: str, extra_headers: dict | None = None) -> None:
        self.send_response(302)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        for name, value in (extra_headers or {}).items():
            self.send_header(name, value)
        self.end_headers()

    def _has_session(self) -> bool:
        raw = self.headers.get("Cookie", "")
        for part in raw.split(";"):
            name, _, value = part.strip().partition("=")
            if name == COOKIE_NAME and value:
                return True
        return False

    def _read_body(self) -> tuple[bytes, str | None]:
        header = self.headers.get("Content-Length")
        if header is None:
            return b"", "missing-length"
        try:
            length = int(header)
        except ValueError:
            return b"", "bad-length"
        if length < 0:
            return b"", "bad-length"
        if length > MAX_BODY:
            return b"", "too-large"
        return (self.rfile.read(length) if length else b""), None

    # -- routing ------------------------------------------------------------

    def do_GET(self) -> None:  # noqa: N802 - stdlib method name
        path, _ = _split_path(self.path)
        if path == "/":
            self._record("http_request", "login")
            self._send_html(200, self.server.decoy.login_page())
        elif path in ("/dashboard", "/users", "/logs"):
            category = path.strip("/")
            self._record("http_request", category)
            if not self._has_session():
                self._redirect("/")
                return
            self._send_html(200, self.server.decoy.page(category))
        else:
            self._record("path_probe", "unknown")
            self._send_html(404, self.server.decoy.not_found_page())

    def do_POST(self) -> None:  # noqa: N802 - stdlib method name
        path, _ = _split_path(self.path)
        if path == "/login" and self.server.decoy.login_enabled:
            self._handle_login()
        else:
            self._record("path_probe", "unknown")
            self._send_html(404, self.server.decoy.not_found_page())

    def _handle_login(self) -> None:
        raw, err = self._read_body()
        if err == "too-large":
            self._record("http_request", "login", {"rejected": "body_too_large"})
            self._send_html(413, self.server.decoy.not_found_page())
            return
        if err is not None:
            self._record("http_request", "login", {"rejected": "bad_content_length"})
            self._send_html(400, self.server.decoy.not_found_page())
            return

        username, password = _parse_credentials(raw, self.headers.get("Content-Type", ""))
        success = username == SYNTHETIC_USERNAME and password == SYNTHETIC_PASSWORD
        self._record(
            "auth_attempt",
            "login",
            {
                "username_length": len(username),
                "username_category": _classify_username(username),
                "password_present": bool(password),
                "password_length": len(password),
                "success": success,
            },
        )
        if success:
            cookie = f"{COOKIE_NAME}={secrets.token_hex(16)}; Path=/; HttpOnly"
            self._redirect("/dashboard", {"Set-Cookie": cookie})
        else:
            self._send_html(200, self.server.decoy.login_page())


class AdminDecoy:
    """Owns one HTTP listener per configured port and posts events per request."""

    def __init__(
        self,
        ports: list[int],
        title: str = DEFAULT_TITLE,
        login_enabled: bool = True,
        on_event: Callable[[dict], None] | None = None,
        request_timeout: float = 5.0,
    ) -> None:
        self.ports = list(ports)
        self.title = title
        self.login_enabled = login_enabled
        self.on_event = on_event or post_event
        self.request_timeout = request_timeout
        self._servers: list[_Server] = []
        self._threads: list[threading.Thread] = []

    def emit(self, event: dict) -> None:
        self.on_event(event)

    def start(self) -> None:
        for port in self.ports:
            server = _Server(("0.0.0.0", port), _Handler, self, self.request_timeout)
            thread = threading.Thread(
                target=server.serve_forever, kwargs={"poll_interval": 0.2}, daemon=True
            )
            thread.start()
            self._servers.append(server)
            self._threads.append(thread)

    @property
    def bound_ports(self) -> list[int]:
        return [server.server_address[1] for server in self._servers]

    def close(self) -> None:
        for server, thread in zip(self._servers, self._threads):
            server.shutdown()
            server.server_close()
            thread.join(timeout=2.0)
        self._servers.clear()
        self._threads.clear()

    def apply_config(self, config: dict) -> None:
        """(Re)bind from an applied medium config.

        Called on a config_version change: the old listeners are shut down first
        so the same port can be rebound without an "address in use" error.
        """
        self.close()
        self.ports = [int(port) for port in config.get("ports", [DEFAULT_PORT])]
        self.title = config.get("title") or DEFAULT_TITLE
        self.login_enabled = bool(config.get("login_enabled", True))
        self.start()

    # -- pages (no user input is ever echoed) -------------------------------

    def login_page(self) -> str:
        title = html.escape(self.title)
        return (
            "<!doctype html><html><head><meta charset='utf-8'>"
            f"<title>{title}</title></head><body>"
            f"<h1>{title}</h1>"
            "<form method='post' action='/login'>"
            "<input name='username' autocomplete='off'>"
            "<input name='password' type='password' autocomplete='off'>"
            "<button type='submit'>Sign in</button>"
            "</form></body></html>"
        )

    def page(self, name: str) -> str:
        title = html.escape(self.title)
        safe = html.escape(name)
        return (
            "<!doctype html><html><head><meta charset='utf-8'>"
            f"<title>{title} - {safe}</title></head><body>"
            f"<h1>{title}</h1><nav><a href='/dashboard'>dashboard</a> "
            "<a href='/users'>users</a> <a href='/logs'>logs</a></nav>"
            f"<section id='{safe}'></section></body></html>"
        )

    def not_found_page(self) -> str:
        # Static: never echoes the requested path.
        return (
            "<!doctype html><html><head><meta charset='utf-8'>"
            "<title>404 Not Found</title></head><body>"
            "<h1>404 Not Found</h1></body></html>"
        )


def fetch_config(agent_url: str) -> dict:
    resp = httpx.get(f"{agent_url}/config", timeout=5.0)
    resp.raise_for_status()
    return resp.json()


def main() -> None:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s"
    )
    agent_url = os.environ.get("HF_AGENT_URL", "http://agent-medium:9000")
    poll_interval = float(os.environ.get("HF_DECOY_POLL_INTERVAL", "15"))

    global INGEST_ENDPOINT, INGEST_SECRET
    INGEST_ENDPOINT = f"{agent_url}/ingest"
    INGEST_SECRET = os.environ.get("HF_AGENT_INGEST_SECRET", "")

    decoy: AdminDecoy | None = None
    current_version: int | None = None
    while True:
        try:
            cfg = fetch_config(agent_url)
        except Exception:  # noqa: BLE001
            log.warning("config fetch failed; retrying in %.0fs", poll_interval, exc_info=True)
            time.sleep(poll_interval)
            continue

        if not cfg or cfg.get("interaction_level") != "medium":
            log.info("no medium config yet: %s", cfg)
        elif cfg.get("config_version") != current_version:
            if decoy is None:
                decoy = AdminDecoy([DEFAULT_PORT])
            decoy.apply_config(cfg.get("config", {}))
            log.info(
                "listening on ports=%s title=%r login_enabled=%s (config v%s)",
                decoy.bound_ports,
                decoy.title,
                decoy.login_enabled,
                cfg["config_version"],
            )
            current_version = cfg["config_version"]
        time.sleep(poll_interval)


if __name__ == "__main__":
    main()
