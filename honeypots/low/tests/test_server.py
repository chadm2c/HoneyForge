import socket
import time
from contextlib import contextmanager

from server import DecoyServer

HOST = "127.0.0.1"


def _wait_until(cond, timeout: float = 4.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if cond():
            return
        time.sleep(0.05)
    raise TimeoutError("condition not met in time")


@contextmanager
def running_decoy(ports, banner="B", on_event=None):
    decoy = DecoyServer(ports, banner, on_event=on_event)
    decoy.start()
    try:
        yield decoy
    finally:
        decoy.close()


def connect_and_read_banner(port: int) -> str:
    s = socket.create_connection((HOST, port), timeout=5)
    try:
        return s.recv(1024).decode("utf-8", errors="replace")
    finally:
        s.close()


def test_connection_emits_event():
    posted = []

    def fake_post(event):
        posted.append(event)

    with running_decoy(ports=[0], banner="SSH-2.0-OpenSSH_8.9", on_event=fake_post) as decoy:
        port = decoy.bound_ports[0]
        banner = connect_and_read_banner(port)

    assert banner.startswith("SSH-2.0-OpenSSH_8.9")
    assert posted
    assert posted[0]["event_type"] == "connection"
    assert posted[0]["protocol"] == "tcp"
    assert posted[0]["source_ip"] == HOST
    assert posted[0]["target_port"] == port
    assert "occurred_at" in posted[0]


def test_large_probe_does_not_crash():
    posted = []

    def fake_post(event):
        posted.append(event)

    with running_decoy(ports=[0], banner="B", on_event=fake_post) as decoy:
        port = decoy.bound_ports[0]
        s = socket.create_connection((HOST, port), timeout=5)
        try:
            s.sendall(b"x" * (1024 * 1024))
        finally:
            s.close()
        _wait_until(lambda: len(posted) >= 1)
        # The same listener is still up after the garbage probe.
        assert connect_and_read_banner(port).startswith("B")

    assert len(posted) >= 2