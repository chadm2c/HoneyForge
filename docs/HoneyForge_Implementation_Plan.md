# HoneyForge — Solo Hackathon Implementation Plan

**Event:** UMIRHack 2026  
**Case:** Case 1 — HoneyForge (Madrigal)  
**Implementation strategy:** Balanced  
**Team size:** One developer  
**Frontend:** React + TypeScript  
**Primary objective:** Deliver a secure, reproducible MVP that demonstrates the complete flow from activity against an isolated honeypot to near-real-time visibility in a centralized dashboard.

---

## 1. Source requirements and project objective

This plan is based on the six-page HoneyForge case brief provided for UMIRHack. The brief asks for a centralized platform to configure, deploy, and monitor honeypots with different interaction levels.

The required end-to-end flow is:

1. An operator configures a honeypot profile in the control center.
2. A registered agent retrieves its authorized configuration.
3. A test client interacts with a honeypot service.
4. The honeypot records the interaction as an event.
5. The agent sends telemetry to the control center through a protected channel.
6. The center validates and persists the event in PostgreSQL.
7. The dashboard receives and displays the event in near-real time.

The MVP must include a working **Low-interaction** honeypot and a working **Medium-interaction** honeypot. A High-interaction honeypot is optional and should not be attempted until the mandatory requirements are complete.

### 1.1 Mandatory requirements from the brief

- Central architecture connecting the control center, agents, storage, and UI.
- API to manage honeypot profiles.
- Registration of honeypots and profile assignment.
- Fleet view showing online/offline status and last-seen time.
- Agent configuration retrieval and telemetry submission.
- Attack-event storage in PostgreSQL and filtering by honeypot, time, source, and event type.
- Operator authentication and access control.
- At least two interaction levels: Low and Medium.
- Logging of connection attempts and relevant service requests/authentication attempts.
- Periodic telemetry delivery and configuration refresh.
- Local event buffering and retransmission after a temporary connection failure.
- Basic channel protection/concealment: TLS, a non-obvious management endpoint behind a normal web entry point, and network/interface separation where feasible.
- A dashboard with fleet status and a near-real-time event feed.
- Docker Compose deployment.
- README, architecture diagram, database diagram, API/profile documentation, and a repeatable demo.

### 1.2 Bonus requirements in the brief

Only consider these after the mandatory flow is working:

- One-click generation and deployment of a honeypot artifact on a remote host.
- Automated rules and alerts.
- IOC export, for example CSV or STIX.
- High-interaction honeypot in a strictly isolated VM/container sandbox.
- Honeytokens and recording their activation.
- Beacon jitter/randomization, mutual TLS, key rotation, and more advanced anti-fingerprinting.

Do not let bonus work delay completion of the mandatory requirements.

---

## 2. Scope and design principles

### 2.1 Balanced MVP

Build a modular control-center backend, a React dashboard, one reusable agent implementation, and two separate honeypot services.

Use a fake HTTP admin panel for the Medium-interaction honeypot. This is a manageable way to emulate application behavior without implementing an SSH protocol emulator. The Low-interaction honeypot should provide basic TCP service/port responses and record connection attempts.

### 2.2 Engineering principles

- Prioritize end-to-end functionality over the number of features.
- Keep the control center modular, but do not split every module into a separate microservice.
- Use one agent implementation for both honeypots where possible.
- Store durable state in PostgreSQL.
- Buffer telemetry locally at the agent and retry safely.
- Use event IDs/idempotency to prevent duplicate events on retries.
- Keep timestamps in UTC and record both event time and center receipt time.
- Use synthetic data for demos.
- Do not store plaintext passwords entered into decoy login forms. Record sanitized authentication-attempt metadata and use synthetic credentials only.
- Do not expose intentionally vulnerable services to the public internet. Run honeypots in an isolated lab network.
- Keep secrets out of source control and use environment variables or a secret store.
- Avoid claiming that a channel is “undetectable.” Implement and document the specific protections actually achieved.

---

## 3. Recommended architecture

### 3.1 Logical components

**A. React + TypeScript Web UI**
- Operator login.
- Overview dashboard.
- Honeypot fleet list and details.
- Profile builder.
- Event feed and filters.
- Event detail view.
- Audit/settings view.
- WebSocket client for live events.

