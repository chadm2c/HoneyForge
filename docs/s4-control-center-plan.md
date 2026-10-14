# S4 Control Center (API + Minimal UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the S2 static operator token with real JWT operator auth + roles, add profile CRUD, controlled honeypot registration, fleet status, event search, and an operator audit trail — plus the five-page minimal UI that uses them.

**Architecture:** Extend the existing FastAPI layering (thin routers → services → SQLAlchemy models). Auth becomes bcrypt + JWT (HS256) with layered dependencies (`require_operator`, `require_admin`). The React SPA gains `react-router-dom`, an `AuthContext` holding a JWT from `localStorage`, and one page per screen. No database migration: the five tables already exist.

**Tech Stack:** Python 3.11 / FastAPI / Pydantic v2 / SQLAlchemy 2.x / PyJWT / bcrypt / PostgreSQL; React 19 + TypeScript + Vite + Tailwind + react-router-dom; pytest, vitest.

**Spec:** `docs/s4-control-center-design.md`

## Global Constraints

- Python 3.11+; FastAPI + Pydantic v2 for all validation; SQLAlchemy 2.x typed style (`Mapped[...]`, `mapped_column`).
- **No Alembic migration in S4.** The five tables (`operators`, `profiles`, `honeypots`, `attack_events`, `audit_logs`) already exist. `alembic upgrade head` must still report head.
- All timestamps UTC. `occurred_at` (decoy observed) and `received_at` (center accepted) stay distinct.
- **Never store or log a plaintext password or agent token.** Only bcrypt hashes and HMAC token hashes are persisted; audit rows carry identifiers and timestamps only.
- JWT is HS256, secret from `JWT_SECRET`, lifetime `JWT_EXPIRES_MINUTES` (default 60). Claims: `sub` (operator id), `role`, `iat`, `exp`, `jti`.
- Passwords are capped at bcrypt's 72-byte input limit; longer input is rejected (never silently truncated).
- Roles: `admin` = full; `analyst` = read-only. All writes require `require_admin`.
- Test data uses reserved documentation IPs only (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`).
- Windows host, PowerShell. Chain commands with `;`, never `&&`.
- Backend/agent tests: `docker compose run --rm backend pytest`. For a fast iteration loop, bind-mount the source: `docker compose run --rm -v "$($PWD.Path)/backend:/app" backend pytest <args>`.
- Frontend: `cd frontend; npm test -- <path>`; type-check with `cd frontend; npx tsc --noEmit`.
- Keep ruff clean on backend changes (`docker compose run --rm backend ruff check app tests`).
- Existing suites must stay green: backend (26 → grows), frontend (1 → grows).

## Review Focus

The spec implies these; no single task's happy path exercises them. Each is pinned to a test in the task that owns the code, most likely to bite first:

1. **A password longer than 72 bytes** — bcrypt silently truncates, so a 73-byte password would verify as equal to its 72-byte prefix. Login must reject it (Task 2), not accept it.
2. **A forged / expired / `alg:none` JWT** — must be 401 on every protected route and a 1008 close on the WebSocket, never accepted (Task 2).
3. **Login as an unknown username** — must return the *same* 401 body as a wrong password and write a `login_failed` audit row without creating an operator or leaking that the username is unknown (Task 3).
4. **A `q` search containing `%` or `_`** — ILIKE wildcards must be escaped so `q=%` does not match every row (Task 6).
5. **Deleting a profile that a honeypot references** — must 409 and leave both rows intact; never cascade the honeypot away or orphan the FK (Task 4).

Also pinned during the owning task: the fleet `online`/`offline` boundary at exactly the threshold (Task 5).

---

### Task 1: Auth primitives (bcrypt + JWT)

**Files:**
- Modify: `backend/pyproject.toml` (add `pyjwt`, `bcrypt` to `dependencies`)
- Modify: `backend/app/core/config.py`
- Modify: `backend/app/core/security.py`
- Test: `backend/tests/test_passwords.py` (new), `backend/tests/test_tokens.py` (new)

**Interfaces:**
- Consumes: `settings` (existing singleton).
- Produces:
  - `security.hash_password(password: str) -> str`
  - `security.verify_password(password: str, password_hash: str) -> bool`
  - `security.create_access_token(subject: str, role: str) -> str`
  - `security.decode_access_token(token: str) -> dict` (raises `jwt.PyJWTError` on any invalid token)
  - `security.MAX_PASSWORD_BYTES = 72`
  - `settings.jwt_secret: str`, `settings.jwt_expires_minutes: int = 60`, `settings.fleet_offline_after_s: int = 45`, `settings.operator_username: str = "admin"`, `settings.operator_password: str = "change-me-operator-password"`, `settings.analyst_username: str = "analyst"`, `settings.analyst_password: str = ""`
  - `config.DEV_JWT_SECRET = "dev-jwt-secret-change-me"`

- [ ] **Step 1: Add the dependencies**

Run: `docker compose run --rm backend pip install pyjwt bcrypt` then add `"pyjwt>=2.8"` and `"bcrypt>=4.1"` to `[project].dependencies` in `backend/pyproject.toml` (alphabetical position with the others).

- [ ] **Step 2: Write the failing password tests**

```python
# backend/tests/test_passwords.py
import pytest

from app.core import security


def test_hash_is_not_plaintext_and_verifies():
    h = security.hash_password("correct-horse")
    assert h != "correct-horse"
    assert "correct-horse" not in h
    assert security.verify_password("correct-horse", h)
    assert not security.verify_password("wrong", h)


def test_two_hashes_of_the_same_password_differ():
    # bcrypt salts: the seed relies on this to detect "already set" cheaply.
    assert security.hash_password("pw") != security.hash_password("pw")


def test_verify_rejects_a_malformed_hash():
    # The S2 placeholder hash is not bcrypt; it must verify False, not raise.
    assert security.verify_password("pw", "not-a-bcrypt-hash") is False
```

- [ ] **Step 3: Run the password tests to verify they fail**

Run: `docker compose run --rm backend pytest tests/test_passwords.py -q`
Expected: FAIL — `AttributeError: module 'app.core.security' has no attribute 'hash_password'`.

- [ ] **Step 4: Implement password hashing in `backend/app/core/security.py`**

Add `import bcrypt` and:

```python
MAX_PASSWORD_BYTES = 72


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("ascii")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("ascii"))
    except (ValueError, TypeError):
        return False
```

- [ ] **Step 5: Run the password tests to verify they pass**

Run: `docker compose run --rm backend pytest tests/test_passwords.py -q`
Expected: PASS (3 passed).

- [ ] **Step 6: Write the failing JWT + settings tests**

```python
# backend/tests/test_tokens.py
import pytest
from pydantic import ValidationError

from app.core import security
from app.core.config import Settings


def test_token_round_trip_carries_subject_and_role():
    token = security.create_access_token("11111111-1111-4111-8111-111111111111", "admin")
    claims = security.decode_access_token(token)
    assert claims["sub"] == "11111111-1111-4111-8111-111111111111"
    assert claims["role"] == "admin"
    assert claims["exp"] > claims["iat"]
    assert claims["jti"]


def test_token_rejects_a_tampered_signature():
    token = security.create_access_token("11111111-1111-4111-8111-111111111111", "admin")
    with pytest.raises(Exception):
        security.decode_access_token(token[:-2] + "xy")


def test_token_rejects_the_none_algorithm():
    # A JWT with alg=none (unsigned) must never validate.
    unsigned = (
        "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0."
        "eyJzdWIiOiIxIiwicm9sZSI6ImFkbWluIn0."
    )
    with pytest.raises(Exception):
        security.decode_access_token(unsigned)


def test_expired_token_is_rejected():
    import jwt as pyjwt

    token = pyjwt.encode(
        {"sub": "1", "role": "admin", "exp": 1},
        Settings().jwt_secret,
        algorithm="HS256",
    )
    with pytest.raises(Exception):
        security.decode_access_token(token)


def test_blank_jwt_secret_is_rejected():
    with pytest.raises(ValidationError):
        Settings(jwt_secret="")
```

- [ ] **Step 7: Run the token tests to verify they fail**

Run: `docker compose run --rm backend pytest tests/test_tokens.py -q`
Expected: FAIL — `settings` has no `jwt_secret` / `security` has no `create_access_token`.

- [ ] **Step 8: Add settings + JWT functions**

In `backend/app/core/config.py` add to `Settings` (below the existing fields) and add the module constant above the class:

```python
DEV_JWT_SECRET = "dev-jwt-secret-change-me"
```

```python
    jwt_secret: str = DEV_JWT_SECRET
    jwt_expires_minutes: int = 60
    fleet_offline_after_s: int = 45
    operator_username: str = "admin"
    operator_password: str = "change-me-operator-password"
    analyst_username: str = "analyst"
    analyst_password: str = ""

    @field_validator("jwt_secret")
    @classmethod
    def _jwt_secret_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("JWT_SECRET must not be blank")
        return v
