# AGENTS.md — HoneyForge

Working agreement for any AI agent (or human) contributing to this repository.
Read this before touching code. It encodes the rules that keep seven fast slices
from drifting into a rewrite.

---

## 1. What this is

HoneyForge is a centralized honeypot control plane built for UMIRHack 2026
(Case 1, Madrigal). An operator configures a honeypot profile in the control
center; a registered agent retrieves its authorized configuration; a decoy
service records attacker interaction as events; the agent buffers telemetry and
ships it over a protected channel; the control center validates and persists it
in PostgreSQL; the React dashboard shows it in near-real time.

**Two interaction levels are mandatory: Low (TCP banner emulation) and Medium
(fake HTTP admin panel). High-interaction is explicitly out of scope.**

The full specification lives in `docs/HoneyForge_Implementation_Plan.md`. This
file is the operational short form. When they conflict, the spec wins — and fix
this file.

### Pipeline

```
operator → profile (versioned) → agent fetches config → decoy records event
        → agent JSONL buffer → batch POST /api/telemetry/events (TLS)
        → validate + idempotent insert (Postgres) → WebSocket broadcast → React feed
```

---

## 2. Repository map

```text
honeyforge/
├── docker-compose.yml          # the only supported way to run the stack
├── .env.example                # every required variable, no real secrets
├── backend/                    # FastAPI control center
│   ├── app/
│   │   ├── main.py
│   │   ├── api/                # auth, profiles, honeypots, telemetry, events
│   │   ├── core/               # config.py, security.py
│   │   ├── models/             # SQLAlchemy 2.x models
│   │   ├── schemas/            # Pydantic request/response models
│   │   ├── services/           # profile, fleet, event logic
│   │   ├── realtime/           # websocket_manager.py
│   │   └── db/                 # session.py, base.py
│   ├── alembic/                # migrations
│   └── tests/
├── agent/                      # shared Python agent (both decoys)
│   ├── agent.py, config_client.py, telemetry_client.py,
│   ├── heartbeat.py, event_buffer.py
│   └── tests/
├── honeypots/
│   ├── low/server.py           # TCP banner emulation
│   └── medium/fake_service.py  # fake HTTP admin panel
├── frontend/                   # React + TypeScript + Vite
│   └── src/{api,components,hooks,pages,types}
├── nginx/                      # reverse proxy + TLS (stretch)
└── docs/                       # architecture, db schema, threat model, demo script
```

---

## 3. Canonical commands

Run everything through Docker where possible. Windows host with Docker Desktop.

```bash
docker compose up --build          # start the whole stack
docker compose down -v             # tear down, drop volumes
docker compose logs -f backend     # tail a service

# database migrations (inside backend container or local venv)
alembic upgrade head
alembic revision --autogenerate -m "message"

# backend tests
docker compose run --rm backend pytest
# agent tests
docker compose run --rm agent pytest
# frontend
cd frontend && npm run dev
cd frontend && npm test
```

> The skeleton, `docker-compose.yml`, and test harness are created in Slice S1.
> Until then these commands are the target, not the current state.

---

## 4. Engineering conventions

**Backend (Python 3.11+)**
- FastAPI + Pydantic for all request/response and config validation.
- SQLAlchemy 2.x style (typed `Mapped[...]`, `mapped_column`). Alembic for every
  schema change — no manual DDL.
- Type hints on public functions. Format/lint with ruff.
- Services hold logic; API routers stay thin.

**Agent (Python)**
- One shared implementation used by both decoys.
- Bounded exponential backoff **with jitter** on all retries.

**Frontend (React + TypeScript + Vite)**
- Functional components, typed API client, Tailwind for styling.
- Dark security-ops theme: restrained cyan/electric-blue accents, high contrast,
  clear status labels. No decorative animation.
- Fetch history via REST, then attach to the authenticated WebSocket.

**Time & data**
- All timestamps UTC. Keep `occurred_at` (decoy observed) and `received_at`
  (center accepted) distinct.
- Validate payload size and fields before insert.

---

## 5. Non-negotiable rules

These are the mistakes that silently break the design. Do not work around them.

1. **Event IDs are generated on the agent** as UUIDs, before transmission. A
   retry reuses the same ID. `attack_events.id` has a uniqueness constraint so
   ingestion is idempotent.
2. **Per-agent credentials only.** Each agent gets its own random token; the
   center stores only the hash. Never introduce a shared bearer token. An agent
   can only read *its own* config and submit *its own* telemetry.
3. **Never store plaintext passwords** typed into decoy login forms. Record that
   an attempt happened plus safe metadata (e.g. boolean/length/category). Never
   the submitted secret.
4. **Never commit secrets.** Real credentials, private keys, and production
   certs stay out of Git. Use env vars / a secret store; keep `.env.example`
   current.
5. **Decoys never get host exposure or production access.** They live on
   `decoy_net`. No Docker socket access. No forwarding to real internal services.
6. **Synthetic and safe data only.** Use reserved documentation IPs for sample
   events. Do not scan or attack third-party systems.
7. **Honesty over hype.** Never claim a channel is "undetectable" or that
   route obscurity is authentication. Document exactly what is protected and
   what is not.
8. **Promote events only after acknowledgement.** The agent removes a buffered
   event only when the center confirms it (accepted or duplicate).

---

