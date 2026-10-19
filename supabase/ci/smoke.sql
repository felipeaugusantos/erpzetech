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
  PERFORM ci.exige(ci.contar(gest, 'SELECT count(*) FROM auditoria WHERE entidade = ''ci''') = 1, 'gestor lê auditoria');
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
    'eh_saas_operador', 'eh_salao_restrito', 'onboarding_criar_espaco', 'filial_irrestrita', 'pode_filial', 'contato_enviar',
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

  -- aviso de venda repetida: a tela pergunta se a chave já tem venda antes de reenviar
  PERFORM ci.entrar(adm);
  PERFORM ci.exige((frente_venda_existente(chave_venda) ->> 'pedido_id') = v1::text, 'a chave de uma venda já feita devolve o pedido');
  PERFORM ci.exige((frente_venda_existente(chave_venda) ->> 'numero')::bigint = (SELECT numero FROM pedidos WHERE id = v1), 'e o número dele');
  PERFORM ci.exige(frente_venda_existente(gen_random_uuid()) IS NULL, 'chave sem venda devolve nulo');
  PERFORM ci.exige(frente_venda_existente(NULL) IS NULL, 'sem chave devolve nulo');
  PERFORM ci.sair();
  PERFORM ci.deve_falhar(NULL, format($c$SELECT frente_venda_existente(%L)$c$, chave_venda), 'anon consulta venda por chave');
  PERFORM ci.deve_falhar(gar, format($c$SELECT frente_venda_existente(%L)$c$, chave_venda), 'garçom consulta venda por chave');

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

-- 27. R11: peças da ordem de serviço baixam o estoque
DO $$
DECLARE
  demo constant uuid := '11111111-1111-1111-1111-111111111111';
  adm  constant uuid := 'a0000000-0000-0000-0000-000000000001';
  dep uuid; prod uuid; os uuid; os2 uuid; os3 uuid; os4 uuid; it1 uuid; it2 uuid; it3 uuid;
  msg text;
BEGIN
  INSERT INTO depositos (tenant_id, nome) VALUES (demo, 'Dep OS R11') RETURNING id INTO dep;
  INSERT INTO produtos (tenant_id, codigo_interno, descricao, unidade, custo, preco_venda) VALUES (demo, 'R11-PECA', 'Peça R11', 'un', 5, 10) RETURNING id INTO prod;
  PERFORM ci.entrar(adm);
  PERFORM registrar_movimentacao(prod, dep, 'entrada'::mov_tipo, 10, 'ci', 'ci');
  PERFORM ci.sair();

  INSERT INTO os_ordens (tenant_id, equipamento, deposito_id, situacao) VALUES (demo, 'Furadeira R11', dep, 'orcamento') RETURNING id INTO os;
  INSERT INTO os_itens (tenant_id, os_id, tipo, produto_id, descricao, quantidade, preco_unitario, total)
    VALUES (demo, os, 'peca', prod, 'Peça R11', 3, 10, 30) RETURNING id INTO it1;
  INSERT INTO os_itens (tenant_id, os_id, tipo, descricao, quantidade, preco_unitario, total) VALUES (demo, os, 'servico', 'Mão de obra', 1, 50, 50);
  PERFORM ci.exige((SELECT quantidade = 10 FROM estoques WHERE produto_id = prod AND deposito_id = dep), 'orçamento não baixa o estoque');

  -- aprovada: baixa uma vez
  PERFORM ci.entrar(adm);
  UPDATE os_ordens SET situacao = 'aprovada' WHERE id = os;
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT quantidade = 7 FROM estoques WHERE produto_id = prod AND deposito_id = dep), 'aprovar a OS baixa a peça (10 - 3)');
  PERFORM ci.exige((SELECT baixa_quantidade = 3 FROM os_itens WHERE id = it1), 'o item guarda o que foi baixado');
  PERFORM ci.entrar(adm);
  UPDATE os_ordens SET situacao = 'em_reparo' WHERE id = os;
  UPDATE os_ordens SET situacao = 'pronta', diagnostico = 'x' WHERE id = os;
  PERFORM ci.exige((SELECT quantidade = 7 FROM estoques WHERE produto_id = prod AND deposito_id = dep), 'mudar de etapa não baixa de novo');
  PERFORM ci.exige((SELECT count(*) = 1 FROM estoque_movimentacoes WHERE produto_id = prod AND tipo = 'saida' AND documento LIKE 'OS nº%'), 'uma saída só no histórico de movimentações');

  -- peça incluída, alterada e removida depois da aprovação
  INSERT INTO os_itens (tenant_id, os_id, tipo, produto_id, descricao, quantidade, preco_unitario, total)
    VALUES (demo, os, 'peca', prod, 'Peça R11 extra', 2, 10, 20) RETURNING id INTO it2;
  PERFORM ci.exige((SELECT quantidade = 5 FROM estoques WHERE produto_id = prod AND deposito_id = dep), 'peça incluída depois da aprovação baixa na hora');
  UPDATE os_itens SET quantidade = 4, total = 40 WHERE id = it1;
  PERFORM ci.exige((SELECT quantidade = 4 FROM estoques WHERE produto_id = prod AND deposito_id = dep), 'quantidade alterada acompanha o estoque (3 vira 4)');
  DELETE FROM os_itens WHERE id = it2;
  PERFORM ci.exige((SELECT quantidade = 6 FROM estoques WHERE produto_id = prod AND deposito_id = dep), 'peça removida devolve ao estoque');

  -- o cliente não escreve o que foi baixado
  UPDATE os_itens SET baixa_quantidade = 0, baixa_produto_id = NULL WHERE id = it1;
  PERFORM ci.exige((SELECT baixa_quantidade = 4 AND baixa_produto_id = prod FROM os_itens WHERE id = it1), 'o usuário não altera o registro da baixa');

  -- cancelar devolve; reabrir baixa de novo
  UPDATE os_ordens SET situacao = 'cancelada' WHERE id = os;
  PERFORM ci.exige((SELECT quantidade = 10 FROM estoques WHERE produto_id = prod AND deposito_id = dep), 'cancelar a OS devolve as peças');
  PERFORM ci.exige((SELECT baixa_quantidade IS NULL FROM os_itens WHERE id = it1), 'cancelada: nada fica como baixado');
  UPDATE os_ordens SET situacao = 'aprovada' WHERE id = os;
  PERFORM ci.exige((SELECT quantidade = 6 FROM estoques WHERE produto_id = prod AND deposito_id = dep), 'reaprovar baixa de novo');
  UPDATE os_ordens SET situacao = 'orcamento' WHERE id = os;
  PERFORM ci.exige((SELECT quantidade = 10 FROM estoques WHERE produto_id = prod AND deposito_id = dep), 'voltar para orçamento devolve as peças');

  PERFORM ci.sair();

  -- sem depósito: não aprova
  INSERT INTO os_ordens (tenant_id, equipamento, situacao) VALUES (demo, 'Sem depósito R11', 'orcamento') RETURNING id INTO os2;
  INSERT INTO os_itens (tenant_id, os_id, tipo, produto_id, descricao, quantidade, preco_unitario, total) VALUES (demo, os2, 'peca', prod, 'Peça', 1, 10, 10);
  PERFORM ci.entrar(adm);
  BEGIN
    UPDATE os_ordens SET situacao = 'aprovada' WHERE id = os2;
  EXCEPTION WHEN OTHERS THEN msg := SQLERRM;
  END;
  PERFORM ci.sair();
  PERFORM ci.exige(msg LIKE '%Escolha o depósito%', 'aprovar sem depósito é recusado: ' || coalesce(msg, 'sem erro'));
  PERFORM ci.exige((SELECT situacao = 'orcamento' FROM os_ordens WHERE id = os2), 'a OS recusada segue em orçamento');

  -- estoque insuficiente: não aprova e não baixa nada
  INSERT INTO os_ordens (tenant_id, equipamento, deposito_id, situacao) VALUES (demo, 'Sem saldo R11', dep, 'orcamento') RETURNING id INTO os3;
  INSERT INTO os_itens (tenant_id, os_id, tipo, produto_id, descricao, quantidade, preco_unitario, total) VALUES (demo, os3, 'peca', prod, 'Peça', 1, 10, 10);
  INSERT INTO os_itens (tenant_id, os_id, tipo, produto_id, descricao, quantidade, preco_unitario, total) VALUES (demo, os3, 'peca', prod, 'Peça demais', 500, 10, 5000);
  msg := NULL;
  PERFORM ci.entrar(adm);
  BEGIN
    UPDATE os_ordens SET situacao = 'aprovada' WHERE id = os3;
  EXCEPTION WHEN OTHERS THEN msg := SQLERRM;
  END;
  PERFORM ci.sair();
  PERFORM ci.exige(msg LIKE '%insuficiente%', 'aprovar sem saldo é recusado: ' || coalesce(msg, 'sem erro'));
  PERFORM ci.exige((SELECT quantidade = 10 FROM estoques WHERE produto_id = prod AND deposito_id = dep), 'a aprovação recusada não baixa nem a peça que tinha saldo');

  -- OS antiga (já existia antes da regra) não mexe no estoque
  INSERT INTO os_ordens (tenant_id, equipamento, deposito_id, situacao, controla_estoque) VALUES (demo, 'Antiga R11', dep, 'entregue', false) RETURNING id INTO os4;
  INSERT INTO os_itens (tenant_id, os_id, tipo, produto_id, descricao, quantidade, preco_unitario, total) VALUES (demo, os4, 'peca', prod, 'Peça', 1, 10, 10);
  UPDATE os_ordens SET situacao = 'pronta' WHERE id = os4;
  PERFORM ci.exige((SELECT quantidade = 10 FROM estoques WHERE produto_id = prod AND deposito_id = dep), 'OS antiga não movimenta o estoque');
END $$;

-- 28. R12: auditoria do financeiro, do fiscal, da empresa e dos papéis
DO $$
DECLARE
  demo constant uuid := '11111111-1111-1111-1111-111111111111';
  emp  constant uuid := '22222222-2222-2222-2222-222222222222';
  adm  constant uuid := 'a0000000-0000-0000-0000-000000000001';
  gest constant uuid := 'a0000000-0000-0000-0000-000000000005';
  fin  constant uuid := 'a0000000-0000-0000-0000-0000000000b2';
  cr uuid; cp uuid; nota uuid; cfg uuid; tx uuid; ux uuid; n_antes bigint; v jsonb;
BEGIN
  INSERT INTO contas_receber (tenant_id, descricao, vencimento, valor) VALUES (demo, 'Conta R12', current_date, 100) RETURNING id INTO cr;
  INSERT INTO contas_pagar (tenant_id, descricao, vencimento, valor) VALUES (demo, 'Pagar R12', current_date, 80) RETURNING id INTO cp;

  -- alteração feita por um usuário: quem, o quê (antes e depois)
  PERFORM ci.entrar(fin);
  UPDATE contas_receber SET valor_recebido = 100, situacao = 'pago' WHERE id = cr;
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT usuario_id = fin AND valor_novo ->> 'situacao' = 'pago' AND valor_anterior ->> 'situacao' IS NOT NULL
                      FROM auditoria WHERE entidade = 'contas_receber' AND entidade_id = cr AND operacao = 'update'),
                   'baixa de conta a receber fica registrada com o usuário, o antes e o depois');

  -- campo fora da lista não gera registro
  SELECT count(*) INTO n_antes FROM auditoria WHERE entidade = 'contas_receber' AND entidade_id = cr;
  UPDATE contas_receber SET observacoes = 'só uma nota' WHERE id = cr;
  PERFORM ci.exige((SELECT count(*) = n_antes FROM auditoria WHERE entidade = 'contas_receber' AND entidade_id = cr), 'campo fora da lista não gera registro');

  -- exclusão
  UPDATE contas_pagar SET valor = 90 WHERE id = cp;
  DELETE FROM contas_pagar WHERE id = cp;
  PERFORM ci.exige((SELECT (valor_anterior ->> 'valor')::numeric = 90 FROM auditoria WHERE entidade = 'contas_pagar' AND entidade_id = cp AND operacao = 'delete'),
                   'exclusão de conta a pagar fica registrada com os valores que tinha');
  PERFORM ci.exige((SELECT count(*) = 2 FROM auditoria WHERE entidade = 'contas_pagar' AND entidade_id = cp), 'conta a pagar: alteração e exclusão');

  -- nota fiscal
  SELECT id INTO nota FROM nfe WHERE tenant_id = demo ORDER BY created_at LIMIT 1;
  UPDATE nfe SET cfop = '5949' WHERE id = nota;
  PERFORM ci.exige((SELECT valor_novo ->> 'cfop' = '5949' FROM auditoria WHERE entidade = 'nfe' AND entidade_id = nota AND operacao = 'update' ORDER BY created_at DESC LIMIT 1),
                   'mudança na nota fiscal fica registrada');

  -- configuração fiscal: segredo mascarado, contador de numeração fora
  INSERT INTO fiscal_config (tenant_id, empresa_id, filial_id) VALUES (demo, emp, '33333333-3333-3333-3333-333333333333')
    ON CONFLICT DO NOTHING;
  SELECT id INTO cfg FROM fiscal_config WHERE tenant_id = demo ORDER BY created_at LIMIT 1;
  UPDATE fiscal_config SET nfse_token = 'SEGREDO-123', ambiente = 'producao' WHERE id = cfg;
  v := (SELECT valor_novo FROM auditoria WHERE entidade = 'fiscal_config' AND entidade_id = cfg AND operacao = 'update' AND valor_novo ? 'ambiente' LIMIT 1);
  PERFORM ci.exige(v ->> 'nfse_token' = '***' AND v ->> 'ambiente' = 'producao', 'configuração fiscal: ambiente registrado e token mascarado');
  PERFORM ci.exige(NOT EXISTS (SELECT 1 FROM auditoria WHERE valor_novo::text LIKE '%SEGREDO-123%' OR valor_anterior::text LIKE '%SEGREDO-123%'), 'o token não aparece em nenhum registro');
  -- alteração de um campo só da NFS-e também é registrada
  UPDATE fiscal_config SET nfse_iss_retido = NOT coalesce(nfse_iss_retido, false) WHERE id = cfg;
  PERFORM ci.exige(EXISTS (SELECT 1 FROM auditoria WHERE entidade = 'fiscal_config' AND entidade_id = cfg AND operacao = 'update'
                             AND valor_novo ? 'nfse_iss_retido' AND NOT (valor_novo ? 'ambiente')),
                   'mudança só de um campo da NFS-e fica registrada');
  SELECT count(*) INTO n_antes FROM auditoria WHERE entidade = 'fiscal_config' AND entidade_id = cfg;
  UPDATE fiscal_config SET proximo_numero_nfse = coalesce(proximo_numero_nfse, 1) + 1 WHERE id = cfg;
  UPDATE fiscal_config SET proximo_numero = proximo_numero + 1 WHERE id = cfg;
  PERFORM ci.exige((SELECT count(*) = n_antes FROM auditoria WHERE entidade = 'fiscal_config' AND entidade_id = cfg), 'o contador de numeração da nota não gera registro');

  -- empresa e filiais
  UPDATE empresas SET regime_tributario = 'lucro_presumido' WHERE id = emp;
  PERFORM ci.exige(EXISTS (SELECT 1 FROM auditoria WHERE entidade = 'empresas' AND entidade_id = emp AND valor_novo ->> 'regime_tributario' = 'lucro_presumido'),
                   'mudança de regime tributário da empresa fica registrada');
  UPDATE empresas SET regime_tributario = 'simples' WHERE id = emp;

  -- papéis dos usuários
  UPDATE profiles SET empresa_id = emp WHERE id = adm;
  PERFORM ci.entrar(adm);
  PERFORM usuario_definir_papeis(gest, ARRAY['gestor', 'financeiro']::app_role[]);
  PERFORM ci.sair();
  UPDATE profiles SET empresa_id = NULL WHERE id = adm;
  PERFORM ci.exige(EXISTS (SELECT 1 FROM auditoria WHERE entidade = 'user_roles' AND operacao = 'insert' AND usuario_id = adm
                             AND valor_novo ->> 'user_id' = gest::text AND valor_novo ->> 'role' = 'financeiro'),
                   'papel dado a um usuário fica registrado com quem deu');
  PERFORM ci.exige(EXISTS (SELECT 1 FROM auditoria WHERE entidade = 'user_roles' AND operacao = 'delete' AND usuario_id = adm
                             AND valor_anterior ->> 'user_id' = gest::text),
                   'papel retirado de um usuário fica registrado');
  DELETE FROM user_roles WHERE user_id = gest AND role = 'financeiro';
  PERFORM ci.exige(EXISTS (SELECT 1 FROM auditoria WHERE entidade = 'user_roles' AND operacao = 'delete' AND valor_anterior ->> 'role' = 'financeiro'), 'remoção direta de papel também é registrada');

  -- só administrador e gestor leem; ninguém grava
  PERFORM ci.exige(ci.contar(fin, $c$SELECT count(*) FROM auditoria WHERE entidade = 'user_roles'$c$) = 0, 'financeiro não lê a auditoria');
  PERFORM ci.exige(ci.contar(adm, $c$SELECT count(*) FROM auditoria WHERE entidade = 'user_roles'$c$) > 0, 'administrador lê a auditoria dos papéis');

  -- apagar uma empresa inteira (cascata) não quebra pela auditoria
  INSERT INTO tenants (nome) VALUES ('R12 apagar') RETURNING id INTO tx;
  INSERT INTO empresas (tenant_id, razao_social) VALUES (tx, 'Empresa R12 apagar');
  DELETE FROM tenants WHERE id = tx;
  PERFORM ci.exige(NOT EXISTS (SELECT 1 FROM tenants WHERE id = tx), 'apagar a empresa em cascata funciona com a auditoria ligada');
