#!/usr/bin/env bash
# Agenda do lava rápido: concorrência de verdade, com duas sessões do banco ao mesmo tempo (o smoke roda numa sessão só e não prova isto).
# 1) Duas chegadas simultâneas do mesmo agendamento criam uma ordem só (a segunda espera a trava e devolve a mesma ordem).
# 2) Dois agendamentos simultâneos do mesmo lavador em horários que cruzam: só um vale, o outro recebe o aviso de conflito.
# Usa as mesmas variáveis PG* do run.sh e o schema ci que o smoke deixa criado. Limpa tudo no fim, mesmo se falhar.
set -euo pipefail
cd "$(dirname "$0")/.."
export PGOPTIONS="-c client_min_messages=warning"

T='c0c0c0c0-0000-0000-0000-000000007901'
U='a0000000-0000-0000-0000-000000007901'
TMP="$(mktemp -d)"

sql() { psql -v ON_ERROR_STOP=1 -qAt "$@"; }
falhar() { echo "FALHA (concorrência da agenda): $*" >&2; exit 1; }

limpar_dados() {
  sql <<SQL >/dev/null 2>&1 || true
SELECT ci.sair();
DELETE FROM public.lr_ordem_itens WHERE tenant_id = '$T';
UPDATE public.lr_agendamentos SET ordem_id = NULL WHERE tenant_id = '$T';
DELETE FROM public.lr_ordens WHERE tenant_id = '$T';
DELETE FROM public.lr_agenda_ocupacoes WHERE tenant_id = '$T';
DELETE FROM public.lr_agendamento_itens WHERE tenant_id = '$T';
DELETE FROM public.lr_agendamentos WHERE tenant_id = '$T';
DELETE FROM public.lr_veiculos WHERE tenant_id = '$T';
DELETE FROM public.lr_lavadores WHERE tenant_id = '$T';
DELETE FROM public.lr_servico_precos WHERE tenant_id = '$T';
DELETE FROM public.lr_servicos WHERE tenant_id = '$T';
DELETE FROM public.produtos WHERE tenant_id = '$T';
DELETE FROM public.clientes WHERE tenant_id = '$T';
DELETE FROM public.user_roles WHERE tenant_id = '$T';
DELETE FROM public.empresas WHERE tenant_id = '$T';
DELETE FROM public.profiles WHERE id = '$U';
DELETE FROM auth.users WHERE id = '$U';
DELETE FROM public.tenants WHERE id = '$T';
SQL
}
trap 'limpar_dados; rm -rf "$TMP"' EXIT
limpar_dados

# ---------- preparo (como dono do banco; os cadastros, pela função do módulo) ----------
sql <<SQL >/dev/null
INSERT INTO public.tenants (id, nome) VALUES ('$T', 'Lava Agenda Concorrência CI');
INSERT INTO public.empresas (tenant_id, razao_social, cnae) VALUES ('$T', 'Lava Agenda Concorrência Ltda', '4520-0/06');
INSERT INTO auth.users (id, email) VALUES ('$U', 'agenda-concorrencia@ci');
UPDATE public.profiles SET tenant_id = '$T', nome = 'Admin Concorrência' WHERE id = '$U';
INSERT INTO public.user_roles (user_id, tenant_id, role) VALUES ('$U', '$T', 'administrador');
INSERT INTO public.clientes (tenant_id, nome, cpf) VALUES ('$T', 'Cliente Concorrência', '52998224725');
SQL
CLI="$(sql -c "SELECT id FROM public.clientes WHERE tenant_id = '$T'")"
IDS="$(sql <<SQL
SELECT ci.entrar('$U');
SELECT lr_veiculo_salvar(jsonb_build_object('cliente_id', '$CLI', 'tipo', 'carro', 'identificacao', 'CNC1A11', 'fabricante', 'Fiat', 'modelo', 'Argo'))
  || ',' || lr_veiculo_salvar(jsonb_build_object('cliente_id', '$CLI', 'tipo', 'carro', 'identificacao', 'CNC2B22', 'fabricante', 'VW', 'modelo', 'Gol'))
  || ',' || lr_lavador_salvar('{"nome":"Lavador Concorrência","comissao_percentual":0}'::jsonb)
  || ',' || lr_servico_salvar('{"nome":"Lavagem concorrência","duracao_min":30,"preco_base":40}'::jsonb);
SQL
)"
IDS="$(printf '%s\n' "$IDS" | grep ',' | head -1)"
V1="${IDS%%,*}"; REST="${IDS#*,}"; V2="${REST%%,*}"; REST="${REST#*,}"; LAV="${REST%%,*}"; SERV="${REST#*,}"
[ -n "$V1" ] && [ -n "$V2" ] && [ -n "$LAV" ] && [ -n "$SERV" ] || falhar "não consegui preparar os cadastros ($IDS)"

AG="$(sql <<SQL | grep -E '^[0-9a-f-]{36}$' | head -1
SELECT ci.entrar('$U');
SELECT lr_agendar(jsonb_build_object('veiculo_id', '$V1', 'lavador_id', '$LAV', 'inicio', '2031-05-10 09:00:00-03', 'servicos', jsonb_build_array('$SERV')));
SQL
)"
[ -n "$AG" ] || falhar "não consegui criar o agendamento"

