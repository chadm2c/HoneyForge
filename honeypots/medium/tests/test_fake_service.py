"""Unit tests for the Medium-interaction fake HTTP admin decoy.

Tested in-process with a real ThreadingHTTPServer on an ephemeral port and a
fake event sink -- never the live agent (the decoy->agent hop is best-effort).
"""

import json
import logging
import socket
import time
from contextlib import contextmanager

import httpx

from fake_service import SYNTHETIC_PASSWORD, SYNTHETIC_USERNAME, AdminDecoy

HOST = "127.0.0.1"


@contextmanager
def running_decoy(
    ports=(0,),
    title="Admin Panel",
    login_enabled=True,
    on_event=None,
    request_timeout=1.0,
):
    decoy = AdminDecoy(
        list(ports),
        title=title,
        login_enabled=login_enabled,
        on_event=on_event,
        request_timeout=request_timeout,
    )
    decoy.start()
    try:
        yield decoy
    finally:
        decoy.close()


def base_url(decoy) -> str:
    return f"http://{HOST}:{decoy.bound_ports[0]}"


# --- Unit A: routes and the synthetic (decorative) session -----------------


def test_login_page_renders_configured_title():
    posted = []
    with running_decoy(title="Acme Admin", on_event=posted.append) as decoy:
        r = httpx.get(base_url(decoy) + "/")
    assert r.status_code == 200
    assert "Acme Admin" in r.text
    assert len(posted) == 1
    assert posted[0]["event_type"] == "http_request"


def test_correct_pair_sets_cookie_and_opens_dashboard():
    posted = []
    with running_decoy(on_event=posted.append) as decoy:
        r = httpx.post(
            base_url(decoy) + "/login",
            data={"username": SYNTHETIC_USERNAME, "password": SYNTHETIC_PASSWORD},
        )
        assert r.cookies.get("hf_admin")  # decorative dummy cookie
        dash = httpx.get(base_url(decoy) + "/dashboard", cookies=r.cookies)
    assert dash.status_code == 200
    auth = [e for e in posted if e["event_type"] == "auth_attempt"]
    assert auth and auth[0]["details"]["success"] is True


def test_wrong_pair_reports_failure():
    posted = []
    with running_decoy(on_event=posted.append) as decoy:
        httpx.post(
            base_url(decoy) + "/login",
            data={"username": SYNTHETIC_USERNAME, "password": "definitely-wrong"},
        )
    auth = [e for e in posted if e["event_type"] == "auth_attempt"]
    assert auth and auth[0]["details"]["success"] is False


def test_dashboard_without_cookie_redirects_to_root():
    posted = []
    with running_decoy(on_event=posted.append) as decoy:
        r = httpx.get(base_url(decoy) + "/dashboard", follow_redirects=False)
    assert r.status_code == 302
    assert r.headers["location"] == "/"


def test_login_disabled_records_path_probe_not_dropped():
    posted = []
    with running_decoy(login_enabled=False, on_event=posted.append) as decoy:
        r = httpx.post(
            base_url(decoy) + "/login",
            data={"username": "x", "password": "y"},
        )
    assert r.status_code == 404
    assert len(posted) == 1
    assert posted[0]["event_type"] == "path_probe"


# --- Unit B: event shape and path/header sanitization ----------------------


def test_known_route_records_http_request_fields():
    posted = []
    with running_decoy(on_event=posted.append) as decoy:
        port = decoy.bound_ports[0]
        httpx.get(base_url(decoy) + "/dashboard")
    assert len(posted) == 1
    ev = posted[0]
    assert ev["event_type"] == "http_request"
    assert ev["protocol"] == "http"
    assert ev["details"]["method"] == "GET"
    assert ev["details"]["path"] == "/dashboard"
    assert ev["details"]["category"] == "dashboard"
    assert ev["target_port"] == port


def test_query_string_is_never_recorded_but_has_query_is_true():
    posted = []
    with running_decoy(on_event=posted.append) as decoy:
        httpx.get(base_url(decoy) + "/?token=SUPERSECRETQUERY")
    assert len(posted) == 1
    ev = posted[0]
    assert ev["details"]["path"] == "/"
    assert ev["details"]["has_query"] is True
    assert "SUPERSECRETQUERY" not in json.dumps(ev)


