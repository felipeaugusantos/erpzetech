-- Estorno de baixa e escrita direta no financeiro: baixa só por função, estorno com motivo e papel,
-- efeito inverso no título, no caixa e no banco, uma vez só, isolamento entre empresas.
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
  ta constant uuid := 'f1111111-1111-1111-1111-111111111111';
  tb constant uuid := 'f2222222-2222-2222-2222-222222222222';
  fin constant uuid := 'f0000000-0000-0000-0000-000000000001';
  ges constant uuid := 'f0000000-0000-0000-0000-000000000002';
  coz constant uuid := 'f0000000-0000-0000-0000-000000000003';
  vend constant uuid := 'f0000000-0000-0000-0000-000000000004';
  admb constant uuid := 'f0000000-0000-0000-0000-000000000005';
  cx1 uuid; cx2 uuid; banco uuid;
  cr uuid; cp uuid; cr2 uuid; b_din uuid; b_pix uuid; bp uuid; est uuid; n numeric;
BEGIN
  INSERT INTO tenants (id, nome) VALUES (ta, 'Fin A'), (tb, 'Fin B');
  INSERT INTO empresas (tenant_id, razao_social, ramo_atividade) VALUES (ta, 'Fin A LTDA', 'comercio'), (tb, 'Fin B LTDA', 'comercio');
  INSERT INTO auth.users (id, email) VALUES (fin, 'f@e.ci'), (ges, 'g@e.ci'), (coz, 'c@e.ci'), (vend, 'v@e.ci'), (admb, 'b@e.ci');
  UPDATE profiles SET tenant_id = ta, nome = 'fin' WHERE id = fin;
  UPDATE profiles SET tenant_id = ta, nome = 'ges' WHERE id = ges;
  UPDATE profiles SET tenant_id = ta, nome = 'coz' WHERE id = coz;
  UPDATE profiles SET tenant_id = ta, nome = 'vend' WHERE id = vend;
  UPDATE profiles SET tenant_id = tb, nome = 'admb' WHERE id = admb;
  DELETE FROM user_roles WHERE user_id IN (fin, ges, coz, vend, admb);
  INSERT INTO user_roles (user_id, tenant_id, role) VALUES
    (fin, ta, 'financeiro'), (ges, ta, 'gestor'), (coz, ta, 'cozinha'), (vend, ta, 'vendedor'), (admb, tb, 'administrador');

  INSERT INTO contas_bancarias (tenant_id, apelido, padrao) VALUES (ta, 'Banco A', true) RETURNING id INTO banco;
  INSERT INTO caixas (tenant_id, aberto_por) VALUES (ta, fin) RETURNING id INTO cx1;

  -- ===== escrita direta fechada =====
  PERFORM ci.deve_falhar(fin, format($c$INSERT INTO financeiro_baixas (tenant_id, conta_receber_id, valor, forma_pagamento) VALUES (%L, gen_random_uuid(), 10, 'pix')$c$, ta), 'financeiro grava baixa direto na tabela');
  PERFORM ci.deve_falhar(ges, format($c$INSERT INTO financeiro_baixas (tenant_id, conta_pagar_id, valor, forma_pagamento) VALUES (%L, gen_random_uuid(), 10, 'pix')$c$, ta), 'gestor grava baixa direto na tabela');

  -- ===== título a receber: 100 = 60 em dinheiro no caixa + 40 em pix no banco =====
  PERFORM ci.entrar(fin);
  cr := (conta_receber_parcelar('Venda', 100, 1, current_date, 'boleto'))[1];
  b_din := baixar_conta('receber', cr, 60, 'dinheiro', current_date, null, cx1);
  b_pix := baixar_conta('receber', cr, 40, 'pix');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT situacao = 'pago' AND valor_recebido = 100 FROM contas_receber WHERE id = cr), 'título quitado pelas duas baixas');
  PERFORM ci.exige((SELECT count(*) FROM banco_movimentos WHERE conta_id = banco AND origem_id = b_pix) = 1, 'baixa em pix lançou no banco');

  -- ===== quem pode estornar =====
  PERFORM ci.deve_falhar(vend, format($c$SELECT baixa_estornar(%L, 'engano de valor')$c$, b_pix), 'vendedor estorna');
  PERFORM ci.deve_falhar(coz, format($c$SELECT baixa_estornar(%L, 'engano de valor')$c$, b_pix), 'cozinha estorna');
  PERFORM ci.deve_falhar(admb, format($c$SELECT baixa_estornar(%L, 'engano de valor')$c$, b_pix), 'outra empresa estorna');
  PERFORM ci.deve_falhar(fin, format($c$SELECT baixa_estornar(%L, '  ')$c$, b_pix), 'estorno sem motivo');
  PERFORM ci.exige((SELECT valor_recebido = 100 FROM contas_receber WHERE id = cr), 'recusas não mexeram no título');

  -- ===== estorno da baixa em pix: título parcial, banco inverso =====
  PERFORM ci.entrar(fin);
  est := baixa_estornar(b_pix, 'cliente pagou errado');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT situacao = 'parcial' AND valor_recebido = 60 FROM contas_receber WHERE id = cr), 'estorno reabre o saldo (parcial, 60 recebidos)');
  PERFORM ci.exige((SELECT estorno_de = b_pix AND valor = 40 AND motivo_estorno = 'cliente pagou errado' FROM financeiro_baixas WHERE id = est), 'estorno é nova baixa ligada à original, com motivo');
  PERFORM ci.exige((SELECT count(*) FROM banco_movimentos WHERE conta_id = banco) = 2
                   AND (SELECT sum(CASE WHEN tipo = 'entrada' THEN valor ELSE -valor END) FROM banco_movimentos WHERE conta_id = banco) = 0, 'banco: lançamento inverso zera o efeito');
  PERFORM ci.exige((SELECT count(*) FROM financeiro_baixas WHERE valor = 40 AND conta_receber_id = cr AND estorno_de IS NULL) = 1, 'a baixa original continua lá (imutável)');
  PERFORM ci.deve_falhar(fin, format($c$SELECT baixa_estornar(%L, 'de novo')$c$, b_pix), 'estornar a mesma baixa duas vezes');
  PERFORM ci.deve_falhar(fin, format($c$SELECT baixa_estornar(%L, 'estorno do estorno')$c$, est), 'estornar um estorno');
  PERFORM ci.deve_falhar(fin, format($c$UPDATE financeiro_baixas SET valor = 1 WHERE id = %L$c$, b_pix), 'alterar baixa');
  PERFORM ci.deve_falhar(fin, format($c$SELECT baixar_conta('receber', %L, 50, 'pix')$c$, cr), 'baixar além do saldo reaberto (40)');

  -- ===== estorno da baixa em dinheiro: caixa devolve =====
  PERFORM ci.entrar(ges);
  est := baixa_estornar(b_din, 'troco errado');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT situacao = 'aberto' AND valor_recebido = 0 FROM contas_receber WHERE id = cr), 'sem nada recebido o título volta a aberto');
  PERFORM ci.exige((SELECT count(*) FROM caixa_movimentos WHERE caixa_id = cx1 AND tipo = 'recebimento' AND valor = 60) = 1
                   AND (SELECT count(*) FROM caixa_movimentos WHERE caixa_id = cx1 AND tipo = 'saida' AND valor = 60) = 1, 'caixa: recebimento de 60 e saída de 60 do estorno');
  PERFORM ci.exige((SELECT count(*) FROM banco_movimentos WHERE conta_id = banco) = 2, 'baixa de caixa não mexe no banco');

  -- ===== caixa da baixa já fechado =====
  PERFORM ci.entrar(fin);
  b_din := baixar_conta('receber', cr, 30, 'dinheiro', current_date, null, cx1);
  PERFORM ci.sair();
  UPDATE caixas SET situacao = 'fechado', fechado_em = now() WHERE id = cx1;
  PERFORM ci.deve_falhar(fin, format($c$SELECT baixa_estornar(%L, 'caixa fechado')$c$, b_din), 'estorno sem caixa aberto na filial');
  INSERT INTO caixas (tenant_id, aberto_por) VALUES (ta, fin) RETURNING id INTO cx2;
  PERFORM ci.entrar(fin);
  est := baixa_estornar(b_din, 'caixa fechado');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT caixa_id = cx2 FROM financeiro_baixas WHERE id = est)
                   AND (SELECT count(*) FROM caixa_movimentos WHERE caixa_id = cx2 AND tipo = 'saida' AND valor = 30) = 1, 'caixa fechado: o estorno sai pelo caixa aberto da filial');

  -- ===== a pagar: estorno devolve ao caixa =====
  PERFORM ci.entrar(fin);
  cp := (conta_pagar_parcelar('Aluguel', 200, 1, current_date, 'boleto'))[1];
  bp := baixar_conta('pagar', cp, 200, 'dinheiro', current_date, null, cx2);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT situacao = 'pago' FROM contas_pagar WHERE id = cp), 'conta a pagar quitada');
  PERFORM ci.entrar(fin);
  est := baixa_estornar(bp, 'pago em duplicidade');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT situacao = 'aberto' AND valor_pago = 0 FROM contas_pagar WHERE id = cp), 'estorno reabre a conta a pagar');
  PERFORM ci.exige((SELECT count(*) FROM caixa_movimentos WHERE caixa_id = cx2 AND tipo = 'entrada' AND valor = 200) = 1, 'pagamento estornado volta ao caixa como entrada');

  -- ===== título: sem mexer em valor quitado nem situação direto =====
  PERFORM ci.entrar(fin);
  cr2 := (conta_receber_parcelar('Outra', 50, 1, current_date, 'boleto'))[1];
  PERFORM baixar_conta('receber', cr2, 10, 'pix');
  PERFORM ci.sair();
  PERFORM ci.deve_falhar(fin, format($c$UPDATE contas_receber SET valor_recebido = 50 WHERE id = %L$c$, cr2), 'financeiro muda valor recebido direto');
  PERFORM ci.deve_falhar(fin, format($c$UPDATE contas_receber SET situacao = 'pago' WHERE id = %L$c$, cr2), 'financeiro marca título como pago direto');
  PERFORM ci.deve_falhar(fin, format($c$UPDATE contas_receber SET valor = 1 WHERE id = %L$c$, cr2), 'financeiro reduz o valor do título direto');
  PERFORM ci.deve_falhar(fin, format($c$UPDATE contas_receber SET situacao = 'cancelado' WHERE id = %L$c$, cr2), 'cancelar título com pagamento');
  PERFORM ci.deve_falhar(fin, format($c$UPDATE contas_pagar SET valor_pago = 200, situacao = 'pago' WHERE id = %L$c$, cp), 'conta a pagar paga direto');
  PERFORM ci.deve_falhar(fin, format($c$UPDATE contas_pagar SET valor = 1 WHERE id = %L$c$, cp), 'conta a pagar com valor mudado direto');
  PERFORM ci.entrar(fin);
  UPDATE contas_pagar SET situacao = 'cancelado', motivo_cancelamento = 'teste' WHERE id = cp;
  UPDATE contas_receber SET descricao = 'Outra (editada)', vencimento = current_date + 5 WHERE id = cr2;
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT situacao = 'cancelado' FROM contas_pagar WHERE id = cp), 'conta a pagar sem pagamento ainda cancela (já estornada)');
  PERFORM ci.exige((SELECT descricao = 'Outra (editada)' FROM contas_receber WHERE id = cr2), 'descrição e vencimento seguem editáveis');
  PERFORM ci.deve_falhar(fin, format($c$SELECT baixar_conta('pagar', %L, 10, 'pix')$c$, cp), 'baixar conta cancelada');
  PERFORM ci.deve_falhar(fin, format($c$SELECT baixa_estornar(%L, 'em conta cancelada')$c$, bp), 'estornar (já estornada) conta cancelada');

  -- quem não é do financeiro não escreve em contas a pagar
  PERFORM ci.exige(ci.contar_como(coz, format($c$WITH u AS (UPDATE contas_pagar SET descricao = 'x' WHERE tenant_id = %L RETURNING 1) SELECT count(*) FROM u$c$, ta)) = 0, 'cozinha não altera contas a pagar');
  PERFORM ci.deve_falhar(coz, format($c$INSERT INTO contas_pagar (tenant_id, descricao, vencimento, valor) VALUES (%L, 'x', current_date, 1)$c$, ta), 'cozinha cria conta a pagar');
  PERFORM ci.deve_falhar(fin, format($c$DELETE FROM contas_pagar WHERE id = %L$c$, cp), 'apagar conta a pagar');
END $$;
ROLLBACK;
