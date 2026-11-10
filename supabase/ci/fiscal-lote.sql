-- Sugestão fiscal em lote para a tela Fiscal dos produtos (PR 6): mesma resposta de fiscal_sugerir para cada NCM, na ordem da entrada,
-- com o regime da empresa; sobrescrita e ocultação da empresa valem; limite de 300; só leitura; recusa anônimo e perfil do salão.
-- Desfaz tudo com ROLLBACK.
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
CREATE FUNCTION ci.lote(uid uuid, itens jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  PERFORM ci.entrar(uid);
  r := public.fiscal_sugerir_lote(itens);
  PERFORM ci.sair();
  RETURN r;
END $$;

DO $$
DECLARE
  ta constant uuid := 'f5111111-1111-1111-1111-111111111111';
  tb constant uuid := 'f5222222-2222-2222-2222-222222222222';
  adm constant uuid := 'f5000000-0000-0000-0000-000000000001';
  gar constant uuid := 'f5000000-0000-0000-0000-000000000002';
  admb constant uuid := 'f5000000-0000-0000-0000-000000000003';
  pg_rev constant uuid := 'a5000000-0000-0000-0000-000000000001';
  pg_st constant uuid := 'a5000000-0000-0000-0000-000000000002';
  pa_emp constant uuid := 'a5000000-0000-0000-0000-000000000003';
  g_4 constant uuid := 'b5000000-0000-0000-0000-000000000001';
  g_8 constant uuid := 'b5000000-0000-0000-0000-000000000002';
  g_e1 constant uuid := 'b5000000-0000-0000-0000-000000000003';
  g_e2 constant uuid := 'b5000000-0000-0000-0000-000000000004';
  g_cest constant uuid := 'b5000000-0000-0000-0000-000000000005';
  r jsonb; n integer;
BEGIN
  INSERT INTO tenants (id, nome) VALUES (ta, 'Empresa F'), (tb, 'Empresa G');
  INSERT INTO empresas (tenant_id, razao_social, ramo_atividade, regime_tributario)
    VALUES (ta, 'Empresa F LTDA', 'clinica', 'simples'), (tb, 'Empresa G LTDA', 'clinica', 'lucro_presumido');
  INSERT INTO auth.users (id, email) VALUES (adm, 'a@f5.ci'), (gar, 'g@f5.ci'), (admb, 'b@g5.ci');
  UPDATE profiles SET tenant_id = ta, nome = 'adm' WHERE id = adm;
  UPDATE profiles SET tenant_id = ta, nome = 'gar' WHERE id = gar;
  UPDATE profiles SET tenant_id = tb, nome = 'admb' WHERE id = admb;
  DELETE FROM user_roles WHERE user_id IN (adm, gar, admb);
  INSERT INTO user_roles (user_id, tenant_id, role) VALUES (adm, ta, 'administrador'), (gar, ta, 'garcom'), (admb, tb, 'administrador');

  INSERT INTO fiscal_perfis (id, tenant_id, nome, cst_icms, csosn, cfop, aliq_icms) VALUES
    (pg_rev, NULL, 'Revenda', '00', '102', '5102', 18),
    (pg_st, NULL, 'Substituição tributária', '60', '500', '5405', 0),
    (pa_emp, ta, 'Perfil da empresa F', '00', '101', '5101', 12);
  INSERT INTO fiscal_regras (id, perfil_id, ncm_prefixo, cest, vigencia_inicio) VALUES
    (g_4, pg_rev, '2309', NULL, '2020-01-01'),
    (g_8, pg_st, '23091000', NULL, '2020-01-01'),
    (g_e1, pg_rev, '1101', NULL, '2020-01-01'),
    (g_e2, pg_st, '1101', NULL, '2020-01-01'),
    (g_cest, pg_st, '8708', '0100100', '2020-01-01');

  -- ===== quem pode =====
  PERFORM ci.deve_falhar(NULL, $c$SELECT public.fiscal_sugerir_lote('[]'::jsonb)$c$, 'anônimo consulta em lote');
  PERFORM ci.deve_falhar(gar, $c$SELECT public.fiscal_sugerir_lote('[]'::jsonb)$c$, 'perfil do salão consulta em lote');

  -- ===== resposta =====
  r := ci.lote(adm, '[{"ncm":"23091000"},{"ncm":"23099000"},{"ncm":"99999999"},{"ncm":"2309"},{"ncm":"11011000"},{"ncm":"87089990","cest":"0100100"},{"ncm":"87089990"}]');
  PERFORM ci.exige(r ->> 'regime' = 'simples' AND jsonb_array_length(r -> 'itens') = 7, 'devolve o regime da empresa e um resultado por item');
  PERFORM ci.exige(r #>> '{itens,0,ncm}' = '23091000' AND r #>> '{itens,0,resultado,status}' = 'regra'
                   AND r #>> '{itens,0,resultado,regra,id}' = g_8::text AND r #>> '{itens,0,resultado,perfil,csosn}' = '500',
                   'NCM de 8 dígitos usa a regra mais específica, na ordem da entrada');
  PERFORM ci.exige(r #>> '{itens,1,resultado,regra,id}' = g_4::text AND r #>> '{itens,1,resultado,perfil,cfop}' = '5102', 'NCM sem regra de 8 dígitos usa a de 4');
  PERFORM ci.exige(r #>> '{itens,2,resultado,status}' = 'sem_regra', 'NCM sem regra na base');
  PERFORM ci.exige(r #>> '{itens,3,resultado,status}' = 'ncm_invalido', 'NCM incompleto');
  PERFORM ci.exige(r #>> '{itens,4,resultado,status}' = 'empate' AND jsonb_array_length(r #> '{itens,4,resultado,candidatas}') = 2, 'empate devolve as candidatas');
  PERFORM ci.exige(r #>> '{itens,5,resultado,regra,id}' = g_cest::text AND r #>> '{itens,5,cest}' = '0100100', 'o CEST do produto entra na consulta');
  PERFORM ci.exige(r #>> '{itens,6,resultado,status}' = 'sem_regra', 'sem o CEST a regra com CEST não vale');
  PERFORM ci.exige(jsonb_array_length(ci.lote(adm, '[]') -> 'itens') = 0, 'lista vazia devolve lista vazia');

  -- ===== igual a consultar um por um =====
  PERFORM ci.entrar(adm);
  PERFORM ci.exige(public.fiscal_sugerir('23099000', NULL, 'venda', NULL, NULL, NULL) = r #> '{itens,1,resultado}', 'o lote devolve o mesmo que fiscal_sugerir');
  PERFORM ci.sair();

  -- ===== empresa: sobrescrita e ocultação valem; regime vem da empresa =====
  INSERT INTO fiscal_empresa_regras (tenant_id, perfil_id, ncm_prefixo, vigencia_inicio) VALUES (ta, pa_emp, '2309', '2020-01-01');
  INSERT INTO fiscal_empresa_ocultas (tenant_id, regra_id, motivo) VALUES (ta, g_cest, 'não se aplica');
  r := ci.lote(adm, '[{"ncm":"23099000"},{"ncm":"87089990","cest":"0100100"}]');
  PERFORM ci.exige(r #>> '{itens,0,resultado,regra,origem}' = 'empresa' AND r #>> '{itens,0,resultado,perfil,cfop}' = '5101', 'sobrescrita da empresa vale no lote');
  PERFORM ci.exige(r #>> '{itens,1,resultado,status}' = 'sem_regra', 'regra ocultada pela empresa não aparece no lote');
  r := ci.lote(admb, '[{"ncm":"23099000"},{"ncm":"87089990","cest":"0100100"}]');
  PERFORM ci.exige(r ->> 'regime' = 'normal' AND r #>> '{itens,0,resultado,regra,id}' = g_4::text AND r #>> '{itens,1,resultado,regra,id}' = g_cest::text,
                   'a outra empresa tem o regime e as regras dela');

  -- ===== entrada inválida =====
  PERFORM ci.deve_falhar(adm, $c$SELECT public.fiscal_sugerir_lote('{}'::jsonb)$c$, 'entrada que não é lista');
  PERFORM ci.deve_falhar(adm, $c$SELECT public.fiscal_sugerir_lote(NULL)$c$, 'entrada nula');
  PERFORM ci.deve_falhar(adm, $c$SELECT public.fiscal_sugerir_lote('["23091000"]'::jsonb)$c$, 'item que não é objeto');
  PERFORM ci.deve_falhar(adm, $c$SELECT public.fiscal_sugerir_lote((SELECT jsonb_agg(jsonb_build_object('ncm', '23091000')) FROM generate_series(1, 301)))$c$, 'mais de 300 itens');
  PERFORM ci.exige(jsonb_array_length(ci.lote(adm, (SELECT jsonb_agg(jsonb_build_object('ncm', '23091000')) FROM generate_series(1, 300))) -> 'itens') = 300, 'exatamente 300 itens passa');

  -- ===== só leitura =====
  SELECT count(*) INTO n FROM fiscal_regras;
  PERFORM ci.lote(adm, '[{"ncm":"23091000"}]');
  PERFORM ci.exige((SELECT count(*) FROM fiscal_regras) = n, 'consultar em lote não altera as tabelas');
END $$;
ROLLBACK;
