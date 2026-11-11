-- Parcelamento no banco: vencimento mensal (mesmo dia, fim de mês no último dia), centavos na última parcela,
-- papel e empresa conferidos, e título sem INSERT direto. Desfaz tudo com ROLLBACK.
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
  ta constant uuid := 'f3333333-3333-3333-3333-333333333333';
  tb constant uuid := 'f4444444-4444-4444-4444-444444444444';
  fin constant uuid := 'f5000000-0000-0000-0000-000000000001';
  comp constant uuid := 'f5000000-0000-0000-0000-000000000002';
  coz constant uuid := 'f5000000-0000-0000-0000-000000000003';
  vend constant uuid := 'f5000000-0000-0000-0000-000000000004';
  forn_a uuid; forn_b uuid; cli_a uuid; cli_b uuid; ids uuid[];
BEGIN
  INSERT INTO tenants (id, nome) VALUES (ta, 'Parc A'), (tb, 'Parc B');
  INSERT INTO empresas (tenant_id, razao_social, ramo_atividade) VALUES (ta, 'Parc A LTDA', 'comercio'), (tb, 'Parc B LTDA', 'comercio');
  INSERT INTO auth.users (id, email) VALUES (fin, 'f@p.ci'), (comp, 'c@p.ci'), (coz, 'z@p.ci'), (vend, 'v@p.ci');
  UPDATE profiles SET tenant_id = ta, nome = 'fin' WHERE id = fin;
  UPDATE profiles SET tenant_id = ta, nome = 'comp' WHERE id = comp;
  UPDATE profiles SET tenant_id = ta, nome = 'coz' WHERE id = coz;
  UPDATE profiles SET tenant_id = ta, nome = 'vend' WHERE id = vend;
  DELETE FROM user_roles WHERE user_id IN (fin, comp, coz, vend);
  INSERT INTO user_roles (user_id, tenant_id, role) VALUES
    (fin, ta, 'financeiro'), (comp, ta, 'comprador'), (coz, ta, 'cozinha'), (vend, ta, 'vendedor');
  INSERT INTO fornecedores (tenant_id, razao_social) VALUES (ta, 'Forn A') RETURNING id INTO forn_a;
  INSERT INTO fornecedores (tenant_id, razao_social) VALUES (tb, 'Forn B') RETURNING id INTO forn_b;
  INSERT INTO clientes (tenant_id, nome) VALUES (ta, 'Cli A') RETURNING id INTO cli_a;
  INSERT INTO clientes (tenant_id, nome) VALUES (tb, 'Cli B') RETURNING id INTO cli_b;

  -- funções puras
  PERFORM ci.exige(vencimento_parcela('2027-01-31', 1) = '2027-01-31', '1ª parcela é o próprio vencimento');
  PERFORM ci.exige(vencimento_parcela('2027-01-31', 2) = '2027-02-28', 'dia 31 em fevereiro cai no dia 28');
  PERFORM ci.exige(vencimento_parcela('2027-01-31', 3) = '2027-03-31', 'volta ao dia 31 em março (não encadeia)');
  PERFORM ci.exige(vencimento_parcela('2027-01-31', 4) = '2027-04-30', 'dia 31 em abril cai no dia 30');
  PERFORM ci.exige(vencimento_parcela('2028-01-31', 2) = '2028-02-29', 'ano bissexto: 29 de fevereiro');
  PERFORM ci.exige(vencimento_parcela('2026-12-15', 2) = '2027-01-15', 'vira o ano mantendo o dia 15');
  PERFORM ci.exige(valor_parcela(100, 3, 1) = 33.33 AND valor_parcela(100, 3, 3) = 33.34, '100 em 3: 33,33 + 33,33 + 33,34');

  -- a receber
  PERFORM ci.entrar(fin);
  ids := conta_receber_parcelar('Venda a prazo', 100, 3, '2027-01-31', 'boleto', cli_a, 'obs');
  PERFORM ci.sair();
  PERFORM ci.exige(cardinality(ids) = 3, 'devolve os 3 títulos criados');
  PERFORM ci.exige((SELECT array_agg(vencimento ORDER BY parcela) = ARRAY['2027-01-31','2027-02-28','2027-03-31']::date[] FROM contas_receber WHERE id = ANY (ids)), 'vencimentos mensais no mesmo dia');
  PERFORM ci.exige((SELECT array_agg(valor ORDER BY parcela) = ARRAY[33.33, 33.33, 33.34]::numeric[] AND sum(valor) = 100 FROM contas_receber WHERE id = ANY (ids)), 'centavos que sobram vão para a última parcela e a soma fecha');
  PERFORM ci.exige((SELECT bool_and(parcelas = 3 AND tenant_id = ta AND cliente_id = cli_a AND situacao = 'aberto' AND forma_pagamento = 'boleto' AND descricao = 'Venda a prazo' AND observacoes = 'obs' AND numero IS NOT NULL) FROM contas_receber WHERE id = ANY (ids)), 'campos e numeração sequencial gravados');
  PERFORM ci.entrar(fin);
  ids := conta_receber_parcelar('À vista', 0.10, 3, '2027-05-10', 'pix');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT array_agg(valor ORDER BY parcela) = ARRAY[0.03, 0.03, 0.04]::numeric[] FROM contas_receber WHERE id = ANY (ids)), '0,10 em 3: 0,03 + 0,03 + 0,04');

  -- a pagar
  PERFORM ci.entrar(comp);
  ids := conta_pagar_parcelar('Estoque', 1000, 4, '2026-11-10', 'boleto', forn_a, 'Mercadoria');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT array_agg(vencimento ORDER BY parcela) = ARRAY['2026-11-10','2026-12-10','2027-01-10','2027-02-10']::date[] AND sum(valor) = 1000 AND bool_and(categoria = 'Mercadoria' AND fornecedor_id = forn_a) FROM contas_pagar WHERE id = ANY (ids)), 'a pagar: dia 10 todo mês, vira o ano, soma fecha');

  -- recusas
  PERFORM ci.deve_falhar(vend, $c$SELECT conta_receber_parcelar('x', 10, 1, current_date, 'pix')$c$, 'vendedor lança conta a receber');
  PERFORM ci.deve_falhar(coz, $c$SELECT conta_pagar_parcelar('x', 10, 1, current_date, 'pix')$c$, 'cozinha lança conta a pagar');
  PERFORM ci.deve_falhar(comp, $c$SELECT conta_receber_parcelar('x', 10, 1, current_date, 'pix')$c$, 'comprador lança conta a receber');
  PERFORM ci.deve_falhar(fin, $c$SELECT conta_pagar_parcelar('  ', 10, 1, current_date, 'pix')$c$, 'descrição vazia');
  PERFORM ci.deve_falhar(fin, $c$SELECT conta_pagar_parcelar('x', 0, 1, current_date, 'pix')$c$, 'valor zero');
  PERFORM ci.deve_falhar(fin, $c$SELECT conta_pagar_parcelar('x', 10, 0, current_date, 'pix')$c$, '0 parcelas');
  PERFORM ci.deve_falhar(fin, $c$SELECT conta_pagar_parcelar('x', 10, 121, current_date, 'pix')$c$, '121 parcelas');
  PERFORM ci.deve_falhar(fin, $c$SELECT conta_pagar_parcelar('x', 0.02, 3, current_date, 'pix')$c$, 'parcela menor que 1 centavo');
  PERFORM ci.deve_falhar(fin, $c$SELECT conta_pagar_parcelar('x', 10, 1, NULL, 'pix')$c$, 'sem vencimento');
  PERFORM ci.deve_falhar(fin, format($c$SELECT conta_pagar_parcelar('x', 10, 1, current_date, 'pix', %L)$c$, forn_b), 'fornecedor de outra empresa');
  PERFORM ci.deve_falhar(fin, format($c$SELECT conta_receber_parcelar('x', 10, 1, current_date, 'pix', %L)$c$, cli_b), 'cliente de outra empresa');
  PERFORM ci.exige((SELECT count(*) FROM contas_receber WHERE tenant_id = ta AND descricao = 'x') = 0 AND (SELECT count(*) FROM contas_pagar WHERE tenant_id = ta AND descricao IN ('x', '  ')) = 0, 'recusa não deixa parcela pela metade');
  PERFORM ci.deve_falhar(fin, format($c$INSERT INTO contas_receber (tenant_id, descricao, vencimento, valor) VALUES (%L, 'direto', current_date, 10)$c$, ta), 'INSERT direto em contas a receber');
  PERFORM ci.deve_falhar(fin, format($c$INSERT INTO contas_pagar (tenant_id, descricao, vencimento, valor) VALUES (%L, 'direto', current_date, 10)$c$, ta), 'INSERT direto em contas a pagar');
  PERFORM ci.deve_falhar(NULL, $c$SELECT conta_pagar_parcelar('x', 10, 1, current_date, 'pix')$c$, 'sem login');
END $$;
ROLLBACK;