END $$;

-- 29. R14: formulário público de contato com limite de envios e CAPTCHA (só o servidor da aplicação envia)
DO $$
DECLARE
  adm  constant uuid := 'a0000000-0000-0000-0000-000000000001';
  n_antes bigint; ok boolean; msg text; i int;
  antes timestamptz := now() - interval '10 seconds';
BEGIN
  DELETE FROM contatos;

  -- a gravação direta e a chamada pública fecharam: só o servidor (chave de serviço) envia
  PERFORM ci.deve_falhar(NULL, $c$INSERT INTO contatos (nome, email) VALUES ('Direto', 'a@b.co')$c$, 'anon grava direto em contatos');
  PERFORM ci.deve_falhar(NULL, $c$SELECT contato_enviar('Anon', 'a@b.co')$c$, 'anon chama contato_enviar');
  PERFORM ci.deve_falhar(adm, $c$SELECT contato_enviar('Logado', 'a@b.co')$c$, 'usuário logado chama contato_enviar');

  -- o servidor da aplicação (service_role) envia
  SET LOCAL ROLE service_role;
  ok := contato_enviar('Maria Souza', 'maria@loja.com.br', '(16) 99999-1234', 'loja', 'Quero conhecer', NULL, now() - interval '30 seconds', '203.0.113.50');
  RESET ROLE;
  PERFORM ci.exige(ok AND (SELECT count(*) = 1 FROM contatos WHERE email = 'maria@loja.com.br'), 'o servidor envia o contato');
  PERFORM ci.exige(ci.contar(NULL, 'SELECT count(*) FROM contatos') = 0, 'anon não enxerga os contatos');

  -- robô: campo escondido preenchido finge sucesso e não grava
  SELECT count(*) INTO n_antes FROM contatos;
  ok := contato_enviar('Robô', 'robo@spam.com', NULL, NULL, 'compre já', 'http://spam', now() - interval '30 seconds');
  PERFORM ci.exige(ok AND (SELECT count(*) = n_antes FROM contatos), 'campo escondido preenchido não grava');
  -- rápido demais
  PERFORM ci.deve_falhar_dono(format($c$SELECT contato_enviar('Rápido', 'r@r.co', NULL, NULL, NULL, NULL, %L)$c$, now()), 'envio antes de 3 segundos');

  -- validações
  PERFORM ci.deve_falhar_dono($c$SELECT contato_enviar('A', 'a@b.co')$c$, 'nome curto');
  PERFORM ci.deve_falhar_dono($c$SELECT contato_enviar('Fulano')$c$, 'sem e-mail nem WhatsApp');
  PERFORM ci.deve_falhar_dono($c$SELECT contato_enviar('Fulano', 'sem-arroba')$c$, 'e-mail inválido');
  PERFORM ci.deve_falhar_dono($c$SELECT contato_enviar('Fulano', NULL, '123')$c$, 'WhatsApp inválido');
  PERFORM ci.deve_falhar_dono(format($c$SELECT contato_enviar('Fulano', 'f@f.co', NULL, NULL, %L)$c$, repeat('x', 2001)), 'mensagem muito longa');

  -- o mesmo contato de novo em 10 minutos é um só
  SELECT count(*) INTO n_antes FROM contatos;
  ok := contato_enviar('Maria Souza', 'maria@loja.com.br', '(16) 99999-1234', 'loja', 'Quero conhecer', NULL, now() - interval '30 seconds', '203.0.113.50');
  PERFORM ci.exige(ok AND (SELECT count(*) = n_antes FROM contatos), 'contato repetido em 10 minutos não duplica');

  -- limite por origem (hash do IP informado pelo servidor, nunca o IP): 5 por hora
  FOR i IN 1..5 LOOP
    PERFORM contato_enviar('Origem ' || i, 'o' || i || '@teste.co', NULL, NULL, 'mensagem ' || i, NULL, antes, '203.0.113.9');
  END LOOP;
  PERFORM ci.exige((SELECT count(*) = 5 FROM contatos WHERE origem = md5('contato:203.0.113.9')), 'cinco envios do mesmo IP entram');
  PERFORM ci.exige(NOT EXISTS (SELECT 1 FROM contatos WHERE origem LIKE '%203.0.113%'), 'o IP não é guardado, só o hash');
  BEGIN
    PERFORM contato_enviar('Origem 6', 'o6@teste.co', NULL, NULL, 'mensagem 6', NULL, antes, '203.0.113.9');
  EXCEPTION WHEN OTHERS THEN msg := SQLERRM;
  END;
  PERFORM ci.exige(msg LIKE 'Muitos envios deste aparelho%', 'o sexto envio do mesmo IP é recusado: ' || coalesce(msg, 'sem erro'));
  -- outro IP segue entrando
  ok := contato_enviar('Outra origem', 'outra@teste.co', NULL, NULL, 'oi', NULL, antes, '198.51.100.7');
  PERFORM ci.exige(ok, 'outro IP não é afetado pelo limite');

  -- sem IP informado, vale o cabeçalho da chamada
  PERFORM set_config('request.headers', '{"x-forwarded-for":"192.0.2.44, 10.0.0.1"}', true);
  PERFORM contato_enviar('Pelo cabeçalho', 'cab@teste.co', NULL, NULL, 'oi cabeçalho', NULL, antes);
  PERFORM ci.exige(EXISTS (SELECT 1 FROM contatos WHERE email = 'cab@teste.co' AND origem = md5('contato:192.0.2.44')), 'sem IP informado usa o cabeçalho');

  -- limite total: 100 por hora
  PERFORM set_config('request.headers', '', true);
  INSERT INTO contatos (nome, email) SELECT 'Carga ' || g, 'c' || g || '@carga.co' FROM generate_series(1, 100) g;
  msg := NULL;
  BEGIN
    PERFORM contato_enviar('Fulano', 'novo@teste.co', NULL, NULL, 'uma a mais', NULL, antes, '198.51.100.99');
  EXCEPTION WHEN OTHERS THEN msg := SQLERRM;
  END;
  PERFORM ci.exige(msg LIKE 'Estamos recebendo muitos contatos%', 'passou de 100 por hora no total: recusa: ' || coalesce(msg, 'sem erro'));

  DELETE FROM contatos;
END $$;

-- 30. Salvar empresa numa transação só
DO $$
DECLARE
  demo constant uuid := '11111111-1111-1111-1111-111111111111';
  adm  constant uuid := 'a0000000-0000-0000-0000-000000000001';
  vend constant uuid := 'a0000000-0000-0000-0000-000000000002';
  gest constant uuid := 'a0000000-0000-0000-0000-000000000005';
  novo_adm constant uuid := 'a0000000-0000-0000-0000-0000000000c1';
  emp uuid; emp2 uuid; razao_antes text; tel_antes text; tx uuid; n_antes bigint;
BEGIN
  SELECT id, razao_social, telefone INTO emp, razao_antes, tel_antes FROM empresas WHERE tenant_id = demo ORDER BY created_at, id LIMIT 1;

  -- só o administrador
  PERFORM ci.deve_falhar(gest, $c$SELECT empresa_salvar('{"razao_social":"Gestor muda"}'::jsonb)$c$, 'gestor salva a empresa');
  PERFORM ci.deve_falhar(vend, $c$SELECT empresa_salvar('{"razao_social":"Vendedor muda"}'::jsonb)$c$, 'vendedor salva a empresa');
  PERFORM ci.deve_falhar(NULL, $c$SELECT empresa_salvar('{"razao_social":"Anon muda"}'::jsonb)$c$, 'anon salva a empresa');

  -- recusas não mexem em nada
  PERFORM ci.deve_falhar(adm, $c$SELECT empresa_salvar('{"razao_social":"  "}'::jsonb)$c$, 'razão social em branco');
  PERFORM ci.deve_falhar(adm, $c$SELECT empresa_salvar('{"razao_social":"Cor ruim","cor_primaria":"vermelho"}'::jsonb)$c$, 'cor inválida');
  PERFORM ci.exige((SELECT razao_social = razao_antes FROM empresas WHERE id = emp), 'recusa não altera a empresa');

  -- atualização: empresa e regime da configuração fiscal juntos; o que não veio fica como estava
  PERFORM ci.entrar(adm);
  emp2 := empresa_salvar(jsonb_build_object('razao_social', 'Empresa Salva R8', 'regime_tributario', 'lucro_presumido',
                                            'cidade', 'Ribeirão Preto', 'cor_primaria', '#112233'));
  PERFORM ci.sair();
  PERFORM ci.exige(emp2 = emp, 'atualiza a empresa que já existe, sem criar outra');
  PERFORM ci.exige((SELECT razao_social = 'Empresa Salva R8' AND regime_tributario = 'lucro_presumido' AND cidade = 'Ribeirão Preto'
                           AND cor_primaria = '#112233' AND telefone IS NOT DISTINCT FROM tel_antes FROM empresas WHERE id = emp),
                   'dados salvos e campo ausente mantido');
  PERFORM ci.exige((SELECT count(*) = 1 AND bool_and(regime_tributario = 'lucro_presumido') FROM fiscal_config
                     WHERE empresa_id = emp AND filial_id IS NULL), 'o regime da configuração fiscal acompanha o cadastro');
  PERFORM ci.exige((SELECT count(*) = 1 FROM empresas WHERE tenant_id = demo AND razao_social = 'Empresa Salva R8'), 'continua uma empresa só');
  SELECT count(*) INTO n_antes FROM fiscal_config WHERE empresa_id = emp AND filial_id IS NULL;
  PERFORM ci.entrar(adm);
  PERFORM empresa_salvar(jsonb_build_object('razao_social', 'Empresa Salva R8', 'regime_tributario', 'simples'));
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT count(*) = n_antes AND bool_and(regime_tributario = 'simples') FROM fiscal_config WHERE empresa_id = emp AND filial_id IS NULL),
                   'salvar de novo atualiza a mesma configuração fiscal');
  UPDATE empresas SET razao_social = razao_antes, regime_tributario = 'simples' WHERE id = emp;

  -- primeiro cadastro: cria a empresa, vincula o administrador e cria a configuração fiscal
  INSERT INTO tenants (nome) VALUES ('Primeiro acesso R8') RETURNING id INTO tx;
  INSERT INTO auth.users (id, email) VALUES (novo_adm, 'novoadm@ci');
  UPDATE profiles SET tenant_id = tx WHERE id = novo_adm;
  INSERT INTO user_roles (user_id, tenant_id, role) VALUES (novo_adm, tx, 'administrador');
  PERFORM ci.exige(NOT EXISTS (SELECT 1 FROM empresas WHERE tenant_id = tx), 'o primeiro acesso começa sem empresa');
  PERFORM ci.entrar(novo_adm);
  emp2 := empresa_salvar(jsonb_build_object('razao_social', 'Loja Nova R8', 'cnpj', '12345678000195', 'regime_tributario', 'simples_excesso'));
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT razao_social = 'Loja Nova R8' AND tenant_id = tx AND cor_primaria = '#008037' AND ramo_atividade = 'construcao' FROM empresas WHERE id = emp2),
                   'primeiro cadastro cria a empresa na empresa do administrador, com os padrões');
  PERFORM ci.exige((SELECT empresa_id = emp2 FROM profiles WHERE id = novo_adm), 'o administrador passa a pertencer à empresa');
  PERFORM ci.exige((SELECT count(*) = 1 AND bool_and(regime_tributario = 'simples_excesso' AND tenant_id = tx) FROM fiscal_config
                     WHERE empresa_id = emp2 AND filial_id IS NULL), 'o primeiro cadastro cria a configuração fiscal com o regime');
  PERFORM ci.exige((SELECT razao_social = razao_antes FROM empresas WHERE id = emp), 'a empresa de outro cliente não foi tocada');
END $$;

-- 31. Fase 2 / NFC-e: configuração com CSC secreto, nota modelo 65 criada pelo pedido, numeração própria e eventos pendentes
DO $$
DECLARE
  demo constant uuid := '11111111-1111-1111-1111-111111111111';
  adm  constant uuid := 'a0000000-0000-0000-0000-000000000001';
  vend constant uuid := 'a0000000-0000-0000-0000-000000000002';
  gest constant uuid := 'a0000000-0000-0000-0000-000000000005';
  gar  constant uuid := 'a0000000-0000-0000-0000-000000000006';
  cxa  constant uuid := 'a0000000-0000-0000-0000-0000000000a1';
  dep uuid; prod uuid; cli uuid; ped uuid; ped2 uuid; ped3 uuid; ped4 uuid; ped5 uuid; ped6 uuid; ped7 uuid; ped8 uuid; n7 uuid; n8 uuid; aut1 uuid; aut2 uuid; aut3 uuid; fil_emit uuid; n1 uuid; n1b uuid; n2 uuid; n3 uuid; emp uuid; cfg uuid; tb uuid;
  n_linhas bigint;
