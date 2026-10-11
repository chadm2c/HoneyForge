import httpx

from config_client import AgentConfig, ConfigClient


def test_fetch_parses_config(httpx_mock):
    httpx_mock.add_response(
        json={
            "honeypot_id": "x",
            "config_version": 3,
            "interaction_level": "low",
            "config": {"ports": [2222]},
        }
    )
    c = ConfigClient("http://center", "tok")
    cfg = c.fetch_config()
    assert isinstance(cfg, AgentConfig)
    assert cfg.config_version == 3
    assert cfg.config["ports"] == [2222]


def test_version_changed_tracks_applied_version(httpx_mock):
    httpx_mock.add_response(
        json={"honeypot_id": "x", "config_version": 3, "interaction_level": "low", "config": {}}
    )
    c = ConfigClient("http://center", "tok")
    cfg = c.fetch_config()
    # Nothing applied yet: the first config is always a change.
    assert c.version_changed(cfg) is True
    c.applied_version = 3
    assert c.version_changed(cfg) is False
    newer = AgentConfig(honeypot_id="x", config_version=4, interaction_level="low", config={})
    assert c.version_changed(newer) is True


def test_fetch_retries_then_succeeds(httpx_mock):
    httpx_mock.add_exception(httpx.ConnectError("down"))
    httpx_mock.add_response(
        json={"honeypot_id": "x", "config_version": 5, "interaction_level": "low", "config": {}}
    )
    c = ConfigClient("http://center", "tok", delay_fn=lambda _attempt: 0.0)
    cfg = c.fetch_config()
    assert cfg.config_version == 5