def test_unknown_path_records_path_probe():
    posted = []
    with running_decoy(on_event=posted.append) as decoy:
        r = httpx.get(base_url(decoy) + "/wp-admin/secret")
    assert r.status_code == 404
    assert len(posted) == 1
    assert posted[0]["event_type"] == "path_probe"
    assert posted[0]["details"]["category"] == "unknown"


def test_not_found_page_does_not_echo_the_path():
    with running_decoy(on_event=lambda event: None) as decoy:
        r = httpx.get(base_url(decoy) + "/no-such-ENDPOINT-xyz")
    assert "ENDPOINT" not in r.text


def test_authorization_and_cookie_values_are_never_recorded():
    posted = []
    with running_decoy(on_event=posted.append) as decoy:
        httpx.get(
            base_url(decoy) + "/dashboard",
            headers={
                "Authorization": "Bearer LEAKME-AUTH",
                "Cookie": "hf_admin=LEAKME-COOKIE",
            },
        )
    blob = json.dumps(posted)
    assert "LEAKME-AUTH" not in blob
    assert "LEAKME-COOKIE" not in blob


# --- Unit C: hostile input -------------------------------------------------


def _send_raw(decoy, raw: bytes) -> bytes:
    s = socket.create_connection((HOST, decoy.bound_ports[0]), timeout=5)
    try:
        s.sendall(raw)
        s.shutdown(socket.SHUT_WR)
        return s.recv(4096)
    finally:
        s.close()


def _still_serving(decoy) -> bool:
    return httpx.get(base_url(decoy) + "/").status_code == 200


