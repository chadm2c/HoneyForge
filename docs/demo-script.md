# HoneyForge demo script

Reproducible golden-path walkthrough covering both interaction levels. Every
step is a real command against the Docker Compose stack — no manual database
edits.

> **Scope note.** High-interaction honeypots are out of scope. Operator auth here
> is the static `DEV_OPERATOR_TOKEN`; it is a perimeter-only stand-in that ships
> in the Vite bundle and is replaced by JWT + roles in S4. The Medium decoy's
> login is **decorative** — its cookie is not an authentication control.

## 0. Prerequisites

- Docker Desktop with Compose v2, running.
- A `.env` derived from `.env.example` (`cp .env.example .env`). The defaults are
  intentionally non-secret demo values.

```bash
docker compose up -d --build
docker compose ps
# db healthy; backend, frontend, agent, agent-medium, low, medium, test-client up
```

## 1. Provision the demo (seed)

Idempotent: re-running creates nothing new, so the demo repeats cleanly. It
provisions one operator and a `low` **and** `medium` profile + honeypot, each with
its own per-agent token.

```bash
docker compose exec -T backend python -m app.seed
# seeded operator=admin profile=low (v1) honeypot=low profile=medium (v1) honeypot=medium
```

Tokens are read from the environment and never printed.

## 2. Confirm both agents are authorized and online

Each agent fetches `GET /api/agent/config` with its **own** per-agent token and
heartbeats; the center stores only the token hash.

```bash
docker compose logs agent agent-medium | grep -E "adopted config|drained"
docker compose exec -T db psql -U honeyforge -d honeyforge \
  -c "SELECT name, status, config_version, last_seen_at FROM honeypots ORDER BY name;"
# low    | online | 1 | <recent>
# medium | online | 1 | <recent>
```

Each decoy logs its adopted listener once its agent publishes the config:

```bash
docker compose logs low    | grep listening
# listening on ports=[2222] banner='SSH-2.0-OpenSSH_8.9' (config v1)
docker compose logs medium | grep listening
# listening on ports=[8080] title='Admin Panel' login_enabled=True (config v1)
```

## 3. The milestone — controlled interaction → live event

Open the dashboard at <http://127.0.0.1:5173> (dark SOC theme, `Live event feed`
panel). Then, from the isolated test client on `decoy_net`, hit both decoys.

**Low (TCP banner).**

```bash
docker compose run --rm test-client nc -w 2 low 2222
# SSH-2.0-OpenSSH_8.9
```

**Medium (fake HTTP admin panel).**

```bash
# Login page, a failed login, an unknown path, and a query-bearing request:
docker compose run --rm test-client wget -qO- http://medium:8080/ | head -c 60
docker compose run --rm test-client wget -qO- --post-data 'username=admin&password=guess' http://medium:8080/login >/dev/null
docker compose run --rm test-client sh -c "printf 'GET /wp-admin HTTP/1.0\r\nHost: medium\r\n\r\n' | nc -w 2 medium 8080 | head -1"   # 404
docker compose run --rm test-client sh -c "printf 'GET /?token=SECRETQUERY HTTP/1.0\r\nHost: medium\r\n\r\n' | nc -w 2 medium 8080 | head -1"  # 200
```

Within a second the events appear **live in the feed — no page refresh**:
`connection` (TCP) for the Low banner, and `http_request` / `path_probe` /
`auth_attempt` (HTTP) for the Medium panel.

Verify through the API and the database:

```bash
curl -H "Authorization: Bearer $DEV_OPERATOR_TOKEN" http://localhost:8000/api/events

docker compose exec -T db psql -U honeyforge -d honeyforge -c \
  "SELECT event_type, details->>'method' AS method, details->>'path' AS path,
          details->>'has_query' AS has_query, details->>'success' AS success
   FROM attack_events ORDER BY occurred_at DESC LIMIT 6;"
```

`occurred_at` (decoy observed) and `received_at` (center accepted) are distinct.

## 4. Medium decoy: the fake login and its sanitization

```bash
# Successful login with the synthetic pair: 302 + an opaque dummy cookie.
docker compose run --rm test-client wget -S -O- \
  --post-data 'username=admin&password=demo-password' \
  http://medium:8080/login 2>&1 | grep -iE 'HTTP/|set-cookie|location'
# HTTP/1.0 302 Found
# Location: /dashboard
# Set-Cookie: hf_admin=<random>; Path=/; HttpOnly

# The cookie only gates static fake pages (it is NOT a security control):
docker compose run --rm test-client sh -c "printf 'GET /dashboard HTTP/1.0\r\nHost: medium\r\nCookie: hf_admin=x\r\n\r\n' | nc -w 2 medium 8080 | head -1"  # 200
docker compose run --rm test-client sh -c "printf 'GET /dashboard HTTP/1.0\r\nHost: medium\r\n\r\n' | nc -w 2 medium 8080 | head -1"                  # 302 ->
```

What is recorded, and what is not (verified by the decoy's unit tests and live
below):

- `auth_attempt` records `success`, `password_present`, `password_length` and a
  coarse `username_category` — **never** the submitted username or password.
- The query string is never stored; only the boolean `has_query`. `Authorization`
  and `Cookie` values are never read into an event.
