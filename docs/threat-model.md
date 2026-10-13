# HoneyForge threat model

This document states exactly what the control plane protects and — just as
importantly — what it does **not**. It is a living document; the S6 slice
(TLS + encryption matrix, rate limits) and S7 (final write-up) extend it.

> Honesty contract (AGENTS.md §5.7): nothing here claims "undetectable" or
> treats network obscurity as authentication.

## Scope

HoneyForge is a **honeypot control plane**. It is designed to be attacked, so the
assets that matter are the *control plane* and the *telemetry*, not the decoys
themselves. High-interaction honeypots (real shells/services) are explicitly out
of scope.

## Assets

1. Operator credentials and the operator session (S2: static token; S4: JWT).
2. Per-agent tokens (center stores only an HMAC hash).
3. Attacker telemetry (`attack_events`) — integrity and availability matter more
   than confidentiality, but it must not become a pivot.
4. The PostgreSQL database.
5. The host and the other containers on it.

## Trust boundaries and networks

Defined in `docker-compose.yml`; the five non-host networks are `internal: true`
(no gateway, no LAN/internet egress). Host ports bind to `127.0.0.1` only.

| Network | Members | Trust |
|---|---|---|
| `frontend_net` | reverse proxy, frontend, backend | browser-facing (host-published on loopback) |
| `control_net` | backend, database | management plane |
| `telemetry_net` | backend, agents | center ↔ agent |
| `agent_low_net` | `agent`, `low` | the low decoy reports to its own agent |
| `agent_medium_net` | `agent-medium`, `medium` | the medium decoy reports to its own agent |
| `decoy_net` | decoys, test client | attacker-facing, isolated |

**No agent is ever on `decoy_net`.** Splitting the old shared `agent_decoy_net`
into `agent_low_net` / `agent_medium_net` means each decoy can reach *only its
own* agent, not the other pair's. A compromised attacker-side container must not
be able to reach the agents, the backend, or Postgres. Verified by `scripts/`
and the demo's negative network checks (all fail closed).

## What is protected

- **Per-agent authorization.** Each agent has its own random token; the center
  stores only `hmac_sha256(AGENT_TOKEN_SECRET, token)`. An agent can read only
  *its own* config and submit only *its own* telemetry. There is no shared
  agent↔center bearer token.
- **Decoy isolation.** Decoys run on `decoy_net` (+ their own `agent_low_net` /
  `agent_medium_net`), have no host-published ports, no Docker socket, and never
  forward to internal services. The Low decoy only emits a banner and records
  metadata.
- **No secrets harvested.** Decoy interactions record that an attempt happened
  plus safe metadata; submitted passwords are never stored. The Low decoy holds
  no login form; the Medium decoy records only a boolean/`password_length`/coarse
  username category — never the submitted value. The submitted password does not
  appear in the event, the spool, the logs, or the HTTP response.
- **Request sanitization (Medium).** The query string is stripped from every
  recorded event (its presence is recorded only as the boolean `has_query`),
  `Authorization` and `Cookie` values are never read into an event, the stdlib
  access log is replaced with a query-free line, and the 404 page never echoes
  the requested path. Only `application/x-www-form-urlencoded` bodies are
  interpreted, so JSON logins always fail and cannot smuggle a payload.
- **Event integrity & idempotency.** Event IDs are generated on the agent before
  transmission, so retries are idempotent (`INSERT ... ON CONFLICT DO NOTHING`).
- **Durable, ack-gated buffering.** The agent removes a buffered event only when
  the center acknowledges it (accepted **or** duplicate); a center outage never
  loses telemetry.
- **Ingest validation at the door.** The agent's `/ingest` mirrors the center's
  event constraints (UUID id, ISO-8601 timestamp, bounded fields), so a
  malformed event cannot poison the spool and wedge the drain loop.

## What is NOT protected (limits — read these)

1. **Docker network segmentation is not a complete security boundary.** It
   raises the cost of lateral movement; it does not defeat a host-level
   compromise, a Docker daemon exploit, or a container escape. If the host or
   the Docker daemon is owned, every boundary here falls.
2. **The agent's `/ingest` uses a shared secret** (`AGENT_INGEST_SECRET`), not
   per-decoy credentials. Any holder of that secret on an agent's decoy-facing
   network (`agent_low_net` / `agent_medium_net`) can inject events. This is a
   deliberate S2 simplification (AGENTS.md §10). Splitting the networks limits
   *which* agent a compromised decoy can reach; it does not give per-decoy auth.
3. **The S2 operator token is static and ships in the Vite bundle**
   (`VITE_OPERATOR_TOKEN`). It is a perimeter-only stand-in for a real login and
   is visible to anyone who can load the dashboard; S4 replaces it with JWT +
   roles. Until then, do not treat dashboard auth as a real boundary.
4. **No transport encryption by default.** Nginx + TLS is a stretch item. If it
   is deferred, agent↔center, operator↔backend, and decoy↔agent traffic are
   plaintext on their (internal) networks. The S6 encryption matrix must state
   the exact on/off status per link — no hand-waving.
5. **`attack_events` cascade-deletes with its honeypot.** Decommissioning a
   honeypot destroys its recorded events. Recorded tradeoff; revisit before S6.
6. **Agent auth is a bearer token, not mTLS.** Token theft = agent impersonation
   until rotation.
7. **No rate limiting yet.** Payload caps exist (details ≤64KB, batch ≤500
   events); request-rate limits are S6.
8. **The test client is a legitimate demo tool**, not an attacker model; a real
   attacker is unconstrained by it.
9. **The Medium decoy's session cookie is decorative.** A correct submission of
   the hardcoded synthetic credential pair sets an opaque cookie that merely
   gates the fake admin pages; any non-empty `hf_admin` cookie opens them. It is
   *not* an authentication control and protects nothing — the pages behind it are
   static fakes. It exists to make the login flow look real so the interaction is
   observable.

## Threat actors / scenarios

- **External attacker hitting a decoy.** Contained on `decoy_net`; can at most
  produce telemetry. Cannot reach the agent/backend/DB from `decoy_net`.
- **Compromised decoy.** Can post events to `/ingest` (with the shared secret)
  and read `/config`. Cannot reach the center directly or the DB. Injection is
  bounded by `/ingest` validation.
- **Compromised agent.** Holds its own center token → can submit telemetry and
  read its own config. Cannot read other agents' config or operate as an
  operator.
- **Network attacker on an internal network.** Without TLS (default), can read
  and modify traffic on the segment they control — see limit #4.
- **Compromised operator session (S2).** The static token is in the bundle; this
  is the weakest link until S4.

## Out of scope

- High-interaction honeypots and real attacker shells.
- Attacker attribution and counter-attack.
- Host/daemon-level compromise (assumed fatal to segmentation — see limit #1).

## Review focus traceability

- Per-agent auth + scoping: rules #2, #3 above.
- Versioning / offline adoption: "Durable, ack-gated buffering" + the golden path.
- Durability with no loss: `agent/event_buffer.py` (atomic ack via temp + os.replace).
- Segmentation: the network table + demo negative checks.
