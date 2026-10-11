#!/usr/bin/env bash
# check-version-adoption.sh — Review Focus #6 reproduction (Task 18/21)
#
# Bumps the seeded 'low' profile (banner + version) in PostgreSQL, restarts the
# agent so it re-fetches its config, then polls the control center DB until the
# agent's next heartbeat reports the new config_version on honeypots.
#
# README commands:
#   docker compose up -d --build
#   bash scripts/check-version-adoption.sh
#
# Emits a grep-able PASS/FAIL line and exits non-zero on failure.

set -euo pipefail
cd "$(dirname "$0")/.."   # repo root

DB_USER="${POSTGRES_USER:-honeyforge}"
DB_NAME="${POSTGRES_DB:-honeyforge}"
HONEYPOT_NAME="${HONEYPOT_NAME:-low}"
BANNER="${BANNER:-SSH-2.0-OpenSSH_9.9}"

echo "== check-version-adoption =="

# 1) Bump the profile. There is no profile-CRUD API until S4, so the documented
#    command updates the versioned config directly in PostgreSQL.
docker compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 \
  -c "UPDATE profiles SET config = jsonb_set(config, '{banner}', '\"$BANNER\"'), version = version + 1 WHERE name = 'low';"

NEW_VERSION="$(docker compose exec -T db psql -tA -U "$DB_USER" -d "$DB_NAME" \
  -c "SELECT version FROM profiles WHERE name = 'low';" | tr -d '[:space:]')"
if [ -z "$NEW_VERSION" ]; then
  echo "FAIL: no seeded 'low' profile found (run the seed first, see Task 20)"
  exit 1
fi

# 2) Restart the agent so it re-fetches and adopts the new config.
docker compose restart agent

# 3) Poll until the heartbeat reports the new config_version.
echo "expecting config_version=$NEW_VERSION on honeypot=$HONEYPOT_NAME"
for _ in $(seq 1 30); do
  CV="$(docker compose exec -T db psql -tA -U "$DB_USER" -d "$DB_NAME" \
    -c "SELECT config_version FROM honeypots WHERE name = '$HONEYPOT_NAME';" | tr -d '[:space:]')"
  if [ "$CV" = "$NEW_VERSION" ]; then
    echo "PASS: agent adopted config version $NEW_VERSION (honeypots.config_version updated)"
    exit 0
  fi
  sleep 2
done

echo "FAIL: honeypots.config_version=$CV != expected=$NEW_VERSION after ~60s"
exit 1