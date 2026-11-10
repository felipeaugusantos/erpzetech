-- Testes da restauração assistida (fase 4): só insere o que falta, só cadastros, só do cliente informado, só pelo serviço.
-- Traz as próprias fixtures e desfaz tudo com ROLLBACK.
\set ON_ERROR_STOP on
BEGIN;
DROP SCHEMA IF EXISTS ci CASCADE;
CREATE SCHEMA ci;
GRANT USAGE ON SCHEMA ci TO PUBLIC;

CREATE FUNCTION ci.deve_falhar_como(papel text, cmd text, descricao text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE falhou boolean := false;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', papel);
  BEGIN EXECUTE cmd; EXCEPTION WHEN OTHERS THEN falhou := true; END;
  RESET ROLE;
  IF NOT falhou THEN RAISE EXCEPTION 'FALHA: esperava erro em "%"', descricao; END IF;
  RAISE NOTICE 'ok: % recusado', descricao;
END $$;

DO $$
DECLARE
  a constant uuid := 'cccccccc-0000-4000-8000-00000000c001';
  b constant uuid := 'cccccccc-0000-4000-8000-00000000c002';
  f1 constant uuid := 'f0000000-0000-4000-8000-000000000001';
  f2 constant uuid := 'f0000000-0000-4000-8000-000000000002';
  c_pai constant uuid := 'f0000000-0000-4000-8000-0000000000a1';
  c_filha constant uuid := 'f0000000-0000-4000-8000-0000000000a2';
  r jsonb;
  nome_atual text;
  n integer;
BEGIN
  INSERT INTO public.tenants (id, nome) VALUES (a, 'Cliente A'), (b, 'Cliente B');
  -- f1 existe com nome "Atual"; f2 foi apagado e consta do backup
  INSERT INTO public.fornecedores (id, tenant_id, razao_social) VALUES (f1, a, 'Atual');

  -- só o serviço executa
  PERFORM ci.deve_falhar_como('authenticated', format($c$SELECT public.backup_restaurar_tabela(%L, 'fornecedores', '[]'::jsonb)$c$, a), 'authenticated executa a restauração');
  PERFORM ci.deve_falhar_como('anon', format($c$SELECT public.backup_restaurar_tabela(%L, 'fornecedores', '[]'::jsonb)$c$, a), 'anon executa a restauração');

  SET LOCAL ROLE service_role;

  -- insere o que falta e deixa o que existe como está (não sobrescreve)
  r := public.backup_restaurar_tabela(a, 'fornecedores', jsonb_build_array(
    jsonb_build_object('id', f1, 'tenant_id', a, 'razao_social', 'DO BACKUP (antigo)'),
    jsonb_build_object('id', f2, 'tenant_id', a, 'razao_social', 'Apagado')));
  IF (r->>'inseridas')::int <> 1 OR (r->>'ja_existiam')::int <> 1 THEN
    RAISE EXCEPTION 'FALHA: esperava 1 inserida e 1 já existente, veio %', r;
  END IF;
  SELECT razao_social INTO nome_atual FROM public.fornecedores WHERE id = f1;
  IF nome_atual <> 'Atual' THEN RAISE EXCEPTION 'FALHA: sobrescreveu a linha existente (%)', nome_atual; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.fornecedores WHERE id = f2 AND razao_social = 'Apagado') THEN
    RAISE EXCEPTION 'FALHA: não restaurou a linha apagada';
  END IF;
  RAISE NOTICE 'ok: restaura o que falta e não sobrescreve o que existe';

  -- repetir é seguro (idempotente)
  r := public.backup_restaurar_tabela(a, 'fornecedores', jsonb_build_array(
    jsonb_build_object('id', f2, 'tenant_id', a, 'razao_social', 'Apagado')));
  IF (r->>'inseridas')::int <> 0 THEN RAISE EXCEPTION 'FALHA: repetir inseriu de novo'; END IF;
  RAISE NOTICE 'ok: restaurar de novo não duplica';

  -- self-referência (categoria filha e pai no mesmo envio)
  r := public.backup_restaurar_tabela(a, 'categorias', jsonb_build_array(
    jsonb_build_object('id', c_filha, 'tenant_id', a, 'nome', 'Filha', 'parent_id', c_pai),
    jsonb_build_object('id', c_pai, 'tenant_id', a, 'nome', 'Pai')));
  IF (r->>'inseridas')::int <> 2 THEN RAISE EXCEPTION 'FALHA: categoria pai e filha, veio %', r; END IF;
  RAISE NOTICE 'ok: pai e filha da mesma tabela entram juntos';

  -- colunas que o arquivo não traz usam o padrão da tabela (ativo, created_at)
  SELECT count(*) INTO n FROM public.fornecedores WHERE id = f2 AND ativo IS TRUE AND created_at IS NOT NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'FALHA: colunas ausentes não usaram o padrão'; END IF;
  RESET ROLE;

  -- linha de outro cliente: recusa o envio inteiro
  PERFORM ci.deve_falhar_como('service_role', format($c$SELECT public.backup_restaurar_tabela(%L, 'fornecedores', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'tenant_id', %L, 'razao_social', 'Intruso')))$c$, a, b), 'linha de outro cliente');
  -- tabela fora da lista (acessos, vendas, etc.)
  PERFORM ci.deve_falhar_como('service_role', format($c$SELECT public.backup_restaurar_tabela(%L, 'user_roles', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'tenant_id', %L)))$c$, a, a), 'restaurar user_roles');
  PERFORM ci.deve_falhar_como('service_role', format($c$SELECT public.backup_restaurar_tabela(%L, 'pedidos', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'tenant_id', %L)))$c$, a, a), 'restaurar pedidos');
  -- sem id, vazio e cliente inexistente
  PERFORM ci.deve_falhar_como('service_role', format($c$SELECT public.backup_restaurar_tabela(%L, 'fornecedores', jsonb_build_array(jsonb_build_object('tenant_id', %L, 'razao_social', 'Sem id')))$c$, a, a), 'linhas sem id');
  PERFORM ci.deve_falhar_como('service_role', format($c$SELECT public.backup_restaurar_tabela(%L, 'fornecedores', '[]'::jsonb)$c$, a), 'envio vazio');
  PERFORM ci.deve_falhar_como('service_role', $c$SELECT public.backup_restaurar_tabela(gen_random_uuid(), 'fornecedores', '[{"id":"x"}]'::jsonb)$c$, 'cliente inexistente');

  -- a restauração fica na auditoria do cliente
  SELECT count(*) INTO n FROM public.auditoria WHERE tenant_id = a AND entidade = 'backup_restauracao';
  IF n <> 3 THEN RAISE EXCEPTION 'FALHA: esperava 3 registros de auditoria, achou %', n; END IF;
  RAISE NOTICE 'ok: auditoria da restauração';
END $$;
ROLLBACK;
