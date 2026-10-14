# S4 — Control Center API & Minimal UI

**Date:** 2026-10-14
**Status:** Design approved — pending implementation plan
**Slice:** S4 (per `AGENTS.md` §7/§11 and `docs/HoneyForge_Implementation_Plan.md` Phase 2)
**Related:** `AGENTS.md` §3/§5/§6/§7/§10; plan §5 (schema), §7 (API), §8 (frontend), §10 (security)

---

## 1. Goal

Turn the S2/S3 golden path into a usable control center: real operator
authentication with roles, profile CRUD with version bumping, controlled
honeypot registration, fleet status, event filters/pagination, and an operator
audit trail — delivered **as an API and its minimal UI together**, matching the
slice rule in `AGENTS.md` §7.

Success = the plan's Phase 2 exit criteria: *the API can create profiles,
register test devices, store events, and query the fleet*, and each of those is
visible in the dashboard and provable by a test or a documented command
(per-slice gate: runnable / verifiable / demoable).

## 2. Current state (S1–S3, already built)

- All five tables exist and are migrated: `operators`, `profiles`, `honeypots`,
  `attack_events`, `audit_logs`. **S4 requires no schema migration.**
- Agent auth is real: per-agent random token, stored only as an HMAC hash
  (`core/security.py`, `api/deps.py::get_current_agent`).
- Operator auth is an **S2 seam**: `require_operator` compares a static
  `DEV_OPERATOR_TOKEN`; the WebSocket uses the same token. The seeded operator's
  `password_hash` is a placeholder.
- `GET /api/events` already supports filters (honeypot, event_type, source_ip,
  since/until) and limit/offset pagination.
- Services are partial: `profile_service` (get/update only), `fleet_service`
  (heartbeat only). There are **no** auth/profiles/honeypots/audit routers.
- Frontend is a single page (`App.tsx` → `EventFeed`) authenticating with a
  bundled `VITE_OPERATOR_TOKEN`.

## 3. Scope

**In scope**
- `POST /api/auth/login` (JWT) + `GET /api/auth/me`; bcrypt password hashing.
- Roles: `admin` (full) and `analyst` (read-only), enforced server-side.
- Profile CRUD with config validation and version bump.
- Operator-provisioned honeypot registration (returns the agent token once) and
  fleet listing with derived online/offline status.
- Event filtering/pagination hardening (+ free-text `q`).
- Audit logging of sensitive operator actions + `GET /api/audit-logs`.
- Minimal UI: login, fleet, profiles, events, audit.