```

In `backend/app/core/security.py` add `import uuid`, `from datetime import datetime, timedelta, timezone`, `import jwt`, and:

```python
def create_access_token(subject: str, role: str) -> str:
    now = datetime.now(timezone.utc)
    claims = {
        "sub": subject,
        "role": role,
        "iat": now,
        "exp": now + timedelta(minutes=settings.jwt_expires_minutes),
        "jti": uuid.uuid4().hex,
    }
    return jwt.encode(claims, settings.jwt_secret, algorithm="HS256")


def decode_access_token(token: str) -> dict:
    # algorithms is pinned to HS256 so an alg=none/alg=RS256 token can never pass.
    return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"], options={"require": ["exp", "sub"]})
```

- [ ] **Step 9: Run the token tests to verify they pass**

Run: `docker compose run --rm backend pytest tests/test_tokens.py tests/test_passwords.py tests/test_security.py -q`
Expected: PASS (all).

- [ ] **Step 10: Commit**

```bash
git add backend/pyproject.toml backend/app/core/config.py backend/app/core/security.py backend/tests/test_passwords.py backend/tests/test_tokens.py
git commit -m "feat(auth): add bcrypt password hashing and HS256 JWT primitives"
```

---

### Task 2: Wire real operator auth (login, me, dependencies, WS, seed, config)

**Deliverable:** `POST /api/auth/login` + `GET /api/auth/me`; `require_operator` returns the `Operator` and validates the JWT; `require_admin` layers on it; the WebSocket validates the JWT; the seed stores bcrypt hashes and adds an `analyst`; `/api/operator/whoami` is removed; `.env.example` + Compose carry the new env. All existing suites updated and green.

**Files:**
- Create: `backend/app/schemas/auth.py`, `backend/app/api/auth.py`
- Modify: `backend/app/api/deps.py`, `backend/app/api/ws.py`, `backend/app/main.py`, `backend/app/seed.py`, `backend/tests/conftest.py`, `backend/tests/test_events_query.py`, `backend/tests/test_agent_auth.py`, `backend/tests/test_ws.py`, `backend/tests/test_seed.py`, `.env.example`, `docker-compose.yml`
- Test: `backend/tests/test_auth.py` (new)

**Interfaces:**
- Consumes: `security.create_access_token`, `security.decode_access_token`, `security.verify_password`, `security.hash_password`, `security.MAX_PASSWORD_BYTES` (Task 1).
- Produces:
  - `schemas.auth.LoginIn`, `schemas.auth.OperatorOut`, `schemas.auth.TokenOut`
  - `deps.require_operator(...) -> Operator`, `deps.require_admin(...) -> Operator`
  - `seed.seed_demo(db, *, agent_token: str, operator_password: str, medium_agent_token: str | None = None, operator_username: str = "admin", analyst_username: str = "analyst", analyst_password: str | None = None) -> dict` (keys: `operator`, `profile`, `honeypot`, optional `medium_profile`, `medium_honeypot`, `analyst`)
  - `conftest.operator_factory(role="admin", username="op", password="correct-horse") -> tuple[Operator, str, str]` (operator, password, jwt) — test-only

- [ ] **Step 1: Write the failing auth endpoint tests**

```python
# backend/tests/test_auth.py
from tests.helpers import auth


def test_login_returns_a_usable_token(client, operator_factory):
    op, password, _ = operator_factory(username="alice", password="hunter2")
    r = client.post("/api/auth/login", json={"username": "alice", "password": "hunter2"})
    assert r.status_code == 200
    body = r.json()
    assert body["token_type"] == "bearer"
    assert body["expires_in"] == 60
    assert body["operator"] == {"id": str(op.id), "username": "alice", "role": "admin"}
    me = client.get("/api/auth/me", headers=auth(body["access_token"]))
    assert me.status_code == 200 and me.json()["username"] == "alice"


def test_login_wrong_password_and_unknown_user_are_indistinguishable(client, operator_factory):
    op, _, _ = operator_factory(username="bob", password="hunter2")
    wrong = client.post("/api/auth/login", json={"username": "bob", "password": "nope"})
    unknown = client.post("/api/auth/login", json={"username": "nobody", "password": "nope"})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()  # no user enumeration


def test_login_rejects_a_password_longer_than_72_bytes(client, operator_factory):
    operator_factory(username="carol", password="x" * 72)
    r = client.post("/api/auth/login", json={"username": "carol", "password": "x" * 73})
    assert r.status_code == 422


def test_me_requires_a_token(client):
    assert client.get("/api/auth/me").status_code == 401


def test_forged_token_is_401(client, operator_factory):
    import jwt as pyjwt

    operator_factory()
    forged = pyjwt.encode({"sub": "1", "role": "admin", "exp": 9999999999}, "wrong-secret", algorithm="HS256")
    assert client.get("/api/auth/me", headers=auth(forged)).status_code == 401


def test_expired_token_is_401(client):
    import jwt as pyjwt

    from app.core.config import settings

    expired = pyjwt.encode({"sub": "1", "role": "admin", "exp": 1}, settings.jwt_secret, algorithm="HS256")
    assert client.get("/api/auth/me", headers=auth(expired)).status_code == 401


def test_token_for_an_unknown_operator_is_401(client):
    from app.core.security import create_access_token

    token = create_access_token("11111111-1111-4111-8111-111111111111", "admin")
    assert client.get("/api/auth/me", headers=auth(token)).status_code == 401
```

- [ ] **Step 2: Run the auth tests to verify they fail**

Run: `docker compose run --rm backend pytest tests/test_auth.py -q`
Expected: FAIL — 404 on `/api/auth/login`, and `fixture 'operator_factory' not found`.

- [ ] **Step 3: Add the `operator_factory` fixture to `backend/tests/conftest.py`**

Import `Operator` (add to the existing `from app.models import ...`) and `hash_password`, `create_access_token`. Add:

```python
@pytest.fixture
def operator_factory(db):
    def make(role="admin", username="op", password="correct-horse"):
        op = Operator(username=username, password_hash=hash_password(password), role=role)
        db.add(op)
        db.commit()
        return op, password, create_access_token(str(op.id), op.role)

    return make
```

- [ ] **Step 4: Add the auth schemas**

```python
# backend/app/schemas/auth.py
import uuid

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.security import MAX_PASSWORD_BYTES


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=1)

    @field_validator("password")
    @classmethod
    def _within_bcrypt_limit(cls, v: str) -> str:
        if len(v.encode("utf-8")) > MAX_PASSWORD_BYTES:
            raise ValueError(f"password must be at most {MAX_PASSWORD_BYTES} bytes")
        return v


class OperatorOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    username: str
    role: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    operator: OperatorOut