**B. FastAPI control center**
- REST API for operators, profiles, honeypots, and events.
- Agent endpoints for registration (as controlled by the demo setup), configuration retrieval, heartbeat, and telemetry submission.
- Authentication and authorization.
- Profile/configuration service.
- Fleet status service.
- Telemetry validation and ingestion service.
- PostgreSQL persistence.
- WebSocket event manager.
- Audit logging.

**C. PostgreSQL**
- Operator accounts and roles.
- Honeypot profiles and versioned configuration.
- Registered honeypots and agent credential hashes.
- Attack events.
- Operator audit records.

**D. Agent**
- Authenticated configuration polling.
- Heartbeat.
- Event collection from the local honeypot.
- Durable local buffer (SQLite or JSON Lines spool file).
- Retry and resend after temporary outages.
- Deduplication/idempotency support.
- Configuration version tracking.

**E. Low-interaction honeypot**
- Basic TCP listener/service-banner emulation.
- Record connection and probe metadata.
- No real shell or real backend service.

**F. Medium-interaction honeypot**
- Fake HTTP admin application.
- Simulated login and navigation endpoints.
- Record HTTP method, path/category, source metadata, timestamp, and sanitized auth-attempt metadata.
- No real command execution, shell, or connection to production systems.

**G. Nginx**
- TLS termination and reverse proxy.
- Route browser/API traffic to the control center.
- Expose only intended endpoints.
- Apply access controls and rate limits where appropriate.
- Keep the agent management path separated from the decoy-facing network wherever feasible.

### 3.2 Data flow

1. Operator signs in.
2. Operator creates or updates a profile.
3. Profile is stored in PostgreSQL with a monotonically increasing version.
4. Agent authenticates and fetches its own authorized configuration.
5. Agent applies the configuration to its local decoy service.
6. Decoy records test activity.
7. Agent places events in its durable local buffer.
8. Agent sends a batch to the telemetry endpoint over TLS.
9. Center authenticates the agent, validates the payload, and stores events.
10. After successful persistence, the center acknowledges accepted event IDs.
11. Center publishes new events to authenticated WebSocket subscribers.
12. React updates the event feed without a full page reload.

### 3.3 Network and trust boundaries

Keep the operator/control plane separate from the decoy-facing plane as much as the demo environment permits. The attacker/test client should interact only with the decoy service, not PostgreSQL or operator APIs. Agent credentials must be scoped to the individual agent. Do not give a honeypot container unrestricted access to the Docker socket or host.

For a local demo, use separate Docker networks where possible:
- `frontend_net`: browser-facing reverse proxy and UI.
- `control_net`: backend and database.
- `decoy_net`: test client and decoy services.
- A narrowly permitted telemetry path from the agent to the center.

Docker network segmentation alone is not a complete security boundary. Document the demo threat model and avoid exposing decoys outside the isolated host/network.

---

## 4. Technology stack

| Layer | Technology | Reason |
|---|---|---|
| Frontend | React + TypeScript + Vite | Fast development and typed UI |
| UI styling | Tailwind CSS or CSS modules | Consistent, responsive dashboard |
| Charts | Recharts or Chart.js | Simple event/activity charts |
| Backend | Python 3.11+ and FastAPI | Matches the case's recommended stack |
| Validation | Pydantic | Request/config/event validation |
| ORM | SQLAlchemy 2.x | Database models and queries |
| Migrations | Alembic | Repeatable schema changes |
| Database | PostgreSQL | Required durable event storage |
| Realtime | FastAPI WebSockets | Avoid a separate Node.js service |
| Agent | Python | Shared implementation for both honeypots |
| Local agent buffer | SQLite or JSON Lines spool | Retry after connectivity loss |
| Reverse proxy/TLS | Nginx | TLS termination and route separation |
| Packaging | Docker and Docker Compose | Reproducible complete stack |
| Testing | pytest, HTTPX, frontend test tools | Validate API and UI behavior |

Use pinned dependencies and a `.env.example`. Do not commit real credentials, private keys, or production certificates.

---

## 5. Database schema

Start with five core tables. Add tables only when an implemented feature requires them.

### 5.1 `operators`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `username` | VARCHAR | Unique |
| `password_hash` | TEXT | Never store plaintext passwords |
| `role` | VARCHAR | For example `admin` or `analyst` |
| `created_at` | TIMESTAMPTZ | Creation time |