**Out of scope (deliberately)**
- High-interaction honeypots (project-wide).
- Overview page, charts, dashboard polish → **S5** ("improves, does not
  introduce").
- Nginx/TLS termination → S6.
- Login rate-limiting and payload caps → **S6** (plan §10; `AGENTS.md` S6).
  S4 ships without it and this is stated, not hidden.
- Honeypot deletion/token rotation (the plan's API contract lists only register
  + list); profile deletion is supported with an in-use guard.
- Refresh tokens / token revocation (per the approved session decision).

## 4. Approved decisions

| Decision | Choice |
|---|---|
| Role model | `admin` = full; `analyst` = read-only everywhere |
| Session | Access JWT (HS256) in `localStorage`, 60 min, **no refresh** |
| UI scope | Five functional pages, no charts |
| Auth approach | JWT + bcrypt, layered FastAPI dependencies (approach A) |
| Fleet status | Derived at read from `last_seen_at` (no background sweeper) |
| Frontend structure | `react-router-dom` + `AuthContext` + per-page components |

Documented honesty: a JWT in `localStorage` and an access-token-only flow are
perimeter-level controls for the demo, not hardened production auth. This is
recorded in `docs/threat-model.md` as a limit, in the spirit of `AGENTS.md` §5
rule 7.

## 5. Architecture

Extend the existing layering; no new subsystem folds in on itself.

```
frontend (React SPA)
  └─ pages/  login · fleet · profiles · events · audit
       └─ api/client.ts  →  Authorization: Bearer <JWT from tokenStore>
            └─ backend FastAPI
                 api/auth.py        → services/… , core/security.py (JWT, bcrypt)
                 api/profiles.py    → services/profile_service.py
                 api/honeypots.py   → services/fleet_service.py
                 api/events.py      → services/event_service.py
                 api/audit.py       → services/audit_service.py
                 api/deps.py        → require_operator / require_admin
                 api/ws.py          → validates the JWT on the first message
```

Routers stay thin; logic lives in services; API layer owns HTTP concerns
(`AGENTS.md` §4).

## 6. Data model

**No migration.** The five tables already match the plan.

- `honeypots.status` stays in the schema (default `"offline"`) but becomes a
  **legacy value**: status is always derived at read time. `record_heartbeat`
  writes only `last_seen_at` and `config_version`.
- `operators.password_hash` switches from the S2 placeholder to a **bcrypt**
  hash. Seeding is idempotent: it re-hashes only when the configured password
  does **not** already verify against the stored hash (bcrypt salts differ on
  every call, so a blind re-hash would rotate the row each run).
- The demo seeds two operators: `admin` (role `admin`) from
  `OPERATOR_USERNAME`/`OPERATOR_PASSWORD`, and `analyst` (role `analyst`) from
  `ANALYST_USERNAME`/`ANALYST_PASSWORD` when set. There is **no
  operator-management API** in S4 — provisioning stays operator-side, per
  `AGENTS.md` §10.

Derivation rule: a honeypot is `online` when `last_seen_at` is set and
`now - last_seen_at <= fleet_offline_after_s`; otherwise `offline`; `never` when
`last_seen_at IS NULL`.

## 7. Auth & roles

**Password hashing (bcrypt):**
- `hash_password(pw) -> str`, `verify_password(pw, hash) -> bool`.
- bcrypt's 72-byte input limit is acknowledged; inputs are validated for length
  before hashing/verifying.

**JWT (PyJWT, HS256):**
- Claims: `sub` (operator id), `role`, `iat`, `exp`, `jti`.
- `create_access_token(operator) -> str`, `decode_access_token(token) -> claims`.
- Secret from `JWT_SECRET` (dev placeholder default in `core/config.py`, real
  value in `.env.example`); lifetime from `JWT_EXPIRES_MINUTES` (default 60).
  The app refuses to start when `JWT_SECRET` is blank and logs a warning when
  the documented dev placeholder is still in use. Passwords are capped at
  bcrypt's 72-byte input limit; longer logins are rejected.

**Dependencies (`api/deps.py`):**
- `require_operator` → parse `Authorization: Bearer`, decode + validate the JWT,
  load the `Operator`, and return it. 401 on missing/invalid/expired/unknown.
- `require_admin` → depends on `require_operator`; 403 unless `role == "admin"`.

**Permission map**

| Surface | Guard |
|---|---|
| `POST /api/auth/login` | public |
| `GET /api/auth/me` | `require_operator` |
| `GET /api/profiles`, `GET /api/profiles/{id}` | `require_operator` |
| `POST/PATCH/DELETE /api/profiles…` | `require_admin` |
| `GET /api/honeypots`, `GET /api/honeypots/{id}` | `require_operator` |
| `POST /api/honeypots/register` | `require_admin` |
| `GET /api/events` | `require_operator` |
| `GET /api/audit-logs` | `require_operator` |
| `/api/agent/*`, `/api/telemetry/*` | per-agent token (unchanged) |
| `/api/ws/events` | JWT in the first message |

**WebSocket:** the first-message handshake `{"type":"auth","token": <JWT>}` is
validated with `decode_access_token`; invalid/expired → close `1008`.
Credentials still never appear in the URL.

## 8. API contract

### Auth
- `POST /api/auth/login` — body `{username, password}` → 200
  `{access_token, token_type:"bearer", expires_in, operator:{id, username, role}}`.
  Bad credentials → 401 with a generic message (no user-enumeration signal).
- `GET /api/auth/me` — 200 `{id, username, role}`.

### Profiles
- `GET /api/profiles` → 200 `[{id, name, interaction_level, version, created_at, updated_at}]`.
- `POST /api/profiles` — `{name, interaction_level, config}` → 201 profile (with
  `config`). Duplicate name → 409; invalid config → 422.
- `GET /api/profiles/{id}` → 200 profile (incl. `config`); 404 unknown.
- `PATCH /api/profiles/{id}` — any of `{name, interaction_level, config}`; the
  full resulting config is validated, then `version += 1`; 404 / 409 / 422.
- `DELETE /api/profiles/{id}` → 204; **409 when a honeypot references it**; 404.

### Honeypots
- `POST /api/honeypots/register` — `{name, profile_id}` → 201
  `{id, name, profile_id, agent_token}`. The plaintext `agent_token` is returned
  **once** and never retrievable again (only its hash is stored). 404 unknown
  profile; 409 duplicate name.
- `GET /api/honeypots` → 200 `[{id, name, profile:{id,name,interaction_level,version},
  config_version, status, last_seen_at, created_at}]`.
- `GET /api/honeypots/{id}` → 200 the same row; 404.

### Events
- `GET /api/events` — filters `honeypot_id`, `event_type`, `source_ip`, `q`,
  `since`, `until`; pagination `limit` (1–200, default 50), `offset`.
  `q` matches `event_type` OR `details::text` (case-insensitive). Response
  `{items, total}`.

### Audit
- `GET /api/audit-logs` — filters `operator_id`, `action`, `resource_type`,
  `since`, `until`; pagination `limit` (1–200, default 50), `offset`;
  newest-first. Response `{items, total}` with item
  `{id, operator_id, action, resource_type, resource_id, created_at}`.

## 9. Services

- `security.py`: `hash_password`, `verify_password`, `create_access_token`,
  `decode_access_token` (alongside the existing agent-token helpers).
- `profile_service.py`: add `list_profiles`, `create_profile`, `delete_profile`
  (in-use guard); keep `get_profile`/`update_profile` (version bump already
  correct).
- `fleet_service.py`: add `list_honeypots` (with derived status),
  `register_honeypot` (generate token, store hash, return plaintext once);
  `record_heartbeat` drops the `status` write.
- `audit_service.py` (new): `record(db, operator_id, action, resource_type,
  resource_id)` and `list_audit_logs(db, filters, limit, offset)`.
- `event_service.py`: add the optional `q` condition to `list_events`.

Audited actions: `login`, `login_failed`, `profile_created`, `profile_updated`,
`profile_deleted`, `honeypot_registered`. Audit rows store identifiers and
timestamps only — **no secrets, tokens, passwords, or request bodies**.

## 10. Frontend

- `react-router-dom` routes: `/login`, `/` → redirect `/fleet`, `/fleet`,
  `/profiles`, `/events`, `/audit`.
- `api/client.ts`: `tokenStore` over `localStorage` (`hf_token`); `apiFetch`
  attaches `Authorization: Bearer`; a 401 clears the token and redirects to
  `/login`. Typed helpers per endpoint; shared `Page<T>`.
- `auth/AuthContext.tsx`: `{operator, login, logout}`, hydrated via
  `GET /api/auth/me`; `RequireAuth` gate.
- Pages:
  - **Login** — credentials → store token → `/fleet`.
  - **Fleet** — table (name, level, status badge, last seen, profile + version,
    config version); admin register form revealing the agent token **once**.
  - **Profiles** — table + create/edit with level-specific fields (`ports`,
    `banner` for low; `ports`, `title`, `login_enabled` for medium) + delete;
    version shown. Write controls hidden for `analyst`.
  - **Events** — filters + paginated table; selecting a row shows its detail
    (rendered from the fetched `details` JSON — no extra endpoint); live tail
    reuses `EventFeed`/`useEventStream`.
  - **Audit** — filterable table.
- App shell: nav, current operator + role, logout; dark security-ops theme
  (cyan/electric-blue accents, high contrast, no decorative animation);
  reuse `StatusBadge`.
- `useEventStream` reads the JWT from the token store; dedupe/reconnect/backfill
  unchanged.

## 11. Error handling

- Consistent JSON error bodies (`detail`).
- 401 invalid/missing/expired token and bad login; 403 wrong role; 404 unknown
  resource; 409 duplicate name or in-use profile; 422 validation.
- Startup validation of `JWT_SECRET`: a blank value fails fast; the dev
  placeholder logs a warning.
- Failed logins are audited (`login_failed`) without recording the password.

## 12. Security notes / threat-model updates

- Retire `DEV_OPERATOR_TOKEN`; the static token is no longer accepted.
- `docs/threat-model.md` gains: the localStorage-JWT limit (XSS can exfiltrate
  the token; mitigated, not eliminated, by a strict CSP later), the
  access-token-only limit (no revocation/rotation), and the fact that login is
  not yet rate-limited (S6).
- Register returns the agent token once; the audit trail never stores it.
- `AGENTS.md` §10 "Operator auth in S2 is the static `DEV_OPERATOR_TOKEN`…"
  becomes superseded and must be updated.

## 13. Testing

**Backend (pytest, `TEST_DATABASE_URL`):**
- `test_auth.py`: login success returns a usable JWT; wrong password → 401;
  `GET /api/auth/me` round-trip; forged and expired tokens → 401; `analyst`
  gets 403 on every write route and 200 on reads; `admin` passes.
- `test_passwords.py`: hash ≠ plaintext; verify round-trip; wrong password
  fails; the stored hash never contains the password.
- `test_profiles_api.py`: create/list/get/patch (version bumps)/delete; 409
  duplicate; 409 delete-in-use; 422 bad config; 404s.
- `test_honeypots_api.py`: register returns a token that authenticates as that
  agent and stores only a hash; 404/409; fleet list derives online/offline/never
  from `last_seen_at`.
- `test_audit_api.py`: each action writes a row; filters + pagination; no secret
  appears in any `audit_logs` field.
- `conftest.py` gains an operator-login fixture that creates `admin` and
  `analyst` operators with known passwords and returns each JWT; update
  `test_events_query.py`, `test_agent_auth.py`, `test_ws.py` to use it instead
  of the static token, and add a `q` filter case.

**Frontend (vitest + testing-library):** token store + client attach/401;
`RequireAuth` redirect; login flow; a fleet-page render; keep `EventFeed` green.

**Verifiable commands:** `docker compose run --rm backend pytest`;
`cd frontend; npm test`; a documented `curl` login → create profile → register
honeypot → list fleet sequence for the demo.

## 14. Dependencies & configuration

- Backend deps: `pyjwt`, `bcrypt`.
- New env (`.env.example` + `core/config.py`): `JWT_SECRET`,
  `JWT_EXPIRES_MINUTES=60`, `OPERATOR_USERNAME=admin`, `OPERATOR_PASSWORD=…`,
  `ANALYST_USERNAME=analyst`, `ANALYST_PASSWORD=…` (optional),
  `FLEET_OFFLINE_AFTER_S=45`.
- Removed: `DEV_OPERATOR_TOKEN`, frontend `VITE_OPERATOR_TOKEN`.
- `docker-compose.yml` wiring updated to match (backend env; the frontend no
  longer receives an operator token).
- `seed.py` reads the operator env vars and stores/updates the bcrypt hashes
  (verify-before-rehash).

## 15. Demoable outcome

With the stack up and seeded: log in as `admin`, create a profile (version 1),
edit it (version 2) and watch the matching honeypot adopt v2, register a new
honeypot and copy its one-time token, view the fleet with live status, filter
the event feed, and see every action in the audit log. Log in as an `analyst`
account and confirm the write controls are gone and the API returns 403.
