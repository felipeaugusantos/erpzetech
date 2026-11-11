-- Marcador de contrato "clínica sem pet shop": cabe na tabela de liberações, só a equipe (service_role) grava,
-- o tenant só lê as próprias, e valor fora da lista continua recusado. Desfaz tudo com ROLLBACK.
\set ON_ERROR_STOP on
BEGIN;
CREATE SCHEMA ci;
GRANT USAGE ON SCHEMA ci TO PUBLIC;
CREATE FUNCTION ci.entrar(uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(uid::text, ''), false);
  EXECUTE CASE WHEN uid IS NULL THEN 'SET ROLE anon' ELSE 'SET ROLE authenticated' END;
END $$;
CREATE FUNCTION ci.sair() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', false);
  EXECUTE 'RESET ROLE';
END $$;
CREATE FUNCTION ci.deve_falhar(uid uuid, cmd text, descricao text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE falhou boolean := false;
BEGIN
  PERFORM ci.entrar(uid);
  BEGIN EXECUTE cmd; EXCEPTION WHEN OTHERS THEN falhou := true; END;
  PERFORM ci.sair();
  IF NOT falhou THEN RAISE EXCEPTION 'FALHA: esperava erro em "%"', descricao; END IF;
  RAISE NOTICE 'ok: % recusado', descricao;
END $$;
CREATE FUNCTION ci.exige(condicao boolean, descricao text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF condicao IS NOT TRUE THEN RAISE EXCEPTION 'FALHA: %', descricao; END IF;
  RAISE NOTICE 'ok: %', descricao;
END $$;

DO $$
DECLARE
  ta constant uuid := 'd1111111-1111-1111-1111-111111111111';
  tb constant uuid := 'd2222222-2222-2222-2222-222222222222';
  ua constant uuid := 'd0000000-0000-0000-0000-000000000001';
  ub constant uuid := 'd0000000-0000-0000-0000-000000000002';
  ea uuid; eb uuid; n integer;
BEGIN
  INSERT INTO tenants (id, nome) VALUES (ta, 'Clínica A'), (tb, 'Clínica B');
  INSERT INTO empresas (tenant_id, razao_social, ramo_atividade) VALUES (ta, 'Clínica A LTDA', 'clinica') RETURNING id INTO ea;
  INSERT INTO empresas (tenant_id, razao_social, ramo_atividade) VALUES (tb, 'Clínica B LTDA', 'clinica') RETURNING id INTO eb;
  INSERT INTO auth.users (id, email) VALUES (ua, 'a@c.ci'), (ub, 'b@c.ci');
  UPDATE profiles SET tenant_id = ta, nome = 'ua' WHERE id = ua;
  UPDATE profiles SET tenant_id = tb, nome = 'ub' WHERE id = ub;

  -- o serviço grava o marcador (a equipe), junto da liberação da clínica
  INSERT INTO empresa_modulos_liberados (empresa_id, modulo) VALUES (ea, 'clinica'), (ea, 'sem_petshop');
  PERFORM ci.exige((SELECT count(*) = 2 FROM empresa_modulos_liberados WHERE empresa_id = ea), 'o marcador sem_petshop cabe na tabela de liberações');

  -- valor fora da lista continua recusado
  PERFORM ci.deve_falhar(NULL, format($c$INSERT INTO empresa_modulos_liberados (empresa_id, modulo) VALUES (%L, 'dragao')$c$, ea), 'módulo desconhecido');

  -- o tenant lê só as próprias liberações e não grava nenhuma
  PERFORM ci.entrar(ua);
  SELECT count(*) INTO n FROM empresa_modulos_liberados;
  PERFORM ci.sair();
  PERFORM ci.exige(n = 2, 'a empresa lê o próprio marcador');
  PERFORM ci.entrar(ub);
  SELECT count(*) INTO n FROM empresa_modulos_liberados;
  PERFORM ci.sair();
  PERFORM ci.exige(n = 0, 'outra empresa não vê o marcador alheio');
  PERFORM ci.deve_falhar(ua, format($c$INSERT INTO empresa_modulos_liberados (empresa_id, modulo) VALUES (%L, 'sem_petshop')$c$, ea), 'empresa não grava o próprio marcador');
  -- apagar não tem efeito para a empresa (a proteção da tabela filtra a linha)
  PERFORM ci.entrar(ua);
  DELETE FROM empresa_modulos_liberados WHERE empresa_id = ea AND modulo = 'sem_petshop';
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT count(*) = 2 FROM empresa_modulos_liberados WHERE empresa_id = ea), 'o marcador continua gravado');
END $$;
ROLLBACK;