```

- [ ] **Step 5: Replace the operator seam in `backend/app/api/deps.py`**

Remove the `hmac` import, the `settings`/`dev_operator_token` use, and rewrite `require_operator`; add `require_admin`. Keep `_bearer_token` and `get_current_agent` unchanged.

```python
def require_operator(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> Operator:
    """Resolve the bearer JWT to its Operator row. 401 on any invalid token."""
    token = _bearer_token(authorization)
    try:
        claims = decode_access_token(token)
        operator_id = uuid.UUID(str(claims["sub"]))
    except (jwt.PyJWTError, KeyError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    operator = db.get(Operator, operator_id)
    if operator is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return operator


def require_admin(operator: Operator = Depends(require_operator)) -> Operator:
    if operator.role != "admin":
        raise HTTPException(status_code=403, detail="Admin role required")
    return operator
```

Add `import jwt`, `import uuid`, and import `Operator` from `app.models`.

- [ ] **Step 6: Add the auth router**

```python
# backend/app/api/auth.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_operator
from app.core.config import settings
from app.core.security import create_access_token, verify_password
from app.db.session import get_db
from app.models import Operator
from app.schemas.auth import LoginIn, OperatorOut, TokenOut

router = APIRouter(prefix="/api/auth", tags=["auth"])

_INVALID = "Invalid username or password"


@router.post("/login", response_model=TokenOut)
def login(body: LoginIn, db: Session = Depends(get_db)) -> TokenOut:
    operator = db.scalar(select(Operator).where(Operator.username == body.username))
    if operator is None or not verify_password(body.password, operator.password_hash):
        raise HTTPException(status_code=401, detail=_INVALID)
    token = create_access_token(str(operator.id), operator.role)
    return TokenOut(
        access_token=token,
        expires_in=settings.jwt_expires_minutes * 60,
        operator=OperatorOut.model_validate(operator),
    )


@router.get("/me", response_model=OperatorOut)
def me(operator: Operator = Depends(require_operator)) -> OperatorOut:
    return OperatorOut.model_validate(operator)
```

Note the identical 401 for unknown user and wrong password (Review Focus #3; Task 3 adds the audit writes).

- [ ] **Step 7: Point the WebSocket at the JWT**

In `backend/app/api/ws.py`, drop the `hmac`/`settings` imports and replace the auth expression with:

```python
    try:
        claims = decode_access_token(raw_token) if isinstance(raw_token, str) else None
    except Exception:
        claims = None
    authed = (
        isinstance(first, dict)
        and first.get("type") == "auth"
        and claims is not None
        and "sub" in claims
    )
```

- [ ] **Step 8: Register the router and drop the dev route in `backend/app/main.py`**

Delete the `/api/operator/whoami` block and the now-unused `require_operator`/`Depends` imports if nothing else uses them; add `from app.api.auth import router as auth_router` and `app.include_router(auth_router)`.

- [ ] **Step 9: Rewrite the seed for bcrypt + analyst**

In `backend/app/seed.py`: import `hash_password`, `verify_password`. Add `_upsert_operator(db, username, password, role)` that creates the operator or re-hashes only when `not verify_password(password, existing.password_hash)` (keeps re-seed idempotent). Change `seed_demo` to the keyword signature in Interfaces, returning `operator` + optional `analyst` keys, and update `__main__` to read `OPERATOR_USERNAME`/`OPERATOR_PASSWORD`/`ANALYST_USERNAME`/`ANALYST_PASSWORD` from the environment.

- [ ] **Step 10: Update the tests that used the static token**

- `backend/tests/test_events_query.py`: take a token from `operator_factory` instead of `settings.dev_operator_token`.
- `backend/tests/test_agent_auth.py`: replace the two `/api/operator/whoami` cases with `/api/auth/me` (agent token → 401, operator JWT → 200).
- `backend/tests/test_ws.py`: authenticate with `create_access_token` output (from a `operator_factory` result) instead of `settings.dev_operator_token`; add `test_ws_rejects_a_forged_token` (close 1008).
- `backend/tests/test_seed.py`: use `seed_demo(db, agent_token="tok-a", operator_password="pw")`; assert `verify_password("pw", out["operator"].password_hash)`; add a case asserting a second `seed_demo` does **not** change the stored hash (idempotent) and that passing `analyst_password="apw"` creates exactly one extra `analyst` operator.

- [ ] **Step 11: Update `.env.example` and `docker-compose.yml`**

`.env.example`: delete the `DEV_OPERATOR_TOKEN` line and the frontend `VITE_OPERATOR_TOKEN` line; add under "Backend":

```
JWT_SECRET=change-me-jwt-signing-secret
JWT_EXPIRES_MINUTES=60
OPERATOR_USERNAME=admin
OPERATOR_PASSWORD=change-me-operator-password
ANALYST_USERNAME=analyst
ANALYST_PASSWORD=change-me-analyst-password
FLEET_OFFLINE_AFTER_S=45
```

`docker-compose.yml`: in `backend.environment`, drop `DEV_OPERATOR_TOKEN` and add `JWT_SECRET`, `JWT_EXPIRES_MINUTES`, `OPERATOR_USERNAME`, `OPERATOR_PASSWORD`, `ANALYST_USERNAME`, `ANALYST_PASSWORD`, `FLEET_OFFLINE_AFTER_S` (all `${VAR:-default}`). In `frontend.environment`, drop `VITE_OPERATOR_TOKEN`.

- [ ] **Step 12: Run the full backend suite**

Run: `docker compose run --rm backend pytest -q`
Expected: PASS — `test_auth.py` green and every previously-passing test green (the static-token tests now use JWTs).

- [ ] **Step 13: Commit**

```bash
git add backend .env.example docker-compose.yml
git commit -m "feat(auth): real operator JWT login, roles, WS auth, bcrypt seed"
```

---

### Task 3: Audit service, login auditing, and `GET /api/audit-logs`

**Files:**
- Create: `backend/app/services/audit_service.py`, `backend/app/schemas/audit.py`, `backend/app/api/audit.py`
- Modify: `backend/app/api/auth.py`, `backend/app/main.py`
- Test: `backend/tests/test_audit_api.py` (new)

**Interfaces:**
- Consumes: `require_operator` (Task 2), `require_admin` (Task 2).
- Produces:
  - `audit_service.record(db, *, operator_id: uuid.UUID | None, action: str, resource_type: str, resource_id: uuid.UUID | None = None) -> AuditLog` (adds + commits)
  - `audit_service.AuditFilters` (fields `operator_id`, `action`, `resource_type`, `since`, `until`)
  - `audit_service.list_audit_logs(db, filters, limit=50, offset=0) -> tuple[list[AuditLog], int]` (newest first)
  - `schemas.audit.AuditLogOut`, `schemas.audit.AuditLogPage`

- [ ] **Step 1: Write the failing audit tests**

```python
# backend/tests/test_audit_api.py
from tests.helpers import auth


def _audit_rows(client, token, **params):
    return client.get("/api/audit-logs", headers=auth(token), params=params).json()


def test_login_writes_an_audit_row(client, operator_factory):
    op, password, token = operator_factory(username="alice", password="hunter2")
    client.post("/api/auth/login", json={"username": "alice", "password": "hunter2"})
    body = _audit_rows(client, token, action="login")
    assert body["total"] == 1
    row = body["items"][0]
    assert row["operator_id"] == str(op.id)
    assert row["resource_type"] == "operator"
    assert row["resource_id"] == str(op.id)


def test_failed_login_is_audited_without_an_operator(client, operator_factory):
    _, _, token = operator_factory()
    client.post("/api/auth/login", json={"username": "ghost", "password": "nope"})
    body = _audit_rows(client, token, action="login_failed")
    assert body["total"] == 1
    assert body["items"][0]["operator_id"] is None
    assert body["items"][0]["resource_id"] is None


def test_audit_never_stores_the_password(client, operator_factory):
    op, password, token = operator_factory(username="alice", password="utterly-unique-secret")
    client.post("/api/auth/login", json={"username": "alice", "password": "utterly-unique-secret"})
    rows = _audit_rows(client, token)["items"]
    assert all("utterly-unique-secret" not in str(row) for row in rows)


def test_audit_filters_and_pagination(client, operator_factory):
    _, _, token = operator_factory()
    for _ in range(3):
        client.post("/api/auth/login", json={"username": "ghost", "password": "x"})
    page = _audit_rows(client, token, resource_type="operator", limit=2, offset=0)
    assert page["total"] == 3 and len(page["items"]) == 2
    assert page["items"][0]["id"] > page["items"][1]["id"]  # newest first


def test_audit_requires_a_token(client):
    assert client.get("/api/audit-logs").status_code == 401
```

- [ ] **Step 2: Run the audit tests to verify they fail**

Run: `docker compose run --rm backend pytest tests/test_audit_api.py -q`
Expected: FAIL — 404 on `/api/audit-logs`.

- [ ] **Step 3: Implement `backend/app/services/audit_service.py`**

```python
def record(db, *, operator_id, action, resource_type, resource_id=None) -> AuditLog:
    row = AuditLog(operator_id=operator_id, action=action, resource_type=resource_type, resource_id=resource_id)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row
```

`AuditFilters` mirrors `EventFilters` (a `BaseModel` of optional fields). `list_audit_logs` applies equality on `operator_id`/`action`/`resource_type` and range on `created_at`, counts, then selects `order_by(AuditLog.id.desc()).limit(limit).offset(offset)`. Same two-step shape as `list_events`.

- [ ] **Step 4: Add the schema and router**

```python
# backend/app/schemas/audit.py
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class AuditLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    operator_id: uuid.UUID | None
    action: str
    resource_type: str
    resource_id: uuid.UUID | None
    created_at: datetime


class AuditLogPage(BaseModel):
    items: list[AuditLogOut]
    total: int
```

`backend/app/api/audit.py`: `router = APIRouter(prefix="/api/audit-logs", tags=["audit"])`; `GET ""` with query params `operator_id`, `action`, `resource_type`, `since`, `until`, `limit` (`Query(default=50, ge=1, le=200)`), `offset` (`ge=0`), guarded by `require_operator`, returning `AuditLogPage`.

- [ ] **Step 5: Audit the login paths**

In `backend/app/api/auth.py`: on failure call `audit_service.record(db, operator_id=None, action="login_failed", resource_type="operator")` before raising the 401; on success call `audit_service.record(db, operator_id=operator.id, action="login", resource_type="operator", resource_id=operator.id)`.

- [ ] **Step 6: Register the router in `backend/app/main.py`**

Add `from app.api.audit import router as audit_router` and `app.include_router(audit_router)`.

- [ ] **Step 7: Run the audit tests to verify they pass**

Run: `docker compose run --rm backend pytest tests/test_audit_api.py tests/test_auth.py -q`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/app/services/audit_service.py backend/app/schemas/audit.py backend/app/api/audit.py backend/app/api/auth.py backend/app/main.py backend/tests/test_audit_api.py
git commit -m "feat(audit): audit service, login auditing, and audit-log query API"
```

---

### Task 4: Profile CRUD with version bump

**Files:**
- Create: `backend/app/schemas/profile.py`, `backend/app/api/profiles.py`
- Modify: `backend/app/services/profile_service.py`, `backend/app/main.py`
- Test: `backend/tests/test_profiles_api.py` (new)

**Interfaces:**
- Consumes: `validate_config` (existing), `audit_service.record` (Task 3), `require_operator`/`require_admin` (Task 2).
- Produces:
  - `profile_service.list_profiles(db) -> list[Profile]`
  - `profile_service.create_profile(db, *, name: str, interaction_level: str, config: dict) -> Profile`
  - `profile_service.delete_profile(db, profile_id) -> None`
  - `schemas.profile.ProfileIn`, `ProfilePatch`, `ProfileOut`, `ProfileSummary`

- [ ] **Step 1: Write the failing profile tests**

```python
# backend/tests/test_profiles_api.py
from tests.helpers import auth

LOW = {"ports": [2222], "banner": "SSH-2.0-OpenSSH_9.0"}


def test_create_requires_admin(client, operator_factory):
    _, _, analyst = operator_factory(role="analyst", username="an")
    r = client.post("/api/profiles", headers=auth(analyst), json={"name": "p", "interaction_level": "low", "config": LOW})
    assert r.status_code == 403


def test_create_list_get_with_version_one(client, operator_factory):
    _, _, admin = operator_factory()
    created = client.post("/api/profiles", headers=auth(admin), json={"name": "p", "interaction_level": "low", "config": LOW})
    assert created.status_code == 201
    body = created.json()
    assert body["version"] == 1 and body["config"]["banner"] == LOW["banner"]
    pid = body["id"]
    listed = client.get("/api/profiles", headers=auth(admin)).json()
    assert [p["name"] for p in listed] == ["p"] and "config" not in listed[0]
    assert client.get(f"/api/profiles/{pid}", headers=auth(admin)).json()["id"] == pid


def test_duplicate_name_is_409(client, operator_factory):
    _, _, admin = operator_factory()
    payload = {"name": "p", "interaction_level": "low", "config": LOW}
    client.post("/api/profiles", headers=auth(admin), json=payload)
    assert client.post("/api/profiles", headers=auth(admin), json=payload).status_code == 409


def test_invalid_config_is_422(client, operator_factory):
    _, _, admin = operator_factory()
    r = client.post("/api/profiles", headers=auth(admin), json={"name": "p", "interaction_level": "low", "config": {"ports": [70000]}})
    assert r.status_code == 422


def test_patch_bumps_version_and_revalidates(client, operator_factory):
    _, _, admin = operator_factory()
    pid = client.post("/api/profiles", headers=auth(admin), json={"name": "p", "interaction_level": "low", "config": LOW}).json()["id"]
    patched = client.patch(f"/api/profiles/{pid}", headers=auth(admin), json={"config": {"ports": [2223], "banner": "x"}})
    assert patched.status_code == 200
    assert patched.json()["version"] == 2 and patched.json()["config"]["ports"] == [2223]
    assert client.patch(f"/api/profiles/{pid}", headers=auth(admin), json={"config": {"ports": [0]}}).status_code == 422


def test_delete_and_conflict_when_in_use(client, operator_factory, db):
    import uuid

    from app.models import Honeypot, Profile

    _, _, admin = operator_factory()
    pid = client.post("/api/profiles", headers=auth(admin), json={"name": "p", "interaction_level": "low", "config": LOW}).json()["id"]
    db.add(Honeypot(name="hp", profile_id=uuid.UUID(pid), agent_token_hash="h"))
    db.commit()
    in_use = client.delete(f"/api/profiles/{pid}", headers=auth(admin))
    assert in_use.status_code == 409
    assert db.get(Profile, uuid.UUID(pid)) is not None
    assert db.query(Honeypot).filter_by(name="hp").count() == 1


def test_delete_then_gone(client, operator_factory):
    _, _, admin = operator_factory()
    pid = client.post("/api/profiles", headers=auth(admin), json={"name": "p", "interaction_level": "low", "config": LOW}).json()["id"]
    assert client.delete(f"/api/profiles/{pid}", headers=auth(admin)).status_code == 204
    assert client.get(f"/api/profiles/{pid}", headers=auth(admin)).status_code == 404


def test_writes_are_audited(client, operator_factory):
    _, _, admin = operator_factory()
    pid = client.post("/api/profiles", headers=auth(admin), json={"name": "p", "interaction_level": "low", "config": LOW}).json()["id"]
    client.patch(f"/api/profiles/{pid}", headers=auth(admin), json={"name": "p2"})
    client.delete(f"/api/profiles/{pid}", headers=auth(admin))
    rows = client.get("/api/audit-logs", headers=auth(admin), params={"resource_type": "profile"}).json()["items"]
    assert [r["action"] for r in rows] == ["profile_deleted", "profile_updated", "profile_created"]
    assert all(r["resource_id"] == pid for r in rows)
```

- [ ] **Step 2: Run the profile tests to verify they fail**

Run: `docker compose run --rm backend pytest tests/test_profiles_api.py -q`
Expected: FAIL — 404 (no `/api/profiles` router).

- [ ] **Step 3: Add the schemas**

```python
# backend/app/schemas/profile.py
import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ProfileIn(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    interaction_level: Literal["low", "medium"]
    config: dict = Field(default_factory=dict)


class ProfilePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    interaction_level: Literal["low", "medium"] | None = None
    config: dict | None = None


class ProfileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    interaction_level: str
    config: dict
    version: int
    created_at: datetime
    updated_at: datetime


class ProfileSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    interaction_level: str
    version: int
    updated_at: datetime
```

- [ ] **Step 4: Add the service functions**

In `backend/app/services/profile_service.py` add `from sqlalchemy import select`, `from sqlalchemy.exc import IntegrityError`, and import `Honeypot` alongside `Profile`:

- `list_profiles(db)` → `list(db.scalars(select(Profile).order_by(Profile.name)))`.
- `create_profile(...)` → validate with `validate_config` (mapping failure to 422, same message shape as `update_profile`), insert with `version=1`, catch `IntegrityError` → `db.rollback()` + `HTTPException(409, "Profile name already exists")`, refresh, return.
- `delete_profile(db, profile_id)` → `get_profile` (404), then 409 if `db.scalar(select(Honeypot).where(Honeypot.profile_id == profile_id))` is not None ("Profile is in use by a honeypot"), else `db.delete(p)` + commit.

- [ ] **Step 5: Add the router**

`backend/app/api/profiles.py`: `router = APIRouter(prefix="/api/profiles", tags=["profiles"])`.

- `GET ""` → `list[ProfileSummary]`, `require_operator`.
- `POST ""` → `ProfileOut`, `status_code=201`, `require_admin`; call `create_profile`, then `audit_service.record(db, operator_id=admin.id, action="profile_created", resource_type="profile", resource_id=p.id)`.
- `GET "/{profile_id}"` → `ProfileOut`, `require_operator` (404 via `get_profile`).
- `PATCH "/{profile_id}"` → `ProfileOut`, `require_admin`; build the patch dict with `body.model_dump(exclude_unset=True)`, call `update_profile`, then audit `profile_updated`.
- `DELETE "/{profile_id}"` → `status_code=204`, `require_admin`; `delete_profile`, then audit `profile_deleted` (record **before** delete returns, using the captured id).

- [ ] **Step 6: Register the router in `backend/app/main.py`**

- [ ] **Step 7: Run the profile tests to verify they pass**

Run: `docker compose run --rm backend pytest tests/test_profiles_api.py -q`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/app/schemas/profile.py backend/app/api/profiles.py backend/app/services/profile_service.py backend/app/main.py backend/tests/test_profiles_api.py
git commit -m "feat(profiles): profile CRUD with validation, version bump, in-use delete guard"
```

---

### Task 5: Honeypot registration + fleet listing with derived status

**Files:**
- Create: `backend/app/schemas/honeypot.py`, `backend/app/api/honeypots.py`
- Modify: `backend/app/services/fleet_service.py`, `backend/app/main.py`
- Test: `backend/tests/test_honeypots_api.py` (new)

**Interfaces:**
- Consumes: `security.generate_agent_token`, `security.hash_agent_token` (existing), `audit_service.record` (Task 3).
- Produces:
  - `fleet_service.derive_status(hp: Honeypot, now: datetime | None = None) -> str` → `"never" | "online" | "offline"`
  - `fleet_service.list_honeypots(db) -> list[Honeypot]`
  - `fleet_service.register_honeypot(db, *, name: str, profile_id: uuid.UUID) -> tuple[Honeypot, str]`
  - `schemas.honeypot.HoneypotRegisterIn`, `HoneypotProfileRef`, `HoneypotOut`, `HoneypotRegisteredOut`

- [ ] **Step 1: Write the failing honeypot tests**

```python
# backend/tests/test_honeypots_api.py
import uuid
from datetime import datetime, timedelta, timezone

from app.core.config import settings
from app.core.security import hash_agent_token
from tests.helpers import auth

LOW = {"ports": [2222], "banner": "SSH-2.0-x"}


def _profile(client, token, name="p"):
    return client.post("/api/profiles", headers=auth(token), json={"name": name, "interaction_level": "low", "config": LOW}).json()["id"]


def test_register_requires_admin(client, operator_factory):
    _, _, admin = operator_factory()
    _, _, analyst = operator_factory(role="analyst", username="an")
    pid = _profile(client, admin)
    r = client.post("/api/honeypots/register", headers=auth(analyst), json={"name": "hp", "profile_id": pid})
    assert r.status_code == 403


def test_register_returns_a_token_that_authenticates(client, operator_factory, db):
    _, _, admin = operator_factory()
    pid = _profile(client, admin)
    body = client.post("/api/honeypots/register", headers=auth(admin), json={"name": "hp", "profile_id": pid}).json()
    assert client.get("/api/agent/whoami", headers=auth(body["agent_token"])).json()["id"] == body["id"]
    from app.models import Honeypot

    assert db.get(Honeypot, uuid.UUID(body["id"])).agent_token_hash == hash_agent_token(body["agent_token"])


def test_register_unknown_profile_and_duplicate_name(client, operator_factory):
    _, _, admin = operator_factory()
    pid = _profile(client, admin)
    assert client.post("/api/honeypots/register", headers=auth(admin), json={"name": "hp", "profile_id": "11111111-1111-4111-8111-111111111111"}).status_code == 404
    client.post("/api/honeypots/register", headers=auth(admin), json={"name": "hp", "profile_id": pid})
    assert client.post("/api/honeypots/register", headers=auth(admin), json={"name": "hp", "profile_id": pid}).status_code == 409


def test_fleet_status_is_derived_from_last_seen(client, operator_factory, db):
    _, _, admin = operator_factory()
    pid = _profile(client, admin)
    hid = client.post("/api/honeypots/register", headers=auth(admin), json={"name": "hp", "profile_id": pid}).json()["id"]
    from app.models import Honeypot

    hp = db.get(Honeypot, uuid.UUID(hid))
    fleet = client.get("/api/honeypots", headers=auth(admin)).json()
    assert fleet[0]["status"] == "never"
    hp.last_seen_at = datetime.now(timezone.utc)
    db.commit()
    assert client.get("/api/honeypots", headers=auth(admin)).json()[0]["status"] == "online"
    hp.last_seen_at = datetime.now(timezone.utc) - timedelta(seconds=settings.fleet_offline_after_s + 1)
    db.commit()
    assert client.get("/api/honeypots", headers=auth(admin)).json()[0]["status"] == "offline"


def test_status_boundary_at_the_threshold_is_online(client, operator_factory, db):
    _, _, admin = operator_factory()
    pid = _profile(client, admin)
    hid = client.post("/api/honeypots/register", headers=auth(admin), json={"name": "hp", "profile_id": pid}).json()["id"]
    from app.models import Honeypot

    hp = db.get(Honeypot, uuid.UUID(hid))
    hp.last_seen_at = datetime.now(timezone.utc) - timedelta(seconds=settings.fleet_offline_after_s)
    db.commit()
    assert client.get(f"/api/honeypots/{hid}", headers=auth(admin)).json()["status"] == "online"


def test_heartbeat_makes_the_fleet_show_online(client, operator_factory):
    _, _, admin = operator_factory()
    pid = _profile(client, admin)
    body = client.post("/api/honeypots/register", headers=auth(admin), json={"name": "hp", "profile_id": pid}).json()
    client.post("/api/agent/heartbeat", headers=auth(body["agent_token"]), json={"config_version": 1})
    row = client.get("/api/honeypots", headers=auth(admin)).json()[0]
    assert row["status"] == "online" and row["config_version"] == 1
    assert row["profile"]["interaction_level"] == "low" and row["profile"]["version"] == 1


def test_register_is_audited(client, operator_factory):
    _, _, admin = operator_factory()
    pid = _profile(client, admin)
    client.post("/api/honeypots/register", headers=auth(admin), json={"name": "hp", "profile_id": pid})
    rows = client.get("/api/audit-logs", headers=auth(admin), params={"action": "honeypot_registered"}).json()["items"]
    assert len(rows) == 1 and rows[0]["resource_type"] == "honeypot"
```

- [ ] **Step 2: Run the honeypot tests to verify they fail**

Run: `docker compose run --rm backend pytest tests/test_honeypots_api.py -q`
Expected: FAIL — 404 on `/api/honeypots`.

- [ ] **Step 3: Extend `backend/app/services/fleet_service.py`**

- `record_heartbeat`: delete the `honeypot.status = "online"` line (status is now derived).
- `derive_status(hp, now=None)`: `None` last_seen → `"never"`; else `"online"` when `(now or datetime.now(timezone.utc)) - hp.last_seen_at <= timedelta(seconds=settings.fleet_offline_after_s)`, otherwise `"offline"`.
- `list_honeypots(db)`: `list(db.scalars(select(Honeypot).order_by(Honeypot.name)))`.
- `register_honeypot(db, *, name, profile_id)`: 404 if `db.get(Profile, profile_id)` is None; 409 if a honeypot with that name exists; else `token = generate_agent_token()`, create with `agent_token_hash=hash_agent_token(token)`, commit (catch `IntegrityError` → rollback + 409), refresh, return `(hp, token)`.

- [ ] **Step 4: Add the schemas**

```python
# backend/app/schemas/honeypot.py
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class HoneypotRegisterIn(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    profile_id: uuid.UUID


class HoneypotProfileRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    interaction_level: str
    version: int


class HoneypotOut(BaseModel):
    id: uuid.UUID
    name: str
    profile_id: uuid.UUID
    profile: HoneypotProfileRef
    config_version: int
    status: str
    last_seen_at: datetime | None
    created_at: datetime


class HoneypotRegisteredOut(BaseModel):
    id: uuid.UUID
    name: str
    profile_id: uuid.UUID
    agent_token: str
```

`HoneypotOut` deliberately has no `from_attributes`: `status` is derived, not the legacy column, so the router builds it explicitly.

- [ ] **Step 5: Add the router**

`backend/app/api/honeypots.py`: `router = APIRouter(prefix="/api/honeypots", tags=["honeypots"])`, plus a local `_to_out(hp)` that returns `HoneypotOut(...)` with `profile=HoneypotProfileRef.model_validate(hp.profile)` and `status=derive_status(hp)`.

- `POST "/register"` → `HoneypotRegisteredOut`, 201, `require_admin`; `hp, token = register_honeypot(...)`; audit `honeypot_registered`; return with `agent_token=token`.
- `GET ""` → `list[HoneypotOut]`, `require_operator`; `[_to_out(hp) for hp in list_honeypots(db)]`.
- `GET "/{honeypot_id}"` → `HoneypotOut`, `require_operator`; 404 if `db.get(Honeypot, honeypot_id)` is None.

- [ ] **Step 6: Register the router in `backend/app/main.py`**

- [ ] **Step 7: Run the honeypot tests plus the heartbeat/agent tests**

Run: `docker compose run --rm backend pytest tests/test_honeypots_api.py tests/test_heartbeat.py tests/test_agent_config.py -q`
Expected: PASS. (`test_heartbeat.py` must still pass now that `record_heartbeat` no longer sets `status`.)

- [ ] **Step 8: Commit**

```bash
git add backend/app/schemas/honeypot.py backend/app/api/honeypots.py backend/app/services/fleet_service.py backend/app/main.py backend/tests/test_honeypots_api.py
git commit -m "feat(fleet): honeypot registration, derived fleet status, one-time agent token"
```

---

### Task 6: Event `q` search (with wildcard escaping)

**Files:**
- Modify: `backend/app/services/event_service.py`, `backend/app/api/events.py`
- Test: `backend/tests/test_events_query.py`

**Interfaces:**
- Produces: `EventFilters.q: str | None`; `event_service._like_pattern(q: str) -> str`; `GET /api/events?q=...`.

- [ ] **Step 1: Write the failing search tests**

Append to `backend/tests/test_events_query.py`:

```python
def _token(operator_factory):
    return operator_factory()[2]


def test_q_matches_event_type_or_details(client, operator_factory, seed_events):
    t = _token(operator_factory)
    by_type = client.get("/api/events", headers=auth(t), params={"q": "scan"}).json()
    assert by_type["total"] == 2 and all(i["event_type"] == "scan" for i in by_type["items"])
    by_detail = client.get("/api/events", headers=auth(t), params={"q": "root"}).json()
    assert by_detail["total"] == 2  # seed rows with details {"user": "root"}


def test_q_wildcard_is_literal(client, operator_factory, seed_events):
    t = _token(operator_factory)
    # A bare % must match only rows literally containing %, i.e. none here.
    assert client.get("/api/events", headers=auth(t), params={"q": "%"}).json()["total"] == 0
```

Wait — the fixture seeds 3 rows on honeypot `a` with `details={"user": "root"} if i else {}` for i in 0..2, i.e. i=1 and i=2 have `{"user": "root"}` → 2 rows. And 2 `scan` rows on `b`. Good.

- [ ] **Step 2: Run the search tests to verify they fail**

Run: `docker compose run --rm backend pytest tests/test_events_query.py -q`
Expected: FAIL — `q` is ignored, so `q=%` returns all 5 rows (and `q=scan` happens to pass only because the filter is ignored... it would return 5).

- [ ] **Step 3: Implement the filter**

In `event_service.EventFilters` add `q: str | None = None`. Add:

```python
def _like_pattern(q: str) -> str:
    escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"
```

In `list_events`, before the other conditions:

```python
    if filters.q:
        pattern = _like_pattern(filters.q)
        conds.append(
            sa.or_(
                AttackEvent.event_type.ilike(pattern, escape="\\"),
                sa.cast(AttackEvent.details, sa.Text).ilike(pattern, escape="\\"),
            )
        )
```

In `api/events.py` add `q: str | None = Query(default=None, max_length=200)` and pass `q=q` into `EventFilters`.

- [ ] **Step 4: Run the search tests to verify they pass**

Run: `docker compose run --rm backend pytest tests/test_events_query.py -q`
Expected: PASS.

- [ ] **Step 5: Run the whole backend suite and lint**

Run: `docker compose run --rm backend pytest -q`
Run: `docker compose run --rm backend ruff check app tests`
Expected: PASS, no ruff findings.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/event_service.py backend/app/api/events.py backend/tests/test_events_query.py
git commit -m "feat(events): free-text q filter with literal wildcard handling"
```

---

### Task 7: Frontend token store + typed API client

**Files:**
- Modify: `frontend/package.json` (add `react-router-dom`), `frontend/src/api/client.ts`, `frontend/src/api/types.ts`
- Test: `frontend/src/api/client.test.ts` (new)

**Interfaces:**
- Produces:
  - `apiBase: string` (unchanged)
  - `tokenStore: { get(): string | null; set(token: string): void; clear(): void }` over `localStorage["hf_token"]`
  - `AUTH_EXPIRED_EVENT = "hf:auth-expired"`; on any 401 `apiFetch` clears the token and dispatches this event on `window`
  - `class ApiError extends Error { status: number }`
  - `apiFetch(path, init?)`, `apiJson<T>(path, init?)`
  - `login(username, password): Promise<TokenResponse>`, `getMe(): Promise<Operator>`
  - `listProfiles()`, `createProfile(input)`, `updateProfile(id, patch)`, `deleteProfile(id)`
  - `listHoneypots()`, `registerHoneypot(input)`
  - `listEvents(params)`, `listAuditLogs(params)`
  - types: `Operator`, `TokenResponse`, `Profile`, `ProfileSummary`, `Honeypot`, `HoneypotRegistered`, `AuditLog`, `Page<T>` (plus the existing `AttackEvent`, `EventPage`)

- [ ] **Step 1: Add the dependency**

Run (in `frontend`): `npm install react-router-dom@^7`
Expected: `package.json` and `package-lock.json` updated.

- [ ] **Step 2: Write the failing client tests**

```ts
// frontend/src/api/client.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_EXPIRED_EVENT, ApiError, apiBase, apiFetch, tokenStore } from "./client";

beforeEach(() => {
  localStorage.clear();
  tokenStore.set("test-jwt");
});

afterEach(() => vi.unstubAllGlobals());

describe("apiFetch", () => {
  it("attaches the stored bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);
    vi.stubGlobal("fetch", fetchMock);
    await apiFetch("/api/auth/me");
    expect(fetchMock).toHaveBeenCalledWith(`${apiBase}/api/auth/me`, expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer test-jwt" }),
    }));
  });

  it("clears the token and signals expiry on 401", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ detail: "no" }) } as Response));
    const onExpired = vi.fn();
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    await expect(apiFetch("/api/events")).rejects.toBeInstanceOf(ApiError);
    expect(tokenStore.get()).toBeNull();
    expect(onExpired).toHaveBeenCalledTimes(1);
    window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  });
});
```

- [ ] **Step 3: Run the client tests to verify they fail**

Run (in `frontend`): `npm test -- src/api/client.test.ts`
Expected: FAIL — `tokenStore`/`AUTH_EXPIRED_EVENT`/`ApiError` not exported.

- [ ] **Step 4: Rewrite `frontend/src/api/client.ts`**

Keep `apiBase`. Delete `operatorToken`/`authHeaders`. Implement `tokenStore` over `localStorage` (guard `get`/`clear` so a missing key returns `null`), `ApiError`, and:

```ts
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = tokenStore.get();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(`${apiBase}${path}`, { ...init, headers });
  if (res.status === 401) {
    tokenStore.clear();
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
  }
  return res;
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(path, init);
  if (!res.ok) throw new ApiError(res.status, `request failed: ${res.status}`);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
```

Then the typed helpers, each a one-liner over `apiJson`. `listEvents`/`listAuditLogs` build a `URLSearchParams` from defined params only; `deleteProfile` uses `apiFetch(id, { method: "DELETE" })` and throws `ApiError` on `!ok`.

- [ ] **Step 5: Extend `frontend/src/api/types.ts`**

Add the types listed in Interfaces (`Operator`, `TokenResponse`, `Profile`, `ProfileSummary`, `Honeypot` with a nested `profile: { id; name; interaction_level; version }` and `status: "online" | "offline" | "never"`, `HoneypotRegistered`, `AuditLog`, generic `Page<T>`).

- [ ] **Step 6: Point `useEventStream` at the token store**

In `frontend/src/hooks/useEventStream.ts` replace `import { apiBase, apiFetch, operatorToken }` with `import { apiBase, apiFetch, tokenStore }` and the handshake line with `socket.send(JSON.stringify({ type: "auth", token: tokenStore.get() ?? "" }));`. Everything else unchanged. (Do this before the type-check — it is the last consumer of the deleted `operatorToken` export.)

- [ ] **Step 7: Run the client tests, the full suite, and the type-check**

Run (in `frontend`): `npm test -- src/api/client.test.ts`
Run (in `frontend`): `npm test`
Run (in `frontend`): `npx tsc --noEmit`
Expected: PASS (the existing `EventFeed` test unaffected).

- [ ] **Step 8: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/api/client.ts frontend/src/api/types.ts frontend/src/api/client.test.ts frontend/src/hooks/useEventStream.ts
git commit -m "feat(ui): JWT token store and typed API client"
```

---

### Task 8: Auth context, login page, and routed app shell

**Files:**
- Create: `frontend/src/auth/AuthContext.tsx`, `frontend/src/auth/RequireAuth.tsx`, `frontend/src/components/AppShell.tsx`, `frontend/src/pages/LoginPage.tsx`, `frontend/src/test/utils.tsx`
- Modify: `frontend/src/App.tsx`, `frontend/src/main.tsx`
- Test: `frontend/src/auth/RequireAuth.test.tsx` (new), `frontend/src/pages/LoginPage.test.tsx` (new)

**Interfaces:**
- Consumes: `login`, `getMe`, `tokenStore`, `AUTH_EXPIRED_EVENT`, `ApiError` (Task 7).
- Produces:
  - `AuthProvider({ children })`, `useAuth(): { operator: Operator | null; loading: boolean; login(u: string, p: string): Promise<void>; logout(): void }`
  - `RequireAuth({ children })`
  - `AppShell` (nav + operator/role + logout, renders `<Outlet />`)
  - test helper `renderWithProviders(ui, { route?, operator?, fetchImpl? })`

- [ ] **Step 1: Write the failing auth-context tests**

```tsx
// frontend/src/auth/RequireAuth.test.tsx
import { describe, expect, it, vi, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import RequireAuth from "./RequireAuth";
import { renderWithProviders } from "../test/utils";

afterEach(() => vi.unstubAllGlobals());

it("redirects to /login when there is no token", async () => {
  localStorage.clear();
  renderWithProviders(
    <Routes>
      <Route path="/fleet" element={<RequireAuth><div>fleet page</div></RequireAuth>} />
      <Route path="/login" element={<div>login page</div>} />
    </Routes>,
    { route: "/fleet" },
  );
  expect(await screen.findByText("login page")).toBeTruthy();
});

it("renders children once the operator is loaded", async () => {
  localStorage.setItem("hf_token", "jwt");
  renderWithProviders(
    <Routes>
      <Route path="/fleet" element={<RequireAuth><div>fleet page</div></RequireAuth>} />
    </Routes>,
    { route: "/fleet", operator: { id: "1", username: "admin", role: "admin" } },
  );
  expect(await screen.findByText("fleet page")).toBeTruthy();
});
```

- [ ] **Step 2: Write the failing login-page test**

```tsx
// frontend/src/pages/LoginPage.test.tsx
import { describe, expect, it, vi, afterEach } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import LoginPage from "./LoginPage";
import { renderWithProviders } from "../test/utils";

afterEach(() => vi.unstubAllGlobals());

it("posts credentials and stores the returned token", async () => {
  localStorage.clear();
  const fetchMock = vi.fn(async (url: string) =>
    String(url).endsWith("/api/auth/login")
      ? ({ ok: true, status: 200, json: async () => ({ access_token: "new-jwt", token_type: "bearer", expires_in: 60, operator: { id: "1", username: "admin", role: "admin" } }) } as Response)
      : ({ ok: true, status: 200, json: async () => ({ id: "1", username: "admin", role: "admin" }) } as Response),
  );
  vi.stubGlobal("fetch", fetchMock);
  renderWithProviders(<LoginPage />, { route: "/login" });

  fireEvent.change(screen.getByLabelText(/username/i), { target: { value: "admin" } });
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "secret" } });
  fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

  await vi.waitFor(() => expect(localStorage.getItem("hf_token")).toBe("new-jwt"));
});
```

- [ ] **Step 3: Run both tests to verify they fail**

Run (in `frontend`): `npm test -- src/auth/RequireAuth.test.tsx src/pages/LoginPage.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 4: Add the test helper `frontend/src/test/utils.tsx`**

```tsx
export function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as Response;
}

export function renderWithProviders(
  ui: React.ReactNode,
  opts: { route?: string; operator?: Operator | null; fetchImpl?: (url: string, init?: RequestInit) => Promise<Response> } = {},
) {
  const operator = opts.operator === undefined ? DEFAULT_ADMIN : opts.operator;
  const fetchImpl = opts.fetchImpl ?? (async (url: string) =>
    String(url).includes("/api/auth/me")
      ? jsonResponse(operator)
      : jsonResponse({ items: [], total: 0 }));
  vi.stubGlobal("fetch", vi.fn(fetchImpl));
  return render(
    <MemoryRouter initialEntries={[opts.route ?? "/"]}>
      <AuthProvider>{ui}</AuthProvider>
    </MemoryRouter>,
  );
}
```

(`DEFAULT_ADMIN = { id: "1", username: "admin", role: "admin" }`; note `renderWithProviders` wraps children in `AuthProvider`, so `login`/`RequireAuth` see the same context.)

- [ ] **Step 5: Implement `AuthContext.tsx`**

State `{ operator, loading }`; on mount, if `tokenStore.get()` → `getMe()` (set operator; on failure clear). `login(username, password)` calls the API, `tokenStore.set(res.access_token)`, sets the operator. `logout()` clears the token and the operator. Subscribe to `AUTH_EXPIRED_EVENT` → logout. Export `useAuth()` that throws if used outside the provider.

- [ ] **Step 6: Implement `RequireAuth.tsx` and `AppShell.tsx`**

`RequireAuth`: `const { operator, loading } = useAuth();` → `if (loading) return null;` → `if (!operator) return <Navigate to="/login" replace />;` → `return <>{children}</>`.
`AppShell`: header with nav links (`/fleet`, `/profiles`, `/events`, `/audit`), the operator's username + role, a logout button calling `useAuth().logout()`, and `<main><Outlet /></main>`.

- [ ] **Step 7: Implement `LoginPage.tsx`**

Username + password inputs (labels "Username"/"Password" for the test's `getByLabelText`), a submit button "Sign in", a `useNavigate()` redirect to `/fleet` on success, and an error line rendering `ApiError.status === 401` as "Invalid username or password".

- [ ] **Step 8: Rewire `App.tsx` and `main.tsx`**

`main.tsx`: wrap `<App />` in `<BrowserRouter>`.
`App.tsx`: `<Routes>` with `/login` → `<LoginPage />`, a protected group `<RequireAuth><AppShell /></RequireAuth>` whose children routes are `/fleet`, `/profiles`, `/events`, `/audit` (placeholder elements for the three not yet built), and `/` → `<Navigate to="/fleet" replace />`. Move the `HoneyForge` header markup into `AppShell` (the old inline header in `App.tsx` is removed).

- [ ] **Step 9: Run the tests and the type-check**

Run (in `frontend`): `npm test`
Run (in `frontend`): `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/auth frontend/src/components/AppShell.tsx frontend/src/pages/LoginPage.tsx frontend/src/test/utils.tsx frontend/src/App.tsx frontend/src/main.tsx frontend/src/auth/RequireAuth.test.tsx frontend/src/pages/LoginPage.test.tsx
git commit -m "feat(ui): auth context, protected routes, login page, app shell"
```

---

### Task 9: Fleet page

**Files:**
- Create: `frontend/src/pages/FleetPage.tsx`
- Modify: `frontend/src/App.tsx` (mount the page)
- Test: `frontend/src/pages/FleetPage.test.tsx` (new)

**Interfaces:**
- Consumes: `listHoneypots`, `registerHoneypot`, `listProfiles`, `useAuth` (Tasks 7–8), `StatusBadge` (existing).
- Produces: `FleetPage` default export.

- [ ] **Step 1: Write the failing fleet-page test**

```tsx
// frontend/src/pages/FleetPage.test.tsx
import { describe, expect, it, vi, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import FleetPage from "./FleetPage";
import { jsonResponse, renderWithProviders } from "../test/utils";

afterEach(() => vi.unstubAllGlobals());

const HP = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "low",
  profile_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  profile: { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "low", interaction_level: "low", version: 2 },
  config_version: 2,
  status: "online",
  last_seen_at: "2026-01-01T12:00:00Z",
  created_at: "2026-01-01T00:00:00Z",
};

it("lists honeypots with derived status and profile version", async () => {
  renderWithProviders(<FleetPage />, {
    route: "/fleet",
    fetchImpl: async (url) => (String(url).includes("/api/honeypots") ? jsonResponse([HP]) : jsonResponse({ items: [], total: 0 })),
  });
  expect(await screen.findByText("low")).toBeTruthy();
  expect(screen.getByText("online")).toBeTruthy();
  expect(screen.getByText(/v2/)).toBeTruthy();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (in `frontend`): `npm test -- src/pages/FleetPage.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `FleetPage.tsx`**

Table columns: name, interaction level, status badge, last seen (ISO or "—"), profile (name + `v{version}`), config version. Load on mount via `listHoneypots()`; render "No honeypots registered yet." when empty. For `role === "admin"`, render a "Register honeypot" form (name input + profile `<select>` populated by `listProfiles()`); on submit call `registerHoneypot(...)` and display the returned `agent_token` **once** in a highlighted block with a "Copy" button (and a note that it will not be shown again). Non-admin sees no form.

- [ ] **Step 4: Mount the page in `App.tsx`**

Replace the `/fleet` placeholder with `<FleetPage />`.

- [ ] **Step 5: Run the test and the type-check**

Run (in `frontend`): `npm test -- src/pages/FleetPage.test.tsx`
Run (in `frontend`): `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/FleetPage.tsx frontend/src/pages/FleetPage.test.tsx frontend/src/App.tsx
git commit -m "feat(ui): fleet page with derived status and one-time token reveal"
```

---

### Task 10: Profiles page

**Files:**
- Create: `frontend/src/pages/ProfilesPage.tsx`
- Modify: `frontend/src/App.tsx`
- Test: `frontend/src/pages/ProfilesPage.test.tsx` (new)

**Interfaces:**
- Consumes: `listProfiles`, `createProfile`, `updateProfile`, `deleteProfile`, `useAuth` (Tasks 7–8).
- Produces: `ProfilesPage` default export.

- [ ] **Step 1: Write the failing profiles-page test**

```tsx
// frontend/src/pages/ProfilesPage.test.tsx
import { describe, expect, it, afterEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import ProfilesPage from "./ProfilesPage";
import { jsonResponse, renderWithProviders } from "../test/utils";

afterEach(() => vi.unstubAllGlobals());

const PROFILE = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "low", interaction_level: "low", config: { ports: [2222], banner: "SSH-2.0-x" }, version: 3, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z" };

it("shows profiles with their version and hides write controls for analysts", async () => {
  renderWithProviders(<ProfilesPage />, {
    route: "/profiles",
    operator: { id: "2", username: "an", role: "analyst" },
    fetchImpl: async (url) => (String(url).includes("/api/profiles") ? jsonResponse([PROFILE]) : jsonResponse([], 200)),
  });
  expect(await screen.findByText("low")).toBeTruthy();
  expect(screen.getByText(/v3/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /new profile/i })).toBeNull();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (in `frontend`): `npm test -- src/pages/ProfilesPage.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ProfilesPage.tsx`**

Table: name, interaction level, version (`v{n}`), updated-at, and (admin only) Edit/Delete actions. Admin-only "New profile" button opening a form: name, interaction level (`low`/`medium`), and the level-specific fields (`ports` comma-separated, `banner` for low; `ports`, `title`, `login_enabled` checkbox for medium) assembled into the `config` object. Save → `createProfile` / `updateProfile(id, patch)` then reload. Delete → confirm → `deleteProfile` (surface a 409 as "Profile is in use by a honeypot"). Analysts see the read-only table only.

- [ ] **Step 4: Mount the page in `App.tsx`**

- [ ] **Step 5: Run the test and the type-check**

Run (in `frontend`): `npm test -- src/pages/ProfilesPage.test.tsx`
Run (in `frontend`): `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/ProfilesPage.tsx frontend/src/pages/ProfilesPage.test.tsx frontend/src/App.tsx
git commit -m "feat(ui): profiles page with level-specific config forms"
```

---

### Task 11: Events page (filters, pagination, live tail)

**Files:**
- Create: `frontend/src/pages/EventsPage.tsx`
- Modify: `frontend/src/App.tsx`
- Test: `frontend/src/pages/EventsPage.test.tsx` (new)

**Interfaces:**
- Consumes: `listEvents`, `listHoneypots`, `useEventStream` (existing hook), `useAuth`.
- Produces: `EventsPage` default export.

- [ ] **Step 1: Write the failing events-page test**

```tsx
// frontend/src/pages/EventsPage.test.tsx
import { describe, expect, it, afterEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import EventsPage from "./EventsPage";
import { jsonResponse, renderWithProviders } from "../test/utils";

afterEach(() => vi.unstubAllGlobals());

it("renders a filtered page of events with the total", async () => {
  renderWithProviders(<EventsPage />, {
    route: "/events",
    fetchImpl: async (url) => {
      if (String(url).includes("/api/events?")) return jsonResponse({ items: [{ id: "e1", honeypot_id: "h", event_type: "auth_attempt", source_ip: "203.0.113.5", source_port: 51000, target_port: 8080, protocol: "http", details: { username: "admin" }, occurred_at: "2026-01-01T12:00:00Z", received_at: "2026-01-01T12:00:01Z" }], total: 1 });
      if (String(url).includes("/api/honeypots")) return jsonResponse([]);
      return jsonResponse({ items: [], total: 0 });
    },
  });
  expect(await screen.findByText("auth_attempt")).toBeTruthy();
  expect(screen.getByText(/203\.0\.113\.5/)).toBeTruthy();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (in `frontend`): `npm test -- src/pages/EventsPage.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `EventsPage.tsx`**

Filter bar: honeypot `<select>` (from `listHoneypots`), event-type text input, source-IP text input, a `q` search input, `since`/`until` `datetime-local` inputs. Table columns: occurred-at, event type, protocol, source `ip:port`, target port, honeypot; selecting a row reveals its `details` JSON below. Pagination: "Previous"/"Next" driving `offset` by `limit` (50), showing `total`. Load via `listEvents(params)` whenever a filter or `offset` changes. Below the table, render the existing `<EventFeed />` as the live tail.

- [ ] **Step 4: Mount the page in `App.tsx`**

- [ ] **Step 5: Run the test and the type-check**

Run (in `frontend`): `npm test -- src/pages/EventsPage.test.tsx`
Run (in `frontend`): `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/EventsPage.tsx frontend/src/pages/EventsPage.test.tsx frontend/src/App.tsx
git commit -m "feat(ui): events page with filters, pagination, and live tail"
```

---

### Task 12: Audit page

**Files:**
- Create: `frontend/src/pages/AuditPage.tsx`
- Modify: `frontend/src/App.tsx`
- Test: `frontend/src/pages/AuditPage.test.tsx` (new)

**Interfaces:**
- Consumes: `listAuditLogs`, `useAuth`.
- Produces: `AuditPage` default export.

- [ ] **Step 1: Write the failing audit-page test**

```tsx
// frontend/src/pages/AuditPage.test.tsx
import { describe, expect, it, afterEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import AuditPage from "./AuditPage";
import { jsonResponse, renderWithProviders } from "../test/utils";

afterEach(() => vi.unstubAllGlobals());

it("lists audit rows newest first with their action", async () => {
  renderWithProviders(<AuditPage />, {
    route: "/audit",
    fetchImpl: async (url) =>
      String(url).includes("/api/audit-logs")
        ? jsonResponse({ items: [
            { id: 2, operator_id: "1", action: "profile_updated", resource_type: "profile", resource_id: "p1", created_at: "2026-01-02T00:00:00Z" },
            { id: 1, operator_id: "1", action: "login", resource_type: "operator", resource_id: "1", created_at: "2026-01-01T00:00:00Z" },
          ], total: 2 })
        : jsonResponse({ items: [], total: 0 }),
  });
  expect(await screen.findByText("profile_updated")).toBeTruthy();
  expect(screen.getByText("login")).toBeTruthy();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (in `frontend`): `npm test -- src/pages/AuditPage.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `AuditPage.tsx`**

Filter bar: action, resource type, and `since`/`until`. Table: created-at, action, resource type, resource id, operator id ("system" when null). Pagination with `limit=50` and Previous/Next showing `total`. Load via `listAuditLogs(params)`.

- [ ] **Step 4: Mount the page in `App.tsx`**

- [ ] **Step 5: Run the test, the full frontend suite, and the type-check**

Run (in `frontend`): `npm test`
Run (in `frontend`): `npx tsc --noEmit`
Expected: PASS (all frontend tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/AuditPage.tsx frontend/src/pages/AuditPage.test.tsx frontend/src/App.tsx
git commit -m "feat(ui): audit log page with filters and pagination"
```

---

### Task 13: Docs, threat-model update, and end-to-end verification

**Files:**
- Modify: `AGENTS.md` (§10 operator-auth deviation; §11 current focus → S4 complete), `docs/threat-model.md`
- Verify: the running Compose stack

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Update `AGENTS.md` §10**

Replace the "Operator auth in S2 is the static `DEV_OPERATOR_TOKEN`…" bullet with the S4 reality: operator auth is bcrypt + JWT (HS256, 60-min access token in `localStorage`, no refresh/revocation); roles `admin` (full) / `analyst` (read-only); provisioning is via `app.seed` env vars (no enrollment); login rate-limiting is deferred to S6.

- [ ] **Step 2: Add the new limits to `docs/threat-model.md`**

Add to the documented-limits section: a JWT in `localStorage` is exfiltrable by XSS (a strict CSP is future work); the access-token-only flow has no revocation/rotation; `/api/auth/login` is not rate-limited until S6; and register returns the agent token once (only its HMAC hash is stored).

- [ ] **Step 3: Update `AGENTS.md` §11**

Move S4 to complete; set the next slice to S5 and list the remaining pre-submission items (TLS/encryption matrix, README + diagrams, API docs, demo recording).

- [ ] **Step 4: Rebuild, seed, and verify the stack**

Run: `docker compose up -d --build`
Run: `docker compose exec -T backend python -m app.seed`
Expected: `seeded operator=admin ...` and `analyst` seeded (the seed prints the operator line; confirm two operators with `docker compose exec -T db psql -U honeyforge -d honeyforge -c "select username, role from operators"`).

- [ ] **Step 5: Walk the demoable outcome with curl**

Run each from the host (PowerShell; capture the token):

```powershell
$login = Invoke-RestMethod -Method Post -Uri http://localhost:8000/api/auth/login -ContentType application/json -Body '{"username":"admin","password":"change-me-operator-password"}'
$h = @{ Authorization = "Bearer $($login.access_token)" }
Invoke-RestMethod -Uri http://localhost:8000/api/profiles -Headers $h | ConvertTo-Json -Depth 5
Invoke-RestMethod -Uri http://localhost:8000/api/honeypots -Headers $h | ConvertTo-Json -Depth 5
Invoke-RestMethod -Uri http://localhost:8000/api/audit-logs -Headers $h | ConvertTo-Json -Depth 5
```

Expected: the profiles list (low v?, medium v?), both honeypots with `status: "online"`, and audit rows including the `login`. Then repeat with an `analyst` login and confirm a `POST /api/profiles` returns 403.

- [ ] **Step 6: Verify the five pages in the browser**

Log in at `http://localhost:5173/login` as `admin`; confirm fleet status/version, create + edit a profile (version bumps and the matching agent adopts it), register a honeypot and copy the one-time token, filter the events page, and read the audit page. Repeat as `analyst`: nav works, write controls are gone, and a direct API write returns 403.

- [ ] **Step 7: Run every suite one final time**

Run: `docker compose run --rm backend pytest -q`
Run: `docker compose run --rm backend ruff check app tests`
Run (in `frontend`): `npm test`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add AGENTS.md docs/threat-model.md
git commit -m "docs: record S4 operator auth, roles, and the new threat-model limits"
```

---

## Self-Review

**Spec coverage:** auth login/me + bcrypt → Tasks 1–2; roles + permission map → Task 2 (+ per-write 403 tests in Tasks 4–5); WS handshake → Task 2; profile CRUD + version bump + in-use guard → Task 4; register + one-time token + derived fleet status → Task 5; events filters + `q` → Task 6; audit service + endpoint + login auditing → Task 3; five UI pages → Tasks 7–12; config/env/seed → Task 2; threat-model + AGENTS → Task 13. No migration (spec §6) is asserted in Task 6 Step 5 by the full suite including `test_migrations.py`.

**Type consistency:** `require_operator(...) -> Operator` (Tasks 2–5), `derive_status`/`list_honeypots`/`register_honeypot` (Task 5) match their call sites; `audit_service.record` signature (Task 3) is reused verbatim in Tasks 4–5; frontend `Honeypot.status` union matches the backend string set; `tokenStore`/`AUTH_EXPIRED_EVENT`/`ApiError` (Task 7) are the only auth surface the pages import.

**Review Focus → owning test:** (1) 73-byte password → Task 2 `test_login_rejects_a_password_longer_than_72_bytes`; (2) forged/expired/none-alg JWT → Task 2 `test_forged_token_is_401`, `test_expired_token_is_401`, WS `test_ws_rejects_a_forged_token`, and Task 1 `test_token_rejects_the_none_algorithm`; (3) unknown-user login → Task 3 `test_failed_login_is_audited_without_an_operator` + Task 2 `test_login_wrong_password_and_unknown_user_are_indistinguishable`; (4) `q=%` → Task 6 `test_q_wildcard_is_literal`; (5) in-use profile delete → Task 4 `test_delete_and_conflict_when_in_use`; plus the threshold boundary → Task 5 `test_status_boundary_at_the_threshold_is_online`.

**Open item deferred:** the design spec's §13 mentions an `analyst` 403 sweep across every write route; this plan places those assertions in the tests of the tasks that own each route (profiles/honeypots) rather than a separate file. Login rate-limiting remains explicitly S6.
