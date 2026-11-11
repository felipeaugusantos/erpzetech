-- Categorias financeiras e DRE: papel, isolamento entre empresas, validação da categoria no título, padrão e
-- importação do texto antigo, e os números do DRE (vendas, CMV, devoluções, despesas por grupo). Desfaz tudo com ROLLBACK.
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
CREATE FUNCTION ci.contar_como(uid uuid, cmd text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  PERFORM ci.entrar(uid);
  EXECUTE cmd INTO n;
  PERFORM ci.sair();
  RETURN n;
END $$;
CREATE FUNCTION ci.exige(condicao boolean, descricao text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF condicao IS NOT TRUE THEN RAISE EXCEPTION 'FALHA: %', descricao; END IF;
  RAISE NOTICE 'ok: %', descricao;
END $$;

DO $$
DECLARE
  ta constant uuid := 'f6000000-0000-0000-0000-00000000000a';
  tb constant uuid := 'f6000000-0000-0000-0000-00000000000b';
  fin constant uuid := 'f7000000-0000-0000-0000-000000000001';
  vend constant uuid := 'f7000000-0000-0000-0000-000000000002';
  coz constant uuid := 'f7000000-0000-0000-0000-000000000003';
  admb constant uuid := 'f7000000-0000-0000-0000-000000000004';
  cat_aluguel uuid; cat_rec uuid; cat_juros uuid; cat_est uuid; cat_b uuid; cat_imp uuid; cat_fin_rec uuid;
  ped uuid; prod uuid; cli uuid; dep uuid; r jsonb; n int; ids uuid[];
BEGIN
  INSERT INTO tenants (id, nome) VALUES (ta, 'Dre A'), (tb, 'Dre B');
  INSERT INTO empresas (tenant_id, razao_social, ramo_atividade) VALUES (ta, 'Dre A LTDA', 'comercio'), (tb, 'Dre B LTDA', 'comercio');
  INSERT INTO auth.users (id, email) VALUES (fin, 'f@d.ci'), (vend, 'v@d.ci'), (coz, 'c@d.ci'), (admb, 'b@d.ci');
  UPDATE profiles SET tenant_id = ta, nome = 'fin' WHERE id = fin;
  UPDATE profiles SET tenant_id = ta, nome = 'vend' WHERE id = vend;
  UPDATE profiles SET tenant_id = ta, nome = 'coz' WHERE id = coz;
  UPDATE profiles SET tenant_id = tb, nome = 'admb' WHERE id = admb;
  DELETE FROM user_roles WHERE user_id IN (fin, vend, coz, admb);
  INSERT INTO user_roles (user_id, tenant_id, role) VALUES
    (fin, ta, 'financeiro'), (vend, ta, 'vendedor'), (coz, ta, 'cozinha'), (admb, tb, 'administrador');

  -- ===== cadastro: só por função e só por quem é do financeiro =====
  PERFORM ci.deve_falhar(fin, format($c$INSERT INTO financeiro_categorias (tenant_id, nome, tipo, grupo) VALUES (%L, 'direto', 'despesa', 'operacional')$c$, ta), 'INSERT direto em categorias');
  PERFORM ci.deve_falhar(vend, $c$SELECT financeiro_categoria_salvar(NULL, 'Aluguel', 'despesa', 'operacional')$c$, 'vendedor cria categoria');
  PERFORM ci.deve_falhar(coz, $c$SELECT financeiro_categorias_padrao()$c$, 'cozinha cria categorias padrão');
  PERFORM ci.deve_falhar(vend, $c$SELECT * FROM financeiro_dre(current_date, current_date)$c$, 'vendedor lê o DRE');
  PERFORM ci.deve_falhar(coz, $c$SELECT * FROM financeiro_dre(current_date, current_date)$c$, 'cozinha lê o DRE');

  PERFORM ci.entrar(fin);
  cat_aluguel := financeiro_categoria_salvar(NULL, '  Aluguel  ', 'despesa', 'operacional');
  cat_rec := financeiro_categoria_salvar(NULL, 'Receitas de serviços', 'receita', 'operacional');
  cat_juros := financeiro_categoria_salvar(NULL, 'Juros pagos', 'despesa', 'financeira');
  cat_est := financeiro_categoria_salvar(NULL, 'Compra de estoque', 'despesa', 'fora_dre');
  cat_imp := financeiro_categoria_salvar(NULL, 'Simples Nacional', 'despesa', 'deducao');
  cat_fin_rec := financeiro_categoria_salvar(NULL, 'Rendimentos', 'receita', 'financeira');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT nome = 'Aluguel' FROM financeiro_categorias WHERE id = cat_aluguel), 'nome é gravado sem espaços nas pontas');
  PERFORM ci.deve_falhar(fin, $c$SELECT financeiro_categoria_salvar(NULL, 'aluguel', 'despesa', 'operacional')$c$, 'nome repetido (sem diferenciar maiúsculas)');
  PERFORM ci.exige((SELECT count(*) FROM financeiro_categorias WHERE tenant_id = ta AND lower(nome) = 'aluguel') = 1, 'nome repetido não duplica');
  PERFORM ci.deve_falhar(fin, $c$SELECT financeiro_categoria_salvar(NULL, 'Receita X', 'receita', 'custo')$c$, 'grupo de despesa em categoria de receita');
  PERFORM ci.deve_falhar(fin, $c$SELECT financeiro_categoria_salvar(NULL, 'x', 'despesa', 'operacional')$c$, 'nome curto demais');
  PERFORM ci.deve_falhar(admb, format($c$SELECT financeiro_categoria_salvar(%L, 'Roubada', 'despesa', 'operacional')$c$, cat_aluguel), 'outra empresa edita a categoria');
  PERFORM ci.exige(ci.contar_como(admb, 'SELECT count(*) FROM financeiro_categorias') = 0, 'outra empresa não lê as categorias');
  PERFORM ci.exige(ci.contar_como(fin, 'SELECT count(*) FROM financeiro_categorias') = 6, 'a empresa lê as próprias categorias');
  PERFORM ci.deve_falhar(fin, $c$SELECT financeiro_categorias_padrao()$c$, 'padrão em empresa que já tem categorias');
  PERFORM ci.entrar(admb);
  PERFORM ci.exige(financeiro_categorias_padrao() = 23, 'empresa sem categorias recebe as 23 padrão');
  cat_b := (SELECT id FROM financeiro_categorias WHERE tenant_id = tb AND nome = 'Aluguel');
  PERFORM ci.sair();

  -- ===== categoria no título =====
  PERFORM ci.entrar(fin);
  ids := conta_pagar_parcelar('Aluguel do galpão', 3000, 3, '2027-03-10', 'boleto', NULL, NULL, NULL, cat_aluguel);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT bool_and(categoria_id = cat_aluguel AND categoria = 'Aluguel') FROM contas_pagar WHERE id = ANY (ids)), 'parcelas nascem com a categoria e o nome no texto legado');
  PERFORM ci.deve_falhar(fin, format($c$SELECT conta_pagar_parcelar('x', 10, 1, current_date, 'pix', NULL, NULL, NULL, %L)$c$, cat_rec), 'conta a pagar com categoria de receita');
  PERFORM ci.deve_falhar(fin, format($c$SELECT conta_receber_parcelar('x', 10, 1, current_date, 'pix', NULL, NULL, %L)$c$, cat_aluguel), 'conta a receber com categoria de despesa');
  PERFORM ci.deve_falhar(fin, format($c$SELECT conta_pagar_parcelar('x', 10, 1, current_date, 'pix', NULL, NULL, NULL, %L)$c$, cat_b), 'conta a pagar com categoria de outra empresa');
  PERFORM ci.deve_falhar(fin, format($c$UPDATE contas_pagar SET categoria_id = %L WHERE id = %L$c$, cat_b, ids[1]), 'trocar para categoria de outra empresa');
  PERFORM ci.entrar(fin);
  UPDATE contas_pagar SET categoria_id = cat_juros WHERE id = ids[1];
  PERFORM financeiro_categoria_salvar(cat_est, 'Compra de estoque', 'despesa', 'fora_dre', false);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT categoria_id = cat_juros FROM contas_pagar WHERE id = ids[1]), 'categoria do título pode ser trocada direto');
  PERFORM ci.deve_falhar(fin, format($c$UPDATE contas_pagar SET categoria_id = %L WHERE id = %L$c$, cat_est, ids[2]), 'categoria desativada em título');
  PERFORM ci.deve_falhar(fin, format($c$SELECT financeiro_categoria_salvar(%L, 'Aluguel', 'receita', 'operacional')$c$, cat_aluguel), 'trocar para receita categoria já usada');
  PERFORM ci.entrar(fin);
  PERFORM financeiro_categoria_salvar(cat_est, 'Compra de estoque', 'despesa', 'fora_dre', true);
  PERFORM ci.sair();

  -- ===== importar o texto antigo =====
  INSERT INTO contas_pagar (tenant_id, descricao, vencimento, valor, categoria) VALUES
    (ta, 'Antiga 1', '2027-03-05', 100, 'Internet'), (ta, 'Antiga 2', '2027-03-06', 50, ' internet '),
    (ta, 'Antiga 3', '2027-03-07', 70, 'Mercadorias'), (ta, 'Antiga 4', '2027-03-08', 10, NULL);
  PERFORM ci.deve_falhar(vend, $c$SELECT financeiro_categorias_importar_texto()$c$, 'vendedor importa categorias do texto');
  PERFORM ci.entrar(fin);
  r := financeiro_categorias_importar_texto();
  PERFORM ci.sair();
  PERFORM ci.exige((r ->> 'categorias_criadas')::int = 2 AND (r ->> 'titulos_ligados')::int = 3, 'importação cria Internet e Compra de mercadorias e liga 3 títulos: ' || r::text);
  PERFORM ci.exige((SELECT grupo = 'fora_dre' FROM financeiro_categorias WHERE tenant_id = ta AND nome = 'Compra de mercadorias (estoque)'), '"Mercadorias" vira categoria fora do DRE');
  PERFORM ci.exige((SELECT count(*) FROM contas_pagar WHERE tenant_id = ta AND descricao = 'Antiga 4' AND categoria_id IS NULL) = 1, 'título sem texto continua sem categoria');
  PERFORM ci.entrar(fin);
  r := financeiro_categorias_importar_texto();
  PERFORM ci.sair();
  PERFORM ci.exige((r ->> 'categorias_criadas')::int = 0 AND (r ->> 'titulos_ligados')::int = 0, 'importar de novo não muda nada');

  -- ===== DRE =====
  INSERT INTO produtos (tenant_id, descricao) VALUES (ta, 'Produto DRE') RETURNING id INTO prod;
  INSERT INTO clientes (tenant_id, nome) VALUES (ta, 'Cliente DRE') RETURNING id INTO cli;
  INSERT INTO depositos (tenant_id, nome) VALUES (ta, 'Dep DRE') RETURNING id INTO dep;
  INSERT INTO pedidos (tenant_id, cliente_id, deposito_id, situacao, total, subtotal, created_at) VALUES (ta, cli, dep, 'concluido', 1000, 1000, '2027-03-15 15:00:00+00') RETURNING id INTO ped;
  INSERT INTO pedido_itens (tenant_id, pedido_id, produto_id, quantidade, preco_unitario, total, custo_unitario) VALUES (ta, ped, prod, 10, 100, 1000, 40);
  INSERT INTO pedidos (tenant_id, cliente_id, deposito_id, situacao, total, subtotal, created_at) VALUES (ta, cli, dep, 'cancelado', 500, 500, '2027-03-15 15:00:00+00');
  INSERT INTO pedidos (tenant_id, cliente_id, deposito_id, situacao, total, subtotal, created_at) VALUES (ta, cli, dep, 'aguardando_pagamento', 300, 300, '2027-03-16 15:00:00+00');
  INSERT INTO pedidos (tenant_id, cliente_id, deposito_id, situacao, total, subtotal, created_at) VALUES (ta, cli, dep, 'concluido', 9999, 9999, '2027-04-02 15:00:00+00');
  -- venda de 31/03 às 23:30 em Brasília (02:30 UTC de 01/04) pertence a março
  INSERT INTO pedidos (tenant_id, cliente_id, deposito_id, situacao, total, subtotal, created_at) VALUES (ta, cli, dep, 'concluido', 200, 200, '2027-04-01 02:30:00+00');
  INSERT INTO devolucoes (tenant_id, pedido_id, valor_total, created_at, modo) VALUES (ta, ped, 100, '2027-03-20 15:00:00+00', 'pedido');
  -- título de pedido (já está em vendas) e títulos avulsos
  INSERT INTO contas_receber (tenant_id, descricao, vencimento, valor, pedido_id) VALUES (ta, 'Parcela do pedido', '2027-03-30', 1000, ped);
  INSERT INTO contas_receber (tenant_id, descricao, vencimento, valor, categoria_id) VALUES (ta, 'Serviço', '2027-03-12', 400, cat_rec);
  INSERT INTO contas_receber (tenant_id, descricao, vencimento, valor, categoria_id) VALUES (ta, 'Rendimento', '2027-03-31', 30, cat_fin_rec);
  INSERT INTO contas_receber (tenant_id, descricao, vencimento, valor) VALUES (ta, 'Receita sem categoria', '2027-03-18', 60);
  INSERT INTO contas_receber (tenant_id, descricao, vencimento, valor, categoria_id, situacao) VALUES (ta, 'Cancelada', '2027-03-18', 5000, cat_rec, 'cancelado');
  -- despesas: aluguel 3 x 1000 (vence 10/03, 10/04, 10/05; a 1ª foi para Juros), internet 150, estoque (fora), imposto, sem categoria
  INSERT INTO contas_pagar (tenant_id, descricao, vencimento, valor, categoria_id) VALUES (ta, 'Simples', '2027-03-20', 80, cat_imp);
  INSERT INTO contas_pagar (tenant_id, descricao, vencimento, valor) VALUES (ta, 'Despesa sem categoria', '2027-03-21', 25);
  INSERT INTO contas_pagar (tenant_id, descricao, vencimento, valor, categoria_id) VALUES (ta, 'Estoque', '2027-03-22', 700, cat_est);
  INSERT INTO compras (tenant_id, deposito_id, situacao) VALUES (ta, dep, 'recebido') RETURNING id INTO ped;
  INSERT INTO contas_pagar (tenant_id, descricao, vencimento, valor, compra_id) VALUES (ta, 'Compra sem categoria', '2027-03-23', 900, ped);

  PERFORM ci.entrar(fin);
  SELECT jsonb_agg(to_jsonb(d)) INTO r FROM financeiro_dre('2027-03-01', '2027-03-31') d;
  PERFORM ci.sair();
  CREATE TEMP TABLE dre_marco ON COMMIT DROP AS
    SELECT * FROM jsonb_to_recordset(r) AS x(secao text, categoria_id uuid, categoria text, valor numeric);
  PERFORM ci.exige((SELECT valor FROM dre_marco WHERE secao = 'vendas') = 1200, 'vendas de março: 1000 + 200 (a de 23h30 de Brasília), sem cancelada, sem aguardando pagamento, sem abril');
  PERFORM ci.exige((SELECT valor FROM dre_marco WHERE secao = 'devolucoes') = 100, 'devoluções do período');
  PERFORM ci.exige((SELECT valor FROM dre_marco WHERE secao = 'cmv') = 400, 'CMV = 10 x 40 dos itens vendidos');
  PERFORM ci.exige((SELECT sum(valor) FROM dre_marco WHERE secao = 'receita_outras') = 460 AND (SELECT count(*) FROM dre_marco WHERE secao = 'receita_outras') = 2, 'outras receitas: serviço 400 + sem categoria 60 (título de pedido e cancelado ficam de fora)');
  PERFORM ci.exige((SELECT valor FROM dre_marco WHERE secao = 'receita_financeira') = 30, 'receita financeira à parte');
  PERFORM ci.exige((SELECT valor FROM dre_marco WHERE secao = 'despesa_deducao') = 80, 'impostos sobre vendas no grupo de deduções');
  PERFORM ci.exige((SELECT valor FROM dre_marco WHERE secao = 'despesa_financeira' AND categoria = 'Juros pagos') = 1000, 'título recategorizado entra pela nova categoria (financeira)');
  PERFORM ci.exige((SELECT sum(valor) FROM dre_marco WHERE secao = 'despesa_operacional') = 150 + 25 + 10, 'despesa operacional: internet 150 + sem categoria (25 + a Antiga 4 de 10)');
  PERFORM ci.exige(NOT EXISTS (SELECT 1 FROM dre_marco WHERE secao LIKE 'despesa%' AND (categoria ILIKE '%estoque%' OR categoria ILIKE '%mercadorias%')), 'categoria fora do DRE e compra de mercadoria sem categoria não viram despesa');
  PERFORM ci.exige((SELECT count(*) FROM dre_marco WHERE categoria_id IS NULL AND categoria = 'Sem categoria') = 2, 'o que está sem categoria aparece como "Sem categoria" (uma receita e uma despesa)');
  PERFORM ci.exige(ci.contar_como(admb, $c$SELECT count(*) FROM financeiro_dre('2027-03-01', '2027-03-31')$c$) = 0, 'outra empresa não vê o DRE da primeira (o dela é vazio)');
  PERFORM ci.deve_falhar(fin, $c$SELECT * FROM financeiro_dre('2027-03-31', '2027-03-01')$c$, 'período invertido');
  PERFORM ci.deve_falhar(fin, $c$SELECT * FROM financeiro_dre('2020-01-01', '2027-03-01')$c$, 'período de mais de 5 anos');
END $$;
ROLLBACK;
