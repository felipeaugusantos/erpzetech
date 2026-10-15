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
  cxa constant uuid := 'a0000000-0000-0000-0000-0000000000a1';
  mesa1 uuid; mesa2 uuid; cat_r uuid; it_prato uuid; it_lata uuid; gr_ponto uuid; gr_add uuid;
  o_mal uuid; o_ponto uuid; o_bacon uuid; o_ovo uuid; o_queijo uuid;
  ped_t uuid; ped_t2 uuid; aut_t uuid; est_antes numeric; est_depois numeric; tef_cfg uuid; caixa_t uuid;
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
  PERFORM ci.deve_falhar(vend, format($c$SELECT abrir_caixa(%L, 100)$c$, filial), 'vendedor abre caixa');
  PERFORM ci.entrar(adm);
  t := abrir_caixa(filial, 100);
  PERFORM ci.sair();
  PERFORM ci.exige(ci.contar(vend, 'SELECT count(*) FROM caixas') = 1, 'vendedor lê caixas do tenant');
  PERFORM ci.deve_falhar(vend, 'UPDATE caixas SET valor_abertura = 999999', 'update direto em caixas');
  PERFORM ci.deve_falhar(vend, format('INSERT INTO caixas (tenant_id, filial_id) VALUES (%L, %L)', demo, filial), 'insert direto em caixas');
  PERFORM ci.exige(ci.contar(moto, 'SELECT count(*) FROM caixas') = 0, 'motorista restrito não lê caixas');
  PERFORM ci.deve_falhar(vend, format($c$SELECT fechar_caixa(%L, 100, 'ci')$c$, t), 'vendedor fecha caixa');
  PERFORM ci.entrar(adm);
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
  INSERT INTO auth.users (id, email) VALUES (cxa, 'caixa-restaurante@ci');
  UPDATE profiles SET tenant_id = demo WHERE id = cxa;
  INSERT INTO user_roles (user_id, tenant_id, role) VALUES (cxa, demo, 'caixa');

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
  PERFORM ci.deve_falhar(coz, format($c$SELECT restaurante_atualizar_item(%L, 'entregue')$c$, i1), 'cozinha marca o item como entregue');
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
  PERFORM ci.deve_falhar(cxa, format($c$SELECT restaurante_fechar_comanda(%L, '[{"forma":"boleto","valor":124.40}]'::jsonb, %L)$c$, c1, caixa_r), 'boleto na comanda');
  PERFORM ci.deve_falhar(cxa, format($c$SELECT restaurante_fechar_comanda(%L, '[{"forma":"pix","valor":114.40}]'::jsonb, %L, 10)$c$, c1, caixa_r), 'desconto dado pelo caixa');
  PERFORM ci.deve_falhar(gar, format($c$SELECT restaurante_fechar_comanda(%L, '[{"forma":"pix","valor":124.40}]'::jsonb, %L)$c$, c1, caixa_r), 'garçom recebe a conta (só gestão e caixa)');
  PERFORM ci.deve_falhar(coz, format($c$SELECT restaurante_fechar_comanda(%L, '[]'::jsonb)$c$, c1), 'cozinha fecha conta');
  PERFORM ci.entrar(cxa);
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
  PERFORM ci.entrar(cxa);
  v_json := restaurante_fechar_comanda(c6, '[{"forma":"pix","valor":55}]'::jsonb, caixa_r);
  PERFORM ci.sair();
  PERFORM ci.exige((v_json ->> 'subtotal')::numeric = 50 AND (v_json ->> 'total')::numeric = 55,
                   'conta fecha no caixa da própria filial (50 + 10% de serviço)');

  -- 15. maquininha simulada: venda de cartão de ponta a ponta, com NSU e autorização de exemplo
  PERFORM ci.entrar(adm);
  INSERT INTO tef_config (tenant_id, filial_id, credenciadora, modo) VALUES (demo, filial, 'stone', 'simulado') RETURNING id INTO tef_cfg;
  PERFORM ci.sair();
  PERFORM ci.exige(tef_cfg IS NOT NULL, 'configuração da maquininha aceita o modo simulado');
  PERFORM ci.deve_falhar_dono(format($c$UPDATE tef_config SET modo = 'inexistente' WHERE id = %L$c$, tef_cfg), 'modo de maquininha inválido');

  SELECT quantidade INTO est_antes FROM estoques WHERE produto_id = prod AND deposito_id = dep_est;
  PERFORM ci.entrar(adm);
  ped_t := frente_venda(dep_est, jsonb_build_array(jsonb_build_object('produto_id', prod, 'quantidade', 2, 'preco_unitario', 100)),
                        'cartao_credito', NULL, 0, 3);
  PERFORM frente_registrar_tef(ped_t, 'simulado', 'SIM-000123', 'AUT456', 'Visa');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT tef_credenciadora = 'simulado' AND tef_nsu = 'SIM-000123' AND tef_autorizacao = 'AUT456'
                      AND tef_bandeira = 'Visa' AND forma_pagamento = 'cartao_credito' AND total = 200
                      FROM pedidos WHERE id = ped_t), 'venda no cartão guarda credenciadora, NSU, autorização e bandeira');
  PERFORM ci.exige((SELECT status = 'aprovada' AND valor = 200 AND nsu = 'SIM-000123' AND credenciadora = 'simulado'
                      FROM tef_transacoes WHERE pedido_id = ped_t), 'transação aprovada fica registrada com o valor da venda');
  PERFORM ci.exige((SELECT count(*) = 1 AND sum(valor) = 200 FROM caixa_movimentos
                     WHERE pedido_id = ped_t AND tipo = 'venda' AND forma_pagamento = 'cartao_credito'),
                   'venda no cartão entra no caixa');
  SELECT quantidade INTO est_depois FROM estoques WHERE produto_id = prod AND deposito_id = dep_est;
  PERFORM ci.exige(est_depois = est_antes - 2, 'venda no cartão baixa o estoque');

  -- recusa da maquininha: fica registrada sem venda
  PERFORM ci.entrar(adm);
  PERFORM tef_registrar_negada(filial, 'simulado', 'cartao_credito', 50, 1, 'Mastercard', 'Simulação: cartão recusado');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT count(*) = 1 FROM tef_transacoes WHERE status = 'negada' AND credenciadora = 'simulado'
                      AND pedido_id IS NULL AND valor = 50 AND motivo = 'Simulação: cartão recusado'),
                   'recusa da maquininha fica registrada sem criar venda');

  -- só a empresa dona da venda registra o TEF; ninguém grava direto na tabela de transações
  PERFORM ci.deve_falhar(novo, format($c$SELECT frente_registrar_tef(%L, 'simulado', 'SIM-1', 'A', 'Visa')$c$, ped_t), 'registrar TEF em venda de outra empresa');
  PERFORM ci.deve_falhar(adm, format($c$INSERT INTO tef_transacoes (tenant_id, valor, status) VALUES (%L, 1, 'aprovada')$c$, demo), 'gravar transação TEF direto');
  PERFORM ci.deve_falhar(adm, format($c$UPDATE tef_transacoes SET status = 'aprovada' WHERE pedido_id = %L$c$, ped_t), 'alterar transação TEF direto');

  -- cancelamento da venda com a senha do gestor: devolve estoque, estorna o caixa e marca o TEF como cancelado
  INSERT INTO gestor_autorizacoes (tenant_id, gestor_id, operador_id, acao) VALUES (demo, gest, adm, 'cancelar_venda') RETURNING id INTO aut_t;
  PERFORM ci.entrar(adm);
  PERFORM frente_cancelar_venda(ped_t, aut_t, 'Teste da maquininha simulada');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT situacao = 'cancelado' FROM pedidos WHERE id = ped_t), 'venda cancelada');
  PERFORM ci.exige((SELECT status = 'cancelada' FROM tef_transacoes WHERE pedido_id = ped_t), 'cancelar a venda marca a transação TEF como cancelada');
  SELECT quantidade INTO est_depois FROM estoques WHERE produto_id = prod AND deposito_id = dep_est;
  PERFORM ci.exige(est_depois = est_antes, 'cancelar a venda devolve o estoque');
  PERFORM ci.exige((SELECT count(*) = 1 AND sum(valor) = 200 FROM caixa_movimentos
                     WHERE pedido_id = ped_t AND tipo = 'saida' AND forma_pagamento = 'cartao_credito'),
                   'cancelar a venda estorna o caixa');
  PERFORM ci.deve_falhar(adm, format($c$SELECT frente_cancelar_venda(%L, %L, 'de novo')$c$, ped_t, aut_t), 'cancelar de novo a mesma venda');
END $$;

-- 16. isolamento do salão (garçom e cozinha)
DO $$
DECLARE
  adm    constant uuid := 'a0000000-0000-0000-0000-000000000001';
  vend   constant uuid := 'a0000000-0000-0000-0000-000000000002';
  gar    constant uuid := 'a0000000-0000-0000-0000-000000000006';
  coz    constant uuid := 'a0000000-0000-0000-0000-000000000007';
  gar_cx constant uuid := 'a0000000-0000-0000-0000-000000000008';
  demo   constant uuid := '11111111-1111-1111-1111-111111111111';
  liberadas constant text[] := ARRAY['profiles', 'user_roles', 'empresas', 'filiais', 'tenants',
    'cardapio_categorias', 'cardapio_itens', 'cardapio_grupos', 'cardapio_opcoes',
    'mesas', 'comandas', 'comanda_itens', 'comanda_pagamentos', 'restaurante_zonas_entrega'];
  sem_trava constant text[] := ARRAY['current_tenant_id', 'current_motorista_id', 'has_role', 'eh_motorista_restrito',
    'eh_saas_operador', 'eh_salao_restrito', 'onboarding_criar_espaco', 'filial_irrestrita', 'pode_filial',
    -- só grava a posição do próprio motorista; quem não é motorista não tem linha para alterar
    'motorista_enviar_posicao'];
  faltando text;
BEGIN
  -- estrutura: tabela ou função nova sem a proteção reprova o CI
  SELECT string_agg(c.relname, ', ') INTO faltando
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity AND NOT (c.relname = ANY (liberadas))
     AND NOT EXISTS (SELECT 1 FROM pg_policies pp WHERE pp.schemaname = 'public' AND pp.tablename = c.relname
                        AND pp.permissive = 'RESTRICTIVE' AND pp.qual LIKE '%eh_salao_restrito%');
  PERFORM ci.exige(faltando IS NULL, 'toda tabela com RLS tem política restritiva do salão (eh_salao_restrito) ou está na lista liberada' || coalesce(' (faltam: ' || faltando || ')', ''));

  SELECT string_agg(p.proname, ', ') INTO faltando
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prosecdef AND pg_get_function_result(p.oid) <> 'trigger'
     AND has_function_privilege('authenticated', p.oid, 'execute')
     AND p.proname NOT LIKE 'restaurante\_%' AND NOT (p.proname = ANY (sem_trava))
     AND pg_get_functiondef(p.oid) NOT LIKE '%exige_nao_salao%';
  PERFORM ci.exige(faltando IS NULL, 'toda função chamável tem a trava do salão ou está na lista liberada' || coalesce(' (faltam: ' || faltando || ')', ''));

  -- comportamento
  PERFORM ci.exige(ci.contar(adm, 'SELECT count(*) FROM produtos') > 0, 'gestão enxerga os produtos');
  PERFORM ci.exige(ci.contar(gar, 'SELECT count(*) FROM produtos') = 0, 'garçom não lê produtos');
  PERFORM ci.exige(ci.contar(coz, 'SELECT count(*) FROM produtos') = 0, 'cozinha não lê produtos');
  PERFORM ci.exige(ci.contar(adm, 'SELECT count(*) FROM clientes') > 0, 'gestão enxerga os clientes');
  PERFORM ci.exige(ci.contar(gar, 'SELECT count(*) FROM clientes') = 0, 'garçom não lê clientes');
  PERFORM ci.exige(ci.contar(gar, 'SELECT count(*) FROM pedidos') = 0, 'garçom não lê pedidos');
  PERFORM ci.exige(ci.contar(coz, 'SELECT count(*) FROM contas_receber') = 0, 'cozinha não lê contas a receber');
  PERFORM ci.exige(ci.contar(gar, 'SELECT count(*) FROM caixa_movimentos') = 0, 'garçom não lê o caixa');
  PERFORM ci.exige(ci.contar(gar, 'SELECT count(*) FROM tef_transacoes') = 0, 'garçom não lê transações de cartão');
  PERFORM ci.exige(ci.contar(gar, 'SELECT count(*) FROM cardapio_itens') > 0, 'garçom segue lendo o cardápio');
  PERFORM ci.exige(ci.contar(gar, 'SELECT count(*) FROM mesas') > 0, 'garçom segue lendo as mesas');
  PERFORM ci.exige(ci.contar(gar, 'SELECT count(*) FROM profiles WHERE id = auth.uid()') = 1, 'garçom lê o próprio perfil');
  PERFORM ci.exige(ci.contar(gar, 'SELECT count(*) FROM filiais') > 0, 'garçom lê as filiais (sessão)');

  PERFORM ci.deve_falhar(gar, format($c$INSERT INTO produtos (tenant_id, descricao) VALUES (%L, 'x')$c$, demo), 'garçom cria produto');
  PERFORM ci.exige(ci.contar(coz, 'WITH u AS (UPDATE produtos SET preco_venda = 1 RETURNING 1) SELECT count(*) FROM u') = 0, 'cozinha não altera preço (nenhuma linha)');
  PERFORM ci.exige(ci.contar(coz, 'WITH d AS (DELETE FROM clientes RETURNING 1) SELECT count(*) FROM d') = 0, 'cozinha não apaga clientes (nenhuma linha)');

  -- funções de venda, caixa e relatórios
  PERFORM ci.deve_falhar(gar, 'SELECT frente_caixa_atual()', 'garçom usa o caixa (função SQL)');
  PERFORM ci.deve_falhar(gar, 'SELECT relatorio_fechamento_operador(current_date, current_date)', 'garçom lê relatório de caixa (função SQL)');
  PERFORM ci.deve_falhar(gar, format($c$SELECT frente_venda(%L, '[]'::jsonb, 'dinheiro')$c$, gen_random_uuid()), 'garçom vende no PDV');
  PERFORM ci.deve_falhar(coz, format($c$SELECT baixar_conta('receber', %L, 10, 'dinheiro', current_date)$c$, gen_random_uuid()), 'cozinha baixa conta');
  -- a falha precisa ser a trava, e não um erro de argumento
  BEGIN
    PERFORM ci.entrar(gar);
    PERFORM public.frente_caixa_atual();
    PERFORM ci.sair();
    RAISE EXCEPTION 'FALHA: a trava do salão não bloqueou frente_caixa_atual';
  EXCEPTION WHEN OTHERS THEN
    PERFORM ci.sair();
    PERFORM ci.exige(SQLERRM LIKE '%não tem acesso a esta operação%', 'a recusa vem da trava do salão: ' || SQLERRM);
  END;

  -- quem acumula outro papel não fica restrito
  INSERT INTO auth.users (id, email) VALUES (gar_cx, 'garcom-caixa@ci');
  UPDATE profiles SET tenant_id = demo WHERE id = gar_cx;
  INSERT INTO user_roles (user_id, tenant_id, role) VALUES (gar_cx, demo, 'garcom'), (gar_cx, demo, 'vendedor');
  PERFORM ci.exige(ci.contar(gar_cx, 'SELECT count(*) FROM produtos') > 0, 'garçom que também é vendedor segue com o acesso de vendedor');
  PERFORM ci.exige(ci.contar(vend, 'SELECT count(*) FROM produtos') > 0, 'vendedor segue lendo produtos');
  PERFORM ci.exige(NOT (SELECT eh_salao_restrito()), 'eh_salao_restrito é falso para quem não tem usuário logado');

  -- item de categoria desativada não pode ser lançado
  DECLARE
    cat_off uuid; item_off uuid; mesa_off uuid; cmd_off uuid;
  BEGIN
    INSERT INTO cardapio_categorias (tenant_id, nome, ativo) VALUES (demo, 'Fora do cardápio', false) RETURNING id INTO cat_off;
    INSERT INTO cardapio_itens (tenant_id, categoria_id, nome, preco) VALUES (demo, cat_off, 'Prato fantasma', 10) RETURNING id INTO item_off;
    INSERT INTO mesas (tenant_id, numero) VALUES (demo, 'categoria-off') RETURNING id INTO mesa_off;
    PERFORM ci.entrar(gar);
    cmd_off := restaurante_abrir_comanda(mesa_off, 1);
    PERFORM ci.sair();
    PERFORM ci.deve_falhar(gar, format($c$SELECT restaurante_lancar_item(%L, %L, 1)$c$, cmd_off, item_off), 'lançar item de categoria desativada');
    UPDATE cardapio_categorias SET ativo = true WHERE id = cat_off;
    PERFORM ci.entrar(gar);
    PERFORM restaurante_lancar_item(cmd_off, item_off, 1);
    PERFORM ci.sair();
    PERFORM ci.exige(true, 'com a categoria reativada o item pode ser lançado');
  END;
