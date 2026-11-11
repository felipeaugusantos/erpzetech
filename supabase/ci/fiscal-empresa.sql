-- Sobrescrita e ocultação de regras fiscais pela empresa (PR 5): só administrador e gestor (nunca vendedor nem o perfil do salão),
-- cada empresa só vê e altera o que é dela, versões encerram a anterior, ocultar vale só para a própria empresa e muda a sugestão.
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
-- Falha com mensagem que contenha o trecho informado.
CREATE FUNCTION ci.deve_falhar_msg(uid uuid, cmd text, trecho text, descricao text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE msg text := NULL;
BEGIN
  PERFORM ci.entrar(uid);
  BEGIN EXECUTE cmd; EXCEPTION WHEN OTHERS THEN msg := SQLERRM; END;
  PERFORM ci.sair();
  IF msg IS NULL THEN RAISE EXCEPTION 'FALHA: esperava erro em "%"', descricao; END IF;
  IF position(trecho IN msg) = 0 THEN RAISE EXCEPTION 'FALHA: "%" falhou com "%" (esperava "%")', descricao, msg, trecho; END IF;
  RAISE NOTICE 'ok: % recusado (%)', descricao, trecho;
END $$;
CREATE FUNCTION ci.exige(condicao boolean, descricao text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF condicao IS NOT TRUE THEN RAISE EXCEPTION 'FALHA: %', descricao; END IF;
  RAISE NOTICE 'ok: %', descricao;
END $$;
-- Chama como a pessoa indicada e devolve o jsonb.
CREATE FUNCTION ci.como(uid uuid, cmd text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  PERFORM ci.entrar(uid);
  EXECUTE cmd INTO r;
  PERFORM ci.sair();
  RETURN r;
END $$;
-- Roda como a pessoa indicada, sem esperar retorno (funções void).
CREATE FUNCTION ci.rodar(uid uuid, cmd text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM ci.entrar(uid);
  EXECUTE cmd;
  PERFORM ci.sair();
END $$;
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
  ta constant uuid := 'f4111111-1111-1111-1111-111111111111';
  tb constant uuid := 'f4222222-2222-2222-2222-222222222222';
  adm constant uuid := 'f4000000-0000-0000-0000-000000000001';
  ges constant uuid := 'f4000000-0000-0000-0000-000000000002';
  vend constant uuid := 'f4000000-0000-0000-0000-000000000003';
  gar constant uuid := 'f4000000-0000-0000-0000-000000000004';
  admb constant uuid := 'f4000000-0000-0000-0000-000000000005';
  pg_rev constant uuid := 'a4000000-0000-0000-0000-000000000001';
  pg_st constant uuid := 'a4000000-0000-0000-0000-000000000002';
  g_8 constant uuid := 'b4000000-0000-0000-0000-000000000001';
  g_4 constant uuid := 'b4000000-0000-0000-0000-000000000002';
  r jsonb; v_id uuid; v_id2 uuid; v_perfil uuid; n integer;
  base jsonb;
BEGIN
  INSERT INTO tenants (id, nome) VALUES (ta, 'Empresa D'), (tb, 'Empresa E');
  INSERT INTO empresas (tenant_id, razao_social, ramo_atividade, regime_tributario)
    VALUES (ta, 'Empresa D LTDA', 'clinica', 'lucro_presumido'), (tb, 'Empresa E LTDA', 'clinica', 'lucro_presumido');
  INSERT INTO auth.users (id, email) VALUES (adm, 'a@d.ci'), (ges, 'g@d.ci'), (vend, 'v@d.ci'), (gar, 'r@d.ci'), (admb, 'b@e.ci');
  UPDATE profiles SET tenant_id = ta, nome = 'adm' WHERE id = adm;
  UPDATE profiles SET tenant_id = ta, nome = 'ges' WHERE id = ges;
  UPDATE profiles SET tenant_id = ta, nome = 'vend' WHERE id = vend;
  UPDATE profiles SET tenant_id = ta, nome = 'gar' WHERE id = gar;
  UPDATE profiles SET tenant_id = tb, nome = 'admb' WHERE id = admb;
  DELETE FROM user_roles WHERE user_id IN (adm, ges, vend, gar, admb);
  INSERT INTO user_roles (user_id, tenant_id, role) VALUES
    (adm, ta, 'administrador'), (ges, ta, 'gestor'), (vend, ta, 'vendedor'), (gar, ta, 'garcom'), (admb, tb, 'administrador');

  INSERT INTO fiscal_perfis (id, tenant_id, nome, cst_icms, cfop, aliq_icms) VALUES
    (pg_rev, NULL, 'Revenda tributada', '00', '5102', 18),
    (pg_st, NULL, 'Substituição tributária', '60', '5405', 0);
  INSERT INTO fiscal_regras (id, perfil_id, ncm_prefixo, vigencia_inicio, versao) VALUES
    (g_8, pg_st, '23091000', '2020-01-01', 1),
    (g_4, pg_rev, '2309', '2020-01-01', 1);
  base := '{"ncm":"2309","vigencia_inicio":"2027-01-01"}'::jsonb;

  -- ===== quem pode chamar =====
  PERFORM ci.deve_falhar(vend, 'SELECT public.fiscal_empresa_perfis()', 'vendedor lista perfis');
  PERFORM ci.deve_falhar(vend, 'SELECT public.fiscal_empresa_minhas()', 'vendedor lista as sobrescritas');
  PERFORM ci.deve_falhar(vend, 'SELECT public.fiscal_empresa_globais()', 'vendedor lista a base global');
  PERFORM ci.deve_falhar(vend, format($c$SELECT public.fiscal_empresa_regra_salvar(%L::jsonb)$c$, base || jsonb_build_object('perfil_id', pg_rev)), 'vendedor grava sobrescrita');
  PERFORM ci.deve_falhar(vend, format($c$SELECT public.fiscal_empresa_ocultar(%L, 'não uso')$c$, g_8), 'vendedor oculta regra');
  PERFORM ci.deve_falhar(vend, format($c$SELECT public.fiscal_empresa_reexibir(%L)$c$, g_8), 'vendedor reexibe regra');
  PERFORM ci.deve_falhar(vend, 'SELECT public.fiscal_empresa_regra_encerrar(gen_random_uuid(), current_date)', 'vendedor encerra regra');
  PERFORM ci.deve_falhar(gar, 'SELECT public.fiscal_empresa_minhas()', 'perfil do salão lista as sobrescritas');
  PERFORM ci.deve_falhar(gar, format($c$SELECT public.fiscal_empresa_regra_salvar(%L::jsonb)$c$, base || jsonb_build_object('perfil_id', pg_rev)), 'perfil do salão grava sobrescrita');
  PERFORM ci.deve_falhar(NULL, 'SELECT public.fiscal_empresa_minhas()', 'anônimo lista as sobrescritas');
  PERFORM ci.deve_falhar(NULL, format($c$SELECT public.fiscal_empresa_ocultar(%L, 'não uso')$c$, g_8), 'anônimo oculta regra');

  -- ===== perfis disponíveis =====
  r := ci.como(adm, 'SELECT public.fiscal_empresa_perfis()');
  PERFORM ci.exige(jsonb_array_length(r) = 2 AND r #>> '{0,origem}' = 'global' AND r #>> '{0,nome}' = 'Revenda tributada',
                   'administrador vê os perfis globais, em ordem de nome');
  PERFORM ci.exige(r #>> '{0,perfil,cfop}' = '5102', 'perfil devolvido em camelCase');

  -- ===== criar sobrescrita com perfil global =====
  r := ci.como(ges, format($c$SELECT public.fiscal_empresa_regra_salvar(%L::jsonb)$c$, '{"ncm":"23091000","vigencia_inicio":"2020-01-01","observacao":"produto isento"}'::jsonb || jsonb_build_object('perfil_id', pg_rev)));
  v_id := (r ->> 'id')::uuid;
  PERFORM ci.exige(r ->> 'acao' = 'nova' AND r ->> 'versao' = '1', 'gestor cria a sobrescrita (versão 1) com perfil global');
  PERFORM ci.exige((SELECT criado_por = ges AND tenant_id = ta AND observacao = 'produto isento' FROM fiscal_empresa_regras WHERE id = v_id),
                   'empresa, autor e observação gravados');
  r := ci.sug(adm, '23091000', '2027-03-10');
  PERFORM ci.exige(r #>> '{regra,origem}' = 'empresa' AND r #>> '{regra,id}' = v_id::text AND r #>> '{perfil,cfop}' = '5102',
                   'a sugestão da empresa passa a vir da sobrescrita (a global de 8 dígitos perde)');
  PERFORM ci.exige(ci.sug(admb, '23091000', '2027-03-10') #>> '{regra,id}' = g_8::text, 'a outra empresa continua com a regra global');

  -- ===== mesmo conteúdo: igual =====
  r := ci.como(adm, format($c$SELECT public.fiscal_empresa_regra_salvar(%L::jsonb)$c$, '{"ncm":"23091000","vigencia_inicio":"2020-01-01","observacao":"produto isento"}'::jsonb || jsonb_build_object('perfil_id', pg_rev)));
  PERFORM ci.exige(r ->> 'acao' = 'igual' AND r ->> 'id' = v_id::text, 'repetir o mesmo conteúdo não cria versão');

  -- ===== nova versão com perfil novo da empresa =====
  r := ci.como(adm, $c$SELECT public.fiscal_empresa_regra_salvar('{"ncm":"23091000","vigencia_inicio":"2099-01-01",
       "perfil":{"nome":"Meu perfil","cst_icms":"20","cfop":"5101","aliq_icms":12,"reducao_base_icms":33.33}}'::jsonb)$c$);
  v_id2 := (r ->> 'id')::uuid;
  PERFORM ci.exige(r ->> 'acao' = 'nova_versao' AND r ->> 'versao' = '2', 'mesma chave com início posterior vira a versão 2');
  PERFORM ci.exige((SELECT vigencia_fim = '2098-12-31' FROM fiscal_empresa_regras WHERE id = v_id), 'a versão 1 termina no dia anterior ao início da 2');
  PERFORM ci.exige(ci.sug(adm, '23091000', '2098-12-31') #>> '{regra,id}' = v_id::text, 'em 31/12/2098 vale a versão 1');
  r := ci.sug(adm, '23091000', '2099-01-01');
  PERFORM ci.exige(r #>> '{regra,id}' = v_id2::text AND r #>> '{perfil,cfop}' = '5101' AND r #>> '{regra,perfilNome}' = 'Meu perfil'
                   AND (r #>> '{perfil,reducaoBaseIcms}')::numeric = 33.33, 'em 01/01/2099 vale a versão 2, com o perfil próprio');
  SELECT id INTO v_perfil FROM fiscal_perfis WHERE nome = 'Meu perfil';
  PERFORM ci.exige((SELECT tenant_id = ta FROM fiscal_perfis WHERE id = v_perfil), 'o perfil novo é da empresa, não da base global');
  r := ci.como(adm, 'SELECT public.fiscal_empresa_perfis()');
  PERFORM ci.exige(jsonb_array_length(r) = 3 AND r #>> '{2,origem}' = 'empresa', 'a empresa vê os perfis globais e o próprio (o dela por último)');
  PERFORM ci.exige(jsonb_array_length(ci.como(admb, 'SELECT public.fiscal_empresa_perfis()')) = 2, 'a outra empresa não vê o perfil da primeira');

  -- ===== perfil da empresa reaproveitado, repetido ou com valores diferentes =====
  r := ci.como(adm, $c$SELECT public.fiscal_empresa_regra_salvar('{"ncm":"3004","vigencia_inicio":"2027-01-01",
       "perfil":{"nome":"meu PERFIL","cst_icms":"20","cfop":"5101","aliq_icms":12,"reducao_base_icms":33.33}}'::jsonb)$c$);
  PERFORM ci.exige(r ->> 'acao' = 'nova' AND (SELECT count(*) = 1 FROM fiscal_perfis WHERE tenant_id = ta AND lower(nome) = 'meu perfil'),
                   'mesmo nome (sem diferenciar maiúsculas) e mesmos valores reaproveita o perfil');
  PERFORM ci.deve_falhar_msg(adm, $c$SELECT public.fiscal_empresa_regra_salvar('{"ncm":"3005","vigencia_inicio":"2027-01-01",
       "perfil":{"nome":"Meu perfil","cfop":"5949"}}'::jsonb)$c$, 'outros valores', 'perfil com o mesmo nome e valores diferentes');
  PERFORM ci.deve_falhar_msg(adm, $c$SELECT public.fiscal_empresa_regra_salvar('{"ncm":"3005","vigencia_inicio":"2027-01-01",
       "perfil":{"nome":"Sem tributo"}}'::jsonb)$c$, 'ao menos um campo', 'perfil sem nenhum campo de tributação');

  -- ===== perfil de outra empresa não vale =====
  r := ci.como(admb, $c$SELECT public.fiscal_empresa_regra_salvar('{"ncm":"4001","vigencia_inicio":"2027-01-01","perfil":{"nome":"Perfil B","cfop":"5949"}}'::jsonb)$c$);
  PERFORM ci.exige(r ->> 'acao' = 'nova' AND r ->> 'versao' = '1', 'a outra empresa tem as versões dela, independentes');
  SELECT id INTO v_perfil FROM fiscal_perfis WHERE nome = 'Perfil B';
  PERFORM ci.deve_falhar_msg(adm, format($c$SELECT public.fiscal_empresa_regra_salvar(%L::jsonb)$c$, '{"ncm":"3006","vigencia_inicio":"2027-01-01"}'::jsonb || jsonb_build_object('perfil_id', v_perfil)),
                             'Perfil não encontrado', 'usar o perfil de outra empresa');
  PERFORM ci.deve_falhar_msg(adm, format($c$SELECT public.fiscal_empresa_regra_salvar(%L::jsonb)$c$, '{"ncm":"3006","vigencia_inicio":"2027-01-01"}'::jsonb || jsonb_build_object('perfil_id', gen_random_uuid())),
                             'Perfil não encontrado', 'perfil que não existe');

  -- ===== validações =====
  PERFORM ci.deve_falhar_msg(adm, $c$SELECT public.fiscal_empresa_regra_salvar('{"ncm":"3","vigencia_inicio":"2027-01-01"}'::jsonb)$c$, 'NCM', 'NCM de 1 dígito');
  PERFORM ci.deve_falhar_msg(adm, format($c$SELECT public.fiscal_empresa_regra_salvar(%L::jsonb)$c$, '{"ncm":"3004","cest":"123","vigencia_inicio":"2027-01-01"}'::jsonb || jsonb_build_object('perfil_id', pg_rev)), 'CEST', 'CEST com 3 dígitos');
  PERFORM ci.deve_falhar_msg(adm, format($c$SELECT public.fiscal_empresa_regra_salvar(%L::jsonb)$c$, '{"ncm":"3004","regime":"lucro","vigencia_inicio":"2027-01-01"}'::jsonb || jsonb_build_object('perfil_id', pg_rev)), 'Regime', 'regime desconhecido');
  PERFORM ci.deve_falhar_msg(adm, format($c$SELECT public.fiscal_empresa_regra_salvar(%L::jsonb)$c$, '{"ncm":"3004","uf_destino":"S1","vigencia_inicio":"2027-01-01"}'::jsonb || jsonb_build_object('perfil_id', pg_rev)), 'UF', 'UF inválida');
  r := ci.como(adm, format($c$SELECT public.fiscal_empresa_regra_salvar(%L::jsonb)$c$, '{"ncm":"3008","uf_destino":"sp","vigencia_inicio":"2027-01-01"}'::jsonb || jsonb_build_object('perfil_id', pg_rev)));
  PERFORM ci.exige((SELECT uf_destino = 'SP' FROM fiscal_empresa_regras WHERE id = (r ->> 'id')::uuid), 'UF em minúsculas é gravada em maiúsculas');
  PERFORM ci.deve_falhar_msg(adm, format($c$SELECT public.fiscal_empresa_regra_salvar(%L::jsonb)$c$, '{"ncm":"3004"}'::jsonb || jsonb_build_object('perfil_id', pg_rev)), 'início da vigência', 'sem início de vigência');
  PERFORM ci.deve_falhar_msg(adm, format($c$SELECT public.fiscal_empresa_regra_salvar(%L::jsonb)$c$, '{"ncm":"3004","vigencia_inicio":"2027-02-01","vigencia_fim":"2027-01-31"}'::jsonb || jsonb_build_object('perfil_id', pg_rev)), 'anterior ao início', 'fim antes do início');
  PERFORM ci.deve_falhar_msg(adm, $c$SELECT public.fiscal_empresa_regra_salvar('{"ncm":"3004","vigencia_inicio":"2027-01-01"}'::jsonb)$c$, 'Informe o perfil', 'sem perfil nenhum');
  PERFORM ci.deve_falhar_msg(adm, $c$SELECT public.fiscal_empresa_regra_salvar('[]'::jsonb)$c$, 'inválidos', 'dados em lista');
  PERFORM ci.deve_falhar_msg(adm, format($c$SELECT public.fiscal_empresa_regra_salvar(%L::jsonb)$c$, '{"ncm":"23091000","vigencia_inicio":"2029-06-01"}'::jsonb || jsonb_build_object('perfil_id', pg_st)),
                             'precisa começar depois', 'nova versão que começa antes da vigente');

  -- ===== listar =====
  r := ci.como(adm, $c$SELECT public.fiscal_empresa_minhas('23091000')$c$);
  PERFORM ci.exige((r ->> 'total')::int = 2 AND r #>> '{itens,0,versao}' = '2' AND r #>> '{itens,0,status}' = 'futura'
                   AND r #>> '{itens,1,versao}' = '1' AND r #>> '{itens,1,status}' = 'vigente' AND r #>> '{itens,1,perfilOrigem}' = 'global'
                   AND r #>> '{itens,0,perfilOrigem}' = 'empresa', 'minhas: as duas versões, a mais nova primeiro, com status e origem do perfil');
  PERFORM ci.exige((ci.como(admb, $c$SELECT public.fiscal_empresa_minhas('23091000')$c$) ->> 'total')::int = 0, 'a outra empresa não vê as sobrescritas da primeira');
  PERFORM ci.exige((ci.como(adm, $c$SELECT public.fiscal_empresa_minhas('Meu')$c$) ->> 'total')::int = 2, 'busca pelo nome do perfil (23091000 v2 e 3004)');
  PERFORM ci.exige((ci.como(adm, $c$SELECT public.fiscal_empresa_minhas(NULL, true)$c$) ->> 'total')::int = 4, 'só vigentes e futuras: 23091000 v1 e v2, 3004 e 3008');
  PERFORM ci.exige(jsonb_array_length(ci.como(adm, $c$SELECT public.fiscal_empresa_minhas(NULL, false, 1, 0) -> 'itens'$c$)) = 1, 'paginação limita os itens');

  -- ===== ocultar e reexibir =====
  r := ci.como(adm, $c$SELECT public.fiscal_empresa_globais('2309')$c$);
  PERFORM ci.exige((r ->> 'total')::int = 2 AND (r #>> '{itens,0,oculta}')::boolean = false AND r #>> '{itens,0,perfilNome}' IS NOT NULL,
                   'globais: a base inteira, nada oculto ainda');
  PERFORM ci.exige(ci.sug(adm, '23099000', '2027-03-10') #>> '{regra,id}' = g_4::text, 'sem sobrescrita nem ocultação vale a regra global');
  PERFORM ci.deve_falhar_msg(adm, format($c$SELECT public.fiscal_empresa_ocultar(%L, 'x')$c$, g_4), 'motivo', 'ocultar sem motivo');
  PERFORM ci.deve_falhar_msg(adm, $c$SELECT public.fiscal_empresa_ocultar(gen_random_uuid(), 'não uso esta regra')$c$, 'não encontrada', 'ocultar regra que não existe');
  PERFORM ci.rodar(ges, format($c$SELECT public.fiscal_empresa_ocultar(%L, 'Não se aplica ao meu negócio')$c$, g_4));
  r := ci.como(adm, $c$SELECT public.fiscal_empresa_globais('2309')$c$);
  PERFORM ci.exige((SELECT count(*) = 1 FROM jsonb_array_elements(r -> 'itens') e WHERE (e ->> 'oculta')::boolean AND e ->> 'motivoOculta' = 'Não se aplica ao meu negócio'),
                   'a regra aparece como oculta, com o motivo');
  PERFORM ci.exige(ci.sug(adm, '23099000', '2027-03-10') ->> 'status' = 'sem_regra', 'regra ocultada deixa de ser sugerida para a empresa');
  PERFORM ci.exige(ci.sug(admb, '23099000', '2027-03-10') #>> '{regra,id}' = g_4::text, 'a outra empresa continua recebendo a regra');
  PERFORM ci.exige(ci.sug(ges, '23099000', '2027-03-10') ->> 'status' = 'sem_regra', 'vale para quem é da empresa, não só para quem ocultou');
  PERFORM ci.rodar(adm, format($c$SELECT public.fiscal_empresa_ocultar(%L, 'Outro motivo')$c$, g_4));
  PERFORM ci.exige((SELECT motivo = 'Outro motivo' AND count(*) OVER () = 1 FROM fiscal_empresa_ocultas WHERE tenant_id = ta AND regra_id = g_4),
                   'ocultar de novo só atualiza o motivo');
  PERFORM ci.rodar(adm, format($c$SELECT public.fiscal_empresa_reexibir(%L)$c$, g_4));
  PERFORM ci.exige(ci.sug(adm, '23099000', '2027-03-10') #>> '{regra,id}' = g_4::text, 'reexibir devolve a regra à sugestão');
  PERFORM ci.rodar(admb, format($c$SELECT public.fiscal_empresa_reexibir(%L)$c$, g_4));
  PERFORM ci.exige(true, 'reexibir uma regra que não estava oculta não dá erro');

  -- ===== encerrar =====
  PERFORM ci.exige((ci.como(adm, format($c$SELECT to_jsonb(public.fiscal_empresa_regra_encerrar(%L, '2100-06-30'))$c$, v_id2)) #>> '{}')::date = '2100-06-30',
                   'encerrar define o fim da sobrescrita');
  r := ci.sug(adm, '23091000', '2100-07-01');
  PERFORM ci.exige(r #>> '{regra,origem}' = 'global' AND r #>> '{regra,id}' = g_8::text, 'depois do fim da sobrescrita volta a regra global');
  PERFORM ci.deve_falhar_msg(adm, format($c$SELECT public.fiscal_empresa_regra_encerrar(%L, '2101-01-01')$c$, v_id2), 'antecipar', 'estender o fim');
  PERFORM ci.deve_falhar_msg(adm, format($c$SELECT public.fiscal_empresa_regra_encerrar(%L, '2098-12-31')$c$, v_id2), 'anterior ao início', 'encerrar antes do início');
  PERFORM ci.deve_falhar_msg(adm, format($c$SELECT public.fiscal_empresa_regra_encerrar(%L, NULL)$c$, v_id2), 'data', 'encerrar sem data');
  PERFORM ci.deve_falhar_msg(admb, format($c$SELECT public.fiscal_empresa_regra_encerrar(%L, '2031-01-01')$c$, v_id2), 'não encontrada', 'encerrar a sobrescrita de outra empresa');
  PERFORM ci.deve_falhar_msg(adm, format($c$SELECT public.fiscal_empresa_regra_encerrar(%L, '2031-01-01')$c$, g_4), 'não encontrada', 'encerrar uma regra global');
  PERFORM ci.exige((SELECT vigencia_fim = '2100-06-30' FROM fiscal_empresa_regras WHERE id = v_id2), 'tentativas recusadas não mexem na regra');

  -- ===== a base global não muda por nada disto =====
  SELECT count(*) INTO n FROM fiscal_regras;
  PERFORM ci.exige(n = 2 AND (SELECT vigencia_fim IS NULL FROM fiscal_regras WHERE id = g_8), 'a base global continua intacta');

  -- ===== busca por nome de perfil que tem dígito (ex.: "Revenda v2") =====
  INSERT INTO fiscal_perfis (id, tenant_id, nome, cfop) VALUES ('a4000000-0000-0000-0000-0000000000a1', NULL, 'Revenda v2', '5102');
  INSERT INTO fiscal_regras (perfil_id, ncm_prefixo, vigencia_inicio) VALUES ('a4000000-0000-0000-0000-0000000000a1', '5555', '2020-01-01');
  PERFORM ci.exige((ci.como(adm, $c$SELECT public.fiscal_empresa_globais('Revenda v2')$c$) ->> 'total')::int = 1, 'globais: nome com dígito ("Revenda v2") acha o perfil');
  PERFORM ci.exige((ci.como(adm, $c$SELECT public.fiscal_empresa_globais('v2')$c$) ->> 'total')::int = 1, 'globais: parte do nome com dígito');
  PERFORM ci.exige((ci.como(adm, $c$SELECT public.fiscal_empresa_globais('5555')$c$) ->> 'total')::int = 1, 'globais: só números continua sendo por NCM');
  r := ci.como(adm, $c$SELECT public.fiscal_empresa_regra_salvar('{"ncm":"3009","vigencia_inicio":"2020-01-01","perfil":{"nome":"Perfil v2","cfop":"5102"}}'::jsonb)$c$);
  PERFORM ci.exige((ci.como(adm, $c$SELECT public.fiscal_empresa_minhas('Perfil v2')$c$) ->> 'total')::int = 1, 'minhas: nome com dígito ("Perfil v2") acha o perfil');
  PERFORM ci.exige((ci.como(adm, $c$SELECT public.fiscal_empresa_minhas('3009')$c$) ->> 'total')::int = 1, 'minhas: só números continua sendo por NCM');
END $$;
ROLLBACK;
