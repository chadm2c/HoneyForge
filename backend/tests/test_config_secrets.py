"""A default honeyforge stack must not sign operator tokens with a published key.

`create_app` warns when `JWT_SECRET` is still a documented placeholder. That is
only useful if the placeholders it knows about cover the value the stack
actually ships with -- `Settings.jwt_secret`'s default (no `.env`), the value in
`.env.example` (the documented copy-to-`.env` path), and compose's
`${JWT_SECRET:-...}` fallback. These tests keep those three from drifting apart.
"""

import logging
import os
from pathlib import Path

import pytest

from app.core.config import DEV_JWT_SECRETS, Settings, settings
from app.main import create_app

# backend/tests/ -> backend/ -> repo root. The canonical in-container test run
# mounts backend/ alone, so HF_REPO_ROOT points at a checkout when one is
# available (host, CI, or `-e HF_REPO_ROOT=/repo -v <repo>:/repo`); otherwise the
# drift checks below skip rather than fail.
REPO_ROOT = Path(
    os.environ.get("HF_REPO_ROOT") or Path(__file__).resolve().parents[2]
)


def test_settings_default_is_a_known_placeholder():
    # A stack with no .env (compose's `${JWT_SECRET:-...}` fallback) runs on the
    # value the environment carries here, so it must be recognized.
    assert Settings().jwt_secret in DEV_JWT_SECRETS


@pytest.mark.parametrize("secret", sorted(DEV_JWT_SECRETS))
def test_placeholder_secret_warns(monkeypatch, caplog, secret):
    monkeypatch.setattr(settings, "jwt_secret", secret)
    with caplog.at_level(logging.WARNING):
        create_app()
    assert any("placeholder" in record.message for record in caplog.records)


def test_real_secret_does_not_warn(monkeypatch, caplog):
    monkeypatch.setattr(settings, "jwt_secret", "s3cret-" + "0" * 40)
    with caplog.at_level(logging.WARNING):
        create_app()
    assert not [r for r in caplog.records if "placeholder" in r.message]


@pytest.mark.skipif(
    not (REPO_ROOT / "docker-compose.yml").exists(),
    reason="repo root is not mounted in the in-container test run",
)
def test_shipped_defaults_are_known_placeholders():
    env_example = (REPO_ROOT / ".env.example").read_text(encoding="utf-8")
    jwt_line = next(
        line for line in env_example.splitlines() if line.startswith("JWT_SECRET=")
    )
    assert jwt_line.split("=", 1)[1].split("#")[0].strip() in DEV_JWT_SECRETS

    compose = (REPO_ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    marker = "${JWT_SECRET:-"
    start = compose.index(marker) + len(marker)
    assert compose[start : compose.index("}", start)] in DEV_JWT_SECRETS