END $$;


-- 17. baixa parcial da comanda (alguém da mesa vai embora)
DO $$
DECLARE
  demo   constant uuid := '11111111-1111-1111-1111-111111111111';
  filial constant uuid := '33333333-3333-3333-3333-333333333333';
  adm    constant uuid := 'a0000000-0000-0000-0000-000000000001';
  gar    constant uuid := 'a0000000-0000-0000-0000-000000000006';
  cxa    constant uuid := 'a0000000-0000-0000-0000-0000000000a1';
  cat uuid; it_a uuid; it_b uuid; it_c uuid; it_d uuid; it_e uuid; mesa uuid; cmd uuid; cmd2 uuid; cmd3 uuid; cx uuid; i_a uuid; i_b uuid; i_c uuid;
  r jsonb; itens jsonb; pg_total numeric; n_cmd bigint;
BEGIN
  INSERT INTO cardapio_categorias (tenant_id, nome) VALUES (demo, 'Parcial') RETURNING id INTO cat;
  INSERT INTO cardapio_itens (tenant_id, categoria_id, nome, preco, estacao) VALUES (demo, cat, 'Cerveja', 20, 'nenhuma') RETURNING id INTO it_a;
  INSERT INTO cardapio_itens (tenant_id, categoria_id, nome, preco, estacao) VALUES (demo, cat, 'Porção', 12.5, 'nenhuma') RETURNING id INTO it_b;
  INSERT INTO cardapio_itens (tenant_id, categoria_id, nome, preco, estacao) VALUES (demo, cat, 'Prato', 30, 'cozinha') RETURNING id INTO it_c;
  INSERT INTO cardapio_itens (tenant_id, categoria_id, nome, preco, estacao) VALUES (demo, cat, 'Suco', 10.05, 'nenhuma') RETURNING id INTO it_d;
  INSERT INTO cardapio_itens (tenant_id, categoria_id, nome, preco, estacao) VALUES (demo, cat, 'Rodízio', 50, 'nenhuma') RETURNING id INTO it_e;
  INSERT INTO mesas (tenant_id, numero) VALUES (demo, 'parcial-1') RETURNING id INTO mesa;
  SELECT id INTO cx FROM caixas WHERE tenant_id = demo AND filial_id = filial AND situacao = 'aberto' LIMIT 1;

  -- 4 pessoas, serviço 10%, couvert R$ 5; 3 cervejas (60) + 2 porções (25) = 85; couvert 20; serviço 8,50; conta 113,50
  PERFORM ci.entrar(gar);
  cmd := restaurante_abrir_comanda(mesa, 4, NULL, 10, 5);
  i_a := restaurante_lancar_item(cmd, it_a, 3);
  i_b := restaurante_lancar_item(cmd, it_b, 2);
  PERFORM restaurante_enviar_cozinha(cmd);
  PERFORM ci.sair();
  itens := jsonb_build_array(jsonb_build_object('id', i_a, 'quantidade', 1), jsonb_build_object('id', i_b));

  PERFORM ci.deve_falhar(gar, format($c$SELECT restaurante_receber_parcial(%L, '[{"forma":"pix","valor":54.50}]'::jsonb, %L, %L::jsonb, 1)$c$, cmd, cx, itens), 'garçom faz baixa parcial');
  PERFORM ci.deve_falhar(cxa, format($c$SELECT restaurante_receber_parcial(%L, '[{"forma":"pix","valor":50}]'::jsonb, %L, %L::jsonb, 1)$c$, cmd, cx, itens), 'baixa por itens com valor que não confere');
  PERFORM ci.deve_falhar(cxa, format($c$SELECT restaurante_receber_parcial(%L, '[{"forma":"boleto","valor":54.50}]'::jsonb, %L, %L::jsonb, 1)$c$, cmd, cx, itens), 'boleto na baixa parcial');
  PERFORM ci.deve_falhar(cxa, format($c$SELECT restaurante_receber_parcial(%L, '[{"forma":"pix","valor":54.50}]'::jsonb, %L, %L::jsonb, 5)$c$, cmd, cx, itens), 'mais pessoas do que a mesa tem');
  PERFORM ci.deve_falhar(cxa, format($c$SELECT restaurante_receber_parcial(%L, '[{"forma":"pix","valor":54.50}]'::jsonb, %L, %L::jsonb, 1)$c$, cmd, cx, jsonb_build_array(jsonb_build_object('id', i_a, 'quantidade', 4))), 'mais unidades do que o item tem');

  -- item que ainda não foi entregue não se paga
  PERFORM ci.entrar(gar);
  cmd2 := restaurante_abrir_comanda(NULL, 1, NULL, 10, 0);
  i_c := restaurante_lancar_item(cmd2, it_c, 1);
  PERFORM ci.sair();
  PERFORM ci.deve_falhar(cxa, format($c$SELECT restaurante_receber_parcial(%L, '[{"forma":"pix","valor":33}]'::jsonb, %L, %L::jsonb)$c$, cmd2, cx, jsonb_build_array(jsonb_build_object('id', i_c))), 'pagar item ainda não entregue');
  PERFORM ci.entrar(adm);
  PERFORM restaurante_cancelar_comanda(cmd2, 'teste da baixa parcial');
  PERFORM ci.sair();

  -- baixa por itens: 1 cerveja (20) + 2 porções (25) = 45; serviço 4,50; couvert de 1 pessoa 5 → 54,50
  PERFORM ci.entrar(cxa);
  r := restaurante_receber_parcial(cmd, '[{"forma":"pix","valor":54.50,"pagante":"Ana"}]'::jsonb, cx, itens, 1);
  PERFORM ci.sair();
  PERFORM ci.exige((r ->> 'recebido')::numeric = 54.5 AND (r ->> 'saldo')::numeric = 59, 'baixa por itens recebe 54,50 e deixa saldo de 59');
  PERFORM ci.exige((SELECT quantidade = 2 AND total = 40 AND pago_em IS NULL FROM comanda_itens WHERE id = i_a),
                   'as 2 cervejas restantes seguem na conta');
  PERFORM ci.exige((SELECT count(*) = 1 AND sum(total) = 20 AND bool_and(pagante = 'Ana') FROM comanda_itens WHERE comanda_id = cmd AND nome = 'Cerveja' AND pago_em IS NOT NULL),
                   'a cerveja paga vira uma linha própria, com quem pagou');
  PERFORM ci.exige((SELECT pago_em IS NOT NULL FROM comanda_itens WHERE id = i_b), 'a porção inteira ficou paga');
  PERFORM ci.exige((SELECT pessoas_pagas = 1 FROM comandas WHERE id = cmd), 'couvert da pessoa que saiu registrado');
  PERFORM ci.exige((SELECT count(*) = 1 AND bool_and(parcial) FROM comanda_pagamentos WHERE comanda_id = cmd), 'pagamento gravado como parcial');
  PERFORM ci.exige((SELECT sum(valor) = 54.5 FROM caixa_movimentos WHERE caixa_id = cx AND descricao = 'Comanda ' || (SELECT numero FROM comandas WHERE id = cmd) || ' (parcial)'),
                   'a baixa parcial entra no caixa');
  PERFORM ci.exige((SELECT count(*) = 3 FROM comanda_itens WHERE comanda_id = cmd AND situacao <> 'cancelado'), 'a comanda segue aberta com os itens');

  PERFORM ci.deve_falhar(cxa, format($c$SELECT restaurante_receber_parcial(%L, '[{"forma":"pix","valor":25}]'::jsonb, %L, %L::jsonb)$c$, cmd, cx, jsonb_build_array(jsonb_build_object('id', i_b))), 'pagar de novo um item já pago');
  PERFORM ci.deve_falhar(adm, format($c$SELECT restaurante_cancelar_item(%L, 'não pode')$c$, i_b), 'cancelar item já pago');
  PERFORM ci.deve_falhar(adm, format($c$SELECT restaurante_cancelar_comanda(%L, 'não pode')$c$, cmd), 'cancelar comanda que já recebeu');

  -- baixa por valor livre: 30 do saldo de 59; 40 passaria do que sobra (29)
  PERFORM ci.deve_falhar(cxa, format($c$SELECT restaurante_receber_parcial(%L, '[{"forma":"dinheiro","valor":60}]'::jsonb, %L)$c$, cmd, cx), 'baixa por valor acima do saldo');
  PERFORM ci.entrar(cxa);
  r := restaurante_receber_parcial(cmd, '[{"forma":"dinheiro","valor":30,"pagante":"Beto"}]'::jsonb, cx);
  PERFORM ci.sair();
  PERFORM ci.exige((r ->> 'saldo')::numeric = 29, 'baixa por valor deixa saldo de 29');
  PERFORM ci.deve_falhar(cxa, format($c$SELECT restaurante_receber_parcial(%L, '[{"forma":"dinheiro","valor":40}]'::jsonb, %L)$c$, cmd, cx), 'segunda baixa acima do saldo');

  -- o fechamento cobra só o saldo
  PERFORM ci.deve_falhar(cxa, format($c$SELECT restaurante_fechar_comanda(%L, '[{"forma":"pix","valor":113.50}]'::jsonb, %L)$c$, cmd, cx), 'fechar cobrando a conta inteira de novo');
  PERFORM ci.entrar(cxa);
  r := restaurante_fechar_comanda(cmd, '[{"forma":"pix","valor":29}]'::jsonb, cx);
  PERFORM ci.sair();
  PERFORM ci.exige((r ->> 'total')::numeric = 113.5 AND (r ->> 'recebido_antes')::numeric = 84.5 AND (r ->> 'restante')::numeric = 29,
                   'fechamento devolve total, recebido antes e saldo');
  SELECT sum(valor) INTO pg_total FROM comanda_pagamentos WHERE comanda_id = cmd;
  PERFORM ci.exige(pg_total = 113.5, 'a soma dos pagamentos fecha o total da conta');
  SELECT numero INTO n_cmd FROM comandas WHERE id = cmd;
  PERFORM ci.exige((SELECT sum(valor) = 113.5 FROM caixa_movimentos WHERE tipo = 'venda' AND descricao LIKE 'Comanda ' || n_cmd || '%'),
                   'o caixa recebeu a conta inteira, em partes');
  PERFORM ci.exige((SELECT situacao = 'fechada' AND total = 113.5 FROM comandas WHERE id = cmd), 'comanda fechada com o total cheio');

  -- conta toda paga em baixas: fechar sem novos pagamentos
  PERFORM ci.entrar(gar);
  cmd2 := restaurante_abrir_comanda(NULL, NULL, NULL, 0, 0);
  PERFORM restaurante_lancar_item(cmd2, it_b, 2);
  PERFORM restaurante_enviar_cozinha(cmd2);
  PERFORM ci.sair();
  PERFORM ci.entrar(cxa);
  PERFORM restaurante_receber_parcial(cmd2, '[{"forma":"pix","valor":25}]'::jsonb, cx);
  r := restaurante_fechar_comanda(cmd2, '[]'::jsonb);
  PERFORM ci.sair();
  PERFORM ci.exige((r ->> 'restante')::numeric = 0 AND (SELECT situacao = 'fechada' FROM comandas WHERE id = cmd2),
                   'conta já paga em baixas fecha sem novo pagamento');

  -- serviço acumulado: dois itens de 10,05 com 10% de serviço; a conta é 22,11 e as baixas somam 11,06 + 11,05
  PERFORM ci.entrar(gar);
  cmd2 := restaurante_abrir_comanda(NULL, NULL, NULL, 10, 0);
  i_a := restaurante_lancar_item(cmd2, it_d, 1);
  i_b := restaurante_lancar_item(cmd2, it_d, 1);
  PERFORM restaurante_enviar_cozinha(cmd2);
  PERFORM ci.sair();
  PERFORM ci.deve_falhar(cxa, format($c$SELECT restaurante_receber_parcial(%L, '[{"forma":"pix","valor":11.05}]'::jsonb, %L, %L::jsonb)$c$, cmd2, cx, jsonb_build_array(jsonb_build_object('id', i_a))), 'primeira baixa com o serviço arredondado errado');
  PERFORM ci.entrar(cxa);
  PERFORM restaurante_receber_parcial(cmd2, '[{"forma":"pix","valor":11.06}]'::jsonb, cx, jsonb_build_array(jsonb_build_object('id', i_a)));
  PERFORM restaurante_receber_parcial(cmd2, '[{"forma":"pix","valor":11.05}]'::jsonb, cx, jsonb_build_array(jsonb_build_object('id', i_b)));
  r := restaurante_fechar_comanda(cmd2, '[]'::jsonb);
  PERFORM ci.sair();
  PERFORM ci.exige((r ->> 'total')::numeric = 22.11 AND (r ->> 'restante')::numeric = 0, 'as baixas por itens somam exatamente o total da conta');

  -- cancelar item depois de baixa por valor não pode deixar a conta abaixo do que já foi recebido
  PERFORM ci.entrar(gar);
  cmd2 := restaurante_abrir_comanda(NULL, NULL, NULL, 0, 0);
  i_a := restaurante_lancar_item(cmd2, it_e, 1);
  i_b := restaurante_lancar_item(cmd2, it_e, 1);
  PERFORM restaurante_enviar_cozinha(cmd2);
  cmd3 := restaurante_abrir_comanda(NULL, NULL, NULL, 0, 0);
  i_c := restaurante_lancar_item(cmd3, it_e, 1);
  PERFORM restaurante_lancar_item(cmd3, it_e, 1);
  PERFORM restaurante_enviar_cozinha(cmd3);
  PERFORM ci.sair();
  PERFORM ci.entrar(cxa);
  PERFORM restaurante_receber_parcial(cmd2, '[{"forma":"dinheiro","valor":90}]'::jsonb, cx);
  PERFORM restaurante_receber_parcial(cmd3, '[{"forma":"dinheiro","valor":40}]'::jsonb, cx);
  PERFORM ci.sair();
  PERFORM ci.deve_falhar(adm, format($c$SELECT restaurante_cancelar_item(%L, 'cancelar depois da baixa')$c$, i_a), 'cancelar item deixando a conta abaixo do recebido');
  PERFORM ci.entrar(adm);
  PERFORM restaurante_cancelar_item(i_c, 'cancelar com folga no recebido');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT situacao = 'cancelado' FROM comanda_itens WHERE id = i_c),
                   'cancelar item continua permitido quando a conta fica acima do recebido');
END $$;

-- 18. quantidade de mesas do restaurante
DO $$
DECLARE
  demo   constant uuid := '11111111-1111-1111-1111-111111111111';
  adm    constant uuid := 'a0000000-0000-0000-0000-000000000001';
  gest   constant uuid := 'a0000000-0000-0000-0000-000000000005';
  gar    constant uuid := 'a0000000-0000-0000-0000-000000000006';
  cxa    constant uuid := 'a0000000-0000-0000-0000-0000000000a1';
  r jsonb; mesa4 uuid; cmd uuid; fm uuid;
