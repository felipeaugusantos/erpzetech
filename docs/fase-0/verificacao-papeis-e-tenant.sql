-- Fase 0 — verificação de papéis e isolamento por empresa, direto no banco.
--
-- Como rodar (num banco com todas as migrations, por exemplo o do CI depois de supabase/ci/run.sh):
--   psql -v ON_ERROR_STOP=1 -f docs/fase-0/verificacao-papeis-e-tenant.sql 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
-- Cada linha mostra "papel | operação | PERMITIDO ou negado (motivo)". Escreve dados de teste (usuários @mx,
-- pedidos, filiais, empresa B): rode só em banco descartável. O que for PERMITIDO e não deveria é um achado.
-- Quando cada correção entrar, o caso correspondente deve virar teste em supabase/ci/smoke.sql.

-- ===== 0. usuários de teste, um por papel, e a função que executa como cada um =====
\set ON_ERROR_STOP on
\pset format unaligned
\pset fieldsep ' | '
CREATE SCHEMA IF NOT EXISTS mx;
GRANT USAGE ON SCHEMA mx TO PUBLIC;
CREATE OR REPLACE FUNCTION mx.como(uid uuid, cmd text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', uid::text, false);
  EXECUTE 'SET ROLE authenticated';
  BEGIN
    EXECUTE cmd;
    r := 'PERMITIDO';
  EXCEPTION WHEN OTHERS THEN
    r := 'negado (' || left(SQLERRM, 60) || ')';
  END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', false);
  RETURN r;
END $$;
DO $$
DECLARE demo constant uuid := '11111111-1111-1111-1111-111111111111';
  papel text; u uuid;
BEGIN
  FOREACH papel IN ARRAY ARRAY['vendedor','caixa','estoquista','comprador','financeiro','logistica','motorista','gestor','administrador','garcom'] LOOP
    u := ('b0000000-0000-0000-0000-0000000000' || lpad((array_position(ARRAY['vendedor','caixa','estoquista','comprador','financeiro','logistica','motorista','gestor','administrador','garcom'], papel))::text, 2, '0'))::uuid;
    INSERT INTO auth.users (id, email) VALUES (u, papel || '@mx') ON CONFLICT DO NOTHING;
    UPDATE profiles SET tenant_id = demo WHERE id = u;
    INSERT INTO user_roles (user_id, tenant_id, role) VALUES (u, demo, papel::app_role) ON CONFLICT DO NOTHING;
  END LOOP;
  INSERT INTO motoristas (tenant_id, empresa_id, filial_id, nome, cnh, categoria_cnh, validade_cnh, user_id) VALUES (demo, '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333', 'Motorista MX', '1', 'B', '2030-01-01', 'b0000000-0000-0000-0000-000000000007') ON CONFLICT DO NOTHING;
END $$;

-- ===== 1. o que cada papel consegue fazer por chamada de função =====
-- (colunas: papel | operação | resultado)
\set ON_ERROR_STOP on
DO $$
DECLARE demo constant uuid := '11111111-1111-1111-1111-111111111111';
  emp constant uuid := '22222222-2222-2222-2222-222222222222';
  dep constant uuid := '44444444-0000-0000-0000-000000000001';
  papeis text[] := ARRAY['vendedor','caixa','estoquista','comprador','financeiro','logistica','motorista','gestor','administrador'];
  prod uuid; cli uuid; papel text; u uuid; i int; f uuid; p1 uuid; p2 uuid; p3 uuid;
  adm constant uuid := 'b0000000-0000-0000-0000-000000000009';
  linhas text[] := ARRAY[]::text[]; l text;
  tb uuid; eb uuid; fb uuid; db uuid; pb uuid; cb uuid; pedb uuid; cxb uuid; ped_ent uuid;
BEGIN
  SELECT id INTO prod FROM produtos WHERE tenant_id = demo LIMIT 1;
  SELECT id INTO cli FROM clientes WHERE tenant_id = demo LIMIT 1;
  FOR i IN 1..array_length(papeis,1) LOOP
    papel := papeis[i];
    u := ('b0000000-0000-0000-0000-0000000000' || lpad(i::text, 2, '0'))::uuid;
    INSERT INTO filiais (tenant_id, empresa_id, nome) VALUES (demo, emp, 'F-' || papel) RETURNING id INTO f;
    PERFORM set_config('request.jwt.claim.sub', adm::text, false); SET ROLE authenticated;
    p1 := criar_pedido_direto(cli, dep, jsonb_build_array(jsonb_build_object('produto_id', prod, 'quantidade', 1, 'preco_unitario', 10)));
    p2 := criar_pedido_direto(cli, dep, jsonb_build_array(jsonb_build_object('produto_id', prod, 'quantidade', 1, 'preco_unitario', 10)));
    p3 := criar_pedido_direto(cli, dep, jsonb_build_array(jsonb_build_object('produto_id', prod, 'quantidade', 1, 'preco_unitario', 10)));
    RESET ROLE;
    linhas := linhas || format('%s|aprovar pedido|%s', papel, mx.como(u, format($c$SELECT pedido_avancar_status(%L, 'aprovado')$c$, p1)));
    linhas := linhas || format('%s|emitir NF-e (gerar_nfe_agrupada)|%s', papel, mx.como(u, format($c$SELECT gerar_nfe_agrupada(ARRAY[%L::uuid])$c$, p2)));
    linhas := linhas || format('%s|gerar contas a receber|%s', papel, mx.como(u, format($c$SELECT gerar_contas_receber(%L, 1, current_date + 30, 'boleto')$c$, p3)));
    linhas := linhas || format('%s|abrir caixa|%s', papel, mx.como(u, format($c$SELECT abrir_caixa(%L, 0)$c$, f)));
    linhas := linhas || format('%s|entrada de estoque|%s', papel, mx.como(u, format($c$SELECT registrar_movimentacao(%L, %L, 'entrada'::mov_tipo, 1, 'mx', 'mx')$c$, prod, dep)));
    linhas := linhas || format('%s|cancelar pedido|%s', papel, mx.como(u, format($c$SELECT pedido_avancar_status(%L, 'cancelado', 'mx')$c$, p1)));
  END LOOP;
  FOREACH l IN ARRAY linhas LOOP RAISE NOTICE '%', l; END LOOP;
END $$;

-- ===== 2. operações entre empresas (usuário da empresa A mexendo em dados da empresa B) =====
\set ON_ERROR_STOP on
DO $$
DECLARE demo constant uuid := '11111111-1111-1111-1111-111111111111';
  adm constant uuid := 'b0000000-0000-0000-0000-000000000009';
  vend constant uuid := 'b0000000-0000-0000-0000-000000000001';
  dep constant uuid := '44444444-0000-0000-0000-000000000001';
  tb uuid; eb uuid; fb uuid; db uuid; pb uuid; cb uuid; pedb uuid; cxb uuid; obb uuid; ub uuid; profb uuid;
  prod uuid; cli uuid; pedA uuid; linhas text[] := ARRAY[]::text[]; l text; n_com_antes int; n_com_depois int; pib uuid; est_antes numeric; est_depois numeric;
BEGIN
  SELECT id INTO prod FROM produtos WHERE tenant_id = demo LIMIT 1;
  SELECT id INTO cli FROM clientes WHERE tenant_id = demo LIMIT 1;
  -- empresa B completa
  INSERT INTO tenants (nome) VALUES ('Empresa B (mx)') RETURNING id INTO tb;
  INSERT INTO empresas (tenant_id, razao_social) VALUES (tb, 'B Ltda') RETURNING id INTO eb;
  INSERT INTO filiais (tenant_id, empresa_id, nome) VALUES (tb, eb, 'Filial B') RETURNING id INTO fb;
  INSERT INTO depositos (tenant_id, nome) VALUES (tb, 'Dep B') RETURNING id INTO db;
  INSERT INTO produtos (tenant_id, codigo_interno, descricao, unidade, custo) VALUES (tb, 'MXB', 'Produto B', 'un', 5) RETURNING id INTO pb;
  INSERT INTO clientes (tenant_id, nome) VALUES (tb, 'Cliente B') RETURNING id INTO cb;
  INSERT INTO obras (tenant_id, cliente_id, nome) VALUES (tb, cb, 'Obra B') RETURNING id INTO obb;
  INSERT INTO auth.users (id, email) VALUES ('c0000000-0000-0000-0000-000000000001', 'vendedor-b@mx') ON CONFLICT DO NOTHING;
  ub := 'c0000000-0000-0000-0000-000000000001';
  UPDATE profiles SET tenant_id = tb WHERE id = ub;
  INSERT INTO user_roles (user_id, tenant_id, role) VALUES (ub, tb, 'vendedor');
  INSERT INTO vendedor_comissao_regras (tenant_id, vendedor_id, percentual, base, ativo) VALUES (tb, ub, 10, 'venda', true);
  INSERT INTO pedidos (tenant_id, cliente_id, deposito_id, vendedor_id, situacao, subtotal, total) VALUES (tb, cb, db, ub, 'entregue', 100, 100) RETURNING id INTO pedb;
  INSERT INTO caixas (tenant_id, filial_id, aberto_por, valor_abertura) VALUES (tb, fb, ub, 0) RETURNING id INTO cxb;

  -- a) caixa na filial de outra empresa
  linhas := linhas || format('abrir_caixa com filial de outra empresa|%s', mx.como(adm, format($c$SELECT abrir_caixa(%L, 0)$c$, fb)));
  SELECT count(*) INTO n_com_antes FROM comissoes WHERE tenant_id = tb;
  -- b) comissão de pedido de outra empresa
  linhas := linhas || format('comissionar_pedido_id com pedido de outra empresa|%s', mx.como(adm, format($c$SELECT comissionar_pedido_id(%L)$c$, pedb)));
  SELECT count(*) INTO n_com_depois FROM comissoes WHERE tenant_id = tb;
  linhas := linhas || format('  -> comissões da empresa B: antes %s, depois %s|', n_com_antes, n_com_depois);
  -- c) estoque de outra empresa
  linhas := linhas || format('registrar_movimentacao com produto/depósito de outra empresa|%s', mx.como(adm, format($c$SELECT registrar_movimentacao(%L, %L, 'entrada'::mov_tipo, 5, 'mx', 'mx')$c$, pb, db)));
  linhas := linhas || format('registrar_movimentacao produto de B em depósito de A|%s', mx.como(adm, format($c$SELECT registrar_movimentacao(%L, %L, 'entrada'::mov_tipo, 5, 'mx', 'mx')$c$, pb, dep)));
  -- d) lançar no caixa de outra empresa
  linhas := linhas || format('caixa_lancar no caixa de outra empresa|%s', mx.como(adm, format($c$SELECT caixa_lancar(%L, 'suprimento', 1, 'mx', 'dinheiro', NULL, NULL)$c$, cxb)));
  linhas := linhas || format('fechar_caixa de outra empresa|%s', mx.como(adm, format($c$SELECT fechar_caixa(%L, 0, 'mx')$c$, cxb)));
  -- e) pedido com referências de outra empresa
  linhas := linhas || format('criar_pedido_direto com cliente de outra empresa|%s', mx.como(adm, format($c$SELECT criar_pedido_direto(%L, %L, jsonb_build_array(jsonb_build_object('produto_id', %L, 'quantidade', 1, 'preco_unitario', 10)))$c$, cb, dep, prod)));
  linhas := linhas || format('criar_pedido_direto com obra de outra empresa|%s', mx.como(adm, format($c$SELECT criar_pedido_direto(%L, %L, jsonb_build_array(jsonb_build_object('produto_id', %L, 'quantidade', 1, 'preco_unitario', 10)), %L)$c$, cli, dep, prod, obb)));
  linhas := linhas || format('criar_pedido_direto com produto de outra empresa|%s', mx.como(adm, format($c$SELECT criar_pedido_direto(%L, %L, jsonb_build_array(jsonb_build_object('produto_id', %L, 'quantidade', 1, 'preco_unitario', 10)))$c$, cli, dep, pb)));
  linhas := linhas || format('criar_pedido_direto com vendedor de outra empresa|%s', mx.como(adm, format($c$SELECT criar_pedido_direto(%L, %L, jsonb_build_array(jsonb_build_object('produto_id', %L, 'quantidade', 1, 'preco_unitario', 10)), NULL, 0, 0, NULL, NULL, %L)$c$, cli, dep, prod, ub)));
  -- f) operações sobre pedido de outra empresa
  linhas := linhas || format('pedido_avancar_status de outra empresa|%s', mx.como(adm, format($c$SELECT pedido_avancar_status(%L, 'concluido')$c$, pedb)));
  linhas := linhas || format('gerar_nfe_agrupada de outra empresa|%s', mx.como(adm, format($c$SELECT gerar_nfe_agrupada(ARRAY[%L::uuid])$c$, pedb)));
  linhas := linhas || format('gerar_contas_receber de outra empresa|%s', mx.como(adm, format($c$SELECT gerar_contas_receber(%L, 1, current_date, 'boleto')$c$, pedb)));
  linhas := linhas || format('leitura direta (RLS) de pedidos de outra empresa|%s linhas', (SELECT mx.como(adm, format($c$SELECT 1/ (CASE WHEN (SELECT count(*) FROM pedidos WHERE id = %L) = 0 THEN 0 ELSE 1 END)$c$, pedb))));
  FOREACH l IN ARRAY linhas LOOP RAISE NOTICE '%', l; END LOOP;
