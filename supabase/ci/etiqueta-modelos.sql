-- Menu personalizado por empresa: só administrador/gestor grava, qualquer pessoa da empresa lê, isolamento entre empresas,
-- formato e tamanho conferidos, sem acesso direto à tabela. Desfaz tudo com ROLLBACK.
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
  ta constant uuid := 'f1111111-1111-1111-1111-111111111111';
  tb constant uuid := 'f2222222-2222-2222-2222-222222222222';
  adm constant uuid := 'f0000000-0000-0000-0000-000000000001';
  ges constant uuid := 'f0000000-0000-0000-0000-000000000002';
  vend constant uuid := 'f0000000-0000-0000-0000-000000000003';
  gar constant uuid := 'f0000000-0000-0000-0000-000000000004';
  admb constant uuid := 'f0000000-0000-0000-0000-000000000005';
  cfg constant jsonb := '{"versao":1,"tipo":"termica","larguraMm":50,"alturaMm":30,"campos":[{"campo":"preco","tamanho":"g"},{"campo":"descricao"},{"campo":"codigo"}]}';
  folha constant jsonb := '{"versao":1,"tipo":"folha","larguraMm":66.7,"alturaMm":25.4,"colunas":3,"linhas":10,"campos":[{"campo":"descricao"}]}';
  id1 uuid; id2 uuid; idb uuid; n integer; r record;