BEGIN
  INSERT INTO filiais (tenant_id, empresa_id, nome) VALUES (demo, '22222222-2222-2222-2222-222222222222', 'Filial das mesas') RETURNING id INTO fm;
  -- numeração própria desta filial; mesa com nome (não numérica) não é tocada
  INSERT INTO mesas (tenant_id, filial_id, numero) VALUES (demo, fm, 'Varanda');

  PERFORM ci.deve_falhar(gar, format($c$SELECT restaurante_definir_mesas(5, %L)$c$, fm), 'garçom define a quantidade de mesas');
  PERFORM ci.deve_falhar(cxa, format($c$SELECT restaurante_definir_mesas(5, %L)$c$, fm), 'caixa define a quantidade de mesas');
  PERFORM ci.deve_falhar(gest, format($c$SELECT restaurante_definir_mesas(-1, %L)$c$, fm), 'quantidade negativa de mesas');
  PERFORM ci.deve_falhar(gest, format($c$SELECT restaurante_definir_mesas(501, %L)$c$, fm), 'mais de 500 mesas');
  PERFORM ci.deve_falhar(gest, format($c$SELECT restaurante_definir_mesas(3, %L)$c$, gen_random_uuid()), 'fm que não existe');

  PERFORM ci.entrar(gest);
  r := restaurante_definir_mesas(5, fm);
  PERFORM ci.sair();
  PERFORM ci.exige((r ->> 'criadas')::int = 5 AND (r ->> 'desativadas')::int = 0, 'cria as mesas de 1 a 5');
  PERFORM ci.exige((SELECT count(*) = 5 FROM mesas WHERE tenant_id = demo AND filial_id = fm AND ativa AND numero ~ '^[0-9]+$'), 'ficam 5 mesas numeradas ativas');

  -- repetir não duplica
  PERFORM ci.entrar(gest);
  r := restaurante_definir_mesas(5, fm);
  PERFORM ci.sair();
  PERFORM ci.exige((r ->> 'criadas')::int = 0 AND (r ->> 'reativadas')::int = 0, 'repetir a mesma quantidade não cria mesas');

  -- a mesa 4 está ocupada: reduzir para 2 desativa a 3 e a 5, mas mantém a 4
  SELECT id INTO mesa4 FROM mesas WHERE tenant_id = demo AND filial_id = fm AND numero = '4';
  PERFORM ci.entrar(gar);
  cmd := restaurante_abrir_comanda(mesa4, 2);
  PERFORM ci.sair();
  PERFORM ci.entrar(adm);
  r := restaurante_definir_mesas(2, fm);
  PERFORM ci.sair();
  PERFORM ci.exige((r ->> 'desativadas')::int = 2 AND (r ->> 'mantidas_ocupadas')::int = 1, 'reduzir desativa as livres e mantém a ocupada');
  PERFORM ci.exige((SELECT ativa FROM mesas WHERE id = mesa4), 'mesa com comanda aberta segue ativa');
  PERFORM ci.exige((SELECT ativa FROM mesas WHERE tenant_id = demo AND filial_id = fm AND numero = 'Varanda'), 'mesa com nome próprio não é tocada');
  PERFORM ci.exige((SELECT count(*) = 3 FROM mesas WHERE tenant_id = demo AND filial_id = fm AND ativa AND numero ~ '^[0-9]+$'), 'ficam as mesas 1, 2 e a ocupada 4');

  -- aumentar reativa as desativadas em vez de duplicar
  PERFORM ci.entrar(gest);
  r := restaurante_definir_mesas(5, fm);
  PERFORM ci.sair();
  PERFORM ci.exige((r ->> 'reativadas')::int = 2 AND (r ->> 'criadas')::int = 0, 'aumentar reativa as mesas desativadas');
  PERFORM ci.exige((SELECT count(*) = 5 FROM mesas WHERE tenant_id = demo AND filial_id = fm AND numero ~ '^[0-9]+$'), 'continuam 5 mesas, sem duplicar');

  -- zero desativa todas as livres; outra empresa não é afetada
  PERFORM ci.entrar(gest);
  r := restaurante_definir_mesas(0, fm);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT count(*) = 1 FROM mesas WHERE tenant_id = demo AND filial_id = fm AND ativa AND numero ~ '^[0-9]+$'), 'zero desativa tudo, menos a mesa ocupada');
  PERFORM ci.exige((SELECT count(*) = 0 FROM mesas WHERE tenant_id <> demo AND numero ~ '^[0-9]+$' AND NOT ativa), 'outra empresa não é afetada');
END $$;

-- 19. ficha técnica: baixa de insumos, custo e devolução
DO $$
DECLARE
  demo   constant uuid := '11111111-1111-1111-1111-111111111111';
  adm    constant uuid := 'a0000000-0000-0000-0000-000000000001';
  gar    constant uuid := 'a0000000-0000-0000-0000-000000000006';
  coz    constant uuid := 'a0000000-0000-0000-0000-000000000007';
  cxa    constant uuid := 'a0000000-0000-0000-0000-0000000000a1';
  dep uuid; carne uuid; pao uuid; bacon uuid; lata uuid; outro_tenant uuid; produto_alheio uuid;
  cat uuid; it_burger uuid; it_refri uuid; gr uuid; op_bacon uuid;
  cmd uuid; cmd2 uuid; i_burger uuid; i_refri uuid; i2 uuid; i3 uuid; n_cmd bigint;
BEGIN
  INSERT INTO depositos (tenant_id, nome, permite_negativo) VALUES (demo, 'Cozinha CI', false) RETURNING id INTO dep;
  INSERT INTO produtos (tenant_id, codigo_interno, descricao, unidade, custo) VALUES (demo, 'FT-CARNE', 'Carne moída CI', 'kg', 40) RETURNING id INTO carne;
  INSERT INTO produtos (tenant_id, codigo_interno, descricao, unidade, custo) VALUES (demo, 'FT-PÃO', 'Pão CI', 'un', 1.5) RETURNING id INTO pao;
  INSERT INTO produtos (tenant_id, codigo_interno, descricao, unidade, custo) VALUES (demo, 'FT-BACON', 'Bacon CI', 'kg', 60) RETURNING id INTO bacon;
  INSERT INTO produtos (tenant_id, codigo_interno, descricao, unidade, custo) VALUES (demo, 'FT-LATA', 'Lata CI', 'un', 3) RETURNING id INTO lata;

  INSERT INTO cardapio_categorias (tenant_id, nome) VALUES (demo, 'Ficha CI') RETURNING id INTO cat;
  INSERT INTO cardapio_itens (tenant_id, categoria_id, nome, preco, estacao) VALUES (demo, cat, 'Burger ficha', 30, 'cozinha') RETURNING id INTO it_burger;
  INSERT INTO cardapio_itens (tenant_id, categoria_id, nome, preco, estacao, produto_id) VALUES (demo, cat, 'Refri lata', 6, 'nenhuma', lata) RETURNING id INTO it_refri;
  INSERT INTO cardapio_grupos (tenant_id, item_id, nome) VALUES (demo, it_burger, 'Extras') RETURNING id INTO gr;
  INSERT INTO cardapio_opcoes (tenant_id, grupo_id, nome, preco_adicional) VALUES (demo, gr, 'Bacon extra', 5) RETURNING id INTO op_bacon;

  -- permissões: só a gestão cadastra e lê a ficha
  PERFORM ci.deve_falhar(gar, format($c$INSERT INTO cardapio_ficha (tenant_id, item_id, produto_id, quantidade) VALUES (%L, %L, %L, 1)$c$, demo, it_burger, pao), 'garçom cadastra ficha técnica');
  PERFORM ci.deve_falhar(cxa, format($c$INSERT INTO cardapio_ficha (tenant_id, item_id, produto_id, quantidade) VALUES (%L, %L, %L, 1)$c$, demo, it_burger, pao), 'caixa cadastra ficha técnica');
  PERFORM ci.entrar(adm);
  INSERT INTO cardapio_ficha (tenant_id, item_id, produto_id, quantidade, perda_percentual) VALUES (demo, it_burger, carne, 0.15, 10);
  INSERT INTO cardapio_ficha (tenant_id, item_id, produto_id, quantidade) VALUES (demo, it_burger, pao, 1);
  INSERT INTO cardapio_ficha (tenant_id, opcao_id, produto_id, quantidade) VALUES (demo, op_bacon, bacon, 0.03);
  PERFORM ci.sair();
  PERFORM ci.exige(ci.contar(adm, 'SELECT count(*) FROM cardapio_ficha') = 3, 'gestão lê a ficha técnica');
  PERFORM ci.exige(ci.contar(gar, 'SELECT count(*) FROM cardapio_ficha') = 0, 'garçom não lê a ficha técnica');
  PERFORM ci.exige(ci.contar(coz, 'SELECT count(*) FROM cardapio_ficha') = 0, 'cozinha não lê a ficha técnica');
  PERFORM ci.exige(ci.contar(cxa, 'SELECT count(*) FROM cardapio_ficha') = 0, 'caixa não lê a ficha técnica');

  -- restrições da ficha
  PERFORM ci.deve_falhar_dono(format($c$INSERT INTO cardapio_ficha (tenant_id, item_id, produto_id, quantidade) VALUES (%L, %L, %L, 1)$c$, demo, it_burger, carne), 'mesmo insumo duas vezes na ficha do item');
  PERFORM ci.deve_falhar_dono(format($c$INSERT INTO cardapio_ficha (tenant_id, produto_id, quantidade) VALUES (%L, %L, 1)$c$, demo, carne), 'ficha sem item nem opção');
  PERFORM ci.deve_falhar_dono(format($c$INSERT INTO cardapio_ficha (tenant_id, item_id, opcao_id, produto_id, quantidade) VALUES (%L, %L, %L, %L, 1)$c$, demo, it_burger, op_bacon, lata), 'ficha com item e opção ao mesmo tempo');
  PERFORM ci.deve_falhar_dono(format($c$INSERT INTO cardapio_ficha (tenant_id, item_id, produto_id, quantidade) VALUES (%L, %L, %L, 0)$c$, demo, it_refri, lata), 'quantidade zero na ficha');
  PERFORM ci.deve_falhar_dono(format($c$INSERT INTO cardapio_ficha (tenant_id, item_id, produto_id, quantidade, perda_percentual) VALUES (%L, %L, %L, 1, 95)$c$, demo, it_refri, lata), 'perda de 95%');
  SELECT id INTO outro_tenant FROM tenants WHERE id <> demo LIMIT 1;
  INSERT INTO produtos (tenant_id, codigo_interno, descricao, unidade) VALUES (outro_tenant, 'FT-ALHEIO', 'Insumo de outra empresa', 'kg') RETURNING id INTO produto_alheio;
  PERFORM ci.deve_falhar_dono(format($c$INSERT INTO cardapio_ficha (tenant_id, item_id, produto_id, quantidade) VALUES (%L, %L, %L, 1)$c$, demo, it_refri, produto_alheio), 'insumo de outra empresa na ficha');
  PERFORM ci.deve_falhar_dono(format($c$INSERT INTO restaurante_config (tenant_id, baixa_estoque) VALUES (%L, true)$c$, outro_tenant), 'baixa de estoque sem depósito');

  -- estoque inicial (entrada pelo fluxo normal) e configuração do restaurante
  PERFORM ci.entrar(adm);
  PERFORM registrar_movimentacao(carne, dep, 'entrada'::mov_tipo, 10, 'ci', 'ci', NULL, 40);
  PERFORM registrar_movimentacao(pao, dep, 'entrada'::mov_tipo, 50, 'ci', 'ci', NULL, 1.5);
  PERFORM registrar_movimentacao(bacon, dep, 'entrada'::mov_tipo, 2, 'ci', 'ci', NULL, 60);
  PERFORM registrar_movimentacao(lata, dep, 'entrada'::mov_tipo, 24, 'ci', 'ci', NULL, 3);
  PERFORM ci.sair();
  INSERT INTO restaurante_config (tenant_id, baixa_estoque, deposito_id) VALUES (demo, true, dep);
  PERFORM ci.exige(ci.contar(gar, 'SELECT count(*) FROM restaurante_config') = 0, 'garçom não lê a configuração de estoque do restaurante');
  PERFORM ci.exige(ci.contar(gar, 'WITH u AS (UPDATE restaurante_config SET baixa_estoque = false RETURNING 1) SELECT count(*) FROM u') = 0, 'garçom não altera a configuração de estoque (nenhuma linha)');
  PERFORM ci.exige((SELECT baixa_estoque FROM restaurante_config WHERE tenant_id = demo), 'a configuração segue ligada');

  -- 1. enviar à cozinha baixa os insumos: 2 burgers com bacon extra + 3 refrigerantes
  PERFORM ci.entrar(gar);
  cmd := restaurante_abrir_comanda(NULL, NULL, NULL, 0, 0);
  i_burger := restaurante_lancar_item(cmd, it_burger, 2, ARRAY[op_bacon]);
  i_refri := restaurante_lancar_item(cmd, it_refri, 3);
  PERFORM ci.exige((SELECT opcoes -> 0 ? 'id' FROM comanda_itens WHERE id = i_burger), 'a comanda guarda o id da opção escolhida');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT quantidade FROM estoques WHERE produto_id = carne AND deposito_id = dep) = 10, 'lançar o item ainda não baixa o estoque');
  PERFORM ci.entrar(gar);
  PERFORM restaurante_enviar_cozinha(cmd);
  PERFORM ci.sair();
  SELECT numero INTO n_cmd FROM comandas WHERE id = cmd;
  -- carne: 2 × 0,15 ÷ 0,90 = 0,333; pão: 2; bacon: 2 × 0,03 = 0,06; lata (revenda, sem ficha): 3
  PERFORM ci.exige((SELECT quantidade FROM estoques WHERE produto_id = carne AND deposito_id = dep) = 9.667, 'a carne baixa com a perda de preparo');
  PERFORM ci.exige((SELECT quantidade FROM estoques WHERE produto_id = pao AND deposito_id = dep) = 48, 'o pão baixa pela ficha');
  PERFORM ci.exige((SELECT quantidade FROM estoques WHERE produto_id = bacon AND deposito_id = dep) = 1.94, 'a opção escolhida baixa o próprio insumo');
  PERFORM ci.exige((SELECT quantidade FROM estoques WHERE produto_id = lata AND deposito_id = dep) = 21, 'bebida de revenda baixa 1 unidade por unidade vendida');
  PERFORM ci.exige((SELECT count(*) = 4 AND bool_and(tipo = 'saida') AND bool_and(documento = 'COMANDA-' || n_cmd) FROM estoque_movimentacoes WHERE documento = 'COMANDA-' || n_cmd),
                   'cada insumo gera uma movimentação de saída com o número da comanda');

  -- 2. cancelar o item ainda na fila da cozinha devolve os insumos; o que já foi entregue não volta
  PERFORM ci.entrar(adm);
  PERFORM restaurante_cancelar_item(i_burger, 'cliente desistiu');
  PERFORM restaurante_cancelar_item(i_refri, 'refri já entregue');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT quantidade FROM estoques WHERE produto_id = carne AND deposito_id = dep) = 10, 'cancelar na fila devolve a carne');
  PERFORM ci.exige((SELECT quantidade FROM estoques WHERE produto_id = bacon AND deposito_id = dep) = 2, 'cancelar na fila devolve o bacon');
  PERFORM ci.exige((SELECT quantidade FROM estoques WHERE produto_id = lata AND deposito_id = dep) = 21, 'item já entregue não devolve o estoque');

  -- 3. depois de iniciado o preparo, o insumo foi consumido e não volta
  PERFORM ci.entrar(gar);
  cmd2 := restaurante_abrir_comanda(NULL, NULL, NULL, 0, 0);
  i2 := restaurante_lancar_item(cmd2, it_burger, 1);
  PERFORM restaurante_enviar_cozinha(cmd2);
  PERFORM ci.sair();
  PERFORM ci.entrar(coz);
  PERFORM restaurante_atualizar_item(i2, 'preparando');
  PERFORM ci.sair();
  PERFORM ci.entrar(adm);
  PERFORM restaurante_cancelar_item(i2, 'queimou no preparo');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT quantidade FROM estoques WHERE produto_id = carne AND deposito_id = dep) = 9.833, 'item cancelado já em preparo não devolve a carne');

  -- 4. cancelar a comanda devolve o que ainda estava na fila
  PERFORM ci.entrar(gar);
  cmd2 := restaurante_abrir_comanda(NULL, NULL, NULL, 0, 0);
  PERFORM restaurante_lancar_item(cmd2, it_burger, 3);
  PERFORM restaurante_enviar_cozinha(cmd2);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT quantidade FROM estoques WHERE produto_id = pao AND deposito_id = dep) = 46, 'a comanda enviada baixou 3 pães');
  PERFORM ci.entrar(adm);
  PERFORM restaurante_cancelar_comanda(cmd2, 'mesa foi embora');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT quantidade FROM estoques WHERE produto_id = pao AND deposito_id = dep) = 49, 'cancelar a comanda devolve os 3 pães');

  -- 5. falta de insumo recusa o envio (depósito sem saldo negativo) e nada fica pela metade
  PERFORM ci.entrar(gar);
  cmd2 := restaurante_abrir_comanda(NULL, NULL, NULL, 0, 0);
  i3 := restaurante_lancar_item(cmd2, it_burger, 100);
  PERFORM ci.sair();
  PERFORM ci.deve_falhar(gar, format($c$SELECT restaurante_enviar_cozinha(%L)$c$, cmd2), 'enviar pedido sem insumo suficiente');
  PERFORM ci.exige((SELECT situacao = 'pendente' FROM comanda_itens WHERE id = i3), 'o envio recusado deixa o item pendente');
  PERFORM ci.exige((SELECT quantidade FROM estoques WHERE produto_id = pao AND deposito_id = dep) = 49, 'o envio recusado não mexe no estoque');

  -- 6. com saldo negativo permitido, o envio passa e o estoque fica negativo
  UPDATE depositos SET permite_negativo = true WHERE id = dep;
  PERFORM ci.entrar(gar);
  PERFORM restaurante_enviar_cozinha(cmd2);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT quantidade FROM estoques WHERE produto_id = pao AND deposito_id = dep) = -51, 'depósito que permite negativo fica negativo');

  -- 7. com a baixa desligada, o estoque não muda
  UPDATE restaurante_config SET baixa_estoque = false WHERE tenant_id = demo;
  PERFORM ci.entrar(gar);
  cmd2 := restaurante_abrir_comanda(NULL, NULL, NULL, 0, 0);
  PERFORM restaurante_lancar_item(cmd2, it_burger, 1);
  PERFORM restaurante_enviar_cozinha(cmd2);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT quantidade FROM estoques WHERE produto_id = pao AND deposito_id = dep) = -51, 'com a baixa desligada o estoque não muda');