### 5.2 `profiles`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `name` | VARCHAR | Human-readable profile name |
| `interaction_level` | VARCHAR | Constrained to `low` or `medium` for MVP |
| `config` | JSONB | Validated service, banner, and logging options |
| `version` | INTEGER | Increment when configuration changes |
| `created_at` | TIMESTAMPTZ | Creation time |
| `updated_at` | TIMESTAMPTZ | Last update |

### 5.3 `honeypots`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `name` | VARCHAR | Friendly name |
| `agent_token_hash` | TEXT | Hash of random agent credential |
| `profile_id` | UUID, FK | Assigned profile |
| `status` | VARCHAR | Derived/maintained online or offline state |
| `last_seen_at` | TIMESTAMPTZ | Last successful heartbeat |
| `config_version` | INTEGER | Last version acknowledged by agent |
| `created_at` | TIMESTAMPTZ | Registration time |

Agent registration should be controlled by the operator or pre-provisioned for the hackathon demo. Do not allow arbitrary unauthenticated callers to create trusted agents.

### 5.4 `attack_events`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Event ID and idempotency key |
| `honeypot_id` | UUID, FK | Originating honeypot |
| `event_type` | VARCHAR | For example `connection`, `auth_attempt`, `http_request` |
| `source_ip` | INET, nullable | Observed peer address |
| `source_port` | INTEGER, nullable | Observed peer port |
| `target_port` | INTEGER, nullable | Decoy service port |
| `protocol` | VARCHAR | TCP or HTTP-like |
| `details` | JSONB | Sanitized event-specific metadata |
| `occurred_at` | TIMESTAMPTZ | Time observed by decoy |
| `received_at` | TIMESTAMPTZ | Time accepted by center |

Index `honeypot_id + occurred_at`, `source_ip`, and `event_type + occurred_at`. Validate the maximum payload size and fields before inserting data.

### 5.5 `audit_logs`

| Column | Type | Notes |
|---|---|---|
| `id` | BIGINT | Primary key |
| `operator_id` | UUID, nullable FK | Actor |
| `action` | VARCHAR | For example login or profile update |
| `resource_type` | VARCHAR | Affected entity type |
| `resource_id` | UUID, nullable | Affected entity |
| `created_at` | TIMESTAMPTZ | Action time |

### 5.6 Relationships

- One profile can be assigned to multiple honeypots.
- One honeypot can generate many attack events.
- One operator can perform many audit actions.

### 5.7 Data-handling rules

- Use UTC timestamps and keep `occurred_at` distinct from `received_at`.
- Generate event IDs before transmission so a retry reuses the same ID.
- Use a uniqueness constraint on event IDs to make ingestion idempotent.
- Never retain plaintext passwords typed into fake login forms. Record that an attempt occurred and, if useful, store a safe boolean/length/category rather than the submitted secret.
- Treat uploaded files and captured payloads as untrusted. File capture is not needed for the balanced MVP.
- Consider a retention limit for event data.

---

## 6. Repository structure

```text
honeyforge/
├── docker-compose.yml
├── .env.example
├── .gitignore
├── README.md
├── docs/
│   ├── architecture.md
│   ├── database-schema.md
│   ├── threat-model.md
│   └── demo-script.md
├── backend/
│   ├── Dockerfile
│   ├── pyproject.toml
│   ├── alembic.ini
│   ├── alembic/
│   ├── app/
│   │   ├── main.py
│   │   ├── api/
│   │   │   ├── auth.py
│   │   │   ├── profiles.py
│   │   │   ├── honeypots.py
│   │   │   ├── telemetry.py
│   │   │   └── events.py
│   │   ├── core/
│   │   │   ├── config.py
│   │   │   └── security.py
│   │   ├── models/
│   │   ├── schemas/
│   │   ├── services/
│   │   │   ├── profile_service.py
│   │   │   ├── fleet_service.py
│   │   │   └── event_service.py
│   │   ├── realtime/
│   │   │   └── websocket_manager.py
│   │   └── db/
│   │       ├── session.py
│   │       └── base.py
│   └── tests/
├── agent/
│   ├── Dockerfile
│   ├── agent.py
│   ├── config_client.py
│   ├── telemetry_client.py
│   ├── heartbeat.py
│   ├── event_buffer.py
│   └── tests/
├── honeypots/
│   ├── low/
│   │   ├── Dockerfile
│   │   └── server.py
│   └── medium/
│       ├── Dockerfile
│       └── fake_service.py
├── frontend/
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── api/
│       ├── components/
│       ├── hooks/
│       ├── pages/
│       ├── types/
│       └── App.tsx
└── nginx/
    ├── nginx.conf
    └── certs/
        └── README.md
```