BEGIN
  INSERT INTO tenants (id, nome) VALUES (ta, 'Loja A'), (tb, 'Loja B');
  INSERT INTO empresas (tenant_id, razao_social, ramo_atividade) VALUES (ta, 'Loja A LTDA', 'comercio'), (tb, 'Loja B LTDA', 'comercio');
  INSERT INTO auth.users (id, email) VALUES (adm, 'a@e.ci'), (ges, 'g@e.ci'), (vend, 'v@e.ci'), (gar, 'r@e.ci'), (admb, 'b@e.ci');
  UPDATE profiles SET tenant_id = ta, nome = 'adm' WHERE id = adm;
  UPDATE profiles SET tenant_id = ta, nome = 'ges' WHERE id = ges;
  UPDATE profiles SET tenant_id = ta, nome = 'vend' WHERE id = vend;
  UPDATE profiles SET tenant_id = ta, nome = 'gar' WHERE id = gar;
  UPDATE profiles SET tenant_id = tb, nome = 'admb' WHERE id = admb;
  DELETE FROM user_roles WHERE user_id IN (adm, ges, vend, gar, admb);
  INSERT INTO user_roles (user_id, tenant_id, role) VALUES
    (adm, ta, 'administrador'), (ges, ta, 'gestor'), (vend, ta, 'vendedor'), (gar, ta, 'garcom'), (admb, tb, 'administrador');

  -- quem não é da administração não grava nem exclui
  PERFORM ci.deve_falhar(vend, format($c$SELECT public.etiqueta_modelo_salvar(NULL, 'Gôndola', %L::jsonb)$c$, cfg), 'vendedor cria modelo');
  PERFORM ci.deve_falhar(gar, format($c$SELECT public.etiqueta_modelo_salvar(NULL, 'Gôndola', %L::jsonb)$c$, cfg), 'perfil do salão cria modelo');
  PERFORM ci.deve_falhar(NULL, format($c$SELECT public.etiqueta_modelo_salvar(NULL, 'Gôndola', %L::jsonb)$c$, cfg), 'anônimo cria modelo');
  PERFORM ci.deve_falhar(vend, format($c$SELECT public.etiqueta_modelo_excluir(%L)$c$, gen_random_uuid()), 'vendedor exclui modelo');

  -- administrador e gestor criam; nome único por empresa
  PERFORM ci.entrar(adm);
  id1 := public.etiqueta_modelo_salvar(NULL, '  Gôndola  ', cfg);
  PERFORM ci.sair();
  PERFORM ci.exige(id1 IS NOT NULL, 'administrador cria o modelo');
  PERFORM ci.entrar(ges);
  id2 := public.etiqueta_modelo_salvar(NULL, 'Folha 3x10', folha);
  PERFORM ci.sair();
  PERFORM ci.exige(id2 IS NOT NULL, 'gestor cria a folha');
  PERFORM ci.exige((SELECT nome = 'Gôndola' FROM public.etiqueta_modelos WHERE id = id1), 'o nome é gravado sem espaços nas pontas');
  PERFORM ci.deve_falhar(adm, format($c$SELECT public.etiqueta_modelo_salvar(NULL, 'GÔNDOLA', %L::jsonb)$c$, cfg), 'nome repetido (sem diferença de maiúsculas)');

  -- qualquer pessoa da empresa lê (menos o salão); outra empresa não vê
  PERFORM ci.entrar(vend);
  SELECT count(*) INTO n FROM public.etiqueta_modelos_listar();
  PERFORM ci.sair();
  PERFORM ci.exige(n = 2, 'vendedor lista os modelos da empresa');
  PERFORM ci.deve_falhar(gar, 'SELECT * FROM public.etiqueta_modelos_listar()', 'perfil do salão lista modelos');
  PERFORM ci.entrar(admb);
  SELECT count(*) INTO n FROM public.etiqueta_modelos_listar();
  PERFORM ci.sair();
  PERFORM ci.exige(n = 0, 'outra empresa não vê os modelos alheios');
  PERFORM ci.deve_falhar(adm, 'SELECT count(*) FROM public.etiqueta_modelos', 'leitura direta da tabela');
  PERFORM ci.deve_falhar(adm, format($c$INSERT INTO public.etiqueta_modelos (tenant_id, nome, config) VALUES (%L, 'x1', '{}')$c$, tb), 'gravação direta na tabela');

  -- alterar: só o da própria empresa; a empresa B não mexe no da A
  PERFORM ci.entrar(admb);
  idb := public.etiqueta_modelo_salvar(NULL, 'Gôndola', cfg);
  PERFORM ci.sair();
  PERFORM ci.exige(idb IS NOT NULL, 'a outra empresa pode usar o mesmo nome');
  PERFORM ci.deve_falhar(admb, format($c$SELECT public.etiqueta_modelo_salvar(%L, 'Invadido', %L::jsonb)$c$, id1, cfg), 'alterar modelo de outra empresa');
  PERFORM ci.deve_falhar(admb, format($c$SELECT public.etiqueta_modelo_excluir(%L)$c$, id1), 'excluir modelo de outra empresa');
  PERFORM ci.entrar(ges);
  PERFORM public.etiqueta_modelo_salvar(id1, 'Gôndola grande', (cfg || '{"alturaMm":40}'::jsonb));
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT nome = 'Gôndola grande' AND (config ->> 'alturaMm')::numeric = 40 FROM public.etiqueta_modelos WHERE id = id1), 'gestor altera o modelo');

  -- formato, medidas e tamanho
  PERFORM ci.deve_falhar(adm, $c$SELECT public.etiqueta_modelo_salvar(NULL, 'Ruim 1', '[]'::jsonb)$c$, 'lista no lugar de objeto');
  PERFORM ci.deve_falhar(adm, $c$SELECT public.etiqueta_modelo_salvar(NULL, 'Ruim 2', NULL)$c$, 'configuração nula');
  PERFORM ci.deve_falhar(adm, $c$SELECT public.etiqueta_modelo_salvar(NULL, 'X', '{"versao":1}'::jsonb)$c$, 'nome curto demais');
  PERFORM ci.deve_falhar(adm, $c$SELECT public.etiqueta_modelo_salvar(NULL, NULL, '{"versao":1}'::jsonb)$c$, 'nome nulo');
  PERFORM ci.deve_falhar(adm, format($c$SELECT public.etiqueta_modelo_salvar(NULL, %L, %L::jsonb)$c$, repeat('a', 61), cfg), 'nome longo demais');
  PERFORM ci.deve_falhar(adm, format($c$SELECT public.etiqueta_modelo_salvar(NULL, 'Ruim 3', %L::jsonb)$c$, (cfg || '{"versao":2}'::jsonb)::text), 'versão desconhecida');
  PERFORM ci.deve_falhar(adm, format($c$SELECT public.etiqueta_modelo_salvar(NULL, 'Ruim 4', %L::jsonb)$c$, (cfg || '{"extra":1}'::jsonb)::text), 'campo desconhecido');
  PERFORM ci.deve_falhar(adm, format($c$SELECT public.etiqueta_modelo_salvar(NULL, 'Ruim 5', %L::jsonb)$c$, (cfg || '{"tipo":"rolo"}'::jsonb)::text), 'tipo desconhecido');
  PERFORM ci.deve_falhar(adm, format($c$SELECT public.etiqueta_modelo_salvar(NULL, 'Ruim 6', %L::jsonb)$c$, (cfg || '{"larguraMm":5}'::jsonb)::text), 'largura pequena demais');
  PERFORM ci.deve_falhar(adm, format($c$SELECT public.etiqueta_modelo_salvar(NULL, 'Ruim 7', %L::jsonb)$c$, (cfg || '{"larguraMm":"50"}'::jsonb)::text), 'largura em texto');
  PERFORM ci.deve_falhar(adm, format($c$SELECT public.etiqueta_modelo_salvar(NULL, 'Ruim 8', %L::jsonb)$c$, (cfg || '{"campos":[{"campo":"preco"},{"campo":"preco"}]}'::jsonb)::text), 'campo repetido');
  PERFORM ci.deve_falhar(adm, format($c$SELECT public.etiqueta_modelo_salvar(NULL, 'Ruim 9', %L::jsonb)$c$, (cfg || '{"campos":[{"campo":"foto"}]}'::jsonb)::text), 'campo desconhecido na lista');
  PERFORM ci.deve_falhar(adm, format($c$SELECT public.etiqueta_modelo_salvar(NULL, 'Ruim 10', %L::jsonb)$c$, (cfg || '{"campos":[{"campo":"preco","tamanho":"gg"}]}'::jsonb)::text), 'tamanho de letra desconhecido');
  PERFORM ci.deve_falhar(adm, format($c$SELECT public.etiqueta_modelo_salvar(NULL, 'Ruim 11', %L::jsonb)$c$, (cfg || '{"campos":[]}'::jsonb)::text), 'nenhum campo');
  PERFORM ci.deve_falhar(adm, format($c$SELECT public.etiqueta_modelo_salvar(NULL, 'Ruim 12', %L::jsonb)$c$, (folha || '{"colunas":9}'::jsonb)::text), 'colunas demais');
  PERFORM ci.deve_falhar(adm, format($c$SELECT public.etiqueta_modelo_salvar(NULL, 'Ruim 12b', %L::jsonb)$c$, (cfg - 'larguraMm')::text), 'sem largura');
  PERFORM ci.deve_falhar(adm, format($c$SELECT public.etiqueta_modelo_salvar(NULL, 'Ruim 12c', %L::jsonb)$c$, (cfg - 'alturaMm')::text), 'sem altura');
  PERFORM ci.deve_falhar(adm, format($c$SELECT public.etiqueta_modelo_salvar(NULL, 'Ruim 12d', %L::jsonb)$c$, (cfg - 'campos')::text), 'sem lista de campos');
  PERFORM ci.deve_falhar(adm, format($c$SELECT public.etiqueta_modelo_salvar(NULL, 'Ruim 12e', %L::jsonb)$c$, (cfg - 'tipo')::text), 'sem tipo');
  PERFORM ci.deve_falhar(adm, format($c$SELECT public.etiqueta_modelo_salvar(NULL, 'Ruim 12f', %L::jsonb)$c$, (cfg || '{"campos":[1]}'::jsonb)::text), 'campo que não é objeto');
  PERFORM ci.deve_falhar(adm, format($c$SELECT public.etiqueta_modelo_salvar(NULL, 'Ruim 12g', %L::jsonb)$c$, (folha - 'linhas')::text), 'folha sem linhas');
  PERFORM ci.deve_falhar(adm, format($c$SELECT public.etiqueta_modelo_salvar(NULL, 'Ruim 13', %L::jsonb)$c$, (folha - 'colunas')::text), 'folha sem colunas');
  PERFORM ci.deve_falhar(adm, $c$SELECT public.etiqueta_modelo_salvar(NULL, 'Ruim 14', jsonb_build_object('versao', 1, 'tipo', 'termica', 'larguraMm', 50, 'alturaMm', 30, 'campos', '[{"campo":"preco"}]'::jsonb, 'lixo', repeat('x', 4000)))$c$, 'configuração acima de 4 mil caracteres');
  PERFORM ci.exige((SELECT count(*) = 2 FROM public.etiqueta_modelos WHERE tenant_id = ta), 'modelo recusado não grava nada');

  -- campo "peso" (balança) e até 5 campos
  PERFORM ci.entrar(adm);
  PERFORM public.etiqueta_modelo_salvar(NULL, 'Pesável', (cfg || '{"campos":[{"campo":"descricao"},{"campo":"peso"},{"campo":"preco"},{"campo":"extra"},{"campo":"codigo"}]}'::jsonb));
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT count(*) = 1 FROM public.etiqueta_modelos WHERE tenant_id = ta AND nome = 'Pesável'), 'modelo com 5 campos, inclusive o peso, é aceito');
  PERFORM ci.deve_falhar(adm, format($c$SELECT public.etiqueta_modelo_salvar(NULL, 'Seis', %L::jsonb)$c$, (cfg || '{"campos":[{"campo":"descricao"},{"campo":"peso"},{"campo":"preco"},{"campo":"extra"},{"campo":"codigo"},{"campo":"descricao"}]}'::jsonb)::text), 'modelo com 6 campos');
  PERFORM ci.deve_falhar(adm, format($c$SELECT public.etiqueta_modelo_salvar(NULL, 'Peso repetido', %L::jsonb)$c$, (cfg || '{"campos":[{"campo":"peso"},{"campo":"peso"}]}'::jsonb)::text), 'peso repetido');
  DELETE FROM public.etiqueta_modelos WHERE nome = 'Pesável';

  -- limite de 30 por empresa
  PERFORM ci.entrar(adm);
  FOR n IN 1..28 LOOP
    PERFORM public.etiqueta_modelo_salvar(NULL, 'Modelo ' || n, cfg);
  END LOOP;
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT count(*) = 30 FROM public.etiqueta_modelos WHERE tenant_id = ta), 'a empresa chega a 30 modelos');
  PERFORM ci.deve_falhar(adm, format($c$SELECT public.etiqueta_modelo_salvar(NULL, 'Trigésimo primeiro', %L::jsonb)$c$, cfg), 'passar de 30 modelos');

  -- excluir
  PERFORM ci.entrar(adm);
  PERFORM public.etiqueta_modelo_excluir(id2);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT count(*) = 29 FROM public.etiqueta_modelos WHERE tenant_id = ta), 'administrador exclui o modelo');
  PERFORM ci.exige((SELECT count(*) = 1 FROM public.etiqueta_modelos WHERE tenant_id = tb), 'excluir não mexe na outra empresa');
  PERFORM ci.deve_falhar(adm, format($c$SELECT public.etiqueta_modelo_excluir(%L)$c$, id2), 'excluir de novo o mesmo modelo');
END $$;
ROLLBACK;
