#!/usr/bin/env bash
# Aplica todas as migrations num Postgres vazio e roda os testes de segurança.
# Uso: PGHOST=... PGUSER=... PGPASSWORD=... PGDATABASE=... supabase/ci/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."

export PGOPTIONS="-c client_min_messages=warning"
psql -v ON_ERROR_STOP=1 -q -f ci/shim.sql

for f in $(ls migrations/*.sql | sort); do
  echo "migration: $f"
  psql -v ON_ERROR_STOP=1 -q -f "$f" > /dev/null
done

PGOPTIONS="-c client_min_messages=notice" psql -v ON_ERROR_STOP=1 -q -f ci/smoke.sql
echo "Migrations e testes de segurança OK"