END $$;

-- 20. delivery do restaurante
DO $$
DECLARE
  demo   constant uuid := '11111111-1111-1111-1111-111111111111';
  filial constant uuid := '33333333-3333-3333-3333-333333333333';
  adm    constant uuid := 'a0000000-0000-0000-0000-000000000001';
  gar    constant uuid := 'a0000000-0000-0000-0000-000000000006';
  coz    constant uuid := 'a0000000-0000-0000-0000-000000000007';
  cxa    constant uuid := 'a0000000-0000-0000-0000-0000000000a1';
  cat uuid; it_pizza uuid; it_taxa uuid; mesa_x uuid; cx uuid; outro_tenant uuid;
  d1 uuid; d2 uuid; i1 uuid; r jsonb; n bigint;
BEGIN
  INSERT INTO cardapio_categorias (tenant_id, nome) VALUES (demo, 'Delivery CI') RETURNING id INTO cat;
  INSERT INTO cardapio_itens (tenant_id, categoria_id, nome, preco, estacao) VALUES (demo, cat, 'Pizza CI', 20, 'cozinha') RETURNING id INTO it_pizza;
  SELECT id INTO cx FROM caixas WHERE tenant_id = demo AND filial_id = filial AND situacao = 'aberto' LIMIT 1;

  -- validações do pedido
  PERFORM ci.deve_falhar(coz, $c$SELECT restaurante_abrir_delivery('Ana', '11999998888', 'Rua das Flores, 100')$c$, 'cozinha abre delivery');
  PERFORM ci.deve_falhar(gar, $c$SELECT restaurante_abrir_delivery('', '11999998888', 'Rua das Flores, 100')$c$, 'delivery sem nome do cliente');
  PERFORM ci.deve_falhar(gar, $c$SELECT restaurante_abrir_delivery('Ana', '11999998888', 'Rua')$c$, 'delivery com endereço curto');
  PERFORM ci.deve_falhar(gar, $c$SELECT restaurante_abrir_delivery('Ana', '1234', 'Rua das Flores, 100')$c$, 'delivery com telefone curto');
  PERFORM ci.deve_falhar(gar, $c$SELECT restaurante_abrir_delivery('Ana', '11999998888', 'Rua das Flores, 100', NULL, NULL, -5)$c$, 'taxa de entrega negativa');
  PERFORM ci.deve_falhar(gar, $c$SELECT restaurante_abrir_delivery('Ana', '11999998888', 'Rua das Flores, 100', NULL, NULL, 5000)$c$, 'taxa de entrega absurda');
  PERFORM ci.deve_falhar(gar, $c$SELECT restaurante_abrir_delivery('Ana', '11999998888', 'Rua das Flores, 100', NULL, NULL, 5, 'cheque')$c$, 'forma de pagamento inventada');

  -- pedido: taxa de 8, pagamento em dinheiro com troco para 100
  PERFORM ci.entrar(gar);
  d1 := restaurante_abrir_delivery('Ana Souza', '(11) 99999-8888', 'Rua das Flores, 100', 'Centro', 'Casa azul', 8, 'dinheiro', 100, 'Sem campainha');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT tipo = 'delivery' AND entrega_situacao = 'aguardando' AND mesa_id IS NULL AND canal = 'proprio'
                         AND taxa_servico_percentual = 0 AND couvert_por_pessoa = 0 AND entrega_bairro = 'Centro'
                         AND entrega_troco_para = 100 AND entrega_pagamento = 'dinheiro'
                    FROM comandas WHERE id = d1), 'delivery nasce sem serviço nem couvert, aguardando, com os dados da entrega');
  PERFORM ci.exige((SELECT count(*) = 1 AND sum(total) = 8 AND bool_and(situacao = 'entregue') FROM comanda_itens WHERE comanda_id = d1),
                   'a taxa de entrega entra na conta como um item');
  SELECT id INTO it_taxa FROM cardapio_itens WHERE tenant_id = demo AND interno AND nome = 'Taxa de entrega';
  PERFORM ci.exige(it_taxa IS NOT NULL AND (SELECT NOT ativo FROM cardapio_itens WHERE id = it_taxa), 'o item da taxa é interno e inativo');
  PERFORM ci.deve_falhar(gar, format($c$SELECT restaurante_lancar_item(%L, %L, 1)$c$, d1, it_taxa), 'lançar o item interno da taxa à mão');

  -- itens, cozinha e saída
  PERFORM ci.entrar(gar);
  i1 := restaurante_lancar_item(d1, it_pizza, 2);
  PERFORM restaurante_enviar_cozinha(d1);
  PERFORM ci.sair();
  PERFORM ci.deve_falhar(gar, format($c$SELECT restaurante_delivery_avancar(%L, 'saiu', 'Zé')$c$, d1), 'sair com item ainda na cozinha');
  PERFORM ci.deve_falhar(coz, format($c$SELECT restaurante_delivery_avancar(%L, 'saiu', 'Zé')$c$, d1), 'cozinha despacha o delivery');
  PERFORM ci.entrar(coz);
  PERFORM restaurante_atualizar_item(i1, 'preparando');
  PERFORM restaurante_atualizar_item(i1, 'pronto');
  PERFORM ci.sair();
  PERFORM ci.deve_falhar(gar, format($c$SELECT restaurante_delivery_avancar(%L, 'entregue')$c$, d1), 'entregar ao cliente sem ter saído');
  PERFORM ci.entrar(gar);
  PERFORM restaurante_delivery_avancar(d1, 'saiu', ' Zé da moto ');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT entrega_situacao = 'saiu' AND entregador = 'Zé da moto' AND saiu_em IS NOT NULL FROM comandas WHERE id = d1),
                   'o pedido sai com o entregador registrado');
  PERFORM ci.exige((SELECT situacao = 'entregue' FROM comanda_itens WHERE id = i1), 'os itens prontos passam a entregues na saída');

  -- voltar e sair de novo
  PERFORM ci.entrar(gar);
  PERFORM restaurante_delivery_avancar(d1, 'aguardando');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT entrega_situacao = 'aguardando' AND entregador IS NULL AND saiu_em IS NULL FROM comandas WHERE id = d1),
                   'entregador que volta devolve o pedido para aguardando');
  PERFORM ci.entrar(gar);
  PERFORM restaurante_delivery_avancar(d1, 'saiu', 'Zé');
  PERFORM ci.sair();

  -- taxa: ajusta antes do recebimento, trava depois
  PERFORM ci.deve_falhar(coz, format($c$SELECT restaurante_delivery_taxa(%L, 12)$c$, d1), 'cozinha muda a taxa de entrega');
  PERFORM ci.deve_falhar(gar, format($c$SELECT restaurante_delivery_taxa(%L, -1)$c$, d1), 'taxa negativa ao ajustar');
  PERFORM ci.entrar(gar);
  PERFORM restaurante_delivery_taxa(d1, 12);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT sum(total) = 52 FROM comanda_itens WHERE comanda_id = d1 AND situacao <> 'cancelado'), 'taxa ajustada para 12: conta de 40 + 12');
  PERFORM ci.entrar(cxa);
  PERFORM restaurante_receber_parcial(d1, '[{"forma":"pix","valor":10}]'::jsonb, cx);
  PERFORM ci.sair();
  PERFORM ci.deve_falhar(gar, format($c$SELECT restaurante_delivery_taxa(%L, 15)$c$, d1), 'mudar a taxa depois de receber pagamento');

  -- entrega ao cliente e fechamento no caixa (serviço zero: total 52, já recebido 10)
  PERFORM ci.entrar(gar);
  PERFORM restaurante_delivery_avancar(d1, 'entregue');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT entrega_situacao = 'entregue' AND entregue_cliente_em IS NOT NULL FROM comandas WHERE id = d1), 'pedido entregue ao cliente');
  PERFORM ci.deve_falhar(gar, format($c$SELECT restaurante_delivery_avancar(%L, 'entregue')$c$, d1), 'entregar duas vezes');
  PERFORM ci.deve_falhar(gar, format($c$SELECT restaurante_delivery_avancar(%L, 'aguardando')$c$, d1), 'voltar um pedido já entregue');
  PERFORM ci.deve_falhar(gar, format($c$SELECT restaurante_delivery_avancar(%L, 'inventada')$c$, d1), 'situação de entrega inventada');
  PERFORM ci.entrar(cxa);
  r := restaurante_fechar_comanda(d1, '[{"forma":"dinheiro","valor":42}]'::jsonb, cx);
  PERFORM ci.sair();
  PERFORM ci.exige((r ->> 'total')::numeric = 52 AND (r ->> 'taxa_servico')::numeric = 0 AND (r ->> 'restante')::numeric = 42,
                   'o delivery fecha sem serviço, com a taxa dentro do total');
  SELECT numero INTO n FROM comandas WHERE id = d1;
  PERFORM ci.exige((SELECT sum(valor) = 52 FROM caixa_movimentos WHERE tipo = 'venda' AND descricao LIKE 'Comanda ' || n || '%'), 'o caixa recebeu a conta do delivery');

  -- cancelar o pedido devolve nada quando já foi pago; pedido novo cancelado antes da cozinha
  PERFORM ci.entrar(gar);
  d2 := restaurante_abrir_delivery('Bruno', NULL, 'Av. Brasil, 2000', NULL, NULL, 0);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT count(*) = 0 FROM comanda_itens WHERE comanda_id = d2), 'taxa zero não cria item');
  PERFORM ci.entrar(adm);
  PERFORM restaurante_cancelar_comanda(d2, 'cliente desistiu');
  PERFORM ci.sair();
  PERFORM ci.deve_falhar(gar, format($c$SELECT restaurante_delivery_avancar(%L, 'saiu')$c$, d2), 'despachar pedido cancelado');

  -- integridade: sem mesa, canal e código externo únicos
  SELECT id INTO mesa_x FROM mesas WHERE tenant_id = demo LIMIT 1;
  PERFORM ci.deve_falhar_dono(format($c$UPDATE comandas SET mesa_id = %L WHERE id = %L$c$, mesa_x, d1), 'delivery com mesa');
  PERFORM ci.deve_falhar_dono(format($c$UPDATE comandas SET entrega_endereco = 'Rua' WHERE id = %L$c$, d1), 'delivery com endereço curto no banco');
  UPDATE comandas SET canal = 'ifood', codigo_externo = 'IF-1' WHERE id = d1;
  PERFORM ci.deve_falhar_dono(format($c$UPDATE comandas SET canal = 'ifood', codigo_externo = 'IF-1' WHERE id = %L$c$, d2), 'mesmo código externo duas vezes no mesmo canal');
  PERFORM ci.deve_falhar_dono(format($c$UPDATE comandas SET canal = 'rappi' WHERE id = %L$c$, d2), 'canal inventado');

  -- zonas de entrega: a gestão cadastra, o atendimento lê, os outros não
  SELECT id INTO outro_tenant FROM tenants WHERE id <> demo LIMIT 1;
  PERFORM ci.entrar(adm);
  INSERT INTO restaurante_zonas_entrega (tenant_id, nome, taxa) VALUES (demo, 'Centro', 6), (demo, 'Zona Norte', 12);
  PERFORM ci.sair();
  INSERT INTO restaurante_zonas_entrega (tenant_id, nome, taxa) VALUES (outro_tenant, 'Centro', 9);
  PERFORM ci.exige(ci.contar(gar, 'SELECT count(*) FROM restaurante_zonas_entrega') = 2, 'atendimento lê só as zonas da própria empresa');
  PERFORM ci.deve_falhar(gar, format($c$INSERT INTO restaurante_zonas_entrega (tenant_id, nome, taxa) VALUES (%L, 'Sul', 5)$c$, demo), 'garçom cadastra zona de entrega');
  PERFORM ci.deve_falhar(cxa, format($c$INSERT INTO restaurante_zonas_entrega (tenant_id, nome, taxa) VALUES (%L, 'Sul', 5)$c$, demo), 'caixa cadastra zona de entrega');
  PERFORM ci.deve_falhar_dono(format($c$INSERT INTO restaurante_zonas_entrega (tenant_id, nome, taxa) VALUES (%L, ' centro ', 5)$c$, demo), 'zona repetida (sem diferenciar maiúsculas)');
  PERFORM ci.deve_falhar_dono(format($c$INSERT INTO restaurante_zonas_entrega (tenant_id, nome, taxa) VALUES (%L, 'Cara', 5000)$c$, demo), 'taxa de zona absurda');
END $$;

-- 21. pedido de obra com retirada parcial: saldo por item e trava de saída
DO $$
DECLARE
  demo   constant uuid := '11111111-1111-1111-1111-111111111111';
  adm    constant uuid := 'a0000000-0000-0000-0000-000000000001';
  vend   constant uuid := 'a0000000-0000-0000-0000-000000000002';
  gar    constant uuid := 'a0000000-0000-0000-0000-000000000006';
  dep uuid; cim uuid; areia uuid; cli uuid; obra uuid; ped uuid; num bigint;
  i_cim uuid; i_areia uuid; ent1 uuid; ent1b uuid; ent2 uuid; plan uuid;
  q_antes numeric; r_antes numeric; q numeric; r numeric;