Keep private certificates and secrets out of Git. The `certs` directory should contain documentation or instructions for creating development certificates, not private keys.

---

## 7. API contract

Define the contract early so the frontend, agent, and backend can be developed independently.

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/auth/login` | Operator authentication |
| `GET` | `/api/profiles` | List profiles |
| `POST` | `/api/profiles` | Create profile |
| `GET` | `/api/profiles/{id}` | Profile details |
| `PATCH` | `/api/profiles/{id}` | Update profile and increment version |
| `DELETE` | `/api/profiles/{id}` | Delete profile if not in use, or reject safely |
| `POST` | `/api/honeypots/register` | Controlled registration/provisioning |
| `GET` | `/api/honeypots` | List fleet and statuses |
| `GET` | `/api/agent/config` | Agent retrieves its authorized config |
| `POST` | `/api/agent/heartbeat` | Update last-seen time and config acknowledgement |
| `POST` | `/api/telemetry/events` | Submit a batch of events |
| `GET` | `/api/events` | Filter and paginate events |
| `GET` | `/api/ws/events` | Authenticated live event stream |

### API behavior requirements

- Validate all requests with Pydantic.
- Require operator authentication for management endpoints.
- Use separate random credentials for each agent. Store credential hashes centrally.
- Scope agent credentials to that agent's own configuration and telemetry submission.
- Apply rate limits and reasonable payload limits.
- Do not put secrets in URLs or logs.
- Return acknowledgements containing accepted/duplicate event IDs so the agent can safely remove confirmed events from its local buffer.
- Authenticate WebSocket connections; do not broadcast data to unauthenticated clients.
- Use pagination for event lists and validate filter inputs.

---

## 8. Frontend requirements

### 8.1 Pages

**Overview**
- Total registered honeypots.
- Online/offline counts.
- Event count for a selected period.
- Recent activity feed.
- Simple event-volume chart if time permits.

**Honeypots**
- Name, interaction level, status, last seen, profile, and configuration version.
- Detail panel with recent events.

**Profiles**
- Create/edit profile.
- Select Low or Medium interaction level.
- Configure allowed service ports, banners, and logging options.
- Show the current configuration version.

**Events**
- Searchable/paginated table.
- Filters for honeypot, time range, source IP, and event type.
- Event detail view with sanitized metadata.

**Audit/settings**
- Operator action history.
- Basic system information and authenticated session controls.

### 8.2 UI design direction

Use a dark security-operations theme with restrained cyan/electric-blue accents, strong contrast, clear status labels, and readable tables. Avoid overloading the interface with animations. The live event feed and clear event details matter more than decorative graphics.

### 8.3 Realtime behavior

- Fetch initial event history through REST.
- Establish an authenticated WebSocket connection.
- Append new events as they arrive.
- Reconnect with backoff after disconnection.
- On reconnect, fetch recent history to fill any gap.
- Avoid adding the same event twice if it arrives through both the history fetch and WebSocket.

---

## 9. Agent and honeypot behavior

### 9.1 Shared agent

The agent should:
1. Load its provisioned ID and credential from environment variables or a mounted secret file.
2. Authenticate to the center over TLS.
3. Send periodic heartbeats.
4. Fetch configuration and compare its version with the currently applied version.
5. Receive local events from the honeypot process.
6. Append events to durable local storage before attempting network transmission.
7. Send batches of buffered events.
8. Remove events from the buffer only after explicit acknowledgement.
9. Retry transient failures with bounded exponential backoff and jitter.
10. Resume delivery after a center outage without silently dropping events.

Keep agent credentials out of image layers and source code. Do not grant the agent unrestricted access to the Docker socket.

### 9.2 Low-interaction honeypot

Implement a basic TCP listener or small set of listeners that:
- Record accepted connections and observed source metadata.
- Optionally return a configured, synthetic service banner.
- Record probe/banner interaction events.
- Never start a real shell or forward requests to production services.

The goal is to capture connection/probe activity, not to emulate a full operating system.

### 9.3 Medium-interaction honeypot

Implement a fake HTTP admin panel with:
- A realistic but synthetic login page.
- A few simulated routes or navigation options.
- Events for HTTP requests, path probes, and authentication attempts.
- A fake filesystem or static simulated content only if time permits.
- No actual command execution, shell access, or connection to real internal services.

Record only sanitized authentication-attempt metadata. Do not save submitted passwords.

### 9.4 Safe test activity

Run tests from a dedicated test container or local test client on the isolated lab network. Use synthetic requests and reserved documentation IPs for sample data. Do not scan or attack third-party systems.

---

## 10. Security and channel protection

The brief specifically emphasizes that the attacker should interact only with the decoy and should not be able to access the center or identify an obvious management path.

### Mandatory baseline

- TLS for telemetry and operator traffic.
- Agent authentication and per-agent authorization.
- Separate operator and agent authentication.
- Restricted network access between decoy-facing and management components.
- No production-network access from honeypots.
- Non-obvious management route behind Nginx, without treating route obscurity as authentication.
- Strong operator password hashing and safe session/token handling.
- Secrets provided through environment variables or a secret store.
- Request validation, payload limits, and rate limiting.
- Audit logs for sensitive operator actions.
- No private keys or real credentials committed to the repository.

### Important honesty in the demo

A reverse proxy and TLS do not make a management channel invisible. Explain exactly what the MVP protects, what is isolated, and what has not been implemented. Do not claim resistance to advanced honeypot fingerprinting unless you have actually tested it.

### High-interaction scope

Do not implement High-interaction as part of the MVP. A real OS or vulnerable service requires stronger containment, resource limits, no production access, and a reliable reset/snapshot strategy. The brief classifies this level as higher risk.

---

## 11. Development phases and suggested time allocation

These percentages are planning guidance, not official deadlines.

### Phase 1 — Foundation (15%)

- Initialize repository and dependency management.
- Add Docker Compose and PostgreSQL.
- Create FastAPI health endpoint and React app.
- Add database migrations.
- Verify a clean reproducible startup.

**Exit criteria:** all base components start and communicate.

### Phase 2 — Control center (20%)

- Add authentication and roles.
- Implement profile CRUD and versioning.
- Implement controlled honeypot registration.
- Implement fleet status and heartbeat.
- Implement event ingestion, storage, filters, and pagination.
- Add audit records for key operator actions.

**Exit criteria:** API can create profiles, register test devices, store events, and query the fleet.

### Phase 3 — Agent and honeypots (25%)

- Implement Low TCP decoy.
- Implement Medium fake HTTP admin service.
- Implement shared agent and per-agent authentication.
- Add configuration polling and version acknowledgement.
- Add heartbeat and durable event buffer.
- Add batching, acknowledgements, retry, and deduplication.

**Exit criteria:** both decoys create distinct events and the agent can deliver them to the center.

### Phase 4 — Dashboard and realtime (15%)

- Implement login and overview.
- Implement fleet list and profile builder.
- Implement event feed, filters, and details.
- Add WebSocket delivery and reconnect behavior.
- Add a small chart if core behavior is stable.

**Exit criteria:** a controlled decoy interaction appears in the UI without refreshing.

### Phase 5 — Security and reliability (15%)

- Configure Nginx and TLS.
- Apply network segmentation.
- Verify access controls and input validation.
- Test buffer-and-retry behavior.
- Test database persistence through restart.
- Add API, agent, and basic UI tests.

**Exit criteria:** unauthorized access is rejected and temporary disconnection does not lose buffered events.

### Phase 6 — Documentation and demo (10%)

- Write setup instructions and `.env.example`.
- Add architecture and database diagrams.
- Document profiles and endpoints.
- Write the threat model and known limitations.
- Rehearse the demo from a clean startup.
- Prepare a fallback screenshot or short recording in case live networking fails.

**Exit criteria:** another developer can start the project using the README, and the demo can be repeated reliably.

---

## 12. Testing plan

### Backend
- Login success/failure and access-control tests.
- Profile creation, update, deletion, and version increments.
- Agent can only retrieve its own configuration.
- Telemetry payload validation and event persistence.
- Duplicate event submission does not create duplicate records.
- Event filters and pagination work.
- WebSocket rejects unauthenticated clients.

### Agent
- Successfully retrieves configuration.
- Sends heartbeat and receives version acknowledgement.
- Buffers events when the center is unavailable.
- Retries delivery after reconnection.
- Does not delete buffered events before acknowledgement.
- Duplicate delivery is handled safely.

### Honeypots
- Low decoy logs a controlled TCP connection.
- Medium decoy logs a controlled HTTP request and synthetic login attempt.
- Event metadata is accurate enough to support the demo.
- No actual shell or command execution is exposed.

### Integration
- Start the stack from a clean checkout.
- Generate a controlled test event.
- Verify it is stored in PostgreSQL.
- Verify it appears in the dashboard.
- Restart the backend and verify stored events remain.
- Temporarily disconnect the agent and verify buffered events arrive afterward.

---

## 13. Live demonstration plan

Target approximately five minutes, adjusting to the organizers' actual time limit.

### Step 1 — Explain the problem (30 seconds)
Explain why individually managed honeypots lead to fragmented telemetry and why central management helps.

### Step 2 — Show the fleet (45 seconds)
Log in, show the Low and Medium decoys online, and inspect their profiles.

### Step 3 — Generate controlled activity (60 seconds)
From a separate test container on the isolated network:
- Connect to the Low decoy.
- Make a few HTTP requests to the fake admin panel.
- Trigger a synthetic login attempt.

### Step 4 — Show the event pipeline (60 seconds)
Show the event feed updating live. Open one event and explain its source, destination service, type, and timestamp.

### Step 5 — Demonstrate reliability/security (60 seconds)
Show that unauthenticated access is rejected. If rehearsed successfully, briefly interrupt agent connectivity, create a synthetic event, reconnect, and show the buffered event arriving.

### Step 6 — Explain the architecture and roadmap (45 seconds)
Explain the two interaction levels, TLS and network separation, event buffering, and possible next features.

### Demo preparation
- Rehearse with a clean environment.
- Pre-create the operator account through a documented initialization command.
- Use seeded synthetic historical events so the dashboard does not look empty before the live test.
- Have a fallback recording or screenshots ready.
- Never rely on public internet access during the demo.

---

## 14. Bonus features: priority order

Only attempt bonus features after the mandatory end-to-end flow works.

1. **Simple alert rules:** e.g., alert after a configurable number of connection attempts within a time window.
2. **CSV IOC/event export:** useful and relatively easy to demonstrate.
3. **Honeytoken activation:** create a synthetic token and record when the decoy observes it.
4. **One-click deployment:** generate and deploy a container artifact to a controlled test host.
5. **Advanced concealment:** mutual TLS, key rotation, beacon jitter, and testing against known fingerprinting checks.
6. **High-interaction sandbox:** only if there is ample time and a safely isolated environment.

For a solo hackathon project, an implemented and tested alert rule is more valuable than several half-finished bonus features.

---

## 15. Definition of done

HoneyForge is ready to submit when all of the following are true:

- [ ] Clean startup through Docker Compose.
- [ ] Operator authentication works.
- [ ] Profiles can be created and assigned.
- [ ] At least two honeypots are registered: one Low and one Medium.
- [ ] Fleet status and last-seen values are shown.
- [ ] Agent configuration retrieval works.
- [ ] Telemetry is sent over TLS and authenticated.
- [ ] Events are stored and filterable in PostgreSQL.
- [ ] Agent buffering and retry are tested.
- [ ] New events appear in the dashboard in near-real time.
- [ ] Network separation and security boundaries are documented.
- [ ] README, architecture diagram, database diagram, and API documentation are present.
- [ ] The end-to-end demo works repeatedly.

---

## 16. Instructions for an AI agent builder

Use this document as the project specification. Implement incrementally rather than generating the entire repository in one pass.

1. First, inspect the repository and propose a concrete implementation plan.
2. Create the project skeleton, Docker Compose stack, backend, frontend, and database migrations.
3. Implement and test one vertical slice at a time: profile → agent configuration → decoy event → telemetry → PostgreSQL → WebSocket → React event feed.
4. Add the second interaction level and reliability behavior.
5. Implement security controls before polishing the UI.
6. Run tests and fix failures at every phase.
7. Keep the README and diagrams synchronized with the actual implementation.
8. Never mark a requirement complete unless it is implemented and tested.
9. Keep secrets out of source control and use safe, synthetic test data.
10. If a requirement is ambiguous, document the assumption and choose the smallest safe implementation that satisfies the brief.

**First milestone:** make a controlled connection to a Low honeypot appear as a persisted event in the React dashboard. Then extend the same pipeline to the Medium honeypot, configuration updates, buffering, and the remaining requirements.