BEGIN
  INSERT INTO depositos (tenant_id, nome) VALUES (demo, 'NFC-e CI') RETURNING id INTO dep;
  INSERT INTO produtos (tenant_id, codigo_interno, descricao, unidade, custo, ncm, cst_csosn)
  VALUES (demo, 'NFCE-1', 'Item NFC-e', 'un', 5, '12345678', '102') RETURNING id INTO prod;
  INSERT INTO clientes (tenant_id, nome) VALUES (demo, 'Cliente NFC-e') RETURNING id INTO cli;
  PERFORM ci.entrar(adm);
  PERFORM registrar_movimentacao(prod, dep, 'entrada'::mov_tipo, 100, 'ci', 'ci');
  ped := criar_pedido_direto(cli, dep, jsonb_build_array(jsonb_build_object('produto_id', prod, 'quantidade', 2, 'preco_unitario', 50)));
  ped2 := criar_pedido_direto(cli, dep, jsonb_build_array(jsonb_build_object('produto_id', prod, 'quantidade', 1, 'preco_unitario', 30)));
  ped3 := criar_pedido_direto(cli, dep, jsonb_build_array(jsonb_build_object('produto_id', prod, 'quantidade', 1, 'preco_unitario', 20)));
  PERFORM ci.sair();
  SELECT id INTO emp FROM empresas WHERE tenant_id = demo ORDER BY created_at, id LIMIT 1;
  UPDATE empresas SET cnpj = '12345678000195', inscricao_estadual = '111222333', estado = 'SP' WHERE id = emp;

  -- papéis: quem emite no balcão pode; garçom e anon não
  PERFORM ci.deve_falhar(gar, format($c$SELECT nfce_criar(%L)$c$, ped), 'garçom cria NFC-e');
  PERFORM ci.deve_falhar(NULL, format($c$SELECT nfce_criar(%L)$c$, ped), 'anon cria NFC-e');

  -- sem CSC, certificado e emissor: nota em rascunho, sem número (a sequência não é gasta)
  PERFORM ci.entrar(vend);
  n1 := nfce_criar(ped);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT modelo = 'nfce' AND situacao = 'rascunho' AND numero IS NULL AND valor_total = 100
                           AND 'CSC da NFC-e (código e token) não configurado' = ANY (pendencias)
                           AND 'Certificado digital A1 não configurado' = ANY (pendencias) FROM nfe WHERE id = n1),
                   'sem CSC e certificado a NFC-e fica em rascunho, com as pendências, sem número');
  PERFORM ci.exige((SELECT count(*) = 1 FROM nfe_itens WHERE nfe_id = n1), 'a NFC-e leva os itens do pedido');
  SELECT id INTO cfg FROM fiscal_config WHERE empresa_id = emp AND filial_id IS NULL ORDER BY created_at LIMIT 1;
  PERFORM ci.exige((SELECT proximo_numero = 1 FROM nfce_config WHERE fiscal_config_id = cfg), 'rascunho não gasta número');

  -- configura (como o dono do banco); o pedido volta a ser montado e fica pronto
  UPDATE fiscal_config SET certificado_nome = 'cert.pfx', emissor = 'acbr' WHERE id = cfg;
  UPDATE nfce_config SET csc_id = '1', csc_token = 'SEGREDOCSC0123456789', serie = 3 WHERE fiscal_config_id = cfg;
  PERFORM ci.entrar(vend);
  n1b := nfce_criar(ped);
  PERFORM ci.sair();
  PERFORM ci.exige(n1b <> n1 AND NOT EXISTS (SELECT 1 FROM nfe WHERE id = n1), 'o rascunho é refeito, não duplicado');
  PERFORM ci.exige((SELECT situacao = 'pronta' AND numero = 1 AND serie = 3 AND pendencias = '{}' FROM nfe WHERE id = n1b),
                   'com tudo configurado a NFC-e fica pronta, série 3, número 1');

  -- repetir devolve a mesma nota e não gasta outro número
  PERFORM ci.entrar(cxa);
  n2 := nfce_criar(ped);
  PERFORM ci.sair();
  PERFORM ci.exige(n2 = n1b, 'repetir a criação devolve a mesma NFC-e');
  PERFORM ci.exige((SELECT proximo_numero = 2 FROM nfce_config WHERE fiscal_config_id = cfg), 'a sequência andou uma vez só');

  -- outro pedido: próximo número; CPF identificado vai na nota; CPF ruim vira pendência
  PERFORM ci.entrar(adm);
  n3 := nfce_criar(ped2, '123.456.789-09');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT numero = 2 AND situacao = 'pronta' AND destinatario ->> 'cpf' = '12345678909' FROM nfe WHERE id = n3),
                   'segundo pedido leva o número 2 e o CPF do consumidor');
  PERFORM ci.entrar(adm);
  n3 := nfce_criar(ped3, '123');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT situacao = 'rascunho' AND numero IS NULL AND 'CPF do consumidor inválido' = ANY (pendencias) FROM nfe WHERE id = n3),
                   'CPF inválido deixa a nota em rascunho');

  -- venda do balcão (frente de caixa, sem cliente): o caixa e o vendedor também criam a NFC-e dela
  PERFORM ci.entrar(adm);
  ped6 := frente_venda(dep, jsonb_build_array(jsonb_build_object('produto_id', prod, 'quantidade', 2, 'preco_unitario', 12)), 'dinheiro', NULL, 0, 1, NULL, NULL, gen_random_uuid());
  PERFORM ci.sair();
  PERFORM ci.entrar(cxa);
  n3 := nfce_criar(ped6, '52998224725');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT modelo = 'nfce' AND valor_total = 24 AND destinatario ->> 'cpf' = '52998224725'
                      FROM nfe WHERE id = n3), 'o caixa cria a NFC-e da venda do balcão, com o CPF do consumidor');
  PERFORM ci.entrar(vend);
  PERFORM ci.exige(nfce_criar(ped6) = n3, 'repetir pelo vendedor devolve a mesma NFC-e');
  PERFORM ci.sair();

  -- cancelar a venda com NFC-e: pronta fica cancelada, rascunho é apagada, enviada à Sefaz impede
  INSERT INTO gestor_autorizacoes (tenant_id, gestor_id, operador_id, acao) VALUES (demo, gest, adm, 'cancelar_venda') RETURNING id INTO aut1;
  PERFORM ci.entrar(adm);
  PERFORM frente_cancelar_venda(ped6, aut1, 'Teste NFC-e pronta');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT situacao = 'cancelada' AND motivo_cancelamento LIKE 'Venda cancelada%' FROM nfe WHERE id = n3), 'cancelar a venda cancela a NFC-e pronta');

  PERFORM ci.entrar(adm);
  ped7 := frente_venda(dep, jsonb_build_array(jsonb_build_object('produto_id', prod, 'quantidade', 1, 'preco_unitario', 9)), 'dinheiro', NULL, 0, 1, NULL, NULL, gen_random_uuid());
  n7 := nfce_criar(ped7, '123');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT situacao = 'rascunho' FROM nfe WHERE id = n7), 'NFC-e com CPF ruim fica em rascunho');
  INSERT INTO gestor_autorizacoes (tenant_id, gestor_id, operador_id, acao) VALUES (demo, gest, adm, 'cancelar_venda') RETURNING id INTO aut2;
  PERFORM ci.entrar(adm);
  PERFORM frente_cancelar_venda(ped7, aut2, 'Teste NFC-e rascunho');
  PERFORM ci.sair();
  PERFORM ci.exige(NOT EXISTS (SELECT 1 FROM nfe WHERE id = n7), 'cancelar a venda apaga a NFC-e em rascunho');

  PERFORM ci.entrar(adm);
  ped8 := frente_venda(dep, jsonb_build_array(jsonb_build_object('produto_id', prod, 'quantidade', 1, 'preco_unitario', 8)), 'dinheiro', NULL, 0, 1, NULL, NULL, gen_random_uuid());
  n8 := nfce_criar(ped8);
  PERFORM ci.sair();
  UPDATE nfe SET situacao = 'autorizada', chave = 'CHAVE-CANC-CI' WHERE id = n8;
  INSERT INTO gestor_autorizacoes (tenant_id, gestor_id, operador_id, acao) VALUES (demo, gest, adm, 'cancelar_venda') RETURNING id INTO aut3;
  PERFORM ci.deve_falhar(adm, format($c$SELECT frente_cancelar_venda(%L, %L, 'Com NFC-e autorizada')$c$, ped8, aut3), 'cancelar venda com NFC-e já enviada à Sefaz');
  PERFORM ci.exige((SELECT situacao <> 'cancelado' FROM pedidos WHERE id = ped8) AND (SELECT situacao = 'autorizada' FROM nfe WHERE id = n8), 'a venda e a nota seguem como estavam');

  -- criar e cancelar usam o mesmo bloqueio por pedido, e a criação o toma antes de ler o pedido
  PERFORM ci.exige(position('pg_advisory_xact_lock' IN pg_get_functiondef('public.frente_cancelar_venda(uuid, uuid, text)'::regprocedure)) > 0
                   AND position('nfce:' IN pg_get_functiondef('public.frente_cancelar_venda(uuid, uuid, text)'::regprocedure)) > 0,
                   'cancelar a venda toma o bloqueio por pedido da NFC-e');
  PERFORM ci.exige(position('pg_advisory_xact_lock' IN pg_get_functiondef('public.nfce_criar(uuid, text)'::regprocedure))
                   < position('INTO v_ped FROM public.pedidos' IN pg_get_functiondef('public.nfce_criar(uuid, text)'::regprocedure)),
                   'nfce_criar toma o bloqueio antes de ler o pedido');

  -- emitente: a filial do pedido manda quando tem CNPJ, inscrição e endereço próprios; o que ela não tem vem da empresa
  INSERT INTO filiais (tenant_id, empresa_id, nome, cnpj, inscricao_estadual, endereco, cidade)
  VALUES (demo, emp, 'Filial emitente CI', '98765432000110', '999888777', 'Rua da Filial', NULL) RETURNING id INTO fil_emit;
  PERFORM ci.entrar(adm);
  ped5 := criar_pedido_direto(cli, dep, jsonb_build_array(jsonb_build_object('produto_id', prod, 'quantidade', 1, 'preco_unitario', 15)));
  PERFORM ci.sair();
  UPDATE pedidos SET filial_id = fil_emit WHERE id = ped5;
  PERFORM ci.entrar(adm);
  n3 := nfce_criar(ped5);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT emitente ->> 'cnpj' = '98765432000110' AND emitente ->> 'inscricao_estadual' = '999888777'
                           AND emitente ->> 'endereco' = 'Rua da Filial' AND emitente ->> 'filial' = 'Filial emitente CI'
                           AND emitente ->> 'razao_social' IS NOT DISTINCT FROM (SELECT razao_social FROM empresas WHERE id = emp)
                           AND emitente ->> 'estado' IS NOT DISTINCT FROM (SELECT estado FROM empresas WHERE id = emp)
                      FROM nfe WHERE id = n3),
                   'o emitente usa o CNPJ, a inscrição e o endereço da filial, e a empresa no que a filial não tem');

  -- uma venda não leva NFC-e e NF-e ao mesmo tempo
  PERFORM ci.deve_falhar(adm, format($c$SELECT gerar_nfe(%L)$c$, ped3), 'NF-e de pedido que já tem NFC-e');
  PERFORM ci.entrar(adm);
  ped4 := criar_pedido_direto(cli, dep, jsonb_build_array(jsonb_build_object('produto_id', prod, 'quantidade', 1, 'preco_unitario', 10)));
  PERFORM gerar_nfe(ped4);
  PERFORM ci.sair();
  PERFORM ci.deve_falhar(adm, format($c$SELECT nfce_criar(%L)$c$, ped4), 'NFC-e de pedido que já tem NF-e');

  -- número de NFC-e nunca repete na série
  BEGIN
    INSERT INTO nfe (tenant_id, empresa_id, modelo, serie, numero) SELECT tenant_id, empresa_id, 'nfce', serie, numero FROM nfe WHERE id = n1b;
    PERFORM ci.exige(false, 'inserir NFC-e com número repetido deveria falhar');
  EXCEPTION WHEN unique_violation THEN
    PERFORM ci.exige(true, 'número de NFC-e não repete na série');
  END;

  -- o andamento e a contingência só mudam pelo servidor
  PERFORM ci.entrar(vend);
  UPDATE nfe SET contingencia = true WHERE id = n1b;
  GET DIAGNOSTICS n_linhas = ROW_COUNT;
  PERFORM ci.sair();
  PERFORM ci.exige(n_linhas = 0 AND NOT (SELECT contingencia FROM nfe WHERE id = n1b), 'vendedor não marca contingência direto na tabela');
  PERFORM ci.deve_falhar(adm, format($c$UPDATE nfe SET tentativas = 9 WHERE id = %L$c$, n1b), 'administrador altera as tentativas');
  PERFORM ci.deve_falhar(adm, format($c$UPDATE nfe SET modelo = 'nfe' WHERE id = %L$c$, n1b), 'administrador troca o modelo da nota');
  UPDATE nfe SET situacao = 'contingencia', contingencia = true, tentativas = 1 WHERE id = n1b;
  PERFORM ci.exige((SELECT contingencia AND tentativas = 1 FROM nfe WHERE id = n1b), 'o servidor registra a contingência');

  -- CSC é segredo: o navegador não lê nem grava a tabela direto (só as funções da tela); a auditoria mascara o token
  PERFORM ci.deve_falhar(vend, $c$SELECT count(*) FROM nfce_config$c$, 'vendedor lê a tabela da NFC-e');
  PERFORM ci.deve_falhar(cxa, $c$SELECT count(*) FROM nfce_config$c$, 'caixa lê a tabela da NFC-e');
  PERFORM ci.deve_falhar(adm, $c$SELECT csc_token FROM nfce_config$c$, 'administrador lê o token direto da tabela');
  PERFORM ci.deve_falhar(adm, format($c$UPDATE nfce_config SET proximo_numero = 1 WHERE fiscal_config_id = %L$c$, cfg), 'administrador volta a numeração');
  PERFORM ci.deve_falhar(adm, format($c$UPDATE nfce_config SET csc_token = 'ROUBADOROUBADO0123' WHERE fiscal_config_id = %L$c$, cfg), 'administrador troca o CSC direto na tabela');
  PERFORM ci.deve_falhar(vend, format($c$UPDATE nfce_config SET csc_token = 'ROUBADOROUBADO0123' WHERE fiscal_config_id = %L$c$, cfg), 'vendedor troca o CSC direto na tabela');
  PERFORM ci.deve_falhar(adm, format($c$INSERT INTO nfce_config (fiscal_config_id) VALUES (%L)$c$, gen_random_uuid()), 'administrador insere direto na tabela da NFC-e');
  PERFORM ci.entrar(adm);
  PERFORM nfce_config_salvar(cfg, 3, '1', 'NOVOSEGREDO01234567', true);
  PERFORM ci.sair();
  PERFORM ci.exige(NOT EXISTS (SELECT 1 FROM auditoria WHERE entidade = 'nfce_config'
                                  AND (valor_anterior::text LIKE '%SEGREDO%' OR valor_novo::text LIKE '%SEGREDO%')),
                   'a auditoria não guarda o token do CSC');
  PERFORM ci.exige(EXISTS (SELECT 1 FROM auditoria WHERE entidade = 'nfce_config' AND valor_novo ->> 'contingencia_ativa' = 'true'),
                   'a auditoria guarda a troca da contingência');

  -- eventos de pagamento pendentes: só os da empresa, só falhos/ignorados/presos, só financeiro, gestor e administrador
  INSERT INTO tenants (nome) VALUES ('NFC-e B') RETURNING id INTO tb;
  INSERT INTO webhook_eventos (provedor, event_id, tenant_id, status, erro, payload) VALUES
    ('pix', 'ev-erro', demo, 'erro', 'falhou a baixa', '{}'),
    ('pix', 'ev-ok', demo, 'processado', NULL, '{}'),
    ('pix', 'ev-ign', demo, 'ignorado', NULL, '{}'),
    ('pix', 'ev-novo', demo, 'recebido', NULL, '{}'),
    ('pix', 'ev-preso', demo, 'recebido', NULL, '{}'),
    ('pix', 'ev-outro', tb, 'erro', 'de outra empresa', '{}'),
    ('pix', 'ev-sem', NULL, 'erro', 'sem empresa', '{}');
  UPDATE webhook_eventos SET recebido_em = now() - interval '1 hour' WHERE event_id = 'ev-preso';
  PERFORM ci.exige(ci.contar(adm, $c$SELECT count(*) FROM eventos_pendentes()$c$) = 3, 'administrador vê erro, ignorado e preso da própria empresa');
  PERFORM ci.exige(ci.contar(adm, $c$SELECT count(*) FROM eventos_pendentes() WHERE event_id IN ('ev-ok', 'ev-novo', 'ev-outro', 'ev-sem')$c$) = 0,
                   'não vê processado, recente, de outra empresa nem sem empresa');
  PERFORM ci.exige(ci.contar(adm, $c$SELECT count(*) FROM eventos_pendentes() WHERE event_id = 'ev-erro' AND erro = 'falhou a baixa'$c$) = 1, 'mostra o erro');
  PERFORM ci.deve_falhar(vend, $c$SELECT * FROM eventos_pendentes()$c$, 'vendedor vê eventos pendentes');
  PERFORM ci.deve_falhar(cxa, $c$SELECT * FROM eventos_pendentes()$c$, 'caixa vê eventos pendentes');
  PERFORM ci.deve_falhar(NULL, $c$SELECT * FROM eventos_pendentes()$c$, 'anon vê eventos pendentes');
  PERFORM ci.deve_falhar(adm, $c$SELECT * FROM webhook_eventos$c$, 'administrador lê a tabela de eventos direto');
END $$;

-- 32. Tela de configuração da NFC-e: lista sem o token, grava com validação e só administrador e gestor
DO $$
DECLARE
  demo constant uuid := '11111111-1111-1111-1111-111111111111';
  adm  constant uuid := 'a0000000-0000-0000-0000-000000000001';
  vend constant uuid := 'a0000000-0000-0000-0000-000000000002';
  gest constant uuid := 'a0000000-0000-0000-0000-000000000005';
  gar  constant uuid := 'a0000000-0000-0000-0000-000000000006';
  cxa  constant uuid := 'a0000000-0000-0000-0000-0000000000a1';
  cfg uuid; emp uuid; outro uuid; tb uuid; num_antes integer;