END $$;

-- ===== 3. escrita direta nas tabelas (como faz o cliente via API) =====
\set ON_ERROR_STOP on
CREATE OR REPLACE FUNCTION mx.afeta(uid uuid, cmd text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n bigint; r text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', uid::text, false);
  EXECUTE 'SET ROLE authenticated';
  BEGIN
    EXECUTE cmd; GET DIAGNOSTICS n = ROW_COUNT; r := n || ' linha(s) alterada(s)';
  EXCEPTION WHEN OTHERS THEN r := 'negado (' || left(SQLERRM, 70) || ')';
  END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', false);
  RETURN r;
END $$;
DO $$
DECLARE
  demo constant uuid := '11111111-1111-1111-1111-111111111111';
  mot constant uuid := 'b0000000-0000-0000-0000-000000000007';
  vend constant uuid := 'b0000000-0000-0000-0000-000000000001';
  est constant uuid := 'b0000000-0000-0000-0000-000000000003';
  l text[] := ARRAY[]::text[]; x text; papel text; u uuid;
BEGIN
  FOREACH papel IN ARRAY ARRAY['motorista','vendedor','estoquista'] LOOP
    u := CASE papel WHEN 'motorista' THEN mot WHEN 'vendedor' THEN vend ELSE est END;
    l := l || format('%s|alterar preço de item do pedido|%s', papel, mx.afeta(u, $c$UPDATE pedido_itens SET preco_unitario = 0.01, total = 0.01 WHERE tenant_id = '11111111-1111-1111-1111-111111111111' AND id = (SELECT id FROM pedido_itens WHERE tenant_id = '11111111-1111-1111-1111-111111111111' LIMIT 1)$c$));
    l := l || format('%s|alterar total/situação do pedido direto|%s', papel, mx.afeta(u, $c$UPDATE pedidos SET total = 1, situacao = 'concluido' WHERE id = (SELECT id FROM pedidos WHERE tenant_id = '11111111-1111-1111-1111-111111111111' ORDER BY created_at DESC LIMIT 1)$c$));
    l := l || format('%s|marcar conta a receber como paga|%s', papel, mx.afeta(u, $c$UPDATE contas_receber SET situacao = 'paga', valor_pago = valor WHERE id = (SELECT id FROM contas_receber WHERE tenant_id = '11111111-1111-1111-1111-111111111111' LIMIT 1)$c$));
    l := l || format('%s|apagar conta a receber|%s', papel, mx.afeta(u, $c$DELETE FROM contas_receber WHERE id = (SELECT id FROM contas_receber WHERE tenant_id = '11111111-1111-1111-1111-111111111111' LIMIT 1)$c$));
    l := l || format('%s|alterar item de NF-e|%s', papel, mx.afeta(u, $c$UPDATE nfe_itens SET quantidade = quantidade + 1 WHERE id = (SELECT id FROM nfe_itens WHERE tenant_id = '11111111-1111-1111-1111-111111111111' LIMIT 1)$c$));
    l := l || format('%s|marcar NF-e como autorizada|%s', papel, mx.afeta(u, $c$UPDATE nfe SET situacao = 'autorizada' WHERE id = (SELECT id FROM nfe WHERE tenant_id = '11111111-1111-1111-1111-111111111111' LIMIT 1)$c$));
    l := l || format('%s|alterar custo/preço de produto|%s', papel, mx.afeta(u, $c$UPDATE produtos SET preco_venda = 0.01 WHERE id = (SELECT id FROM produtos WHERE tenant_id = '11111111-1111-1111-1111-111111111111' LIMIT 1)$c$));
    l := l || format('%s|conceder papel a si mesmo|%s', papel, mx.afeta(u, format($c$INSERT INTO user_roles (user_id, tenant_id, role) VALUES (%L, '11111111-1111-1111-1111-111111111111', 'administrador')$c$, u)));
  END LOOP;
  FOREACH x IN ARRAY l LOOP RAISE NOTICE '%', x; END LOOP;
END $$;