- Only `application/x-www-form-urlencoded` bodies are interpreted, so a JSON
  login always reports `success=false`.
- The 404 page never echoes the requested path, and the stdlib access log is
  replaced with a query-free line.

## 5. Duplicate ingest is idempotent

Event IDs are generated **on the agent** before transmission; a retry reuses the
same ID. Posting the same event twice yields one row:

```bash
TOKEN=change-me-agent-token
BODY='{"events":[{"id":"11111111-1111-4111-8111-111111111111","event_type":"duplicate_probe","protocol":"tcp","source_ip":"192.0.2.10","source_port":4242,"target_port":2222,"details":{},"occurred_at":"2026-10-11T12:00:00Z"}]}'

curl -s -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "$BODY" http://localhost:8000/api/telemetry/events
# {"accepted":["11111111-..."],"duplicates":[]}

curl -s -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "$BODY" http://localhost:8000/api/telemetry/events
# {"accepted":[],"duplicates":["11111111-..."]}   <- second time is a duplicate
```

An **unknown agent token is rejected** with `401`.

## 6. Offline version adoption (Review Focus #6)

Bump a profile, restart that decoy's agent, and watch the next heartbeat report
the new version — scripted and grep-able for both levels:

```bash
bash scripts/check-version-adoption.sh low
# PASS: agent adopted config version 2 (honeypots.config_version updated)
bash scripts/check-version-adoption.sh medium
# PASS: agent-medium adopted config version 2 (honeypots.config_version updated)
```

Each decoy follows on its next poll, rebinding the **same** port (no "address in
use"):

```bash
docker compose logs low | grep listening
# listening on ports=[2222] banner='SSH-2.0-OpenSSH_9.9' (config v2)
docker compose logs medium | grep listening
# listening on ports=[8080] title='Admin Console' login_enabled=True (config v2)
```

## 7. Network isolation (defense in depth)

From `decoy_net`, the agents, backend, and database are unreachable, while both
decoys are reachable:

```bash
docker compose run --rm test-client sh -c 'nc -z -w2 backend 8000;      echo backend=$?'      # 1
docker compose run --rm test-client sh -c 'nc -z -w2 agent 9000;        echo agent=$?'        # 1
docker compose run --rm test-client sh -c 'nc -z -w2 agent-medium 9000; echo agent_medium=$?' # 1
docker compose run --rm test-client sh -c 'nc -z -w2 db 5432;           echo db=$?'           # 1
docker compose run --rm test-client sh -c 'nc -z -w2 medium 8080;       echo medium=$?'       # 0
docker compose run --rm test-client sh -c 'nc -z -w2 low 2222;          echo low=$?'          # 0
```

The old shared `agent_decoy_net` is split into `agent_low_net` (agent, low) and
`agent_medium_net` (agent-medium, medium), so each decoy reaches only **its own**
agent. A decoy authenticates to `/ingest` with the `X-Agent-Ingest-Secret`
header. This segmentation is **not** a complete security boundary — see
`AGENTS.md` §6 and `docs/threat-model.md`.

## 8. Password absence (the one thing that must never leak)

The submitted password must not appear in the database, the medium agent's spool,
or any log. Force events to buffer by taking the center down, submit a real
password, then grep everywhere:

```bash
docker compose stop backend

docker compose run --rm test-client sh -c \
  "printf 'POST /login HTTP/1.0\r\nHost: medium\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: 37\r\n\r\nusername=admin&password=demo-password' | nc -w 2 medium 8080 | head -1"  # 302

# The buffered event records only the length:
docker compose exec -T agent-medium cat /data/agent-medium-spool.jsonl
# {"event_type":"auth_attempt",...,"password_present":true,"password_length":13,"success":true}

docker compose exec -T agent-medium sh -c \
  'grep -c "demo-password" /data/agent-medium-spool.jsonl; echo grep_exit=$?'   # 0 / 1

docker compose start backend   # the agent drains the spool; no loss
```

Finally, grep the persisted events, the spool, and the logs — **zero hits**:

```bash
docker compose exec -T db psql -U honeyforge -d honeyforge -tA -c \
  "SELECT count(*) FROM attack_events WHERE details::text LIKE '%demo-password%';"   # 0
docker compose exec -T agent-medium sh -c 'grep -c demo-password /data/agent-medium-spool.jsonl || true'  # 0
docker compose logs medium agent-medium backend | grep -c demo-password || true      # 0
```

## 9. Automated tests behind the demo

```bash
docker compose run --rm backend pytest      # control center (26)
docker compose run --rm agent pytest        # agent config/buffer/telemetry/ingest (22)
cd frontend && npm test                      # event feed dedupe + WS append (1)
cd honeypots/low && pytest                   # low decoy connection → event (2)
cd honeypots/medium && pytest                # medium decoy routes/sanitization/hostile input (19)
```

## Teardown

```bash
docker compose down          # stop
docker compose down -v       # stop and drop volumes (fresh DB)
```

## Fallback

If the live stack misbehaves, the gate is still demonstrable from tests: the
backend suite covers idempotent ingest and the WebSocket stream, the agent suite
covers ack-gated retry with no loss across restarts, the Medium suite covers
login/sanitization/hostile input/password absence, and the frontend suite covers
history + live append with dedupe by event id.
