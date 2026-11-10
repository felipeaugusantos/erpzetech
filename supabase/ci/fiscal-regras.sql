-- Parametrização fiscal por NCM (PR 2): a função fiscal_sugerir espelha src/lib/fiscal-regras.ts (precedência, especificidade, vigência,
-- empate), as tabelas não têm acesso direto, o perfil do salão não consulta e o dono dos perfis é conferido. Desfaz tudo com ROLLBACK.
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
-- Falha de propósito como dono do banco (restrições e gatilhos): comando que TEM de dar erro.
CREATE FUNCTION ci.deve_falhar_dono(cmd text, descricao text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE falhou boolean := false;
BEGIN
  BEGIN EXECUTE cmd; EXCEPTION WHEN OTHERS THEN falhou := true; END;
  IF NOT falhou THEN RAISE EXCEPTION 'FALHA: esperava erro em "%"', descricao; END IF;
  RAISE NOTICE 'ok: % recusado', descricao;
END $$;
-- Chama a sugestão como a pessoa indicada.
CREATE FUNCTION ci.sug(uid uuid, p_ncm text, p_cest text DEFAULT NULL, p_op text DEFAULT 'venda',
                       p_data date DEFAULT '2027-03-10', p_uf text DEFAULT NULL, p_regime text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  PERFORM ci.entrar(uid);
  r := public.fiscal_sugerir(p_ncm, p_cest, p_op, p_data, p_uf, p_regime);
  PERFORM ci.sair();
  RETURN r;
END $$;

DO $$
DECLARE
  ta constant uuid := 'f1111111-1111-1111-1111-111111111111';
  tb constant uuid := 'f2222222-2222-2222-2222-222222222222';
  adm constant uuid := 'f0000000-0000-0000-0000-000000000001';
  vend constant uuid := 'f0000000-0000-0000-0000-000000000002';
  gar constant uuid := 'f0000000-0000-0000-0000-000000000003';
  admb constant uuid := 'f0000000-0000-0000-0000-000000000004';
  -- perfis
  pg_rev constant uuid := 'a0000000-0000-0000-0000-000000000001';
  pg_st constant uuid := 'a0000000-0000-0000-0000-000000000002';
  pg_dev constant uuid := 'a0000000-0000-0000-0000-000000000003';
  pg_sn constant uuid := 'a0000000-0000-0000-0000-000000000004';
  pa_emp constant uuid := 'a0000000-0000-0000-0000-000000000005';
  pb_emp constant uuid := 'a0000000-0000-0000-0000-000000000006';
  -- regras globais
  g_4 constant uuid := 'b0000000-0000-0000-0000-000000000001';
  g_8 constant uuid := 'b0000000-0000-0000-0000-000000000002';
  g_dev constant uuid := 'b0000000-0000-0000-0000-000000000003';
  g_sn constant uuid := 'b0000000-0000-0000-0000-000000000004';
  g_v1 constant uuid := 'b0000000-0000-0000-0000-000000000005';
  g_v2 constant uuid := 'b0000000-0000-0000-0000-000000000006';
  g_uf constant uuid := 'b0000000-0000-0000-0000-000000000007';
  g_in constant uuid := 'b0000000-0000-0000-0000-000000000008';
  g_cest constant uuid := 'b0000000-0000-0000-0000-000000000009';
  g_e1 constant uuid := 'b0000000-0000-0000-0000-00000000000a';
  g_e2 constant uuid := 'b0000000-0000-0000-0000-00000000000b';
  -- regras da empresa
  e_2 constant uuid := 'c0000000-0000-0000-0000-000000000001';
  e_x constant uuid := 'c0000000-0000-0000-0000-000000000002';
  r jsonb; n integer;
BEGIN
  INSERT INTO tenants (id, nome) VALUES (ta, 'Empresa A'), (tb, 'Empresa B');
  INSERT INTO empresas (tenant_id, razao_social, ramo_atividade, regime_tributario)
    VALUES (ta, 'Empresa A LTDA', 'clinica', 'simples'), (tb, 'Empresa B LTDA', 'clinica', 'lucro_presumido');
  INSERT INTO auth.users (id, email) VALUES (adm, 'a@f.ci'), (vend, 'v@f.ci'), (gar, 'g@f.ci'), (admb, 'b@f.ci');
  UPDATE profiles SET tenant_id = ta, nome = 'adm' WHERE id = adm;
  UPDATE profiles SET tenant_id = ta, nome = 'vend' WHERE id = vend;
  UPDATE profiles SET tenant_id = ta, nome = 'gar' WHERE id = gar;
  UPDATE profiles SET tenant_id = tb, nome = 'admb' WHERE id = admb;
  DELETE FROM user_roles WHERE user_id IN (adm, vend, gar, admb);
  INSERT INTO user_roles (user_id, tenant_id, role) VALUES
    (adm, ta, 'administrador'), (vend, ta, 'vendedor'), (gar, ta, 'garcom'), (admb, tb, 'administrador');

  INSERT INTO fiscal_perfis (id, tenant_id, nome, cst_icms, csosn, cfop, aliq_icms, cst_pis, aliq_pis, cst_ibs_cbs, cclasstrib, origem) VALUES
    (pg_rev, NULL, 'Revenda tributada', '00', NULL, '5102', 18, '01', 1.65, '000', '000001', '0'),
    (pg_st, NULL, 'Substituição tributária', '60', NULL, '5405', 0, '05', NULL, NULL, NULL, NULL),
    (pg_dev, NULL, 'Devolução', '00', NULL, '5202', NULL, NULL, NULL, NULL, NULL, NULL),
    (pg_sn, NULL, 'Simples sem crédito', NULL, '102', '5102', NULL, NULL, NULL, NULL, NULL, NULL),
    (pa_emp, ta, 'Perfil próprio A', '00', NULL, '5101', 12, NULL, NULL, NULL, NULL, NULL),
    (pb_emp, tb, 'Perfil próprio B', '00', NULL, '5949', 7, NULL, NULL, NULL, NULL, NULL);

  INSERT INTO fiscal_regras (id, perfil_id, ncm_prefixo, cest, operacao, regime, uf_destino, vigencia_inicio, vigencia_fim, versao, ativa) VALUES
    (g_4, pg_rev, '2309', NULL, NULL, NULL, NULL, '2027-01-01', NULL, 1, true),
    (g_8, pg_st, '23091000', NULL, NULL, NULL, NULL, '2027-01-01', NULL, 1, true),
    (g_dev, pg_dev, '2309', NULL, 'devolucao', NULL, NULL, '2027-01-01', NULL, 1, true),
    (g_sn, pg_sn, '3004', NULL, NULL, 'simples', NULL, '2027-01-01', NULL, 1, true),
    (g_v1, pg_rev, '4202', NULL, NULL, NULL, NULL, '2027-01-01', '2027-06-30', 1, true),
    (g_v2, pg_st, '4202', NULL, NULL, NULL, NULL, '2027-07-01', NULL, 2, true),
    (g_uf, pg_st, '9503', NULL, NULL, NULL, 'SP', '2027-01-01', NULL, 1, true),
    (g_in, pg_st, '6402', NULL, NULL, NULL, NULL, '2027-01-01', NULL, 1, false),
    (g_cest, pg_st, '8708', '0100100', NULL, NULL, NULL, '2027-01-01', NULL, 1, true),
    (g_e1, pg_rev, '1101', NULL, NULL, NULL, NULL, '2027-01-01', NULL, 1, true),
    (g_e2, pg_st, '1101', NULL, NULL, NULL, NULL, '2027-01-01', NULL, 1, true);

  -- ===== quem pode consultar =====
  PERFORM ci.deve_falhar(NULL, $c$SELECT public.fiscal_sugerir('23091000')$c$, 'anônimo consulta a sugestão');
  PERFORM ci.deve_falhar(gar, $c$SELECT public.fiscal_sugerir('23091000')$c$, 'perfil do salão consulta a sugestão');
  r := ci.sug(vend, '23091000');
  PERFORM ci.exige(r ->> 'status' = 'regra', 'vendedor consulta a sugestão');

  -- ===== precedência por especificidade do NCM =====
  r := ci.sug(adm, '23091000');
  PERFORM ci.exige(r ->> 'status' = 'regra' AND r #>> '{regra,id}' = g_8::text AND r #>> '{regra,origem}' = 'global',
                   'NCM de 8 dígitos vence o de 4');
  PERFORM ci.exige(r #>> '{regra,ncmPrefixo}' = '23091000' AND r #>> '{regra,perfilNome}' = 'Substituição tributária',
                   'a regra escolhida traz o prefixo do NCM e o nome do perfil');
  PERFORM ci.exige(r -> 'perfil' = '{"cstIcms":"60","cfop":"5405","aliqIcms":0,"cstPis":"05"}'::jsonb,
                   'perfil devolvido em camelCase, sem nulos, com zero preservado');
  r := ci.sug(adm, '23099000');
  PERFORM ci.exige(r #>> '{regra,id}' = g_4::text AND r #>> '{regra,versao}' = '1', 'sem a de 8 dígitos, vale a de 4');
  PERFORM ci.exige(r #>> '{perfil,cfop}' = '5102' AND (r #>> '{perfil,aliqPis}')::numeric = 1.65, 'perfil da regra de 4 dígitos');
  r := ci.sug(adm, '2309.10.00');
  PERFORM ci.exige(r #>> '{regra,id}' = g_8::text, 'NCM com pontuação');

  -- ===== sem regra e NCM inválido =====
  r := ci.sug(adm, '99999999');
  PERFORM ci.exige(r ->> 'status' = 'sem_regra' AND r -> 'regra' = 'null'::jsonb AND r -> 'perfil' = '{}'::jsonb,
                   'sem regra que case devolve sem_regra e perfil vazio');
  r := ci.sug(adm, '2309');
  PERFORM ci.exige(r ->> 'status' = 'ncm_invalido', 'NCM com menos de 8 dígitos');
  r := ci.sug(adm, '230910000');
  PERFORM ci.exige(r ->> 'status' = 'ncm_invalido', 'NCM com mais de 8 dígitos');
  r := ci.sug(adm, NULL);
  PERFORM ci.exige(r ->> 'status' = 'ncm_invalido', 'NCM nulo');

  -- ===== operação, regime, CEST e UF =====
  r := ci.sug(adm, '23099000', p_op => 'devolucao');
  PERFORM ci.exige(r #>> '{regra,id}' = g_dev::text, 'operação casando vence a regra sem operação');
  r := ci.sug(adm, '23099000', p_op => 'transferencia');
  PERFORM ci.exige(r #>> '{regra,id}' = g_4::text, 'outra operação cai na regra sem operação');
  r := ci.sug(adm, '30049099');
  PERFORM ci.exige(r #>> '{regra,id}' = g_sn::text, 'regime da empresa (simples) casa a regra de regime');
  r := ci.sug(admb, '30049099');
  PERFORM ci.exige(r ->> 'status' = 'sem_regra', 'empresa de regime normal não recebe a regra do Simples');
  r := ci.sug(admb, '30049099', p_regime => 'simples');
  PERFORM ci.exige(r #>> '{regra,id}' = g_sn::text, 'regime informado vale no lugar do da empresa');
  PERFORM ci.deve_falhar(adm, $c$SELECT public.fiscal_sugerir('30049099', NULL, 'venda', NULL, NULL, 'lucro')$c$, 'regime inválido');
  r := ci.sug(adm, '87089990');
  PERFORM ci.exige(r ->> 'status' = 'sem_regra', 'regra com CEST exige o CEST');
  r := ci.sug(adm, '87089990', p_cest => '01.001.00');
  PERFORM ci.exige(r #>> '{regra,id}' = g_cest::text, 'CEST com pontuação casa');
  r := ci.sug(adm, '95030099');
  PERFORM ci.exige(r ->> 'status' = 'sem_regra', 'regra com UF exige a UF');
  r := ci.sug(adm, '95030099', p_uf => 'sp');
  PERFORM ci.exige(r #>> '{regra,id}' = g_uf::text, 'UF em minúsculas casa');
  r := ci.sug(adm, '95030099', p_uf => 'RJ');
  PERFORM ci.exige(r ->> 'status' = 'sem_regra', 'outra UF não casa');

  -- ===== vigência (fim inclusivo) e regra inativa =====
  r := ci.sug(adm, '42021000', p_data => '2027-06-30');
  PERFORM ci.exige(r #>> '{regra,id}' = g_v1::text, 'último dia da versão 1');
  r := ci.sug(adm, '42021000', p_data => '2027-07-01');
  PERFORM ci.exige(r #>> '{regra,id}' = g_v2::text AND r #>> '{regra,versao}' = '2', 'primeiro dia da versão 2');
  r := ci.sug(adm, '42021000', p_data => '2026-12-31');
  PERFORM ci.exige(r ->> 'status' = 'sem_regra', 'antes da vigência não há regra');
  r := ci.sug(adm, '64021000');
  PERFORM ci.exige(r ->> 'status' = 'sem_regra', 'regra inativa é ignorada');

  -- ===== empate =====
  r := ci.sug(adm, '11011000');
  PERFORM ci.exige(r ->> 'status' = 'empate' AND r -> 'regra' = 'null'::jsonb AND r -> 'perfil' = '{}'::jsonb
                   AND jsonb_array_length(r -> 'candidatas') = 2, 'empate devolve as candidatas e não escolhe');
  PERFORM ci.exige(r #>> '{candidatas,0,id}' = g_e1::text AND r #>> '{candidatas,1,id}' = g_e2::text
                   AND r #>> '{candidatas,0,perfil,cfop}' = '5102' AND r #>> '{candidatas,0,origem}' = 'global',
                   'candidatas em ordem estável, com origem e perfil');

  -- ===== sobrescrita da empresa e ocultação =====
  INSERT INTO fiscal_empresa_regras (id, tenant_id, perfil_id, ncm_prefixo, vigencia_inicio) VALUES (e_2, ta, pa_emp, '23', '2027-01-01');
  r := ci.sug(adm, '23091000');
  PERFORM ci.exige(r #>> '{regra,id}' = e_2::text AND r #>> '{regra,origem}' = 'empresa' AND r #>> '{perfil,cfop}' = '5101',
                   'regra da empresa vence a global, mesmo menos específica (2 dígitos contra 8)');
  r := ci.sug(admb, '23091000');
  PERFORM ci.exige(r #>> '{regra,id}' = g_8::text, 'a sobrescrita de uma empresa não vale para a outra');
  INSERT INTO fiscal_empresa_ocultas (tenant_id, regra_id, motivo) VALUES (ta, g_8, 'Produto com tratamento próprio');
  INSERT INTO fiscal_empresa_regras (id, tenant_id, perfil_id, ncm_prefixo, vigencia_inicio, ativa) VALUES (e_x, ta, pa_emp, '2309', '2027-01-01', false);
  DELETE FROM fiscal_empresa_regras WHERE id = e_2;
  r := ci.sug(adm, '23091000');
  PERFORM ci.exige(r #>> '{regra,id}' = g_4::text, 'regra global ocultada é ignorada e vale a seguinte; sobrescrita inativa não vale');
  r := ci.sug(admb, '23091000');
  PERFORM ci.exige(r #>> '{regra,id}' = g_8::text, 'ocultar numa empresa não esconde a regra das outras');
  INSERT INTO fiscal_empresa_regras (tenant_id, perfil_id, ncm_prefixo, vigencia_inicio) VALUES (ta, pa_emp, '2309', '2027-01-01'), (ta, pg_dev, '2309', '2027-01-01');
  r := ci.sug(adm, '23091000');
  PERFORM ci.exige(r ->> 'status' = 'empate' AND (r #>> '{candidatas,0,origem}') = 'empresa', 'empate dentro da empresa não cai na global');
  DELETE FROM fiscal_empresa_regras WHERE tenant_id = ta;
  DELETE FROM fiscal_empresa_ocultas WHERE tenant_id = ta;

  -- ===== a consulta não grava =====
  SELECT count(*) INTO n FROM fiscal_regras;
  PERFORM ci.sug(adm, '23091000');
  PERFORM ci.exige((SELECT count(*) FROM fiscal_regras) = n, 'consultar não altera as tabelas');

  -- ===== sem acesso direto às tabelas =====
  PERFORM ci.deve_falhar(adm, 'SELECT count(*) FROM public.fiscal_perfis', 'leitura direta de fiscal_perfis');
  PERFORM ci.deve_falhar(adm, 'SELECT count(*) FROM public.fiscal_regras', 'leitura direta de fiscal_regras');
  PERFORM ci.deve_falhar(adm, 'SELECT count(*) FROM public.fiscal_empresa_regras', 'leitura direta de fiscal_empresa_regras');
  PERFORM ci.deve_falhar(adm, 'SELECT count(*) FROM public.fiscal_empresa_ocultas', 'leitura direta de fiscal_empresa_ocultas');
  PERFORM ci.deve_falhar(adm, format($c$INSERT INTO public.fiscal_regras (perfil_id, ncm_prefixo, vigencia_inicio) VALUES (%L, '23', '2027-01-01')$c$, pg_rev), 'gravação direta de regra global');
  PERFORM ci.deve_falhar(adm, format($c$INSERT INTO public.fiscal_empresa_regras (tenant_id, perfil_id, ncm_prefixo, vigencia_inicio) VALUES (%L, %L, '23', '2027-01-01')$c$, ta, pg_rev), 'gravação direta de sobrescrita');
  PERFORM ci.deve_falhar(NULL, 'SELECT count(*) FROM public.fiscal_regras', 'leitura anônima da base global');

  -- ===== formato e dono dos perfis (como dono do banco) =====
  PERFORM ci.deve_falhar_dono(format($c$INSERT INTO fiscal_regras (perfil_id, ncm_prefixo, vigencia_inicio) VALUES (%L, '2', '2027-01-01')$c$, pg_rev), 'prefixo de 1 dígito');
  PERFORM ci.deve_falhar_dono(format($c$INSERT INTO fiscal_regras (perfil_id, ncm_prefixo, vigencia_inicio) VALUES (%L, '23.09', '2027-01-01')$c$, pg_rev), 'prefixo com pontuação');
  PERFORM ci.deve_falhar_dono(format($c$INSERT INTO fiscal_regras (perfil_id, ncm_prefixo, cest, vigencia_inicio) VALUES (%L, '2309', '123', '2027-01-01')$c$, pg_rev), 'CEST com 3 dígitos');
  PERFORM ci.deve_falhar_dono(format($c$INSERT INTO fiscal_regras (perfil_id, ncm_prefixo, uf_destino, vigencia_inicio) VALUES (%L, '2309', 'sp', '2027-01-01')$c$, pg_rev), 'UF em minúsculas');
  PERFORM ci.deve_falhar_dono(format($c$INSERT INTO fiscal_regras (perfil_id, ncm_prefixo, regime, vigencia_inicio) VALUES (%L, '2309', 'lucro', '2027-01-01')$c$, pg_rev), 'regime desconhecido');
  PERFORM ci.deve_falhar_dono(format($c$INSERT INTO fiscal_regras (perfil_id, ncm_prefixo, vigencia_inicio, vigencia_fim) VALUES (%L, '2309', '2027-02-01', '2027-01-31')$c$, pg_rev), 'fim antes do início');
  PERFORM ci.deve_falhar_dono(format($c$INSERT INTO fiscal_regras (perfil_id, ncm_prefixo, vigencia_inicio, versao) VALUES (%L, '2309', '2027-01-01', 0)$c$, pg_rev), 'versão zero');
  PERFORM ci.deve_falhar_dono($c$INSERT INTO fiscal_perfis (nome, cfop) VALUES ('Cfop ruim', '51')$c$, 'CFOP com 2 dígitos');
  PERFORM ci.deve_falhar_dono($c$INSERT INTO fiscal_perfis (nome, aliq_icms) VALUES ('Alíquota ruim', 101)$c$, 'alíquota acima de 100');
  PERFORM ci.deve_falhar_dono($c$INSERT INTO fiscal_perfis (nome) VALUES ('REVENDA TRIBUTADA')$c$, 'nome repetido na base global (sem diferenciar maiúsculas)');
  PERFORM ci.deve_falhar_dono(format($c$INSERT INTO fiscal_empresa_ocultas (tenant_id, regra_id, motivo) VALUES (%L, %L, 'x')$c$, ta, g_4), 'ocultar sem motivo');
  PERFORM ci.deve_falhar_dono(format($c$INSERT INTO fiscal_regras (perfil_id, ncm_prefixo, vigencia_inicio) VALUES (%L, '2309', '2027-01-01')$c$, pa_emp), 'regra global com perfil de empresa');
  PERFORM ci.deve_falhar_dono(format($c$INSERT INTO fiscal_empresa_regras (tenant_id, perfil_id, ncm_prefixo, vigencia_inicio) VALUES (%L, %L, '2309', '2027-01-01')$c$, ta, pb_emp), 'sobrescrita com perfil de outra empresa');
  PERFORM ci.deve_falhar_dono(format($c$UPDATE fiscal_perfis SET tenant_id = %L WHERE id = %L$c$, ta, pg_rev), 'mudar o dono de um perfil');
  PERFORM ci.deve_falhar_dono(format($c$DELETE FROM fiscal_perfis WHERE id = %L$c$, pg_rev), 'apagar perfil que ainda tem regra');
  INSERT INTO fiscal_empresa_regras (tenant_id, perfil_id, ncm_prefixo, vigencia_inicio) VALUES (ta, pg_rev, '2309', '2027-01-01');
  PERFORM ci.exige(true, 'sobrescrita da empresa pode usar perfil global');
END $$;
ROLLBACK;