BEGIN
  SELECT id INTO emp FROM empresas WHERE tenant_id = demo ORDER BY created_at, id LIMIT 1;
  SELECT id INTO cfg FROM fiscal_config WHERE empresa_id = emp AND filial_id IS NULL ORDER BY created_at LIMIT 1;
  SELECT proximo_numero INTO num_antes FROM nfce_config WHERE fiscal_config_id = cfg;

  -- quem pode
  PERFORM ci.deve_falhar(vend, $c$SELECT * FROM nfce_config_listar()$c$, 'vendedor lista a configuração da NFC-e');
  PERFORM ci.deve_falhar(cxa, $c$SELECT * FROM nfce_config_listar()$c$, 'caixa lista a configuração da NFC-e');
  PERFORM ci.deve_falhar(gar, $c$SELECT * FROM nfce_config_listar()$c$, 'garçom lista a configuração da NFC-e');
  PERFORM ci.deve_falhar(NULL, $c$SELECT * FROM nfce_config_listar()$c$, 'anon lista a configuração da NFC-e');
  PERFORM ci.deve_falhar(vend, format($c$SELECT nfce_config_salvar(%L, 1, '1', NULL, false)$c$, cfg), 'vendedor salva a configuração da NFC-e');
  PERFORM ci.deve_falhar(NULL, format($c$SELECT nfce_config_salvar(%L, 1, '1', NULL, false)$c$, cfg), 'anon salva a configuração da NFC-e');

  -- a lista não devolve o token, só se está configurado
  PERFORM ci.exige(ci.contar(gest, format($c$SELECT count(*) FROM nfce_config_listar() WHERE fiscal_config_id = %L AND csc_configurado AND csc_id = '1'$c$, cfg)) = 1,
                   'a lista mostra o código e que o token está configurado');
  PERFORM ci.exige((SELECT count(*) = 0 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public' AND p.proname = 'nfce_config_listar' AND pg_get_function_result(p.oid) LIKE '%csc_token%'),
                   'o tipo de retorno da lista não tem o token');

  -- validações
  PERFORM ci.deve_falhar(adm, format($c$SELECT nfce_config_salvar(%L, 1000, '1', NULL, false)$c$, cfg), 'série fora da faixa');
  PERFORM ci.deve_falhar(adm, format($c$SELECT nfce_config_salvar(%L, 1, 'abc', NULL, false)$c$, cfg), 'código do CSC com letras');
  PERFORM ci.deve_falhar(adm, format($c$SELECT nfce_config_salvar(%L, 1, '1234567', NULL, false)$c$, cfg), 'código do CSC com 7 números');
  PERFORM ci.deve_falhar(adm, format($c$SELECT nfce_config_salvar(%L, 1, '1', 'curto', false)$c$, cfg), 'token curto');
  PERFORM ci.deve_falhar(adm, format($c$SELECT nfce_config_salvar(%L, 1, '1', 'TOKEN-COM-TRACO-1234', false)$c$, cfg), 'token com símbolo');
  PERFORM ci.deve_falhar(adm, format($c$SELECT nfce_config_salvar(%L, 1, '1', NULL, false)$c$, gen_random_uuid()), 'configuração inexistente');

  -- gravar: token em branco mantém o que existe; o contador não muda
  PERFORM ci.entrar(gest);
  PERFORM nfce_config_salvar(cfg, 7, '9', NULL, true);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT serie = 7 AND csc_id = '9' AND contingencia_ativa AND csc_token = 'NOVOSEGREDO01234567' AND proximo_numero = num_antes
                      FROM nfce_config WHERE fiscal_config_id = cfg), 'token em branco mantém o guardado; série, código e contingência mudam; contador intacto');
  PERFORM ci.entrar(adm);
  PERFORM nfce_config_salvar(cfg, 7, '9', 'TrocaDoToken0123456789', false);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT csc_token = 'TrocaDoToken0123456789' AND NOT contingencia_ativa FROM nfce_config WHERE fiscal_config_id = cfg), 'token novo substitui o antigo');
  PERFORM ci.exige(NOT EXISTS (SELECT 1 FROM auditoria WHERE entidade = 'nfce_config'
                                  AND (valor_anterior::text LIKE '%TrocaDoToken%' OR valor_novo::text LIKE '%TrocaDoToken%')),
                   'a auditoria da tela não guarda o token');

  -- configuração que ainda não tem linha de NFC-e: aparece com padrões e a gravação cria
  INSERT INTO filiais (tenant_id, empresa_id, nome) VALUES (demo, emp, 'Filial NFC-e tela') RETURNING id INTO outro;
  INSERT INTO fiscal_config (tenant_id, empresa_id, filial_id) VALUES (demo, emp, outro) RETURNING id INTO cfg;
  PERFORM ci.exige(ci.contar(adm, format($c$SELECT count(*) FROM nfce_config_listar() WHERE fiscal_config_id = %L AND serie = 1 AND proximo_numero = 1 AND NOT csc_configurado AND filial_nome = 'Filial NFC-e tela'$c$, cfg)) = 1,
                   'configuração sem NFC-e aparece com os padrões');
  PERFORM ci.entrar(adm);
  PERFORM nfce_config_salvar(cfg, 2, '3', 'TokenDaFilial0123456789', false);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT serie = 2 AND csc_id = '3' AND proximo_numero = 1 FROM nfce_config WHERE fiscal_config_id = cfg), 'a gravação cria a linha da NFC-e');

  -- outra empresa não enxerga nem grava
  INSERT INTO tenants (nome) VALUES ('NFC-e tela B') RETURNING id INTO tb;
  PERFORM ci.exige(ci.contar(adm, format($c$SELECT count(*) FROM nfce_config_listar() WHERE fiscal_config_id = %L$c$, gen_random_uuid())) = 0, 'id solto não aparece');
  INSERT INTO fiscal_config (tenant_id) VALUES (tb);
  PERFORM ci.deve_falhar(adm, format($c$SELECT nfce_config_salvar(%L, 1, '1', NULL, false)$c$, (SELECT id FROM fiscal_config WHERE tenant_id = tb)), 'salvar configuração de outra empresa');
  PERFORM ci.exige(ci.contar(adm, format($c$SELECT count(*) FROM nfce_config_listar() WHERE fiscal_config_id = %L$c$, (SELECT id FROM fiscal_config WHERE tenant_id = tb))) = 0, 'não lista a configuração de outra empresa');
END $$;

-- 33. Fase 1: importação por planilha (produtos, clientes e saldos) numa transação, com simulação e limite
DO $$
DECLARE
  demo constant uuid := '11111111-1111-1111-1111-111111111111';
  adm  constant uuid := 'a0000000-0000-0000-0000-000000000001';
  vend constant uuid := 'a0000000-0000-0000-0000-000000000002';
  gest constant uuid := 'a0000000-0000-0000-0000-000000000005';
  gar  constant uuid := 'a0000000-0000-0000-0000-000000000006';
  cxa  constant uuid := 'a0000000-0000-0000-0000-0000000000a1';
  est  constant uuid := 'a0000000-0000-0000-0000-0000000000b1';
  dep uuid; r jsonb; n_antes bigint; n_depois bigint; q numeric; linhas jsonb; i integer; tb uuid;
BEGIN
  INSERT INTO depositos (tenant_id, nome) VALUES (demo, 'Import CI A'), (demo, 'Import CI B');
  SELECT id INTO dep FROM depositos WHERE tenant_id = demo AND nome = 'Import CI A';

  -- quem pode: produtos e clientes só administrador e gestor; saldos também o estoquista
  PERFORM ci.deve_falhar(vend, $c$SELECT importar_produtos('[{"linha":2,"codigo_interno":"IMP-X","descricao":"x"}]'::jsonb)$c$, 'vendedor importa produtos');
  PERFORM ci.deve_falhar(cxa, $c$SELECT importar_produtos('[{"linha":2,"codigo_interno":"IMP-X","descricao":"x"}]'::jsonb)$c$, 'caixa importa produtos');
  PERFORM ci.deve_falhar(gar, $c$SELECT importar_produtos('[{"linha":2,"codigo_interno":"IMP-X","descricao":"x"}]'::jsonb)$c$, 'garçom importa produtos');
  PERFORM ci.deve_falhar(NULL, $c$SELECT importar_produtos('[{"linha":2,"codigo_interno":"IMP-X","descricao":"x"}]'::jsonb)$c$, 'anon importa produtos');
  PERFORM ci.deve_falhar(est, $c$SELECT importar_produtos('[{"linha":2,"codigo_interno":"IMP-X","descricao":"x"}]'::jsonb)$c$, 'estoquista importa produtos');
  PERFORM ci.deve_falhar(vend, $c$SELECT importar_clientes('[{"linha":2,"nome":"x"}]'::jsonb)$c$, 'vendedor importa clientes');
  PERFORM ci.deve_falhar(est, $c$SELECT importar_clientes('[{"linha":2,"nome":"x"}]'::jsonb)$c$, 'estoquista importa clientes');
  PERFORM ci.deve_falhar(vend, $c$SELECT importar_saldos('[{"linha":2,"codigo_interno":"x","quantidade":1}]'::jsonb)$c$, 'vendedor importa saldos');
  PERFORM ci.deve_falhar(cxa, $c$SELECT importar_saldos('[{"linha":2,"codigo_interno":"x","quantidade":1}]'::jsonb)$c$, 'caixa importa saldos');

  -- limites de entrada
  PERFORM ci.deve_falhar(adm, $c$SELECT importar_produtos('[]'::jsonb)$c$, 'planilha vazia');
  PERFORM ci.deve_falhar(adm, $c$SELECT importar_produtos('{"a":1}'::jsonb)$c$, 'linhas que não são lista');
  SELECT jsonb_agg(jsonb_build_object('linha', g + 1, 'codigo_interno', 'LIM-' || g, 'descricao', 'x')) INTO linhas FROM generate_series(1, 5001) g;
  PERFORM ci.deve_falhar(adm, format($c$SELECT importar_produtos(%L::jsonb)$c$, linhas), 'mais de 5000 linhas');

  -- produtos: simulação não grava; erros por linha; nada entra se uma linha falha
  SELECT count(*) INTO n_antes FROM produtos WHERE tenant_id = demo;
  PERFORM ci.entrar(adm);
  r := importar_produtos('[{"linha":2,"codigo_interno":"IMP-1","descricao":"Cimento CP II","unidade":"sc","preco_venda":39.9,"custo":31,"ncm":"25232990","categoria":"Cimentos"},
                           {"linha":3,"codigo_interno":"IMP-2","descricao":"Areia média","unidade":"m3","preco_venda":120,"categoria":"cimentos"}]'::jsonb, false, true);
  PERFORM ci.sair();
  PERFORM ci.exige((r ->> 'ok')::boolean AND (r ->> 'simulado')::boolean AND (r ->> 'criados')::int = 2 AND (r ->> 'categorias_novas')::int = 1,
                   'a simulação conta os produtos novos e a categoria nova (sem diferenciar maiúsculas)');
  SELECT count(*) INTO n_depois FROM produtos WHERE tenant_id = demo;
  PERFORM ci.exige(n_antes = n_depois AND NOT EXISTS (SELECT 1 FROM categorias WHERE tenant_id = demo AND lower(nome) = 'cimentos'),
                   'simular não grava produto nem categoria');

  PERFORM ci.entrar(adm);
  r := importar_produtos('[{"linha":2,"codigo_interno":"IMP-OK","descricao":"Bom"},
                           {"linha":3,"codigo_interno":"IMP-BAD","descricao":"Ruim","ncm":"123"},
                           {"linha":4,"codigo_interno":"imp-ok","descricao":"Repetido"},
                           {"linha":5,"codigo_interno":"","descricao":"Sem código"},
                           {"linha":6,"codigo_interno":"IMP-NEG","descricao":"Negativo","preco_venda":-1},
                           {"linha":7,"codigo_interno":"IMP-TXT","descricao":"Texto","preco_venda":"abc"}]'::jsonb);
  PERFORM ci.sair();
  PERFORM ci.exige(NOT (r ->> 'ok')::boolean AND (r ->> 'n_erros')::int = 5, 'cada linha ruim vira um erro, cinco ao todo');
  PERFORM ci.exige(EXISTS (SELECT 1 FROM jsonb_array_elements(r -> 'erros') e WHERE (e ->> 'linha')::int = 3 AND e ->> 'mensagem' LIKE '%NCM%'), 'o erro diz a linha e o motivo');
  PERFORM ci.exige(NOT EXISTS (SELECT 1 FROM produtos WHERE tenant_id = demo AND codigo_interno = 'IMP-OK'), 'com erro em outra linha, nada entra (tudo ou nada)');

  -- produtos: importar de verdade, categoria criada, tipos e padrões
  PERFORM ci.entrar(gest);
  r := importar_produtos('[{"linha":2,"codigo_interno":"IMP-1","descricao":"Cimento CP II","unidade":"sc","preco_venda":39.9,"custo":31,"ncm":"2523.29.90","categoria":"Cimentos","estoque_minimo":10,"estoque_maximo":100},
                           {"linha":3,"codigo_interno":"IMP-2","descricao":"Areia média","unidade":"m3","preco_venda":120,"categoria":"cimentos"}]'::jsonb, false, false, 'produtos.csv');
  PERFORM ci.sair();
  PERFORM ci.exige((r ->> 'ok')::boolean AND (r ->> 'criados')::int = 2, 'o gestor importa produtos');
  PERFORM ci.exige((SELECT preco_venda = 39.9 AND custo = 31 AND ncm = '25232990' AND unidade = 'sc' AND estoque_minimo = 10 AND estoque_maximo = 100 AND tenant_id = demo
                      FROM produtos WHERE codigo_interno = 'IMP-1' AND tenant_id = demo), 'o produto entra com os dados da planilha (NCM só números)');
  PERFORM ci.exige((SELECT count(*) = 1 FROM categorias WHERE tenant_id = demo AND lower(nome) = 'cimentos'), 'a categoria nova é criada uma vez só');
  PERFORM ci.exige((SELECT p1.categoria_id = p2.categoria_id AND p1.categoria_id IS NOT NULL
                      FROM produtos p1, produtos p2 WHERE p1.codigo_interno = 'IMP-1' AND p2.codigo_interno = 'IMP-2' AND p1.tenant_id = demo AND p2.tenant_id = demo),
                   'os dois produtos usam a mesma categoria');
  PERFORM ci.exige((SELECT count(*) = 1 FROM importacoes WHERE tenant_id = demo AND tipo = 'produtos' AND arquivo = 'produtos.csv' AND criados = 2), 'a importação fica registrada');
  PERFORM ci.exige(ci.contar(adm, $c$SELECT count(*) FROM importacoes$c$) = 1 AND ci.contar(vend, $c$SELECT count(*) FROM importacoes$c$) = 0,
                   'o histórico é de administrador, gestor e estoquista');

  -- produtos: já existe; atualizar só os campos preenchidos
  PERFORM ci.entrar(adm);
  r := importar_produtos('[{"linha":2,"codigo_interno":"IMP-1","descricao":"Cimento novo","preco_venda":45}]'::jsonb);
  PERFORM ci.sair();
  PERFORM ci.exige(NOT (r ->> 'ok')::boolean AND r -> 'erros' -> 0 ->> 'mensagem' LIKE '%já existe%', 'código existente sem pedir para atualizar é recusado');
  PERFORM ci.entrar(adm);
  r := importar_produtos('[{"linha":2,"codigo_interno":"imp-1","descricao":"Cimento novo","preco_venda":45}]'::jsonb, true);
  PERFORM ci.sair();
  PERFORM ci.exige((r ->> 'ok')::boolean AND (r ->> 'atualizados')::int = 1 AND (r ->> 'criados')::int = 0, 'atualizar altera o produto existente (código sem diferenciar maiúsculas)');
  PERFORM ci.exige((SELECT descricao = 'Cimento novo' AND preco_venda = 45 AND custo = 31 AND unidade = 'sc' AND ncm = '25232990'
                      FROM produtos WHERE codigo_interno = 'IMP-1' AND tenant_id = demo), 'campo em branco na planilha mantém o valor que já existe');

  -- clientes
  PERFORM ci.entrar(adm);
  r := importar_clientes('[{"linha":2,"nome":"Construtora Alfa","documento":"11.222.333/0001-81","inscricao_estadual":"123","email":"alfa@x.com","estado":"sp","limite_credito":5000,"prazo_padrao_dias":30},
                           {"linha":3,"nome":"João da Silva","documento":"529.982.247-25","telefone":"(11) 99999-0000"},
                           {"linha":4,"nome":"Cliente sem documento"}]'::jsonb, false, false, 'clientes.csv');
  PERFORM ci.sair();
  PERFORM ci.exige((r ->> 'ok')::boolean AND (r ->> 'criados')::int = 3, 'importa clientes');
  PERFORM ci.exige((SELECT tipo = 'PJ' AND cnpj = '11222333000181' AND cpf IS NULL AND estado = 'SP' AND limite_credito = 5000 AND prazo_padrao_dias = 30
                      FROM clientes WHERE tenant_id = demo AND nome = 'Construtora Alfa'), 'CNPJ vira pessoa jurídica, só números; estado em maiúsculas; limite e prazo entram');
  PERFORM ci.exige((SELECT tipo = 'PF' AND cpf = '52998224725' AND cnpj IS NULL FROM clientes WHERE tenant_id = demo AND nome = 'João da Silva'), 'CPF vira pessoa física');
  PERFORM ci.entrar(adm);
  r := importar_clientes('[{"linha":2,"nome":"Outro nome","documento":"52998224725"},
                           {"linha":3,"nome":"Cliente sem documento"},
                           {"linha":4,"nome":"Novo","documento":"123"},
                           {"linha":5,"nome":"Mail","email":"sem-arroba"},
                           {"linha":6,"nome":"UF","estado":"SPP"},
                           {"linha":7,"nome":"Neg","limite_credito":-5}]'::jsonb);
  PERFORM ci.sair();
  PERFORM ci.exige(NOT (r ->> 'ok')::boolean AND (r ->> 'n_erros')::int = 6, 'cliente que já existe (por CPF ou por nome) e dados ruins são erros');
  PERFORM ci.entrar(adm);
  r := importar_clientes('[{"linha":2,"nome":"João Silva Atualizado","documento":"52998224725","telefone":""}]'::jsonb, true);
  PERFORM ci.sair();
  PERFORM ci.exige((r ->> 'ok')::boolean AND (r ->> 'atualizados')::int = 1, 'atualizar cliente pelo CPF');
  PERFORM ci.exige((SELECT nome = 'João Silva Atualizado' AND telefone = '(11) 99999-0000' FROM clientes WHERE tenant_id = demo AND cpf = '52998224725'),
                   'telefone em branco mantém o que já existe');

  -- saldos
  PERFORM ci.entrar(est);
  r := importar_saldos('[{"linha":2,"codigo_interno":"IMP-1","deposito":"Import CI A","quantidade":80},
                         {"linha":3,"codigo_interno":"IMP-2","deposito":"import ci b","quantidade":12.5}]'::jsonb, false, 'saldos.csv');
  PERFORM ci.sair();
  PERFORM ci.exige((r ->> 'ok')::boolean AND (r ->> 'atualizados')::int = 2, 'o estoquista importa saldos');
  SELECT quantidade INTO q FROM estoques e JOIN produtos p ON p.id = e.produto_id WHERE p.codigo_interno = 'IMP-1' AND p.tenant_id = demo AND e.deposito_id = dep;
  PERFORM ci.exige(q = 80, 'o saldo do depósito fica igual ao da planilha');
  PERFORM ci.exige((SELECT count(*) = 1 FROM estoque_movimentacoes m JOIN produtos p ON p.id = m.produto_id
                     WHERE p.codigo_interno = 'IMP-2' AND p.tenant_id = demo AND m.motivo = 'Importação por planilha'), 'o saldo entra como movimentação com histórico');
  PERFORM ci.entrar(adm);
  r := importar_saldos('[{"linha":2,"codigo_interno":"IMP-1","deposito":"Import CI A","quantidade":60},
                         {"linha":3,"codigo_interno":"NAO-EXISTE","deposito":"Import CI A","quantidade":1},
                         {"linha":4,"codigo_interno":"IMP-2","deposito":"","quantidade":1},
                         {"linha":5,"codigo_interno":"IMP-2","deposito":"Depósito fantasma","quantidade":1},
                         {"linha":6,"codigo_interno":"IMP-2","deposito":"Import CI B","quantidade":0},
                         {"linha":7,"codigo_interno":"IMP-1","deposito":"Import CI A","quantidade":5}]'::jsonb);
  PERFORM ci.sair();
  PERFORM ci.exige(NOT (r ->> 'ok')::boolean AND (r ->> 'n_erros')::int = 5, 'produto inexistente, depósito em branco com vários, depósito inexistente, quantidade zero e linha repetida são erros');
  SELECT quantidade INTO q FROM estoques e JOIN produtos p ON p.id = e.produto_id WHERE p.codigo_interno = 'IMP-1' AND p.tenant_id = demo AND e.deposito_id = dep;
  PERFORM ci.exige(q = 80, 'com erro em outra linha, o saldo não muda');

  -- isolamento: nada do que foi importado aparece em outra empresa
  INSERT INTO tenants (nome) VALUES ('Importação B') RETURNING id INTO tb;
  PERFORM ci.exige(NOT EXISTS (SELECT 1 FROM produtos WHERE tenant_id = tb), 'a outra empresa não recebeu produtos');
  PERFORM ci.exige(NOT EXISTS (SELECT 1 FROM clientes WHERE tenant_id = tb), 'a outra empresa não recebeu clientes');