BEGIN
  INSERT INTO depositos (tenant_id, nome) VALUES (demo, 'Obras CI') RETURNING id INTO dep;
  INSERT INTO produtos (tenant_id, codigo_interno, descricao, unidade, custo) VALUES (demo, 'OB-CIMENTO', 'Cimento CI', 'sc', 30) RETURNING id INTO cim;
  INSERT INTO produtos (tenant_id, codigo_interno, descricao, unidade, custo) VALUES (demo, 'OB-AREIA', 'Areia CI', 'm3', 80) RETURNING id INTO areia;
  INSERT INTO clientes (tenant_id, nome) VALUES (demo, 'Construtora CI') RETURNING id INTO cli;
  INSERT INTO obras (tenant_id, cliente_id, nome, endereco) VALUES (demo, cli, 'Obra Centro CI', 'Rua das Obras, 10') RETURNING id INTO obra;
  PERFORM ci.entrar(adm);
  PERFORM registrar_movimentacao(cim, dep, 'entrada'::mov_tipo, 100, 'ci', 'ci');
  PERFORM registrar_movimentacao(areia, dep, 'entrada'::mov_tipo, 20, 'ci', 'ci');
  PERFORM ci.sair();

  -- pedido real da obra: 10 sacos de cimento e 4 m³ de areia, com reserva de estoque
  PERFORM ci.entrar(vend);
  ped := criar_pedido_direto(cli, dep,
    jsonb_build_array(jsonb_build_object('produto_id', cim, 'quantidade', 10, 'preco_unitario', 40),
                      jsonb_build_object('produto_id', areia, 'quantidade', 4, 'preco_unitario', 120)),
    obra);
  PERFORM ci.sair();
  SELECT id INTO i_cim FROM pedido_itens WHERE pedido_id = ped AND produto_id = cim;
  SELECT id INTO i_areia FROM pedido_itens WHERE pedido_id = ped AND produto_id = areia;
  PERFORM ci.exige((SELECT reservado FROM estoques WHERE produto_id = cim AND deposito_id = dep) = 10, 'pedido da obra reserva o cimento');
  PERFORM ci.exige((SELECT total FROM pedidos WHERE id = ped) = 880, 'total do pedido da obra');

  -- sem separação e conferência completas o pedido não fica pronto para sair
  PERFORM ci.entrar(adm);
  PERFORM pedido_avancar_status(ped, 'aprovado');
  PERFORM pedido_avancar_status(ped, 'separacao');
  PERFORM ci.sair();
  PERFORM ci.deve_falhar(adm, format($c$SELECT pedido_avancar_status(%L, 'separado')$c$, ped), 'separar sem separar os itens');
  UPDATE pedido_itens SET quantidade_separada = quantidade WHERE pedido_id = ped;
  PERFORM ci.entrar(adm);
  PERFORM pedido_avancar_status(ped, 'separado');
  PERFORM pedido_avancar_status(ped, 'conferencia');
  PERFORM ci.sair();
  PERFORM ci.deve_falhar(adm, format($c$SELECT pedido_avancar_status(%L, 'pronto_entrega')$c$, ped), 'liberar sem conferir');
  UPDATE pedido_itens SET quantidade_conferida = quantidade WHERE pedido_id = ped;
  PERFORM ci.entrar(adm);
  PERFORM pedido_avancar_status(ped, 'pronto_entrega');
  PERFORM ci.sair();

  -- 1ª retirada parcial no balcão: 4 de 10 sacos
  SELECT quantidade, reservado INTO q_antes, r_antes FROM estoques WHERE produto_id = cim AND deposito_id = dep;
  PERFORM ci.entrar(adm);
  ent1 := pedido_registrar_saida(ped, jsonb_build_array(jsonb_build_object('pedido_item_id', i_cim, 'quantidade', 4)),
    'retirada', 'João Pedreiro', 'retirada na loja', 'chave-ret-1');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT quantidade_entregue FROM pedido_itens WHERE id = i_cim) = 4, 'retirada parcial soma no item');
  PERFORM ci.exige((SELECT quantidade_entregue FROM pedido_itens WHERE id = i_areia) = 0, 'o outro item não mexe');
  PERFORM ci.exige((SELECT tipo = 'retirada' AND situacao = 'entregue' AND recebedor = 'João Pedreiro' FROM entregas WHERE id = ent1), 'a retirada fica registrada com quem levou');
  SELECT quantidade, reservado INTO q, r FROM estoques WHERE produto_id = cim AND deposito_id = dep;
  PERFORM ci.exige(q = q_antes - 4 AND r = r_antes - 4, 'a retirada baixa o saldo e libera a reserva só do que saiu');
  PERFORM ci.exige((SELECT situacao FROM pedidos WHERE id = ped) = 'em_rota', 'pedido segue aberto depois da retirada parcial');
  PERFORM ci.exige(EXISTS (SELECT 1 FROM pedido_historico WHERE pedido_id = ped AND situacao_nova = 'em_rota'
                            AND observacao = 'Retirada parcial registrada'), 'a retirada parcial entra no histórico do pedido');

  -- reenvio com a mesma chave (conexão que caiu) não duplica
  PERFORM ci.entrar(adm);
  ent1b := pedido_registrar_saida(ped, jsonb_build_array(jsonb_build_object('pedido_item_id', i_cim, 'quantidade', 4)),
    'retirada', 'João Pedreiro', NULL, 'chave-ret-1');
  PERFORM ci.sair();
  PERFORM ci.exige(ent1b = ent1 AND (SELECT quantidade_entregue FROM pedido_itens WHERE id = i_cim) = 4, 'mesma chave não retira duas vezes');

  -- trava de saldo: restam 6 sacos
  PERFORM ci.deve_falhar(adm, format($c$SELECT pedido_registrar_saida(%L, jsonb_build_array(jsonb_build_object('pedido_item_id', %L, 'quantidade', 7)), 'retirada')$c$, ped, i_cim), 'retirar acima do saldo do item');
  PERFORM ci.deve_falhar(adm, format($c$SELECT pedido_registrar_saida(%L, jsonb_build_array(jsonb_build_object('pedido_item_id', %L, 'quantidade', 0)), 'retirada')$c$, ped, i_cim), 'retirada sem quantidade');
  PERFORM ci.deve_falhar(adm, format($c$SELECT pedido_registrar_saida(%L, '[]'::jsonb, 'retirada')$c$, ped), 'retirada sem itens');
  PERFORM ci.exige((SELECT quantidade_entregue FROM pedido_itens WHERE id = i_cim) = 4, 'retirada recusada não muda o saldo');

  -- o que está agendado também conta contra o saldo
  PERFORM ci.entrar(adm);
  plan := planejar_entrega(ped, jsonb_build_array(jsonb_build_object('pedido_item_id', i_cim, 'quantidade', 2)), NULL, NULL, current_date + 1);
  PERFORM ci.sair();
  PERFORM ci.deve_falhar(adm, format($c$SELECT pedido_registrar_saida(%L, jsonb_build_array(jsonb_build_object('pedido_item_id', %L, 'quantidade', 5)), 'retirada')$c$, ped, i_cim), 'retirar o que já está agendado');
  PERFORM ci.deve_falhar(adm, format($c$SELECT planejar_entrega(%L, jsonb_build_array(jsonb_build_object('pedido_item_id', %L, 'quantidade', 5)))$c$, ped, i_cim), 'agendar acima do saldo livre');

  -- reagendar a entrega exige motivo e fica no histórico da obra
  PERFORM ci.deve_falhar(adm, format($c$SELECT entrega_agendar(%L, current_date + 3)$c$, plan), 'reagendar sem motivo');
  PERFORM ci.entrar(adm);
  PERFORM entrega_agendar(plan, current_date + 3, 'Rua das Obras, 10', 'Mestre Zé', 'chuva prevista');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT reagendamentos = 1 AND previsao_data = current_date + 3 AND responsavel = 'Mestre Zé' FROM entregas WHERE id = plan), 'reagendamento muda a data e conta uma vez');
  PERFORM ci.exige((SELECT count(*) FROM entrega_reagendamentos WHERE entrega_id = plan AND motivo = 'chuva prevista'
                       AND data_anterior = current_date + 1 AND data_nova = current_date + 3) = 1, 'reagendamento guarda de, para e motivo');

  -- cada insucesso fica guardado, mesmo depois de reagendar a entrega
  PERFORM ci.entrar(adm);
  PERFORM entrega_insucesso(plan, 'Obra fechada');
  PERFORM entrega_agendar(plan, current_date + 4, NULL, NULL, 'obra reabre');
  PERFORM entrega_insucesso(plan, 'Cliente ausente');
  PERFORM entrega_agendar(plan, current_date + 5, NULL, NULL, 'cliente confirmou');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT situacao FROM entregas WHERE id = plan) = 'planejada', 'entrega reagendada volta a planejada');
  PERFORM ci.exige((SELECT count(*) FROM entrega_tentativas WHERE entrega_id = plan) = 2, 'as duas tentativas que falharam ficam guardadas');
  PERFORM ci.exige((SELECT array_agg(motivo ORDER BY created_at, motivo) FROM entrega_tentativas WHERE entrega_id = plan) = ARRAY['Cliente ausente', 'Obra fechada'], 'cada tentativa guarda o seu motivo');
  PERFORM ci.exige(ci.contar(adm, format('SELECT count(*) FROM entrega_tentativas WHERE entrega_id = %L', plan)) = 2, 'gestão lê as tentativas');
  PERFORM ci.exige(ci.contar(gar, 'SELECT count(*) FROM entrega_tentativas') = 0, 'garçom não lê as tentativas');
  PERFORM ci.deve_falhar(adm, format($c$INSERT INTO entrega_tentativas (tenant_id, entrega_id, motivo) VALUES (%L, %L, 'x')$c$, demo, plan), 'inserir tentativa direto');

  -- ocorrências do pedido: avaria pede descrição, substituição pede o produto novo
  PERFORM ci.deve_falhar(adm, format($c$SELECT pedido_registrar_ocorrencia(%L, 'avaria', 1, 'entrega')$c$, i_areia), 'avaria sem descrição');
  PERFORM ci.deve_falhar(adm, format($c$SELECT pedido_registrar_ocorrencia(%L, 'substituicao', 1, 'entrega')$c$, i_areia), 'substituição sem produto');
  PERFORM ci.entrar(adm);
  PERFORM pedido_registrar_ocorrencia(i_areia, 'avaria', 1, 'entrega', NULL, 'um m³ contaminado');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT count(*) FROM pedido_ocorrencias WHERE pedido_id = ped) = 1, 'ocorrência registrada no pedido');
  PERFORM ci.exige(ci.contar(adm, format('SELECT count(*) FROM entrega_reagendamentos WHERE entrega_id = %L', plan)) = 3, 'gestão lê o histórico de reagendamentos');
  PERFORM ci.exige(ci.contar(gar, 'SELECT count(*) FROM pedido_ocorrencias') = 0, 'garçom não lê ocorrências');
  PERFORM ci.exige(ci.contar(gar, 'SELECT count(*) FROM entrega_reagendamentos') = 0, 'garçom não lê reagendamentos');
  PERFORM ci.deve_falhar(gar, format($c$SELECT entrega_agendar(%L, current_date + 5, NULL, NULL, 'x')$c$, plan), 'garçom reagenda entrega');
  PERFORM ci.deve_falhar(gar, format($c$SELECT pedido_registrar_ocorrencia(%L, 'falta', 1, 'entrega', NULL, 'x')$c$, i_areia), 'garçom registra ocorrência');

  -- 2ª retirada: os 4 sacos livres e a areia toda
  PERFORM ci.entrar(adm);
  ent2 := pedido_registrar_saida(ped, jsonb_build_array(
      jsonb_build_object('pedido_item_id', i_cim, 'quantidade', 4),
      jsonb_build_object('pedido_item_id', i_areia, 'quantidade', 4)), 'retirada', 'Maria', NULL, 'chave-ret-2');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT quantidade_entregue FROM pedido_itens WHERE id = i_cim) = 8, 'cimento: 8 de 10 saíram');
  PERFORM ci.exige((SELECT situacao FROM pedidos WHERE id = ped) = 'em_rota', 'com o agendado ainda por sair o pedido continua aberto');

  -- os 2 sacos agendados saem pela própria entrega agendada (e não por uma retirada avulsa)
  PERFORM ci.entrar(adm);
  PERFORM entrega_concluir(plan, 'Zé');
  PERFORM ci.sair();
  SELECT quantidade, reservado INTO q, r FROM estoques WHERE produto_id = cim AND deposito_id = dep;
  PERFORM ci.exige(q = 90 AND r = 0, 'depois de tudo: 10 sacos baixados e nenhuma reserva sobrando');
  PERFORM ci.exige((SELECT situacao FROM pedidos WHERE id = ped) = 'entregue', 'pedido entregue quando não resta nada');
  PERFORM ci.deve_falhar(adm, format($c$SELECT pedido_registrar_saida(%L, jsonb_build_array(jsonb_build_object('pedido_item_id', %L, 'quantidade', 1)), 'retirada')$c$, ped, i_cim), 'retirar depois de entregue');

  -- perfis sem acesso e outra empresa
  PERFORM ci.deve_falhar(gar, format($c$SELECT pedido_registrar_saida(%L, '[]'::jsonb)$c$, ped), 'garçom registra saída de pedido');
  PERFORM ci.deve_falhar(NULL, format($c$SELECT pedido_registrar_saida(%L, '[]'::jsonb)$c$, ped), 'anon registra saída de pedido');
END $$;

-- 22. Fase 0: comissão só pelo fluxo, venda sem duplicar, nota protegida, referências da mesma empresa, papéis atômicos
DO $$
DECLARE
  demo   constant uuid := '11111111-1111-1111-1111-111111111111';
  emp    constant uuid := '22222222-2222-2222-2222-222222222222';
  adm    constant uuid := 'a0000000-0000-0000-0000-000000000001';
  vend   constant uuid := 'a0000000-0000-0000-0000-000000000002';
  novo   constant uuid := 'a0000000-0000-0000-0000-000000000004';
  gest   constant uuid := 'a0000000-0000-0000-0000-000000000005';
  gar    constant uuid := 'a0000000-0000-0000-0000-000000000006';
  dep uuid; prod uuid; cli uuid; ped uuid; ped2 uuid; nota uuid; cx uuid; v1 uuid; v2 uuid; v3 uuid;
  q_antes numeric; q_depois numeric; n_mov_antes bigint; n_mov_depois bigint;
  tb uuid; eb uuid; fb uuid; cb uuid; obb uuid; profb uuid; chave_venda uuid := gen_random_uuid();
  n_com bigint;
  cxa  constant uuid := 'a0000000-0000-0000-0000-0000000000a1';
  n_nota bigint;