def test_oversized_body_gets_413_with_one_event():
    posted = []
    with running_decoy(on_event=posted.append) as decoy:
        r = httpx.post(
            base_url(decoy) + "/login",
            content=b"x" * 9000,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        assert r.status_code == 413
        assert len(posted) == 1
        assert _still_serving(decoy)


def test_bad_content_length_gets_400_with_one_event():
    posted = []
    with running_decoy(on_event=posted.append) as decoy:
        response = _send_raw(
            decoy,
            b"POST /login HTTP/1.0\r\nHost: x\r\nContent-Length: nope\r\n\r\n",
        )
        assert b"400" in response
        assert len(posted) == 1
        assert _still_serving(decoy)


def test_very_long_path_gets_one_event_and_server_survives():
    posted = []
    with running_decoy(on_event=posted.append) as decoy:
        r = httpx.get(base_url(decoy) + "/" + "a" * 4000)
        assert r.status_code == 404
        assert len(posted) == 1
        assert len(posted[0]["details"]["path"]) <= 1024
        assert _still_serving(decoy)


def test_stalled_socket_times_out_with_one_event_and_server_survives():
    posted = []
    with running_decoy(on_event=posted.append, request_timeout=0.5) as decoy:
        s = socket.create_connection((HOST, decoy.bound_ports[0]), timeout=5)
        try:
            s.sendall(b"GET /partial")  # no CRLF -> stalls
            time.sleep(1.2)  # exceed request_timeout
        finally:
            s.close()
        assert len(posted) == 1
        assert posted[0]["event_type"] == "path_probe"
        # The aborted request has no parsed method/path; it must not inherit a
        # stale one from a previous request on the same handler.
        assert posted[0]["details"]["method"] == ""
        assert posted[0]["details"]["path"] == ""
        assert _still_serving(decoy)


def test_unsupported_method_is_recorded_as_path_probe():
    posted = []
    with running_decoy(on_event=posted.append) as decoy:
        r = httpx.request("OPTIONS", base_url(decoy) + "/")
    assert r.status_code == 501
    assert len(posted) == 1
    assert posted[0]["event_type"] == "path_probe"
    assert posted[0]["details"]["method"] == "OPTIONS"
    assert posted[0]["details"]["path"] == "/"


def test_malformed_request_line_does_not_echo_the_marker():
    marker = "LEAKME-BADLINE-777"
    posted = []
    with running_decoy(on_event=posted.append) as decoy:
        response = _send_raw(decoy, f"GET /?password={marker} JUNK HTTP/1.0\r\n\r\n".encode())
    text = response.decode("utf-8", "replace")
    assert "400" in text
    assert marker not in text
    assert len(posted) == 1
    assert marker not in json.dumps(posted)


def test_bad_version_request_does_not_echo_the_token():
    marker = "LEAKME-VERSION-888"
    posted = []
    with running_decoy(on_event=posted.append) as decoy:
        response = _send_raw(decoy, f"GET / HTTP/{marker}\r\n\r\n".encode())
    text = response.decode("utf-8", "replace")
    assert "400" in text
    assert marker not in text
    assert marker not in json.dumps(posted)


# --- Unit D: the submitted password never leaves the request ---------------


def _decoy_log_text(caplog) -> str:
    """Only the decoy's own log records -- the test client (httpx) logs URLs too."""
    return "\n".join(
        record.getMessage() for record in caplog.records if record.name.startswith("honeyforge")
    )


def test_form_password_is_recorded_only_as_length(caplog):
    secret = "P@ssw0rd-LEAKME-form"
    posted = []
    with running_decoy(on_event=posted.append) as decoy:
        with caplog.at_level(logging.INFO):
            r = httpx.post(
                base_url(decoy) + "/login",
                data={"username": SYNTHETIC_USERNAME, "password": secret},
            )
    auth = [e for e in posted if e["event_type"] == "auth_attempt"]
    assert auth
    assert auth[0]["details"]["password_length"] == len(secret)
    assert secret not in json.dumps(posted)
    assert secret not in r.text
    assert secret not in _decoy_log_text(caplog)


def test_query_string_password_absent_from_event_streams_and_response(capfd, caplog):
    secret = "LEAKME-QUERY-SECRET-987"
    posted = []
    with running_decoy(on_event=posted.append) as decoy:
        with caplog.at_level(logging.INFO):
            r = httpx.post(base_url(decoy) + "/login?password=" + secret, content=b"")
        out = capfd.readouterr()
    assert secret not in json.dumps(posted)
    assert secret not in r.text
    assert secret not in _decoy_log_text(caplog)
    assert secret not in out.out
    assert secret not in out.err


def test_json_body_login_always_fails_and_leaks_nothing():
    posted = []
    with running_decoy(on_event=posted.append) as decoy:
        httpx.post(
            base_url(decoy) + "/login",
            json={"username": SYNTHETIC_USERNAME, "password": SYNTHETIC_PASSWORD},
        )
    auth = [e for e in posted if e["event_type"] == "auth_attempt"]
    assert auth
    # The fake form posts form-encoded; a JSON body is not an interpreted login,
    # so even the correct synthetic pair fails.
    assert auth[0]["details"]["success"] is False
    assert SYNTHETIC_PASSWORD not in json.dumps(posted)


# --- Unit E: config reapply -------------------------------------------------


def test_apply_config_rebinds_same_port_and_serves_new_title():
    posted = []
    decoy = AdminDecoy([0], title="v1", on_event=posted.append)
    decoy.start()
    try:
        port = decoy.bound_ports[0]
        decoy.apply_config({"ports": [port], "title": "v2", "login_enabled": True})
        assert decoy.bound_ports == [port]  # same port, no "address in use"
        r = httpx.get(f"http://{HOST}:{port}/")
        assert "v2" in r.text
    finally:
        decoy.close()


def test_apply_config_can_disable_login():
    posted = []
    decoy = AdminDecoy([0], on_event=posted.append)
    decoy.start()
    try:
        port = decoy.bound_ports[0]
        decoy.apply_config({"ports": [port], "title": "t", "login_enabled": False})
        r = httpx.post(
            f"http://{HOST}:{port}/login",
            data={"username": "a", "password": "b"},
        )
        assert r.status_code == 404
    finally:
        decoy.close()