END $$;

-- 34. Extrato bancário (OFX): linhas entram uma vez, conciliam o lançamento igual e o resto fica pendente
DO $$
DECLARE
  demo constant uuid := '11111111-1111-1111-1111-111111111111';
  adm  constant uuid := 'a0000000-0000-0000-0000-000000000001';
  vend constant uuid := 'a0000000-0000-0000-0000-000000000002';
  gar  constant uuid := 'a0000000-0000-0000-0000-000000000006';
  cxa  constant uuid := 'a0000000-0000-0000-0000-0000000000a1';
  fin  constant uuid := 'a0000000-0000-0000-0000-0000000000b2';
  conta uuid; conta2 uuid; m1 uuid; m2 uuid; m3 uuid; r jsonb; lin uuid; mov uuid; tb uuid; contab uuid;
BEGIN
  INSERT INTO contas_bancarias (tenant_id, apelido, saldo_inicial) VALUES (demo, 'Extrato CI A', 0) RETURNING id INTO conta;
  INSERT INTO contas_bancarias (tenant_id, apelido, saldo_inicial) VALUES (demo, 'Extrato CI B', 0) RETURNING id INTO conta2;
  INSERT INTO banco_movimentos (tenant_id, conta_id, data, tipo, valor, descricao) VALUES (demo, conta, '2026-10-05', 'entrada', 1500, 'Recebimento cliente') RETURNING id INTO m1;
  INSERT INTO banco_movimentos (tenant_id, conta_id, data, tipo, valor, descricao) VALUES (demo, conta, '2026-10-07', 'saida', 300, 'Pagamento fornecedor') RETURNING id INTO m2;
  INSERT INTO banco_movimentos (tenant_id, conta_id, data, tipo, valor, descricao) VALUES (demo, conta, '2026-09-01', 'entrada', 99, 'Muito antigo') RETURNING id INTO m3;

  -- quem pode
  PERFORM ci.deve_falhar(vend, format($c$SELECT banco_extrato_importar(%L, '[{"fitid":"X","data":"2026-10-05","valor":1,"descricao":"x"}]'::jsonb)$c$, conta), 'vendedor importa extrato');
  PERFORM ci.deve_falhar(cxa, format($c$SELECT banco_extrato_importar(%L, '[{"fitid":"X","data":"2026-10-05","valor":1,"descricao":"x"}]'::jsonb)$c$, conta), 'caixa importa extrato');
  PERFORM ci.deve_falhar(gar, format($c$SELECT banco_extrato_importar(%L, '[{"fitid":"X","data":"2026-10-05","valor":1,"descricao":"x"}]'::jsonb)$c$, conta), 'garçom importa extrato');
  PERFORM ci.deve_falhar(NULL, format($c$SELECT banco_extrato_importar(%L, '[{"fitid":"X","data":"2026-10-05","valor":1,"descricao":"x"}]'::jsonb)$c$, conta), 'anon importa extrato');
  PERFORM ci.deve_falhar(adm, $c$SELECT banco_extrato_importar(gen_random_uuid(), '[{"fitid":"X","data":"2026-10-05","valor":1,"descricao":"x"}]'::jsonb)$c$, 'conta que não existe');
  PERFORM ci.deve_falhar(adm, format($c$SELECT banco_extrato_importar(%L, '[]'::jsonb)$c$, conta), 'extrato vazio');
  PERFORM ci.deve_falhar(adm, format($c$SELECT banco_extrato_importar(%L, '[{"fitid":"X","data":"2026-10-05","valor":0,"descricao":"x"}]'::jsonb)$c$, conta), 'valor zerado');
  PERFORM ci.deve_falhar(adm, format($c$SELECT banco_extrato_importar(%L, '[{"fitid":"X","data":"2026-13-45","valor":1,"descricao":"x"}]'::jsonb)$c$, conta), 'data inválida');
  PERFORM ci.deve_falhar(adm, format($c$SELECT banco_extrato_importar(%L, '[{"fitid":"X","data":"2026-10-05","valor":"1","descricao":"x"}]'::jsonb)$c$, conta), 'valor em texto');
  PERFORM ci.deve_falhar(adm, format($c$SELECT banco_extrato_importar(%L, '[{"fitid":"X","data":"2026-10-05","valor":1,"descricao":"x"},{"fitid":"X","data":"2026-10-05","valor":2,"descricao":"y"}]'::jsonb)$c$, conta), 'FITID repetido no arquivo');
  PERFORM ci.deve_falhar(adm, format($c$SELECT banco_extrato_importar(%L, (SELECT jsonb_agg(jsonb_build_object('fitid','L'||g,'data','2026-10-05','valor',1,'descricao','x')) FROM generate_series(1,2001) g))$c$, conta), 'mais de 2000 lançamentos');

  -- simulação não grava nada
  PERFORM ci.entrar(fin);
  r := banco_extrato_importar(conta, '[{"fitid":"A1","data":"2026-10-06","valor":1500,"descricao":"PIX cliente"},
                                       {"fitid":"A2","data":"2026-10-07","valor":-300,"descricao":"Boleto fornecedor"},
                                       {"fitid":"A3","data":"2026-10-08","valor":-12.5,"descricao":"Tarifa"},
                                       {"fitid":"A4","data":"2026-10-09","valor":99,"descricao":"Longe demais"}]'::jsonb, 'out.ofx', true);
  PERFORM ci.sair();
  PERFORM ci.exige((r ->> 'simulado')::boolean AND (r ->> 'conciliadas')::int = 2 AND (r ->> 'pendentes')::int = 2 AND (r ->> 'repetidas')::int = 0,
                   'a simulação separa o que concilia sozinho (valor, sentido e até 3 dias) do que fica pendente');
  PERFORM ci.exige(NOT EXISTS (SELECT 1 FROM banco_extrato_linhas WHERE conta_id = conta) AND (SELECT NOT conciliado FROM banco_movimentos WHERE id = m1),
                   'simular não grava linha nem concilia');

  -- importação de verdade (financeiro)
  PERFORM ci.entrar(fin);
  r := banco_extrato_importar(conta, '[{"fitid":"A1","data":"2026-10-06","valor":1500,"descricao":"PIX cliente"},
                                       {"fitid":"A2","data":"2026-10-07","valor":-300,"descricao":"Boleto fornecedor"},
                                       {"fitid":"A3","data":"2026-10-08","valor":-12.5,"descricao":"Tarifa"},
                                       {"fitid":"A4","data":"2026-10-09","valor":99,"descricao":"Longe demais"}]'::jsonb, 'out.ofx');
  PERFORM ci.sair();
  PERFORM ci.exige((r ->> 'conciliadas')::int = 2 AND (r ->> 'pendentes')::int = 2, 'importa e concilia');
  PERFORM ci.exige((SELECT conciliado FROM banco_movimentos WHERE id = m1) AND (SELECT conciliado FROM banco_movimentos WHERE id = m2),
                   'os lançamentos iguais ficam conciliados');
  PERFORM ci.exige(NOT (SELECT conciliado FROM banco_movimentos WHERE id = m3), 'lançamento de outra data não é tocado');
  PERFORM ci.exige((SELECT movimento_id = m1 AND situacao = 'conciliada' FROM banco_extrato_linhas WHERE conta_id = conta AND fitid = 'A1'), 'a linha guarda o lançamento que conciliou');

  -- importar de novo não duplica nem concilia outra vez
  PERFORM ci.entrar(adm);
  r := banco_extrato_importar(conta, '[{"fitid":"A1","data":"2026-10-06","valor":1500,"descricao":"PIX cliente"},
                                       {"fitid":"A5","data":"2026-10-10","valor":-300,"descricao":"Outro de 300"}]'::jsonb);
  PERFORM ci.sair();
  PERFORM ci.exige((r ->> 'repetidas')::int = 1 AND (r ->> 'pendentes')::int = 1 AND (r ->> 'conciliadas')::int = 0, 'linha já importada é pulada; lançamento já conciliado não casa de novo');
  PERFORM ci.exige((SELECT count(*) = 5 FROM banco_extrato_linhas WHERE conta_id = conta), 'cada FITID existe uma vez só');

  -- a mesma linha em outra conta é outra linha
  PERFORM ci.entrar(adm);
  r := banco_extrato_importar(conta2, '[{"fitid":"A1","data":"2026-10-06","valor":1500,"descricao":"PIX cliente"}]'::jsonb);
  PERFORM ci.sair();
  PERFORM ci.exige((r ->> 'repetidas')::int = 0 AND (r ->> 'pendentes')::int = 1, 'o FITID vale por conta');

  -- tratar pendências
  SELECT id INTO lin FROM banco_extrato_linhas WHERE conta_id = conta AND fitid = 'A3';
  PERFORM ci.deve_falhar(vend, format($c$SELECT banco_extrato_lancar(%L)$c$, lin), 'vendedor lança linha do extrato');
  PERFORM ci.deve_falhar(cxa, format($c$SELECT banco_extrato_ignorar(%L)$c$, lin), 'caixa ignora linha do extrato');
  PERFORM ci.entrar(fin);
  mov := banco_extrato_lancar(lin, 'tarifa bancaria');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT tipo = 'saida' AND valor = 12.5 AND conciliado AND origem = 'extrato' AND data = '2026-10-08' AND categoria = 'tarifa bancaria'
                      FROM banco_movimentos WHERE id = mov), 'linha negativa vira saída já conciliada');
  PERFORM ci.exige((SELECT situacao = 'conciliada' AND movimento_id = mov FROM banco_extrato_linhas WHERE id = lin), 'a linha passa a apontar para o lançamento');
  PERFORM ci.deve_falhar(fin, format($c$SELECT banco_extrato_lancar(%L)$c$, lin), 'lançar duas vezes a mesma linha');
  SELECT id INTO lin FROM banco_extrato_linhas WHERE conta_id = conta AND fitid = 'A4';
  PERFORM ci.entrar(fin);
  PERFORM banco_extrato_ignorar(lin);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT situacao = 'ignorada' FROM banco_extrato_linhas WHERE id = lin), 'ignorar');
  PERFORM ci.deve_falhar(fin, format($c$SELECT banco_extrato_lancar(%L)$c$, lin), 'linha ignorada não vira lançamento');
  PERFORM ci.entrar(fin);
  PERFORM banco_extrato_ignorar(lin, false);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT situacao = 'pendente' FROM banco_extrato_linhas WHERE id = lin), 'desfazer o ignorar');

  -- leitura só financeiro/gestão/administrador; sem escrita direta; outra empresa não vê
  PERFORM ci.exige(ci.contar(fin, 'SELECT count(*) FROM banco_extrato_linhas') > 0 AND ci.contar(vend, 'SELECT count(*) FROM banco_extrato_linhas') = 0
                   AND ci.contar(cxa, 'SELECT count(*) FROM banco_extrato_linhas') = 0, 'vendedor e caixa não leem o extrato importado');
  PERFORM ci.deve_falhar(adm, format($c$INSERT INTO banco_extrato_linhas (conta_id, fitid, data, valor, descricao) VALUES (%L, 'DIRETO', current_date, 1, 'x')$c$, conta), 'escrita direta no extrato');
  PERFORM ci.deve_falhar(adm, format($c$UPDATE banco_extrato_linhas SET situacao = 'ignorada' WHERE conta_id = %L$c$, conta), 'alteração direta no extrato');
  INSERT INTO tenants (nome) VALUES ('Extrato B') RETURNING id INTO tb;
  PERFORM ci.exige(NOT EXISTS (SELECT 1 FROM banco_extrato_linhas WHERE tenant_id = tb), 'a outra empresa não recebeu linhas');
END $$;

-- 35. Pet shop (base): produto que é serviço não controla estoque; produto comum segue igual
DO $$
DECLARE
  demo constant uuid := '11111111-1111-1111-1111-111111111111';
  adm  constant uuid := 'a0000000-0000-0000-0000-000000000001';
  vend constant uuid := 'a0000000-0000-0000-0000-000000000002';
  dep uuid; serv uuid; merc uuid; cli uuid; ped uuid; mov_antes bigint; q numeric;
BEGIN
  INSERT INTO depositos (tenant_id, nome, permite_negativo) VALUES (demo, 'Pet CI', false) RETURNING id INTO dep;
  INSERT INTO produtos (tenant_id, codigo_interno, descricao, unidade, preco_venda, controla_estoque)
    VALUES (demo, 'PET-BANHO', 'Banho porte P', 'UN', 60, false) RETURNING id INTO serv;
  INSERT INTO produtos (tenant_id, codigo_interno, descricao, unidade, preco_venda)
    VALUES (demo, 'PET-RACAO', 'Ração 1kg', 'UN', 20) RETURNING id INTO merc;
  INSERT INTO clientes (tenant_id, nome) VALUES (demo, 'Tutor CI') RETURNING id INTO cli;
  PERFORM ci.exige((SELECT controla_estoque FROM produtos WHERE id = merc), 'produto comum controla estoque por padrão');
  PERFORM ci.entrar(adm);
  PERFORM registrar_movimentacao(merc, dep, 'entrada'::mov_tipo, 5, 'ci', 'ci');

  -- chamada direta: serviço não cria saldo nem movimento, em nenhum tipo
  SELECT count(*) INTO mov_antes FROM estoque_movimentacoes WHERE produto_id = serv;
  PERFORM ci.exige(registrar_movimentacao(serv, dep, 'saida'::mov_tipo, 3, 'ci', 'ci') IS NULL, 'saída de serviço não movimenta');
  PERFORM registrar_movimentacao(serv, dep, 'entrada'::mov_tipo, 3, 'ci', 'ci');
  PERFORM registrar_movimentacao(serv, dep, 'reserva'::mov_tipo, 3, 'ci', 'ci');
  PERFORM ci.exige(NOT EXISTS (SELECT 1 FROM estoques WHERE produto_id = serv), 'serviço não tem linha de estoque');
  PERFORM ci.exige((SELECT count(*) FROM estoque_movimentacoes WHERE produto_id = serv) = mov_antes, 'serviço não tem movimentação');

  PERFORM ci.sair();

  -- venda de serviço + mercadoria no mesmo cupom, sem saldo do serviço
  PERFORM ci.entrar(vend);
  ped := pdv_venda(dep, jsonb_build_array(
            jsonb_build_object('produto_id', serv, 'quantidade', 1, 'preco_unitario', 60),
            jsonb_build_object('produto_id', merc, 'quantidade', 2, 'preco_unitario', 20)),
          'crediario', cli, 0, 1, current_date + 30);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT total = 100 FROM pedidos WHERE id = ped), 'a venda soma serviço e mercadoria');
  SELECT quantidade INTO q FROM estoques WHERE produto_id = merc AND deposito_id = dep;
  PERFORM ci.exige(q = 3, 'a mercadoria baixa o estoque normalmente');
  PERFORM ci.exige(NOT EXISTS (SELECT 1 FROM estoques WHERE produto_id = serv), 'o serviço continua sem estoque depois da venda');

  -- mercadoria sem saldo continua sendo recusada
  PERFORM ci.deve_falhar(vend, format($c$SELECT pdv_venda(%L, jsonb_build_array(jsonb_build_object('produto_id', %L, 'quantidade', 99, 'preco_unitario', 20)), 'crediario', %L, 0, 1, current_date + 30)$c$, dep, merc, cli),
                         'mercadoria sem saldo continua recusada');

  -- o cancelamento da venda devolve itens por registrar_movimentacao('entrada'): só a mercadoria volta
  PERFORM ci.entrar(adm);
  PERFORM registrar_movimentacao(serv, dep, 'entrada'::mov_tipo, 1, 'Cancelamento de venda', 'CANC');
  PERFORM registrar_movimentacao(merc, dep, 'entrada'::mov_tipo, 2, 'Cancelamento de venda', 'CANC');
  PERFORM ci.sair();
  SELECT quantidade INTO q FROM estoques WHERE produto_id = merc AND deposito_id = dep;
  PERFORM ci.exige(q = 5, 'cancelar devolve a mercadoria ao estoque');
  PERFORM ci.exige(NOT EXISTS (SELECT 1 FROM estoques WHERE produto_id = serv), 'cancelar não cria estoque do serviço');