BEGIN
  INSERT INTO depositos (tenant_id, nome) VALUES (demo, 'Fase0 CI') RETURNING id INTO dep;
  INSERT INTO produtos (tenant_id, codigo_interno, descricao, unidade, custo) VALUES (demo, 'F0-ITEM', 'Item Fase 0', 'un', 5) RETURNING id INTO prod;
  INSERT INTO clientes (tenant_id, nome) VALUES (demo, 'Cliente Fase 0') RETURNING id INTO cli;
  PERFORM ci.entrar(adm);
  PERFORM registrar_movimentacao(prod, dep, 'entrada'::mov_tipo, 100, 'ci', 'ci');
  PERFORM ci.sair();

  -- R3: comissão não se cria por chamada direta, e o fluxo do pedido entregue segue gerando
  INSERT INTO vendedor_comissao_regras (tenant_id, vendedor_id, percentual, base, ativo) VALUES (demo, vend, 10, 'venda', true);
  PERFORM ci.entrar(vend);
  ped := criar_pedido_direto(cli, dep, jsonb_build_array(jsonb_build_object('produto_id', prod, 'quantidade', 2, 'preco_unitario', 50)));
  PERFORM ci.sair();
  PERFORM ci.deve_falhar(adm, format($c$SELECT comissionar_pedido_id(%L)$c$, ped), 'chamar comissionar_pedido_id direto');
  UPDATE pedidos SET situacao = 'entregue' WHERE id = ped;
  PERFORM ci.exige((SELECT count(*) FROM comissoes WHERE pedido_id = ped) = 1, 'pedido entregue gera a comissão pelo fluxo');
  PERFORM ci.exige((SELECT valor FROM comissoes WHERE pedido_id = ped) = 10, 'comissão de 10% sobre 100');

  -- R4: a mesma venda enviada duas vezes grava uma só
  PERFORM ci.entrar(adm);
  cx := frente_caixa_atual();
  PERFORM ci.exige(cx IS NOT NULL, 'o administrador está com um caixa aberto para a venda de teste');
  SELECT quantidade INTO q_antes FROM estoques WHERE produto_id = prod AND deposito_id = dep;
  SELECT count(*) INTO n_mov_antes FROM caixa_movimentos WHERE caixa_id = cx;
  v1 := frente_venda(dep, jsonb_build_array(jsonb_build_object('produto_id', prod, 'quantidade', 3, 'preco_unitario', 10)), 'dinheiro', NULL, 0, 1, NULL, NULL, chave_venda);
  v2 := frente_venda(dep, jsonb_build_array(jsonb_build_object('produto_id', prod, 'quantidade', 3, 'preco_unitario', 10)), 'dinheiro', NULL, 0, 1, NULL, NULL, chave_venda);
  PERFORM ci.sair();
  SELECT quantidade INTO q_depois FROM estoques WHERE produto_id = prod AND deposito_id = dep;
  SELECT count(*) INTO n_mov_depois FROM caixa_movimentos WHERE caixa_id = cx;
  PERFORM ci.exige(v1 = v2, 'reenviar a venda com a mesma chave devolve a mesma venda');
  PERFORM ci.exige((SELECT count(*) FROM pedidos WHERE chave_idempotencia = chave_venda) = 1, 'só uma venda gravada para a chave');
  PERFORM ci.exige(q_antes - q_depois = 3, 'o estoque saiu uma vez só');
  PERFORM ci.exige(n_mov_depois - n_mov_antes = 1, 'o caixa recebeu uma vez só');
  PERFORM ci.entrar(adm);
  v3 := frente_venda(dep, jsonb_build_array(jsonb_build_object('produto_id', prod, 'quantidade', 1, 'preco_unitario', 10)), 'dinheiro', NULL, 0, 1, NULL, NULL, gen_random_uuid());
  PERFORM ci.sair();
  PERFORM ci.exige(v3 <> v1, 'outra chave é outra venda');
  PERFORM ci.exige(ci.contar(adm, format($c$SELECT count(*) FROM pedidos WHERE tenant_id = %L AND chave_idempotencia IS NOT NULL$c$, demo)) = 2, 'a chave fica guardada na venda');

  -- R2: o andamento da nota não muda por escrita direta; o dono do banco (funções e servidor) muda
  PERFORM ci.entrar(adm);
  nota := gerar_nfe(ped);
  PERFORM ci.sair();
  -- vendedor e caixa emitem a nota do balcão pelas funções, mas não escrevem na tabela: zero linhas
  PERFORM ci.entrar(vend);
  UPDATE nfe SET situacao = 'autorizada' WHERE id = nota;
  GET DIAGNOSTICS n_com = ROW_COUNT;
  UPDATE nfe SET valor_total = 0.01 WHERE id = nota;
  GET DIAGNOSTICS n_nota = ROW_COUNT;
  PERFORM ci.sair();
  PERFORM ci.exige(n_com = 0 AND n_nota = 0 AND (SELECT situacao <> 'autorizada' AND valor_total <> 0.01 FROM nfe WHERE id = nota), 'vendedor não reescreve a nota direto na tabela');
  PERFORM ci.entrar(cxa);
  UPDATE nfe SET valor_total = 0.01 WHERE id = nota;
  GET DIAGNOSTICS n_nota = ROW_COUNT;
  PERFORM ci.sair();
  PERFORM ci.exige(n_nota = 0, 'caixa não reescreve a nota direto na tabela');
  PERFORM ci.deve_falhar(adm, format($c$UPDATE nfe SET chave = '1234' WHERE id = %L$c$, nota), 'administrador altera a chave da nota');
  PERFORM ci.deve_falhar(adm, format($c$UPDATE nfe SET retorno = '{"x":1}'::jsonb WHERE id = %L$c$, nota), 'administrador altera o retorno do emissor');
  UPDATE nfe SET situacao = 'autorizada', chave = 'CHAVE-CI' WHERE id = nota;
  PERFORM ci.exige((SELECT situacao = 'autorizada' AND chave = 'CHAVE-CI' FROM nfe WHERE id = nota), 'o servidor (dono do banco) registra o retorno da Sefaz');

  -- R5: referências de outra empresa
  INSERT INTO tenants (nome) VALUES ('Fase 0 B') RETURNING id INTO tb;
  INSERT INTO empresas (tenant_id, razao_social) VALUES (tb, 'B Fase 0') RETURNING id INTO eb;
  INSERT INTO filiais (tenant_id, empresa_id, nome) VALUES (tb, eb, 'Filial B') RETURNING id INTO fb;
  INSERT INTO clientes (tenant_id, nome) VALUES (tb, 'Cliente B') RETURNING id INTO cb;
  INSERT INTO obras (tenant_id, cliente_id, nome) VALUES (tb, cb, 'Obra B') RETURNING id INTO obb;
  INSERT INTO profissionais (tenant_id, nome) VALUES (tb, 'Profissional B') RETURNING id INTO profb;
  PERFORM ci.deve_falhar(adm, format($c$SELECT abrir_caixa(%L, 0)$c$, fb), 'abrir caixa na filial de outra empresa');
  PERFORM ci.deve_falhar(adm, format($c$SELECT criar_pedido_direto(%L, %L, jsonb_build_array(jsonb_build_object('produto_id', %L, 'quantidade', 1, 'preco_unitario', 10)), %L)$c$, cli, dep, prod, obb), 'pedido com obra de outra empresa');
  PERFORM ci.deve_falhar(adm, format($c$SELECT criar_pedido_direto(%L, %L, jsonb_build_array(jsonb_build_object('produto_id', %L, 'quantidade', 1, 'preco_unitario', 10)), NULL, 0, 0, NULL, NULL, %L)$c$, cli, dep, prod, novo), 'pedido com vendedor de outra empresa');
  PERFORM ci.deve_falhar(adm, format($c$SELECT criar_pedido_direto(%L, %L, jsonb_build_array(jsonb_build_object('produto_id', %L, 'quantidade', 1, 'preco_unitario', 10)), NULL, 0, 0, NULL, NULL, NULL, %L)$c$, cli, dep, prod, profb), 'pedido com profissional de outra empresa');
  -- da mesma empresa segue funcionando
  PERFORM ci.entrar(adm);
  ped2 := criar_pedido_direto(cli, dep, jsonb_build_array(jsonb_build_object('produto_id', prod, 'quantidade', 1, 'preco_unitario', 10)), NULL, 0, 0, NULL, NULL, vend);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT vendedor_id = vend FROM pedidos WHERE id = ped2), 'pedido com vendedor da própria empresa');

  -- R7: trocar os papéis é uma transação, só pelo administrador, só na própria empresa
  PERFORM ci.entrar(adm);
  PERFORM usuario_definir_papeis(gest, ARRAY['gestor', 'caixa', 'caixa']::app_role[]);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT array_agg(role::text ORDER BY role::text) FROM user_roles WHERE user_id = gest) = ARRAY['caixa', 'gestor'], 'papéis trocados por completo e sem repetir');
  PERFORM ci.deve_falhar(gest, format($c$SELECT usuario_definir_papeis(%L, ARRAY['administrador']::app_role[])$c$, gest), 'gestor se dá o papel de administrador');
  PERFORM ci.deve_falhar(adm, format($c$SELECT usuario_definir_papeis(%L, ARRAY[]::app_role[])$c$, gest), 'trocar para nenhum papel');
  PERFORM ci.deve_falhar(adm, format($c$SELECT usuario_definir_papeis(%L, ARRAY['gestor']::app_role[])$c$, novo), 'trocar papéis de usuário de outra empresa');
  PERFORM ci.deve_falhar(adm, format($c$SELECT usuario_definir_papeis(%L, ARRAY['gestor']::app_role[])$c$, adm), 'administrador tira o próprio perfil de administrador');
  PERFORM ci.deve_falhar(gar, format($c$SELECT usuario_definir_papeis(%L, ARRAY['gestor']::app_role[])$c$, gest), 'garçom troca papéis');
  PERFORM ci.exige((SELECT count(*) FROM user_roles WHERE user_id = gest) = 2, 'tentativas recusadas não mexem nos papéis');
  PERFORM ci.exige(NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = novo AND role = 'gestor'), 'usuário de outra empresa segue como estava');
  DELETE FROM user_roles WHERE user_id = gest AND role = 'caixa';  -- volta ao que os outros blocos esperam
END $$;

-- 23. Fase 0: papéis valem no banco (tabela aprovada na seção 9 do diagnóstico)
DO $$
DECLARE
  msg_nota text;
  demo constant uuid := '11111111-1111-1111-1111-111111111111';
  adm  constant uuid := 'a0000000-0000-0000-0000-000000000001';
  vend constant uuid := 'a0000000-0000-0000-0000-000000000002';
  gest constant uuid := 'a0000000-0000-0000-0000-000000000005';
  gar  constant uuid := 'a0000000-0000-0000-0000-000000000006';
  cxa  constant uuid := 'a0000000-0000-0000-0000-0000000000a1';
  est  constant uuid := 'a0000000-0000-0000-0000-0000000000b1';
  fin  constant uuid := 'a0000000-0000-0000-0000-0000000000b2';
  logi constant uuid := 'a0000000-0000-0000-0000-0000000000b3';
  mt1  constant uuid := 'a0000000-0000-0000-0000-0000000000b4';
  mt2  constant uuid := 'a0000000-0000-0000-0000-0000000000b5';
  dep uuid; prod uuid; cli uuid; p1 uuid; p2 uuid; p3 uuid; p4 uuid; p5 uuid; nota uuid; mot1 uuid; mot2 uuid; ent uuid;
  item1 uuid; n bigint; contas_antes bigint; papel text; u uuid; q_antes numeric; q_depois numeric;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (est, 'est@ci'), (fin, 'fin@ci'), (logi, 'log@ci'), (mt1, 'mt1@ci'), (mt2, 'mt2@ci');
  UPDATE profiles SET tenant_id = demo WHERE id IN (est, fin, logi, mt1, mt2);
  INSERT INTO user_roles (user_id, tenant_id, role) VALUES
    (est, demo, 'estoquista'), (fin, demo, 'financeiro'), (logi, demo, 'logistica'),
    (mt1, demo, 'motorista'), (mt2, demo, 'motorista');
  INSERT INTO motoristas (tenant_id, empresa_id, filial_id, nome, cnh, categoria_cnh, validade_cnh, user_id)
    VALUES (demo, '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333', 'Motorista 1 CI', '1', 'B', '2030-01-01', mt1) RETURNING id INTO mot1;
  INSERT INTO motoristas (tenant_id, empresa_id, filial_id, nome, cnh, categoria_cnh, validade_cnh, user_id)
    VALUES (demo, '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333', 'Motorista 2 CI', '2', 'B', '2030-01-01', mt2) RETURNING id INTO mot2;

  INSERT INTO depositos (tenant_id, nome) VALUES (demo, 'Papéis CI') RETURNING id INTO dep;
  INSERT INTO produtos (tenant_id, codigo_interno, descricao, unidade, custo, preco_venda) VALUES (demo, 'PAP-ITEM', 'Item Papéis', 'un', 5, 10) RETURNING id INTO prod;
  INSERT INTO clientes (tenant_id, nome) VALUES (demo, 'Cliente Papéis') RETURNING id INTO cli;
  PERFORM ci.entrar(est);
  PERFORM registrar_movimentacao(prod, dep, 'entrada'::mov_tipo, 100, 'ci', 'ci');
  PERFORM ci.sair();

  -- estoque: só administrador, gestor e estoquista fazem entrada e ajuste
  FOREACH papel IN ARRAY ARRAY['vendedor', 'caixa', 'financeiro', 'logistica', 'motorista'] LOOP
    u := CASE papel WHEN 'vendedor' THEN vend WHEN 'caixa' THEN cxa WHEN 'financeiro' THEN fin WHEN 'logistica' THEN logi ELSE mt1 END;
    PERFORM ci.deve_falhar(u, format($c$SELECT registrar_movimentacao(%L, %L, 'entrada'::mov_tipo, 1, 'ci', 'ci')$c$, prod, dep), papel || ' dá entrada de estoque');
  END LOOP;
  PERFORM ci.entrar(gest);
  PERFORM registrar_movimentacao(prod, dep, 'entrada'::mov_tipo, 1, 'ci', 'ci');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT quantidade FROM estoques WHERE produto_id = prod AND deposito_id = dep) = 101, 'estoquista e gestor movimentam o estoque');

  -- quem vende segue baixando e reservando estoque pelo pedido (a função interna não passa pela conferência)
  PERFORM ci.entrar(vend);
  p1 := criar_pedido_direto(cli, dep, jsonb_build_array(jsonb_build_object('produto_id', prod, 'quantidade', 2, 'preco_unitario', 10)));
  p2 := criar_pedido_direto(cli, dep, jsonb_build_array(jsonb_build_object('produto_id', prod, 'quantidade', 2, 'preco_unitario', 10)));
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT reservado FROM estoques WHERE produto_id = prod AND deposito_id = dep) = 4, 'o vendedor reserva estoque ao criar o pedido');

  -- aprovar: administrador e gestor
  FOREACH papel IN ARRAY ARRAY['vendedor', 'caixa', 'financeiro', 'logistica', 'motorista', 'estoquista'] LOOP
    u := CASE papel WHEN 'vendedor' THEN vend WHEN 'caixa' THEN cxa WHEN 'financeiro' THEN fin WHEN 'logistica' THEN logi WHEN 'estoquista' THEN est ELSE mt1 END;
    PERFORM ci.deve_falhar(u, format($c$SELECT pedido_avancar_status(%L, 'aprovado')$c$, p1), papel || ' aprova pedido');
  END LOOP;
  PERFORM ci.entrar(gest);
  PERFORM pedido_avancar_status(p1, 'aprovado');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT situacao FROM pedidos WHERE id = p1) = 'aprovado', 'gestor aprova o pedido');

  -- separar e conferir: administrador, gestor e estoquista (e só eles gravam a separação)
  PERFORM ci.deve_falhar(logi, format($c$SELECT pedido_avancar_status(%L, 'separacao')$c$, p1), 'logística inicia a separação');
  PERFORM ci.entrar(est);
  PERFORM pedido_avancar_status(p1, 'separacao');
  PERFORM ci.sair();
  SELECT id INTO item1 FROM pedido_itens WHERE pedido_id = p1;
  PERFORM ci.entrar(vend);
  UPDATE pedido_itens SET quantidade_separada = 2 WHERE id = item1;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM ci.sair();
  PERFORM ci.exige(n = 0, 'vendedor não grava a separação');
  PERFORM ci.entrar(est);
  UPDATE pedido_itens SET quantidade_separada = 2 WHERE id = item1;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM ci.sair();
  PERFORM ci.exige(n = 1, 'estoquista grava a separação');
  PERFORM ci.deve_falhar(est, format($c$UPDATE pedido_itens SET preco_unitario = 0.01 WHERE id = %L$c$, item1), 'estoquista altera o preço do item');
  PERFORM ci.deve_falhar(adm, format($c$UPDATE pedido_itens SET total = 1 WHERE id = %L$c$, item1), 'administrador altera o total do item direto');
  PERFORM ci.entrar(est);
  PERFORM pedido_avancar_status(p1, 'separado');
  PERFORM pedido_avancar_status(p1, 'conferencia');
  UPDATE pedido_itens SET quantidade_conferida = 2 WHERE id = item1;
  PERFORM pedido_avancar_status(p1, 'pronto_entrega');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT situacao FROM pedidos WHERE id = p1) = 'pronto_entrega', 'estoquista leva o pedido até pronto para entrega');

  -- pedido: ninguém grava direto; só as funções
  PERFORM ci.deve_falhar(adm, format($c$UPDATE pedidos SET total = 1, situacao = 'concluido' WHERE id = %L$c$, p1), 'administrador altera o pedido direto');
  PERFORM ci.deve_falhar(adm, format($c$DELETE FROM pedidos WHERE id = %L$c$, p1), 'administrador apaga o pedido direto');
  PERFORM ci.deve_falhar(adm, format($c$INSERT INTO pedido_historico (tenant_id, pedido_id, situacao_nova) VALUES (%L, %L, 'concluido')$c$, demo, p1), 'escrever no histórico do pedido direto');

  -- planejar entrega e rota: administrador, gestor e logística; concluir: o motorista só a própria
  PERFORM ci.deve_falhar(vend, format($c$SELECT planejar_entrega(%L, jsonb_build_array(jsonb_build_object('pedido_item_id', %L, 'quantidade', 2)), NULL, %L, current_date)$c$, p1, item1, mot1), 'vendedor planeja entrega');
  PERFORM ci.deve_falhar(mt1, format($c$SELECT planejar_entrega(%L, jsonb_build_array(jsonb_build_object('pedido_item_id', %L, 'quantidade', 2)), NULL, %L, current_date)$c$, p1, item1, mot1), 'motorista planeja entrega');
  PERFORM ci.entrar(logi);
  ent := planejar_entrega(p1, jsonb_build_array(jsonb_build_object('pedido_item_id', item1, 'quantidade', 2)), NULL, mot1, current_date);
  PERFORM ci.sair();
  PERFORM ci.exige(ent IS NOT NULL, 'logística planeja a entrega');
  PERFORM ci.deve_falhar(mt2, format($c$SELECT entrega_concluir(%L, 'Fulano')$c$, ent), 'motorista conclui a entrega de outro');
  PERFORM ci.deve_falhar(mt2, format($c$SELECT entrega_insucesso(%L, 'Cliente ausente')$c$, ent), 'motorista registra insucesso na entrega de outro');
  PERFORM ci.deve_falhar(vend, format($c$SELECT entrega_concluir(%L, 'Fulano')$c$, ent), 'vendedor conclui entrega');
  PERFORM ci.entrar(mt1);
  PERFORM entrega_concluir(ent, 'Fulano');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT situacao FROM entregas WHERE id = ent) = 'entregue', 'o motorista conclui a própria entrega');
  PERFORM ci.exige((SELECT situacao FROM pedidos WHERE id = p1) = 'entregue', 'pedido entregue ao concluir a entrega');

  -- cancelar pedido: administrador e gestor
  PERFORM ci.deve_falhar(vend, format($c$SELECT pedido_avancar_status(%L, 'cancelado', 'x')$c$, p2), 'vendedor cancela pedido');
  PERFORM ci.deve_falhar(est, format($c$SELECT pedido_avancar_status(%L, 'cancelado', 'x')$c$, p2), 'estoquista cancela pedido');
  PERFORM ci.entrar(gest);
  PERFORM pedido_avancar_status(p2, 'cancelado', 'ci');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT situacao FROM pedidos WHERE id = p2) = 'cancelado', 'gestor cancela o pedido');

  -- receber o pagamento: caixa, financeiro, gestor e administrador; o recebimento aprova o pedido por dentro
  PERFORM ci.entrar(vend);
  p3 := criar_pedido_direto(cli, dep, jsonb_build_array(jsonb_build_object('produto_id', prod, 'quantidade', 1, 'preco_unitario', 10)));
  PERFORM ci.sair();
  PERFORM ci.deve_falhar(vend, format($c$SELECT pedido_checkout(%L, 10, 'dinheiro')$c$, p3), 'vendedor recebe o pagamento do pedido');
  PERFORM ci.deve_falhar(mt1, format($c$SELECT pedido_checkout(%L, 10, 'dinheiro')$c$, p3), 'motorista recebe o pagamento do pedido');
  PERFORM ci.entrar(cxa);
  PERFORM pedido_checkout(p3, 10, 'dinheiro');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT situacao FROM pedidos WHERE id = p3) = 'aprovado', 'o caixa recebe e o pedido é aprovado, sem ser administrador nem gestor');

  -- contas a receber
  PERFORM ci.entrar(vend);
  p4 := criar_pedido_direto(cli, dep, jsonb_build_array(jsonb_build_object('produto_id', prod, 'quantidade', 1, 'preco_unitario', 10)));
  PERFORM ci.sair();
  PERFORM ci.deve_falhar(vend, format($c$SELECT gerar_contas_receber(%L, 1, current_date + 30, 'boleto')$c$, p4), 'vendedor gera contas a receber');
  PERFORM ci.deve_falhar(mt1, format($c$SELECT gerar_contas_receber(%L, 1, current_date + 30, 'boleto')$c$, p4), 'motorista gera contas a receber');
  PERFORM ci.entrar(fin);
  PERFORM gerar_contas_receber(p4, 2, current_date + 30, 'boleto');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT count(*) FROM contas_receber WHERE pedido_id = p4) = 2, 'financeiro gera as contas a receber');
  -- a venda a prazo de um vendedor no PDV segue gerando as parcelas (usa a função interna)
  PERFORM ci.entrar(vend);
  p5 := pdv_venda(dep, jsonb_build_array(jsonb_build_object('produto_id', prod, 'quantidade', 1, 'preco_unitario', 10)), 'crediario', cli, 0, 2, current_date + 30);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT count(*) FROM contas_receber WHERE pedido_id = p5) = 2, 'venda a prazo no PDV de um vendedor gera as parcelas');
  -- ninguém apaga conta a receber; só quem recebe altera
  PERFORM ci.deve_falhar(adm, format($c$DELETE FROM contas_receber WHERE pedido_id = %L$c$, p4), 'apagar conta a receber');
  PERFORM ci.entrar(mt1);
  UPDATE contas_receber SET observacoes = 'x' WHERE pedido_id = p4;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM ci.sair();
  PERFORM ci.exige(n = 0, 'motorista não altera conta a receber');
  PERFORM ci.entrar(fin);
  UPDATE contas_receber SET observacoes = 'ok' WHERE pedido_id = p4;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM ci.sair();
  PERFORM ci.exige(n = 2, 'financeiro altera conta a receber');

  -- nota fiscal: administrador, gestor, financeiro, vendedor e caixa (o balcão emite a nota do PDV)
  FOREACH papel IN ARRAY ARRAY['estoquista', 'logistica', 'motorista'] LOOP
    u := CASE papel WHEN 'estoquista' THEN est WHEN 'logistica' THEN logi ELSE mt1 END;
    PERFORM ci.deve_falhar(u, format($c$SELECT gerar_nfe(%L)$c$, p4), papel || ' emite nota');
  END LOOP;
  PERFORM ci.entrar(fin);
  nota := gerar_nfe(p4);
  PERFORM ci.sair();
  PERFORM ci.exige(nota IS NOT NULL, 'financeiro emite a nota');
  PERFORM ci.entrar(vend);
  PERFORM nfe_calcular_impostos(nota);
  PERFORM ci.sair();
  -- o caixa passa pela conferência de papel: a recusa que sobra é a de nota repetida, não a de permissão
  PERFORM ci.entrar(cxa);
  BEGIN
    PERFORM gerar_nfe(p4);
  EXCEPTION WHEN OTHERS THEN
    msg_nota := SQLERRM;
  END;
  PERFORM ci.sair();
  PERFORM ci.exige(msg_nota LIKE '%já tem nota fiscal%', 'caixa chega à emissão da nota');
  PERFORM ci.deve_falhar(mt1, format($c$SELECT nfe_calcular_impostos(%L)$c$, nota), 'motorista recalcula os impostos da nota');
  PERFORM ci.entrar(fin);
  PERFORM nfe_calcular_impostos(nota);
  PERFORM ci.sair();
  PERFORM ci.entrar(est);
  UPDATE nfe_itens SET aliquota_icms = 99 WHERE nfe_id = nota;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM ci.sair();
  PERFORM ci.exige(n = 0, 'estoquista não altera item de nota');

  -- preço e custo de produto: administrador e gestor
  PERFORM ci.deve_falhar(est, format($c$UPDATE produtos SET preco_venda = 0.01 WHERE id = %L$c$, prod), 'estoquista muda o preço');
  PERFORM ci.deve_falhar(vend, format($c$UPDATE produtos SET custo = 0.01 WHERE id = %L$c$, prod), 'vendedor muda o custo');
  PERFORM ci.entrar(est);
  UPDATE produtos SET descricao = 'Item Papéis (ok)' WHERE id = prod;
  PERFORM ci.sair();
  PERFORM ci.entrar(gest);
  UPDATE produtos SET preco_venda = 12 WHERE id = prod;
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT preco_venda = 12 FROM produtos WHERE id = prod), 'gestor muda o preço; estoquista muda a descrição');

  -- dados fiscais da empresa e da filial: administrador
  PERFORM ci.entrar(gest);
  UPDATE empresas SET inscricao_estadual = 'GESTOR' WHERE tenant_id = demo;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM ci.sair();
  PERFORM ci.exige(n = 0, 'gestor não altera os dados da empresa');
  PERFORM ci.entrar(adm);
  UPDATE empresas SET inscricao_estadual = inscricao_estadual WHERE tenant_id = demo;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM ci.sair();
  PERFORM ci.exige(n >= 1, 'administrador altera os dados da empresa');
  PERFORM ci.deve_falhar(gest, format($c$INSERT INTO filiais (tenant_id, empresa_id, nome) VALUES (%L, '22222222-2222-2222-2222-222222222222', 'Filial do gestor')$c$, demo), 'gestor cria filial');

  -- caixa: administrador, gestor e caixa
  PERFORM ci.deve_falhar(fin, format($c$SELECT abrir_caixa('33333333-3333-3333-3333-333333333333', 0)$c$), 'financeiro abre caixa');

  -- inventário: administrador, gestor e estoquista
  PERFORM ci.deve_falhar(vend, format($c$SELECT inventario_aplicar(%L)$c$, gen_random_uuid()), 'vendedor aplica inventário');

  -- o garçom segue fora de tudo isso
  PERFORM ci.deve_falhar(gar, format($c$SELECT gerar_nfe(%L)$c$, p4), 'garçom emite nota');