## 6. Networks and trust boundaries

Defined in Compose from S1. Segmentation is foundational, not optional. The four non-host networks are `internal: true` (no gateway, no LAN/internet egress).

| Network | Members | Purpose |
|---|---|---|
| `frontend_net` | reverse proxy, frontend, backend | browser-facing (host ports bound `127.0.0.1`) |
| `control_net` | backend, database | management plane |
| `telemetry_net` | backend, agent | center ↔ agent |
| `agent_decoy_net` | agent, decoys | decoys report to the agent |
| `decoy_net` | decoys, test client | attacker-facing, isolated |

The agent is **never** on `decoy_net`. Its internal `/ingest` is not open to the attacker plane; decoys authenticate to it with `AGENT_INGEST_SECRET`. Docker network segmentation is **not** a complete security boundary. The threat model and its limits are documented in `docs/threat-model.md`.

---

## 7. Build order — the slice ladder

Each slice ends in something runnable. **Do not start a slice until the previous
one passes the gate below.**

| Slice | Goal |
|---|---|
| **S1** | Skeleton, real schema (all five core tables), five networks, stack comes up |
| **S2** | Golden path with **real interfaces**: per-agent auth, profile/config versioning, agent-generated event IDs, Low decoy, JSONL buffer, batch/ack, live React feed |
| **S3** | Medium decoy (fake HTTP admin panel) on the same config/auth path |
| **S4** | Control center API **and its minimal UI together**: operator JWT auth + roles, profile CRUD + version bump, controlled registration, fleet + heartbeat, event filters/pagination, audit logs |
| **S5** | Dashboard experience (improves, does not introduce): overview, charts, detail views, WS reconnect + history gap-fill, theme polish |
| **S6** | Reliability & security: buffer/retry under forced outage, DB persistence through restart, rate limits/payload caps, expanded tests, Nginx + TLS if time + encryption matrix |
| **S7** | Docs & demo: README, architecture + DB diagrams, threat model, API docs, seed data, demo script, fallback recording |

**S2 must already contain real shapes** for event identity, profile versioning,
and agent authorization. Do not defer them to S4 "proper" — that forces a
rewrite of the golden path.

---

## 8. The per-slice gate

For every slice, require **all three** before moving on:

1. **Runnable** — the feature starts in the Docker Compose environment.
2. **Verifiable** — there is a concrete test or command proving it works.
   Prefer an automated test; a documented reproducible command is the fallback
   where a test is expensive (mostly UI).
3. **Demoable** — you can show its result without relying on luck or manually
   editing the database.

This is the *per-slice* gate. It is not the project Definition of Done.

### Review checkpoints

A fresh reviewer runs at three points, not per task:

1. **After Task 6** (S1 complete) — stack up, schema migrated, segmentation in place.
2. **After Task 13** — backend complete, before the agent work starts.
3. **After Task 21** — the S2 golden-path milestone.

Fix issues found at each checkpoint before continuing.

---

## 9. Definition of Done (project level)

HoneyForge is ready to submit only when all are true:

- [ ] Clean startup through Docker Compose.
- [ ] Operator authentication works.
- [ ] Profiles can be created and assigned.
- [ ] At least two honeypots registered: one Low, one Medium.
- [ ] Fleet status and last-seen shown.
- [ ] Agent configuration retrieval works.
- [ ] Telemetry is sent over TLS and authenticated.
- [ ] Events stored and filterable in PostgreSQL.
- [ ] Agent buffering and retry tested.
- [ ] New events appear in the dashboard in near-real time.
- [ ] Network separation and security boundaries documented.
- [ ] README, architecture diagram, DB diagram, API docs present.
- [ ] End-to-end demo works repeatedly.

**Nothing is done until it is implemented, tested, and observable.**

---

## 10. Known deviations & scope boundaries

Deliberate simplifications for the time budget. **Do not "fix" these** without
discussion — they are choices, not oversights.

- Local agent buffer is a **JSON Lines spool**, not SQLite.
- Realtime uses **in-process FastAPI WebSockets**, no Redis/message broker.
- Agent authentication is a **per-agent token** (hashed), not mTLS.
- Operator auth in S2 is the static `DEV_OPERATOR_TOKEN` (e.g. `require_operator`),
  replaced by JWT + roles in S4. It ships in the Vite bundle — perimeter only,
  documented as such.
- The agent's internal `/ingest` is protected by the shared `AGENT_INGEST_SECRET`,
  not per-decoy credentials.
- `attack_events` cascade-deletes with its honeypot. Recorded tradeoff: honeypot
  decommission destroys its events. Revisit before S6.
- Backend tests run against `TEST_DATABASE_URL`, never the demo DB.
- WebSocket auth is a first-message handshake (credentials never in URLs).
- **Nginx + TLS is a stretch item.** If deferred, connections run plaintext and
  the encryption matrix must say so precisely.
- High-interaction honeypots are **out of scope**.
- Bonus features (alerts, IOC export, honeytokens, one-click deploy) are **only**
  attempted after the mandatory flow works.
- Honeypot registration is **operator-provisioned**; never open enrollment.

---

## 11. Current focus

- **Slice:** S1 — skeleton, real schema, segmentation.
- **Next milestone:** a controlled connection to the Low decoy appears as a
  persisted event in the React dashboard (S2).