END $$;

-- 36. Pet shop (cadastros): pets, serviços, preço por porte/raça/pelagem e profissionais
DO $$
DECLARE
  demo constant uuid := '11111111-1111-1111-1111-111111111111';
  adm  constant uuid := 'a0000000-0000-0000-0000-000000000001';
  vend constant uuid := 'a0000000-0000-0000-0000-000000000002';
  gest constant uuid := 'a0000000-0000-0000-0000-000000000005';
  gar  constant uuid := 'a0000000-0000-0000-0000-000000000006';
  cxa  constant uuid := 'a0000000-0000-0000-0000-0000000000a1';
  est  constant uuid := 'a0000000-0000-0000-0000-0000000000b1';
  tutor uuid; tutor_b uuid; tb uuid; pet uuid; pet2 uuid; pet3 uuid; serv uuid; serv2 uuid; prod uuid; pr uuid; r jsonb; n bigint;
BEGIN
  INSERT INTO clientes (tenant_id, nome) VALUES (demo, 'Tutor Pet CI') RETURNING id INTO tutor;
  INSERT INTO tenants (nome) VALUES ('Pet B') RETURNING id INTO tb;
  INSERT INTO clientes (tenant_id, nome) VALUES (tb, 'Tutor de outra empresa') RETURNING id INTO tutor_b;

  -- quem cadastra pet: administrador, gestor, vendedor e caixa
  PERFORM ci.deve_falhar(gar, format($c$SELECT pet_salvar(jsonb_build_object('cliente_id', %L, 'nome', 'Rex'))$c$, tutor), 'garçom cadastra pet');
  PERFORM ci.deve_falhar(est, format($c$SELECT pet_salvar(jsonb_build_object('cliente_id', %L, 'nome', 'Rex'))$c$, tutor), 'estoquista cadastra pet');
  PERFORM ci.deve_falhar(NULL, format($c$SELECT pet_salvar(jsonb_build_object('cliente_id', %L, 'nome', 'Rex'))$c$, tutor), 'anon cadastra pet');
  PERFORM ci.deve_falhar(vend, format($c$SELECT pet_salvar(jsonb_build_object('cliente_id', %L, 'nome', ''))$c$, tutor), 'pet sem nome');
  PERFORM ci.deve_falhar(vend, format($c$SELECT pet_salvar(jsonb_build_object('cliente_id', %L, 'nome', 'Rex', 'porte', 'enorme'))$c$, tutor), 'porte inválido');
  PERFORM ci.deve_falhar(vend, format($c$SELECT pet_salvar(jsonb_build_object('cliente_id', %L, 'nome', 'Rex', 'peso_kg', 0))$c$, tutor), 'peso zero');
  PERFORM ci.deve_falhar(vend, format($c$SELECT pet_salvar(jsonb_build_object('cliente_id', %L, 'nome', 'Rex'))$c$, tutor_b), 'tutor de outra empresa');
  PERFORM ci.deve_falhar(vend, $c$SELECT pet_salvar(jsonb_build_object('nome', 'Sem tutor'))$c$, 'pet sem tutor');

  PERFORM ci.entrar(vend);
  pet := pet_salvar(jsonb_build_object('cliente_id', tutor, 'nome', 'Thor', 'especie', 'cao', 'raca', ' Poodle ', 'porte', 'pequeno',
                                       'pelagem', 'longa', 'peso_kg', 6.5, 'nascimento', '2023-05-10', 'castrado', true, 'alergias', 'frango'));
  pet2 := pet_salvar(jsonb_build_object('cliente_id', tutor, 'nome', 'Mel', 'raca', 'SRD', 'porte', 'grande', 'pelagem', 'curta'));
  pet3 := pet_salvar(jsonb_build_object('cliente_id', tutor, 'nome', 'Bola', 'especie', 'gato'));
  PERFORM pet_salvar(jsonb_build_object('id', pet2, 'cliente_id', tutor, 'nome', 'Mel', 'raca', 'SRD', 'porte', 'medio', 'pelagem', 'curta'));
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT raca = 'Poodle' AND porte = 'pequeno' AND castrado FROM pets WHERE id = pet), 'o pet guarda os dados (raça sem espaços sobrando)');
  PERFORM ci.exige((SELECT porte = 'medio' FROM pets WHERE id = pet2), 'editar o pet atualiza');
  PERFORM ci.exige(ci.contar(vend, 'SELECT count(*) FROM pets') = 3 AND ci.contar(gar, 'SELECT count(*) FROM pets') = 0, 'o garçom não lê pets');

  -- serviços e preços: só administrador e gestor
  PERFORM ci.deve_falhar(vend, $c$SELECT pet_servico_salvar('{"nome":"Banho"}'::jsonb)$c$, 'vendedor cria serviço');
  PERFORM ci.deve_falhar(cxa, $c$SELECT pet_servico_salvar('{"nome":"Banho"}'::jsonb)$c$, 'caixa cria serviço');
  PERFORM ci.deve_falhar(adm, $c$SELECT pet_servico_salvar('{"nome":""}'::jsonb)$c$, 'serviço sem nome');
  PERFORM ci.deve_falhar(adm, $c$SELECT pet_servico_salvar('{"nome":"Banho","duracao_min":2}'::jsonb)$c$, 'duração curta demais');
  PERFORM ci.deve_falhar(adm, $c$SELECT pet_servico_salvar('{"nome":"Banho","categoria":"voo"}'::jsonb)$c$, 'categoria inválida');
  PERFORM ci.entrar(gest);
  serv := pet_servico_salvar('{"nome":"Banho","categoria":"banho","duracao_min":60,"preco_base":50}'::jsonb);
  serv2 := pet_servico_salvar('{"nome":"Tosa higiênica","categoria":"tosa","duracao_min":30}'::jsonb);
  PERFORM ci.sair();
  SELECT produto_id INTO prod FROM pet_servicos WHERE id = serv;
  PERFORM ci.exige((SELECT NOT controla_estoque AND preco_venda = 50 AND descricao = 'Banho' AND codigo_interno <> '' FROM produtos WHERE id = prod),
                   'o serviço vira um produto sem controle de estoque, com código automático e preço de balcão');
  PERFORM ci.deve_falhar(adm, $c$SELECT pet_servico_salvar('{"nome":" banho "}'::jsonb)$c$, 'nome de serviço repetido (sem diferenciar maiúsculas)');

  PERFORM ci.deve_falhar(vend, format($c$SELECT pet_preco_salvar(%L, NULL, NULL, NULL, 10)$c$, serv), 'vendedor grava preço');
  PERFORM ci.deve_falhar(adm, format($c$SELECT pet_preco_salvar(%L, 'enorme', NULL, NULL, 10)$c$, serv), 'preço com porte inválido');
  PERFORM ci.deve_falhar(adm, format($c$SELECT pet_preco_salvar(%L, NULL, NULL, NULL, -1)$c$, serv), 'preço negativo');
  PERFORM ci.deve_falhar(adm, format($c$SELECT pet_preco_salvar(%L, NULL, NULL, NULL, 10)$c$, gen_random_uuid()), 'serviço que não existe');

  PERFORM ci.entrar(adm);
  PERFORM pet_preco_salvar(serv, NULL, NULL, NULL, 50);                 -- qualquer pet
  PERFORM pet_preco_salvar(serv, 'pequeno', NULL, NULL, 60);
  PERFORM pet_preco_salvar(serv, NULL, NULL, 'longa', 70);
  PERFORM pet_preco_salvar(serv, 'pequeno', NULL, 'longa', 80);
  PERFORM pet_preco_salvar(serv, NULL, 'poodle', NULL, 90);
  pr := pet_preco_salvar(serv, 'pequeno', ' POODLE ', 'longa', 120);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT count(*) = 6 FROM pet_servico_precos WHERE servico_id = serv), 'seis combinações de preço');

  PERFORM ci.entrar(adm);
  PERFORM ci.exige(pet_preco_salvar(serv, 'pequeno', 'poodle', 'longa', 130) = pr, 'a mesma combinação (raça sem diferenciar maiúsculas) atualiza a linha');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT count(*) = 6 AND max(preco) = 130 FROM pet_servico_precos WHERE servico_id = serv), 'sem linha duplicada para a mesma combinação');
  PERFORM ci.deve_falhar_dono(format($c$INSERT INTO pet_servico_precos (tenant_id, servico_id, porte, raca, pelagem, preco) VALUES (%L, %L, 'pequeno', 'POODLE ', 'longa', 1)$c$, demo, serv),
                              'o índice único barra a mesma combinação inserida direto');

  -- o preço calculado no banco segue a mesma regra do código
  PERFORM ci.entrar(vend);
  r := pet_preco_calcular(serv, pet);   -- poodle pequeno de pelagem longa
  PERFORM ci.exige((r ->> 'preco')::numeric = 130 AND (r ->> 'pontos')::int = 7, 'raça + pelagem + porte vence');
  r := pet_preco_calcular(serv, pet2);  -- SRD médio de pelagem curta
  PERFORM ci.exige((r ->> 'preco')::numeric = 50, 'cai no preço de qualquer pet');
  r := pet_preco_calcular(serv2, pet);  -- serviço sem nenhum preço
  PERFORM ci.exige(r IS NULL, 'serviço sem preço cadastrado não é oferecido');
  PERFORM ci.sair();

  PERFORM ci.deve_falhar(cxa, format($c$SELECT pet_preco_remover(%L)$c$, pr), 'caixa remove preço');
  PERFORM ci.entrar(adm);
  PERFORM pet_preco_remover(pr);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT count(*) = 5 FROM pet_servico_precos WHERE servico_id = serv), 'remover preço');
  PERFORM ci.entrar(vend);
  r := pet_preco_calcular(serv, pet);   -- sem a linha completa, vale "poodle"
  PERFORM ci.sair();
  PERFORM ci.exige((r ->> 'preco')::numeric = 90, 'sem a combinação completa, vence a raça sozinha');
  PERFORM ci.deve_falhar(gar, format($c$SELECT pet_preco_calcular(%L, %L)$c$, serv, pet), 'garçom calcula preço');

  -- profissionais
  PERFORM ci.deve_falhar(vend, $c$SELECT pet_profissional_salvar('{"nome":"Ana"}'::jsonb)$c$, 'vendedor cria profissional');
  PERFORM ci.deve_falhar(adm, $c$SELECT pet_profissional_salvar('{"nome":""}'::jsonb)$c$, 'profissional sem nome');
  PERFORM ci.deve_falhar(adm, $c$SELECT pet_profissional_salvar('{"nome":"Ana","funcao":"astronauta"}'::jsonb)$c$, 'função inválida');
  PERFORM ci.deve_falhar(adm, $c$SELECT pet_profissional_salvar('{"nome":"Ana","comissao_percentual":101}'::jsonb)$c$, 'comissão acima de 100');
  PERFORM ci.entrar(gest);
  PERFORM pet_profissional_salvar('{"nome":"Ana","funcao":"groomer","comissao_percentual":30}'::jsonb);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT funcao = 'groomer' AND comissao_percentual = 30 FROM pet_profissionais WHERE nome = 'Ana' AND tenant_id = demo), 'grava o profissional');

  -- escrita direta negada e isolamento entre empresas
  PERFORM ci.deve_falhar(adm, format($c$INSERT INTO pets (cliente_id, nome) VALUES (%L, 'Direto')$c$, tutor), 'escrita direta em pets');
  PERFORM ci.deve_falhar(adm, format($c$UPDATE pet_servicos SET nome = 'x' WHERE id = %L$c$, serv), 'alteração direta em serviços');
  PERFORM ci.deve_falhar(adm, $c$DELETE FROM pet_profissionais$c$, 'apagar profissional direto');
  SELECT count(*) INTO n FROM pets WHERE tenant_id = tb;
  PERFORM ci.exige(n = 0 AND NOT EXISTS (SELECT 1 FROM pet_servicos WHERE tenant_id = tb), 'a outra empresa não recebeu cadastros');
  PERFORM ci.exige(ci.contar(gar, 'SELECT count(*) FROM pet_servicos') = 0 AND ci.contar(gar, 'SELECT count(*) FROM pet_profissionais') = 0
                   AND ci.contar(gar, 'SELECT count(*) FROM pet_servico_precos') = 0, 'o garçom não lê serviços, preços nem profissionais');
END $$;

-- 37. Pet shop (agenda): sem sobreposição por profissional, preço congelado, transições válidas e motivo
DO $$
DECLARE
  demo constant uuid := '11111111-1111-1111-1111-111111111111';
  adm  constant uuid := 'a0000000-0000-0000-0000-000000000001';
  vend constant uuid := 'a0000000-0000-0000-0000-000000000002';
  gest constant uuid := 'a0000000-0000-0000-0000-000000000005';
  gar  constant uuid := 'a0000000-0000-0000-0000-000000000006';
  est  constant uuid := 'a0000000-0000-0000-0000-0000000000b1';
  tutor uuid; pet uuid; pet_sem_preco uuid; pet_inativo uuid; prof uuid; prof2 uuid; prof_off uuid; serv uuid; serv2 uuid; serv_sem uuid; ag uuid; ag2 uuid; ag3 uuid;
  base timestamptz := date_trunc('day', now()) + interval '2 days' + interval '9 hours';
  r record; tb uuid; n bigint;