# ---------- 1) duas chegadas ao mesmo tempo ----------
( psql -v ON_ERROR_STOP=1 -qAt >"$TMP/a1.out" 2>"$TMP/a1.err" <<SQL
BEGIN;
SELECT ci.entrar('$U');
SELECT lr_agenda_chegada('$AG');
SELECT pg_sleep(3);
COMMIT;
SQL
) &
PID_A=$!
sleep 1
INI="$(date +%s.%N)"
psql -v ON_ERROR_STOP=1 -qAt >"$TMP/b1.out" 2>"$TMP/b1.err" <<SQL || falhar "a segunda chegada deu erro: $(cat "$TMP/b1.err")"
BEGIN;
SELECT ci.entrar('$U');
SELECT lr_agenda_chegada('$AG');
COMMIT;
SQL
FIM="$(date +%s.%N)"
wait "$PID_A" || falhar "a primeira chegada deu erro: $(cat "$TMP/a1.err")"

RA="$(grep '"ordem_id"' "$TMP/a1.out" | head -1)"
RB="$(grep '"ordem_id"' "$TMP/b1.out" | head -1)"
[ -n "$RA" ] && [ -n "$RB" ] || falhar "sem resposta das chegadas (A: $RA / B: $RB)"
OA="$(printf '%s' "$RA" | sed -E 's/.*"ordem_id": *"([0-9a-f-]+)".*/\1/')"
OB="$(printf '%s' "$RB" | sed -E 's/.*"ordem_id": *"([0-9a-f-]+)".*/\1/')"
[ "$OA" = "$OB" ] || falhar "duas chegadas simultâneas criaram ordens diferentes ($OA e $OB)"
printf '%s' "$RA" | grep -q '"repetido": *false' || falhar "a primeira chegada devia criar a ordem ($RA)"
printf '%s' "$RB" | grep -q '"repetido": *true' || falhar "a segunda chegada devia devolver a ordem que já existe ($RB)"
ESPERA="$(awk -v a="$INI" -v b="$FIM" 'BEGIN { printf "%d", (b - a) * 1000 }')"
[ "$ESPERA" -ge 1500 ] || falhar "a segunda chegada não esperou a trava (${ESPERA} ms): o teste não exerceu a concorrência"
N_ORDENS="$(sql -c "SELECT count(*) FROM public.lr_ordens WHERE tenant_id = '$T' AND veiculo_id = '$V1'")"
N_ITENS="$(sql -c "SELECT count(*) FROM public.lr_ordem_itens WHERE tenant_id = '$T' AND ordem_id = '$OA'")"
[ "$N_ORDENS" = "1" ] || falhar "esperava 1 ordem do veículo, achei $N_ORDENS"
[ "$N_ITENS" = "1" ] || falhar "esperava 1 item na ordem, achei $N_ITENS"
echo "ok: duas chegadas simultâneas criam uma ordem só (a segunda esperou ${ESPERA} ms e devolveu a mesma)"

# ---------- 2) dois agendamentos ao mesmo tempo para o mesmo lavador ----------
( psql -v ON_ERROR_STOP=1 -qAt >"$TMP/a2.out" 2>"$TMP/a2.err" <<SQL
BEGIN;
SELECT ci.entrar('$U');
SELECT lr_agendar(jsonb_build_object('veiculo_id', '$V2', 'lavador_id', '$LAV', 'inicio', '2031-05-11 10:00:00-03', 'fim', '2031-05-11 11:00:00-03', 'servicos', jsonb_build_array('$SERV')));
SELECT pg_sleep(3);
COMMIT;
SQL
) &
PID_A=$!
sleep 1
CODIGO=0
psql -v ON_ERROR_STOP=1 -qAt >"$TMP/b2.out" 2>"$TMP/b2.err" <<SQL || CODIGO=$?
BEGIN;
SELECT ci.entrar('$U');
SELECT lr_agendar(jsonb_build_object('veiculo_id', '$V1', 'lavador_id', '$LAV', 'inicio', '2031-05-11 10:30:00-03', 'fim', '2031-05-11 11:30:00-03', 'servicos', jsonb_build_array('$SERV')));
COMMIT;
SQL
wait "$PID_A" || falhar "o primeiro agendamento deu erro: $(cat "$TMP/a2.err")"
[ "$CODIGO" -ne 0 ] || falhar "o segundo agendamento, que cruza o primeiro, foi aceito"
grep -q "já tem agendamento neste horário" "$TMP/b2.err" || falhar "o segundo agendamento devia receber o aviso de conflito: $(cat "$TMP/b2.err")"
N_AG="$(sql -c "SELECT count(*) FROM public.lr_agendamentos WHERE tenant_id = '$T' AND lavador_id = '$LAV' AND inicio >= '2031-05-11 00:00:00-03' AND inicio < '2031-05-12 00:00:00-03'")"
[ "$N_AG" = "1" ] || falhar "esperava 1 agendamento do lavador no dia, achei $N_AG"
echo "ok: dois agendamentos simultâneos do mesmo lavador, que cruzam: só um vale e o outro recebe o aviso"
echo "Concorrência da agenda OK"
