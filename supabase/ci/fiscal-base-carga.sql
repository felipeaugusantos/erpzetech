-- Carga da base fiscal global pela equipe (PR 3): prévia não grava, publicação é tudo ou nada, reenvio não muda nada, versões encerram
-- a anterior, perfil só é reaproveitado se idêntico, encerrar só antecipa, e nada disso é chamável por quem não é service_role.
-- Chama as funções como dono do banco (o service_role da tela da equipe) e confere que authenticated e anon são recusados.
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
CREATE FUNCTION ci.deve_falhar_dono(cmd text, descricao text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE falhou boolean := false;
BEGIN
  BEGIN EXECUTE cmd; EXCEPTION WHEN OTHERS THEN falhou := true; END;
  IF NOT falhou THEN RAISE EXCEPTION 'FALHA: esperava erro em "%"', descricao; END IF;
  RAISE NOTICE 'ok: % recusado', descricao;
END $$;
CREATE FUNCTION ci.exige(condicao boolean, descricao text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF condicao IS NOT TRUE THEN RAISE EXCEPTION 'FALHA: %', descricao; END IF;
  RAISE NOTICE 'ok: %', descricao;
END $$;
-- Uma linha da planilha: ncm, perfil, início e o resto (tributação, fim, uf, cest…) em extra.
CREATE FUNCTION ci.linha(n integer, ncm text, perfil text, ini text, extra jsonb DEFAULT '{"cfop":"5102"}') RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('linha', n, 'ncm', ncm, 'perfil', perfil, 'vigencia_inicio', ini) || extra
$$;
CREATE FUNCTION ci.sug(uid uuid, p_ncm text, p_data date) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  PERFORM ci.entrar(uid);
  r := public.fiscal_sugerir(p_ncm, NULL, 'venda', p_data, NULL, 'normal');
  PERFORM ci.sair();
  RETURN r;
END $$;

DO $$
DECLARE
  ta constant uuid := 'f3111111-1111-1111-1111-111111111111';
  adm constant uuid := 'f3000000-0000-0000-0000-000000000001';
  op constant uuid := 'f3000000-0000-0000-0000-000000000009';
  r jsonb; n_regras integer; n_perfis integer; v_id uuid; v_fim date;
  l1 jsonb; l2 jsonb; l3 jsonb; l4 jsonb;
BEGIN
  INSERT INTO tenants (id, nome) VALUES (ta, 'Empresa C');
  INSERT INTO empresas (tenant_id, razao_social, ramo_atividade, regime_tributario) VALUES (ta, 'Empresa C LTDA', 'clinica', 'lucro_presumido');
  INSERT INTO auth.users (id, email) VALUES (adm, 'a@c.ci');
  UPDATE profiles SET tenant_id = ta, nome = 'adm' WHERE id = adm;
  DELETE FROM user_roles WHERE user_id = adm;
  INSERT INTO user_roles (user_id, tenant_id, role) VALUES (adm, ta, 'administrador');

  l1 := ci.linha(2, '3004', 'Med A', '2020-01-01', '{"cst_icms":"00","cfop":"5102","aliq_icms":18}');
  l2 := ci.linha(3, '3005', 'med a', '2020-01-01', '{"cst_icms":"00","cfop":"5102","aliq_icms":18}');
  l3 := ci.linha(4, '3006', 'Med B', '2020-01-01', '{"csosn":"102","cfop":"5102","uf_destino":"SP","vigencia_fim":"2021-12-31","regime":"simples"}');
  l4 := ci.linha(5, '3007', 'Med C', '2099-01-01', '{"cfop":"5405","observacao":"entra em 2099"}');

  -- ===== só service_role =====
  PERFORM ci.deve_falhar(adm, format($c$SELECT public.fiscal_base_publicar(%L::jsonb, 'Teste', false)$c$, jsonb_build_array(l1)), 'administrador chama fiscal_base_publicar');
  PERFORM ci.deve_falhar(adm, 'SELECT public.fiscal_base_listar()', 'administrador chama fiscal_base_listar');
  PERFORM ci.deve_falhar(adm, 'SELECT public.fiscal_base_encerrar(gen_random_uuid(), current_date)', 'administrador chama fiscal_base_encerrar');
  PERFORM ci.deve_falhar(adm, format($c$SELECT public.fiscal_base_aplicar(%L::jsonb, 'Teste', NULL)$c$, jsonb_build_array(l1)), 'administrador chama fiscal_base_aplicar');
  PERFORM ci.deve_falhar(NULL, 'SELECT public.fiscal_base_listar()', 'anônimo chama fiscal_base_listar');

  -- ===== entrada inválida =====
  PERFORM ci.deve_falhar_dono($c$SELECT public.fiscal_base_publicar('{}'::jsonb, 'Teste', false)$c$, 'planilha que não é lista');
  PERFORM ci.deve_falhar_dono($c$SELECT public.fiscal_base_publicar('[]'::jsonb, 'Teste', false)$c$, 'planilha sem linhas');
  PERFORM ci.deve_falhar_dono(format($c$SELECT public.fiscal_base_publicar(%L::jsonb, 'Teste', false)$c$, (SELECT jsonb_agg(l1) FROM generate_series(1, 2001))), 'planilha com mais de 2000 linhas');
  PERFORM ci.deve_falhar_dono(format($c$SELECT public.fiscal_base_publicar(%L::jsonb, 'ab', false)$c$, jsonb_build_array(l1)), 'fonte curta demais');
  PERFORM ci.deve_falhar_dono(format($c$SELECT public.fiscal_base_publicar(%L::jsonb, NULL, false)$c$, jsonb_build_array(l1)), 'sem fonte');

  -- ===== prévia não grava =====
  SELECT count(*) INTO n_regras FROM fiscal_regras;
  SELECT count(*) INTO n_perfis FROM fiscal_perfis;
  r := public.fiscal_base_publicar(jsonb_build_array(l1, l2, l3, l4), 'Planilha de teste', false, op);
  PERFORM ci.exige((r ->> 'publicado')::boolean = false AND (r #>> '{resumo,novas}')::int = 4 AND (r #>> '{resumo,erros}')::int = 0,
                   'prévia conta 4 regras novas e nenhum erro');
  PERFORM ci.exige((SELECT count(*) FROM fiscal_regras) = n_regras AND (SELECT count(*) FROM fiscal_perfis) = n_perfis,
                   'prévia não grava regra nem perfil');
  PERFORM ci.exige(r #>> '{linhas,0,linha}' = '2' AND r #>> '{linhas,0,acao}' = 'nova' AND r #>> '{linhas,0,perfil}' = 'Med A',
                   'prévia devolve o número da linha da planilha, a ação e o perfil');

  -- ===== publicar =====
  r := public.fiscal_base_publicar(jsonb_build_array(l1, l2, l3, l4), 'Planilha de teste', true, op);
  PERFORM ci.exige((r ->> 'publicado')::boolean AND (r #>> '{resumo,novas}')::int = 4, 'publicação grava as 4 regras');
  PERFORM ci.exige((SELECT count(*) FROM fiscal_regras) = n_regras + 4, 'quatro regras novas na base');
  PERFORM ci.exige((SELECT count(*) FROM fiscal_perfis) = n_perfis + 3, 'perfil repetido entre linhas (Med A / med a) é criado uma vez só');
  PERFORM ci.exige((SELECT count(*) = 4 FROM fiscal_regras WHERE fonte = 'Planilha de teste' AND criado_por = op AND versao = 1 AND ativa),
                   'fonte, operador, versão 1 e ativa gravados');
  PERFORM ci.exige((SELECT observacao = 'entra em 2099' FROM fiscal_regras WHERE ncm_prefixo = '3007'), 'observação gravada');
  PERFORM ci.exige((SELECT uf_destino = 'SP' AND regime = 'simples' AND vigencia_fim = '2021-12-31' FROM fiscal_regras WHERE ncm_prefixo = '3006'),
                   'UF, regime e fim da vigência gravados');

  -- ===== reenvio da mesma planilha =====
  r := public.fiscal_base_publicar(jsonb_build_array(l1, l2, l3, l4), 'Planilha de teste', true, op);
  PERFORM ci.exige((r #>> '{resumo,iguais}')::int = 4 AND (r #>> '{resumo,novas}')::int = 0 AND (r ->> 'publicado')::boolean, 'a mesma planilha de novo: 4 iguais');
  PERFORM ci.exige((SELECT count(*) FROM fiscal_regras) = n_regras + 4, 'reenvio não cria regra');

  -- ===== nova versão: encerra a anterior no dia anterior =====
  r := public.fiscal_base_publicar(jsonb_build_array(ci.linha(2, '3004', 'Med A2', '2030-01-01', '{"cfop":"5405"}')), 'Reajuste', true, op);
  PERFORM ci.exige(r #>> '{linhas,0,acao}' = 'nova_versao' AND r #>> '{linhas,0,versao}' = '2', 'regra já vigente gera a versão 2');
  SELECT vigencia_fim INTO v_fim FROM fiscal_regras WHERE ncm_prefixo = '3004' AND versao = 1;
  PERFORM ci.exige(v_fim = '2029-12-31', 'a versão 1 termina no dia anterior ao início da 2');
  PERFORM ci.exige((SELECT vigencia_fim IS NULL FROM fiscal_regras WHERE ncm_prefixo = '3004' AND versao = 2), 'a versão 2 fica aberta');
  PERFORM ci.exige(ci.sug(adm, '30041000', '2029-12-31') #>> '{perfil,cfop}' = '5102', 'a sugestão em 31/12/2029 usa a versão 1');
  PERFORM ci.exige(ci.sug(adm, '30041000', '2030-01-01') #>> '{perfil,cfop}' = '5405', 'a sugestão em 01/01/2030 usa a versão 2');
  r := public.fiscal_base_publicar(jsonb_build_array(ci.linha(2, '3004', 'Med A2', '2030-01-01', '{"cfop":"5405"}')), 'Reajuste', true, op);
  PERFORM ci.exige(r #>> '{linhas,0,acao}' = 'igual', 'reenviar a versão 2 não cria a 3');

  -- ===== sucessora depois de uma regra já encerrada (sem sobreposição) =====
  r := public.fiscal_base_publicar(jsonb_build_array(ci.linha(2, '3006', 'Med B2', '2023-01-01', '{"csosn":"500","cfop":"5405","uf_destino":"SP","regime":"simples"}')), 'Depois do fim', true, op);
  PERFORM ci.exige(r #>> '{linhas,0,acao}' = 'nova_versao' AND r #>> '{linhas,0,versao}' = '2', 'sucessora de regra encerrada vira versão 2');
  PERFORM ci.exige((SELECT vigencia_fim = '2021-12-31' FROM fiscal_regras WHERE ncm_prefixo = '3006' AND versao = 1), 'a regra encerrada não é alterada');

  -- ===== erros por linha (prévia) =====
  r := public.fiscal_base_publicar(jsonb_build_array(
    ci.linha(2, '9001', 'Med A', '2020-01-01', '{"cst_icms":"00","cfop":"5102","aliq_icms":12}'),
    ci.linha(3, '3004', 'Med A3', '2025-01-01', '{"cfop":"5102"}'),
    ci.linha(4, '9002', 'Med E', '2027-02-01', '{"cfop":"5102","vigencia_fim":"2027-01-31"}'),
    ci.linha(5, '3', 'Med E', '2027-01-01', '{"cfop":"5102"}'),
    ci.linha(6, '9003', 'Med F', '2027-01-01', '{}'),
    ci.linha(7, '9004', 'Med G', '2027-01-01', '{"cfop":"5102","regime":"lucro"}'),
    ci.linha(8, '9005', 'Med H', '2027-01-01', '{"cfop":"5102"}')), 'Teste de erros', false, op);
  PERFORM ci.exige((r #>> '{resumo,erros}')::int = 6 AND (r #>> '{resumo,novas}')::int = 1, 'seis erros e uma regra boa na mesma prévia');
  PERFORM ci.exige(r #>> '{linhas,0,motivo}' LIKE '%já existe com outros valores%', 'perfil com mesmo nome e valores diferentes é recusado');
  PERFORM ci.exige(r #>> '{linhas,1,motivo}' LIKE '%precisa começar depois%', 'nova versão que começa antes da vigente é recusada');
  PERFORM ci.exige(r #>> '{linhas,2,motivo}' LIKE '%anterior ao início%', 'fim antes do início');
  PERFORM ci.exige(r #>> '{linhas,3,motivo}' LIKE '%NCM%', 'NCM de 1 dígito');
  PERFORM ci.exige(r #>> '{linhas,4,motivo}' LIKE '%ao menos um campo de tributação%', 'sem nenhum campo de tributação');
  PERFORM ci.exige(r #>> '{linhas,5,motivo}' LIKE '%Regime%', 'regime inválido');
  PERFORM ci.exige(r #>> '{linhas,6,acao}' = 'nova', 'a linha boa continua sendo reconhecida entre as com erro');

  -- ===== tudo ou nada =====
  SELECT count(*) INTO n_regras FROM fiscal_regras;
  SELECT count(*) INTO n_perfis FROM fiscal_perfis;
  r := public.fiscal_base_publicar(jsonb_build_array(
    ci.linha(2, '5001', 'Med Z', '2027-01-01', '{"cfop":"5102"}'),
    ci.linha(3, '5002', 'Med Z2', '2027-01-01', '{}')), 'Com erro', true, op);
  PERFORM ci.exige((r ->> 'publicado')::boolean = false AND (r #>> '{resumo,erros}')::int = 1, 'com um erro a publicação é recusada');
  PERFORM ci.exige((SELECT count(*) FROM fiscal_regras) = n_regras AND (SELECT count(*) FROM fiscal_perfis) = n_perfis
                   AND NOT EXISTS (SELECT 1 FROM fiscal_perfis WHERE nome = 'Med Z'), 'nada da planilha com erro foi gravado (nem a linha boa nem o perfil)');

  -- ===== listar =====
  r := public.fiscal_base_listar();
  PERFORM ci.exige((r ->> 'total')::int = (SELECT count(*) FROM fiscal_regras), 'listar devolve o total da base');
  r := public.fiscal_base_listar('3004');
  PERFORM ci.exige((r ->> 'total')::int = 2 AND r #>> '{itens,0,versao}' = '2' AND r #>> '{itens,0,status}' = 'futura'
                   AND r #>> '{itens,1,versao}' = '1' AND r #>> '{itens,1,status}' = 'vigente',
                   'busca por NCM traz as duas versões, a mais nova primeiro, com status (v1 vigente até 2029, v2 futura)');
  PERFORM ci.exige((public.fiscal_base_listar('3006') #>> '{itens,1,status}') = 'encerrada', 'regra com fim no passado aparece como encerrada');
  PERFORM ci.exige(r #>> '{itens,0,perfilNome}' = 'Med A2' AND r #>> '{itens,0,perfil,cfop}' = '5405', 'perfil e nome na listagem');
  r := public.fiscal_base_listar('Med C');
  PERFORM ci.exige((r ->> 'total')::int = 1 AND r #>> '{itens,0,status}' = 'futura', 'busca pelo nome do perfil; início em 2099 é futura');
  r := public.fiscal_base_listar('300', true);
  PERFORM ci.exige((r ->> 'total')::int = 5, 'só vigentes e futuras: 3004 v1 e v2, 3005, 3006 v2 (2023, aberta) e 3007; a 3006 v1 encerrada fica de fora');
  r := public.fiscal_base_listar(NULL, false, 2, 0);
  PERFORM ci.exige(jsonb_array_length(r -> 'itens') = 2 AND (r ->> 'total')::int > 2, 'paginação limita os itens e mantém o total');

  -- ===== encerrar =====
  SELECT id INTO v_id FROM fiscal_regras WHERE ncm_prefixo = '3005';
  PERFORM ci.exige(public.fiscal_base_encerrar(v_id, '2040-06-30') = '2040-06-30', 'encerrar define o fim');
  PERFORM ci.exige(ci.sug(adm, '30051000', '2040-06-30') ->> 'status' = 'regra' AND ci.sug(adm, '30051000', '2040-07-01') ->> 'status' = 'sem_regra',
                   'a regra vale até o último dia e não depois');
  PERFORM ci.exige(public.fiscal_base_encerrar(v_id, '2035-01-01') = '2035-01-01', 'dá para antecipar o fim de novo');
  PERFORM ci.deve_falhar_dono(format($c$SELECT public.fiscal_base_encerrar(%L, '2036-01-01')$c$, v_id), 'estender o fim');
  PERFORM ci.deve_falhar_dono(format($c$SELECT public.fiscal_base_encerrar(%L, '2019-12-31')$c$, v_id), 'encerrar antes do início');
  PERFORM ci.deve_falhar_dono(format($c$SELECT public.fiscal_base_encerrar(%L, NULL)$c$, v_id), 'encerrar sem data');
  PERFORM ci.deve_falhar_dono($c$SELECT public.fiscal_base_encerrar(gen_random_uuid(), '2035-01-01')$c$, 'encerrar regra que não existe');
END $$;
ROLLBACK;
