-- Testes do backup por cliente (fase 3): controle de execuções só do serviço e um backup por cliente por dia.
-- Traz as próprias fixtures e desfaz tudo com ROLLBACK.
\set ON_ERROR_STOP on
BEGIN;
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
  t constant uuid := 'bbbbbbbb-0000-4000-8000-00000000b001';
  n integer;
BEGIN
  INSERT INTO public.tenants (id, nome) VALUES (t, 'Cliente de backup');

  -- authenticated e anon não leem nem gravam o controle de backups
  PERFORM ci.deve_falhar_como('authenticated', 'SELECT 1 FROM public.backup_execucoes', 'authenticated lê backup_execucoes');
  PERFORM ci.deve_falhar_como('authenticated', format('INSERT INTO public.backup_execucoes (tenant_id, dia) VALUES (%L, current_date)', t), 'authenticated grava backup_execucoes');
  PERFORM ci.deve_falhar_como('anon', 'SELECT 1 FROM public.backup_execucoes', 'anon lê backup_execucoes');

  -- o serviço grava; um por cliente por dia (em andamento ou concluído)
  SET LOCAL ROLE service_role;
  INSERT INTO public.backup_execucoes (tenant_id, dia) VALUES (t, current_date);
  BEGIN
    INSERT INTO public.backup_execucoes (tenant_id, dia) VALUES (t, current_date);
    RESET ROLE;
    RAISE EXCEPTION 'FALHA: aceitou duas execuções no mesmo dia';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'ok: segunda execução do dia recusada';
  END;
  -- depois de erro, pode tentar de novo no mesmo dia
  UPDATE public.backup_execucoes SET situacao = 'erro', erro = 'falhou' WHERE tenant_id = t;
  INSERT INTO public.backup_execucoes (tenant_id, dia) VALUES (t, current_date);
  -- concluído exige caminho e tamanho
  BEGIN
    UPDATE public.backup_execucoes SET situacao = 'concluido', concluido_em = now() WHERE tenant_id = t AND situacao = 'em_andamento';
    RESET ROLE;
    RAISE EXCEPTION 'FALHA: concluiu sem caminho e tamanho';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok: concluído sem caminho recusado';
  END;
  SET LOCAL ROLE service_role;
  UPDATE public.backup_execucoes SET situacao = 'concluido', concluido_em = now(), caminho = 'x/y.gz', tamanho = 10 WHERE tenant_id = t AND situacao = 'em_andamento';
  -- expirar (retenção): o mesmo UPDATE que a rotina faz tem de passar pelas constraints
  UPDATE public.backup_execucoes
     SET situacao = 'expirado', expirado_em = now(), concluido_em = NULL, caminho = NULL
   WHERE tenant_id = t AND situacao = 'concluido';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'FALHA: esperava expirar 1 backup, expirou %', n; END IF;
  RAISE NOTICE 'ok: backup concluído expira sem violar as constraints';
  -- e depois de expirado o dia fica livre para outro backup
  INSERT INTO public.backup_execucoes (tenant_id, dia) VALUES (t, current_date);
  SELECT count(*) INTO n FROM public.backup_execucoes WHERE tenant_id = t;
  RESET ROLE;
  IF n <> 3 THEN RAISE EXCEPTION 'FALHA: esperava 3 execuções, achou %', n; END IF;

  -- o bucket existe e é privado
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'backups-clientes' AND public = false) THEN
    RAISE EXCEPTION 'FALHA: bucket backups-clientes ausente ou público';
  END IF;
  RAISE NOTICE 'ok: bucket privado';
END $$;
ROLLBACK;
