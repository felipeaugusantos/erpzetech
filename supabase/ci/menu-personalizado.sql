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
  ta constant uuid := 'e1111111-1111-1111-1111-111111111111';
  tb constant uuid := 'e2222222-2222-2222-2222-222222222222';
  adm constant uuid := 'e0000000-0000-0000-0000-000000000001';
  ges constant uuid := 'e0000000-0000-0000-0000-000000000002';
  vend constant uuid := 'e0000000-0000-0000-0000-000000000003';
  gar constant uuid := 'e0000000-0000-0000-0000-000000000004';
  admb constant uuid := 'e0000000-0000-0000-0000-000000000005';
  cfg constant jsonb := '{"versao":1,"ocultos":["/pet-agenda"],"itens":{"/pets":{"area":"Clínica"}},"ordemItens":{"Clínica":["/pets"]}}';
  r jsonb; quando timestamptz; n integer;
BEGIN
  INSERT INTO tenants (id, nome) VALUES (ta, 'Clínica A'), (tb, 'Clínica B');
  INSERT INTO empresas (tenant_id, razao_social, ramo_atividade) VALUES (ta, 'Clínica A LTDA', 'clinica'), (tb, 'Clínica B LTDA', 'clinica');
  INSERT INTO auth.users (id, email) VALUES (adm, 'a@m.ci'), (ges, 'g@m.ci'), (vend, 'v@m.ci'), (gar, 'r@m.ci'), (admb, 'b@m.ci');
  UPDATE profiles SET tenant_id = ta, nome = 'adm' WHERE id = adm;
  UPDATE profiles SET tenant_id = ta, nome = 'ges' WHERE id = ges;
  UPDATE profiles SET tenant_id = ta, nome = 'vend' WHERE id = vend;
  UPDATE profiles SET tenant_id = ta, nome = 'gar' WHERE id = gar;
  UPDATE profiles SET tenant_id = tb, nome = 'admb' WHERE id = admb;
  DELETE FROM user_roles WHERE user_id IN (adm, ges, vend, gar, admb);
  INSERT INTO user_roles (user_id, tenant_id, role) VALUES
    (adm, ta, 'administrador'), (ges, ta, 'gestor'), (vend, ta, 'vendedor'), (gar, ta, 'garcom'), (admb, tb, 'administrador');

  -- sem configuração: menu padrão (null) para qualquer pessoa da empresa
  PERFORM ci.entrar(vend);
  r := public.menu_personalizado_obter();
  PERFORM ci.sair();
  PERFORM ci.exige(r IS NULL, 'sem configuração o menu é o padrão (null)');

  -- quem não é da administração não grava nem restaura
  PERFORM ci.deve_falhar(vend, format($c$SELECT public.menu_personalizado_salvar(%L::jsonb)$c$, cfg), 'vendedor grava o menu');
  PERFORM ci.deve_falhar(gar, format($c$SELECT public.menu_personalizado_salvar(%L::jsonb)$c$, cfg), 'perfil do salão grava o menu');
  PERFORM ci.deve_falhar(NULL, format($c$SELECT public.menu_personalizado_salvar(%L::jsonb)$c$, cfg), 'anônimo grava o menu');
  PERFORM ci.deve_falhar(vend, 'SELECT public.menu_personalizado_restaurar()', 'vendedor restaura o menu');

  -- administrador e gestor gravam
  PERFORM ci.entrar(adm);
  quando := public.menu_personalizado_salvar(cfg);
  PERFORM ci.sair();
  PERFORM ci.exige(quando IS NOT NULL, 'administrador grava o menu');
  PERFORM ci.entrar(ges);
  quando := public.menu_personalizado_salvar('{"versao":1,"ocultos":["/pets"]}'::jsonb);
  PERFORM ci.sair();
  PERFORM ci.exige(quando IS NOT NULL, 'gestor grava o menu (substitui a configuração)');

  -- qualquer pessoa da empresa lê; outra empresa não vê; direto na tabela, ninguém
  PERFORM ci.entrar(vend);
  r := public.menu_personalizado_obter();
  PERFORM ci.sair();
  PERFORM ci.exige(r = '{"versao":1,"ocultos":["/pets"]}'::jsonb, 'vendedor lê a configuração da empresa');
  PERFORM ci.entrar(gar);
  r := public.menu_personalizado_obter();
  PERFORM ci.sair();
  PERFORM ci.exige(r IS NOT NULL, 'perfil do salão também lê (o menu vale para todos)');
  PERFORM ci.entrar(admb);
  r := public.menu_personalizado_obter();
  PERFORM ci.sair();
  PERFORM ci.exige(r IS NULL, 'outra empresa não vê a configuração alheia');
  PERFORM ci.deve_falhar(adm, 'SELECT count(*) FROM public.menu_personalizado', 'leitura direta da tabela');
  PERFORM ci.deve_falhar(adm, format($c$INSERT INTO public.menu_personalizado (tenant_id, config) VALUES (%L, '{}')$c$, tb), 'gravação direta na tabela');
  PERFORM ci.exige((SELECT count(*) = 1 FROM public.menu_personalizado WHERE tenant_id = ta), 'uma configuração por empresa');

  -- formato e tamanho
  PERFORM ci.deve_falhar(adm, $c$SELECT public.menu_personalizado_salvar('[]'::jsonb)$c$, 'lista no lugar de objeto');
  PERFORM ci.deve_falhar(adm, $c$SELECT public.menu_personalizado_salvar('"texto"'::jsonb)$c$, 'texto no lugar de objeto');
  PERFORM ci.deve_falhar(adm, $c$SELECT public.menu_personalizado_salvar(NULL)$c$, 'configuração nula');
  PERFORM ci.deve_falhar(adm, $c$SELECT public.menu_personalizado_salvar('{}'::jsonb)$c$, 'sem versão');
  PERFORM ci.deve_falhar(adm, $c$SELECT public.menu_personalizado_salvar('{"versao":2}'::jsonb)$c$, 'versão desconhecida');
  PERFORM ci.deve_falhar(adm, $c$SELECT public.menu_personalizado_salvar('{"versao":1,"qualquer":1}'::jsonb)$c$, 'campo desconhecido');
  PERFORM ci.deve_falhar(adm, $c$SELECT public.menu_personalizado_salvar('{"versao":1,"ocultos":{}}'::jsonb)$c$, 'ocultos que não é lista');
  PERFORM ci.deve_falhar(adm, $c$SELECT public.menu_personalizado_salvar('{"versao":1,"itens":[]}'::jsonb)$c$, 'itens que não é objeto');
  PERFORM ci.deve_falhar(adm, $c$SELECT public.menu_personalizado_salvar(jsonb_build_object('versao', 1, 'ocultos', (SELECT jsonb_agg('/tela-' || g) FROM generate_series(1, 3000) g)))$c$, 'configuração acima de 20 mil caracteres');
  PERFORM ci.exige((SELECT config = '{"versao":1,"ocultos":["/pets"]}'::jsonb FROM public.menu_personalizado WHERE tenant_id = ta), 'configuração recusada não mexe na gravada');

  -- restaurar o padrão: só a própria empresa
  PERFORM ci.entrar(admb);
  PERFORM public.menu_personalizado_salvar('{"versao":1}'::jsonb);
  PERFORM ci.sair();
  PERFORM ci.entrar(adm);
  PERFORM public.menu_personalizado_restaurar();
  PERFORM ci.sair();
  SELECT count(*) INTO n FROM public.menu_personalizado WHERE tenant_id = ta;
  PERFORM ci.exige(n = 0, 'restaurar apaga a configuração da empresa');
  PERFORM ci.exige((SELECT count(*) = 1 FROM public.menu_personalizado WHERE tenant_id = tb), 'restaurar não mexe na outra empresa');
END $$;
ROLLBACK;