BEGIN
  INSERT INTO clientes (tenant_id, nome) VALUES (demo, 'Tutor Agenda CI') RETURNING id INTO tutor;
  INSERT INTO tenants (nome) VALUES ('Agenda B') RETURNING id INTO tb;
  PERFORM ci.entrar(vend);
  pet := pet_salvar(jsonb_build_object('cliente_id', tutor, 'nome', 'Thor', 'raca', 'Poodle', 'porte', 'pequeno', 'pelagem', 'longa'));
  pet_sem_preco := pet_salvar(jsonb_build_object('cliente_id', tutor, 'nome', 'Gigante', 'porte', 'gigante'));
  pet_inativo := pet_salvar(jsonb_build_object('cliente_id', tutor, 'nome', 'Inativo', 'porte', 'pequeno', 'ativo', false));
  PERFORM ci.sair();
  PERFORM ci.entrar(gest);
  serv := pet_servico_salvar('{"nome":"Banho Agenda","duracao_min":60}'::jsonb);
  serv2 := pet_servico_salvar('{"nome":"Tosa Agenda","categoria":"tosa","duracao_min":30}'::jsonb);
  serv_sem := pet_servico_salvar('{"nome":"Hidratação Agenda","categoria":"estetica","duracao_min":45}'::jsonb);
  PERFORM pet_preco_salvar(serv, 'pequeno', NULL, NULL, 60);
  PERFORM pet_preco_salvar(serv, NULL, 'poodle', NULL, 90);
  PERFORM pet_preco_salvar(serv2, NULL, NULL, NULL, 40);
  prof := pet_profissional_salvar('{"nome":"Ana Agenda","funcao":"tosador","comissao_percentual":30}'::jsonb);
  prof2 := pet_profissional_salvar('{"nome":"Beto Agenda","funcao":"banhista"}'::jsonb);
  prof_off := pet_profissional_salvar('{"nome":"Inativo Agenda","ativo":false}'::jsonb);
  PERFORM ci.sair();

  -- quem agenda: administrador, gestor, vendedor e caixa
  PERFORM ci.deve_falhar(gar, format($c$SELECT pet_agendar(jsonb_build_object('pet_id', %L, 'profissional_id', %L, 'inicio', %L::timestamptz, 'servicos', jsonb_build_array(jsonb_build_object('servico_id', %L))))$c$, pet, prof, base, serv), 'garçom agenda');
  PERFORM ci.deve_falhar(est, format($c$SELECT pet_agendar(jsonb_build_object('pet_id', %L, 'profissional_id', %L, 'inicio', %L::timestamptz, 'servicos', jsonb_build_array(jsonb_build_object('servico_id', %L))))$c$, pet, prof, base, serv), 'estoquista agenda');
  PERFORM ci.deve_falhar(NULL, format($c$SELECT pet_agendar(jsonb_build_object('pet_id', %L, 'profissional_id', %L, 'inicio', %L::timestamptz, 'servicos', jsonb_build_array(jsonb_build_object('servico_id', %L))))$c$, pet, prof, base, serv), 'anon agenda');

  -- validações
  PERFORM ci.deve_falhar(vend, format($c$SELECT pet_agendar(jsonb_build_object('pet_id', %L, 'profissional_id', %L, 'servicos', jsonb_build_array(jsonb_build_object('servico_id', %L))))$c$, pet, prof, serv), 'sem horário');
  PERFORM ci.deve_falhar(vend, format($c$SELECT pet_agendar(jsonb_build_object('pet_id', %L, 'profissional_id', %L, 'inicio', %L::timestamptz, 'servicos', '[]'::jsonb))$c$, pet, prof, base), 'sem serviço');
  PERFORM ci.deve_falhar(vend, format($c$SELECT pet_agendar(jsonb_build_object('pet_id', %L, 'profissional_id', %L, 'inicio', %L::timestamptz, 'servicos', jsonb_build_array(jsonb_build_object('servico_id', %L))))$c$, pet_inativo, prof, base, serv), 'pet inativo');
  PERFORM ci.deve_falhar(vend, format($c$SELECT pet_agendar(jsonb_build_object('pet_id', %L, 'profissional_id', %L, 'inicio', %L::timestamptz, 'servicos', jsonb_build_array(jsonb_build_object('servico_id', %L))))$c$, pet, prof_off, base, serv), 'profissional inativo');
  PERFORM ci.deve_falhar(vend, format($c$SELECT pet_agendar(jsonb_build_object('pet_id', %L, 'profissional_id', %L, 'inicio', %L::timestamptz, 'servicos', jsonb_build_array(jsonb_build_object('servico_id', %L), jsonb_build_object('servico_id', %L))))$c$, pet, prof, base, serv, serv), 'serviço repetido');
  PERFORM ci.deve_falhar(vend, format($c$SELECT pet_agendar(jsonb_build_object('pet_id', %L, 'profissional_id', %L, 'inicio', %L::timestamptz, 'servicos', jsonb_build_array(jsonb_build_object('servico_id', %L))))$c$, pet_sem_preco, prof, base, serv), 'pet sem preço para o serviço');
  PERFORM ci.deve_falhar(vend, format($c$SELECT pet_agendar(jsonb_build_object('pet_id', %L, 'profissional_id', %L, 'inicio', %L::timestamptz, 'servicos', jsonb_build_array(jsonb_build_object('servico_id', %L, 'preco_avulso', 55))))$c$, pet_sem_preco, prof, base, serv), 'vendedor informa preço avulso');

  -- agendar (preço da raça vence o do porte; duração soma os serviços)
  PERFORM ci.entrar(vend);
  ag := pet_agendar(jsonb_build_object('pet_id', pet, 'profissional_id', prof, 'inicio', base, 'taxi_dog', true,
                    'servicos', jsonb_build_array(jsonb_build_object('servico_id', serv), jsonb_build_object('servico_id', serv2))));
  PERFORM ci.sair();
  SELECT * INTO r FROM pet_agendamentos WHERE id = ag;
  PERFORM ci.exige(r.fim - r.inicio = interval '90 minutes' AND r.situacao = 'agendado' AND r.taxi_dog AND r.cliente_id = tutor, 'o fim soma a duração dos serviços; o tutor vem do pet');
  PERFORM ci.exige((SELECT sum(preco_aplicado) = 130 FROM pet_agendamento_itens WHERE agendamento_id = ag), 'banho de poodle (90) + tosa (40): vale o preço mais específico');

  -- preço congelado: mudar a tabela não muda o agendamento
  PERFORM ci.entrar(gest);
  PERFORM pet_preco_salvar(serv, NULL, 'poodle', NULL, 200);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT sum(preco_aplicado) = 130 FROM pet_agendamento_itens WHERE agendamento_id = ag), 'o preço combinado fica congelado');

  -- sobreposição: mesmo profissional não pode; encostar pode; outro profissional pode
  PERFORM ci.deve_falhar(vend, format($c$SELECT pet_agendar(jsonb_build_object('pet_id', %L, 'profissional_id', %L, 'inicio', %L::timestamptz, 'servicos', jsonb_build_array(jsonb_build_object('servico_id', %L))))$c$, pet, prof, base + interval '30 minutes', serv2), 'sobrepõe o horário do mesmo profissional');
  PERFORM ci.deve_falhar(vend, format($c$SELECT pet_agendar(jsonb_build_object('pet_id', %L, 'profissional_id', %L, 'inicio', %L::timestamptz, 'servicos', jsonb_build_array(jsonb_build_object('servico_id', %L))))$c$, pet, prof, base - interval '20 minutes', serv), 'termina depois que o outro começa');
  PERFORM ci.entrar(vend);
  ag2 := pet_agendar(jsonb_build_object('pet_id', pet, 'profissional_id', prof, 'inicio', base + interval '90 minutes', 'servicos', jsonb_build_array(jsonb_build_object('servico_id', serv2))));
  ag3 := pet_agendar(jsonb_build_object('pet_id', pet, 'profissional_id', prof2, 'inicio', base, 'servicos', jsonb_build_array(jsonb_build_object('servico_id', serv2))));
  PERFORM ci.sair();
  PERFORM ci.exige(ag2 IS NOT NULL AND ag3 IS NOT NULL, 'um começa quando o outro termina; outro profissional no mesmo horário');

  -- preço avulso só da gestão, marcado no item
  PERFORM ci.entrar(gest);
  ag := pet_agendar(jsonb_build_object('pet_id', pet_sem_preco, 'profissional_id', prof, 'inicio', base + interval '5 hours',
                    'servicos', jsonb_build_array(jsonb_build_object('servico_id', serv_sem, 'preco_avulso', 75))));
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT preco_aplicado = 75 AND preco_avulso FROM pet_agendamento_itens WHERE agendamento_id = ag), 'a gestão informa preço avulso e ele fica marcado');

  -- transições
  PERFORM ci.deve_falhar(vend, format($c$SELECT pet_agenda_situacao(%L, 'pronto')$c$, ag2), 'agendado direto para pronto');
  PERFORM ci.deve_falhar(vend, format($c$SELECT pet_agenda_situacao(%L, 'retirado')$c$, ag2), 'retirado não sai da agenda');
  PERFORM ci.deve_falhar(vend, format($c$SELECT pet_agenda_situacao(%L, 'cancelado')$c$, ag2), 'cancelar sem motivo');
  PERFORM ci.deve_falhar(gar, format($c$SELECT pet_agenda_situacao(%L, 'confirmado')$c$, ag2), 'garçom muda situação');
  PERFORM ci.entrar(vend);
  PERFORM pet_agenda_situacao(ag2, 'confirmado');
  PERFORM pet_agenda_situacao(ag2, 'em_atendimento');
  PERFORM pet_agenda_situacao(ag2, 'pronto');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT situacao FROM pet_agendamentos WHERE id = ag2) = 'pronto', 'agendado → confirmado → em atendimento → pronto');
  PERFORM ci.deve_falhar(vend, format($c$SELECT pet_agenda_situacao(%L, 'cancelado', 'desistiu')$c$, ag2), 'cancelar depois de pronto');
  PERFORM ci.deve_falhar(vend, format($c$SELECT pet_reagendar(%L, %L::timestamptz)$c$, ag2, base + interval '8 hours'), 'remarcar depois de pronto');

  -- cancelar libera o horário
  PERFORM ci.entrar(vend);
  PERFORM pet_agenda_situacao(ag3, 'cancelado', 'tutor desistiu');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT situacao = 'cancelado' AND motivo = 'tutor desistiu' FROM pet_agendamentos WHERE id = ag3), 'cancelar guarda o motivo');
  PERFORM ci.entrar(vend);
  PERFORM pet_agendar(jsonb_build_object('pet_id', pet, 'profissional_id', prof2, 'inicio', base, 'servicos', jsonb_build_array(jsonb_build_object('servico_id', serv2))));
  PERFORM ci.sair();
  PERFORM ci.exige(true, 'o horário cancelado volta a ficar livre');

  -- remarcar
  PERFORM ci.deve_falhar(vend, format($c$SELECT pet_reagendar(%L, %L::timestamptz, %L)$c$, ag, base + interval '30 minutes', prof), 'remarcar para cima de outro atendimento');
  PERFORM ci.deve_falhar(vend, format($c$SELECT pet_reagendar(%L, %L::timestamptz, %L)$c$, ag, base + interval '7 hours', prof_off), 'remarcar para profissional inativo');
  PERFORM ci.entrar(vend);
  PERFORM pet_reagendar(ag, base + interval '6 hours');                    -- o mesmo profissional, outro horário
  PERFORM pet_reagendar(ag, base + interval '6 hours 10 minutes', prof2);  -- outro profissional
  PERFORM ci.sair();
  SELECT * INTO r FROM pet_agendamentos WHERE id = ag;
  PERFORM ci.exige(r.profissional_id = prof2 AND r.fim - r.inicio = interval '45 minutes', 'remarcar mantém a duração e troca o profissional');

  -- leitura e escrita direta
  PERFORM ci.exige(ci.contar(vend, 'SELECT count(*) FROM pet_agendamentos') >= 3 AND ci.contar(gar, 'SELECT count(*) FROM pet_agendamentos') = 0
                   AND ci.contar(gar, 'SELECT count(*) FROM pet_agendamento_itens') = 0, 'o garçom não lê a agenda');
  PERFORM ci.deve_falhar(adm, format($c$UPDATE pet_agendamentos SET situacao = 'retirado' WHERE id = %L$c$, ag2), 'escrita direta na agenda');
  PERFORM ci.deve_falhar(adm, format($c$DELETE FROM pet_agendamento_itens WHERE agendamento_id = %L$c$, ag2), 'apagar item da agenda direto');
  SELECT count(*) INTO n FROM pet_agendamentos WHERE tenant_id = tb;
  PERFORM ci.exige(n = 0, 'a outra empresa não recebeu agendamentos');
END $$;

-- 38. Pet shop (cobrança): retirar e cobrar, comissão, NFS-e em rascunho, NFC-e só de mercadoria e venda cancelada
DO $$
DECLARE
  demo constant uuid := '11111111-1111-1111-1111-111111111111';
  adm  constant uuid := 'a0000000-0000-0000-0000-000000000001';
  vend constant uuid := 'a0000000-0000-0000-0000-000000000002';
  gest constant uuid := 'a0000000-0000-0000-0000-000000000005';
  gar  constant uuid := 'a0000000-0000-0000-0000-000000000006';
  est  constant uuid := 'a0000000-0000-0000-0000-0000000000b1';
  fin  constant uuid := 'a0000000-0000-0000-0000-0000000000b2';
  tutor uuid; pet uuid; prof uuid; serv uuid; serv_prod uuid; merc uuid; dep uuid; ag uuid; ag2 uuid; ag3 uuid;
  ped uuid; ped2 uuid; ped_so_serv uuid; ped_errado uuid; r jsonb; com uuid; nfe_ct bigint; n bigint;
  t0 timestamptz := date_trunc('day', now()) + interval '3 days' + interval '9 hours';