END $$;

-- 24. Fase 0 / R13: acesso por filial (administrador, gestor e usuário sem filial veem todas; os demais só a própria)
DO $$
DECLARE
  demo constant uuid := '11111111-1111-1111-1111-111111111111';
  emp  constant uuid := '22222222-2222-2222-2222-222222222222';
  fa   constant uuid := '33333333-3333-3333-3333-333333333333';
  adm  constant uuid := 'a0000000-0000-0000-0000-000000000001';
  vend constant uuid := 'a0000000-0000-0000-0000-000000000002';
  gest constant uuid := 'a0000000-0000-0000-0000-000000000005';
  cxa  constant uuid := 'a0000000-0000-0000-0000-0000000000a1';
  est  constant uuid := 'a0000000-0000-0000-0000-0000000000b1';
  fb uuid; da uuid; db uuid; dsem uuid; prod uuid; cli uuid; pa uuid; pb uuid; item_b uuid; n bigint;
  itens jsonb;
BEGIN
  INSERT INTO filiais (tenant_id, empresa_id, nome) VALUES (demo, emp, 'Filial R13') RETURNING id INTO fb;
  INSERT INTO depositos (tenant_id, filial_id, nome) VALUES (demo, fa, 'Dep A R13') RETURNING id INTO da;
  INSERT INTO depositos (tenant_id, filial_id, nome) VALUES (demo, fb, 'Dep B R13') RETURNING id INTO db;
  INSERT INTO depositos (tenant_id, nome) VALUES (demo, 'Dep geral R13') RETURNING id INTO dsem;
  INSERT INTO produtos (tenant_id, codigo_interno, descricao, unidade, custo, preco_venda) VALUES (demo, 'R13-ITEM', 'Item R13', 'un', 5, 10) RETURNING id INTO prod;
  INSERT INTO clientes (tenant_id, nome) VALUES (demo, 'Cliente R13') RETURNING id INTO cli;
  itens := jsonb_build_array(jsonb_build_object('produto_id', prod, 'quantidade', 1, 'preco_unitario', 10));

  PERFORM ci.entrar(adm);
  PERFORM registrar_movimentacao(prod, da, 'entrada'::mov_tipo, 50, 'ci', 'ci');
  PERFORM registrar_movimentacao(prod, db, 'entrada'::mov_tipo, 50, 'ci', 'ci');
  pa := criar_pedido_direto(cli, da, itens);
  pb := criar_pedido_direto(cli, db, itens);
  PERFORM ci.sair();
  SELECT id INTO item_b FROM pedido_itens WHERE pedido_id = pb;
  PERFORM ci.exige((SELECT filial_id = fb FROM pedidos WHERE id = pb), 'o pedido herda a filial do depósito');

  -- vendedor, caixa e estoquista da filial A
  UPDATE profiles SET filial_id = fa WHERE id IN (vend, cxa, est);
  -- gestor também tem filial no perfil, mas a gestão vê todas
  UPDATE profiles SET filial_id = fa WHERE id = gest;

  -- leitura: só a própria filial (e o que não tem filial)
  PERFORM ci.exige(ci.contar(vend, format($c$SELECT count(*) FROM pedidos WHERE id = %L$c$, pa)) = 1, 'vendedor vê o pedido da própria filial');
  PERFORM ci.exige(ci.contar(vend, format($c$SELECT count(*) FROM pedidos WHERE id = %L$c$, pb)) = 0, 'vendedor não vê o pedido de outra filial');
  PERFORM ci.exige(ci.contar(vend, format($c$SELECT count(*) FROM pedido_itens WHERE pedido_id = %L$c$, pb)) = 0, 'vendedor não vê os itens do pedido de outra filial');
  PERFORM ci.exige(ci.contar(vend, format($c$SELECT count(*) FROM depositos WHERE id IN (%L, %L, %L)$c$, da, db, dsem)) = 2, 'vendedor vê o depósito da filial e o geral, não o de outra filial');
  PERFORM ci.exige(ci.contar(est, format($c$SELECT count(*) FROM estoques WHERE deposito_id = %L$c$, db)) = 0, 'estoquista não vê o estoque de outra filial');
  PERFORM ci.exige(ci.contar(est, format($c$SELECT count(*) FROM estoques WHERE deposito_id = %L$c$, da)) = 1, 'estoquista vê o estoque da própria filial');

  -- escrita direta
  PERFORM ci.entrar(vend);
  UPDATE pedido_itens SET quantidade_separada = 1 WHERE id = item_b;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM ci.sair();
  PERFORM ci.exige(n = 0, 'vendedor não altera item de pedido de outra filial');
  PERFORM ci.entrar(est);
  UPDATE pedido_itens SET quantidade_separada = 1 WHERE id = item_b;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM ci.sair();
  PERFORM ci.exige(n = 0, 'estoquista da filial A não separa pedido da filial B');

  -- dentro das funções do banco
  PERFORM ci.deve_falhar(vend, format($c$SELECT criar_pedido_direto(%L, %L, %L::jsonb)$c$, cli, db, itens), 'vendedor cria pedido em depósito de outra filial');
  PERFORM ci.entrar(vend);
  PERFORM criar_pedido_direto(cli, da, itens);
  PERFORM ci.sair();
  PERFORM ci.deve_falhar(est, format($c$SELECT registrar_movimentacao(%L, %L, 'entrada'::mov_tipo, 5, 'ci', 'ci')$c$, prod, db), 'estoquista dá entrada em depósito de outra filial');
  PERFORM ci.entrar(est);
  PERFORM registrar_movimentacao(prod, da, 'entrada'::mov_tipo, 5, 'ci', 'ci');
  PERFORM ci.sair();
  PERFORM ci.deve_falhar(cxa, format($c$SELECT abrir_caixa(%L, 0)$c$, fb), 'caixa abre caixa em outra filial');
  PERFORM ci.deve_falhar(cxa, format($c$SELECT pedido_checkout(%L, 10, 'dinheiro'::forma_pagamento, 1, NULL, NULL)$c$, pb), 'caixa recebe pedido de outra filial');

  -- gestão vê e opera todas as filiais, mesmo com filial no perfil
  PERFORM ci.exige(ci.contar(gest, format($c$SELECT count(*) FROM pedidos WHERE id IN (%L, %L)$c$, pa, pb)) = 2, 'gestor vê as duas filiais');
  PERFORM ci.exige(ci.contar(adm, format($c$SELECT count(*) FROM pedidos WHERE id IN (%L, %L)$c$, pa, pb)) = 2, 'administrador vê as duas filiais');
  PERFORM ci.entrar(gest);
  PERFORM pedido_avancar_status(pb, 'aprovado');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT situacao = 'aprovado' FROM pedidos WHERE id = pb), 'gestor aprova pedido de outra filial');

  -- usuário sem filial no perfil (matriz) vê todas
  UPDATE profiles SET filial_id = NULL WHERE id = vend;
  PERFORM ci.exige(ci.contar(vend, format($c$SELECT count(*) FROM pedidos WHERE id IN (%L, %L)$c$, pa, pb)) = 2, 'usuário sem filial no perfil vê todas');

  -- volta ao que os outros blocos esperam
  UPDATE profiles SET filial_id = NULL WHERE id IN (vend, cxa, est, gest);
END $$;

-- 25. Fase 0 / R10: gravações em etapas viram uma transação só
DO $$
DECLARE
  demo constant uuid := '11111111-1111-1111-1111-111111111111';
  tb   uuid;
  adm  constant uuid := 'a0000000-0000-0000-0000-000000000001';
  vend constant uuid := 'a0000000-0000-0000-0000-000000000002';
  gest constant uuid := 'a0000000-0000-0000-0000-000000000005';
  cxa  constant uuid := 'a0000000-0000-0000-0000-0000000000a1';
  est  constant uuid := 'a0000000-0000-0000-0000-0000000000b1';
  logi constant uuid := 'a0000000-0000-0000-0000-0000000000b3';
  dep uuid; prod uuid; cli uuid; cli_b uuid; fil uuid; orc uuid; ped1 uuid; ped2 uuid; it1 uuid; it2 uuid; it_outro uuid;
  compra uuid; n_antes bigint; n_depois bigint; itens jsonb; itens_ruins jsonb; prod_b uuid;
