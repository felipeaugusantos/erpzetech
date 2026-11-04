#!/usr/bin/env bash
# Aplica todas as migrations num Postgres vazio e roda os testes de segurança.
# Uso: PGHOST=... PGUSER=... PGPASSWORD=... PGDATABASE=... supabase/ci/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."

export PGOPTIONS="-c client_min_messages=warning"
psql -v ON_ERROR_STOP=1 -q -f ci/shim.sql

# O Lovable também grava migrations direto em drizzle/migrations. As que têm par em supabase/migrations
# (mesmo nome depois do número) são a mesma coisa; as demais entram na ordem certa, logo depois do par
# da migration drizzle anterior, para o teste cobrir o banco todo.
ordem=$(python3 - <<'PY'
import glob, os
sup = sorted(glob.glob("migrations/*.sql"))
suf = {os.path.basename(f).split("_", 1)[1]: f for f in sup}
ds = sorted(glob.glob("../drizzle/migrations/*.sql"))
ultimo_par = max((i for i, d in enumerate(ds) if os.path.basename(d).split("_", 1)[1] in suf), default=-1)
depois = {}
anterior = None
final = []
for i, d in enumerate(ds):
    nome = os.path.basename(d).split("_", 1)[1]
    if nome in suf:
        anterior = suf[nome]
    elif i > ultimo_par:
        final.append(d)
    else:
        depois.setdefault(anterior, []).append(d)
for f in sup:
    print(f)
    for d in depois.get(f, []):
        print(d)
for d in depois.get(None, []):
    print(d)
for d in final:
    print(d)
PY
)

for f in $ordem; do
  echo "migration: $f"
  psql -v ON_ERROR_STOP=1 -q -f "$f" > /dev/null
done

# provas comportamentais da clínica (fila do dia, modelos de receita, lembretes de WhatsApp)
PGOPTIONS="-c client_min_messages=notice" psql -v ON_ERROR_STOP=1 -q -f ci/clinica-lembretes-receita-fila.sql
PGOPTIONS="-c client_min_messages=notice" psql -v ON_ERROR_STOP=1 -q -f ci/bulario.sql
PGOPTIONS="-c client_min_messages=notice" psql -v ON_ERROR_STOP=1 -q -f ci/smoke.sql
# concorrência de verdade (duas sessões ao mesmo tempo) da agenda do lava rápido
bash ci/lava-agenda-concorrencia.sh
echo "Migrations e testes de segurança OK"
