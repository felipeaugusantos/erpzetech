-- Testes de segurança (RLS e funções SECURITY DEFINER) sobre o banco com todas as migrations.
-- Cada verificação lança exceção se o comportamento esperado não ocorrer.
\set ON_ERROR_STOP on

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

-- executa o comando como o usuário e exige que ele FALHE
CREATE FUNCTION ci.deve_falhar(uid uuid, cmd text, descricao text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE falhou boolean := false;
BEGIN
  PERFORM ci.entrar(uid);
  BEGIN
    EXECUTE cmd;
  EXCEPTION WHEN OTHERS THEN
    falhou := true;
  END;
  PERFORM ci.sair();
  IF NOT falhou THEN RAISE EXCEPTION 'FALHA: esperava erro em "%"', descricao; END IF;
END $$;

-- executa o comando como o usuário e devolve o número inteiro retornado
-- executa o comando como o dono do banco (sem RLS) e exige que FALHE: testa chaves e restrições
CREATE FUNCTION ci.deve_falhar_dono(cmd text, descricao text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE falhou boolean := false;
BEGIN
  BEGIN
    EXECUTE cmd;
  EXCEPTION WHEN OTHERS THEN
    falhou := true;
  END;
  IF NOT falhou THEN RAISE EXCEPTION 'FALHA: esperava erro em "%"', descricao; END IF;
END $$;

CREATE FUNCTION ci.contar(uid uuid, cmd text) RETURNS bigint LANGUAGE plpgsql AS $$
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
  demo   constant uuid := '11111111-1111-1111-1111-111111111111';
  filial constant uuid := '33333333-3333-3333-3333-333333333333';
  adm    constant uuid := 'a0000000-0000-0000-0000-000000000001';
  vend   constant uuid := 'a0000000-0000-0000-0000-000000000002';
  moto   constant uuid := 'a0000000-0000-0000-0000-000000000003';
  novo   constant uuid := 'a0000000-0000-0000-0000-000000000004';
  gest   constant uuid := 'a0000000-0000-0000-0000-000000000005';
  tenant_b uuid;
  cli_b uuid; dep_b uuid; ped_b uuid; t uuid;
  gar constant uuid := 'a0000000-0000-0000-0000-000000000006';
  coz constant uuid := 'a0000000-0000-0000-0000-000000000007';
  mesa1 uuid; mesa2 uuid; cat_r uuid; it_prato uuid; it_lata uuid; gr_ponto uuid; gr_add uuid;
  o_mal uuid; o_ponto uuid; o_bacon uuid; o_ovo uuid; o_queijo uuid;
  mesa3 uuid; c6 uuid; i5 uuid; i6 uuid; filial2 uuid; caixa2 uuid;
  c1 uuid; c2 uuid; c3 uuid; c4 uuid; c5 uuid; i1 uuid; i2 uuid; i3 uuid; i4 uuid; caixa_r uuid; n_r bigint;
  v_json jsonb; prod uuid; est uuid; dep_est uuid; dep_novo uuid; qtd_antes numeric; qtd_depois numeric;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (adm, 'adm@ci'), (vend, 'vend@ci'), (moto, 'moto@ci'), (novo, 'novo@ci'), (gest, 'gest@ci');

  -- 1. cadastro público nasce sem tenant e sem papel
  PERFORM ci.exige((SELECT tenant_id IS NULL FROM profiles WHERE id = novo), 'signup nasce sem tenant');
  PERFORM ci.exige(NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = novo), 'signup nasce sem papel');

  -- usuários do tenant de demonstração
  UPDATE profiles SET tenant_id = demo WHERE id IN (adm, vend, moto, gest);
  INSERT INTO user_roles (user_id, tenant_id, role) VALUES
    (adm, demo, 'administrador'), (vend, demo, 'vendedor'), (moto, demo, 'motorista'), (gest, demo, 'gestor');

  -- 2. anon não executa funções SECURITY DEFINER
  PERFORM ci.deve_falhar(NULL, $c$SELECT has_role('a0000000-0000-0000-0000-000000000001','administrador')$c$, 'anon executa has_role');
  PERFORM ci.deve_falhar(NULL, $c$SELECT recalcular_pedido(gen_random_uuid())$c$, 'anon executa recalcular_pedido');

  -- 3. banco_conta_padrao não é chamável por usuários
  PERFORM ci.deve_falhar(adm, $c$SELECT banco_conta_padrao('11111111-1111-1111-1111-111111111111', NULL)$c$, 'authenticated executa banco_conta_padrao');

  -- 4. recalcular_pedido não altera pedido de outro tenant
  INSERT INTO tenants (nome) VALUES ('B') RETURNING id INTO tenant_b;
  INSERT INTO clientes (tenant_id, nome) VALUES (tenant_b, 'c') RETURNING id INTO cli_b;
  INSERT INTO depositos (tenant_id, nome) VALUES (tenant_b, 'd') RETURNING id INTO dep_b;
  INSERT INTO pedidos (tenant_id, cliente_id, deposito_id, subtotal, total)
    VALUES (tenant_b, cli_b, dep_b, 999, 999) RETURNING id INTO ped_b;
  PERFORM ci.entrar(adm);
  PERFORM recalcular_pedido(ped_b);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT total FROM pedidos WHERE id = ped_b) = 999, 'recalcular_pedido ignora outro tenant');

  -- 5. quem não tem tenant não se atribui a um; onboarding cria espaço próprio uma única vez
  PERFORM ci.deve_falhar(novo, format('UPDATE profiles SET tenant_id = %L WHERE id = auth.uid()', demo), 'auto-atribuição de tenant');
  PERFORM ci.entrar(novo);
  t := onboarding_criar_espaco('Loja CI');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT tenant_id FROM profiles WHERE id = novo) = t, 'onboarding vincula o tenant novo');
  PERFORM ci.exige(EXISTS (SELECT 1 FROM user_roles WHERE user_id = novo AND role = 'administrador' AND tenant_id = t), 'onboarding concede administrador');
  PERFORM ci.exige(ci.contar(novo, format('SELECT count(*) FROM clientes WHERE tenant_id = %L', demo)) = 0, 'conta nova não vê o tenant de demonstração');
  PERFORM ci.deve_falhar(novo, $c$SELECT onboarding_criar_espaco('Outra')$c$, 'segundo onboarding');
  PERFORM ci.deve_falhar(adm, $c$SELECT onboarding_criar_espaco('Outra')$c$, 'onboarding de conta já vinculada');
  PERFORM ci.deve_falhar(novo, format('UPDATE profiles SET tenant_id = %L WHERE id = auth.uid()', demo), 'troca de tenant após onboarding');

  -- 6. has_role considera o tenant
  PERFORM ci.exige(has_role(adm, 'administrador'), 'administrador do tenant tem o papel');
  UPDATE profiles SET tenant_id = tenant_b WHERE id = gest;
  PERFORM ci.exige(NOT has_role(gest, 'gestor'), 'papel de outro tenant não vale');
  UPDATE profiles SET tenant_id = demo WHERE id = gest;
  PERFORM ci.exige(has_role(gest, 'gestor'), 'papel volta a valer no tenant certo');

  -- 7. administrador não dá papel a usuário sem vínculo com o tenant
  INSERT INTO auth.users (id, email) VALUES ('a0000000-0000-0000-0000-000000000009', 'solto@ci');
  PERFORM ci.deve_falhar(adm, format($c$INSERT INTO user_roles (user_id, tenant_id, role) VALUES ('a0000000-0000-0000-0000-000000000009', %L, 'vendedor')$c$, demo), 'papel para usuário sem tenant');

  -- 8. caixas: abre e fecha por RPC; escrita direta negada; motorista não lê
  PERFORM ci.entrar(vend);
  t := abrir_caixa(filial, 100);
  PERFORM ci.sair();
  PERFORM ci.exige(ci.contar(vend, 'SELECT count(*) FROM caixas') = 1, 'vendedor lê caixas do tenant');
  PERFORM ci.deve_falhar(vend, 'UPDATE caixas SET valor_abertura = 999999', 'update direto em caixas');
  PERFORM ci.deve_falhar(vend, format('INSERT INTO caixas (tenant_id, filial_id) VALUES (%L, %L)', demo, filial), 'insert direto em caixas');
  PERFORM ci.exige(ci.contar(moto, 'SELECT count(*) FROM caixas') = 0, 'motorista restrito não lê caixas');
  PERFORM ci.entrar(vend);
  PERFORM fechar_caixa(t, 100, 'ci');
  PERFORM ci.sair();

  -- 9. auditoria: só administrador/gestor leem; ninguém grava pelo cliente
  INSERT INTO auditoria (tenant_id, entidade, operacao) VALUES (demo, 'ci', 'x');
  PERFORM ci.exige(ci.contar(vend, 'SELECT count(*) FROM auditoria') = 0, 'vendedor não lê auditoria');
  PERFORM ci.exige(ci.contar(gest, 'SELECT count(*) FROM auditoria') = 1, 'gestor lê auditoria');
  PERFORM ci.deve_falhar(gest, format($c$INSERT INTO auditoria (tenant_id, entidade, operacao) VALUES (%L, 'x', 'y')$c$, demo), 'insert em auditoria');
  PERFORM ci.deve_falhar(gest, 'DELETE FROM auditoria', 'delete em auditoria');

  -- 10. escrita direta em movimentações de estoque negada
  PERFORM ci.deve_falhar(adm, format($c$INSERT INTO estoque_movimentacoes (tenant_id, produto_id, deposito_id, tipo, quantidade) VALUES (%L, gen_random_uuid(), gen_random_uuid(), 'entrada', 1)$c$, demo), 'insert direto em estoque_movimentacoes');

  -- 11. auditoria ligada: preço, desconto e custo registram quem alterou e o que mudou
  SELECT id INTO prod FROM produtos WHERE tenant_id = demo LIMIT 1;
  PERFORM ci.exige(prod IS NOT NULL, 'há produto de demonstração para testar');
  PERFORM ci.entrar(adm);
  UPDATE produtos SET preco_venda = coalesce(preco_venda, 0) + 1 WHERE id = prod;
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT count(*) FROM auditoria
                     WHERE entidade = 'produtos' AND entidade_id = prod AND usuario_id = adm
                       AND valor_novo ? 'preco_venda' AND valor_anterior ? 'preco_venda') = 1,
                   'alteração de preço de venda é auditada com o usuário');
  PERFORM ci.entrar(adm);
  UPDATE produtos SET descricao = descricao || ' ' WHERE id = prod;
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT count(*) FROM auditoria WHERE entidade = 'produtos' AND entidade_id = prod) = 1,
                   'campo fora da lista não gera auditoria');
  UPDATE pedidos SET desconto = 10 WHERE id = ped_b;
  PERFORM ci.exige(EXISTS (SELECT 1 FROM auditoria WHERE entidade = 'pedidos' AND entidade_id = ped_b
                            AND valor_novo ? 'desconto'), 'alteração de desconto do pedido é auditada');

  -- 12. estoque: saldo só muda pelas RPCs; custo médio e inserção com saldo são auditados
  SELECT id, deposito_id, produto_id INTO est, dep_est, prod FROM estoques WHERE tenant_id = demo LIMIT 1;
  PERFORM ci.exige(est IS NOT NULL, 'há estoque de demonstração para testar');
  PERFORM ci.deve_falhar(adm, format('UPDATE estoques SET quantidade = quantidade + 1000 WHERE id = %L', est), 'update direto de saldo em estoques');
  PERFORM ci.deve_falhar(adm, format('UPDATE estoques SET reservado = 0 WHERE id = %L', est), 'update direto de reserva em estoques');
  PERFORM ci.entrar(adm);
  UPDATE estoques SET custo_medio = coalesce(custo_medio, 0) + 1 WHERE id = est;
  PERFORM ci.sair();
  PERFORM ci.exige(EXISTS (SELECT 1 FROM auditoria WHERE entidade = 'estoques' AND entidade_id = est
                            AND valor_novo ? 'custo_medio'), 'alteração de custo médio é auditada');
  SELECT quantidade INTO qtd_antes FROM estoques WHERE id = est;
  PERFORM ci.entrar(adm);
  PERFORM registrar_movimentacao(prod, dep_est, 'entrada'::mov_tipo, 5, 'ci', 'ci');
  PERFORM ci.sair();
  SELECT quantidade INTO qtd_depois FROM estoques WHERE id = est;
  PERFORM ci.exige(qtd_depois = qtd_antes + 5, 'RPC de movimentação continua alterando o saldo');
  INSERT INTO depositos (tenant_id, nome) VALUES (demo, 'ci-estoque') RETURNING id INTO dep_novo;
  PERFORM ci.deve_falhar(adm, format('INSERT INTO estoques (tenant_id, produto_id, deposito_id, quantidade) VALUES (%L, %L, %L, 7)', demo, prod, dep_novo), 'insert direto de estoque com saldo');
  PERFORM ci.deve_falhar(adm, format('INSERT INTO estoques (tenant_id, produto_id, deposito_id, reservado) VALUES (%L, %L, %L, 7)', demo, prod, dep_novo), 'insert direto de estoque com reserva');
  PERFORM ci.entrar(adm);
  INSERT INTO estoques (tenant_id, produto_id, deposito_id, custo_medio) VALUES (demo, prod, dep_novo, 3);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT quantidade = 0 AND reservado = 0 FROM estoques WHERE produto_id = prod AND deposito_id = dep_novo),
                   'estoque criado pelo cliente nasce com saldo e reserva zerados');

  -- 13. webhooks: tabela e funções só para o service_role; idempotência, reprocessamento e fence
  PERFORM ci.deve_falhar(adm, 'SELECT count(*) FROM webhook_eventos', 'usuário lê webhook_eventos');
  PERFORM ci.deve_falhar(NULL, 'SELECT count(*) FROM webhook_eventos', 'anon lê webhook_eventos');
  PERFORM ci.deve_falhar(adm, $c$SELECT webhook_registrar('pix', 'x')$c$, 'usuário executa webhook_registrar');
  PERFORM ci.deve_falhar(NULL, $c$SELECT webhook_concluir('pix', 'x', 1, 'processado')$c$, 'anon executa webhook_concluir');

  EXECUTE 'SET ROLE service_role';
  v_json := webhook_registrar('pix', 'evt-1', NULL, '{"a":1}'::jsonb);
  PERFORM ci.exige(v_json ->> 'resultado' = 'novo' AND (v_json ->> 'tentativa')::int = 1, 'primeiro registro do evento é novo (tentativa 1)');
  v_json := webhook_registrar('pix', 'evt-1');
  PERFORM ci.exige(v_json ->> 'resultado' = 'duplicado', 'evento em processamento é duplicado');
  v_json := webhook_registrar('boleto', 'evt-1');
  PERFORM ci.exige(v_json ->> 'resultado' = 'novo', 'mesmo id em outro provedor é outro evento');
  PERFORM ci.exige(webhook_concluir('pix', 'evt-1', 1, 'erro', 'falhou'), 'conclusão com erro da tentativa vigente vale');
  v_json := webhook_registrar('pix', 'evt-1');
  PERFORM ci.exige(v_json ->> 'resultado' = 'reprocessar' AND (v_json ->> 'tentativa')::int = 2, 'evento com erro é reprocessado (tentativa 2)');
  PERFORM ci.exige(NOT webhook_concluir('pix', 'evt-1', 1, 'processado'), 'conclusão de tentativa antiga é descartada');
  PERFORM ci.exige(webhook_concluir('pix', 'evt-1', 2, 'processado'), 'conclusão da tentativa vigente vale');
  v_json := webhook_registrar('pix', 'evt-1');
  PERFORM ci.exige(v_json ->> 'resultado' = 'duplicado', 'evento processado não é reprocessado');
  EXECUTE 'RESET ROLE';
  PERFORM ci.exige((SELECT status FROM webhook_eventos WHERE provedor = 'pix' AND event_id = 'evt-1') = 'processado',
                   'tentativa antiga não sobrescreveu o resultado da nova');

  UPDATE webhook_eventos SET recebido_em = now() - interval '10 minutes'
   WHERE provedor = 'boleto' AND event_id = 'evt-1';
  EXECUTE 'SET ROLE service_role';
  v_json := webhook_registrar('boleto', 'evt-1');
  PERFORM ci.exige(v_json ->> 'resultado' = 'reprocessar', 'evento preso em recebido há mais de 5 minutos é reprocessado');
  v_json := webhook_registrar('boleto', 'evt-1');
  PERFORM ci.exige(v_json ->> 'resultado' = 'duplicado', 'a trava impede processamento em paralelo');
  PERFORM ci.exige(NOT webhook_concluir('boleto', 'evt-1', 1, 'erro', 'lento'), 'processamento antigo e lento não derruba o novo');
  EXECUTE 'RESET ROLE';
  PERFORM ci.exige((SELECT status FROM webhook_eventos WHERE provedor = 'boleto' AND event_id = 'evt-1') = 'recebido',
                   'evento da tentativa nova segue em recebido');

  -- 14. restaurante: cardápio, salão, cozinha e fechamento de conta
  INSERT INTO auth.users (id, email) VALUES (gar, 'garcom@ci'), (coz, 'cozinha@ci');
  UPDATE profiles SET tenant_id = demo WHERE id IN (gar, coz);
  INSERT INTO user_roles (user_id, tenant_id, role) VALUES (gar, demo, 'garcom'), (coz, demo, 'cozinha');

  PERFORM ci.deve_falhar(gar, format($c$INSERT INTO cardapio_categorias (tenant_id, nome) VALUES (%L, 'x')$c$, demo), 'garçom cadastra cardápio');
  PERFORM ci.deve_falhar(gar, format($c$INSERT INTO mesas (tenant_id, numero) VALUES (%L, '99')$c$, demo), 'garçom cadastra mesa');
  PERFORM ci.entrar(adm);
  INSERT INTO cardapio_categorias (tenant_id, nome) VALUES (demo, 'Pratos') RETURNING id INTO cat_r;
  INSERT INTO cardapio_itens (tenant_id, categoria_id, nome, preco, estacao)
    VALUES (demo, cat_r, 'Hambúrguer', 40, 'cozinha') RETURNING id INTO it_prato;
  INSERT INTO cardapio_itens (tenant_id, categoria_id, nome, preco, estacao)
    VALUES (demo, cat_r, 'Refrigerante lata', 8, 'nenhuma') RETURNING id INTO it_lata;
  INSERT INTO cardapio_grupos (tenant_id, item_id, nome, obrigatorio, max_escolhas)
    VALUES (demo, it_prato, 'Ponto da carne', true, 1) RETURNING id INTO gr_ponto;
  INSERT INTO cardapio_grupos (tenant_id, item_id, nome, obrigatorio, max_escolhas)
    VALUES (demo, it_prato, 'Adicionais', false, 2) RETURNING id INTO gr_add;
  INSERT INTO cardapio_opcoes (tenant_id, grupo_id, nome, preco_adicional) VALUES (demo, gr_ponto, 'Mal passado', 0) RETURNING id INTO o_mal;
  INSERT INTO cardapio_opcoes (tenant_id, grupo_id, nome, preco_adicional) VALUES (demo, gr_ponto, 'Ao ponto', 0) RETURNING id INTO o_ponto;
  INSERT INTO cardapio_opcoes (tenant_id, grupo_id, nome, preco_adicional) VALUES (demo, gr_add, 'Bacon', 5) RETURNING id INTO o_bacon;
  INSERT INTO cardapio_opcoes (tenant_id, grupo_id, nome, preco_adicional) VALUES (demo, gr_add, 'Ovo', 3) RETURNING id INTO o_ovo;
  INSERT INTO cardapio_opcoes (tenant_id, grupo_id, nome, preco_adicional) VALUES (demo, gr_add, 'Queijo extra', 4) RETURNING id INTO o_queijo;
  INSERT INTO mesas (tenant_id, numero, capacidade) VALUES (demo, '1', 4) RETURNING id INTO mesa1;
  INSERT INTO mesas (tenant_id, numero, capacidade) VALUES (demo, '2', 4) RETURNING id INTO mesa2;
  PERFORM ci.sair();
  PERFORM ci.deve_falhar(adm, format($c$INSERT INTO mesas (tenant_id, numero) VALUES (%L, '1')$c$, demo), 'mesa com número repetido');
  PERFORM ci.exige(ci.contar(gar, 'SELECT count(*) FROM cardapio_itens') = 2, 'garçom lê o cardápio');

  -- abrir comanda: só quem opera o salão; uma comanda aberta por mesa
  PERFORM ci.deve_falhar(vend, format($c$SELECT restaurante_abrir_comanda(%L, 2)$c$, mesa1), 'vendedor abre comanda');
  PERFORM ci.deve_falhar(coz, format($c$SELECT restaurante_abrir_comanda(%L, 2)$c$, mesa1), 'cozinha abre comanda');
  PERFORM ci.deve_falhar(NULL, $c$SELECT restaurante_abrir_comanda(NULL, 2)$c$, 'anon abre comanda');
  PERFORM ci.entrar(gar);
  c1 := restaurante_abrir_comanda(mesa1, 2, 'Cliente CI', 10, 5);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT numero FROM comandas WHERE id = c1) = 1, 'primeira comanda da empresa tem o número 1');
  PERFORM ci.deve_falhar(gar, format($c$SELECT restaurante_abrir_comanda(%L, 2)$c$, mesa1), 'segunda comanda na mesma mesa');

  -- lançar itens: opções obrigatórias, limite de escolhas, opção alheia, quantidade
  PERFORM ci.deve_falhar(gar, format($c$SELECT restaurante_lancar_item(%L, %L, 1)$c$, c1, it_prato), 'item sem a opção obrigatória');
  PERFORM ci.deve_falhar(gar, format($c$SELECT restaurante_lancar_item(%L, %L, 1, ARRAY[%L, %L, %L, %L]::uuid[])$c$, c1, it_prato, o_ponto, o_bacon, o_ovo, o_queijo), 'mais escolhas que o limite do grupo');
  PERFORM ci.deve_falhar(gar, format($c$SELECT restaurante_lancar_item(%L, %L, 1, ARRAY[%L, %L]::uuid[])$c$, c1, it_prato, o_mal, o_ponto), 'duas opções em grupo de escolha única');
  PERFORM ci.deve_falhar(gar, format($c$SELECT restaurante_lancar_item(%L, %L, 1, ARRAY[gen_random_uuid()])$c$, c1, it_prato), 'opção que não existe');
  PERFORM ci.deve_falhar(gar, format($c$SELECT restaurante_lancar_item(%L, %L, 1, ARRAY[%L, %L]::uuid[])$c$, c1, it_lata, o_ponto, o_bacon), 'opção de outro item');
  PERFORM ci.deve_falhar(gar, format($c$SELECT restaurante_lancar_item(%L, %L, 0)$c$, c1, it_lata), 'quantidade zero');
  PERFORM ci.entrar(gar);
  i1 := restaurante_lancar_item(c1, it_prato, 2, ARRAY[o_ponto, o_bacon, o_ovo]::uuid[], 'sem cebola');
  i2 := restaurante_lancar_item(c1, it_lata, 1);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT preco_unitario = 48 AND total = 96 AND estacao = 'cozinha' AND situacao = 'pendente'
                      AND jsonb_array_length(opcoes) = 3 FROM comanda_itens WHERE id = i1),
                   'preço do item soma os adicionais e guarda a cópia das opções');
  PERFORM ci.deve_falhar(gar, format($c$SELECT restaurante_fechar_comanda(%L, '[]'::jsonb)$c$, c1), 'fechar com itens ainda não enviados');

  -- cozinha
  PERFORM ci.entrar(gar);
  n_r := restaurante_enviar_cozinha(c1);
  PERFORM ci.sair();
  PERFORM ci.exige(n_r = 2, 'envio à cozinha marca os dois itens');
  PERFORM ci.exige((SELECT situacao FROM comanda_itens WHERE id = i1) = 'enviado'
               AND (SELECT situacao FROM comanda_itens WHERE id = i2) = 'entregue',
                   'item sem estação (lata) já sai entregue');
  PERFORM ci.exige(ci.contar(gar, format($c$SELECT restaurante_enviar_cozinha(%L)$c$, c1)) = 0, 'reenvio não repete itens');
  PERFORM ci.deve_falhar(gar, format($c$SELECT restaurante_atualizar_item(%L, 'preparando')$c$, i1), 'garçom marca preparo');
  PERFORM ci.entrar(coz);
  PERFORM restaurante_atualizar_item(i1, 'preparando');
  PERFORM ci.sair();
  PERFORM ci.deve_falhar(coz, format($c$SELECT restaurante_atualizar_item(%L, 'entregue')$c$, i1), 'pular etapas do preparo');
  PERFORM ci.entrar(coz);
  PERFORM restaurante_atualizar_item(i1, 'pronto');
  PERFORM ci.sair();
  PERFORM ci.deve_falhar(coz, format($c$SELECT restaurante_atualizar_item(%L, 'preparando')$c$, i1), 'voltar etapa do preparo');
  PERFORM ci.entrar(gar);
  PERFORM restaurante_atualizar_item(i1, 'entregue');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT situacao FROM comanda_itens WHERE id = i1) = 'entregue', 'garçom entrega o item pronto');

  -- cancelamento: pendente é do garçom; depois de enviado, só a gestão e com motivo
  PERFORM ci.entrar(gar);
  i3 := restaurante_lancar_item(c1, it_lata, 1);
  PERFORM restaurante_cancelar_item(i3);
  i4 := restaurante_lancar_item(c1, it_prato, 1, ARRAY[o_mal]::uuid[]);
  PERFORM restaurante_enviar_cozinha(c1);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT situacao FROM comanda_itens WHERE id = i3) = 'cancelado', 'garçom cancela item ainda não enviado');
  PERFORM ci.deve_falhar(gar, format($c$SELECT restaurante_cancelar_item(%L, 'cliente desistiu')$c$, i4), 'garçom cancela item já enviado');
  PERFORM ci.deve_falhar(gest, format($c$SELECT restaurante_cancelar_item(%L)$c$, i4), 'cancelar item enviado sem motivo');
  PERFORM ci.entrar(gest);
  PERFORM restaurante_cancelar_item(i4, 'cliente desistiu');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT cancelado_por = gest AND motivo_cancelamento = 'cliente desistiu' FROM comanda_itens WHERE id = i4),
                   'gestão cancela item enviado e o motivo fica registrado');

  -- fechamento: 96 + 8 = 104; couvert 2 x 5 = 10; serviço 10% = 10,40; total 124,40
  PERFORM ci.entrar(adm);
  caixa_r := abrir_caixa(filial, 0);
  PERFORM ci.sair();
  PERFORM ci.deve_falhar(gar, format($c$SELECT restaurante_fechar_comanda(%L, '[{"forma":"pix","valor":100}]'::jsonb, %L)$c$, c1, caixa_r), 'pagamentos que não fecham a conta');
  PERFORM ci.deve_falhar(gar, format($c$SELECT restaurante_fechar_comanda(%L, '[{"forma":"pix","valor":124.40}]'::jsonb)$c$, c1), 'fechar sem caixa');
  PERFORM ci.deve_falhar(gar, format($c$SELECT restaurante_fechar_comanda(%L, '[{"forma":"crediario","valor":124.40}]'::jsonb, %L)$c$, c1, caixa_r), 'crediário na comanda');
  PERFORM ci.deve_falhar(gar, format($c$SELECT restaurante_fechar_comanda(%L, '[{"forma":"pix","valor":114.40}]'::jsonb, %L, 10)$c$, c1, caixa_r), 'desconto dado pelo garçom');
  PERFORM ci.deve_falhar(coz, format($c$SELECT restaurante_fechar_comanda(%L, '[]'::jsonb)$c$, c1), 'cozinha fecha conta');
  PERFORM ci.entrar(gar);
  v_json := restaurante_fechar_comanda(c1,
    '[{"forma":"pix","valor":70,"pagante":"Ana"},{"forma":"dinheiro","valor":54.40,"pagante":"Bia"}]'::jsonb, caixa_r);
  PERFORM ci.sair();
  PERFORM ci.exige((v_json ->> 'subtotal')::numeric = 104 AND (v_json ->> 'couvert')::numeric = 10
                   AND (v_json ->> 'taxa_servico')::numeric = 10.40 AND (v_json ->> 'total')::numeric = 124.40,
                   'fechamento calcula subtotal, couvert, serviço e total');
  PERFORM ci.exige((SELECT situacao = 'fechada' AND total = 124.40 AND caixa_id = caixa_r FROM comandas WHERE id = c1), 'comanda fica fechada');
  PERFORM ci.exige((SELECT count(*) = 2 AND sum(valor) = 124.40 FROM comanda_pagamentos WHERE comanda_id = c1), 'pagamentos divididos ficam registrados');
  PERFORM ci.exige((SELECT count(*) = 2 AND sum(valor) = 124.40 FROM caixa_movimentos WHERE caixa_id = caixa_r AND tipo = 'venda'),
                   'cada pagamento é lançado no caixa');
  PERFORM ci.deve_falhar(gar, format($c$SELECT restaurante_fechar_comanda(%L, '[]'::jsonb, %L)$c$, c1, caixa_r), 'fechar comanda já fechada');
  PERFORM ci.deve_falhar(gar, format($c$SELECT restaurante_lancar_item(%L, %L, 1)$c$, c1, it_lata), 'lançar item em comanda fechada');

  -- desconto pela gestão, sem couvert e sem serviço
  PERFORM ci.entrar(gar);
  c2 := restaurante_abrir_comanda(mesa2, NULL, NULL, 10, 0);
  PERFORM restaurante_lancar_item(c2, it_lata, 1);
  PERFORM restaurante_enviar_cozinha(c2);
  PERFORM ci.sair();
  PERFORM ci.entrar(gest);
  v_json := restaurante_fechar_comanda(c2, '[{"forma":"dinheiro","valor":8.00}]'::jsonb, caixa_r, 0.80);
  PERFORM ci.sair();
  PERFORM ci.exige((v_json ->> 'taxa_servico')::numeric = 0.80 AND (v_json ->> 'total')::numeric = 8.00,
                   'gestão fecha com desconto');

  -- cancelar comanda e transferir de mesa
  PERFORM ci.entrar(gar);
  c3 := restaurante_abrir_comanda(mesa1, 2);
  PERFORM restaurante_lancar_item(c3, it_lata, 1);
  PERFORM ci.sair();
  PERFORM ci.deve_falhar(gar, format($c$SELECT restaurante_cancelar_comanda(%L, 'teste')$c$, c3), 'garçom cancela comanda');
  PERFORM ci.entrar(gest);
  PERFORM restaurante_cancelar_comanda(c3, 'cliente foi embora');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT situacao = 'cancelada' FROM comandas WHERE id = c3)
               AND NOT EXISTS (SELECT 1 FROM comanda_itens WHERE comanda_id = c3 AND situacao <> 'cancelado'),
                   'cancelar comanda cancela os itens');
  PERFORM ci.entrar(gar);
  c4 := restaurante_abrir_comanda(mesa1, 2);
  c5 := restaurante_abrir_comanda(NULL, 1, 'Balcão');
  PERFORM restaurante_transferir_mesa(c4, mesa2);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT mesa_id FROM comandas WHERE id = c4) = mesa2, 'comanda muda de mesa');
  PERFORM ci.deve_falhar(gar, format($c$SELECT restaurante_transferir_mesa(%L, %L)$c$, c5, mesa2), 'transferir para mesa ocupada');

  -- isolamento e permissões de leitura
  PERFORM ci.exige(ci.contar(novo, 'SELECT count(*) FROM comandas') = 0, 'outra empresa não vê comandas');
  PERFORM ci.exige(ci.contar(novo, 'SELECT count(*) FROM cardapio_itens') = 0, 'outra empresa não vê o cardápio');
  PERFORM ci.deve_falhar(novo, format($c$SELECT restaurante_lancar_item(%L, %L, 1)$c$, c4, it_lata), 'lançar em comanda de outra empresa');
  PERFORM ci.deve_falhar(novo, format($c$SELECT restaurante_atualizar_item(%L, 'preparando')$c$, i1), 'mexer em item de outra empresa');
  PERFORM ci.exige(ci.contar(vend, 'SELECT count(*) FROM comandas') = 0, 'vendedor não lê comandas');
  PERFORM ci.exige(ci.contar(moto, 'SELECT count(*) FROM comandas') = 0, 'motorista não lê comandas');
  PERFORM ci.exige(ci.contar(coz, 'SELECT count(*) FROM comanda_itens') > 0, 'cozinha lê os itens');
  PERFORM ci.exige(ci.contar(coz, 'SELECT count(*) FROM comanda_pagamentos') = 0, 'cozinha não lê pagamentos');
  PERFORM ci.exige(ci.contar(adm, 'SELECT count(*) FROM comanda_pagamentos') = 3, 'gestão lê os pagamentos');

  -- a escrita direta nas comandas é negada
  PERFORM ci.deve_falhar(gar, format('UPDATE comandas SET total = 0 WHERE id = %L', c4), 'update direto em comandas');
  PERFORM ci.deve_falhar(adm, format('UPDATE comanda_itens SET total = 0 WHERE id = %L', i1), 'update direto em comanda_itens');
  PERFORM ci.deve_falhar(adm, format($c$INSERT INTO comanda_pagamentos (tenant_id, comanda_id, forma, valor) VALUES (%L, %L, 'pix', 1)$c$, demo, c4), 'insert direto em comanda_pagamentos');
  PERFORM ci.deve_falhar(adm, format('DELETE FROM comandas WHERE id = %L', c4), 'delete direto em comandas');

  -- alteração de preço do cardápio é auditada
  PERFORM ci.entrar(gest);
  UPDATE cardapio_itens SET preco = 42 WHERE id = it_prato;
  PERFORM ci.sair();
  PERFORM ci.exige(EXISTS (SELECT 1 FROM auditoria WHERE entidade = 'cardapio_itens' AND entidade_id = it_prato
                            AND usuario_id = gest AND valor_novo ? 'preco'), 'preço do cardápio é auditado');
  PERFORM ci.exige((SELECT preco_unitario FROM comanda_itens WHERE id = i1) = 48, 'mudar o preço não altera item já lançado');
  PERFORM ci.exige((SELECT count(DISTINCT numero) = count(*) AND min(numero) = 1 AND max(numero) = count(*)
                      FROM comandas WHERE tenant_id = demo), 'numeração das comandas é sequencial e sem repetição');

  -- cadastros de uma empresa não apontam para os de outra (chaves compostas com a empresa)
  PERFORM ci.deve_falhar_dono(format($c$INSERT INTO cardapio_grupos (tenant_id, item_id, nome) VALUES (%L, %L, 'x')$c$, tenant_b, it_prato), 'grupo de uma empresa em item de outra');
  PERFORM ci.deve_falhar_dono(format($c$INSERT INTO cardapio_opcoes (tenant_id, grupo_id, nome) VALUES (%L, %L, 'x')$c$, tenant_b, gr_ponto), 'opção de uma empresa em grupo de outra');
  PERFORM ci.deve_falhar_dono(format($c$INSERT INTO cardapio_itens (tenant_id, categoria_id, nome, preco) VALUES (%L, %L, 'x', 1)$c$, tenant_b, cat_r), 'item de uma empresa em categoria de outra');
  PERFORM ci.deve_falhar_dono(format($c$INSERT INTO mesas (tenant_id, filial_id, numero) VALUES (%L, %L, 'x')$c$, tenant_b, filial), 'mesa de uma empresa em filial de outra');
  PERFORM ci.deve_falhar_dono(format($c$INSERT INTO comanda_itens (tenant_id, comanda_id, cardapio_item_id, nome, estacao, quantidade, preco_unitario, total) VALUES (%L, %L, %L, 'x', 'cozinha', 1, 1, 1)$c$, tenant_b, c4, it_lata), 'item de comanda de uma empresa em comanda de outra');

  -- fechar a conta: nada pode ficar em preparo, e o caixa precisa ser da filial da comanda
  PERFORM ci.entrar(adm);
  INSERT INTO mesas (tenant_id, filial_id, numero, capacidade) VALUES (demo, filial, '3', 4) RETURNING id INTO mesa3;
  INSERT INTO filiais (tenant_id, empresa_id, nome) VALUES (demo, '22222222-2222-2222-2222-222222222222', 'Filial CI 2') RETURNING id INTO filial2;
  caixa2 := abrir_caixa(filial2, 0);
  PERFORM ci.sair();
  PERFORM ci.entrar(gar);
  c6 := restaurante_abrir_comanda(mesa3);
  i5 := restaurante_lancar_item(c6, it_prato, 1, ARRAY[o_ponto]::uuid[]);
  i6 := restaurante_lancar_item(c6, it_lata, 1);
  PERFORM restaurante_enviar_cozinha(c6);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT filial_id FROM comandas WHERE id = c6) = filial, 'comanda da mesa herda a filial da mesa');
  PERFORM ci.deve_falhar(gar, format($c$SELECT restaurante_fechar_comanda(%L, '[{"forma":"pix","valor":55}]'::jsonb, %L)$c$, c6, caixa_r), 'fechar com item ainda na cozinha');
  PERFORM ci.deve_falhar(gar, format($c$SELECT restaurante_atualizar_item(%L, 'entregue')$c$, i5), 'garçom entrega item que ainda não ficou pronto');
  PERFORM ci.entrar(gest);
  PERFORM restaurante_atualizar_item(i5, 'entregue');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT situacao FROM comanda_itens WHERE id = i5) = 'entregue', 'gestão resolve item esquecido na cozinha');
  PERFORM ci.deve_falhar(gar, format($c$SELECT restaurante_fechar_comanda(%L, '[{"forma":"pix","valor":55}]'::jsonb, %L)$c$, c6, caixa2), 'receber em caixa de outra filial');
  PERFORM ci.entrar(gar);
  v_json := restaurante_fechar_comanda(c6, '[{"forma":"pix","valor":55}]'::jsonb, caixa_r);
  PERFORM ci.sair();
  PERFORM ci.exige((v_json ->> 'subtotal')::numeric = 50 AND (v_json ->> 'total')::numeric = 55,
                   'conta fecha no caixa da própria filial (50 + 10% de serviço)');
END $$;
