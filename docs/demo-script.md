# HoneyForge demo script

Reproducible S2 golden-path walkthrough. Every step is a real command against the
Docker Compose stack — no manual database edits.

> **Scope note.** High-interaction honeypots are out of scope. Operator auth here
> is the static `DEV_OPERATOR_TOKEN`; it is a perimeter-only stand-in that ships
> in the Vite bundle and is replaced by JWT + roles in S4.

## 0. Prerequisites

- Docker Desktop with Compose v2, running.
- A `.env` derived from `.env.example` (`cp .env.example .env`). The defaults are
  intentionally non-secret demo values.

```bash
docker compose up -d --build
docker compose ps            # db healthy; backend, frontend, agent, low, test-client up
```

## 1. Provision the demo (seed)

Idempotent: re-running creates nothing new, so the demo repeats cleanly.

```bash
docker compose exec -T backend python -m app.seed
# seeded operator=admin profile=low (v1) honeypot=low
```

Tokens are read from the environment and never printed.

## 2. Confirm the agent is authorized and online

The agent fetches `GET /api/agent/config` with its **per-agent** token and
heartbeats; the center stores only the token hash.

```bash
docker compose logs agent | grep -E "adopted config|drained"
docker compose exec -T db psql -U honeyforge -d honeyforge \
  -c "SELECT name, status, config_version, last_seen_at FROM honeypots;"
# low | online | 1 | <recent timestamp>
```

The Low decoy logs its adopted listener once the agent publishes the config:

```bash
docker compose logs low | grep listening
# listening on ports=[2222] banner='SSH-2.0-OpenSSH_8.9' (config v1)
```

## 3. The S2 milestone — controlled connection → live event

Open the dashboard at <http://127.0.0.1:5173> (dark SOC theme, `Live event feed`
panel). Then, from the isolated test client on `decoy_net`:

```bash
docker compose run --rm test-client nc -w 2 low 2222
# SSH-2.0-OpenSSH_8.9
```

Within a second the event appears **live in the feed — no page refresh**:

```
connection  TCP  172.22.0.4:60358  →  :2222
```

Verify through the API and the database:

```bash
curl -H "Authorization: Bearer $DEV_OPERATOR_TOKEN" \
  http://localhost:8000/api/events

docker compose exec -T db psql -U honeyforge -d honeyforge \
  -c "SELECT event_type, source_ip, target_port, occurred_at, received_at FROM attack_events ORDER BY occurred_at DESC LIMIT 3;"
```

`occurred_at` (decoy observed) and `received_at` (center accepted) are distinct,
as required.

## 4. Duplicate ingest is idempotent

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

## 5. Offline version adoption (Review Focus #6)

Bump the `low` profile, restart the agent, and watch the next heartbeat report the
new version — scripted and grep-able:

```bash
bash scripts/check-version-adoption.sh
# PASS: agent adopted config version 2 (honeypots.config_version updated)
```

The decoy follows on its next poll:

```bash
docker compose logs low | grep listening
# listening on ports=[2222] banner='SSH-2.0-OpenSSH_9.9' (config v2)
docker compose run --rm test-client nc -w 2 low 2222
# SSH-2.0-OpenSSH_9.9
```

## 6. Network isolation (defense in depth)

From `decoy_net`, the agent, backend, and database are unreachable:

```bash
docker compose run --rm test-client sh -c 'nc -z -w2 agent 9000;   echo agent_exit=$?'    # 1
docker compose run --rm test-client sh -c 'nc -z -w2 backend 8000; echo backend_exit=$?'  # 1
docker compose run --rm test-client sh -c 'nc -z -w2 db 5432;      echo db_exit=$?'       # 1
```

The decoy reaches the agent only on `agent_decoy_net`, and only with the
`X-Agent-Ingest-Secret` header. See `AGENTS.md` §6 and `docs/threat-model.md`.
This segmentation is **not** a complete security boundary.

## 7. Automated tests behind the demo

```bash
docker compose run --rm backend pytest      # control center
docker compose run --rm agent pytest        # agent config/buffer/telemetry/ingest
cd frontend && npm test                     # event feed dedupe + WS append
cd honeypots/low && pytest                  # low decoy connection → event
```

## Teardown

```bash
docker compose down          # stop
docker compose down -v       # stop and drop volumes (fresh DB)
```

## Fallback

If the live stack misbehaves, the S2 gate is still demonstrable from tests:
the backend suite covers idempotent ingest and the WebSocket stream, the agent
suite covers ack-gated retry with no loss across restarts, and the frontend suite
covers history + live append with dedupe by event id.