BEGIN
  INSERT INTO depositos (tenant_id, nome) VALUES (demo, 'Pet Cobrança CI') RETURNING id INTO dep;
  INSERT INTO produtos (tenant_id, codigo_interno, descricao, unidade, preco_venda, ncm, cst_csosn) VALUES (demo, 'PET-COB-RACAO', 'Ração cobrança', 'UN', 20, '23091000', '102') RETURNING id INTO merc;
  INSERT INTO clientes (tenant_id, nome, cpf) VALUES (demo, 'Tutor Cobrança CI', '52998224725') RETURNING id INTO tutor;
  PERFORM ci.entrar(adm);
  PERFORM registrar_movimentacao(merc, dep, 'entrada'::mov_tipo, 50, 'ci', 'ci');
  PERFORM ci.sair();
  PERFORM ci.entrar(gest);
  serv := pet_servico_salvar('{"nome":"Banho Cobrança","duracao_min":60}'::jsonb);
  PERFORM pet_preco_salvar(serv, NULL, NULL, NULL, 60);
  prof := pet_profissional_salvar('{"nome":"Cris Cobrança","funcao":"tosador","comissao_percentual":30}'::jsonb);
  PERFORM ci.sair();
  SELECT produto_id INTO serv_prod FROM pet_servicos WHERE id = serv;
  PERFORM ci.entrar(vend);
  pet := pet_salvar(jsonb_build_object('cliente_id', tutor, 'nome', 'Rex Cobrança', 'porte', 'pequeno'));
  ag := pet_agendar(jsonb_build_object('pet_id', pet, 'profissional_id', prof, 'inicio', t0, 'servicos', jsonb_build_array(jsonb_build_object('servico_id', serv))));
  ag2 := pet_agendar(jsonb_build_object('pet_id', pet, 'profissional_id', prof, 'inicio', t0 + interval '2 hours', 'servicos', jsonb_build_array(jsonb_build_object('servico_id', serv))));
  ag3 := pet_agendar(jsonb_build_object('pet_id', pet, 'profissional_id', prof, 'inicio', t0 + interval '4 hours', 'servicos', jsonb_build_array(jsonb_build_object('servico_id', serv))));
  -- venda do caixa: serviço (60) + 2 rações (40), desconto de 10 no total
  ped := pdv_venda(dep, jsonb_build_array(jsonb_build_object('produto_id', serv_prod, 'quantidade', 1, 'preco_unitario', 60),
                                          jsonb_build_object('produto_id', merc, 'quantidade', 2, 'preco_unitario', 20)),
                   'crediario', tutor, 10, 1, current_date + 30);
  ped_so_serv := pdv_venda(dep, jsonb_build_array(jsonb_build_object('produto_id', serv_prod, 'quantidade', 1, 'preco_unitario', 60)), 'crediario', tutor, 0, 1, current_date + 30);
  ped_errado := pdv_venda(dep, jsonb_build_array(jsonb_build_object('produto_id', serv_prod, 'quantidade', 1, 'preco_unitario', 50)), 'crediario', tutor, 0, 1, current_date + 30);
  PERFORM ci.sair();

  -- só atendimento pronto é cobrado
  PERFORM ci.deve_falhar(vend, format($c$SELECT pet_agenda_retirar(%L, %L)$c$, ag, ped), 'cobrar atendimento que ainda não está pronto');
  PERFORM ci.entrar(vend);
  PERFORM pet_agenda_situacao(ag, 'em_atendimento'); PERFORM pet_agenda_situacao(ag, 'pronto');
  PERFORM pet_agenda_situacao(ag2, 'em_atendimento'); PERFORM pet_agenda_situacao(ag2, 'pronto');
  PERFORM ci.sair();

  -- a venda tem de ser a certa
  PERFORM ci.deve_falhar(gar, format($c$SELECT pet_agenda_retirar(%L, %L)$c$, ag, ped), 'garçom cobra');
  PERFORM ci.deve_falhar(est, format($c$SELECT pet_agenda_retirar(%L, %L)$c$, ag, ped), 'estoquista cobra');
  PERFORM ci.deve_falhar(NULL, format($c$SELECT pet_agenda_retirar(%L, %L)$c$, ag, ped), 'anon cobra');
  PERFORM ci.deve_falhar(vend, format($c$SELECT pet_agenda_retirar(%L)$c$, ag), 'sem informar a venda');
  PERFORM ci.deve_falhar(vend, format($c$SELECT pet_agenda_retirar(%L, %L)$c$, ag, ped_errado), 'venda com o serviço por outro valor');
  PERFORM ci.deve_falhar(vend, format($c$SELECT pet_agenda_retirar(%L, %L)$c$, ag, gen_random_uuid()), 'venda que não existe');

  -- cobrar: comissão sobre a parte do serviço já com o desconto proporcional (60 de 100 → 54 → 30% = 16,20)
  PERFORM ci.entrar(vend);
  r := pet_agenda_retirar(ag, ped);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT situacao = 'retirado' AND venda_id = ped FROM pet_agendamentos WHERE id = ag), 'o atendimento fica retirado e ligado à venda');
  PERFORM ci.exige((SELECT base = 54 AND percentual = 30 AND valor = 16.20 AND situacao = 'a_aprovar' FROM pet_comissoes WHERE agendamento_id = ag),
                   'comissão de 30% sobre o serviço líquido do desconto, sem contar a ração');
  PERFORM ci.exige((SELECT modelo = 'nfse' AND situacao = 'rascunho' AND valor_total = 54 AND valor_produtos = 60 AND valor_desconto = 6 AND array_length(pendencias, 1) > 0
                      FROM nfe WHERE pedido_id = ped AND modelo = 'nfse'), 'NFS-e do serviço em rascunho, com as pendências de configuração');
  PERFORM ci.exige((SELECT count(*) = 1 FROM nfe_itens WHERE nfe_id = (r ->> 'nfe_id')::uuid), 'a NFS-e leva o serviço');

  -- repetir a chamada não duplica nada
  PERFORM ci.entrar(vend);
  r := pet_agenda_retirar(ag, ped);
  PERFORM ci.sair();
  PERFORM ci.exige((r ->> 'repetido')::boolean AND (SELECT count(*) = 1 FROM pet_comissoes WHERE agendamento_id = ag)
                   AND (SELECT count(*) = 1 FROM nfe WHERE pedido_id = ped AND modelo = 'nfse'), 'repetir a cobrança não duplica comissão nem nota');
  PERFORM ci.deve_falhar(vend, format($c$SELECT pet_agenda_retirar(%L, %L)$c$, ag2, ped), 'a mesma venda cobrando dois atendimentos');
  PERFORM ci.deve_falhar(vend, format($c$SELECT pet_agenda_situacao(%L, 'cancelado', 'x')$c$, ag), 'cancelar atendimento já retirado');

  -- NFC-e: só a ração entra (40 − 4 de desconto proporcional = 36); venda só de serviço não gera NFC-e
  PERFORM ci.entrar(vend);
  PERFORM nfce_criar(ped);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT valor_produtos = 40 AND valor_desconto = 4 AND valor_total = 36 FROM nfe WHERE pedido_id = ped AND modelo = 'nfce'), 'a NFC-e leva só a mercadoria e a parte do desconto dela');
  PERFORM ci.exige((SELECT count(*) = 1 FROM nfe_itens WHERE nfe_id = (SELECT id FROM nfe WHERE pedido_id = ped AND modelo = 'nfce')), 'a NFC-e não leva o serviço');
  PERFORM ci.deve_falhar(vend, format($c$SELECT nfce_criar(%L)$c$, ped_so_serv), 'NFC-e de venda só de serviço');

  -- venda cancelada: atendimento volta a pronto, comissão cancelada e NFS-e em rascunho sai
  UPDATE pedidos SET situacao = 'cancelado' WHERE id = ped;
  PERFORM ci.exige((SELECT situacao = 'pronto' AND venda_id IS NULL FROM pet_agendamentos WHERE id = ag), 'venda cancelada devolve o atendimento a pronto');
  PERFORM ci.exige((SELECT situacao = 'cancelada' FROM pet_comissoes WHERE agendamento_id = ag), 'venda cancelada cancela a comissão');
  PERFORM ci.exige(NOT EXISTS (SELECT 1 FROM nfe WHERE pedido_id = ped AND modelo = 'nfse'), 'venda cancelada tira o rascunho da NFS-e');
  PERFORM ci.deve_falhar(vend, format($c$SELECT pet_agenda_retirar(%L, %L)$c$, ag, ped), 'cobrar com venda cancelada');

  -- cobrar de novo o mesmo atendimento com outra venda: a comissão cancelada volta a valer
  PERFORM ci.entrar(vend);
  ped2 := pdv_venda(dep, jsonb_build_array(jsonb_build_object('produto_id', serv_prod, 'quantidade', 1, 'preco_unitario', 60)), 'crediario', tutor, 0, 1, current_date + 30);
  r := pet_agenda_retirar(ag, ped2);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT situacao = 'a_aprovar' AND pedido_id = ped2 AND base = 60 AND valor = 18 FROM pet_comissoes WHERE agendamento_id = ag), 'cobrar de novo reativa a comissão cancelada, com a nova venda');
  PERFORM ci.exige((SELECT count(*) = 1 FROM pet_comissoes WHERE agendamento_id = ag) AND EXISTS (SELECT 1 FROM nfe WHERE pedido_id = ped2 AND modelo = 'nfse'), 'uma comissão por atendimento e nova NFS-e em rascunho');
  PERFORM ci.entrar(vend);
  -- ag2 (outro atendimento pronto) usa a venda só de serviço
  r := pet_agenda_retirar(ag2, ped_so_serv);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT base = 60 AND valor = 18 FROM pet_comissoes WHERE agendamento_id = ag2), 'sem desconto, a comissão é 30% do valor do serviço');

  -- comissões: aprovar e pagar
  SELECT id INTO com FROM pet_comissoes WHERE agendamento_id = ag2;
  PERFORM ci.deve_falhar(vend, format($c$SELECT pet_comissao_aprovar(%L)$c$, com), 'vendedor aprova comissão');
  PERFORM ci.deve_falhar(fin, format($c$SELECT pet_comissao_pagar(%L)$c$, com), 'pagar comissão não aprovada');
  PERFORM ci.entrar(fin);
  PERFORM pet_comissao_aprovar(com);
  PERFORM ci.sair();
  PERFORM ci.deve_falhar(fin, format($c$SELECT pet_comissao_aprovar(%L)$c$, com), 'aprovar duas vezes');
  PERFORM ci.entrar(gest);
  PERFORM pet_comissao_pagar(com, 'pix');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT situacao = 'paga' AND forma_pagamento = 'pix' AND pago_em IS NOT NULL AND pago_por IS NOT NULL FROM pet_comissoes WHERE id = com), 'comissão paga com registro de quem e quando');

  -- relatório por profissional (retirados no período)
  PERFORM ci.deve_falhar(vend, format($c$SELECT pet_servicos_por_profissional(current_date, current_date + 5)$c$), 'vendedor lê o relatório');
  PERFORM ci.entrar(fin);
  r := pet_servicos_por_profissional(current_date, current_date + 10);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT (e ->> 'atendimentos')::int = 2 AND (e ->> 'faturamento')::numeric = 120 AND (e ->> 'comissao_paga')::numeric = 18
                           AND (e ->> 'comissao_a_aprovar')::numeric = 18
                      FROM jsonb_array_elements(r) e WHERE e ->> 'nome' = 'Cris Cobrança'), 'relatório: dois atendimentos retirados, R$ 120, comissão paga de R$ 18 e R$ 18 a aprovar');

  -- leitura e escrita direta
  PERFORM ci.exige(ci.contar(fin, 'SELECT count(*) FROM pet_comissoes') >= 2 AND ci.contar(vend, 'SELECT count(*) FROM pet_comissoes') = 0
                   AND ci.contar(gar, 'SELECT count(*) FROM pet_comissoes') = 0, 'só administrador, gestor e financeiro leem comissões');
  PERFORM ci.deve_falhar(adm, format($c$UPDATE pet_comissoes SET valor = 999 WHERE id = %L$c$, com), 'alterar comissão direto');
  SELECT count(*) INTO n FROM pet_comissoes WHERE tenant_id <> demo;
  PERFORM ci.exige(n = 0, 'nenhuma comissão fora da empresa');
END $$;

-- 39. Pet shop (contatos): aniversário e retorno de banho, uma vez por ocasião
DO $$
DECLARE
  demo constant uuid := '11111111-1111-1111-1111-111111111111';
  adm  constant uuid := 'a0000000-0000-0000-0000-000000000001';
  vend constant uuid := 'a0000000-0000-0000-0000-000000000002';
  gar  constant uuid := 'a0000000-0000-0000-0000-000000000006';
  est  constant uuid := 'a0000000-0000-0000-0000-0000000000b1';
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  tutor uuid; p_aniv uuid; p_aniv_longe uuid; p_bissexto uuid; p_ret uuid; p_ret_marcado uuid; p_recente uuid; p_inativo uuid; p_nunca uuid;
  prof uuid; serv uuid; ag uuid; r jsonb; tb uuid; n bigint; ref date;
BEGIN
  INSERT INTO clientes (tenant_id, nome, telefone) VALUES (demo, 'Tutor Contato CI', '(16) 99999-1234') RETURNING id INTO tutor;
  INSERT INTO tenants (nome) VALUES ('Contato B') RETURNING id INTO tb;
  PERFORM ci.entrar(adm);
  serv := pet_servico_salvar('{"nome":"Banho Contato","duracao_min":30}'::jsonb);
  PERFORM pet_preco_salvar(serv, NULL, NULL, NULL, 50);
  prof := pet_profissional_salvar('{"nome":"Dani Contato"}'::jsonb);
  p_aniv := pet_salvar(jsonb_build_object('cliente_id', tutor, 'nome', 'Aniv Hoje', 'nascimento', (hoje - interval '3 years')::date));
  p_aniv_longe := pet_salvar(jsonb_build_object('cliente_id', tutor, 'nome', 'Aniv Longe', 'nascimento', (hoje + interval '40 days' - interval '2 years')::date));
  p_bissexto := pet_salvar(jsonb_build_object('cliente_id', tutor, 'nome', 'Aniv Em 5 Dias', 'nascimento', (hoje + interval '5 days' - interval '1 year')::date));
  p_ret := pet_salvar(jsonb_build_object('cliente_id', tutor, 'nome', 'Retorno 40 dias'));
  p_ret_marcado := pet_salvar(jsonb_build_object('cliente_id', tutor, 'nome', 'Retorno com horário'));
  p_recente := pet_salvar(jsonb_build_object('cliente_id', tutor, 'nome', 'Banho recente'));
  p_inativo := pet_salvar(jsonb_build_object('cliente_id', tutor, 'nome', 'Inativo', 'ativo', false, 'nascimento', (hoje - interval '1 year')::date));
  p_nunca := pet_salvar(jsonb_build_object('cliente_id', tutor, 'nome', 'Nunca veio'));
  PERFORM ci.sair();

  -- atendimentos retirados no passado (inserção direta de teste, como dono) e um futuro
  INSERT INTO pet_agendamentos (tenant_id, pet_id, cliente_id, profissional_id, inicio, fim, situacao)
  VALUES (demo, p_ret, tutor, prof, now() - interval '40 days', now() - interval '40 days' + interval '30 minutes', 'retirado'),
         (demo, p_ret_marcado, tutor, prof, now() - interval '50 days', now() - interval '50 days' + interval '30 minutes', 'retirado'),
         (demo, p_ret_marcado, tutor, prof, now() + interval '3 days', now() + interval '3 days' + interval '30 minutes', 'agendado'),
         (demo, p_recente, tutor, prof, now() - interval '5 days', now() - interval '5 days' + interval '30 minutes', 'retirado');

  -- quem vê as listas
  PERFORM ci.deve_falhar(gar, $c$SELECT pet_contatos_pendentes('retorno')$c$, 'garçom vê contatos');
  PERFORM ci.deve_falhar(est, $c$SELECT pet_contatos_pendentes('retorno')$c$, 'estoquista vê contatos');
  PERFORM ci.deve_falhar(NULL, $c$SELECT pet_contatos_pendentes('retorno')$c$, 'anon vê contatos');
  PERFORM ci.deve_falhar(vend, $c$SELECT pet_contatos_pendentes('qualquer')$c$, 'tipo inválido');
  PERFORM ci.deve_falhar(vend, $c$SELECT pet_contatos_pendentes('retorno', 3)$c$, 'prazo curto demais');
  PERFORM ci.deve_falhar(vend, $c$SELECT pet_contatos_pendentes('aniversario', 30, 90)$c$, 'janela grande demais');

  -- aniversário: hoje e daqui a 5 dias entram; 40 dias e inativo não
  PERFORM ci.entrar(vend);
  r := pet_contatos_pendentes('aniversario', 30, 7);
  PERFORM ci.sair();
  PERFORM ci.exige(EXISTS (SELECT 1 FROM jsonb_array_elements(r) e WHERE e ->> 'pet' = 'Aniv Hoje' AND (e ->> 'anos')::int = 3 AND (e ->> 'referencia')::date = hoje),
                   'o aniversário de hoje entra, com a idade');
  PERFORM ci.exige(EXISTS (SELECT 1 FROM jsonb_array_elements(r) e WHERE e ->> 'pet' = 'Aniv Em 5 Dias'), 'o aniversário dos próximos dias entra');
  PERFORM ci.exige(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r) e WHERE e ->> 'pet' IN ('Aniv Longe', 'Inativo')), 'aniversário distante e pet inativo ficam de fora');
  PERFORM ci.exige((SELECT e ->> 'telefone' FROM jsonb_array_elements(r) e WHERE e ->> 'pet' = 'Aniv Hoje') = '(16) 99999-1234', 'traz o telefone do tutor');

  -- registrar o contato tira da lista, uma vez só por ocasião, e é idempotente
  PERFORM ci.deve_falhar(gar, format($c$SELECT pet_contato_registrar(%L, 'aniversario', %L)$c$, p_aniv, hoje), 'garçom registra contato');
  PERFORM ci.deve_falhar(vend, format($c$SELECT pet_contato_registrar(%L, 'aniversario', %L, 'pombo')$c$, p_aniv, hoje), 'canal inválido');
  PERFORM ci.deve_falhar(vend, format($c$SELECT pet_contato_registrar(%L, 'aniversario', %L)$c$, gen_random_uuid(), hoje), 'pet que não existe');
  PERFORM ci.entrar(vend);
  PERFORM pet_contato_registrar(p_aniv, 'aniversario', hoje, 'whatsapp');
  PERFORM pet_contato_registrar(p_aniv, 'aniversario', hoje, 'telefone', 'repetido');
  r := pet_contatos_pendentes('aniversario', 30, 7);
  PERFORM ci.sair();
  PERFORM ci.exige(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r) e WHERE e ->> 'pet' = 'Aniv Hoje'), 'quem já foi chamado sai da lista');
  PERFORM ci.exige((SELECT count(*) = 1 FROM pet_contatos WHERE pet_id = p_aniv), 'repetir o registro não duplica');

  -- retorno de banho: 40 dias sem vir entra; recente, com horário marcado, sem histórico e inativo não
  PERFORM ci.entrar(vend);
  r := pet_contatos_pendentes('retorno', 30);
  PERFORM ci.sair();
  PERFORM ci.exige(EXISTS (SELECT 1 FROM jsonb_array_elements(r) e WHERE e ->> 'pet' = 'Retorno 40 dias' AND (e ->> 'dias')::int >= 40), 'retorno de quem está há mais de 30 dias sem vir');
  PERFORM ci.exige(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r) e WHERE e ->> 'pet' IN ('Retorno com horário', 'Banho recente', 'Nunca veio', 'Inativo')),
                   'com horário marcado, atendimento recente, sem histórico e inativo ficam de fora');
  PERFORM ci.entrar(vend);
  r := pet_contatos_pendentes('retorno', 60);
  PERFORM ci.sair();
  PERFORM ci.exige(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r) e WHERE e ->> 'pet' = 'Retorno 40 dias'), 'o prazo maior tira quem veio há 40 dias');

  -- contato do retorno vale para aquele último atendimento; um atendimento novo abre outra ocasião
  PERFORM ci.entrar(vend);
  r := pet_contatos_pendentes('retorno', 30);
  SELECT (e ->> 'referencia')::date INTO ref FROM jsonb_array_elements(r) e WHERE e ->> 'pet' = 'Retorno 40 dias';
  PERFORM pet_contato_registrar(p_ret, 'retorno', ref, 'telefone');
  r := pet_contatos_pendentes('retorno', 30);
  PERFORM ci.sair();
  PERFORM ci.exige(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r) e WHERE e ->> 'pet' = 'Retorno 40 dias'), 'depois do contato, o retorno some da lista');

  -- leitura direta só da empresa, sem escrita direta, outra empresa sem registros
  PERFORM ci.exige(ci.contar(vend, 'SELECT count(*) FROM pet_contatos') = 2 AND ci.contar(gar, 'SELECT count(*) FROM pet_contatos') = 0, 'o garçom não lê contatos');
  PERFORM ci.deve_falhar(adm, format($c$INSERT INTO pet_contatos (pet_id, tipo, referencia) VALUES (%L, 'retorno', current_date)$c$, p_ret), 'escrita direta em contatos');
  PERFORM ci.deve_falhar(adm, $c$DELETE FROM pet_contatos$c$, 'apagar contato direto');
  SELECT count(*) INTO n FROM pet_contatos WHERE tenant_id = tb;
  PERFORM ci.exige(n = 0, 'a outra empresa não recebeu contatos');

  -- a lista de retorno tem teto de 300 (mais antigos primeiro), mesmo com mais pets elegíveis
  INSERT INTO pets (tenant_id, cliente_id, nome) SELECT demo, tutor, 'Massa ' || g FROM generate_series(1, 305) g;
  INSERT INTO pet_agendamentos (tenant_id, pet_id, cliente_id, profissional_id, inicio, fim, situacao)
  SELECT demo, p.id, tutor, prof, now() - interval '100 days', now() - interval '100 days' + interval '30 minutes', 'retirado'
    FROM pets p WHERE p.tenant_id = demo AND p.nome LIKE 'Massa %';
  PERFORM ci.entrar(vend);
  r := pet_contatos_pendentes('retorno', 30);
  PERFORM ci.sair();
  PERFORM ci.exige(jsonb_array_length(r) = 300, 'a lista de retorno é limitada a 300 pets');
END $$;
