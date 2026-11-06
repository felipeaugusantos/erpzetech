-- Dashboard personalizado por empresa: só administrador/gestor grava, qualquer pessoa da empresa lê, isolamento entre empresas,
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
  cfg constant jsonb := '{"versao":1,"ordem":["a-receber","faturamento"],"ocultos":["faltas"]}';
  r jsonb; quando timestamptz; n integer;
BEGIN
  INSERT INTO tenants (id, nome) VALUES (ta, 'Clínica A'), (tb, 'Clínica B');
  INSERT INTO empresas (tenant_id, razao_social, ramo_atividade) VALUES (ta, 'Clínica A LTDA', 'clinica'), (tb, 'Clínica B LTDA', 'clinica');
  INSERT INTO auth.users (id, email) VALUES (adm, 'a@d.ci'), (ges, 'g@d.ci'), (vend, 'v@d.ci'), (gar, 'r@d.ci'), (admb, 'b@d.ci');
  UPDATE profiles SET tenant_id = ta, nome = 'adm' WHERE id = adm;
  UPDATE profiles SET tenant_id = ta, nome = 'ges' WHERE id = ges;
  UPDATE profiles SET tenant_id = ta, nome = 'vend' WHERE id = vend;
  UPDATE profiles SET tenant_id = ta, nome = 'gar' WHERE id = gar;
  UPDATE profiles SET tenant_id = tb, nome = 'admb' WHERE id = admb;
  DELETE FROM user_roles WHERE user_id IN (adm, ges, vend, gar, admb);
  INSERT INTO user_roles (user_id, tenant_id, role) VALUES
    (adm, ta, 'administrador'), (ges, ta, 'gestor'), (vend, ta, 'vendedor'), (gar, ta, 'garcom'), (admb, tb, 'administrador');

  -- sem configuração: dashboard padrão (null) para qualquer pessoa da empresa
  PERFORM ci.entrar(vend);
  r := public.dashboard_personalizado_obter('pet');
  PERFORM ci.sair();
  PERFORM ci.exige(r IS NULL, 'sem configuração o dashboard é o padrão (null)');

  -- quem não é da administração não grava nem restaura
  PERFORM ci.deve_falhar(vend, format($c$SELECT public.dashboard_personalizado_salvar('pet', %L::jsonb)$c$, cfg), 'vendedor grava o dashboard');
  PERFORM ci.deve_falhar(gar, format($c$SELECT public.dashboard_personalizado_salvar('pet', %L::jsonb)$c$, cfg), 'perfil do salão grava o dashboard');
  PERFORM ci.deve_falhar(NULL, format($c$SELECT public.dashboard_personalizado_salvar('pet', %L::jsonb)$c$, cfg), 'anônimo grava o dashboard');
  PERFORM ci.deve_falhar(vend, $c$SELECT public.dashboard_personalizado_restaurar('pet')$c$, 'vendedor restaura o dashboard');

  -- administrador e gestor gravam
  PERFORM ci.entrar(adm);
  quando := public.dashboard_personalizado_salvar('pet', cfg);
  PERFORM ci.sair();
  PERFORM ci.exige(quando IS NOT NULL, 'administrador grava o dashboard');
  PERFORM ci.entrar(ges);
  quando := public.dashboard_personalizado_salvar('pet', '{"versao":1,"ocultos":["a-pagar"]}'::jsonb);
  PERFORM ci.sair();
  PERFORM ci.exige(quando IS NOT NULL, 'gestor grava o dashboard (substitui a configuração)');

  -- qualquer pessoa da empresa lê; outra empresa não vê; direto na tabela, ninguém
  PERFORM ci.entrar(vend);
  r := public.dashboard_personalizado_obter('pet');
  PERFORM ci.sair();
  PERFORM ci.exige(r = '{"versao":1,"ocultos":["a-pagar"]}'::jsonb, 'vendedor lê a configuração da empresa');
  PERFORM ci.entrar(admb);
  r := public.dashboard_personalizado_obter('pet');
  PERFORM ci.sair();
  PERFORM ci.exige(r IS NULL, 'outra empresa não vê a configuração alheia');
  PERFORM ci.entrar(vend);
  r := public.dashboard_personalizado_obter('outro');
  PERFORM ci.sair();
  PERFORM ci.exige(r IS NULL, 'painel desconhecido não devolve nada');
  PERFORM ci.deve_falhar(adm, 'SELECT count(*) FROM public.dashboard_personalizado', 'leitura direta da tabela');
  PERFORM ci.deve_falhar(adm, format($c$INSERT INTO public.dashboard_personalizado (tenant_id, painel, config) VALUES (%L, 'pet', '{}')$c$, tb), 'gravação direta na tabela');

  -- formato e tamanho
  PERFORM ci.deve_falhar(adm, $c$SELECT public.dashboard_personalizado_salvar('vendas', '{"versao":1}'::jsonb)$c$, 'painel desconhecido');
  PERFORM ci.deve_falhar(adm, $c$SELECT public.dashboard_personalizado_salvar('pet', '[]'::jsonb)$c$, 'lista no lugar de objeto');
  PERFORM ci.deve_falhar(adm, $c$SELECT public.dashboard_personalizado_salvar('pet', NULL)$c$, 'configuração nula');
  PERFORM ci.deve_falhar(adm, $c$SELECT public.dashboard_personalizado_salvar('pet', '{}'::jsonb)$c$, 'sem versão');
  PERFORM ci.deve_falhar(adm, $c$SELECT public.dashboard_personalizado_salvar('pet', '{"versao":2}'::jsonb)$c$, 'versão desconhecida');
  PERFORM ci.deve_falhar(adm, $c$SELECT public.dashboard_personalizado_salvar('pet', '{"versao":1,"qualquer":1}'::jsonb)$c$, 'campo desconhecido');
  PERFORM ci.deve_falhar(adm, $c$SELECT public.dashboard_personalizado_salvar('pet', '{"versao":1,"ordem":{}}'::jsonb)$c$, 'ordem que não é lista');
  PERFORM ci.deve_falhar(adm, $c$SELECT public.dashboard_personalizado_salvar('pet', '{"versao":1,"ocultos":[1]}'::jsonb)$c$, 'lista com item que não é texto');
  PERFORM ci.deve_falhar(adm, $c$SELECT public.dashboard_personalizado_salvar('pet', jsonb_build_object('versao', 1, 'ordem', (SELECT jsonb_agg('p' || g) FROM generate_series(1, 41) g)))$c$, 'mais de 40 itens');
  PERFORM ci.deve_falhar(adm, $c$SELECT public.dashboard_personalizado_salvar('pet', jsonb_build_object('versao', 1, 'ordem', (SELECT jsonb_agg(repeat('x', 200) || g) FROM generate_series(1, 30) g)))$c$, 'acima de 5 mil caracteres');
  PERFORM ci.exige((SELECT config = '{"versao":1,"ocultos":["a-pagar"]}'::jsonb FROM public.dashboard_personalizado WHERE tenant_id = ta AND painel = 'pet'), 'configuração recusada não mexe na gravada');

  -- restaurar o padrão: só a própria empresa
  PERFORM ci.entrar(admb);
  PERFORM public.dashboard_personalizado_salvar('pet', '{"versao":1}'::jsonb);
  PERFORM ci.sair();
  PERFORM ci.entrar(adm);
  PERFORM public.dashboard_personalizado_restaurar('pet');
  PERFORM ci.sair();
  SELECT count(*) INTO n FROM public.dashboard_personalizado WHERE tenant_id = ta;
  PERFORM ci.exige(n = 0, 'restaurar apaga a configuração da empresa');
  PERFORM ci.exige((SELECT count(*) = 1 FROM public.dashboard_personalizado WHERE tenant_id = tb), 'restaurar não mexe na outra empresa');
END $$;
ROLLBACK;