BEGIN
  INSERT INTO depositos (tenant_id, nome) VALUES (demo, 'Dep R10') RETURNING id INTO dep;
  INSERT INTO produtos (tenant_id, codigo_interno, descricao, unidade, custo, preco_venda) VALUES (demo, 'R10-A', 'Item R10 A', 'un', 5, 10) RETURNING id INTO prod;
  INSERT INTO clientes (tenant_id, nome) VALUES (demo, 'Cliente R10') RETURNING id INTO cli;
  INSERT INTO tenants (nome) VALUES ('R10 B') RETURNING id INTO tb;
  INSERT INTO clientes (tenant_id, nome) VALUES (tb, 'Cliente R10 B') RETURNING id INTO cli_b;
  INSERT INTO produtos (tenant_id, codigo_interno, descricao, unidade, custo, preco_venda) VALUES (tb, 'R10-B', 'Item R10 B', 'un', 5, 10) RETURNING id INTO prod_b;

  -- filial extra: filial + depósito + configuração fiscal juntos, só o administrador
  UPDATE profiles SET empresa_id = '22222222-2222-2222-2222-222222222222' WHERE id IN (adm, gest);
  PERFORM ci.deve_falhar(gest, $c$SELECT filial_extra_criar('Filial R10')$c$, 'gestor cria filial extra');
  PERFORM ci.deve_falhar(adm, $c$SELECT filial_extra_criar(' ')$c$, 'filial extra sem nome');
  PERFORM ci.entrar(adm);
  fil := filial_extra_criar('Filial R10', 'F10', NULL, NULL, 'Cidade', 'SP');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT situacao = 'implantacao' AND cidade = 'Cidade' FROM filiais WHERE id = fil), 'filial extra criada em implantação');
  PERFORM ci.exige((SELECT count(*) = 1 FROM depositos WHERE filial_id = fil), 'filial extra com o depósito');
  PERFORM ci.exige((SELECT count(*) = 1 FROM fiscal_config WHERE filial_id = fil), 'filial extra com a configuração fiscal');
  UPDATE profiles SET empresa_id = NULL WHERE id IN (adm, gest);

  -- orçamento: cabeçalho + itens + total, ou nada
  itens := jsonb_build_array(
    jsonb_build_object('produto_id', prod, 'quantidade', 2, 'unidade', 'un', 'preco_unitario', 10, 'desconto', 1),
    jsonb_build_object('produto_id', prod, 'quantidade', 1, 'unidade', 'un', 'preco_unitario', 5, 'desconto', 0));
  itens_ruins := jsonb_build_array(
    jsonb_build_object('produto_id', prod, 'quantidade', 1, 'preco_unitario', 10, 'desconto', 0),
    jsonb_build_object('produto_id', prod_b, 'quantidade', 1, 'preco_unitario', 10, 'desconto', 0));
  PERFORM ci.deve_falhar(est, format($c$SELECT orcamento_salvar(%L, %L::jsonb)$c$, cli, itens), 'estoquista cria orçamento');
  SELECT count(*) INTO n_antes FROM orcamentos WHERE tenant_id = demo;
  PERFORM ci.deve_falhar(vend, format($c$SELECT orcamento_salvar(%L, %L::jsonb)$c$, cli, itens_ruins), 'orçamento com produto de outra empresa');
  PERFORM ci.deve_falhar(vend, format($c$SELECT orcamento_salvar(%L, '[]'::jsonb)$c$, cli), 'orçamento sem itens');
  PERFORM ci.deve_falhar(vend, format($c$SELECT orcamento_salvar(%L, %L::jsonb)$c$, cli_b, itens), 'orçamento com cliente de outra empresa');
  SELECT count(*) INTO n_depois FROM orcamentos WHERE tenant_id = demo;
  PERFORM ci.exige(n_antes = n_depois, 'orçamento recusado não deixa cabeçalho para trás');
  PERFORM ci.entrar(vend);
  orc := orcamento_salvar(cli, itens, NULL, NULL, NULL, NULL, '30 dias', NULL, 3, 2, NULL);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT subtotal = 24 AND total = 23 AND situacao = 'rascunho' FROM orcamentos WHERE id = orc), 'total do orçamento calculado no banco (24 - 3 + 2)');
  PERFORM ci.exige((SELECT count(*) = 2 FROM orcamento_itens WHERE orcamento_id = orc), 'orçamento com os dois itens');
  PERFORM ci.exige((SELECT vendedor_id = vend FROM orcamentos WHERE id = orc), 'vendedor padrão é quem salvou');

  -- separação e conferência: todos os itens ou nenhum
  PERFORM ci.entrar(adm);
  PERFORM registrar_movimentacao(prod, dep, 'entrada'::mov_tipo, 100, 'ci', 'ci');
  ped1 := criar_pedido_direto(cli, dep, jsonb_build_array(
    jsonb_build_object('produto_id', prod, 'quantidade', 3, 'preco_unitario', 10),
    jsonb_build_object('produto_id', prod, 'quantidade', 4, 'preco_unitario', 10)));
  ped2 := criar_pedido_direto(cli, dep, jsonb_build_array(jsonb_build_object('produto_id', prod, 'quantidade', 1, 'preco_unitario', 10)));
  PERFORM ci.sair();
  SELECT id INTO it1 FROM pedido_itens WHERE pedido_id = ped1 ORDER BY quantidade LIMIT 1;
  SELECT id INTO it2 FROM pedido_itens WHERE pedido_id = ped1 ORDER BY quantidade DESC LIMIT 1;
  SELECT id INTO it_outro FROM pedido_itens WHERE pedido_id = ped2;
  PERFORM ci.deve_falhar(vend, format($c$SELECT separacao_salvar(%L, '[{"id":"%s","quantidade_separada":1}]'::jsonb)$c$, ped1, it1), 'vendedor salva separação');
  PERFORM ci.deve_falhar(logi, format($c$SELECT conferencia_salvar(%L, '[{"id":"%s","quantidade_conferida":1}]'::jsonb)$c$, ped1, it1), 'logística salva conferência');
  PERFORM ci.deve_falhar(est, format($c$SELECT separacao_salvar(%L, '[{"id":"%s","quantidade_separada":1},{"id":"%s","quantidade_separada":1}]'::jsonb)$c$, ped1, it1, it_outro), 'separação com item de outro pedido');
  PERFORM ci.exige((SELECT quantidade_separada = 0 FROM pedido_itens WHERE id = it1), 'separação recusada não grava nem o item válido');
  PERFORM ci.deve_falhar(est, format($c$SELECT separacao_salvar(%L, '[{"id":"%s","quantidade_separada":-1}]'::jsonb)$c$, ped1, it1), 'separação negativa');
  PERFORM ci.entrar(est);
  PERFORM separacao_salvar(ped1, jsonb_build_array(
    jsonb_build_object('id', it1, 'quantidade_separada', 3), jsonb_build_object('id', it2, 'quantidade_separada', 4)));
  PERFORM conferencia_salvar(ped1, jsonb_build_array(
    jsonb_build_object('id', it1, 'quantidade_conferida', 3, 'divergencia', ''), jsonb_build_object('id', it2, 'quantidade_conferida', 3, 'divergencia', 'faltou 1')));
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT sum(quantidade_separada) = 7 FROM pedido_itens WHERE pedido_id = ped1), 'separação grava os dois itens');
  PERFORM ci.exige((SELECT divergencia = 'faltou 1' FROM pedido_itens WHERE id = it2) AND (SELECT divergencia IS NULL FROM pedido_itens WHERE id = it1), 'conferência grava a divergência (vazia vira nula)');

  -- compra: o total acompanha os itens sem chamar o recálculo
  INSERT INTO compras (tenant_id, deposito_id) VALUES (demo, dep) RETURNING id INTO compra;
  INSERT INTO compra_itens (tenant_id, compra_id, produto_id, quantidade, custo_unitario, total) VALUES (demo, compra, prod, 2, 5, 10);
  INSERT INTO compra_itens (tenant_id, compra_id, produto_id, quantidade, custo_unitario, total) VALUES (demo, compra, prod, 1, 7, 7);
  PERFORM ci.exige((SELECT subtotal = 17 AND total = 17 FROM compras WHERE id = compra), 'total da compra acompanha os itens ao incluir');
  UPDATE compra_itens SET quantidade = 3, total = 15 WHERE compra_id = compra AND custo_unitario = 5;
  PERFORM ci.exige((SELECT total = 22 FROM compras WHERE id = compra), 'total da compra acompanha ao alterar o item');
  DELETE FROM compra_itens WHERE compra_id = compra AND custo_unitario = 7;
  PERFORM ci.exige((SELECT total = 15 FROM compras WHERE id = compra), 'total da compra acompanha ao remover o item');
END $$;

-- 26. Importação do XML de entrada: lotes na mesma transação e nota repetida recusada
DO $$
DECLARE
  demo constant uuid := '11111111-1111-1111-1111-111111111111';
  adm  constant uuid := 'a0000000-0000-0000-0000-000000000001';
  vend constant uuid := 'a0000000-0000-0000-0000-000000000002';
  dep uuid; r jsonb; r2 jsonb; prod uuid; nota jsonb; forn jsonb; itens jsonb; lote_qtd numeric; msg text;
BEGIN
  INSERT INTO depositos (tenant_id, nome) VALUES (demo, 'Dep XML') RETURNING id INTO dep;
  nota := jsonb_build_object('chave', 'CHAVE-XML-CI-1', 'numero', '9001', 'emissao', current_date, 'frete', 0, 'desconto', 0);
  forn := jsonb_build_object('razao_social', 'Fornecedor XML CI', 'cnpj', '11222333000181');
  itens := jsonb_build_array(
    jsonb_build_object('codigo', 'XML-A', 'descricao', 'Porcelanato XML', 'unidade', 'M2', 'quantidade', 10, 'custo_unitario', 20,
                       'lote', 'L1', 'tonalidade', 'A', 'calibre', '2'),
    jsonb_build_object('codigo', 'XML-B', 'descricao', 'Argamassa XML', 'unidade', 'UN', 'quantidade', 5, 'custo_unitario', 8));

  PERFORM ci.deve_falhar(vend, format($c$SELECT importar_nfe_entrada(%L::jsonb, %L::jsonb, %L::jsonb, %L)$c$, nota, forn, itens, dep), 'vendedor importa nota de entrada');
  PERFORM ci.entrar(adm);
  r := importar_nfe_entrada(nota, forn, itens, dep);
  PERFORM ci.sair();
  PERFORM ci.exige((r->>'produtos_criados')::int = 2, 'a importação cadastra os dois produtos novos');
  SELECT id INTO prod FROM produtos WHERE tenant_id = demo AND codigo_interno = 'XML-A';
  PERFORM ci.exige((SELECT controla_lote FROM produtos WHERE id = prod), 'produto com lote passa a controlar lote');
  SELECT quantidade INTO lote_qtd FROM estoque_lotes WHERE produto_id = prod AND deposito_id = dep AND lote = 'L1' AND tonalidade = 'A' AND calibre = '2';
  PERFORM ci.exige(lote_qtd = 10, 'o lote do XML entra junto com a compra (10)');
  PERFORM ci.exige((SELECT count(*) = 0 FROM estoque_lotes l JOIN produtos p ON p.id = l.produto_id WHERE p.codigo_interno = 'XML-B'), 'item sem lote não cria lote');

  -- a mesma nota de novo é recusada, e outra nota segue entrando
  PERFORM ci.deve_falhar(adm, format($c$SELECT importar_nfe_entrada(%L::jsonb, %L::jsonb, %L::jsonb, %L)$c$, nota, forn, itens, dep), 'a mesma nota importada de novo');
  PERFORM ci.exige((SELECT count(*) = 1 FROM compras WHERE tenant_id = demo AND nfe_chave = 'CHAVE-XML-CI-1'), 'a nota repetida não gera outra compra');
  PERFORM ci.exige((SELECT quantidade = 10 FROM estoque_lotes WHERE produto_id = prod AND deposito_id = dep AND lote = 'L1'), 'a nota repetida não soma o lote de novo');
  -- mesma nota com outra chave digitada: barrada por número + série + fornecedor
  PERFORM ci.deve_falhar(adm, format($c$SELECT importar_nfe_entrada(%L::jsonb, %L::jsonb, %L::jsonb, %L)$c$,
    nota || jsonb_build_object('chave', 'CHAVE-XML-CI-OUTRA'), forn, itens, dep), 'mesmo número, série e fornecedor com outra chave');
  PERFORM ci.exige((SELECT count(*) = 1 FROM compras WHERE tenant_id = demo AND nfe_numero = '9001'), 'a nota repetida por número não gera outra compra');
  -- a mensagem diz que a nota já está importada (pela chave e por número + série + fornecedor)
  PERFORM ci.entrar(adm);
  BEGIN
    PERFORM importar_nfe_entrada(nota, forn, itens, dep);
  EXCEPTION WHEN OTHERS THEN msg := SQLERRM;
  END;
  PERFORM ci.exige(msg LIKE '%já está importada%', 'mensagem da chave repetida: ' || coalesce(msg, 'sem erro'));
  msg := NULL;
  BEGIN
    PERFORM importar_nfe_entrada(nota || jsonb_build_object('chave', 'CHAVE-XML-CI-OUTRA'), forn, itens, dep);
  EXCEPTION WHEN OTHERS THEN msg := SQLERRM;
  END;
  PERFORM ci.sair();
  PERFORM ci.exige(msg LIKE '%nº 9001%já está importada%', 'mensagem do número repetido: ' || coalesce(msg, 'sem erro'));
  -- a tela confere antes de importar, com a mesma regra
  PERFORM ci.entrar(adm);
  PERFORM ci.exige((nfe_entrada_ja_importada('CHAVE-XML-CI-1') ->> 'compra_id') = (r->>'compra_id'), 'conferência pela chave acha a compra');
  PERFORM ci.exige((nfe_entrada_ja_importada('OUTRA', '9001', NULL, '11.222.333/0001-81') ->> 'compra_id') = (r->>'compra_id'), 'conferência por número, série e CNPJ acha a compra');
  PERFORM ci.exige(nfe_entrada_ja_importada('OUTRA', '9001', '7', '11222333000181') IS NULL, 'outra série não é duplicada');
  PERFORM ci.exige(nfe_entrada_ja_importada('OUTRA', '9001', NULL, '55555555000155') IS NULL, 'outro fornecedor não é duplicada');
  PERFORM ci.sair();
  PERFORM ci.deve_falhar(vend, $c$SELECT nfe_entrada_ja_importada('CHAVE-XML-CI-1')$c$, 'vendedor confere nota de entrada');
  -- outra série do mesmo número é outra nota
  PERFORM ci.entrar(adm);
  PERFORM importar_nfe_entrada(nota || jsonb_build_object('chave', 'CHAVE-XML-CI-S2', 'serie', '2'), forn,
    jsonb_build_array(jsonb_build_object('codigo', 'XML-D', 'descricao', 'Cimento XML', 'unidade', 'UN', 'quantidade', 1, 'custo_unitario', 3)), dep);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT nfe_serie = '2' FROM compras WHERE nfe_chave = 'CHAVE-XML-CI-S2'), 'a série da nota fica guardada na compra');
  PERFORM ci.deve_falhar(adm, format($c$SELECT importar_nfe_entrada(%L::jsonb, %L::jsonb, %L::jsonb, %L)$c$,
    nota || jsonb_build_object('chave', 'CHAVE-XML-CI-S2B', 'serie', '2'), forn, itens, dep), 'mesmo número e série 2 de novo');
  -- de outro fornecedor, o mesmo número é outra nota
  PERFORM ci.entrar(adm);
  PERFORM importar_nfe_entrada(nota || jsonb_build_object('chave', 'CHAVE-XML-CI-F2'), forn || jsonb_build_object('cnpj', '99888777000166', 'razao_social', 'Outro Fornecedor XML'),
    jsonb_build_array(jsonb_build_object('codigo', 'XML-E', 'descricao', 'Areia XML', 'unidade', 'UN', 'quantidade', 1, 'custo_unitario', 3)), dep);
  PERFORM ci.sair();
  PERFORM ci.entrar(adm);
  r2 := importar_nfe_entrada(nota || jsonb_build_object('chave', 'CHAVE-XML-CI-2', 'numero', '9002'), forn,
    jsonb_build_array(jsonb_build_object('codigo', 'XML-C', 'descricao', 'Rejunte XML', 'unidade', 'UN', 'quantidade', 3, 'custo_unitario', 4)), dep);
  PERFORM ci.sair();
  PERFORM ci.exige((r2->>'compra_id') <> (r->>'compra_id'), 'outra nota importa normalmente depois');
END $$;
