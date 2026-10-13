#!/usr/bin/env bash
# check-version-adoption.sh — Review Focus #6 reproduction (Task 18/21)
#
# Bumps a seeded decoy profile (its marker field + version) in PostgreSQL,
# restarts that decoy's agent so it re-fetches its config, then polls the
# control center DB until the agent's next heartbeat reports the new
# config_version on the honeypot.
#
# Usage:
#   bash scripts/check-version-adoption.sh [low|medium]   # default: low
#
# README commands:
#   docker compose up -d --build
#   bash scripts/check-version-adoption.sh low
#   bash scripts/check-version-adoption.sh medium
#
# Emits a grep-able PASS/FAIL line and exits non-zero on failure.

set -euo pipefail
cd "$(dirname "$0")/.."   # repo root

DB_USER="${POSTGRES_USER:-honeyforge}"
DB_NAME="${POSTGRES_DB:-honeyforge}"
LEVEL="${1:-${LEVEL:-low}}"

# Per-level wiring: the honeypot/profile name, its agent service, and the
# config field the version bump changes (low advertises a banner, medium a title).
case "$LEVEL" in
  low)
    HONEYPOT_NAME="${HONEYPOT_NAME:-low}"
    AGENT_SERVICE="agent"
    FIELD="banner"
    MARKER="${BANNER:-SSH-2.0-OpenSSH_9.9}"
    ;;
  medium)
    HONEYPOT_NAME="${HONEYPOT_NAME:-medium}"
    AGENT_SERVICE="agent-medium"
    FIELD="title"
    MARKER="${TITLE:-Admin Console}"
    ;;
  *)
    echo "FAIL: unknown level '$LEVEL' (expected low or medium)"
    exit 2
    ;;
esac

echo "== check-version-adoption ($LEVEL) =="

# 1) Bump the profile. There is no profile-CRUD API until S4, so the documented
#    command updates the versioned config directly in PostgreSQL.
docker compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 \
  -c "UPDATE profiles SET config = jsonb_set(config, '{$FIELD}', to_jsonb('$MARKER'::text)), version = version + 1 WHERE name = '$HONEYPOT_NAME';"

NEW_VERSION="$(docker compose exec -T db psql -tA -U "$DB_USER" -d "$DB_NAME" \
  -c "SELECT version FROM profiles WHERE name = '$HONEYPOT_NAME';" | tr -d '[:space:]')"
if [ -z "$NEW_VERSION" ]; then
  echo "FAIL: no seeded '$HONEYPOT_NAME' profile found (run the seed first)"
  exit 1
fi

# 2) Restart the decoy's agent so it re-fetches and adopts the new config.
docker compose restart "$AGENT_SERVICE"

# 3) Poll until the heartbeat reports the new config_version.
echo "expecting config_version=$NEW_VERSION on honeypot=$HONEYPOT_NAME"
for _ in $(seq 1 30); do
  CV="$(docker compose exec -T db psql -tA -U "$DB_USER" -d "$DB_NAME" \
    -c "SELECT config_version FROM honeypots WHERE name = '$HONEYPOT_NAME';" | tr -d '[:space:]')"
  if [ "$CV" = "$NEW_VERSION" ]; then
    echo "PASS: $AGENT_SERVICE adopted config version $NEW_VERSION (honeypots.config_version updated)"
    exit 0
  fi
  sleep 2
done

echo "FAIL: honeypots.config_version=$CV != expected=$NEW_VERSION after ~60s"
exit 1
