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
    'mesas', 'comandas', 'comanda_itens', 'comanda_pagamentos', 'restaurante_zonas_entrega',
    -- módulos liberados da empresa: o menu e as travas de cada módulo leem para qualquer perfil (só leitura da própria empresa)
    'empresa_modulos_liberados'];
  sem_trava constant text[] := ARRAY['current_tenant_id', 'current_motorista_id', 'has_role', 'eh_motorista_restrito',
    'eh_saas_operador', 'eh_salao_restrito', 'onboarding_criar_espaco',
    -- página de login da empresa: devolve só nome, cor e logo (dados públicos de marca) de uma empresa ativa com link
    'empresa_por_slug', 'filial_irrestrita', 'pode_filial', 'contato_enviar',
    -- só grava a posição do próprio motorista; quem não é motorista não tem linha para alterar
    'motorista_enviar_posicao',
    -- agenda do profissional: só quem tem o perfil profissional (e a conta ligada a um cadastro) passa
    'eh_profissional_restrito', 'pet_minha_agenda', 'pet_minha_situacao',
    -- só responde se a empresa tem a clínica liberada
    'clinica_liberada',
    -- prontuário: cada função confere o perfil Veterinário, a clínica liberada e o cadastro com CRMV
    'clinica_pacientes', 'clinica_atendimento_abrir', 'clinica_atendimento_salvar', 'clinica_atendimento_fechar',
    'clinica_adendo_criar', 'clinica_historico', 'clinica_pet_alergias',
    -- vacinas: catálogo e cartão para a gestão, o veterinário e a recepção; aplicação só do veterinário
    'clinica_vacinas_catalogo', 'clinica_vacina_catalogo_salvar', 'clinica_lotes_vacina', 'clinica_aplicadores', 'clinica_vacina_aplicar',
    'clinica_vacina_registrar_externa', 'clinica_vacina_cancelar', 'clinica_cartao_vacinacao',
    -- modelos de exame: gestão e veterinário mantêm; cada função confere o perfil e a clínica liberada
    'clinica_exame_modelos', 'clinica_exame_modelo_salvar', 'clinica_exame_campo_salvar', 'clinica_exame_campo_mover',
    'clinica_exame_referencia_salvar', 'clinica_exame_modelos_iniciais',
    -- resultados de exame: cada função confere o perfil Veterinário, a clínica liberada e o cadastro com CRMV
    'clinica_exame_abrir', 'clinica_exame_salvar', 'clinica_exame_fechar', 'clinica_exame_cancelar', 'clinica_exame_adendo_criar',
    'clinica_exame_get', 'clinica_exames_do_pet', 'clinica_exame_evolucao',
    -- anexos: cada função confere o perfil Veterinário e a clínica liberada; as duas de apoio só respondem verdadeiro com perfil, clínica e registro prévio
    'clinica_anexo_preparar', 'clinica_anexo_confirmar', 'clinica_anexos', 'clinica_anexo_abrir', 'clinica_anexo_cancelar',
    '_clinica_anexo_pode_enviar', '_clinica_anexo_pode_ler',
    -- cópia para o trabalho sem internet: só o veterinário
    'clinica_visita_preparar',
    -- cadastro rápido de tutor e pet pelo veterinário (também sem internet): só o veterinário
    'clinica_cadastro_rapido',
    -- atendimento sem internet: cria a visita e preenche e fecha com chave de repetição; só o veterinário
    'clinica_visita_registrar', 'clinica_atendimento_offline', 'clinica_vacina_offline', 'clinica_exame_offline', 'clinica_anexo_offline_preparar',
    -- serviços de consulta para iniciar atendimento no Prontuário: só o veterinário
    'clinica_servicos_consulta'];
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

-- 40. Pet shop (pacotes): venda adiantada, uso na retirada, aviso do penúltimo banho, validade e cancelamento
DO $$
DECLARE
  demo constant uuid := '11111111-1111-1111-1111-111111111111';
  adm  constant uuid := 'a0000000-0000-0000-0000-000000000001';
  vend constant uuid := 'a0000000-0000-0000-0000-000000000002';
  gest constant uuid := 'a0000000-0000-0000-0000-000000000005';
  gar  constant uuid := 'a0000000-0000-0000-0000-000000000006';
  est  constant uuid := 'a0000000-0000-0000-0000-0000000000b1';
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  t0 timestamptz := date_trunc('day', now()) + interval '5 days' + interval '8 hours';
  tutor uuid; pet_a uuid; pet_b uuid; prof uuid; banho uuid; tosa uuid; banho_prod uuid; tosa_prod uuid; mod uuid; mod_prod uuid; dep uuid; merc uuid;
  ped_pac uuid; ped_tosa uuid; ped_errada uuid; ped_sem uuid; pac uuid; pac2 uuid; ag1 uuid; ag2 uuid; ag3 uuid; ag4 uuid; ag5 uuid; agb uuid; agm uuid;
  r jsonb; n bigint; tb uuid;
BEGIN
  INSERT INTO depositos (tenant_id, nome) VALUES (demo, 'Pet Pacote CI') RETURNING id INTO dep;
  INSERT INTO produtos (tenant_id, codigo_interno, descricao, unidade, preco_venda, ncm, cst_csosn) VALUES (demo, 'PET-PAC-RACAO', 'Ração pacote', 'UN', 20, '23091000', '102') RETURNING id INTO merc;
  INSERT INTO clientes (tenant_id, nome, cpf) VALUES (demo, 'Tutor Pacote CI', '52998224725') RETURNING id INTO tutor;
  INSERT INTO tenants (nome) VALUES ('Pacote B') RETURNING id INTO tb;
  PERFORM ci.entrar(adm);
  PERFORM registrar_movimentacao(merc, dep, 'entrada'::mov_tipo, 20, 'ci', 'ci');
  PERFORM ci.sair();
  PERFORM ci.entrar(gest);
  banho := pet_servico_salvar('{"nome":"Banho Pacote","duracao_min":30}'::jsonb);
  tosa := pet_servico_salvar('{"nome":"Tosa Pacote","categoria":"tosa","duracao_min":30}'::jsonb);
  PERFORM pet_preco_salvar(banho, NULL, NULL, NULL, 60);
  PERFORM pet_preco_salvar(tosa, NULL, NULL, NULL, 40);
  prof := pet_profissional_salvar('{"nome":"Eli Pacote","comissao_percentual":30}'::jsonb);
  PERFORM ci.sair();
  SELECT produto_id INTO banho_prod FROM pet_servicos WHERE id = banho;
  SELECT produto_id INTO tosa_prod FROM pet_servicos WHERE id = tosa;
  PERFORM ci.entrar(vend);
  pet_a := pet_salvar(jsonb_build_object('cliente_id', tutor, 'nome', 'Pacote A'));
  pet_b := pet_salvar(jsonb_build_object('cliente_id', tutor, 'nome', 'Pacote B'));
  PERFORM ci.sair();

  -- modelo de pacote: só administrador e gestor; validações
  PERFORM ci.deve_falhar(vend, format($c$SELECT pet_pacote_modelo_salvar(jsonb_build_object('nome','P','servico_id',%L,'quantidade',4,'preco',200))$c$, banho), 'vendedor cria modelo de pacote');
  PERFORM ci.deve_falhar(adm, format($c$SELECT pet_pacote_modelo_salvar(jsonb_build_object('nome','','servico_id',%L,'quantidade',4,'preco',200))$c$, banho), 'pacote sem nome');
  PERFORM ci.deve_falhar(adm, format($c$SELECT pet_pacote_modelo_salvar(jsonb_build_object('nome','P','servico_id',%L,'quantidade',1,'preco',200))$c$, banho), 'pacote de um serviço só');
  PERFORM ci.deve_falhar(adm, format($c$SELECT pet_pacote_modelo_salvar(jsonb_build_object('nome','P','servico_id',%L,'quantidade',4,'preco',0))$c$, banho), 'pacote sem preço');
  PERFORM ci.deve_falhar(adm, format($c$SELECT pet_pacote_modelo_salvar(jsonb_build_object('nome','P','servico_id',%L,'quantidade',4,'preco',200))$c$, gen_random_uuid()), 'pacote de serviço que não existe');
  PERFORM ci.entrar(gest);
  mod := pet_pacote_modelo_salvar(jsonb_build_object('nome', 'Pacote 4 banhos', 'servico_id', banho, 'quantidade', 4, 'preco', 200));
  PERFORM ci.sair();
  SELECT produto_id INTO mod_prod FROM pet_pacote_modelos WHERE id = mod;
  PERFORM ci.exige((SELECT NOT controla_estoque AND preco_venda = 200 AND codigo_interno <> '' FROM produtos WHERE id = mod_prod), 'o pacote vira um produto sem estoque, com código automático');
  PERFORM ci.deve_falhar(adm, format($c$SELECT pet_pacote_modelo_salvar(jsonb_build_object('nome',' pacote 4 BANHOS ','servico_id',%L,'quantidade',4,'preco',200))$c$, banho), 'nome de pacote repetido');

  -- venda do pacote no caixa (200 com 20 de desconto = 180)
  PERFORM ci.entrar(vend);
  ped_pac := pdv_venda(dep, jsonb_build_array(jsonb_build_object('produto_id', mod_prod, 'quantidade', 1, 'preco_unitario', 200)), 'crediario', tutor, 20, 1, current_date + 30);
  ped_errada := pdv_venda(dep, jsonb_build_array(jsonb_build_object('produto_id', mod_prod, 'quantidade', 1, 'preco_unitario', 150)), 'crediario', tutor, 0, 1, current_date + 30);
  ped_sem := pdv_venda(dep, jsonb_build_array(jsonb_build_object('produto_id', banho_prod, 'quantidade', 1, 'preco_unitario', 60)), 'crediario', tutor, 0, 1, current_date + 30);
  PERFORM ci.sair();
  PERFORM ci.deve_falhar(gar, format($c$SELECT pet_pacote_vender(%L, %L, 60, %L)$c$, mod, pet_a, ped_pac), 'garçom vende pacote');
  PERFORM ci.deve_falhar(est, format($c$SELECT pet_pacote_vender(%L, %L, 60, %L)$c$, mod, pet_a, ped_pac), 'estoquista vende pacote');
  PERFORM ci.deve_falhar(vend, format($c$SELECT pet_pacote_vender(%L, %L, 45, %L)$c$, mod, pet_a, ped_pac), 'validade de 45 dias');
  PERFORM ci.deve_falhar(vend, format($c$SELECT pet_pacote_vender(%L, %L, 60)$c$, mod, pet_a), 'sem informar a venda');
  PERFORM ci.deve_falhar(vend, format($c$SELECT pet_pacote_vender(%L, %L, 60, %L)$c$, mod, pet_a, ped_errada), 'venda com o pacote por outro valor');
  PERFORM ci.deve_falhar(vend, format($c$SELECT pet_pacote_vender(%L, %L, 60, %L)$c$, mod, pet_a, ped_sem), 'venda sem o pacote');
  PERFORM ci.deve_falhar(vend, format($c$SELECT pet_pacote_vender(%L, %L, 60, %L)$c$, mod, gen_random_uuid(), ped_pac), 'pet que não existe');
  PERFORM ci.entrar(vend);
  r := pet_pacote_vender(mod, pet_a, 60, ped_pac);
  PERFORM ci.sair();
  pac := (r ->> 'pacote_id')::uuid;
  PERFORM ci.deve_falhar(vend, format($c$SELECT nfce_criar(%L)$c$, ped_pac), 'NFC-e de venda só de pacote (a nota é de serviço)');
  PERFORM ci.exige(pg_get_functiondef('public.pet_agenda_retirar(uuid, uuid, uuid, boolean)'::regprocedure) LIKE '%pg_advisory_xact_lock(hashtextextended(''pet_pacote:''%',
                   'retirar trava o pacote do pet antes de gastar o saldo');
  PERFORM ci.exige((SELECT quantidade = 4 AND valor = 180 AND validade_dias = 60 AND vence_em = hoje + 60 AND situacao = 'ativo' AND pet_id = pet_a FROM pet_pacotes WHERE id = pac),
                   'o pacote guarda 4 banhos, o valor pago (180), a validade e o pet');
  PERFORM ci.exige((SELECT modelo = 'nfse' AND situacao = 'rascunho' AND valor_total = 180 AND valor_produtos = 200 FROM nfe WHERE pedido_id = ped_pac), 'a NFS-e do pacote nasce na venda, em rascunho');
  PERFORM ci.entrar(vend);
  r := pet_pacote_vender(mod, pet_a, 60, ped_pac);
  PERFORM ci.sair();
  PERFORM ci.exige((r ->> 'repetido')::boolean AND (SELECT count(*) = 1 FROM pet_pacotes WHERE venda_id = ped_pac) AND (SELECT count(*) = 1 FROM nfe WHERE pedido_id = ped_pac AND modelo = 'nfse'),
                   'repetir a venda do pacote não duplica pacote nem nota');

  -- atendimentos do pet A (4 banhos) e do pet B (sem pacote)
  PERFORM ci.entrar(vend);
  ag1 := pet_agendar(jsonb_build_object('pet_id', pet_a, 'profissional_id', prof, 'inicio', t0, 'servicos', jsonb_build_array(jsonb_build_object('servico_id', banho))));
  ag2 := pet_agendar(jsonb_build_object('pet_id', pet_a, 'profissional_id', prof, 'inicio', t0 + interval '1 hour', 'servicos', jsonb_build_array(jsonb_build_object('servico_id', banho))));
  ag3 := pet_agendar(jsonb_build_object('pet_id', pet_a, 'profissional_id', prof, 'inicio', t0 + interval '2 hours', 'servicos', jsonb_build_array(jsonb_build_object('servico_id', banho))));
  ag4 := pet_agendar(jsonb_build_object('pet_id', pet_a, 'profissional_id', prof, 'inicio', t0 + interval '3 hours', 'servicos', jsonb_build_array(jsonb_build_object('servico_id', banho))));
  ag5 := pet_agendar(jsonb_build_object('pet_id', pet_a, 'profissional_id', prof, 'inicio', t0 + interval '4 hours', 'servicos', jsonb_build_array(jsonb_build_object('servico_id', banho))));
  agb := pet_agendar(jsonb_build_object('pet_id', pet_b, 'profissional_id', prof, 'inicio', t0 + interval '5 hours', 'servicos', jsonb_build_array(jsonb_build_object('servico_id', banho))));
  agm := pet_agendar(jsonb_build_object('pet_id', pet_a, 'profissional_id', prof, 'inicio', t0 + interval '6 hours', 'servicos', jsonb_build_array(jsonb_build_object('servico_id', banho), jsonb_build_object('servico_id', tosa))));
  PERFORM pet_agenda_situacao(x, 'em_atendimento') FROM unnest(ARRAY[ag1, ag2, ag3, ag4, ag5, agb, agm]) x;
  PERFORM pet_agenda_situacao(x, 'pronto') FROM unnest(ARRAY[ag1, ag2, ag3, ag4, ag5, agb, agm]) x;
  PERFORM ci.sair();

  -- cobertura: só o pacote do próprio pet, dentro da validade e com saldo
  PERFORM ci.deve_falhar(gar, format($c$SELECT pet_agenda_cobertura(%L)$c$, ag1), 'garçom consulta cobertura');
  PERFORM ci.entrar(vend);
  r := pet_agenda_cobertura(ag1);
  PERFORM ci.exige(jsonb_array_length(r) = 1 AND (r -> 0 ->> 'restam')::int = 4 AND (r -> 0 ->> 'pacote_id')::uuid = pac, 'o banho do pet A é coberto pelo pacote (restam 4)');
  PERFORM ci.exige(jsonb_array_length(pet_agenda_cobertura(agb)) = 0, 'o pacote não vale para outro pet, mesmo do mesmo tutor');
  PERFORM ci.sair();
  PERFORM ci.deve_falhar(vend, format($c$SELECT pet_agenda_retirar(%L, NULL, NULL, true)$c$, agb), 'usar pacote que o pet não tem, sem venda');

  -- usar o pacote: sem venda, sem NFS-e; comissão sobre o valor do uso (180 / 4 = 45 → 13,50); avisa no penúltimo
  PERFORM ci.entrar(vend);
  r := pet_agenda_retirar(ag1, NULL, NULL, true);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT situacao = 'retirado' AND venda_id IS NULL FROM pet_agendamentos WHERE id = ag1), 'retirada só com pacote: sem venda');
  PERFORM ci.exige((r ->> 'nfe_id') IS NULL AND jsonb_array_length(r -> 'avisos') = 0 AND (r ->> 'usos')::int = 1, 'sem NFS-e do uso e sem aviso no primeiro banho');
  PERFORM ci.exige((SELECT base = 45 AND valor = 13.50 FROM pet_comissoes WHERE agendamento_id = ag1), 'comissão de 30% sobre o valor de um banho do pacote');
  PERFORM ci.exige((SELECT quantidade - (SELECT count(*)::int FROM pet_pacote_usos u WHERE u.pacote_id = pac AND NOT u.desfeito) FROM pet_pacotes WHERE id = pac) = 3, 'restam 3 banhos');
  PERFORM ci.entrar(vend);
  r := pet_agenda_retirar(ag1, NULL, NULL, true);
  PERFORM ci.sair();
  PERFORM ci.exige((r ->> 'repetido')::boolean AND (SELECT quantidade - (SELECT count(*)::int FROM pet_pacote_usos u WHERE u.pacote_id = pac AND NOT u.desfeito) FROM pet_pacotes WHERE id = pac) = 3, 'repetir a retirada não gasta outro banho');

  PERFORM ci.entrar(vend);
  r := pet_agenda_retirar(ag2, NULL, NULL, true);
  PERFORM ci.exige(jsonb_array_length(r -> 'avisos') = 0 AND (SELECT quantidade - (SELECT count(*)::int FROM pet_pacote_usos u WHERE u.pacote_id = pac AND NOT u.desfeito) FROM pet_pacotes WHERE id = pac) = 2, 'segundo uso: restam 2, sem aviso ainda');
  r := pet_agenda_retirar(ag3, NULL, NULL, true);   -- penúltimo banho do pacote
  PERFORM ci.sair();
  PERFORM ci.exige(jsonb_array_length(r -> 'avisos') = 1 AND (r -> 'avisos' -> 0 ->> 'restam')::int = 1 AND (r -> 'avisos' -> 0 ->> 'pet') = 'Pacote A',
                   'no penúltimo banho o sistema avisa que resta só 1');
  PERFORM ci.entrar(vend);
  r := pet_agenda_retirar(ag4, NULL, NULL, true);   -- último
  PERFORM ci.sair();
  PERFORM ci.exige((r -> 'avisos' -> 0 ->> 'restam')::int = 0 AND (SELECT quantidade - (SELECT count(*)::int FROM pet_pacote_usos u WHERE u.pacote_id = pac AND NOT u.desfeito) FROM pet_pacotes WHERE id = pac) = 0, 'o último banho esgota o pacote');
  PERFORM ci.entrar(vend);
  r := pet_agenda_cobertura(ag5);
  PERFORM ci.sair();
  PERFORM ci.exige(jsonb_array_length(r) = 0, 'pacote esgotado não cobre mais');
  PERFORM ci.deve_falhar(vend, format($c$SELECT pet_agenda_retirar(%L, NULL, NULL, true)$c$, ag5), 'usar pacote esgotado sem venda');

  -- desfazer retirada feita só com pacote: só a gestão
  PERFORM ci.deve_falhar(vend, format($c$SELECT pet_agenda_desfazer_retirada(%L)$c$, ag4), 'vendedor desfaz retirada');
  PERFORM ci.entrar(gest);
  PERFORM pet_agenda_desfazer_retirada(ag4);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT situacao = 'pronto' FROM pet_agendamentos WHERE id = ag4) AND (SELECT quantidade - (SELECT count(*)::int FROM pet_pacote_usos u WHERE u.pacote_id = pac AND NOT u.desfeito) FROM pet_pacotes WHERE id = pac) = 1
                   AND (SELECT situacao = 'cancelada' FROM pet_comissoes WHERE agendamento_id = ag4), 'desfazer devolve o banho ao pacote e cancela a comissão');
  PERFORM ci.deve_falhar(gest, format($c$SELECT pet_agenda_desfazer_retirada(%L)$c$, ag4), 'desfazer atendimento que não está retirado');

  -- atendimento misto: o banho sai do pacote e a tosa é cobrada no caixa (com uma ração junto)
  PERFORM ci.entrar(vend);
  ped_tosa := pdv_venda(dep, jsonb_build_array(jsonb_build_object('produto_id', tosa_prod, 'quantidade', 1, 'preco_unitario', 40),
                                               jsonb_build_object('produto_id', merc, 'quantidade', 1, 'preco_unitario', 20)), 'crediario', tutor, 0, 1, current_date + 30);
  PERFORM ci.sair();
  PERFORM ci.deve_falhar(vend, format($c$SELECT pet_agenda_retirar(%L, NULL, NULL, true)$c$, agm), 'misto sem a venda da tosa');
  PERFORM ci.deve_falhar(vend, format($c$SELECT pet_agenda_retirar(%L, %L, NULL, true)$c$, agm, ped_sem), 'misto com venda que não traz a tosa');
  PERFORM ci.entrar(vend);
  r := pet_agenda_retirar(agm, ped_tosa, NULL, true);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT quantidade - (SELECT count(*)::int FROM pet_pacote_usos u WHERE u.pacote_id = pac AND NOT u.desfeito) FROM pet_pacotes WHERE id = pac) = 0 AND (r ->> 'usos')::int = 1, 'o banho do atendimento misto saiu do pacote');
  PERFORM ci.exige((SELECT base = 85 AND valor = 25.50 FROM pet_comissoes WHERE agendamento_id = agm), 'comissão: tosa cobrada (40) + banho do pacote (45) = 85 × 30%');
  PERFORM ci.exige((SELECT valor_total = 40 AND valor_produtos = 40 FROM nfe WHERE pedido_id = ped_tosa AND modelo = 'nfse'), 'a NFS-e do atendimento leva só o que foi cobrado agora (a tosa)');
  UPDATE pedidos SET situacao = 'cancelado' WHERE id = ped_tosa;
  PERFORM ci.exige((SELECT quantidade - (SELECT count(*)::int FROM pet_pacote_usos u WHERE u.pacote_id = pac AND NOT u.desfeito) FROM pet_pacotes WHERE id = pac) = 1 AND (SELECT situacao = 'pronto' AND venda_id IS NULL FROM pet_agendamentos WHERE id = agm), 'cancelar a venda devolve o banho ao pacote e o atendimento a pronto');
  PERFORM ci.deve_falhar(gest, format($c$SELECT pet_agenda_desfazer_retirada(%L)$c$, agm), 'desfazer atendimento que não está retirado (misto cancelado)');

  -- validade e cancelamento do pacote
  UPDATE pet_pacotes SET vence_em = hoje - 1 WHERE id = pac;
  PERFORM ci.exige(NOT EXISTS (SELECT 1 FROM _pet_cobertura(ag5)), 'pacote vencido não cobre');
  UPDATE pet_pacotes SET vence_em = hoje + 10 WHERE id = pac;
  PERFORM ci.exige(EXISTS (SELECT 1 FROM _pet_cobertura(ag5)), 'dentro da validade volta a cobrir');
  PERFORM ci.deve_falhar(vend, format($c$SELECT pet_pacote_cancelar(%L, 'x')$c$, pac), 'vendedor cancela pacote');
  PERFORM ci.deve_falhar(gest, format($c$SELECT pet_pacote_cancelar(%L, '')$c$, pac), 'cancelar pacote sem motivo');
  PERFORM ci.entrar(gest);
  PERFORM pet_pacote_cancelar(pac, 'tutor desistiu');
  PERFORM ci.sair();
  PERFORM ci.exige(NOT EXISTS (SELECT 1 FROM _pet_cobertura(ag5)), 'pacote cancelado não cobre');
  PERFORM ci.deve_falhar(gest, format($c$SELECT pet_pacote_cancelar(%L, 'de novo')$c$, pac), 'cancelar duas vezes');

  -- venda do pacote cancelada no caixa: pacote cancelado e rascunho da NFS-e some
  PERFORM ci.entrar(vend);
  ped_errada := pdv_venda(dep, jsonb_build_array(jsonb_build_object('produto_id', mod_prod, 'quantidade', 1, 'preco_unitario', 200)), 'crediario', tutor, 0, 1, current_date + 30);
  pac2 := (pet_pacote_vender(mod, pet_b, 30, ped_errada) ->> 'pacote_id')::uuid;
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT vence_em = hoje + 30 AND valor = 200 FROM pet_pacotes WHERE id = pac2), 'pacote de 30 dias para o pet B, sem desconto');
  UPDATE pedidos SET situacao = 'cancelado' WHERE id = ped_errada;
  PERFORM ci.exige((SELECT situacao = 'cancelado' FROM pet_pacotes WHERE id = pac2) AND NOT EXISTS (SELECT 1 FROM nfe WHERE pedido_id = ped_errada AND modelo = 'nfse'),
                   'cancelar a venda cancela o pacote e tira a NFS-e em rascunho');

  -- leitura e escrita direta; outra empresa
  PERFORM ci.exige(ci.contar(vend, 'SELECT count(*) FROM pet_pacotes') >= 2 AND ci.contar(gar, 'SELECT count(*) FROM pet_pacotes') = 0
                   AND ci.contar(gar, 'SELECT count(*) FROM pet_pacote_usos') = 0 AND ci.contar(gar, 'SELECT count(*) FROM pet_pacote_modelos') = 0, 'o garçom não lê pacotes');
  PERFORM ci.deve_falhar(adm, format($c$UPDATE pet_pacotes SET quantidade = 99 WHERE id = %L$c$, pac), 'alterar pacote direto');
  PERFORM ci.deve_falhar(adm, format($c$DELETE FROM pet_pacote_usos WHERE pacote_id = %L$c$, pac), 'apagar uso direto');
  SELECT count(*) INTO n FROM pet_pacotes WHERE tenant_id = tb;
  PERFORM ci.exige(n = 0, 'a outra empresa não recebeu pacotes');
END $$;

-- 41. Pet shop (granel): abrir saco baixa o saco e dá entrada dos kg no granel pelo custo proporcional
DO $$
DECLARE
  demo constant uuid := '11111111-1111-1111-1111-111111111111';
  adm  constant uuid := 'a0000000-0000-0000-0000-000000000001';
  vend constant uuid := 'a0000000-0000-0000-0000-000000000002';
  gest constant uuid := 'a0000000-0000-0000-0000-000000000005';
  gar  constant uuid := 'a0000000-0000-0000-0000-000000000006';
  est  constant uuid := 'a0000000-0000-0000-0000-0000000000b1';
  saco uuid; gran uuid; solto uuid; servico uuid; dep uuid; tb uuid; prod_b uuid;
  r jsonb; n bigint;
BEGIN
  INSERT INTO depositos (tenant_id, nome) VALUES (demo, 'Granel CI') RETURNING id INTO dep;
  INSERT INTO produtos (tenant_id, codigo_interno, descricao, unidade, custo, preco_venda) VALUES (demo, 'GR-SACO', 'Ração saco 15kg', 'UN', 90, 150) RETURNING id INTO saco;
  INSERT INTO produtos (tenant_id, codigo_interno, descricao, unidade, custo, preco_venda) VALUES (demo, 'GR-KG', 'Ração a granel', 'KG', 0, 12) RETURNING id INTO gran;
  INSERT INTO produtos (tenant_id, codigo_interno, descricao, unidade, custo, preco_venda) VALUES (demo, 'GR-SOLTO', 'Produto sem granel', 'UN', 10, 20) RETURNING id INTO solto;
  INSERT INTO produtos (tenant_id, codigo_interno, descricao, unidade, preco_venda, controla_estoque) VALUES (demo, 'GR-SERV', 'Serviço', 'UN', 10, false) RETURNING id INTO servico;
  INSERT INTO tenants (nome) VALUES ('Granel B') RETURNING id INTO tb;
  INSERT INTO produtos (tenant_id, codigo_interno, descricao, unidade, preco_venda) VALUES (tb, 'GR-B', 'Granel de outra empresa', 'KG', 5) RETURNING id INTO prod_b;
  PERFORM ci.entrar(adm);
  PERFORM registrar_movimentacao(saco, dep, 'entrada'::mov_tipo, 3, 'ci', 'ci', NULL, 90);
  PERFORM ci.sair();

  -- cadastro do granel: restrições
  PERFORM ci.deve_falhar_dono(format($c$UPDATE produtos SET granel_produto_id = %L WHERE id = %L$c$, gran, saco), 'granel sem o fator de kg');
  PERFORM ci.deve_falhar_dono(format($c$UPDATE produtos SET granel_produto_id = %L, granel_fator = 0 WHERE id = %L$c$, gran, saco), 'fator zero');
  PERFORM ci.deve_falhar_dono(format($c$UPDATE produtos SET granel_produto_id = %L, granel_fator = 15 WHERE id = %L$c$, saco, saco), 'saco que é o próprio granel');
  PERFORM ci.deve_falhar_dono(format($c$UPDATE produtos SET granel_produto_id = %L, granel_fator = 15 WHERE id = %L$c$, prod_b, saco), 'granel de outra empresa');
  PERFORM ci.deve_falhar_dono(format($c$UPDATE produtos SET granel_produto_id = %L, granel_fator = 15 WHERE id = %L$c$, servico, saco), 'granel que é serviço');
  UPDATE produtos SET granel_produto_id = gran, granel_fator = 15 WHERE id = saco;
  PERFORM ci.deve_falhar_dono(format($c$UPDATE produtos SET granel_produto_id = %L, granel_fator = 10 WHERE id = %L$c$, saco, gran), 'cadeia: o granel virar saco');
  PERFORM ci.deve_falhar_dono(format($c$UPDATE produtos SET granel_produto_id = %L, granel_fator = 10 WHERE id = %L$c$, solto, gran), 'granel que já é granel de outro saco virar saco');

  -- quem pode abrir
  PERFORM ci.deve_falhar(vend, format($c$SELECT granel_abrir_saco(%L, %L, 1)$c$, saco, dep), 'vendedor abre saco');
  PERFORM ci.deve_falhar(gar, format($c$SELECT granel_abrir_saco(%L, %L, 1)$c$, saco, dep), 'garçom abre saco');
  PERFORM ci.deve_falhar(adm, format($c$SELECT granel_abrir_saco(%L, %L, 0)$c$, saco, dep), 'abrir zero sacos');
  PERFORM ci.deve_falhar(adm, format($c$SELECT granel_abrir_saco(%L, %L, 1)$c$, solto, dep), 'produto sem granel cadastrado');
  PERFORM ci.deve_falhar(adm, format($c$SELECT granel_abrir_saco(%L, %L, 1)$c$, saco, gen_random_uuid()), 'depósito que não existe');
  PERFORM ci.deve_falhar(adm, format($c$SELECT granel_abrir_saco(%L, %L, 4)$c$, saco, dep), 'abrir mais sacos do que há');
  PERFORM ci.exige((SELECT quantidade FROM estoques WHERE produto_id = saco AND deposito_id = dep) = 3 AND NOT EXISTS (SELECT 1 FROM estoques WHERE produto_id = gran AND deposito_id = dep AND quantidade > 0),
                   'abertura recusada não mexe no estoque');

  -- abrir 1 saco: 15 kg a 90 / 15 = 6 por kg
  PERFORM ci.entrar(est);
  r := granel_abrir_saco(saco, dep, 1);
  PERFORM ci.sair();
  PERFORM ci.exige((r ->> 'kg')::numeric = 15 AND (r ->> 'custo_kg')::numeric = 6, 'abrir 1 saco dá 15 kg a 6,00 o kg');
  PERFORM ci.exige((SELECT quantidade FROM estoques WHERE produto_id = saco AND deposito_id = dep) = 2
                   AND (SELECT quantidade FROM estoques WHERE produto_id = gran AND deposito_id = dep) = 15
                   AND (SELECT custo_medio FROM estoques WHERE produto_id = gran AND deposito_id = dep) = 6, 'saldo: 2 sacos e 15 kg a custo médio 6');

  -- vender 2,5 kg pelo caminho normal de estoque
  PERFORM ci.entrar(adm);
  PERFORM registrar_movimentacao(gran, dep, 'saida'::mov_tipo, 2.5, 'ci', 'ci');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT quantidade FROM estoques WHERE produto_id = gran AND deposito_id = dep) = 12.5, 'a venda por kg baixa casas decimais');

  -- abrir 2 sacos de uma vez: o custo médio do granel se mantém
  PERFORM ci.entrar(gest);
  r := granel_abrir_saco(saco, dep, 2);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT quantidade FROM estoques WHERE produto_id = saco AND deposito_id = dep) = 0
                   AND (SELECT quantidade FROM estoques WHERE produto_id = gran AND deposito_id = dep) = 42.5
                   AND (SELECT custo_medio FROM estoques WHERE produto_id = gran AND deposito_id = dep) = 6, 'abrir 2 sacos soma 30 kg ao granel');
  PERFORM ci.exige((SELECT count(*) FROM estoque_movimentacoes WHERE produto_id = gran AND documento = 'Abertura de saco') = 2
                   AND (SELECT sum(sacos) FROM granel_aberturas WHERE saco_produto_id = saco) = 3, 'as aberturas ficam no histórico do estoque e na tabela de aberturas');

  -- leitura e escrita direta; outra empresa
  PERFORM ci.exige(ci.contar(adm, 'SELECT count(*) FROM granel_aberturas') = 2 AND ci.contar(gar, 'SELECT count(*) FROM granel_aberturas') = 0, 'o garçom não lê aberturas');
  PERFORM ci.deve_falhar(adm, format($c$DELETE FROM granel_aberturas WHERE saco_produto_id = %L$c$, saco), 'apagar abertura direto');
  SELECT count(*) INTO n FROM granel_aberturas WHERE tenant_id = tb;
  PERFORM ci.exige(n = 0, 'a outra empresa não recebeu aberturas');
END $$;

-- 42. Pet shop (agenda do profissional): conta ligada ao cadastro, só a agenda dele, isolamento do perfil
DO $$
DECLARE
  demo constant uuid := '11111111-1111-1111-1111-111111111111';
  adm  constant uuid := 'a0000000-0000-0000-0000-000000000001';
  vend constant uuid := 'a0000000-0000-0000-0000-000000000002';
  gest constant uuid := 'a0000000-0000-0000-0000-000000000005';
  gar  constant uuid := 'a0000000-0000-0000-0000-000000000006';
  p1   constant uuid := 'a0000000-0000-0000-0000-0000000000d1';
  p2   constant uuid := 'a0000000-0000-0000-0000-0000000000d2';
  psem constant uuid := 'a0000000-0000-0000-0000-0000000000d3';
  pmix constant uuid := 'a0000000-0000-0000-0000-0000000000d4';
  pout constant uuid := 'a0000000-0000-0000-0000-0000000000d5';
  t0 timestamptz := date_trunc('day', now()) + interval '9 days' + interval '8 hours';
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  tutor uuid; pet uuid; serv uuid; prof1 uuid; prof2 uuid; ag1 uuid; ag2 uuid; ag3 uuid; tb uuid;
  r jsonb; n bigint;
BEGIN
  INSERT INTO clientes (tenant_id, nome, cpf) VALUES (demo, 'Maria Tutora CI', '52998224725') RETURNING id INTO tutor;
  INSERT INTO tenants (nome) VALUES ('Prof B') RETURNING id INTO tb;
  INSERT INTO auth.users (id, email) VALUES (p1, 'prof1@ci'), (p2, 'prof2@ci'), (psem, 'profsem@ci'), (pmix, 'profmix@ci'), (pout, 'profout@ci');
  UPDATE profiles SET tenant_id = demo WHERE id IN (p1, p2, psem, pmix);
  UPDATE profiles SET tenant_id = tb WHERE id = pout;
  INSERT INTO user_roles (user_id, tenant_id, role) VALUES (p1, demo, 'profissional'), (p2, demo, 'profissional'), (psem, demo, 'profissional'),
    (pmix, demo, 'profissional'), (pmix, demo, 'vendedor'), (pout, tb, 'profissional');

  PERFORM ci.entrar(gest);
  serv := pet_servico_salvar('{"nome":"Banho Agenda Prof","duracao_min":30}'::jsonb);
  PERFORM pet_preco_salvar(serv, NULL, NULL, NULL, 60);
  prof1 := pet_profissional_salvar('{"nome":"Ana Banhista CI","comissao_percentual":30}'::jsonb);
  prof2 := pet_profissional_salvar('{"nome":"Beto Tosador CI","comissao_percentual":30}'::jsonb);
  PERFORM ci.sair();
  PERFORM ci.entrar(vend);
  pet := pet_salvar(jsonb_build_object('cliente_id', tutor, 'nome', 'Rex Agenda Prof', 'alergias', 'frango'));
  ag1 := pet_agendar(jsonb_build_object('pet_id', pet, 'profissional_id', prof1, 'inicio', t0, 'servicos', jsonb_build_array(jsonb_build_object('servico_id', serv))));
  ag2 := pet_agendar(jsonb_build_object('pet_id', pet, 'profissional_id', prof1, 'inicio', t0 + interval '2 hours', 'servicos', jsonb_build_array(jsonb_build_object('servico_id', serv))));
  ag3 := pet_agendar(jsonb_build_object('pet_id', pet, 'profissional_id', prof2, 'inicio', t0, 'servicos', jsonb_build_array(jsonb_build_object('servico_id', serv))));
  PERFORM ci.sair();

  -- vínculo: só a gestão; a conta precisa ser da empresa, ativa e com o perfil profissional; uma conta por cadastro
  PERFORM ci.deve_falhar(vend, format($c$SELECT pet_profissional_vincular(%L, %L)$c$, prof1, p1), 'vendedor liga conta ao profissional');
  PERFORM ci.deve_falhar(p1, format($c$SELECT pet_profissional_vincular(%L, %L)$c$, prof1, p1), 'o próprio profissional se liga');
  PERFORM ci.deve_falhar(gest, format($c$SELECT pet_profissional_vincular(%L, %L)$c$, prof1, vend), 'conta sem o perfil profissional');
  PERFORM ci.deve_falhar(gest, format($c$SELECT pet_profissional_vincular(%L, %L)$c$, prof1, pout), 'conta de outra empresa');
  PERFORM ci.deve_falhar(gest, format($c$SELECT pet_profissional_vincular(%L, %L)$c$, gen_random_uuid(), p1), 'profissional que não existe');
  PERFORM ci.entrar(gest);
  PERFORM pet_profissional_vincular(prof1, p1);
  PERFORM pet_profissional_vincular(prof2, p2);
  PERFORM ci.sair();
  PERFORM ci.deve_falhar(gest, format($c$SELECT pet_profissional_vincular(%L, %L)$c$, prof2, p1), 'mesma conta em dois profissionais');

  -- agenda: só a dele, sem preço nem telefone
  PERFORM ci.entrar(p1);
  r := pet_minha_agenda(hoje, hoje + 30);
  PERFORM ci.sair();
  PERFORM ci.exige(jsonb_array_length(r) = 2 AND r -> 0 ->> 'tutor' = 'Maria' AND r -> 0 -> 'pet' ->> 'alergias' = 'frango'
                   AND (r -> 0 -> 'servicos' -> 0 ->> 'nome') = 'Banho Agenda Prof', 'o profissional vê os 2 atendimentos dele, com pet, alergia e serviço');
  PERFORM ci.exige(r::text NOT LIKE '%preco%' AND r::text NOT LIKE '%cpf%' AND r::text NOT LIKE '%telefone%' AND r::text NOT LIKE '%Tutora%', 'a agenda não traz preço, documento, telefone nem o sobrenome do tutor');
  PERFORM ci.deve_falhar(p1, format($c$SELECT pet_minha_agenda(%L, %L)$c$, hoje, hoje + 60), 'período maior que 31 dias');
  PERFORM ci.deve_falhar(psem, format($c$SELECT pet_minha_agenda(%L, %L)$c$, hoje, hoje + 1), 'conta sem cadastro ligado');
  PERFORM ci.deve_falhar(vend, format($c$SELECT pet_minha_agenda(%L, %L)$c$, hoje, hoje + 1), 'quem não é profissional chama a agenda');

  -- avançar: começar e dar como pronto; nada além, nada dos outros
  PERFORM ci.deve_falhar(p1, format($c$SELECT pet_minha_situacao(%L, 'em_atendimento')$c$, ag3), 'atendimento de outro profissional');
  PERFORM ci.deve_falhar(p1, format($c$SELECT pet_minha_situacao(%L, 'pronto')$c$, ag1), 'pronto sem ter começado');
  PERFORM ci.deve_falhar(p1, format($c$SELECT pet_minha_situacao(%L, 'cancelado')$c$, ag1), 'profissional cancela');
  PERFORM ci.deve_falhar(p1, format($c$SELECT pet_minha_situacao(%L, 'retirado')$c$, ag1), 'profissional dá como retirado');
  PERFORM ci.entrar(p1);
  PERFORM pet_minha_situacao(ag1, 'em_atendimento');
  PERFORM pet_minha_situacao(ag1, 'pronto');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT situacao = 'pronto' FROM pet_agendamentos WHERE id = ag1) AND (SELECT situacao = 'agendado' FROM pet_agendamentos WHERE id = ag3), 'o profissional avançou só o atendimento dele');
  PERFORM ci.deve_falhar(p1, format($c$SELECT pet_minha_situacao(%L, 'em_atendimento')$c$, ag1), 'voltar atendimento pronto');

  -- cadastro inativo perde o acesso
  PERFORM ci.entrar(gest);
  PERFORM pet_profissional_salvar(jsonb_build_object('id', prof2, 'nome', 'Beto Tosador CI', 'ativo', false));
  PERFORM ci.sair();
  PERFORM ci.deve_falhar(p2, format($c$SELECT pet_minha_agenda(%L, %L)$c$, hoje, hoje + 1), 'cadastro do profissional inativo');

  -- isolamento: o perfil não enxerga nada da loja nem do salão; quem acumula outro papel enxerga
  PERFORM ci.exige(ci.contar(p1, 'SELECT count(*) FROM produtos') = 0 AND ci.contar(p1, 'SELECT count(*) FROM clientes') = 0
                   AND ci.contar(p1, 'SELECT count(*) FROM pedidos') = 0 AND ci.contar(p1, 'SELECT count(*) FROM pets') = 0
                   AND ci.contar(p1, 'SELECT count(*) FROM pet_agendamentos') = 0 AND ci.contar(p1, 'SELECT count(*) FROM pet_profissionais') = 0
                   AND ci.contar(p1, 'SELECT count(*) FROM pet_comissoes') = 0, 'o profissional não lê as tabelas da loja nem as do pet shop');
  PERFORM ci.exige(ci.contar(p1, 'SELECT count(*) FROM cardapio_itens') = 0 AND ci.contar(p1, 'SELECT count(*) FROM mesas') = 0 AND ci.contar(p1, 'SELECT count(*) FROM comandas') = 0,
                   'o profissional também não lê cardápio, mesas e comandas');
  PERFORM ci.exige(ci.contar(gar, 'SELECT count(*) FROM mesas') >= 0 AND ci.contar(gar, 'SELECT count(*) FROM cardapio_itens') > 0, 'o garçom segue lendo o cardápio');
  PERFORM ci.exige(ci.contar(p1, 'SELECT count(*) FROM profiles WHERE id = auth.uid()') = 1, 'o profissional lê o próprio perfil (sessão)');
  PERFORM ci.exige(ci.contar(pmix, 'SELECT count(*) FROM clientes') > 0, 'profissional que também é vendedor enxerga a loja');
  PERFORM ci.deve_falhar(p1, 'SELECT frente_caixa_atual()', 'profissional usa o caixa');
  PERFORM ci.deve_falhar(p1, format($c$SELECT pet_agenda_situacao(%L, 'confirmado')$c$, ag2), 'profissional usa a função da recepção');
  PERFORM ci.deve_falhar(p1, format($c$SELECT pet_reagendar(%L, %L::timestamptz)$c$, ag2, t0 + interval '5 hours'), 'profissional remarca');
  PERFORM ci.deve_falhar(p1, format($c$SELECT pet_agenda_retirar(%L)$c$, ag1), 'profissional cobra');
  PERFORM ci.deve_falhar(p1, format($c$UPDATE pet_agendamentos SET situacao = 'retirado' WHERE id = %L$c$, ag1), 'profissional altera a agenda direto');
  PERFORM ci.deve_falhar(p1, format($c$UPDATE pet_profissionais SET profile_id = %L WHERE id = %L$c$, p1, prof2), 'profissional liga a própria conta direto');
  PERFORM ci.exige(NOT EXISTS (SELECT 1 FROM pet_profissionais WHERE profile_id = p1 AND id = prof2), 'o vínculo direto não pegou');
  SELECT count(*) INTO n FROM pet_profissionais WHERE tenant_id = tb;
  PERFORM ci.exige(n = 0, 'a outra empresa não recebeu profissionais');
END $$;

-- 43. Clínica (base): perfil Veterinário, CRMV no cadastro, conta combinando com a função, isolamento e categorias de serviço
DO $$
DECLARE
  demo constant uuid := '11111111-1111-1111-1111-111111111111';
  adm  constant uuid := 'a0000000-0000-0000-0000-000000000001';
  vend constant uuid := 'a0000000-0000-0000-0000-000000000002';
  gest constant uuid := 'a0000000-0000-0000-0000-000000000005';
  v1   constant uuid := 'a0000000-0000-0000-0000-0000000000e1';
  vmix constant uuid := 'a0000000-0000-0000-0000-0000000000e2';
  pban constant uuid := 'a0000000-0000-0000-0000-0000000000e3';
  t0 timestamptz := date_trunc('day', now()) + interval '11 days' + interval '9 hours';
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  tutor uuid; pet uuid; cons uuid; vet uuid; ban uuid; ag uuid; r jsonb; ramo_ant text; cnae_ant text; cnae2_ant text;
BEGIN
  INSERT INTO clientes (tenant_id, nome, cpf) VALUES (demo, 'Tutor Clinica CI', '52998224725') RETURNING id INTO tutor;
  INSERT INTO auth.users (id, email) VALUES (v1, 'vet1@ci'), (vmix, 'vetmix@ci'), (pban, 'banhista@ci');
  UPDATE profiles SET tenant_id = demo WHERE id IN (v1, vmix, pban);
  INSERT INTO user_roles (user_id, tenant_id, role) VALUES (v1, demo, 'veterinario'), (vmix, demo, 'veterinario'), (vmix, demo, 'vendedor'), (pban, demo, 'profissional');

  -- liberação da clínica no banco: sem CNAE 7500 nem ramo clínica, não cadastra veterinário
  SELECT ramo_atividade, cnae, cnae_secundarios INTO ramo_ant, cnae_ant, cnae2_ant FROM empresas WHERE tenant_id = demo ORDER BY created_at LIMIT 1;
  UPDATE empresas SET ramo_atividade = 'petshop', cnae = '4789-0/04', cnae_secundarios = NULL WHERE tenant_id = demo;
  PERFORM ci.exige(NOT ci.contar(gest, 'SELECT clinica_liberada()::int') = 1, 'pet shop sem CNAE 7500 não tem a clínica liberada');
  PERFORM ci.deve_falhar(gest, $c$SELECT pet_servico_salvar('{"nome":"Consulta Sem Clinica CI","categoria":"consulta"}'::jsonb)$c$, 'serviço de consulta em empresa sem clínica');
  PERFORM ci.deve_falhar(gest, $c$SELECT pet_servico_salvar('{"nome":"Vacina Sem Clinica CI","categoria":"vacina"}'::jsonb)$c$, 'serviço de vacina em empresa sem clínica');
  PERFORM ci.deve_falhar(gest, $c$SELECT pet_profissional_salvar('{"nome":"Vet Sem Clinica","funcao":"veterinario","crmv":"12345","crmv_uf":"SP"}'::jsonb)$c$, 'veterinário em empresa sem clínica');
  UPDATE empresas SET cnae_secundarios = '9609-2/08; 7500-1/00' WHERE tenant_id = demo;
  PERFORM ci.exige(ci.contar(gest, 'SELECT clinica_liberada()::int') = 1, 'CNAE 7500 entre os secundários libera a clínica');
  UPDATE empresas SET cnae_secundarios = NULL, ramo_atividade = 'clinica' WHERE tenant_id = demo;
  PERFORM ci.exige(ci.contar(gest, 'SELECT clinica_liberada()::int') = 1, 'ramo Clínica veterinária libera a clínica');

  -- categorias de serviço da clínica
  PERFORM ci.deve_falhar(gest, $c$SELECT pet_servico_salvar('{"nome":"Serviço X CI","categoria":"cirurgia"}'::jsonb)$c$, 'categoria que não existe');
  PERFORM ci.entrar(gest);
  cons := pet_servico_salvar('{"nome":"Consulta Clinica CI","categoria":"consulta","duracao_min":30}'::jsonb);
  PERFORM pet_servico_salvar('{"nome":"Vacina Clinica CI","categoria":"vacina","duracao_min":15}'::jsonb);
  PERFORM pet_servico_salvar('{"nome":"Exame Clinica CI","categoria":"exame","duracao_min":30}'::jsonb);
  PERFORM pet_preco_salvar(cons, NULL, NULL, NULL, 150);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT count(*) FROM pet_servicos WHERE categoria IN ('consulta', 'vacina', 'exame') AND tenant_id = demo) = 3, 'consulta, vacina e exame são categorias de serviço');

  -- CRMV: obrigatório para veterinário, normalizado, e só para ele
  PERFORM ci.deve_falhar(gest, $c$SELECT pet_profissional_salvar('{"nome":"Vet Sem Crmv","funcao":"veterinario"}'::jsonb)$c$, 'veterinário sem CRMV');
  PERFORM ci.deve_falhar(gest, $c$SELECT pet_profissional_salvar('{"nome":"Vet Sem UF","funcao":"veterinario","crmv":"12345"}'::jsonb)$c$, 'veterinário sem UF do CRMV');
  PERFORM ci.deve_falhar(gest, $c$SELECT pet_profissional_salvar('{"nome":"Vet UF Errada","funcao":"veterinario","crmv":"12345","crmv_uf":"XX"}'::jsonb)$c$, 'UF do CRMV inválida');
  PERFORM ci.deve_falhar(gest, $c$SELECT pet_profissional_salvar('{"nome":"Vet Curto","funcao":"veterinario","crmv":"1","crmv_uf":"SP"}'::jsonb)$c$, 'CRMV curto demais');
  PERFORM ci.deve_falhar_dono($c$INSERT INTO pet_profissionais (tenant_id, nome, crmv) VALUES ('11111111-1111-1111-1111-111111111111', 'Sem UF', '12345')$c$, 'CRMV sem UF direto no banco');
  PERFORM ci.deve_falhar(vend, $c$SELECT pet_profissional_salvar('{"nome":"Vet Vendedor","funcao":"veterinario","crmv":"12345","crmv_uf":"SP"}'::jsonb)$c$, 'vendedor cadastra veterinário');
  PERFORM ci.entrar(gest);
  vet := pet_profissional_salvar('{"nome":"Dra Vet CI","funcao":"veterinario","crmv":"sp-12.345","crmv_uf":"sp"}'::jsonb);
  ban := pet_profissional_salvar('{"nome":"Banhista CRMV CI","funcao":"banhista","crmv":"99999","crmv_uf":"RJ"}'::jsonb);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT crmv = 'SP12345' AND crmv_uf = 'SP' FROM pet_profissionais WHERE id = vet), 'o CRMV é normalizado (maiúsculas, sem pontuação)');
  PERFORM ci.exige((SELECT crmv IS NULL AND crmv_uf IS NULL FROM pet_profissionais WHERE id = ban), 'quem não é veterinário não guarda CRMV');

  -- a conta combina com a função
  PERFORM ci.deve_falhar(gest, format($c$SELECT pet_profissional_vincular(%L, %L)$c$, vet, pban), 'veterinário ligado à conta de profissional');
  PERFORM ci.deve_falhar(gest, format($c$SELECT pet_profissional_vincular(%L, %L)$c$, ban, v1), 'banhista ligado à conta de veterinário');
  PERFORM ci.deve_falhar(vend, format($c$SELECT pet_profissional_vincular(%L, %L)$c$, vet, v1), 'vendedor liga a conta do veterinário');
  PERFORM ci.entrar(gest);
  PERFORM pet_profissional_vincular(vet, v1);
  PERFORM pet_profissional_vincular(ban, pban);
  PERFORM ci.sair();
  PERFORM ci.deve_falhar(gest, format($c$SELECT pet_profissional_salvar(jsonb_build_object('id', %L, 'nome', 'Banhista CRMV CI', 'funcao', 'veterinario', 'crmv', '5555', 'crmv_uf', 'SP'))$c$, ban), 'virar veterinário com a conta de profissional ligada');
  PERFORM ci.deve_falhar(gest, format($c$SELECT pet_profissional_salvar(jsonb_build_object('id', %L, 'nome', 'Dra Vet CI', 'funcao', 'tosador'))$c$, vet), 'deixar de ser veterinário com a conta de veterinário ligada');

  -- agenda do veterinário: a consulta agendada pela recepção aparece só para ele, e ele avança
  PERFORM ci.entrar(vend);
  pet := pet_salvar(jsonb_build_object('cliente_id', tutor, 'nome', 'Paciente CI'));
  ag := pet_agendar(jsonb_build_object('pet_id', pet, 'profissional_id', vet, 'inicio', t0, 'servicos', jsonb_build_array(jsonb_build_object('servico_id', cons))));
  PERFORM ci.sair();
  PERFORM ci.entrar(v1);
  r := pet_minha_agenda(hoje, hoje + 30);
  PERFORM pet_minha_situacao(ag, 'em_atendimento');
  PERFORM ci.sair();
  PERFORM ci.exige(jsonb_array_length(r) = 1 AND r -> 0 -> 'servicos' -> 0 ->> 'nome' = 'Consulta Clinica CI', 'o veterinário vê a consulta dele na agenda');
  PERFORM ci.exige((SELECT situacao = 'em_atendimento' FROM pet_agendamentos WHERE id = ag), 'o veterinário começa a consulta');
  PERFORM ci.deve_falhar(pban, format($c$SELECT pet_minha_situacao(%L, 'pronto')$c$, ag), 'banhista mexe na consulta do veterinário');

  -- isolamento: o veterinário não lê a loja nem o restaurante; quem acumula outro papel lê
  PERFORM ci.exige(ci.contar(v1, 'SELECT count(*) FROM produtos') = 0 AND ci.contar(v1, 'SELECT count(*) FROM clientes') = 0
                   AND ci.contar(v1, 'SELECT count(*) FROM pedidos') = 0 AND ci.contar(v1, 'SELECT count(*) FROM pet_agendamentos') = 0
                   AND ci.contar(v1, 'SELECT count(*) FROM mesas') = 0 AND ci.contar(v1, 'SELECT count(*) FROM cardapio_itens') = 0, 'o veterinário não lê a loja, o pet shop nem o restaurante');
  PERFORM ci.exige(ci.contar(vmix, 'SELECT count(*) FROM clientes') > 0, 'veterinário que também é vendedor enxerga a loja');
  PERFORM ci.deve_falhar(v1, 'SELECT frente_caixa_atual()', 'veterinário usa o caixa');
  PERFORM ci.deve_falhar(v1, format($c$SELECT pet_agenda_situacao(%L, 'pronto')$c$, ag), 'veterinário usa a função da recepção');
  PERFORM ci.deve_falhar(v1, format($c$SELECT pet_profissional_vincular(%L, %L)$c$, ban, pban), 'veterinário liga contas');
  PERFORM ci.deve_falhar(v1, format($c$UPDATE pet_profissionais SET crmv = '1', crmv_uf = 'SP' WHERE id = %L$c$, vet), 'veterinário altera o CRMV direto');
  -- a clínica deixa de estar liberada: o veterinário já ligado perde a agenda; o banhista segue
  UPDATE empresas SET ramo_atividade = 'petshop', cnae = '4789-0/04', cnae_secundarios = NULL WHERE tenant_id = demo;
  PERFORM ci.deve_falhar(v1, format($c$SELECT pet_minha_agenda(%L, %L)$c$, hoje, hoje + 30), 'veterinário sem a clínica liberada vê a agenda');
  PERFORM ci.deve_falhar(v1, format($c$SELECT pet_minha_situacao(%L, 'pronto')$c$, ag), 'veterinário sem a clínica liberada avança atendimento');
  PERFORM ci.entrar(pban);
  r := pet_minha_agenda(hoje, hoje + 30);
  PERFORM ci.sair();
  PERFORM ci.exige(jsonb_typeof(r) = 'array', 'o profissional de banho segue com a agenda sem a clínica');
  UPDATE empresas SET ramo_atividade = ramo_ant, cnae = cnae_ant, cnae_secundarios = cnae2_ant WHERE tenant_id = demo;
END $$;

-- 44. Clínica (consulta e prontuário): só o veterinário lê e escreve; fechado é imutável; adendo; auditoria; liberação da clínica
DO $$
DECLARE
  demo constant uuid := '11111111-1111-1111-1111-111111111111';
  adm  constant uuid := 'a0000000-0000-0000-0000-000000000001';
  vend constant uuid := 'a0000000-0000-0000-0000-000000000002';
  gest constant uuid := 'a0000000-0000-0000-0000-000000000005';
  gar  constant uuid := 'a0000000-0000-0000-0000-000000000006';
  pban constant uuid := 'a0000000-0000-0000-0000-0000000000e3';
  va   constant uuid := 'a0000000-0000-0000-0000-0000000000f1';
  vb   constant uuid := 'a0000000-0000-0000-0000-0000000000f2';
  t0 timestamptz := date_trunc('day', now()) + interval '12 days' + interval '9 hours';
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  tutor uuid; tutor_b uuid; pet uuid; pet_b uuid; cons uuid; banho uuid; pva uuid; pvb uuid; ag1 uuid; ag2 uuid; ag3 uuid; tb uuid;
  ramo_ant text; cnae_ant text; cnae2_ant text; r jsonb; at1 uuid; at2 uuid; n bigint;
BEGIN
  SELECT ramo_atividade, cnae, cnae_secundarios INTO ramo_ant, cnae_ant, cnae2_ant FROM empresas WHERE tenant_id = demo ORDER BY created_at LIMIT 1;
  UPDATE empresas SET ramo_atividade = 'clinica' WHERE tenant_id = demo;
  INSERT INTO clientes (tenant_id, nome, cpf) VALUES (demo, 'Joana Tutora Prontuario CI', '52998224725') RETURNING id INTO tutor;
  INSERT INTO tenants (nome) VALUES ('Clinica B CI') RETURNING id INTO tb;
  INSERT INTO clientes (tenant_id, nome, cpf) VALUES (tb, 'Tutor Outra Empresa', '11144477735') RETURNING id INTO tutor_b;
  INSERT INTO pets (tenant_id, cliente_id, nome) VALUES (tb, tutor_b, 'Pet Outra Empresa') RETURNING id INTO pet_b;
  INSERT INTO auth.users (id, email) VALUES (va, 'veta@ci'), (vb, 'vetb@ci');
  UPDATE profiles SET tenant_id = demo WHERE id IN (va, vb);
  INSERT INTO user_roles (user_id, tenant_id, role) VALUES (va, demo, 'veterinario'), (vb, demo, 'veterinario');

  PERFORM ci.entrar(gest);
  cons := pet_servico_salvar('{"nome":"Consulta Prontuario CI","categoria":"consulta","duracao_min":30}'::jsonb);
  banho := pet_servico_salvar('{"nome":"Banho Prontuario CI","categoria":"banho","duracao_min":30}'::jsonb);
  PERFORM pet_preco_salvar(cons, NULL, NULL, NULL, 150);
  PERFORM pet_preco_salvar(banho, NULL, NULL, NULL, 60);
  pva := pet_profissional_salvar('{"nome":"Vet A Prontuario","funcao":"veterinario","crmv":"1111","crmv_uf":"SP"}'::jsonb);
  pvb := pet_profissional_salvar('{"nome":"Vet B Prontuario","funcao":"veterinario","crmv":"2222","crmv_uf":"RJ"}'::jsonb);
  PERFORM pet_profissional_vincular(pva, va);
  PERFORM pet_profissional_vincular(pvb, vb);
  PERFORM ci.sair();
  PERFORM ci.entrar(vend);
  pet := pet_salvar(jsonb_build_object('cliente_id', tutor, 'nome', 'Rex Prontuario CI', 'alergias', 'dipirona'));
  ag1 := pet_agendar(jsonb_build_object('pet_id', pet, 'profissional_id', pva, 'inicio', t0, 'servicos', jsonb_build_array(jsonb_build_object('servico_id', cons))));
  ag2 := pet_agendar(jsonb_build_object('pet_id', pet, 'profissional_id', pvb, 'inicio', t0, 'servicos', jsonb_build_array(jsonb_build_object('servico_id', cons))));
  ag3 := pet_agendar(jsonb_build_object('pet_id', pet, 'profissional_id', pva, 'inicio', t0 + interval '3 hours', 'servicos', jsonb_build_array(jsonb_build_object('servico_id', banho))));
  PERFORM ci.sair();

  -- ninguém além do veterinário lê ou escreve o prontuário
  PERFORM ci.deve_falhar(adm, format($c$SELECT clinica_historico(%L)$c$, pet), 'administrador lê o prontuário');
  PERFORM ci.deve_falhar(gest, format($c$SELECT clinica_historico(%L)$c$, pet), 'gestor lê o prontuário');
  PERFORM ci.deve_falhar(vend, format($c$SELECT clinica_historico(%L)$c$, pet), 'vendedor lê o prontuário');
  PERFORM ci.deve_falhar(gar, format($c$SELECT clinica_historico(%L)$c$, pet), 'garçom lê o prontuário');
  PERFORM ci.deve_falhar(pban, format($c$SELECT clinica_historico(%L)$c$, pet), 'profissional de banho lê o prontuário');
  PERFORM ci.deve_falhar(gest, $c$SELECT clinica_pacientes('rex')$c$, 'gestor busca paciente na clínica');
  PERFORM ci.deve_falhar(gest, format($c$SELECT clinica_atendimento_abrir(%L)$c$, ag1), 'gestor abre atendimento');
  PERFORM ci.deve_falhar(gest, format($c$SELECT clinica_pet_alergias(%L, 'x')$c$, pet), 'gestor altera alergia pela clínica');
  PERFORM ci.deve_falhar(adm, 'SELECT count(*) FROM pet_atendimentos_clinicos', 'leitura direta do atendimento');
  PERFORM ci.deve_falhar(adm, 'SELECT count(*) FROM pet_atendimento_adendos', 'leitura direta do adendo');
  PERFORM ci.deve_falhar(va, 'SELECT count(*) FROM pet_atendimentos_clinicos', 'leitura direta do atendimento pelo próprio veterinário');
  PERFORM ci.deve_falhar(va, format($c$INSERT INTO pet_atendimentos_clinicos (tenant_id, pet_id, cliente_id, agendamento_id, veterinario_id, crmv, crmv_uf) VALUES (%L, %L, %L, %L, %L, '1111', 'SP')$c$, demo, pet, tutor, ag1, pva), 'escrita direta do atendimento');

  -- abrir: só a consulta do próprio veterinário
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_atendimento_abrir(%L)$c$, ag2), 'consulta de outro veterinário');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_atendimento_abrir(%L)$c$, ag3), 'agendamento sem serviço de consulta');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_atendimento_abrir(%L)$c$, gen_random_uuid()), 'agendamento que não existe');
  PERFORM ci.entrar(va);
  r := clinica_atendimento_abrir(ag1);
  at1 := (r ->> 'id')::uuid;
  PERFORM ci.exige(clinica_atendimento_abrir(ag1) ->> 'id' = at1::text, 'abrir de novo devolve o mesmo atendimento');
  PERFORM ci.sair();
  PERFORM ci.exige(r -> 'veterinario' ->> 'crmv' = '1111' AND r ->> 'tutor' = 'Joana Tutora Prontuario CI' AND r -> 'pet' ->> 'alergias' = 'dipirona', 'o atendimento traz o CRMV da abertura, o tutor e a alergia do pet');
  PERFORM ci.exige((SELECT situacao = 'em_atendimento' FROM pet_agendamentos WHERE id = ag1), 'abrir o prontuário começa a consulta');

  -- preencher
  PERFORM ci.deve_falhar(vb, format($c$SELECT clinica_atendimento_salvar(%L, '{"queixa":"x"}'::jsonb)$c$, at1), 'outro veterinário preenche');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_atendimento_salvar(%L, '{"queixa":"x","peso_kg":"500"}'::jsonb)$c$, at1), 'peso absurdo');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_atendimento_salvar(%L, '{"queixa":"x","temperatura_c":"20"}'::jsonb)$c$, at1), 'temperatura absurda');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_atendimento_salvar(%L, '{"queixa":"x","peso_kg":"abc"}'::jsonb)$c$, at1), 'peso que não é número');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_atendimento_salvar(%L, jsonb_build_object('queixa','x','retorno_em', %L))$c$, at1, hoje - 1), 'retorno no passado');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_atendimento_fechar(%L)$c$, at1), 'fechar sem queixa nem conduta');
  PERFORM ci.entrar(va);
  PERFORM clinica_atendimento_salvar(at1, '{"queixa":"Vômito há 2 dias"}'::jsonb);
  PERFORM ci.sair();
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_atendimento_fechar(%L)$c$, at1), 'fechar sem conduta');
  PERFORM ci.entrar(va);
  r := clinica_atendimento_salvar(at1, jsonb_build_object('queixa', 'Vômito há 2 dias', 'anamnese', 'Comeu algo na rua', 'peso_kg', '12,5', 'temperatura_c', '38.7',
                                  'freq_cardiaca', '110', 'freq_respiratoria', '24', 'exame_fisico', 'Mucosas normocoradas', 'diagnostico', 'Gastrite',
                                  'conduta', 'Dieta leve e protetor gástrico', 'retorno_em', hoje + 7));
  PERFORM ci.sair();
  PERFORM ci.exige((r ->> 'peso_kg')::numeric = 12.5 AND (r ->> 'temperatura_c')::numeric = 38.7 AND r ->> 'diagnostico' = 'Gastrite', 'o atendimento guarda os sinais vitais e o texto');

  -- fechar: imutável, consulta vai para pronto
  PERFORM ci.entrar(va);
  r := clinica_atendimento_fechar(at1);
  PERFORM ci.sair();
  PERFORM ci.exige(r ->> 'situacao' = 'fechado' AND r ->> 'fechado_em' IS NOT NULL, 'atendimento fechado');
  PERFORM ci.exige((SELECT situacao = 'pronto' FROM pet_agendamentos WHERE id = ag1), 'fechar o prontuário dá a consulta como pronta (a recepção cobra)');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_atendimento_salvar(%L, '{"queixa":"mudou"}'::jsonb)$c$, at1), 'alterar atendimento fechado');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_atendimento_fechar(%L)$c$, at1), 'fechar duas vezes');
  PERFORM ci.deve_falhar_dono(format($c$UPDATE pet_atendimentos_clinicos SET diagnostico = 'outro' WHERE id = %L$c$, at1), 'UPDATE direto em atendimento fechado (nem o dono do banco)');
  PERFORM ci.deve_falhar_dono(format($c$DELETE FROM pet_atendimentos_clinicos WHERE id = %L$c$, at1), 'apagar atendimento');
  PERFORM ci.exige(ci.contar(adm, 'SELECT count(*) FROM pet_agendamentos WHERE situacao = ''pronto''') >= 1, 'a recepção vê a consulta pronta na agenda, sem texto clínico');

  -- adendo
  PERFORM ci.entrar(vb);
  r := clinica_atendimento_abrir(ag2);
  at2 := (r ->> 'id')::uuid;
  PERFORM ci.sair();
  PERFORM ci.deve_falhar(vb, format($c$SELECT clinica_adendo_criar(%L, 'não pode')$c$, at2), 'adendo em atendimento aberto');
  PERFORM ci.deve_falhar(vb, format($c$SELECT clinica_adendo_criar(%L, '   ')$c$, at1), 'adendo vazio');
  PERFORM ci.deve_falhar(gest, format($c$SELECT clinica_adendo_criar(%L, 'gestor')$c$, at1), 'gestor cria adendo');
  PERFORM ci.entrar(vb);
  r := clinica_adendo_criar(at1, 'Tutor relatou melhora após 3 dias.');
  PERFORM ci.sair();
  PERFORM ci.exige(jsonb_array_length(r -> 'adendos') = 1 AND r -> 'adendos' -> 0 ->> 'crmv' = '2222' AND r ->> 'diagnostico' = 'Gastrite', 'o adendo identifica quem escreveu e não muda o original');
  PERFORM ci.deve_falhar_dono(format($c$UPDATE pet_atendimento_adendos SET texto = 'x' WHERE atendimento_id = %L$c$, at1), 'alterar adendo');
  PERFORM ci.deve_falhar_dono(format($c$DELETE FROM pet_atendimento_adendos WHERE atendimento_id = %L$c$, at1), 'apagar adendo');

  -- histórico, busca, alergia e auditoria
  PERFORM ci.entrar(vb);
  r := clinica_historico(pet);
  PERFORM ci.sair();
  PERFORM ci.exige(jsonb_array_length(r -> 'atendimentos') = 2 AND r ->> 'tutor' = 'Joana Tutora Prontuario CI', 'o veterinário vê o histórico completo do paciente (dois atendimentos)');
  PERFORM ci.entrar(vb);
  r := clinica_pacientes('rex joana');
  PERFORM ci.sair();
  PERFORM ci.exige(jsonb_array_length(r) = 0, 'a busca olha o nome do pet ou do tutor, não os dois juntos');
  PERFORM ci.entrar(vb);
  r := clinica_pacientes('Joana');
  PERFORM ci.sair();
  PERFORM ci.exige(jsonb_array_length(r) = 1 AND r -> 0 ->> 'nome' = 'Rex Prontuario CI', 'a busca acha o paciente pelo nome do tutor');
  PERFORM ci.deve_falhar(vb, $c$SELECT clinica_pacientes('r')$c$, 'busca de uma letra');
  PERFORM ci.deve_falhar(vb, format($c$SELECT clinica_historico(%L)$c$, pet_b), 'paciente de outra empresa');
  PERFORM ci.entrar(vb);
  PERFORM clinica_pet_alergias(pet, 'dipirona e frango');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT alergias = 'dipirona e frango' FROM pets WHERE id = pet), 'o veterinário atualiza a alergia do pet');
  SELECT count(*) INTO n FROM clinica_acessos WHERE tenant_id = demo;
  PERFORM ci.exige(n >= 5 AND ci.contar(gest, 'SELECT count(*) FROM clinica_acessos') = n AND ci.contar(vend, 'SELECT count(*) FROM clinica_acessos') = 0 AND ci.contar(va, 'SELECT count(*) FROM clinica_acessos') = 0,
                   'os acessos ficam registrados e só a gestão os vê (sem texto clínico)');

  -- a agenda do veterinário informa a categoria do serviço
  PERFORM ci.entrar(va);
  r := pet_minha_agenda(hoje, hoje + 30);
  PERFORM ci.sair();
  PERFORM ci.exige(EXISTS (SELECT 1 FROM jsonb_array_elements(r) e, jsonb_array_elements(e -> 'servicos') s WHERE s ->> 'categoria' = 'consulta'), 'a agenda traz a categoria dos serviços');

  -- clínica deixa de estar liberada: nada do prontuário funciona
  UPDATE empresas SET ramo_atividade = 'petshop', cnae = '4789-0/04', cnae_secundarios = NULL WHERE tenant_id = demo;
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_historico(%L)$c$, pet), 'prontuário sem a clínica liberada');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_atendimento_abrir(%L)$c$, ag1), 'abrir atendimento sem a clínica liberada');
  UPDATE empresas SET ramo_atividade = ramo_ant, cnae = cnae_ant, cnae_secundarios = cnae2_ant WHERE tenant_id = demo;
END $$;

-- 45. Clínica (vacinas e vermífugos): catálogo, aplicação com lote, série e reforço, cancelamento, aplicada fora, cartão
DO $$
DECLARE
  demo constant uuid := '11111111-1111-1111-1111-111111111111';
  adm  constant uuid := 'a0000000-0000-0000-0000-000000000001';
  vend constant uuid := 'a0000000-0000-0000-0000-000000000002';
  gest constant uuid := 'a0000000-0000-0000-0000-000000000005';
  gar  constant uuid := 'a0000000-0000-0000-0000-000000000006';
  pban constant uuid := 'a0000000-0000-0000-0000-0000000000e3';
  vg   constant uuid := 'a0000000-0000-0000-0000-0000000000f3';
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  t0 timestamptz := date_trunc('day', now()) + interval '13 days' + interval '9 hours';
  ramo_ant text; cnae_ant text; cnae2_ant text;
  tutor uuid; cao uuid; gato uuid; cao2 uuid; vacserv uuid; banho uuid; pvet uuid; ag uuid; ag_banho uuid;
  prod uuid; prod_b uuid; prod_serv uuid; prod_sem_lote uuid; dep uuid; dep_x uuid; fx uuid; fy uuid; l_ok uuid; l_venc uuid; l_zero uuid; l_outro uuid; l_semval uuid; l_fil uuid; cat uuid; cat_gato uuid; cat_verm uuid;
  r jsonb; a1 uuid; a2 uuid; a3 uuid; a4 uuid; ext uuid; n numeric; est0 numeric;
BEGIN
  SELECT ramo_atividade, cnae, cnae_secundarios INTO ramo_ant, cnae_ant, cnae2_ant FROM empresas WHERE tenant_id = demo ORDER BY created_at LIMIT 1;
  UPDATE empresas SET ramo_atividade = 'clinica' WHERE tenant_id = demo;
  INSERT INTO clientes (tenant_id, nome, cpf) VALUES (demo, 'Tutor Vacina CI', '52998224725') RETURNING id INTO tutor;
  INSERT INTO auth.users (id, email) VALUES (vg, 'vetvac@ci');
  UPDATE profiles SET tenant_id = demo WHERE id = vg;
  INSERT INTO user_roles (user_id, tenant_id, role) VALUES (vg, demo, 'veterinario');
  INSERT INTO depositos (tenant_id, nome) VALUES (demo, 'Vacinas CI') RETURNING id INTO dep;
  INSERT INTO produtos (tenant_id, codigo_interno, descricao, unidade, preco_venda, controla_lote) VALUES (demo, 'VAC-V10-CI', 'Vacina V10 CI', 'UN', 0, true) RETURNING id INTO prod;
  INSERT INTO produtos (tenant_id, codigo_interno, descricao, unidade, preco_venda, controla_lote) VALUES (demo, 'VAC-OUTRO-CI', 'Outro produto CI', 'UN', 0, true) RETURNING id INTO prod_b;
  INSERT INTO produtos (tenant_id, codigo_interno, descricao, unidade, preco_venda, controla_estoque) VALUES (demo, 'VAC-SERV-CI', 'Serviço CI', 'UN', 10, false) RETURNING id INTO prod_serv;
  INSERT INTO produtos (tenant_id, codigo_interno, descricao, unidade, preco_venda) VALUES (demo, 'VAC-SEMLOTE-CI', 'Produto sem controle de lote CI', 'UN', 0) RETURNING id INTO prod_sem_lote;
  INSERT INTO filiais (tenant_id, empresa_id, nome) VALUES (demo, '22222222-2222-2222-2222-222222222222', 'Filial Vacina X') RETURNING id INTO fx;
  INSERT INTO filiais (tenant_id, empresa_id, nome) VALUES (demo, '22222222-2222-2222-2222-222222222222', 'Filial Vacina Y') RETURNING id INTO fy;
  INSERT INTO depositos (tenant_id, filial_id, nome) VALUES (demo, fx, 'Vacinas filial X CI') RETURNING id INTO dep_x;
  PERFORM ci.entrar(adm);
  PERFORM registrar_movimentacao(prod, dep, 'entrada'::mov_tipo, 10, 'ci', 'ci');
  l_ok := estoque_lote_lancar(prod, dep, 'L-OK', '', '', 'entrada', 5, 'ci');
  l_venc := estoque_lote_lancar(prod, dep, 'L-VENC', '', '', 'entrada', 3, 'ci');
  l_zero := estoque_lote_lancar(prod, dep, 'L-ZERO', '', '', 'entrada', 1, 'ci');
  l_outro := estoque_lote_lancar(prod_b, dep, 'L-OUTRO', '', '', 'entrada', 2, 'ci');
  PERFORM estoque_lote_lancar(prod, dep, 'L-ZERO', '', '', 'saida', 1, 'ci');
  l_semval := estoque_lote_lancar(prod, dep, 'L-SEMVAL', '', '', 'entrada', 4, 'ci');
  PERFORM registrar_movimentacao(prod, dep_x, 'entrada'::mov_tipo, 2, 'ci', 'ci');
  l_fil := estoque_lote_lancar(prod, dep_x, 'L-FILIAL', '', '', 'entrada', 2, 'ci');
  PERFORM ci.sair();
  UPDATE estoque_lotes SET validade = hoje + 90 WHERE id = l_ok;
  UPDATE estoque_lotes SET validade = hoje - 1 WHERE id = l_venc;
  UPDATE estoque_lotes SET validade = hoje + 90 WHERE id = l_fil;

  PERFORM ci.entrar(gest);
  vacserv := pet_servico_salvar('{"nome":"Vacinação Clinica CI","categoria":"vacina","duracao_min":15}'::jsonb);
  banho := pet_servico_salvar('{"nome":"Banho Vacina CI","categoria":"banho","duracao_min":30}'::jsonb);
  PERFORM pet_preco_salvar(vacserv, NULL, NULL, NULL, 120);
  PERFORM pet_preco_salvar(banho, NULL, NULL, NULL, 60);
  pvet := pet_profissional_salvar('{"nome":"Vet Vacina CI","funcao":"veterinario","crmv":"3333","crmv_uf":"MG"}'::jsonb);
  PERFORM pet_profissional_vincular(pvet, vg);
  PERFORM ci.sair();

  -- catálogo: gestão e veterinário editam; validações
  PERFORM ci.deve_falhar(vend, format($c$SELECT clinica_vacina_catalogo_salvar(jsonb_build_object('nome','V10 CI','produto_id',%L,'reforco_dias',365))$c$, prod), 'vendedor edita o catálogo');
  PERFORM ci.deve_falhar(gest, format($c$SELECT clinica_vacina_catalogo_salvar(jsonb_build_object('nome','V10 CI','doses_serie',3,'reforco_dias',365,'produto_id',%L))$c$, prod), 'série sem intervalo');
  PERFORM ci.deve_falhar(gest, format($c$SELECT clinica_vacina_catalogo_salvar(jsonb_build_object('nome','V10 CI','reforco_dias',0,'produto_id',%L))$c$, prod), 'reforço zero');
  PERFORM ci.deve_falhar(gest, format($c$SELECT clinica_vacina_catalogo_salvar(jsonb_build_object('nome','','reforco_dias',365,'produto_id',%L))$c$, prod), 'item sem nome');
  PERFORM ci.deve_falhar(gest, format($c$SELECT clinica_vacina_catalogo_salvar(jsonb_build_object('nome','V10 CI','reforco_dias',365,'produto_id',%L))$c$, prod_serv), 'produto que é serviço');
  PERFORM ci.deve_falhar(gest, format($c$SELECT clinica_vacina_catalogo_salvar(jsonb_build_object('nome','V10 CI','reforco_dias',365,'produto_id',%L))$c$, prod_sem_lote), 'produto que não controla lote');
  PERFORM ci.deve_falhar(gest, format($c$SELECT clinica_vacina_catalogo_salvar(jsonb_build_object('nome','V10 CI','reforco_dias',365,'produto_id',%L,'tipo','soro'))$c$, prod), 'tipo inválido');
  PERFORM ci.entrar(gest);
  cat := clinica_vacina_catalogo_salvar(jsonb_build_object('nome', 'V10 CI', 'tipo', 'vacina', 'especie', 'cao', 'doses_serie', 3, 'intervalo_serie_dias', 21,
                                        'reforco_dias', 365, 'idade_minima_dias', 42, 'produto_id', prod));
  cat_gato := clinica_vacina_catalogo_salvar(jsonb_build_object('nome', 'Quadrupla CI', 'especie', 'gato', 'reforco_dias', 365, 'produto_id', prod));
  PERFORM ci.sair();
  PERFORM ci.entrar(vg);
  cat_verm := clinica_vacina_catalogo_salvar(jsonb_build_object('nome', 'Vermífugo CI', 'tipo', 'vermifugo', 'reforco_dias', 90, 'produto_id', prod));
  PERFORM ci.sair();
  PERFORM ci.deve_falhar(gest, format($c$SELECT clinica_vacina_catalogo_salvar(jsonb_build_object('nome',' v10 ci ','especie','cao','reforco_dias',365,'produto_id',%L))$c$, prod), 'nome repetido para a mesma espécie');
  PERFORM ci.entrar(vend);
  r := clinica_vacinas_catalogo();
  PERFORM ci.sair();
  PERFORM ci.exige(jsonb_array_length(r) >= 3, 'a recepção lê o catálogo');
  PERFORM ci.deve_falhar(gar, 'SELECT clinica_vacinas_catalogo()', 'garçom lê o catálogo');
  PERFORM ci.deve_falhar(pban, 'SELECT clinica_vacinas_catalogo()', 'profissional de banho lê o catálogo');
  PERFORM ci.deve_falhar(adm, 'SELECT count(*) FROM pet_vacinas_catalogo', 'leitura direta do catálogo');
  PERFORM ci.deve_falhar(adm, 'SELECT count(*) FROM pet_vacinacoes', 'leitura direta das aplicações');

  -- pacientes e consulta de vacina agendada
  PERFORM ci.entrar(vend);
  cao := pet_salvar(jsonb_build_object('cliente_id', tutor, 'nome', 'Filhote Vacina CI', 'especie', 'cao', 'nascimento', hoje - 30));
  cao2 := pet_salvar(jsonb_build_object('cliente_id', tutor, 'nome', 'Adulto Vacina CI', 'especie', 'cao'));
  gato := pet_salvar(jsonb_build_object('cliente_id', tutor, 'nome', 'Gato Vacina CI', 'especie', 'gato'));
  ag := pet_agendar(jsonb_build_object('pet_id', cao, 'profissional_id', pvet, 'inicio', t0, 'servicos', jsonb_build_array(jsonb_build_object('servico_id', vacserv))));
  ag_banho := pet_agendar(jsonb_build_object('pet_id', cao, 'profissional_id', pvet, 'inicio', t0 + interval '2 hours', 'servicos', jsonb_build_array(jsonb_build_object('servico_id', banho))));
  PERFORM ci.sair();

  -- aplicar: só o veterinário, com lote válido, dentro do atendimento de vacina
  PERFORM ci.deve_falhar(gest, format($c$SELECT clinica_vacina_aplicar(%L, jsonb_build_object('catalogo_id',%L,'estoque_lote_id',%L))$c$, ag, cat, l_ok), 'gestor aplica vacina');
  PERFORM ci.deve_falhar(vg, format($c$SELECT clinica_vacina_aplicar(%L, jsonb_build_object('catalogo_id',%L,'estoque_lote_id',%L))$c$, ag_banho, cat, l_ok), 'agendamento sem serviço de vacina');
  PERFORM ci.deve_falhar(vg, format($c$SELECT clinica_vacina_aplicar(%L, jsonb_build_object('catalogo_id',%L,'estoque_lote_id',%L))$c$, ag, cat, l_venc), 'lote vencido');
  PERFORM ci.deve_falhar(vg, format($c$SELECT clinica_vacina_aplicar(%L, jsonb_build_object('catalogo_id',%L,'estoque_lote_id',%L))$c$, ag, cat, l_zero), 'lote sem saldo');
  PERFORM ci.deve_falhar(vg, format($c$SELECT clinica_vacina_aplicar(%L, jsonb_build_object('catalogo_id',%L,'estoque_lote_id',%L))$c$, ag, cat, l_semval), 'lote sem validade registrada');
  PERFORM ci.deve_falhar(vg, format($c$SELECT clinica_vacina_aplicar(%L, jsonb_build_object('catalogo_id',%L,'estoque_lote_id',%L))$c$, ag, cat, l_outro), 'lote de outro produto');
  PERFORM ci.deve_falhar(vg, format($c$SELECT clinica_vacina_aplicar(%L, jsonb_build_object('catalogo_id',%L,'estoque_lote_id',%L))$c$, ag, cat_gato, l_ok), 'vacina de gato em cão');
  PERFORM ci.deve_falhar(vg, format($c$SELECT clinica_vacina_aplicar(%L, jsonb_build_object('catalogo_id',%L,'estoque_lote_id',%L,'aplicada_em',%L))$c$, ag, cat, l_ok, hoje + 1), 'aplicação no futuro');
  PERFORM ci.deve_falhar(vg, format($c$SELECT clinica_vacina_aplicar(%L, jsonb_build_object('catalogo_id',%L,'estoque_lote_id',%L,'aplicada_em',%L))$c$, ag, cat, l_ok, hoje - 30), 'aplicação antiga fora do registro externo');
  PERFORM ci.deve_falhar(vg, format($c$SELECT clinica_vacina_aplicar(%L, jsonb_build_object('catalogo_id',%L,'estoque_lote_id',%L,'aplicador_id',%L))$c$, ag, cat, l_ok, gen_random_uuid()), 'aplicador que não existe');
  PERFORM ci.deve_falhar(vg, format($c$SELECT clinica_vacina_aplicar(%L, jsonb_build_object('catalogo_id',%L,'estoque_lote_id',%L,'proxima_dose_em',%L))$c$, ag, cat, l_ok, hoje - 1), 'próxima dose antes da aplicação');
  PERFORM ci.exige((SELECT quantidade FROM estoque_lotes WHERE id = l_ok) = 5, 'aplicação recusada não baixa o lote');
  -- veterinário preso a uma filial: não vê nem usa lote de depósito de outra filial
  UPDATE profiles SET filial_id = fy WHERE id = vg;
  PERFORM ci.entrar(vg);
  r := clinica_lotes_vacina(cat);
  PERFORM ci.sair();
  PERFORM ci.exige(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r) e WHERE e ->> 'lote' IN ('L-FILIAL', 'L-SEMVAL', 'L-VENC', 'L-ZERO')) AND jsonb_array_length(r) = 1,
                   'a lista de lotes some com lote sem validade, vencido, zerado e de outra filial');
  PERFORM ci.deve_falhar(vg, format($c$SELECT clinica_vacina_aplicar(%L, jsonb_build_object('catalogo_id',%L,'estoque_lote_id',%L))$c$, ag, cat, l_fil), 'lote de depósito de outra filial');
  UPDATE profiles SET filial_id = NULL WHERE id = vg;
  UPDATE estoque_lotes SET quantidade = 0 WHERE id = l_fil;
  SELECT quantidade INTO est0 FROM estoques WHERE produto_id = prod AND deposito_id = dep;

  PERFORM ci.entrar(vg);
  r := clinica_vacina_aplicar(ag, jsonb_build_object('catalogo_id', cat, 'estoque_lote_id', l_ok, 'local_aplicacao', 'Subcutânea, dorso'));
  PERFORM ci.sair();
  a1 := (r ->> 'id')::uuid;
  PERFORM ci.exige(r ->> 'dose_tipo' = 'serie' AND (r ->> 'dose_numero')::int = 1 AND (r ->> 'proxima_dose_em')::date = hoje + 21, '1ª dose da série: próxima em 21 dias');
  PERFORM ci.exige(jsonb_array_length(r -> 'avisos') = 1 AND r -> 'avisos' ->> 0 LIKE '%idade mínima%', 'aviso (que não bloqueia) de idade mínima');
  PERFORM ci.exige((SELECT quantidade FROM estoque_lotes WHERE id = l_ok) = 4 AND (SELECT quantidade FROM estoques WHERE produto_id = prod AND deposito_id = dep) = est0 - 1,
                   'a aplicação baixa 1 dose do lote e do estoque');
  PERFORM ci.exige((SELECT situacao = 'em_atendimento' FROM pet_agendamentos WHERE id = ag), 'registrar a vacina começa o atendimento');
  PERFORM ci.exige((SELECT lote = 'L-OK' AND aplicador_id = veterinario_id AND origem = 'clinica' FROM pet_vacinacoes WHERE id = a1), 'a aplicação guarda o lote e, sem auxiliar, o veterinário como aplicador');

  PERFORM ci.entrar(vg);
  r := clinica_vacina_aplicar(ag, jsonb_build_object('catalogo_id', cat, 'estoque_lote_id', l_ok, 'aplicada_em', hoje));
  a2 := (r ->> 'id')::uuid;
  PERFORM ci.exige(r ->> 'dose_tipo' = 'serie' AND (r ->> 'dose_numero')::int = 2 AND (r ->> 'proxima_dose_em')::date = hoje + 21 AND (r -> 'avisos') @> '["Já existe uma aplicação deste item para o pet nesta data."]'::jsonb, '2ª dose; aviso de aplicação repetida no dia');
  r := clinica_vacina_aplicar(ag, jsonb_build_object('catalogo_id', cat, 'estoque_lote_id', l_ok));
  a3 := (r ->> 'id')::uuid;
  PERFORM ci.exige(r ->> 'dose_tipo' = 'serie' AND (r ->> 'dose_numero')::int = 3 AND (r ->> 'proxima_dose_em')::date = hoje + 365, 'última dose da série: a próxima já é o reforço (365 dias)');
  r := clinica_vacina_aplicar(ag, jsonb_build_object('catalogo_id', cat, 'estoque_lote_id', l_ok, 'proxima_dose_em', ''));
  a4 := (r ->> 'id')::uuid;
  PERFORM ci.sair();
  PERFORM ci.exige(r ->> 'dose_tipo' = 'reforco' AND (r ->> 'dose_numero')::int = 1 AND r ->> 'proxima_dose_em' IS NULL, 'depois da série vem o reforço; próxima dose pode ficar em branco');
  PERFORM ci.exige((SELECT quantidade FROM estoque_lotes WHERE id = l_ok) = 1, 'quatro aplicações baixaram quatro doses do lote');
  PERFORM ci.deve_falhar_dono(format($c$UPDATE pet_vacinacoes SET lote = 'X' WHERE id = %L$c$, a1), 'alterar aplicação');
  PERFORM ci.deve_falhar_dono(format($c$UPDATE pet_vacinacoes SET situacao = 'cancelada', cancelada_em = now() WHERE id = %L$c$, a1), 'cancelar sem motivo no banco');
  PERFORM ci.deve_falhar_dono(format($c$DELETE FROM pet_vacinacoes WHERE id = %L$c$, a1), 'apagar aplicação');

  -- cancelar: motivo, só o veterinário, devolve a dose
  PERFORM ci.deve_falhar(gest, format($c$SELECT clinica_vacina_cancelar(%L, 'erro')$c$, a4), 'gestor cancela aplicação');
  PERFORM ci.deve_falhar(vg, format($c$SELECT clinica_vacina_cancelar(%L, '  ')$c$, a4), 'cancelar sem motivo');
  PERFORM ci.entrar(vg);
  PERFORM clinica_vacina_cancelar(a4, 'Registrado no pet errado');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT quantidade FROM estoque_lotes WHERE id = l_ok) = 2 AND (SELECT quantidade FROM estoques WHERE produto_id = prod AND deposito_id = dep) = est0 - 3,
                   'cancelar devolve a dose ao lote e ao estoque');
  PERFORM ci.deve_falhar(vg, format($c$SELECT clinica_vacina_cancelar(%L, 'de novo')$c$, a4), 'cancelar duas vezes');

  -- aplicada em outro local: sem baixa
  PERFORM ci.deve_falhar(gest, format($c$SELECT clinica_vacina_registrar_externa(%L, jsonb_build_object('catalogo_id',%L,'aplicada_em',%L,'informado_por','Tutor'))$c$, cao2, cat, hoje - 60), 'gestor registra vacina externa');
  PERFORM ci.deve_falhar(vg, format($c$SELECT clinica_vacina_registrar_externa(%L, jsonb_build_object('catalogo_id',%L,'aplicada_em',%L))$c$, cao2, cat, hoje - 60), 'externa sem dizer quem informou');
  PERFORM ci.deve_falhar(vg, format($c$SELECT clinica_vacina_registrar_externa(%L, jsonb_build_object('catalogo_id',%L,'aplicada_em',%L,'informado_por','Tutor'))$c$, cao2, cat, hoje + 5), 'externa no futuro');
  PERFORM ci.deve_falhar(vg, format($c$SELECT clinica_vacina_registrar_externa(%L, jsonb_build_object('catalogo_id',%L,'aplicada_em','2020-02-30','informado_por','Tutor'))$c$, cao2, cat), 'externa com data inválida');
  PERFORM ci.entrar(vg);
  r := clinica_vacina_registrar_externa(cao2, jsonb_build_object('catalogo_id', cat, 'aplicada_em', hoje - 60, 'informado_por', 'Carteira de vacinação (Clínica Boa Vida)', 'lote', 'X123'));
  ext := (r ->> 'id')::uuid;
  PERFORM ci.sair();
  PERFORM ci.exige(r ->> 'dose_tipo' = 'serie' AND (r ->> 'dose_numero')::int = 1 AND (r ->> 'proxima_dose_em')::date = hoje - 60 + 21, 'externa também conta como dose da série');
  PERFORM ci.exige((SELECT quantidade FROM estoque_lotes WHERE id = l_ok) = 2 AND (SELECT origem = 'outro_local' AND estoque_lote_id IS NULL FROM pet_vacinacoes WHERE id = ext), 'externa não baixa estoque');

  -- apoio da tela
  PERFORM ci.entrar(vg);
  r := clinica_lotes_vacina(cat);
  PERFORM ci.sair();
  PERFORM ci.exige(jsonb_array_length(r) = 1 AND r -> 0 ->> 'lote' = 'L-OK', 'a lista de lotes mostra só lote com saldo e na validade');
  PERFORM ci.deve_falhar(gest, format($c$SELECT clinica_lotes_vacina(%L)$c$, cat), 'gestor lista lotes da vacina');
  PERFORM ci.deve_falhar(vend, 'SELECT clinica_aplicadores()', 'recepção lista aplicadores');

  -- cartão: gestão, veterinário e recepção; sem texto do prontuário
  PERFORM ci.entrar(vend);
  r := clinica_cartao_vacinacao(cao);
  PERFORM ci.sair();
  PERFORM ci.exige(jsonb_array_length(r -> 'aplicacoes') = 3 AND jsonb_array_length(r -> 'proximas') = 1 AND r -> 'proximas' -> 0 ->> 'proxima_dose_em' = (hoje + 365)::text,
                   'o cartão traz as 3 aplicações ativas (a cancelada fica de fora) e a próxima dose da mais recente (reforço em 365 dias)');
  PERFORM ci.exige(r::text NOT LIKE '%queixa%' AND r::text NOT LIKE '%diagnostico%' AND r -> 'aplicacoes' -> 0 ->> 'crmv' = '3333', 'o cartão não traz prontuário e identifica o veterinário (CRMV)');
  PERFORM ci.entrar(gest);
  r := clinica_cartao_vacinacao(cao2);
  PERFORM ci.sair();
  PERFORM ci.exige(jsonb_array_length(r -> 'aplicacoes') = 1 AND r -> 'aplicacoes' -> 0 ->> 'origem' = 'outro_local' AND r -> 'aplicacoes' -> 0 ->> 'informado_por' LIKE 'Carteira%',
                   'a vacina aplicada fora aparece no cartão, marcada como de outro local');
  PERFORM ci.deve_falhar(gar, format($c$SELECT clinica_cartao_vacinacao(%L)$c$, cao), 'garçom lê o cartão');
  PERFORM ci.deve_falhar(pban, format($c$SELECT clinica_cartao_vacinacao(%L)$c$, cao), 'profissional de banho lê o cartão');
  PERFORM ci.deve_falhar(vend, format($c$SELECT clinica_cartao_vacinacao(%L)$c$, gen_random_uuid()), 'cartão de paciente que não existe');

  -- o aviso interno da baixa de dose não abre o estoque para perfil restrito (a função pública continua barrando)
  PERFORM ci.deve_falhar(gar, format($c$SET app.clinica_baixa = 'on'; SELECT registrar_movimentacao(%L, %L, 'saida'::mov_tipo, 1, 'x', 'x')$c$, prod, dep), 'garçom baixa estoque ligando o aviso interno');
  PERFORM ci.deve_falhar(vg, format($c$SET app.clinica_baixa = 'on'; SELECT registrar_movimentacao(%L, %L, 'saida'::mov_tipo, 1, 'x', 'x')$c$, prod, dep), 'veterinário baixa estoque pela função pública');

  -- clínica deixa de estar liberada
  UPDATE empresas SET ramo_atividade = 'petshop', cnae = '4789-0/04', cnae_secundarios = NULL WHERE tenant_id = demo;
  PERFORM ci.deve_falhar(vend, format($c$SELECT clinica_cartao_vacinacao(%L)$c$, cao), 'cartão sem a clínica liberada');
  PERFORM ci.deve_falhar(vg, format($c$SELECT clinica_vacina_aplicar(%L, jsonb_build_object('catalogo_id',%L,'estoque_lote_id',%L))$c$, ag, cat, l_ok), 'aplicar sem a clínica liberada');
  PERFORM ci.deve_falhar(gest, 'SELECT clinica_vacinas_catalogo()', 'catálogo sem a clínica liberada');
  UPDATE empresas SET ramo_atividade = ramo_ant, cnae = cnae_ant, cnae_secundarios = cnae2_ant WHERE tenant_id = demo;
END $$;

-- 46. Clínica (reforços): lista de vacinas e vermífugos a tomar, com WhatsApp e "já falei", sem prontuário
DO $$
DECLARE
  demo constant uuid := '11111111-1111-1111-1111-111111111111';
  adm  constant uuid := 'a0000000-0000-0000-0000-000000000001';
  vend constant uuid := 'a0000000-0000-0000-0000-000000000002';
  gest constant uuid := 'a0000000-0000-0000-0000-000000000005';
  gar  constant uuid := 'a0000000-0000-0000-0000-000000000006';
  pban constant uuid := 'a0000000-0000-0000-0000-0000000000e3';
  vh   constant uuid := 'a0000000-0000-0000-0000-0000000000f4';
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  t0 timestamptz := date_trunc('day', now()) + interval '14 days' + interval '9 hours';
  ramo_ant text; cnae_ant text; cnae2_ant text;
  tutor uuid; pa uuid; pb uuid; pc uuid; pd uuid; pe uuid; pf uuid; prod uuid; vacserv uuid; pvet uuid;
  c_v10 uuid; c_verm uuid; c_off uuid; r jsonb; ext_e uuid;
BEGIN
  SELECT ramo_atividade, cnae, cnae_secundarios INTO ramo_ant, cnae_ant, cnae2_ant FROM empresas WHERE tenant_id = demo ORDER BY created_at LIMIT 1;
  UPDATE empresas SET ramo_atividade = 'clinica' WHERE tenant_id = demo;
  INSERT INTO clientes (tenant_id, nome, cpf, telefone) VALUES (demo, 'Ana Souza Reforco CI', '52998224725', '(16) 99999-1234') RETURNING id INTO tutor;
  INSERT INTO auth.users (id, email) VALUES (vh, 'vetref@ci');
  UPDATE profiles SET tenant_id = demo WHERE id = vh;
  INSERT INTO user_roles (user_id, tenant_id, role) VALUES (vh, demo, 'veterinario');
  INSERT INTO produtos (tenant_id, codigo_interno, descricao, unidade, preco_venda, controla_lote) VALUES (demo, 'REF-PROD-CI', 'Produto reforço CI', 'UN', 0, true) RETURNING id INTO prod;

  PERFORM ci.entrar(gest);
  vacserv := pet_servico_salvar('{"nome":"Vacinação Reforço CI","categoria":"vacina","duracao_min":15}'::jsonb);
  PERFORM pet_preco_salvar(vacserv, NULL, NULL, NULL, 100);
  pvet := pet_profissional_salvar('{"nome":"Vet Reforço CI","funcao":"veterinario","crmv":"4444","crmv_uf":"RS"}'::jsonb);
  PERFORM pet_profissional_vincular(pvet, vh);
  c_v10 := clinica_vacina_catalogo_salvar(jsonb_build_object('nome', 'V10 Reforço CI', 'especie', 'cao', 'doses_serie', 3, 'intervalo_serie_dias', 21, 'reforco_dias', 365, 'produto_id', prod));
  c_verm := clinica_vacina_catalogo_salvar(jsonb_build_object('nome', 'Vermífugo Reforço CI', 'tipo', 'vermifugo', 'reforco_dias', 90, 'produto_id', prod));
  c_off := clinica_vacina_catalogo_salvar(jsonb_build_object('nome', 'Item inativo CI', 'reforco_dias', 30, 'produto_id', prod, 'ativo', false));
  PERFORM ci.sair();

  PERFORM ci.entrar(vend);
  pa := pet_salvar(jsonb_build_object('cliente_id', tutor, 'nome', 'Atrasado Ref CI', 'especie', 'cao'));
  pb := pet_salvar(jsonb_build_object('cliente_id', tutor, 'nome', 'Quase Ref CI', 'especie', 'cao'));
  pc := pet_salvar(jsonb_build_object('cliente_id', tutor, 'nome', 'Muito Atrasado Ref CI', 'especie', 'cao'));
  pd := pet_salvar(jsonb_build_object('cliente_id', tutor, 'nome', 'Sem Proxima Ref CI', 'especie', 'cao'));
  pe := pet_salvar(jsonb_build_object('cliente_id', tutor, 'nome', 'Cancelada Ref CI', 'especie', 'cao'));
  pf := pet_salvar(jsonb_build_object('cliente_id', tutor, 'nome', 'Agendado Ref CI', 'especie', 'cao'));
  PERFORM pet_agendar(jsonb_build_object('pet_id', pf, 'profissional_id', pvet, 'inicio', t0, 'servicos', jsonb_build_array(jsonb_build_object('servico_id', vacserv))));
  PERFORM ci.sair();

  -- aplicações (registradas como feitas fora, para não depender de lote): datas escolhidas para cair em hoje - 9 etc.
  PERFORM ci.entrar(vh);
  PERFORM clinica_vacina_registrar_externa(pa, jsonb_build_object('catalogo_id', c_v10, 'aplicada_em', hoje - 30, 'informado_por', 'Carteira'));      -- série 1ª: próxima hoje-9
  PERFORM clinica_vacina_registrar_externa(pa, jsonb_build_object('catalogo_id', c_verm, 'aplicada_em', hoje - 99, 'informado_por', 'Carteira'));    -- reforço 90: próxima hoje-9
  PERFORM clinica_vacina_registrar_externa(pb, jsonb_build_object('catalogo_id', c_v10, 'aplicada_em', hoje - 5, 'informado_por', 'Carteira'));      -- próxima hoje+16
  PERFORM clinica_vacina_registrar_externa(pc, jsonb_build_object('catalogo_id', c_verm, 'aplicada_em', hoje - 300, 'informado_por', 'Carteira'));   -- próxima hoje-210
  PERFORM clinica_vacina_registrar_externa(pd, jsonb_build_object('catalogo_id', c_v10, 'aplicada_em', hoje - 30, 'informado_por', 'Carteira', 'proxima_dose_em', ''));
  ext_e := (clinica_vacina_registrar_externa(pe, jsonb_build_object('catalogo_id', c_v10, 'aplicada_em', hoje - 30, 'informado_por', 'Carteira')) ->> 'id')::uuid;
  PERFORM clinica_vacina_cancelar(ext_e, 'registrado no pet errado');
  PERFORM clinica_vacina_registrar_externa(pf, jsonb_build_object('catalogo_id', c_v10, 'aplicada_em', hoje - 30, 'informado_por', 'Carteira'));
  PERFORM ci.sair();

  -- quem vê a lista
  PERFORM ci.deve_falhar(gar, 'SELECT clinica_reforcos_pendentes()', 'garçom vê os reforços');
  PERFORM ci.deve_falhar(pban, 'SELECT clinica_reforcos_pendentes()', 'profissional de banho vê os reforços');
  PERFORM ci.deve_falhar(vh, 'SELECT clinica_reforcos_pendentes()', 'veterinário (perfil restrito) usa a lista da recepção');
  PERFORM ci.deve_falhar(vend, 'SELECT clinica_reforcos_pendentes(61, 10)', 'janela maior que 60 dias');
  PERFORM ci.deve_falhar(vend, 'SELECT clinica_reforcos_pendentes(10, 731)', 'atraso maior que 730 dias');

  PERFORM ci.entrar(vend);
  r := clinica_reforcos_pendentes();
  PERFORM ci.sair();
  r := (SELECT coalesce(jsonb_agg(e), '[]'::jsonb) FROM jsonb_array_elements(r) e WHERE (e ->> 'pet_id')::uuid IN (pa, pb, pc, pd, pe, pf));
  PERFORM ci.exige(jsonb_array_length(r) = 1 AND r -> 0 ->> 'pet_id' = pa::text AND (r -> 0 ->> 'referencia')::date = hoje - 9 AND (r -> 0 ->> 'dias')::int = -9,
                   'padrão (15 dias à frente, 180 de atraso): só o pet com os dois itens vencidos, numa linha só');
  PERFORM ci.exige(jsonb_array_length(r -> 0 -> 'itens') = 2 AND r -> 0 ->> 'telefone' = '(16) 99999-1234', 'a linha traz os 2 itens e o telefone do tutor');
  PERFORM ci.exige(r::text NOT LIKE '%queixa%' AND r::text NOT LIKE '%diagnostico%' AND r::text NOT LIKE '%lote%', 'a lista não traz prontuário nem lote');
  PERFORM ci.entrar(vend);
  r := clinica_reforcos_pendentes(20, 180);
  PERFORM ci.sair();
  r := (SELECT coalesce(jsonb_agg(e), '[]'::jsonb) FROM jsonb_array_elements(r) e WHERE (e ->> 'pet_id')::uuid IN (pa, pb, pc, pd, pe, pf));
  PERFORM ci.exige(jsonb_array_length(r) = 2 AND EXISTS (SELECT 1 FROM jsonb_array_elements(r) e WHERE e ->> 'pet_id' = pb::text), 'com janela de 20 dias entra o pet cuja dose é daqui a 16');
  PERFORM ci.entrar(gest);
  r := clinica_reforcos_pendentes(15, 365);
  PERFORM ci.sair();
  r := (SELECT coalesce(jsonb_agg(e), '[]'::jsonb) FROM jsonb_array_elements(r) e WHERE (e ->> 'pet_id')::uuid IN (pa, pb, pc, pd, pe, pf));
  PERFORM ci.exige(jsonb_array_length(r) = 2 AND EXISTS (SELECT 1 FROM jsonb_array_elements(r) e WHERE e ->> 'pet_id' = pc::text), 'com 365 dias de atraso entra o pet muito atrasado');
  PERFORM ci.exige(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r) e WHERE e ->> 'pet_id' IN (pd::text, pe::text, pf::text)),
                   'ficam de fora: sem próxima dose, aplicação cancelada e pet com vacina já agendada');

  -- item inativo no catálogo não gera lembrete
  PERFORM ci.entrar(vh);
  PERFORM clinica_vacina_registrar_externa(pd, jsonb_build_object('catalogo_id', c_v10, 'aplicada_em', hoje - 30, 'informado_por', 'Carteira', 'proxima_dose_em', (hoje + 3)::text));
  PERFORM ci.sair();
  UPDATE pet_vacinas_catalogo SET ativo = false WHERE id = c_v10;
  PERFORM ci.entrar(vend);
  r := clinica_reforcos_pendentes(15, 180);
  PERFORM ci.sair();
  r := (SELECT coalesce(jsonb_agg(e), '[]'::jsonb) FROM jsonb_array_elements(r) e WHERE (e ->> 'pet_id')::uuid IN (pa, pb, pc, pd, pe, pf));
  PERFORM ci.exige(jsonb_array_length(r) = 1 AND r -> 0 -> 'itens' -> 0 ->> 'nome' = 'Vermífugo Reforço CI', 'item inativo no catálogo sai da lista');
  UPDATE pet_vacinas_catalogo SET ativo = true WHERE id = c_v10;

  -- chamar / já falei: some da lista naquela data; idempotente; só a recepção e a gestão
  PERFORM ci.deve_falhar(gar, format($c$SELECT pet_contato_registrar(%L, 'reforco', %L, 'whatsapp')$c$, pa, hoje - 9), 'garçom registra contato de reforço');
  PERFORM ci.deve_falhar(vh, format($c$SELECT pet_contato_registrar(%L, 'reforco', %L, 'whatsapp')$c$, pa, hoje - 9), 'veterinário registra contato de reforço');
  PERFORM ci.deve_falhar(vend, format($c$SELECT pet_contato_registrar(%L, 'outro_tipo', %L, 'whatsapp')$c$, pa, hoje - 9), 'tipo de contato inválido');
  PERFORM ci.entrar(vend);
  PERFORM pet_contato_registrar(pa, 'reforco', hoje - 9, 'whatsapp');
  PERFORM pet_contato_registrar(pa, 'reforco', hoje - 9, 'telefone');
  r := clinica_reforcos_pendentes(15, 180);
  PERFORM ci.sair();
  r := (SELECT coalesce(jsonb_agg(e), '[]'::jsonb) FROM jsonb_array_elements(r) e WHERE (e ->> 'pet_id')::uuid IN (pa, pb, pc, pd, pe, pf));
  PERFORM ci.exige(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r) e WHERE e ->> 'pet_id' = pa::text), 'quem já foi chamado sai da lista naquela data');
  PERFORM ci.exige((SELECT count(*) FROM pet_contatos WHERE pet_id = pa AND tipo = 'reforco') = 1, 'registrar duas vezes não duplica');

  -- clínica deixa de estar liberada
  UPDATE empresas SET ramo_atividade = 'petshop', cnae = '4789-0/04', cnae_secundarios = NULL WHERE tenant_id = demo;
  PERFORM ci.deve_falhar(vend, 'SELECT clinica_reforcos_pendentes()', 'reforços sem a clínica liberada');
  PERFORM ci.deve_falhar(vend, format($c$SELECT pet_contato_registrar(%L, 'reforco', %L, 'whatsapp')$c$, pb, hoje + 16), 'contato de reforço sem a clínica liberada');
  UPDATE empresas SET ramo_atividade = ramo_ant, cnae = cnae_ant, cnae_secundarios = cnae2_ant WHERE tenant_id = demo;
END $$;

-- 47. Clínica (modelos de exame): gestão e veterinário mantêm; modelos iniciais; campo calculado; faixa por espécie; sem acesso direto
DO $$
DECLARE
  demo constant uuid := '11111111-1111-1111-1111-111111111111';
  novo constant uuid := 'a0000000-0000-0000-0000-000000000004';
  vend constant uuid := 'a0000000-0000-0000-0000-000000000002';
  gest constant uuid := 'a0000000-0000-0000-0000-000000000005';
  gar  constant uuid := 'a0000000-0000-0000-0000-000000000006';
  pban constant uuid := 'a0000000-0000-0000-0000-0000000000e3';
  vh   constant uuid := 'a0000000-0000-0000-0000-0000000000f5';
  ramo_ant text; cnae_ant text; cnae2_ant text; emp_novo uuid; t_novo uuid;
  r jsonb; m_hemo uuid; m_prop uuid; m_novo uuid; c_hb uuid; c_ht uuid; c_leuco uuid; c_seg uuid; c_abs uuid; c_txt uuid; c_esc uuid; c_outro uuid;
  o_hb int; o_ht int; n int; c_primeiro uuid;
BEGIN
  SELECT ramo_atividade, cnae, cnae_secundarios INTO ramo_ant, cnae_ant, cnae2_ant FROM empresas WHERE tenant_id = demo ORDER BY created_at LIMIT 1;
  UPDATE empresas SET ramo_atividade = 'clinica' WHERE tenant_id = demo;
  INSERT INTO auth.users (id, email) VALUES (vh, 'vetexame@ci');
  UPDATE profiles SET tenant_id = demo WHERE id = vh;
  INSERT INTO user_roles (user_id, tenant_id, role) VALUES (vh, demo, 'veterinario');

  -- quem mexe nos modelos: gestão e veterinário; recepção, garçom e profissional não
  PERFORM ci.deve_falhar(gar, 'SELECT clinica_exame_modelos()', 'garçom lê modelos de exame');
  PERFORM ci.deve_falhar(vend, 'SELECT clinica_exame_modelos()', 'recepção lê modelos de exame');
  PERFORM ci.deve_falhar(pban, 'SELECT clinica_exame_modelos()', 'profissional de banho lê modelos de exame');
  PERFORM ci.deve_falhar(vend, 'SELECT clinica_exame_modelos_iniciais()', 'recepção cria modelos iniciais');
  PERFORM ci.deve_falhar(gar, $c$SELECT clinica_exame_modelo_salvar('{"nome":"X","tipo":"outro"}'::jsonb)$c$, 'garçom cria modelo');
  PERFORM ci.deve_falhar(gest, 'SELECT count(*) FROM pet_exame_modelos', 'gestão lê a tabela de modelos direto');
  PERFORM ci.deve_falhar(vh, 'SELECT count(*) FROM pet_exame_campos', 'veterinário lê a tabela de campos direto');
  PERFORM ci.deve_falhar(vh, 'SELECT count(*) FROM pet_exame_referencias', 'veterinário lê a tabela de faixas direto');
  PERFORM ci.deve_falhar(gest, $c$INSERT INTO pet_exame_modelos (nome, tipo) VALUES ('Direto', 'outro')$c$, 'gestão grava modelo direto na tabela');

  -- modelos iniciais: três modelos, idempotente
  PERFORM ci.entrar(gest);
  n := clinica_exame_modelos_iniciais();
  PERFORM ci.exige(n = 3, 'modelos iniciais criam hemograma, bioquímica e urina');
  PERFORM ci.exige(clinica_exame_modelos_iniciais() = 0, 'chamar de novo não duplica');
  r := clinica_exame_modelos();
  PERFORM ci.sair();
  PERFORM ci.exige(jsonb_array_length(r) = 3, 'a empresa tem 3 modelos');
  m_hemo := (SELECT (e ->> 'id')::uuid FROM jsonb_array_elements(r) e WHERE e ->> 'nome' = 'Hemograma');
  PERFORM ci.exige((SELECT jsonb_array_length(e -> 'campos') FROM jsonb_array_elements(r) e WHERE e ->> 'nome' = 'Hemograma') = 26, 'hemograma inicial tem 26 campos');
  PERFORM ci.exige((SELECT jsonb_array_length(e -> 'campos') FROM jsonb_array_elements(r) e WHERE e ->> 'nome' = 'Bioquímica sanguínea') = 22, 'bioquímica inicial tem os 21 itens e as observações');
  PERFORM ci.exige((SELECT count(*) FROM pet_exame_campos WHERE modelo_id = m_hemo AND forma = 'calculado' AND total_campo_id IS NOT NULL AND pct_campo_id IS NOT NULL) = 7,
                   'o hemograma tem 7 absolutos calculados, ligados ao total e ao percentual');
  PERFORM ci.exige((SELECT count(*) FROM pet_exame_campos WHERE modelo_id = m_hemo AND nome IN ('VCM', 'HCM', 'CHCM', 'RDW')) = 4, 'hemograma traz VCM, HCM, CHCM e RDW');
  PERFORM ci.exige((SELECT count(*) FROM pet_exame_referencias WHERE tenant_id = demo) = 0, 'o sistema não traz faixa de referência pronta');
  PERFORM ci.exige((SELECT count(*) FROM pet_exame_campos c JOIN pet_exame_modelos m ON m.id = c.modelo_id WHERE m.tenant_id = demo AND m.nome = 'Urina' AND c.forma = 'escolha') = 6,
                   'a urina tem 6 campos de escolha');

  SELECT id INTO c_hb FROM pet_exame_campos WHERE modelo_id = m_hemo AND nome = 'Hemoglobina';
  SELECT id INTO c_ht FROM pet_exame_campos WHERE modelo_id = m_hemo AND nome = 'Hematócrito';
  SELECT id INTO c_leuco FROM pet_exame_campos WHERE modelo_id = m_hemo AND nome = 'Leucócitos totais';
  SELECT id INTO c_seg FROM pet_exame_campos WHERE modelo_id = m_hemo AND nome = 'Segmentados (%)';
  SELECT id INTO c_abs FROM pet_exame_campos WHERE modelo_id = m_hemo AND nome = 'Segmentados (abs.)';
  SELECT id INTO c_txt FROM pet_exame_campos WHERE modelo_id = m_hemo AND nome = 'Observações';

  -- veterinário (perfil restrito) também mantém os modelos
  PERFORM ci.entrar(vh);
  m_prop := clinica_exame_modelo_salvar(jsonb_build_object('nome', 'Exame próprio CI', 'tipo', 'outro', 'material', 'Soro'));
  PERFORM ci.sair();
  PERFORM ci.exige(m_prop IS NOT NULL, 'veterinário cria um modelo');
  PERFORM ci.deve_falhar(gest, $c$SELECT clinica_exame_modelo_salvar('{"nome":" exame PRÓPRIO ci ","tipo":"outro"}'::jsonb)$c$, 'nome de modelo repetido (sem diferenciar maiúsculas)');
  PERFORM ci.deve_falhar(gest, $c$SELECT clinica_exame_modelo_salvar('{"nome":"Tipo ruim","tipo":"raiox"}'::jsonb)$c$, 'tipo de modelo inválido');
  PERFORM ci.deve_falhar(gest, $c$SELECT clinica_exame_modelo_salvar('{"nome":"","tipo":"outro"}'::jsonb)$c$, 'modelo sem nome');

  -- campos: regras de cada forma
  PERFORM ci.entrar(vh);
  c_esc := clinica_exame_campo_salvar(jsonb_build_object('modelo_id', m_prop, 'nome', 'Resultado', 'forma', 'escolha', 'opcoes', jsonb_build_array('Reagente', 'Não reagente', 'Reagente')));
  c_outro := clinica_exame_campo_salvar(jsonb_build_object('modelo_id', m_prop, 'nome', 'Valor', 'unidade', 'mg/dL', 'forma', 'numero', 'casas', 1));
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT jsonb_array_length(opcoes) FROM pet_exame_campos WHERE id = c_esc) = 2, 'opção repetida entra uma vez só');
  PERFORM ci.exige((SELECT opcoes FROM pet_exame_campos WHERE id = c_esc) = '["Reagente", "Não reagente"]'::jsonb, 'as opções ficam na ordem digitada, sem repetir');
  PERFORM ci.exige((SELECT c.opcoes FROM pet_exame_campos c JOIN pet_exame_modelos m ON m.id = c.modelo_id WHERE m.tenant_id = demo AND m.nome = 'Urina' AND c.nome = 'Corpos cetônicos') = '["Negativo", "Traços", "+", "++", "+++"]'::jsonb,
                   'a ordem das opções dos modelos iniciais é a da semente');
  PERFORM ci.exige((SELECT ordem FROM pet_exame_campos WHERE id = c_outro) = (SELECT ordem + 1 FROM pet_exame_campos WHERE id = c_esc), 'campo novo vai para o fim do modelo');
  PERFORM ci.deve_falhar(gest, format($c$SELECT clinica_exame_campo_salvar(jsonb_build_object('modelo_id', %L, 'nome', 'Casas', 'forma', 'numero', 'casas', 7))$c$, m_prop), 'casas decimais acima de 6');
  PERFORM ci.deve_falhar(gest, format($c$SELECT clinica_exame_campo_salvar(jsonb_build_object('modelo_id', %L, 'nome', 'Sem opção', 'forma', 'escolha'))$c$, m_prop), 'escolha sem opções');
  PERFORM ci.deve_falhar(gest, format($c$SELECT clinica_exame_campo_salvar(jsonb_build_object('modelo_id', %L, 'nome', 'Forma ruim', 'forma', 'imagem'))$c$, m_prop), 'forma de valor inválida');
  PERFORM ci.deve_falhar(gest, format($c$SELECT clinica_exame_campo_salvar(jsonb_build_object('modelo_id', %L, 'nome', ' valor ', 'forma', 'numero'))$c$, m_prop), 'nome de campo repetido no mesmo grupo');
  PERFORM ci.deve_falhar(gest, $c$SELECT clinica_exame_campo_salvar(jsonb_build_object('modelo_id', gen_random_uuid(), 'nome', 'Órfão', 'forma', 'texto'))$c$, 'campo em modelo que não existe');
  PERFORM ci.deve_falhar(gar, format($c$SELECT clinica_exame_campo_salvar(jsonb_build_object('modelo_id', %L, 'nome', 'Garçom', 'forma', 'texto'))$c$, m_prop), 'garçom cria campo');
  PERFORM ci.entrar(gest);
  PERFORM clinica_exame_campo_salvar(jsonb_build_object('modelo_id', m_prop, 'nome', 'Valor', 'grupo', 'Outro grupo', 'forma', 'texto'));
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT count(*) FROM pet_exame_campos WHERE modelo_id = m_prop AND nome = 'Valor') = 2, 'o mesmo nome vale em grupos diferentes');

  -- campo calculado: total e percentual numéricos, do mesmo modelo
  PERFORM ci.deve_falhar(gest, format($c$SELECT clinica_exame_campo_salvar(jsonb_build_object('modelo_id', %L, 'nome', 'Calc texto', 'forma', 'calculado', 'total_campo_id', %L, 'pct_campo_id', %L))$c$, m_hemo, c_leuco, c_txt), 'calculado apontando para campo de texto');
  PERFORM ci.deve_falhar(gest, format($c$SELECT clinica_exame_campo_salvar(jsonb_build_object('modelo_id', %L, 'nome', 'Calc igual', 'forma', 'calculado', 'total_campo_id', %L, 'pct_campo_id', %L))$c$, m_hemo, c_leuco, c_leuco), 'calculado com o mesmo campo no total e no percentual');
  PERFORM ci.deve_falhar(gest, format($c$SELECT clinica_exame_campo_salvar(jsonb_build_object('modelo_id', %L, 'nome', 'Calc de fora', 'forma', 'calculado', 'total_campo_id', %L, 'pct_campo_id', %L))$c$, m_prop, c_leuco, c_seg), 'calculado com campos de outro modelo');
  PERFORM ci.deve_falhar(gest, format($c$SELECT clinica_exame_campo_salvar(jsonb_build_object('modelo_id', %L, 'nome', 'Calc sem ligação', 'forma', 'calculado'))$c$, m_hemo), 'calculado sem total e percentual');
  PERFORM ci.deve_falhar(gest, format($c$SELECT clinica_exame_campo_salvar(jsonb_build_object('id', %L, 'nome', 'Leucócitos totais', 'grupo', 'Leucograma', 'forma', 'texto'))$c$, c_leuco), 'campo que alimenta um cálculo virar texto');
  PERFORM ci.deve_falhar(gest, format($c$SELECT clinica_exame_campo_salvar(jsonb_build_object('id', %L, 'nome', 'Segmentados (%%)', 'grupo', 'Leucograma — relativo', 'forma', 'numero', 'casas', 0, 'ativo', false))$c$, c_seg), 'campo que alimenta um cálculo sair de uso');
  PERFORM ci.entrar(gest);
  PERFORM clinica_exame_campo_salvar(jsonb_build_object('id', c_abs, 'nome', 'Segmentados (abs.)', 'grupo', 'Leucograma — absoluto', 'unidade', 'cél/mm³', 'forma', 'calculado', 'casas', 0,
                                                       'total_campo_id', c_leuco, 'pct_campo_id', c_seg, 'ativo', true));
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT unidade FROM pet_exame_campos WHERE id = c_abs) = 'cél/mm³', 'campo calculado editável (unidade)');

  -- faixa de referência por espécie
  PERFORM ci.deve_falhar(vend, format($c$SELECT clinica_exame_referencia_salvar(%L, 'cao', 1, 2)$c$, c_hb), 'recepção grava faixa');
  PERFORM ci.deve_falhar(gest, format($c$SELECT clinica_exame_referencia_salvar(%L, 'passaro', 1, 2)$c$, c_hb), 'espécie inválida na faixa');
  PERFORM ci.deve_falhar(gest, format($c$SELECT clinica_exame_referencia_salvar(%L, 'cao', 5, 2)$c$, c_hb), 'mínimo maior que o máximo');
  PERFORM ci.deve_falhar(gest, format($c$SELECT clinica_exame_referencia_salvar(%L, 'cao', 1, 2)$c$, c_txt), 'faixa em campo de texto');
  PERFORM ci.deve_falhar(gest, format($c$SELECT clinica_exame_referencia_salvar(%L, 'cao', 1, 2)$c$, c_esc), 'faixa em campo de escolha');
  PERFORM ci.entrar(vh);
  PERFORM clinica_exame_referencia_salvar(c_hb, 'cao', 12, 18);
  PERFORM clinica_exame_referencia_salvar(c_hb, 'gato', 8, 15);
  PERFORM clinica_exame_referencia_salvar(c_hb, 'cao', 11, 19);
  PERFORM clinica_exame_referencia_salvar(c_abs, 'outro', NULL, 9000);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT count(*) FROM pet_exame_referencias WHERE campo_id = c_hb) = 2, 'uma faixa por espécie (gravar de novo troca)');
  PERFORM ci.exige((SELECT minimo FROM pet_exame_referencias WHERE campo_id = c_hb AND especie = 'cao') = 11, 'a faixa do cão ficou com o último valor');
  PERFORM ci.exige((SELECT minimo IS NULL AND maximo = 9000 FROM pet_exame_referencias WHERE campo_id = c_abs AND especie = 'outro'), 'faixa só com máximo, em campo calculado e espécie outro');
  PERFORM ci.entrar(gest);
  PERFORM clinica_exame_referencia_salvar(c_hb, 'gato', NULL, NULL);
  r := clinica_exame_modelos();
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT count(*) FROM pet_exame_referencias WHERE campo_id = c_hb) = 1, 'mínimo e máximo em branco tiram a faixa');
  PERFORM ci.exige((SELECT jsonb_array_length(c -> 'referencias') FROM jsonb_array_elements(r) e, jsonb_array_elements(e -> 'campos') c WHERE (c ->> 'id')::uuid = c_hb) = 1,
                   'a lista de modelos traz as faixas de cada campo');
  PERFORM ci.deve_falhar(gest, format($c$SELECT clinica_exame_campo_salvar(jsonb_build_object('id', %L, 'nome', 'Hemoglobina', 'grupo', 'Eritrograma', 'forma', 'texto'))$c$, c_hb), 'trocar para texto um campo que tem faixa');

  -- ordem dos campos
  SELECT ordem INTO o_hb FROM pet_exame_campos WHERE id = c_hb;
  SELECT ordem INTO o_ht FROM pet_exame_campos WHERE id = c_ht;
  PERFORM ci.deve_falhar(vend, format($c$SELECT clinica_exame_campo_mover(%L, 1)$c$, c_hb), 'recepção reordena campo');
  PERFORM ci.deve_falhar(gest, format($c$SELECT clinica_exame_campo_mover(%L, 2)$c$, c_hb), 'mover mais de uma posição');
  PERFORM ci.entrar(gest);
  PERFORM clinica_exame_campo_mover(c_hb, 1);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT ordem FROM pet_exame_campos WHERE id = c_hb) = o_ht AND (SELECT ordem FROM pet_exame_campos WHERE id = c_ht) = o_hb, 'mover desce o campo e sobe o vizinho');
  SELECT id INTO c_primeiro FROM pet_exame_campos WHERE modelo_id = m_hemo ORDER BY ordem, id LIMIT 1;
  PERFORM ci.entrar(gest);
  PERFORM clinica_exame_campo_mover(c_hb, -1);
  PERFORM clinica_exame_campo_mover(c_primeiro, -1);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT ordem FROM pet_exame_campos WHERE id = c_hb) = o_hb, 'mover de volta restaura a ordem');
  PERFORM ci.exige((SELECT min(ordem) FROM pet_exame_campos WHERE modelo_id = m_hemo) = 0, 'subir o primeiro campo não faz nada');

  -- outra empresa não enxerga nem mexe
  SELECT tenant_id INTO t_novo FROM profiles WHERE id = novo;
  INSERT INTO empresas (tenant_id, razao_social, ramo_atividade) VALUES (t_novo, 'Outra clínica exame CI', 'clinica') RETURNING id INTO emp_novo;
  PERFORM ci.entrar(novo);
  r := clinica_exame_modelos();
  PERFORM ci.sair();
  PERFORM ci.exige(jsonb_array_length(r) = 0, 'outra empresa não vê os modelos');
  PERFORM ci.deve_falhar(novo, format($c$SELECT clinica_exame_campo_salvar(jsonb_build_object('id', %L, 'nome', 'Invasor', 'forma', 'texto'))$c$, c_txt), 'outra empresa edita campo alheio');
  PERFORM ci.deve_falhar(novo, format($c$SELECT clinica_exame_campo_salvar(jsonb_build_object('modelo_id', %L, 'nome', 'Invasor', 'forma', 'texto'))$c$, m_hemo), 'outra empresa cria campo em modelo alheio');
  PERFORM ci.deve_falhar(novo, format($c$SELECT clinica_exame_referencia_salvar(%L, 'cao', 1, 2)$c$, c_hb), 'outra empresa grava faixa em campo alheio');
  PERFORM ci.deve_falhar(novo, format($c$SELECT clinica_exame_campo_mover(%L, 1)$c$, c_hb), 'outra empresa reordena campo alheio');
  PERFORM ci.entrar(novo);
  PERFORM ci.exige(clinica_exame_modelos_iniciais() = 3, 'outra empresa tem os próprios modelos iniciais');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT count(*) FROM pet_exame_modelos WHERE tenant_id = demo) = 4, 'os modelos da empresa não mudaram');
  DELETE FROM empresas WHERE id = emp_novo;

  -- clínica deixa de estar liberada
  UPDATE empresas SET ramo_atividade = 'petshop', cnae = '4789-0/04', cnae_secundarios = NULL WHERE tenant_id = demo;
  PERFORM ci.deve_falhar(gest, 'SELECT clinica_exame_modelos()', 'modelos sem a clínica liberada');
  PERFORM ci.deve_falhar(vh, 'SELECT clinica_exame_modelos_iniciais()', 'modelos iniciais sem a clínica liberada');
  PERFORM ci.deve_falhar(gest, format($c$SELECT clinica_exame_campo_salvar(jsonb_build_object('modelo_id', %L, 'nome', 'Sem clínica', 'forma', 'texto'))$c$, m_prop), 'campo sem a clínica liberada');
  PERFORM ci.deve_falhar(gest, format($c$SELECT clinica_exame_referencia_salvar(%L, 'cao', 1, 2)$c$, c_hb), 'faixa sem a clínica liberada');
  UPDATE empresas SET ramo_atividade = ramo_ant, cnae = cnae_ant, cnae_secundarios = cnae2_ant WHERE tenant_id = demo;
END $$;

-- 48. Clínica (resultados de exame): só o veterinário; cópia dos campos na abertura; calculado; fechado imutável; adendo; cancelar; evolução
DO $$
DECLARE
  demo constant uuid := '11111111-1111-1111-1111-111111111111';
  adm  constant uuid := 'a0000000-0000-0000-0000-000000000001';
  vend constant uuid := 'a0000000-0000-0000-0000-000000000002';
  gest constant uuid := 'a0000000-0000-0000-0000-000000000005';
  gar  constant uuid := 'a0000000-0000-0000-0000-000000000006';
  pban constant uuid := 'a0000000-0000-0000-0000-0000000000e3';
  va   constant uuid := 'a0000000-0000-0000-0000-0000000000f6';
  vb   constant uuid := 'a0000000-0000-0000-0000-0000000000f7';
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  t0 timestamptz := date_trunc('day', now()) + interval '16 days' + interval '9 hours';
  ramo_ant text; cnae_ant text; cnae2_ant text;
  tutor uuid; pet uuid; gato uuid; cons uuid; pva uuid; pvb uuid; ag1 uuid; ag2 uuid; at1 uuid; at2 uuid; tb uuid; tutor_b uuid; pet_b uuid;
  m_hemo uuid; m_urina uuid; m_bioq uuid; c_hb uuid; c_leuco uuid; c_seg uuid; c_ht uuid; c_aspecto uuid;
  r jsonb; ex1 uuid; ex2 uuid; ex3 uuid; ex4 uuid; ex5 uuid; ex6 uuid;
  r_hb uuid; r_leuco uuid; r_seg uuid; r_eos uuid; r_lin uuid; r_hemac uuid; r_obs uuid; r_asp uuid; r_vol uuid;
  n bigint;
BEGIN
  SELECT ramo_atividade, cnae, cnae_secundarios INTO ramo_ant, cnae_ant, cnae2_ant FROM empresas WHERE tenant_id = demo ORDER BY created_at LIMIT 1;
  UPDATE empresas SET ramo_atividade = 'clinica' WHERE tenant_id = demo;
  INSERT INTO clientes (tenant_id, nome, cpf) VALUES (demo, 'Tutor Exame CI', '52998224725') RETURNING id INTO tutor;
  INSERT INTO tenants (nome) VALUES ('Clinica B Exame CI') RETURNING id INTO tb;
  INSERT INTO clientes (tenant_id, nome, cpf) VALUES (tb, 'Tutor Outra Empresa Exame', '11144477735') RETURNING id INTO tutor_b;
  INSERT INTO pets (tenant_id, cliente_id, nome) VALUES (tb, tutor_b, 'Pet Outra Empresa Exame') RETURNING id INTO pet_b;
  INSERT INTO auth.users (id, email) VALUES (va, 'vetexa@ci'), (vb, 'vetexb@ci');
  UPDATE profiles SET tenant_id = demo WHERE id IN (va, vb);
  INSERT INTO user_roles (user_id, tenant_id, role) VALUES (va, demo, 'veterinario'), (vb, demo, 'veterinario');

  PERFORM ci.entrar(gest);
  cons := pet_servico_salvar('{"nome":"Consulta Exame CI","categoria":"consulta","duracao_min":30}'::jsonb);
  PERFORM pet_preco_salvar(cons, NULL, NULL, NULL, 150);
  pva := pet_profissional_salvar('{"nome":"Vet A Exame","funcao":"veterinario","crmv":"7771","crmv_uf":"SP"}'::jsonb);
  pvb := pet_profissional_salvar('{"nome":"Vet B Exame","funcao":"veterinario","crmv":"7772","crmv_uf":"RJ"}'::jsonb);
  PERFORM pet_profissional_vincular(pva, va);
  PERFORM pet_profissional_vincular(pvb, vb);
  PERFORM clinica_exame_modelos_iniciais();
  PERFORM ci.sair();
  SELECT id INTO m_hemo FROM pet_exame_modelos WHERE tenant_id = demo AND nome = 'Hemograma';
  SELECT id INTO m_urina FROM pet_exame_modelos WHERE tenant_id = demo AND nome = 'Urina';
  SELECT id INTO m_bioq FROM pet_exame_modelos WHERE tenant_id = demo AND nome = 'Bioquímica sanguínea';
  SELECT id INTO c_hb FROM pet_exame_campos WHERE modelo_id = m_hemo AND nome = 'Hemoglobina';
  SELECT id INTO c_ht FROM pet_exame_campos WHERE modelo_id = m_hemo AND nome = 'Hematócrito';
  SELECT id INTO c_aspecto FROM pet_exame_campos WHERE modelo_id = m_urina AND nome = 'Aspecto';
  PERFORM ci.entrar(gest);
  PERFORM clinica_exame_referencia_salvar(c_hb, 'cao', 12, 18);
  PERFORM clinica_exame_referencia_salvar(c_hb, 'gato', 8, 15);
  PERFORM ci.sair();

  PERFORM ci.entrar(vend);
  pet := pet_salvar(jsonb_build_object('cliente_id', tutor, 'nome', 'Rex Exame CI', 'especie', 'cao'));
  gato := pet_salvar(jsonb_build_object('cliente_id', tutor, 'nome', 'Mimi Exame CI', 'especie', 'gato'));
  ag1 := pet_agendar(jsonb_build_object('pet_id', pet, 'profissional_id', pva, 'inicio', t0, 'servicos', jsonb_build_array(jsonb_build_object('servico_id', cons))));
  ag2 := pet_agendar(jsonb_build_object('pet_id', pet, 'profissional_id', pvb, 'inicio', t0, 'servicos', jsonb_build_array(jsonb_build_object('servico_id', cons))));
  PERFORM ci.sair();
  PERFORM ci.entrar(va);
  at1 := (clinica_atendimento_abrir(ag1) ->> 'id')::uuid;
  PERFORM ci.sair();
  PERFORM ci.entrar(vb);
  at2 := (clinica_atendimento_abrir(ag2) ->> 'id')::uuid;
  PERFORM ci.sair();

  -- ninguém além do veterinário lê ou escreve resultado de exame
  PERFORM ci.deve_falhar(adm, format($c$SELECT clinica_exames_do_pet(%L)$c$, pet), 'administrador lê a lista de exames');
  PERFORM ci.deve_falhar(gest, format($c$SELECT clinica_exames_do_pet(%L)$c$, pet), 'gestor lê a lista de exames');
  PERFORM ci.deve_falhar(vend, format($c$SELECT clinica_exames_do_pet(%L)$c$, pet), 'recepção lê a lista de exames');
  PERFORM ci.deve_falhar(gar, format($c$SELECT clinica_exames_do_pet(%L)$c$, pet), 'garçom lê a lista de exames');
  PERFORM ci.deve_falhar(pban, format($c$SELECT clinica_exames_do_pet(%L)$c$, pet), 'profissional de banho lê a lista de exames');
  PERFORM ci.deve_falhar(gest, format($c$SELECT clinica_exame_abrir(%L, %L, '{"laboratorio":"Lab"}'::jsonb)$c$, pet, m_hemo), 'gestor abre exame');
  PERFORM ci.deve_falhar(gest, format($c$SELECT clinica_exame_evolucao(%L, 'Hemoglobina', 'g/dL')$c$, pet), 'gestor lê a evolução');
  PERFORM ci.deve_falhar(adm, 'SELECT count(*) FROM pet_exames', 'leitura direta do exame');
  PERFORM ci.deve_falhar(va, 'SELECT count(*) FROM pet_exame_resultados', 'leitura direta do resultado pelo próprio veterinário');
  PERFORM ci.deve_falhar(va, 'SELECT count(*) FROM pet_exame_adendos', 'leitura direta do adendo de exame');
  PERFORM ci.deve_falhar(va, format($c$INSERT INTO pet_exames (tenant_id, pet_id, modelo_id, veterinario_id, crmv, crmv_uf, nome, tipo, laboratorio, data_coleta) VALUES (%L, %L, %L, %L, '7771', 'SP', 'x', 'outro', 'L', current_date)$c$, demo, pet, m_hemo, pva), 'escrita direta do exame');

  -- abrir: regras
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_exame_abrir(%L, %L, '{}'::jsonb)$c$, pet, m_hemo), 'exame avulso sem laboratório');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_exame_abrir(%L, %L, jsonb_build_object('laboratorio', 'Lab', 'data_coleta', %L))$c$, pet, m_hemo, hoje + 1), 'coleta no futuro');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_exame_abrir(%L, %L, jsonb_build_object('laboratorio', 'Lab', 'data_coleta', 'ontem'))$c$, pet, m_hemo), 'data da coleta que não é data');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_exame_abrir(%L, %L, '{"laboratorio":"Lab"}'::jsonb)$c$, pet_b, m_hemo), 'paciente de outra empresa');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_exame_abrir(%L, %L, '{"laboratorio":"Lab"}'::jsonb)$c$, pet, gen_random_uuid()), 'modelo que não existe');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_exame_abrir(%L, %L, jsonb_build_object('atendimento_id', %L))$c$, pet, m_hemo, at2), 'atendimento de outro veterinário');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_exame_abrir(%L, %L, jsonb_build_object('atendimento_id', %L))$c$, gato, m_hemo, at1), 'atendimento de outro paciente');
  UPDATE pet_exame_modelos SET ativo = false WHERE id = m_bioq;
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_exame_abrir(%L, %L, '{"laboratorio":"Lab"}'::jsonb)$c$, pet, m_bioq), 'modelo inativo');
  UPDATE pet_exame_modelos SET ativo = true WHERE id = m_bioq;

  PERFORM ci.entrar(va);
  r := clinica_exame_abrir(pet, m_hemo, jsonb_build_object('atendimento_id', at1));
  ex1 := (r ->> 'id')::uuid;
  PERFORM ci.sair();
  PERFORM ci.exige(jsonb_array_length(r -> 'resultados') = 26 AND r ->> 'situacao' = 'aberto' AND r ->> 'atendimento_id' = at1::text, 'o exame nasce aberto, ligado ao atendimento e com os 26 campos do modelo');
  PERFORM ci.exige(r -> 'veterinario' ->> 'crmv' = '7771' AND r ->> 'material' = 'Sangue total em EDTA' AND r ->> 'tutor' = 'Tutor Exame CI', 'traz o CRMV da abertura, o material do modelo e o tutor');
  PERFORM ci.exige((SELECT (x ->> 'faixa_min')::numeric = 12 AND (x ->> 'faixa_max')::numeric = 18 FROM jsonb_array_elements(r -> 'resultados') x WHERE x ->> 'nome' = 'Hemoglobina'),
                   'a faixa da espécie do paciente (cão) é copiada para o exame');
  PERFORM ci.exige((SELECT count(*) FROM jsonb_array_elements(r -> 'resultados') x WHERE x ->> 'forma' = 'calculado' AND x ->> 'total_id' IS NOT NULL AND x ->> 'pct_id' IS NOT NULL) = 7,
                   'os 7 absolutos calculados apontam para o total e o percentual do próprio exame');
  PERFORM ci.exige((SELECT count(*) FROM jsonb_array_elements(r -> 'resultados') x WHERE x ->> 'valor_num' IS NOT NULL OR x ->> 'valor_texto' IS NOT NULL) = 0, 'tudo em branco: não feito');
  SELECT (x ->> 'id')::uuid INTO r_hb FROM jsonb_array_elements(r -> 'resultados') x WHERE x ->> 'nome' = 'Hemoglobina';
  SELECT (x ->> 'id')::uuid INTO r_leuco FROM jsonb_array_elements(r -> 'resultados') x WHERE x ->> 'nome' = 'Leucócitos totais';
  SELECT (x ->> 'id')::uuid INTO r_seg FROM jsonb_array_elements(r -> 'resultados') x WHERE x ->> 'nome' = 'Segmentados (%)';
  SELECT (x ->> 'id')::uuid INTO r_eos FROM jsonb_array_elements(r -> 'resultados') x WHERE x ->> 'nome' = 'Eosinófilos (%)';
  SELECT (x ->> 'id')::uuid INTO r_lin FROM jsonb_array_elements(r -> 'resultados') x WHERE x ->> 'nome' = 'Linfócitos (%)';
  SELECT (x ->> 'id')::uuid INTO r_hemac FROM jsonb_array_elements(r -> 'resultados') x WHERE x ->> 'nome' = 'Hemácias';
  SELECT (x ->> 'id')::uuid INTO r_obs FROM jsonb_array_elements(r -> 'resultados') x WHERE x ->> 'nome' = 'Observações';

  -- a faixa do gato vem da faixa do gato
  PERFORM ci.entrar(va);
  r := clinica_exame_abrir(gato, m_hemo, '{"laboratorio":"Laboratório Externo CI","data_coleta":"2026-01-10"}'::jsonb);
  ex2 := (r ->> 'id')::uuid;
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT (x ->> 'faixa_max')::numeric = 15 FROM jsonb_array_elements(r -> 'resultados') x WHERE x ->> 'nome' = 'Hemoglobina'), 'gato recebe a faixa do gato');
  PERFORM ci.exige(r ->> 'laboratorio' = 'Laboratório Externo CI' AND r ->> 'atendimento_id' IS NULL AND r ->> 'data_coleta' = '2026-01-10', 'exame avulso guarda laboratório e data da coleta');

  -- preencher
  PERFORM ci.deve_falhar(vb, format($c$SELECT clinica_exame_salvar(%L, jsonb_build_object('observacoes', 'x'))$c$, ex1), 'outro veterinário preenche o exame');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_exame_salvar(%L, jsonb_build_object('resultados', jsonb_build_array(jsonb_build_object('id', %L, 'valor', 'abc'))))$c$, ex1, r_hb), 'valor que não é número');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_exame_salvar(%L, jsonb_build_object('resultados', jsonb_build_array(jsonb_build_object('id', %L, 'valor', '-3'))))$c$, ex1, r_hb), 'valor negativo');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_exame_salvar(%L, jsonb_build_object('resultados', jsonb_build_array(jsonb_build_object('id', %L, 'valor', '1'))))$c$, ex1, (SELECT id FROM pet_exame_resultados WHERE exame_id = ex2 LIMIT 1)), 'resultado de outro exame');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_exame_salvar(%L, jsonb_build_object('resultados', jsonb_build_array(jsonb_build_object('id', %L, 'faixa_min', '9', 'faixa_max', '3'))))$c$, ex1, r_hb), 'faixa com mínimo maior que o máximo');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_exame_salvar(%L, jsonb_build_object('data_coleta', %L))$c$, ex1, hoje + 2), 'data da coleta no futuro ao salvar');
  PERFORM ci.entrar(va);
  r := clinica_exame_salvar(ex1, jsonb_build_object('resultados', jsonb_build_array(
         jsonb_build_object('id', r_hb, 'valor', '13,3', 'nota', 'conferido'),
         jsonb_build_object('id', r_leuco, 'valor', '6600'),
         jsonb_build_object('id', r_seg, 'valor', '40'),
         jsonb_build_object('id', r_eos, 'valor', '5'),
         jsonb_build_object('id', r_lin, 'valor', '55'),
         jsonb_build_object('id', r_obs, 'valor', 'Plaquetas em agregados'),
         jsonb_build_object('id', r_hemac, 'faixa_min', '5', 'faixa_max', '10'))));
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT (x ->> 'valor_num')::numeric = 13.3 AND x ->> 'nota' = 'conferido' FROM jsonb_array_elements(r -> 'resultados') x WHERE x ->> 'nome' = 'Hemoglobina'), 'valor com vírgula e nota gravados');
  PERFORM ci.exige((SELECT (x ->> 'valor_num')::numeric FROM jsonb_array_elements(r -> 'resultados') x WHERE x ->> 'nome' = 'Segmentados (abs.)') = 2640
               AND (SELECT (x ->> 'valor_num')::numeric FROM jsonb_array_elements(r -> 'resultados') x WHERE x ->> 'nome' = 'Eosinófilos (abs.)') = 330
               AND (SELECT (x ->> 'valor_num')::numeric FROM jsonb_array_elements(r -> 'resultados') x WHERE x ->> 'nome' = 'Linfócitos (abs.)') = 3630,
               'os absolutos são calculados: 6600 × 40% = 2640, 5% = 330, 55% = 3630');
  PERFORM ci.exige((SELECT x ->> 'valor_num' IS NULL FROM jsonb_array_elements(r -> 'resultados') x WHERE x ->> 'nome' = 'Monócitos (abs.)'), 'absoluto sem o percentual fica em branco');
  PERFORM ci.exige((SELECT (x ->> 'faixa_min')::numeric = 5 AND (x ->> 'faixa_max')::numeric = 10 FROM jsonb_array_elements(r -> 'resultados') x WHERE x ->> 'nome' = 'Hemácias'), 'a faixa do exame pode ser ajustada (a do laudo externo)');
  PERFORM ci.exige((SELECT x ->> 'valor_texto' = 'Plaquetas em agregados' FROM jsonb_array_elements(r -> 'resultados') x WHERE x ->> 'nome' = 'Observações'), 'campo de texto gravado');

  -- chave ausente não apaga; em branco apaga; mudar o total refaz os absolutos
  PERFORM ci.entrar(va);
  r := clinica_exame_salvar(ex1, jsonb_build_object('observacoes', 'Coleta em jejum'));
  PERFORM ci.sair();
  PERFORM ci.exige(r ->> 'observacoes' = 'Coleta em jejum' AND (SELECT (x ->> 'valor_num')::numeric = 13.3 FROM jsonb_array_elements(r -> 'resultados') x WHERE x ->> 'nome' = 'Hemoglobina'),
                   'salvar só as observações do exame não apaga os valores');
  PERFORM ci.entrar(va);
  r := clinica_exame_salvar(ex1, jsonb_build_object('resultados', jsonb_build_array(jsonb_build_object('id', r_leuco, 'valor', '10000'), jsonb_build_object('id', r_hb, 'valor', ''))));
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT (x ->> 'valor_num')::numeric FROM jsonb_array_elements(r -> 'resultados') x WHERE x ->> 'nome' = 'Segmentados (abs.)') = 4000, 'mudar o total refaz os absolutos');
  PERFORM ci.exige((SELECT x ->> 'valor_num' IS NULL FROM jsonb_array_elements(r -> 'resultados') x WHERE x ->> 'nome' = 'Hemoglobina'), 'valor em branco volta a "não feito"');
  PERFORM ci.entrar(va);
  r := clinica_exame_salvar(ex1, jsonb_build_object('resultados', jsonb_build_array(jsonb_build_object('id', r_hb, 'valor', '14'))));
  PERFORM ci.sair();

  -- editar o modelo depois não muda o exame já aberto
  PERFORM ci.entrar(gest);
  PERFORM clinica_exame_campo_salvar(jsonb_build_object('id', c_hb, 'nome', 'Hemoglobina renomeada', 'grupo', 'Eritrograma', 'unidade', 'g%', 'forma', 'numero', 'casas', 1));
  PERFORM clinica_exame_referencia_salvar(c_hb, 'cao', 1, 2);
  PERFORM ci.sair();
  PERFORM ci.entrar(va);
  r := clinica_exame_get(ex1);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT x ->> 'unidade' = 'g/dL' AND (x ->> 'faixa_min')::numeric = 12 FROM jsonb_array_elements(r -> 'resultados') x WHERE x ->> 'nome' = 'Hemoglobina'),
                   'o exame mantém nome, unidade e faixa de quando foi aberto');
  PERFORM ci.entrar(gest);
  PERFORM clinica_exame_campo_salvar(jsonb_build_object('id', c_hb, 'nome', 'Hemoglobina', 'grupo', 'Eritrograma', 'unidade', 'g/dL', 'forma', 'numero', 'casas', 1));
  PERFORM clinica_exame_referencia_salvar(c_hb, 'cao', 12, 18);
  PERFORM ci.sair();

  -- fechar
  PERFORM ci.deve_falhar(vb, format($c$SELECT clinica_exame_fechar(%L)$c$, ex1), 'outro veterinário fecha o exame');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_exame_fechar(%L)$c$, ex2), 'fechar exame sem nenhum resultado');
  PERFORM ci.entrar(va);
  r := clinica_exame_fechar(ex1);
  PERFORM ci.sair();
  PERFORM ci.exige(r ->> 'situacao' = 'fechado' AND r ->> 'fechado_em' IS NOT NULL, 'exame fechado');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_exame_salvar(%L, jsonb_build_object('observacoes', 'x'))$c$, ex1), 'preencher exame fechado');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_exame_fechar(%L)$c$, ex1), 'fechar duas vezes');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_exame_cancelar(%L, 'erro')$c$, ex1), 'cancelar exame fechado');
  PERFORM ci.deve_falhar_dono(format($c$UPDATE pet_exame_resultados SET valor_num = 99 WHERE id = %L$c$, r_hb), 'alterar resultado de exame fechado, nem o dono do banco');
  PERFORM ci.deve_falhar_dono(format($c$UPDATE pet_exames SET observacoes = 'x' WHERE id = %L$c$, ex1), 'alterar exame fechado, nem o dono do banco');
  PERFORM ci.deve_falhar_dono(format($c$DELETE FROM pet_exame_resultados WHERE exame_id = %L$c$, ex1), 'apagar resultado de exame fechado');
  PERFORM ci.deve_falhar_dono(format($c$DELETE FROM pet_exames WHERE id = %L$c$, ex1), 'apagar exame');
  PERFORM ci.deve_falhar_dono(format($c$UPDATE pet_exame_resultados SET nome = 'Outro nome' WHERE exame_id = %L$c$, ex2), 'trocar a cópia do campo mesmo com o exame aberto');
  PERFORM ci.exige((SELECT count(*) FROM pet_exame_resultados WHERE exame_id = ex1 AND valor_num = 99) = 0, 'o resultado fechado continua o mesmo');

  -- adendo
  PERFORM ci.deve_falhar(gest, format($c$SELECT clinica_exame_adendo_criar(%L, 'x')$c$, ex1), 'gestor faz adendo de exame');
  PERFORM ci.deve_falhar(vb, format($c$SELECT clinica_exame_adendo_criar(%L, '   ')$c$, ex1), 'adendo vazio');
  PERFORM ci.deve_falhar(vb, format($c$SELECT clinica_exame_adendo_criar(%L, 'x')$c$, ex2), 'adendo em exame aberto');
  PERFORM ci.entrar(vb);
  r := clinica_exame_adendo_criar(ex1, 'Hemoglobina digitada errada: o laudo traz 14,0 g/dL.');
  PERFORM ci.sair();
  PERFORM ci.exige(jsonb_array_length(r -> 'adendos') = 1 AND r -> 'adendos' -> 0 ->> 'crmv' = '7772' AND r -> 'adendos' -> 0 ->> 'veterinario' = 'Vet B Exame', 'o adendo traz o nome e o CRMV de quem fez');
  PERFORM ci.deve_falhar_dono('UPDATE pet_exame_adendos SET texto = ''x''', 'alterar adendo de exame');
  PERFORM ci.deve_falhar_dono('DELETE FROM pet_exame_adendos', 'apagar adendo de exame');

  -- cancelar
  PERFORM ci.entrar(va);
  r := clinica_exame_abrir(pet, m_urina, '{"laboratorio":"Lab Urina CI"}'::jsonb);
  ex3 := (r ->> 'id')::uuid;
  PERFORM ci.sair();
  SELECT (x ->> 'id')::uuid INTO r_asp FROM jsonb_array_elements(r -> 'resultados') x WHERE x ->> 'nome' = 'Aspecto';
  SELECT (x ->> 'id')::uuid INTO r_vol FROM jsonb_array_elements(r -> 'resultados') x WHERE x ->> 'nome' = 'Volume';
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_exame_salvar(%L, jsonb_build_object('resultados', jsonb_build_array(jsonb_build_object('id', %L, 'valor', 'Verde'))))$c$, ex3, r_asp), 'escolha fora da lista');
  PERFORM ci.entrar(va);
  r := clinica_exame_salvar(ex3, jsonb_build_object('resultados', jsonb_build_array(jsonb_build_object('id', r_asp, 'valor', 'Turvo'), jsonb_build_object('id', r_vol, 'valor', '45'))));
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT x ->> 'valor_texto' = 'Turvo' FROM jsonb_array_elements(r -> 'resultados') x WHERE x ->> 'nome' = 'Aspecto'), 'escolha dentro da lista gravada');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_exame_cancelar(%L, '  ')$c$, ex3), 'cancelar sem motivo');
  PERFORM ci.deve_falhar(vb, format($c$SELECT clinica_exame_cancelar(%L, 'aberto por engano')$c$, ex3), 'outro veterinário cancela o exame');
  PERFORM ci.entrar(va);
  r := clinica_exame_cancelar(ex3, 'Aberto no paciente errado');
  PERFORM ci.sair();
  PERFORM ci.exige(r ->> 'situacao' = 'cancelado' AND r ->> 'cancelado_motivo' = 'Aberto no paciente errado', 'exame cancelado com motivo');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_exame_salvar(%L, jsonb_build_object('observacoes', 'x'))$c$, ex3), 'preencher exame cancelado');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_exame_fechar(%L)$c$, ex3), 'fechar exame cancelado');
  PERFORM ci.deve_falhar_dono(format($c$UPDATE pet_exames SET cancelado_motivo = 'outro' WHERE id = %L$c$, ex3), 'mudar o motivo do cancelamento');

  -- lista e auditoria
  SELECT count(*) INTO n FROM clinica_acessos WHERE tenant_id = demo AND acao = 'exame';
  PERFORM ci.entrar(va);
  r := clinica_exames_do_pet(pet);
  PERFORM ci.sair();
  PERFORM ci.exige(r -> 'pet' ->> 'nome' = 'Rex Exame CI' AND r ->> 'tutor' = 'Tutor Exame CI', 'a lista traz o paciente e o tutor');
  PERFORM ci.exige(jsonb_array_length(r -> 'exames') = 2 AND EXISTS (SELECT 1 FROM jsonb_array_elements(r -> 'exames') x WHERE x ->> 'id' = ex1::text AND x ->> 'situacao' = 'fechado' AND (x ->> 'preenchidos')::int = 6)
                   AND EXISTS (SELECT 1 FROM jsonb_array_elements(r -> 'exames') x WHERE x ->> 'id' = ex3::text AND x ->> 'situacao' = 'cancelado'),
                   'a lista do paciente traz o fechado (6 campos preenchidos) e o cancelado, sem valores');
  PERFORM ci.exige(r::text NOT LIKE '%valor_num%' AND r::text NOT LIKE '%queixa%', 'a lista não traz valores nem prontuário');
  PERFORM ci.exige((SELECT count(*) FROM clinica_acessos WHERE tenant_id = demo AND acao = 'exame') > n, 'abrir a lista de exames fica na auditoria de acessos');
  PERFORM ci.exige((SELECT count(*) FROM clinica_acessos WHERE tenant_id = demo AND acao = 'exame' AND profile_id = va) >= 3, 'a auditoria guarda quem abriu');

  -- evolução: só exames fechados, mesmo campo e unidade, do mais antigo para o mais novo
  PERFORM ci.entrar(va);
  r := clinica_exame_abrir(pet, m_hemo, '{"laboratorio":"Lab Antigo CI","data_coleta":"2026-02-01"}'::jsonb);
  ex4 := (r ->> 'id')::uuid;
  PERFORM ci.sair();
  SELECT (x ->> 'id')::uuid INTO r_hb FROM jsonb_array_elements(r -> 'resultados') x WHERE x ->> 'nome' = 'Hemoglobina';
  PERFORM ci.entrar(va);
  PERFORM clinica_exame_salvar(ex4, jsonb_build_object('resultados', jsonb_build_array(jsonb_build_object('id', r_hb, 'valor', '12,5'))));
  PERFORM clinica_exame_fechar(ex4);
  r := clinica_exame_abrir(pet, m_hemo, '{"laboratorio":"Lab Aberto CI","data_coleta":"2026-03-01"}'::jsonb);
  ex5 := (r ->> 'id')::uuid;
  PERFORM clinica_exame_salvar(ex5, jsonb_build_object('resultados', jsonb_build_array(jsonb_build_object('id', (SELECT (x ->> 'id')::uuid FROM jsonb_array_elements(r -> 'resultados') x WHERE x ->> 'nome' = 'Hemoglobina'), 'valor', '99'))));
  r := clinica_exame_evolucao(pet, 'hemoglobina', 'g/dL');
  PERFORM ci.sair();
  PERFORM ci.exige(jsonb_array_length(r) = 2 AND (r -> 0 ->> 'data_coleta') < (r -> 1 ->> 'data_coleta') AND (r -> 0 ->> 'valor')::numeric = 12.5 AND (r -> 1 ->> 'valor')::numeric = 14,
                   'a evolução traz só os exames fechados do pet, do mais antigo para o mais novo');
  PERFORM ci.entrar(va);
  PERFORM ci.exige(jsonb_array_length(clinica_exame_evolucao(pet, 'Hemoglobina', 'g%')) = 0, 'unidade diferente não entra na mesma evolução');
  PERFORM ci.exige(jsonb_array_length(clinica_exame_evolucao(gato, 'Hemoglobina', 'g/dL')) = 0, 'a evolução é do paciente (o gato não tem exame fechado)');
  PERFORM ci.sair();
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_exame_evolucao(%L, 'Hemoglobina', 'g/dL')$c$, pet_b), 'evolução de paciente de outra empresa');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_exame_get(%L)$c$, gen_random_uuid()), 'exame que não existe');

  -- clínica deixa de estar liberada
  UPDATE empresas SET ramo_atividade = 'petshop', cnae = '4789-0/04', cnae_secundarios = NULL WHERE tenant_id = demo;
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_exames_do_pet(%L)$c$, pet), 'lista de exames sem a clínica liberada');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_exame_abrir(%L, %L, '{"laboratorio":"Lab"}'::jsonb)$c$, pet, m_hemo), 'abrir exame sem a clínica liberada');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_exame_salvar(%L, jsonb_build_object('observacoes', 'x'))$c$, ex5), 'preencher exame sem a clínica liberada');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_exame_get(%L)$c$, ex1), 'ler exame sem a clínica liberada');
  UPDATE empresas SET ramo_atividade = ramo_ant, cnae = cnae_ant, cnae_secundarios = cnae2_ant WHERE tenant_id = demo;
END $$;

-- 49. Clínica (anexos de exame): armazenamento privado, envio só em caminho reservado, link só depois de registrar a abertura, imutável
DO $$
DECLARE
  demo constant uuid := '11111111-1111-1111-1111-111111111111';
  vend constant uuid := 'a0000000-0000-0000-0000-000000000002';
  gest constant uuid := 'a0000000-0000-0000-0000-000000000005';
  gar  constant uuid := 'a0000000-0000-0000-0000-000000000006';
  pban constant uuid := 'a0000000-0000-0000-0000-0000000000e3';
  va   constant uuid := 'a0000000-0000-0000-0000-0000000000f8';
  vb   constant uuid := 'a0000000-0000-0000-0000-0000000000f9';
  t0 timestamptz := date_trunc('day', now()) + interval '18 days' + interval '9 hours';
  ramo_ant text; cnae_ant text; cnae2_ant text;
  tutor uuid; pet uuid; cons uuid; pva uuid; pvb uuid; ag1 uuid; at1 uuid; m_hemo uuid; ex1 uuid; ex2 uuid;
  r jsonb; an1 uuid; an2 uuid; an3 uuid; an4 uuid; c1 text; c2 text; c3 text; c4 text; n bigint; i int;
BEGIN
  SELECT ramo_atividade, cnae, cnae_secundarios INTO ramo_ant, cnae_ant, cnae2_ant FROM empresas WHERE tenant_id = demo ORDER BY created_at LIMIT 1;
  UPDATE empresas SET ramo_atividade = 'clinica' WHERE tenant_id = demo;
  INSERT INTO clientes (tenant_id, nome, cpf) VALUES (demo, 'Tutor Anexo CI', '52998224725') RETURNING id INTO tutor;
  INSERT INTO auth.users (id, email) VALUES (va, 'vetana@ci'), (vb, 'vetanb@ci');
  UPDATE profiles SET tenant_id = demo WHERE id IN (va, vb);
  INSERT INTO user_roles (user_id, tenant_id, role) VALUES (va, demo, 'veterinario'), (vb, demo, 'veterinario');

  PERFORM ci.entrar(gest);
  cons := pet_servico_salvar('{"nome":"Consulta Anexo CI","categoria":"consulta","duracao_min":30}'::jsonb);
  PERFORM pet_preco_salvar(cons, NULL, NULL, NULL, 150);
  pva := pet_profissional_salvar('{"nome":"Vet A Anexo","funcao":"veterinario","crmv":"8881","crmv_uf":"SP"}'::jsonb);
  pvb := pet_profissional_salvar('{"nome":"Vet B Anexo","funcao":"veterinario","crmv":"8882","crmv_uf":"RJ"}'::jsonb);
  PERFORM pet_profissional_vincular(pva, va);
  PERFORM pet_profissional_vincular(pvb, vb);
  PERFORM clinica_exame_modelos_iniciais();
  PERFORM ci.sair();
  SELECT id INTO m_hemo FROM pet_exame_modelos WHERE tenant_id = demo AND nome = 'Hemograma';
  PERFORM ci.entrar(vend);
  pet := pet_salvar(jsonb_build_object('cliente_id', tutor, 'nome', 'Rex Anexo CI', 'especie', 'cao'));
  ag1 := pet_agendar(jsonb_build_object('pet_id', pet, 'profissional_id', pva, 'inicio', t0, 'servicos', jsonb_build_array(jsonb_build_object('servico_id', cons))));
  PERFORM ci.sair();
  PERFORM ci.entrar(va);
  at1 := (clinica_atendimento_abrir(ag1) ->> 'id')::uuid;
  ex1 := (clinica_exame_abrir(pet, m_hemo, jsonb_build_object('atendimento_id', at1)) ->> 'id')::uuid;
  ex2 := (clinica_exame_abrir(pet, m_hemo, '{"laboratorio":"Lab Anexo CI"}'::jsonb) ->> 'id')::uuid;
  PERFORM clinica_exame_cancelar(ex2, 'Aberto por engano');
  PERFORM ci.sair();

  -- bucket privado, só JPEG, PNG e PDF até 15 MB
  PERFORM ci.exige((SELECT NOT public AND file_size_limit = 15728640 AND allowed_mime_types @> ARRAY['image/jpeg', 'image/png', 'application/pdf'] AND cardinality(allowed_mime_types) = 3
                      FROM storage.buckets WHERE id = 'clinica-anexos'), 'o bucket de anexos é privado, com 15 MB e só JPEG, PNG e PDF');

  -- só o veterinário usa os anexos
  PERFORM ci.deve_falhar(gest, format($c$SELECT clinica_anexo_preparar(jsonb_build_object('exame_id', %L, 'categoria', 'laudo', 'descricao', 'x', 'nome_arquivo', 'x.pdf', 'mime', 'application/pdf', 'tamanho', 100))$c$, ex1), 'gestor prepara anexo');
  PERFORM ci.deve_falhar(vend, format($c$SELECT clinica_anexo_preparar(jsonb_build_object('exame_id', %L, 'categoria', 'laudo', 'descricao', 'x', 'nome_arquivo', 'x.pdf', 'mime', 'application/pdf', 'tamanho', 100))$c$, ex1), 'recepção prepara anexo');
  PERFORM ci.deve_falhar(gar, format($c$SELECT clinica_anexos(%L, NULL)$c$, ex1), 'garçom lista anexos');
  PERFORM ci.deve_falhar(pban, format($c$SELECT clinica_anexos(%L, NULL)$c$, ex1), 'profissional de banho lista anexos');
  PERFORM ci.deve_falhar(gest, 'SELECT count(*) FROM pet_exame_anexos', 'leitura direta da tabela de anexos');
  PERFORM ci.deve_falhar(va, 'SELECT count(*) FROM pet_exame_anexos', 'leitura direta da tabela de anexos pelo veterinário');
  PERFORM ci.deve_falhar(va, format($c$INSERT INTO pet_exame_anexos (tenant_id, pet_id, exame_id, categoria, descricao, nome_arquivo, mime, tamanho, caminho, veterinario_id, crmv, crmv_uf) VALUES (%L, %L, %L, 'laudo', 'x', 'x.pdf', 'application/pdf', 10, 'x/y/z.pdf', %L, '8881', 'SP')$c$, demo, pet, ex1, pva), 'escrita direta de anexo');

  -- preparar: regras
  PERFORM ci.deve_falhar(va, 'SELECT clinica_anexo_preparar(''{"categoria":"laudo","descricao":"x","nome_arquivo":"x.pdf","mime":"application/pdf","tamanho":100}''::jsonb)', 'sem exame nem atendimento');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_anexo_preparar(jsonb_build_object('exame_id', %L, 'atendimento_id', %L, 'categoria', 'laudo', 'descricao', 'x', 'nome_arquivo', 'x.pdf', 'mime', 'application/pdf', 'tamanho', 100))$c$, ex1, at1), 'exame e atendimento ao mesmo tempo');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_anexo_preparar(jsonb_build_object('exame_id', %L, 'categoria', 'foto', 'descricao', 'x', 'nome_arquivo', 'x.pdf', 'mime', 'application/pdf', 'tamanho', 100))$c$, ex1), 'tipo de anexo inválido');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_anexo_preparar(jsonb_build_object('exame_id', %L, 'categoria', 'laudo', 'descricao', '  ', 'nome_arquivo', 'x.pdf', 'mime', 'application/pdf', 'tamanho', 100))$c$, ex1), 'anexo sem descrição');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_anexo_preparar(jsonb_build_object('exame_id', %L, 'categoria', 'laudo', 'descricao', 'x', 'nome_arquivo', 'x.zip', 'mime', 'application/zip', 'tamanho', 100))$c$, ex1), 'formato não aceito');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_anexo_preparar(jsonb_build_object('exame_id', %L, 'categoria', 'laudo', 'descricao', 'x', 'nome_arquivo', 'x.pdf', 'mime', 'application/dicom', 'tamanho', 100))$c$, ex1), 'DICOM fica de fora');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_anexo_preparar(jsonb_build_object('exame_id', %L, 'categoria', 'laudo', 'descricao', 'x', 'nome_arquivo', 'x.pdf', 'mime', 'application/pdf', 'tamanho', 0))$c$, ex1), 'arquivo vazio');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_anexo_preparar(jsonb_build_object('exame_id', %L, 'categoria', 'laudo', 'descricao', 'x', 'nome_arquivo', 'x.pdf', 'mime', 'application/pdf', 'tamanho', 15728641))$c$, ex1), 'arquivo acima de 15 MB');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_anexo_preparar(jsonb_build_object('exame_id', %L, 'categoria', 'laudo', 'descricao', 'x', 'nome_arquivo', 'x.pdf', 'mime', 'application/pdf', 'tamanho', 'grande'))$c$, ex1), 'tamanho que não é número');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_anexo_preparar(jsonb_build_object('exame_id', %L, 'categoria', 'laudo', 'descricao', 'x', 'nome_arquivo', 'x.pdf', 'mime', 'application/pdf', 'tamanho', 100))$c$, ex2), 'anexo em exame cancelado');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_anexo_preparar(jsonb_build_object('exame_id', %L, 'categoria', 'laudo', 'descricao', 'x', 'nome_arquivo', 'x.pdf', 'mime', 'application/pdf', 'tamanho', 100))$c$, gen_random_uuid()), 'anexo em exame que não existe');

  PERFORM ci.entrar(va);
  r := clinica_anexo_preparar(jsonb_build_object('exame_id', ex1, 'categoria', 'imagem', 'descricao', 'Ultrassom abdominal', 'nome_arquivo', 'ultra.png', 'mime', 'image/png', 'tamanho', 2048));
  PERFORM ci.sair();
  an1 := (r ->> 'id')::uuid; c1 := r ->> 'caminho';
  PERFORM ci.exige(c1 LIKE demo::text || '/' || pet::text || '/' || an1::text || '.png', 'o caminho é empresa/paciente/id.extensão');
  PERFORM ci.exige((SELECT situacao = 'pendente' FROM pet_exame_anexos WHERE id = an1), 'o anexo nasce pendente');
  PERFORM ci.entrar(va);
  PERFORM ci.exige(jsonb_array_length(clinica_anexos(ex1, NULL)) = 0, 'anexo pendente não aparece na lista');
  PERFORM ci.sair();
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_anexo_confirmar(%L)$c$, an1), 'confirmar sem o arquivo enviado');

  -- envio: só no caminho reservado, só pelo veterinário que reservou
  PERFORM ci.deve_falhar(va, format($c$INSERT INTO storage.objects (bucket_id, name, owner, metadata) VALUES ('clinica-anexos', %L, %L, '{"size":2048,"mimetype":"image/png"}')$c$, demo::text || '/' || pet::text || '/outro.png', va), 'upload em caminho que não foi reservado');
  PERFORM ci.deve_falhar(vb, format($c$INSERT INTO storage.objects (bucket_id, name, owner, metadata) VALUES ('clinica-anexos', %L, %L, '{"size":2048,"mimetype":"image/png"}')$c$, c1, vb), 'upload de outro veterinário no caminho reservado');
  PERFORM ci.deve_falhar(gest, format($c$INSERT INTO storage.objects (bucket_id, name, owner, metadata) VALUES ('clinica-anexos', %L, %L, '{"size":2048,"mimetype":"image/png"}')$c$, c1, gest), 'upload da gestão no caminho reservado');
  PERFORM ci.deve_falhar(vend, format($c$INSERT INTO storage.objects (bucket_id, name, owner, metadata) VALUES ('clinica-anexos', %L, %L, '{"size":2048,"mimetype":"image/png"}')$c$, c1, vend), 'upload da recepção no caminho reservado');
  PERFORM ci.deve_falhar(va, format($c$INSERT INTO storage.objects (bucket_id, name, owner, metadata) VALUES ('outro-bucket', %L, %L, '{"size":2048,"mimetype":"image/png"}')$c$, c1, va), 'o caminho reservado não vale em outro bucket');
  PERFORM ci.entrar(va);
  EXECUTE format($c$INSERT INTO storage.objects (bucket_id, name, owner, metadata) VALUES ('clinica-anexos', %L, %L, '{"size":2048,"mimetype":"image/png"}')$c$, c1, va);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT count(*) FROM storage.objects WHERE bucket_id = 'clinica-anexos' AND name = c1) = 1, 'o veterinário envia o arquivo no caminho reservado');

  -- confirmar: só quem reservou, e só se o arquivo confere
  PERFORM ci.deve_falhar(vb, format($c$SELECT clinica_anexo_confirmar(%L)$c$, an1), 'outro veterinário confirma o anexo');
  PERFORM ci.deve_falhar(gest, format($c$SELECT clinica_anexo_confirmar(%L)$c$, an1), 'gestor confirma o anexo');
  PERFORM ci.entrar(va);
  r := clinica_anexo_preparar(jsonb_build_object('exame_id', ex1, 'categoria', 'laudo', 'descricao', 'Laudo do ultrassom', 'nome_arquivo', 'laudo.pdf', 'mime', 'application/pdf', 'tamanho', 5000));
  PERFORM ci.sair();
  an2 := (r ->> 'id')::uuid; c2 := r ->> 'caminho';
  PERFORM ci.entrar(va);
  EXECUTE format($c$INSERT INTO storage.objects (bucket_id, name, owner, metadata) VALUES ('clinica-anexos', %L, %L, '{"size":9999,"mimetype":"application/pdf"}')$c$, c2, va);
  PERFORM ci.sair();
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_anexo_confirmar(%L)$c$, an2), 'confirmar arquivo com tamanho diferente do informado');
  PERFORM ci.entrar(va);
  PERFORM clinica_anexo_confirmar(an1);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT situacao = 'ativo' AND confirmado_em IS NOT NULL FROM pet_exame_anexos WHERE id = an1), 'anexo confirmado fica ativo');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_anexo_confirmar(%L)$c$, an1), 'confirmar duas vezes');

  -- lista: sem o caminho do arquivo; só veterinário; qualquer veterinário da clínica enxerga
  PERFORM ci.entrar(vb);
  r := clinica_anexos(ex1, NULL);
  PERFORM ci.sair();
  PERFORM ci.exige(jsonb_array_length(r) = 1 AND r -> 0 ->> 'descricao' = 'Ultrassom abdominal' AND r -> 0 ->> 'crmv' = '8881' AND r -> 0 ->> 'categoria' = 'imagem', 'a lista traz o anexo ativo, de quem enviou');
  PERFORM ci.exige((r -> 0 ->> 'pode_cancelar')::boolean = false, 'outro veterinário não recebe a opção de cancelar o anexo');
  PERFORM ci.entrar(va);
  PERFORM ci.exige((clinica_anexos(ex1, NULL) -> 0 ->> 'pode_cancelar')::boolean = true, 'quem enviou recebe a opção de cancelar o anexo');
  PERFORM ci.sair();
  PERFORM ci.exige(r::text NOT LIKE '%caminho%' AND r::text NOT LIKE '%' || c1 || '%', 'a lista não traz o caminho do arquivo');

  -- ler o arquivo (gerar o link temporário): só logo depois de registrar a abertura
  PERFORM ci.exige(ci.contar(va, 'SELECT count(*) FROM storage.objects WHERE bucket_id = ''clinica-anexos''') = 0, 'sem abrir pela função, o veterinário não enxerga o arquivo');
  PERFORM ci.exige(ci.contar(gest, 'SELECT count(*) FROM storage.objects WHERE bucket_id = ''clinica-anexos''') = 0, 'a gestão não enxerga o arquivo');
  SELECT count(*) INTO n FROM clinica_acessos WHERE tenant_id = demo AND acao = 'anexo' AND anexo_id = an1;
  PERFORM ci.deve_falhar(gest, format($c$SELECT clinica_anexo_abrir(%L)$c$, an1), 'gestor abre anexo');
  PERFORM ci.deve_falhar(vend, format($c$SELECT clinica_anexo_abrir(%L)$c$, an1), 'recepção abre anexo');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_anexo_abrir(%L)$c$, an2), 'abrir anexo que ainda é pendente');
  PERFORM ci.entrar(va);
  r := clinica_anexo_abrir(an1);
  PERFORM ci.sair();
  PERFORM ci.exige(r ->> 'caminho' = c1 AND r ->> 'mime' = 'image/png' AND r ->> 'nome_arquivo' = 'ultra.png', 'abrir devolve o caminho para o link temporário');
  PERFORM ci.exige((SELECT count(*) FROM clinica_acessos WHERE tenant_id = demo AND acao = 'anexo' AND anexo_id = an1 AND profile_id = va) = n + 1, 'a abertura do anexo fica registrada com quem abriu');
  PERFORM ci.exige(ci.contar(va, 'SELECT count(*) FROM storage.objects WHERE bucket_id = ''clinica-anexos''') = 1, 'depois de abrir, o veterinário gera o link do arquivo aberto');
  PERFORM ci.exige(ci.contar(vb, 'SELECT count(*) FROM storage.objects WHERE bucket_id = ''clinica-anexos''') = 0, 'a abertura de um veterinário não libera o arquivo para outro');
  PERFORM ci.exige(ci.contar(gest, 'SELECT count(*) FROM storage.objects WHERE bucket_id = ''clinica-anexos''') = 0, 'a abertura do veterinário não libera para a gestão');
  UPDATE clinica_acessos SET created_at = now() - interval '3 minutes' WHERE acao = 'anexo' AND anexo_id = an1;
  PERFORM ci.exige(ci.contar(va, 'SELECT count(*) FROM storage.objects WHERE bucket_id = ''clinica-anexos''') = 0, 'a liberação do link vale por 2 minutos');

  -- o arquivo enviado não se troca nem se apaga
  PERFORM ci.entrar(va);
  PERFORM clinica_anexo_abrir(an1);
  UPDATE storage.objects SET name = name || 'x' WHERE bucket_id = 'clinica-anexos';
  DELETE FROM storage.objects WHERE bucket_id = 'clinica-anexos';
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT count(*) FROM storage.objects WHERE bucket_id = 'clinica-anexos' AND name = c1) = 1, 'nem o veterinário altera ou apaga o arquivo no armazenamento');
  PERFORM ci.deve_falhar(va, format($c$INSERT INTO storage.objects (bucket_id, name, owner, metadata) VALUES ('clinica-anexos', %L, %L, '{"size":2048,"mimetype":"image/png"}')$c$, c1, va), 'enviar de novo por cima do arquivo');

  -- cancelar: só quem enviou, com motivo; continua no registro
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_anexo_cancelar(%L, '   ')$c$, an1), 'cancelar anexo sem motivo');
  PERFORM ci.deve_falhar(vb, format($c$SELECT clinica_anexo_cancelar(%L, 'não é meu')$c$, an1), 'outro veterinário cancela o anexo');
  PERFORM ci.deve_falhar(gest, format($c$SELECT clinica_anexo_cancelar(%L, 'gestor')$c$, an1), 'gestor cancela o anexo');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_anexo_cancelar(%L, 'x')$c$, an2), 'cancelar anexo pendente');
  PERFORM ci.entrar(va);
  PERFORM clinica_anexo_cancelar(an1, 'Imagem do paciente errado');
  r := clinica_anexos(ex1, NULL);
  PERFORM ci.sair();
  PERFORM ci.exige(r -> 0 ->> 'situacao' = 'cancelado' AND r -> 0 ->> 'cancelado_motivo' = 'Imagem do paciente errado', 'anexo cancelado fica na lista com o motivo');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_anexo_cancelar(%L, 'de novo')$c$, an1), 'cancelar duas vezes');
  PERFORM ci.exige((SELECT count(*) FROM storage.objects WHERE bucket_id = 'clinica-anexos' AND name = c1) = 1, 'o arquivo do anexo cancelado continua no armazenamento');
  PERFORM ci.deve_falhar_dono(format($c$DELETE FROM pet_exame_anexos WHERE id = %L$c$, an1), 'apagar anexo');
  PERFORM ci.deve_falhar_dono(format($c$UPDATE pet_exame_anexos SET descricao = 'outra' WHERE id = %L$c$, an1), 'mudar a descrição do anexo cancelado');
  PERFORM ci.deve_falhar_dono(format($c$UPDATE pet_exame_anexos SET descricao = 'outra' WHERE id = %L$c$, an2), 'mudar a descrição de anexo pendente');
  PERFORM ci.deve_falhar_dono(format($c$UPDATE pet_exame_anexos SET caminho = 'outro' WHERE id = %L$c$, an2), 'mudar o caminho do anexo');

  -- anexo do atendimento e de exame fechado
  PERFORM ci.entrar(va);
  PERFORM clinica_exame_salvar(ex1, jsonb_build_object('resultados', jsonb_build_array(jsonb_build_object('id', (SELECT (x ->> 'id')::uuid FROM jsonb_array_elements(clinica_exame_get(ex1) -> 'resultados') x WHERE x ->> 'nome' = 'Hemoglobina'), 'valor', '14'))));
  PERFORM clinica_exame_fechar(ex1);
  r := clinica_anexo_preparar(jsonb_build_object('atendimento_id', at1, 'categoria', 'laboratorial', 'descricao', 'Hemograma do laboratório', 'nome_arquivo', 'hemo.pdf', 'mime', 'application/pdf', 'tamanho', 7000));
  an3 := (r ->> 'id')::uuid; c3 := r ->> 'caminho';
  EXECUTE format($c$INSERT INTO storage.objects (bucket_id, name, owner, metadata) VALUES ('clinica-anexos', %L, %L, '{"size":7000,"mimetype":"application/pdf"}')$c$, c3, va);
  PERFORM clinica_anexo_confirmar(an3);
  r := clinica_anexo_preparar(jsonb_build_object('exame_id', ex1, 'categoria', 'laudo', 'descricao', 'Laudo depois de fechar', 'nome_arquivo', 'l.jpg', 'mime', 'image/jpeg', 'tamanho', 300));
  an4 := (r ->> 'id')::uuid; c4 := r ->> 'caminho';
  EXECUTE format($c$INSERT INTO storage.objects (bucket_id, name, owner, metadata) VALUES ('clinica-anexos', %L, %L, '{"size":300,"mimetype":"image/jpeg"}')$c$, c4, va);
  PERFORM clinica_anexo_confirmar(an4);
  PERFORM ci.exige(jsonb_array_length(clinica_anexos(NULL, at1)) = 1, 'o anexo do atendimento aparece na lista do atendimento');
  PERFORM ci.exige(jsonb_array_length(clinica_anexos(ex1, NULL)) = 2, 'exame fechado ainda recebe anexo (imagem cancelada e laudo novo)');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT count(*) FROM pet_exame_resultados WHERE exame_id = ex1 AND valor_num = 14) = 1, 'anexar não altera o resultado do exame fechado');
  PERFORM ci.deve_falhar(va, 'SELECT clinica_anexos(NULL, NULL)', 'lista sem exame nem atendimento');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_anexos(%L, %L)$c$, ex1, at1), 'lista com exame e atendimento juntos');

  -- limite de 20 anexos por exame
  PERFORM ci.entrar(va);
  FOR i IN 1..17 LOOP
    PERFORM clinica_anexo_preparar(jsonb_build_object('exame_id', ex1, 'categoria', 'laudo', 'descricao', 'Enchendo ' || i, 'nome_arquivo', 'e.pdf', 'mime', 'application/pdf', 'tamanho', 10));
  END LOOP;
  PERFORM ci.sair();
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_anexo_preparar(jsonb_build_object('exame_id', %L, 'categoria', 'laudo', 'descricao', 'Passou', 'nome_arquivo', 'e.pdf', 'mime', 'application/pdf', 'tamanho', 10))$c$, ex1), 'mais de 20 anexos no mesmo exame');
  -- pendentes de mais de uma hora não contam no limite (o teste envelhece os registros desligando a trava só nesta linha)
  ALTER TABLE pet_exame_anexos DISABLE TRIGGER trg_clinica_anexo_guarda;
  UPDATE pet_exame_anexos SET created_at = now() - interval '2 hours' WHERE exame_id = ex1 AND situacao = 'pendente' AND descricao LIKE 'Enchendo%';
  ALTER TABLE pet_exame_anexos ENABLE TRIGGER trg_clinica_anexo_guarda;
  PERFORM ci.entrar(va);
  PERFORM clinica_anexo_preparar(jsonb_build_object('exame_id', ex1, 'categoria', 'laudo', 'descricao', 'Cabe de novo', 'nome_arquivo', 'e.pdf', 'mime', 'application/pdf', 'tamanho', 10));
  PERFORM ci.sair();

  -- clínica deixa de estar liberada
  UPDATE empresas SET ramo_atividade = 'petshop', cnae = '4789-0/04', cnae_secundarios = NULL WHERE tenant_id = demo;
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_anexos(%L, NULL)$c$, ex1), 'lista de anexos sem a clínica liberada');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_anexo_abrir(%L)$c$, an3), 'abrir anexo sem a clínica liberada');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_anexo_preparar(jsonb_build_object('exame_id', %L, 'categoria', 'laudo', 'descricao', 'x', 'nome_arquivo', 'e.pdf', 'mime', 'application/pdf', 'tamanho', 10))$c$, ex1), 'preparar anexo sem a clínica liberada');
  PERFORM ci.exige(ci.contar(va, 'SELECT count(*) FROM storage.objects WHERE bucket_id = ''clinica-anexos''') = 0, 'sem a clínica liberada o veterinário não enxerga os arquivos');
  UPDATE empresas SET ramo_atividade = ramo_ant, cnae = cnae_ant, cnae_secundarios = cnae2_ant WHERE tenant_id = demo;
END $$;

-- 50. Clínica (preparar visita, trabalho sem internet): só o veterinário baixa a cópia, só da própria agenda, com auditoria
DO $$
DECLARE
  demo constant uuid := '11111111-1111-1111-1111-111111111111';
  vend constant uuid := 'a0000000-0000-0000-0000-000000000002';
  gest constant uuid := 'a0000000-0000-0000-0000-000000000005';
  gar  constant uuid := 'a0000000-0000-0000-0000-000000000006';
  pban constant uuid := 'a0000000-0000-0000-0000-0000000000e3';
  va   constant uuid := 'a0000000-0000-0000-0000-0000000000fa';
  vb   constant uuid := 'a0000000-0000-0000-0000-0000000000fb';
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  t_hoje timestamptz := date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo' + interval '19 hours';
  ramo_ant text; cnae_ant text; cnae2_ant text;
  tutor uuid; p1 uuid; p2 uuid; p3 uuid; p4 uuid; cons uuid; pva uuid; pvb uuid; ag1 uuid; ag2 uuid; ag3 uuid; ag4 uuid; ag5 uuid; prod uuid; dep uuid; cat uuid;
  r jsonb; n bigint;
BEGIN
  SELECT ramo_atividade, cnae, cnae_secundarios INTO ramo_ant, cnae_ant, cnae2_ant FROM empresas WHERE tenant_id = demo ORDER BY created_at LIMIT 1;
  UPDATE empresas SET ramo_atividade = 'clinica' WHERE tenant_id = demo;
  INSERT INTO clientes (tenant_id, nome, cpf, telefone) VALUES (demo, 'Tutor Visita CI', '52998224725', '(16) 98888-7777') RETURNING id INTO tutor;
  INSERT INTO auth.users (id, email) VALUES (va, 'vetvisa@ci'), (vb, 'vetvisb@ci');
  UPDATE profiles SET tenant_id = demo WHERE id IN (va, vb);
  INSERT INTO user_roles (user_id, tenant_id, role) VALUES (va, demo, 'veterinario'), (vb, demo, 'veterinario');
  INSERT INTO produtos (tenant_id, codigo_interno, descricao, unidade, preco_venda, controla_lote) VALUES (demo, 'VIS-PROD-CI', 'Produto visita CI', 'UN', 0, true) RETURNING id INTO prod;
  SELECT id INTO dep FROM depositos WHERE tenant_id = demo ORDER BY created_at LIMIT 1;

  PERFORM ci.entrar(gest);
  cons := pet_servico_salvar('{"nome":"Consulta Visita CI","categoria":"consulta","duracao_min":30}'::jsonb);
  PERFORM pet_preco_salvar(cons, NULL, NULL, NULL, 150);
  pva := pet_profissional_salvar('{"nome":"Vet A Visita","funcao":"veterinario","crmv":"9991","crmv_uf":"SP"}'::jsonb);
  pvb := pet_profissional_salvar('{"nome":"Vet B Visita","funcao":"veterinario","crmv":"9992","crmv_uf":"RJ"}'::jsonb);
  PERFORM pet_profissional_vincular(pva, va);
  PERFORM pet_profissional_vincular(pvb, vb);
  PERFORM clinica_exame_modelos_iniciais();
  cat := clinica_vacina_catalogo_salvar(jsonb_build_object('nome', 'V10 Visita CI', 'especie', 'cao', 'doses_serie', 3, 'intervalo_serie_dias', 21, 'reforco_dias', 365, 'produto_id', prod));
  PERFORM clinica_vacina_catalogo_salvar(jsonb_build_object('nome', 'Item inativo Visita CI', 'reforco_dias', 30, 'produto_id', prod, 'ativo', false));
  PERFORM ci.sair();
  INSERT INTO estoque_lotes (tenant_id, produto_id, deposito_id, lote, validade, quantidade) VALUES (demo, prod, dep, 'LOTE-VIS-1', hoje + 200, 5), (demo, prod, dep, 'LOTE-VIS-VAZIO', hoje + 200, 0);

  PERFORM ci.entrar(vend);
  p1 := pet_salvar(jsonb_build_object('cliente_id', tutor, 'nome', 'Rex Visita CI', 'especie', 'cao', 'alergias', 'dipirona'));
  p2 := pet_salvar(jsonb_build_object('cliente_id', tutor, 'nome', 'Mimi Visita CI', 'especie', 'gato'));
  p3 := pet_salvar(jsonb_build_object('cliente_id', tutor, 'nome', 'Outro Vet Visita CI', 'especie', 'cao'));
  p4 := pet_salvar(jsonb_build_object('cliente_id', tutor, 'nome', 'Cancelado Visita CI', 'especie', 'cao'));
  ag1 := pet_agendar(jsonb_build_object('pet_id', p1, 'profissional_id', pva, 'inicio', t_hoje, 'servicos', jsonb_build_array(jsonb_build_object('servico_id', cons))));
  ag2 := pet_agendar(jsonb_build_object('pet_id', p2, 'profissional_id', pva, 'inicio', t_hoje + interval '1 hour', 'servicos', jsonb_build_array(jsonb_build_object('servico_id', cons))));
  ag3 := pet_agendar(jsonb_build_object('pet_id', p3, 'profissional_id', pvb, 'inicio', t_hoje, 'servicos', jsonb_build_array(jsonb_build_object('servico_id', cons))));
  ag4 := pet_agendar(jsonb_build_object('pet_id', p4, 'profissional_id', pva, 'inicio', t_hoje + interval '2 hours', 'servicos', jsonb_build_array(jsonb_build_object('servico_id', cons))));
  ag5 := pet_agendar(jsonb_build_object('pet_id', p1, 'profissional_id', pva, 'inicio', t_hoje + interval '3 days', 'servicos', jsonb_build_array(jsonb_build_object('servico_id', cons))));
  PERFORM pet_agenda_situacao(ag4, 'cancelado', 'tutor desistiu');
  PERFORM ci.sair();

  -- só o veterinário baixa a cópia
  PERFORM ci.deve_falhar(gest, 'SELECT clinica_visita_preparar()', 'gestor baixa a cópia da visita');
  PERFORM ci.deve_falhar(vend, 'SELECT clinica_visita_preparar()', 'recepção baixa a cópia da visita');
  PERFORM ci.deve_falhar(gar, 'SELECT clinica_visita_preparar()', 'garçom baixa a cópia da visita');
  PERFORM ci.deve_falhar(pban, 'SELECT clinica_visita_preparar()', 'profissional de banho baixa a cópia da visita');
  PERFORM ci.deve_falhar(va, 'SELECT clinica_visita_preparar(0)', 'zero dias de agenda');
  PERFORM ci.deve_falhar(va, 'SELECT clinica_visita_preparar(8)', 'mais de 7 dias de agenda');
  PERFORM ci.deve_falhar(va, 'SELECT clinica_visita_preparar(NULL)', 'dias em branco');

  SELECT count(*) INTO n FROM clinica_acessos WHERE tenant_id = demo AND acao = 'visita';
  PERFORM ci.entrar(va);
  r := clinica_visita_preparar();
  PERFORM ci.sair();
  PERFORM ci.exige(r -> 'veterinario' ->> 'crmv' = '9991' AND r -> 'veterinario' ->> 'nome' = 'Vet A Visita', 'a cópia traz o veterinário e o CRMV');
  PERFORM ci.exige(jsonb_array_length(r -> 'agenda') = 2 AND r -> 'agenda' -> 0 -> 'pet' ->> 'nome' = 'Rex Visita CI' AND r -> 'agenda' -> 1 -> 'pet' ->> 'nome' = 'Mimi Visita CI',
                   'a agenda de hoje traz só as consultas do veterinário, em ordem, sem cancelada e sem as de outro dia');
  PERFORM ci.exige(r -> 'agenda' -> 0 -> 'tutor' ->> 'telefone' = '(16) 98888-7777' AND r -> 'agenda' -> 0 -> 'pet' ->> 'alergias' = 'dipirona'
                   AND r -> 'agenda' -> 0 -> 'servicos' -> 0 ->> 'categoria' = 'consulta', 'a cópia traz tutor, telefone, alergia e serviço');
  PERFORM ci.exige(r::text NOT LIKE '%Outro Vet Visita CI%' AND r::text NOT LIKE '%Cancelado Visita CI%', 'a cópia não traz paciente de outro veterinário nem de consulta cancelada');
  PERFORM ci.exige(r::text NOT LIKE '%queixa%' AND r::text NOT LIKE '%diagnostico%', 'a cópia não traz texto de prontuário');
  PERFORM ci.exige(EXISTS (SELECT 1 FROM jsonb_array_elements(r -> 'catalogo_vacinas') i WHERE i ->> 'nome' = 'V10 Visita CI' AND jsonb_array_length(i -> 'lotes') = 1 AND i -> 'lotes' -> 0 ->> 'lote' = 'LOTE-VIS-1'),
                   'o catálogo traz os lotes com saldo (sem o lote zerado)');
  PERFORM ci.exige(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r -> 'catalogo_vacinas') i WHERE i ->> 'nome' = 'Item inativo Visita CI'), 'item inativo do catálogo não vai na cópia');
  PERFORM ci.exige(EXISTS (SELECT 1 FROM jsonb_array_elements(r -> 'modelos_exame') m WHERE m ->> 'nome' = 'Hemograma' AND jsonb_array_length(m -> 'campos') = 26), 'a cópia traz os modelos de exame com os campos');
  PERFORM ci.exige(jsonb_array_length(r -> 'aplicadores') >= 2, 'a cópia traz os aplicadores');
  PERFORM ci.exige((SELECT count(*) FROM clinica_acessos WHERE tenant_id = demo AND acao = 'visita') = n + 2 AND (SELECT count(DISTINCT pet_id) FROM clinica_acessos WHERE tenant_id = demo AND acao = 'visita' AND profile_id = va AND pet_id IN (p1, p2)) = 2,
                   'baixar a cópia registra um acesso por paciente da agenda, com quem baixou');

  PERFORM ci.entrar(va);
  r := clinica_visita_preparar(7);
  PERFORM ci.sair();
  PERFORM ci.exige(jsonb_array_length(r -> 'agenda') = 3 AND r ->> 'ate' = (hoje + 6)::text, 'com 7 dias entra também a consulta de daqui a 3 dias');
  PERFORM ci.entrar(vb);
  r := clinica_visita_preparar();
  PERFORM ci.sair();
  PERFORM ci.exige(jsonb_array_length(r -> 'agenda') = 1 AND r -> 'agenda' -> 0 -> 'pet' ->> 'nome' = 'Outro Vet Visita CI', 'cada veterinário baixa só a própria agenda');

  -- clínica deixa de estar liberada
  UPDATE empresas SET ramo_atividade = 'petshop', cnae = '4789-0/04', cnae_secundarios = NULL WHERE tenant_id = demo;
  PERFORM ci.deve_falhar(va, 'SELECT clinica_visita_preparar()', 'preparar visita sem a clínica liberada');
  UPDATE empresas SET ramo_atividade = ramo_ant, cnae = cnae_ant, cnae_secundarios = cnae2_ant WHERE tenant_id = demo;
END $$;

-- 51. Clínica (cadastro rápido, trabalho sem internet): só o veterinário; ids nascidos no notebook; reenvio não duplica; duplicado é marcado
DO $$
DECLARE
  demo constant uuid := '11111111-1111-1111-1111-111111111111';
  novo constant uuid := 'a0000000-0000-0000-0000-000000000004';
  vend constant uuid := 'a0000000-0000-0000-0000-000000000002';
  gest constant uuid := 'a0000000-0000-0000-0000-000000000005';
  gar  constant uuid := 'a0000000-0000-0000-0000-000000000006';
  pban constant uuid := 'a0000000-0000-0000-0000-0000000000e3';
  va   constant uuid := 'a0000000-0000-0000-0000-0000000000fc';
  ramo_ant text; cnae_ant text; cnae2_ant text; t_novo uuid; emp_novo uuid;
  k1 uuid := gen_random_uuid(); k2 uuid := gen_random_uuid(); k3 uuid := gen_random_uuid(); k4 uuid := gen_random_uuid();
  c1 uuid := gen_random_uuid(); p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid(); c3 uuid := gen_random_uuid(); p3 uuid := gen_random_uuid();
  c4 uuid := gen_random_uuid(); p4 uuid := gen_random_uuid();
  existente uuid; r jsonb; r2 jsonb; n_cli bigint; n_pet bigint; n_reg bigint;
BEGIN
  SELECT ramo_atividade, cnae, cnae_secundarios INTO ramo_ant, cnae_ant, cnae2_ant FROM empresas WHERE tenant_id = demo ORDER BY created_at LIMIT 1;
  UPDATE empresas SET ramo_atividade = 'clinica' WHERE tenant_id = demo;
  INSERT INTO auth.users (id, email) VALUES (va, 'vetcad@ci');
  UPDATE profiles SET tenant_id = demo WHERE id = va;
  INSERT INTO user_roles (user_id, tenant_id, role) VALUES (va, demo, 'veterinario');
  INSERT INTO clientes (tenant_id, nome, telefone) VALUES (demo, 'Tutor Antigo Cadastro CI', '(16) 97777-6666') RETURNING id INTO existente;
  PERFORM ci.entrar(gest);
  PERFORM pet_profissional_vincular(pet_profissional_salvar('{"nome":"Vet Cadastro CI","funcao":"veterinario","crmv":"5551","crmv_uf":"SP"}'::jsonb), va);
  PERFORM ci.sair();

  -- só o veterinário usa o cadastro rápido
  PERFORM ci.deve_falhar(gest, format($c$SELECT clinica_cadastro_rapido(%L, '{"cliente":{"id":"%s","nome":"X Y"},"pet":{"id":"%s","nome":"P"}}'::jsonb)$c$, gen_random_uuid(), gen_random_uuid(), gen_random_uuid()), 'gestor usa o cadastro rápido da clínica');
  PERFORM ci.deve_falhar(vend, format($c$SELECT clinica_cadastro_rapido(%L, '{"cliente":{"id":"%s","nome":"X Y"},"pet":{"id":"%s","nome":"P"}}'::jsonb)$c$, gen_random_uuid(), gen_random_uuid(), gen_random_uuid()), 'recepção usa o cadastro rápido da clínica');
  PERFORM ci.deve_falhar(gar, format($c$SELECT clinica_cadastro_rapido(%L, '{"cliente":{"id":"%s","nome":"X Y"},"pet":{"id":"%s","nome":"P"}}'::jsonb)$c$, gen_random_uuid(), gen_random_uuid(), gen_random_uuid()), 'garçom usa o cadastro rápido da clínica');
  PERFORM ci.deve_falhar(pban, format($c$SELECT clinica_cadastro_rapido(%L, '{"cliente":{"id":"%s","nome":"X Y"},"pet":{"id":"%s","nome":"P"}}'::jsonb)$c$, gen_random_uuid(), gen_random_uuid(), gen_random_uuid()), 'profissional de banho usa o cadastro rápido da clínica');
  PERFORM ci.deve_falhar(va, 'SELECT count(*) FROM clinica_cadastros_rapidos', 'leitura direta do registro dos cadastros rápidos');

  -- tutor e pet novos, com os ids nascidos no notebook
  PERFORM ci.entrar(va);
  r := clinica_cadastro_rapido(k1, jsonb_build_object('cliente', jsonb_build_object('id', c1, 'nome', 'Maria da Fazenda CI', 'telefone', '(16) 98888-1111'),
         'pet', jsonb_build_object('id', p1, 'nome', 'Toby Fazenda CI', 'especie', 'cao', 'raca', 'SRD', 'sexo', 'macho', 'porte', 'medio',
                                   'nascimento', '2023-03-10', 'peso_kg', '12,5', 'castrado', true, 'alergias', 'frango')));
  PERFORM ci.sair();
  PERFORM ci.exige(r ->> 'cliente_id' = c1::text AND r ->> 'pet_id' = p1::text AND (r ->> 'repetido')::boolean = false AND r -> 'possivel_duplicado_de' = 'null'::jsonb,
                   'o cadastro usa os ids do notebook e não tem duplicado');
  PERFORM ci.exige((SELECT nome = 'Maria da Fazenda CI' AND telefone = '(16) 98888-1111' AND whatsapp = '(16) 98888-1111' AND observacoes LIKE 'Cadastro rápido da clínica%' AND observacoes NOT LIKE '%duplicado%'
                      FROM clientes WHERE id = c1 AND tenant_id = demo), 'tutor criado com nome, telefone e a marca de cadastro rápido');
  PERFORM ci.exige((SELECT nome = 'Toby Fazenda CI' AND especie = 'cao' AND peso_kg = 12.5 AND castrado AND alergias = 'frango' AND cliente_id = c1 AND ativo
                      FROM pets WHERE id = p1 AND tenant_id = demo), 'pet criado com os dados e ligado ao tutor');
  PERFORM ci.exige(ci.contar(va, format($c$SELECT count(*) FROM jsonb_array_elements(clinica_pacientes('Toby Fazenda')) x WHERE x ->> 'id' = %L$c$, p1)) = 1, 'o pet novo aparece na busca de pacientes do veterinário');

  -- reenvio da mesma chave: devolve o mesmo e não duplica
  SELECT count(*) INTO n_cli FROM clientes WHERE tenant_id = demo;
  SELECT count(*) INTO n_pet FROM pets WHERE tenant_id = demo;
  SELECT count(*) INTO n_reg FROM clinica_cadastros_rapidos WHERE tenant_id = demo;
  PERFORM ci.entrar(va);
  r2 := clinica_cadastro_rapido(k1, jsonb_build_object('cliente', jsonb_build_object('id', c1, 'nome', 'Maria da Fazenda CI'), 'pet', jsonb_build_object('id', p1, 'nome', 'Toby Fazenda CI')));
  PERFORM ci.sair();
  PERFORM ci.exige(r2 ->> 'cliente_id' = c1::text AND r2 ->> 'pet_id' = p1::text AND (r2 ->> 'repetido')::boolean, 'reenviar a mesma chave devolve o mesmo resultado');
  PERFORM ci.exige((SELECT count(*) FROM clientes WHERE tenant_id = demo) = n_cli AND (SELECT count(*) FROM pets WHERE tenant_id = demo) = n_pet
               AND (SELECT count(*) FROM clinica_cadastros_rapidos WHERE tenant_id = demo) = n_reg, 'o reenvio não cria tutor, pet nem registro de novo');

  -- outro pet para o tutor que já existe
  PERFORM ci.entrar(va);
  r := clinica_cadastro_rapido(k2, jsonb_build_object('cliente_id', c1, 'pet', jsonb_build_object('id', p2, 'nome', 'Mimi Fazenda CI', 'especie', 'gato')));
  PERFORM ci.sair();
  PERFORM ci.exige(r ->> 'cliente_id' = c1::text AND (SELECT cliente_id = c1 AND especie = 'gato' FROM pets WHERE id = p2), 'segundo pet para o mesmo tutor');
  PERFORM ci.exige((SELECT count(*) FROM clientes WHERE tenant_id = demo) = n_cli, 'o segundo pet não cria outro tutor');

  -- mesmo telefone de um cadastro existente: cria e marca para a recepção unir
  PERFORM ci.entrar(va);
  r := clinica_cadastro_rapido(k3, jsonb_build_object('cliente', jsonb_build_object('id', c3, 'nome', 'Tutor Novo Mesmo Fone CI', 'telefone', '16 97777 6666'),
         'pet', jsonb_build_object('id', p3, 'nome', 'Bidu CI')));
  PERFORM ci.sair();
  PERFORM ci.exige(r ->> 'possivel_duplicado_de' = existente::text, 'o telefone igual aponta o cadastro existente');
  PERFORM ci.exige((SELECT observacoes LIKE '%Possível duplicado do cadastro "Tutor Antigo Cadastro CI"%' FROM clientes WHERE id = c3), 'a marca de duplicado fica nas observações do cadastro novo, para a recepção');
  PERFORM ci.exige((SELECT nome = 'Tutor Antigo Cadastro CI' AND observacoes IS NULL AND ativo FROM clientes WHERE id = existente), 'o cadastro antigo não é alterado');
  PERFORM ci.exige((SELECT possivel_duplicado_de = existente FROM clinica_cadastros_rapidos WHERE chave = k3), 'o registro guarda o possível duplicado');

  -- o mesmo telefone com o código do país (+55) também é duplicado, nos dois sentidos
  UPDATE clientes SET created_at = now() - interval '2 days' WHERE id = existente;  -- o cadastro antigo é o mais antigo de verdade (o teste roda numa transação só)
  PERFORM ci.entrar(va);
  r := clinica_cadastro_rapido(k4, jsonb_build_object('cliente', jsonb_build_object('id', c4, 'nome', 'Tutor Com Codigo Pais CI', 'telefone', '+55 (16) 97777-6666'),
         'pet', jsonb_build_object('id', p4, 'nome', 'Fido CI')));
  PERFORM ci.sair();
  PERFORM ci.exige(r ->> 'possivel_duplicado_de' = existente::text, 'telefone com +55 é reconhecido como o mesmo número');
  PERFORM ci.exige(public._fone_normalizado('+55 (16) 98888-1111') = '16988881111' AND public._fone_normalizado('(16) 98888-1111') = '16988881111'
               AND public._fone_normalizado('55 16 3333-4444') = '1633334444' AND public._fone_normalizado('5511') = '5511' AND public._fone_normalizado(NULL) = '',
               'a normalização tira só o 55 do país');
  UPDATE clientes SET telefone = '+55 16 95555-4444' WHERE id = existente;
  PERFORM ci.entrar(va);
  r := clinica_cadastro_rapido(gen_random_uuid(), jsonb_build_object('cliente', jsonb_build_object('id', gen_random_uuid(), 'nome', 'Tutor Sem Codigo Pais CI', 'telefone', '(16) 95555-4444'),
         'pet', jsonb_build_object('id', gen_random_uuid(), 'nome', 'Rex2 CI')));
  PERFORM ci.sair();
  PERFORM ci.exige(r ->> 'possivel_duplicado_de' = existente::text, 'cadastro antigo com +55 e telefone novo sem o código também casam');

  -- regras
  PERFORM ci.deve_falhar(va, 'SELECT clinica_cadastro_rapido(NULL, ''{}''::jsonb)', 'cadastro sem chave de repetição');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_cadastro_rapido(%L, '{"cliente":{"id":"%s","nome":"Fulano Tal"}}'::jsonb)$c$, gen_random_uuid(), gen_random_uuid()), 'cadastro sem pet');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_cadastro_rapido(%L, jsonb_build_object('cliente', jsonb_build_object('id', %L, 'nome', 'Fulano Tal'), 'pet', jsonb_build_object('id', %L, 'nome', 'Vaca', 'especie', 'outro')))$c$, gen_random_uuid(), gen_random_uuid(), gen_random_uuid()), 'espécie fora de cão e gato');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_cadastro_rapido(%L, jsonb_build_object('cliente', jsonb_build_object('id', %L, 'nome', 'Fulano Tal'), 'pet', jsonb_build_object('id', %L, 'nome', '  ')))$c$, gen_random_uuid(), gen_random_uuid(), gen_random_uuid()), 'pet sem nome');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_cadastro_rapido(%L, jsonb_build_object('cliente', jsonb_build_object('id', %L, 'nome', 'F'), 'pet', jsonb_build_object('id', %L, 'nome', 'Rex')))$c$, gen_random_uuid(), gen_random_uuid(), gen_random_uuid()), 'tutor com nome curto demais');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_cadastro_rapido(%L, jsonb_build_object('cliente', jsonb_build_object('id', %L, 'nome', 'Fulano Tal', 'telefone', '12345'), 'pet', jsonb_build_object('id', %L, 'nome', 'Rex')))$c$, gen_random_uuid(), gen_random_uuid(), gen_random_uuid()), 'telefone sem DDD');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_cadastro_rapido(%L, jsonb_build_object('cliente', jsonb_build_object('id', %L, 'nome', 'Fulano Tal'), 'pet', jsonb_build_object('id', %L, 'nome', 'Rex', 'peso_kg', '-3')))$c$, gen_random_uuid(), gen_random_uuid(), gen_random_uuid()), 'peso negativo');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_cadastro_rapido(%L, jsonb_build_object('cliente', jsonb_build_object('id', %L, 'nome', 'Fulano Tal'), 'pet', jsonb_build_object('id', %L, 'nome', 'Rex', 'sexo', 'indefinido')))$c$, gen_random_uuid(), gen_random_uuid(), gen_random_uuid()), 'sexo inválido');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_cadastro_rapido(%L, jsonb_build_object('cliente', jsonb_build_object('id', %L, 'nome', 'Fulano Tal'), 'pet', jsonb_build_object('id', %L, 'nome', 'Rex', 'nascimento', current_date + 5)))$c$, gen_random_uuid(), gen_random_uuid(), gen_random_uuid()), 'nascimento no futuro');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_cadastro_rapido(%L, jsonb_build_object('cliente', jsonb_build_object('id', %L, 'nome', 'Fulano Tal'), 'pet', jsonb_build_object('id', %L, 'nome', 'Rex', 'castrado', 'talvez')))$c$, gen_random_uuid(), gen_random_uuid(), gen_random_uuid()), 'castrado que não é sim ou não');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_cadastro_rapido(%L, jsonb_build_object('cliente_id', %L, 'pet', jsonb_build_object('id', %L, 'nome', 'Rex')))$c$, gen_random_uuid(), gen_random_uuid(), gen_random_uuid()), 'tutor que não existe');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_cadastro_rapido(%L, jsonb_build_object('cliente_id', %L, 'cliente', jsonb_build_object('id', %L, 'nome', 'Fulano Tal'), 'pet', jsonb_build_object('id', %L, 'nome', 'Rex')))$c$, gen_random_uuid(), c1, gen_random_uuid(), gen_random_uuid()), 'tutor existente e tutor novo ao mesmo tempo');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_cadastro_rapido(%L, jsonb_build_object('cliente', jsonb_build_object('id', %L, 'nome', 'Fulano Tal'), 'pet', jsonb_build_object('id', %L, 'nome', 'Rex')))$c$, gen_random_uuid(), c1, gen_random_uuid()), 'identificador de tutor já usado por outra chave');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_cadastro_rapido(%L, jsonb_build_object('cliente', jsonb_build_object('id', %L, 'nome', 'Fulano Tal'), 'pet', jsonb_build_object('id', %L, 'nome', 'Rex')))$c$, gen_random_uuid(), gen_random_uuid(), p1), 'identificador de pet já usado por outra chave');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_cadastro_rapido(%L, jsonb_build_object('cliente', jsonb_build_object('id', %L, 'nome', 'Fulano Tal'), 'pet', jsonb_build_object('id', %L, 'nome', 'Rex')))$c$, gen_random_uuid(), 'não-é-uuid', gen_random_uuid()), 'identificador que não é UUID');
  PERFORM ci.exige((SELECT count(*) FROM clientes WHERE tenant_id = demo AND nome = 'Fulano Tal') = 0, 'cadastro recusado não deixa tutor para trás');

  -- outra empresa não usa tutor nem chave alheios
  SELECT tenant_id INTO t_novo FROM profiles WHERE id = novo;
  INSERT INTO empresas (tenant_id, razao_social, ramo_atividade) VALUES (t_novo, 'Outra clínica cadastro CI', 'clinica') RETURNING id INTO emp_novo;
  PERFORM ci.deve_falhar(novo, format($c$SELECT clinica_cadastro_rapido(%L, jsonb_build_object('cliente_id', %L, 'pet', jsonb_build_object('id', %L, 'nome', 'Rex')))$c$, gen_random_uuid(), c1, gen_random_uuid()), 'perfil sem veterinário em outra empresa');
  DELETE FROM empresas WHERE id = emp_novo;

  -- clínica deixa de estar liberada
  UPDATE empresas SET ramo_atividade = 'petshop', cnae = '4789-0/04', cnae_secundarios = NULL WHERE tenant_id = demo;
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_cadastro_rapido(%L, jsonb_build_object('cliente_id', %L, 'pet', jsonb_build_object('id', %L, 'nome', 'Rex')))$c$, gen_random_uuid(), c1, gen_random_uuid()), 'cadastro rápido sem a clínica liberada');
  UPDATE empresas SET ramo_atividade = ramo_ant, cnae = cnae_ant, cnae_secundarios = cnae2_ant WHERE tenant_id = demo;
END $$;

-- 52. Clínica (atendimento sem internet): visita avulsa e consulta marcada com o id do notebook; salvar e fechar aceitam repetição
DO $$
DECLARE
  demo constant uuid := '11111111-1111-1111-1111-111111111111';
  vend constant uuid := 'a0000000-0000-0000-0000-000000000002';
  gest constant uuid := 'a0000000-0000-0000-0000-000000000005';
  gar  constant uuid := 'a0000000-0000-0000-0000-000000000006';
  pban constant uuid := 'a0000000-0000-0000-0000-0000000000e3';
  va   constant uuid := 'a0000000-0000-0000-0000-0000000000fd';
  vb   constant uuid := 'a0000000-0000-0000-0000-0000000000fe';
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  t0 timestamptz := date_trunc('day', now()) + interval '20 days' + interval '9 hours';
  ramo_ant text; cnae_ant text; cnae2_ant text;
  tutor uuid; pet1 uuid; pet2 uuid; pet3 uuid; pet4 uuid; cons uuid; cons_sempreco uuid; banho uuid; pva uuid; pvb uuid;
  ag_cons uuid; ag_banho uuid; ag_canc uuid; ag_outro uuid; ag_novo uuid;
  k1 uuid := gen_random_uuid(); k2 uuid := gen_random_uuid(); k3 uuid := gen_random_uuid(); k4 uuid := gen_random_uuid();
  a1 uuid := gen_random_uuid(); a2 uuid := gen_random_uuid(); a3 uuid := gen_random_uuid();
  r jsonb; r2 jsonb; n bigint; agv uuid;
BEGIN
  SELECT ramo_atividade, cnae, cnae_secundarios INTO ramo_ant, cnae_ant, cnae2_ant FROM empresas WHERE tenant_id = demo ORDER BY created_at LIMIT 1;
  UPDATE empresas SET ramo_atividade = 'clinica' WHERE tenant_id = demo;
  INSERT INTO clientes (tenant_id, nome, cpf) VALUES (demo, 'Tutor Atendimento Offline CI', '52998224725') RETURNING id INTO tutor;
  INSERT INTO auth.users (id, email) VALUES (va, 'vetoffa@ci'), (vb, 'vetoffb@ci');
  UPDATE profiles SET tenant_id = demo WHERE id IN (va, vb);
  INSERT INTO user_roles (user_id, tenant_id, role) VALUES (va, demo, 'veterinario'), (vb, demo, 'veterinario');

  PERFORM ci.entrar(gest);
  cons := pet_servico_salvar('{"nome":"Consulta Offline CI","categoria":"consulta","duracao_min":40}'::jsonb);
  cons_sempreco := pet_servico_salvar('{"nome":"Consulta Sem Preco Offline CI","categoria":"consulta","duracao_min":30}'::jsonb);
  banho := pet_servico_salvar('{"nome":"Banho Offline CI","categoria":"banho","duracao_min":30}'::jsonb);
  PERFORM pet_preco_salvar(cons, NULL, NULL, NULL, 150);
  PERFORM pet_preco_salvar(banho, NULL, NULL, NULL, 60);
  pva := pet_profissional_salvar('{"nome":"Vet A Offline","funcao":"veterinario","crmv":"6661","crmv_uf":"SP"}'::jsonb);
  pvb := pet_profissional_salvar('{"nome":"Vet B Offline","funcao":"veterinario","crmv":"6662","crmv_uf":"RJ"}'::jsonb);
  PERFORM pet_profissional_vincular(pva, va);
  PERFORM pet_profissional_vincular(pvb, vb);
  PERFORM ci.sair();

  PERFORM ci.entrar(vend);
  pet1 := pet_salvar(jsonb_build_object('cliente_id', tutor, 'nome', 'Visita Avulsa CI', 'especie', 'cao'));
  pet2 := pet_salvar(jsonb_build_object('cliente_id', tutor, 'nome', 'Consulta Marcada CI', 'especie', 'gato'));
  pet3 := pet_salvar(jsonb_build_object('cliente_id', tutor, 'nome', 'Outro Vet Offline CI', 'especie', 'cao'));
  pet4 := pet_salvar(jsonb_build_object('cliente_id', tutor, 'nome', 'Banho Offline CI', 'especie', 'cao'));
  ag_cons := pet_agendar(jsonb_build_object('pet_id', pet2, 'profissional_id', pva, 'inicio', t0, 'servicos', jsonb_build_array(jsonb_build_object('servico_id', cons))));
  ag_banho := pet_agendar(jsonb_build_object('pet_id', pet4, 'profissional_id', pva, 'inicio', t0 + interval '2 hours', 'servicos', jsonb_build_array(jsonb_build_object('servico_id', banho))));
  ag_canc := pet_agendar(jsonb_build_object('pet_id', pet1, 'profissional_id', pva, 'inicio', t0 + interval '4 hours', 'servicos', jsonb_build_array(jsonb_build_object('servico_id', cons))));
  PERFORM pet_agenda_situacao(ag_canc, 'cancelado', 'tutor desistiu');
  ag_outro := pet_agendar(jsonb_build_object('pet_id', pet3, 'profissional_id', pvb, 'inicio', t0 + interval '5 hours', 'servicos', jsonb_build_array(jsonb_build_object('servico_id', cons))));
  PERFORM ci.sair();

  -- só o veterinário usa as duas funções
  PERFORM ci.deve_falhar(gest, format($c$SELECT clinica_visita_registrar(%L, jsonb_build_object('atendimento_id', %L, 'pet_id', %L, 'servico_id', %L))$c$, gen_random_uuid(), gen_random_uuid(), pet1, cons), 'gestor registra visita');
  PERFORM ci.deve_falhar(vend, format($c$SELECT clinica_visita_registrar(%L, jsonb_build_object('atendimento_id', %L, 'pet_id', %L, 'servico_id', %L))$c$, gen_random_uuid(), gen_random_uuid(), pet1, cons), 'recepção registra visita');
  PERFORM ci.deve_falhar(gar, format($c$SELECT clinica_visita_registrar(%L, jsonb_build_object('atendimento_id', %L, 'pet_id', %L, 'servico_id', %L))$c$, gen_random_uuid(), gen_random_uuid(), pet1, cons), 'garçom registra visita');
  PERFORM ci.deve_falhar(pban, format($c$SELECT clinica_atendimento_offline(%L, 'salvar', %L, '{}'::jsonb)$c$, gen_random_uuid(), a1), 'profissional de banho preenche atendimento');
  PERFORM ci.deve_falhar(gest, format($c$SELECT clinica_atendimento_offline(%L, 'salvar', %L, '{}'::jsonb)$c$, gen_random_uuid(), a1), 'gestor preenche atendimento');

  -- a cópia da visita passa a levar os serviços de consulta
  PERFORM ci.entrar(va);
  r := clinica_visita_preparar();
  PERFORM ci.sair();
  PERFORM ci.exige(EXISTS (SELECT 1 FROM jsonb_array_elements(r -> 'servicos_consulta') x WHERE x ->> 'id' = cons::text AND x ->> 'nome' = 'Consulta Offline CI')
               AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r -> 'servicos_consulta') x WHERE x ->> 'id' = banho::text), 'a cópia da visita traz os serviços de consulta (e só eles)');

  -- visita avulsa: cria a consulta (já em atendimento) e o atendimento, com o id do notebook
  PERFORM ci.entrar(va);
  r := clinica_visita_registrar(k1, jsonb_build_object('atendimento_id', a1, 'pet_id', pet1, 'servico_id', cons, 'aberto_em', now() - interval '3 hours'));
  PERFORM ci.sair();
  agv := (r ->> 'agendamento_id')::uuid;
  PERFORM ci.exige(r ->> 'atendimento_id' = a1::text AND r ->> 'modo' = 'visita_avulsa' AND (r ->> 'repetido')::boolean = false, 'a visita avulsa usa o id do atendimento nascido no notebook');
  PERFORM ci.exige((SELECT situacao = 'em_atendimento' AND profissional_id = pva AND pet_id = pet1 AND fim - inicio = interval '40 minutes' AND observacoes LIKE 'Visita registrada pela clínica%'
                      FROM pet_agendamentos WHERE id = agv), 'a consulta da visita nasce em atendimento, com a duração do serviço');
  PERFORM ci.exige((SELECT preco_aplicado = 150 AND servico_id = cons FROM pet_agendamento_itens WHERE agendamento_id = agv), 'o preço da consulta fica congelado como a agenda calcularia');
  PERFORM ci.exige((SELECT veterinario_id = pva AND crmv = '6661' AND agendamento_id = agv AND situacao = 'aberto' AND aberto_em < now() - interval '2 hours' FROM pet_atendimentos_clinicos WHERE id = a1),
                   'o atendimento guarda o veterinário, o CRMV e a hora em que foi aberto no notebook');
  PERFORM ci.exige((SELECT count(*) FROM clinica_acessos WHERE atendimento_id = a1 AND acao = 'atendimento' AND profile_id = va) = 1, 'abrir a visita fica na auditoria');

  -- reenvio da mesma chave: devolve o mesmo e não duplica
  SELECT count(*) INTO n FROM pet_agendamentos WHERE tenant_id = demo;
  PERFORM ci.entrar(va);
  r2 := clinica_visita_registrar(k1, jsonb_build_object('atendimento_id', a1, 'pet_id', pet1, 'servico_id', cons));
  PERFORM ci.sair();
  PERFORM ci.exige(r2 ->> 'agendamento_id' = agv::text AND (r2 ->> 'repetido')::boolean, 'reenviar a mesma chave devolve a mesma visita');
  PERFORM ci.exige((SELECT count(*) FROM pet_agendamentos WHERE tenant_id = demo) = n AND (SELECT count(*) FROM pet_atendimentos_clinicos WHERE pet_id = pet1) = 1, 'o reenvio não cria consulta nem atendimento');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_visita_registrar(%L, jsonb_build_object('atendimento_id', %L, 'pet_id', %L, 'servico_id', %L))$c$, gen_random_uuid(), a1, pet1, cons), 'identificador do atendimento já usado por outra chave');
  PERFORM ci.deve_falhar(vb, format($c$SELECT clinica_visita_registrar(%L, jsonb_build_object('atendimento_id', %L, 'pet_id', %L, 'servico_id', %L))$c$, k1, gen_random_uuid(), pet1, cons), 'chave de repetição de outro veterinário');
  PERFORM ci.deve_falhar(vb, format($c$SELECT clinica_atendimento_offline(%L, 'fechar', %L)$c$, k1, a1), 'chave de uma operação usada em outro tipo');

  -- regras da visita avulsa
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_visita_registrar(%L, jsonb_build_object('atendimento_id', %L, 'pet_id', %L, 'servico_id', %L))$c$, gen_random_uuid(), gen_random_uuid(), pet3, banho), 'serviço que não é de consulta');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_visita_registrar(%L, jsonb_build_object('atendimento_id', %L, 'pet_id', %L, 'servico_id', %L))$c$, gen_random_uuid(), gen_random_uuid(), pet3, cons_sempreco), 'consulta sem preço cadastrado');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_visita_registrar(%L, jsonb_build_object('atendimento_id', %L, 'pet_id', %L, 'servico_id', %L, 'aberto_em', now() + interval '1 hour'))$c$, gen_random_uuid(), gen_random_uuid(), pet3, cons), 'hora do atendimento no futuro');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_visita_registrar(%L, jsonb_build_object('atendimento_id', %L, 'pet_id', %L, 'servico_id', %L, 'aberto_em', now() - interval '40 days'))$c$, gen_random_uuid(), gen_random_uuid(), pet3, cons), 'hora do atendimento de mais de 30 dias atrás');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_visita_registrar(%L, jsonb_build_object('atendimento_id', %L, 'pet_id', %L))$c$, gen_random_uuid(), gen_random_uuid(), pet3), 'sem consulta marcada nem serviço');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_visita_registrar(%L, jsonb_build_object('atendimento_id', %L, 'pet_id', %L, 'servico_id', %L, 'agendamento_id', %L))$c$, gen_random_uuid(), gen_random_uuid(), pet2, cons, ag_cons), 'consulta marcada e serviço ao mesmo tempo');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_visita_registrar(%L, jsonb_build_object('atendimento_id', %L, 'pet_id', %L, 'servico_id', %L))$c$, gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), cons), 'paciente que não existe');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_visita_registrar(%L, jsonb_build_object('atendimento_id', 'não-é-uuid', 'pet_id', %L, 'servico_id', %L))$c$, gen_random_uuid(), pet3, cons), 'identificador que não é UUID');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_visita_registrar(NULL, jsonb_build_object('atendimento_id', %L, 'pet_id', %L, 'servico_id', %L))$c$, gen_random_uuid(), pet3, cons), 'visita sem chave de repetição');
  PERFORM ci.exige((SELECT count(*) FROM pet_agendamentos WHERE tenant_id = demo AND pet_id = pet3 AND observacoes LIKE 'Visita registrada%') = 0, 'visita recusada não deixa consulta para trás');

  -- a visita avulsa não passa pela regra de horário livre: o atendimento já aconteceu (o veterinário B já tem consulta a partir de t0 + 5h)
  PERFORM ci.entrar(vb);
  r := clinica_visita_registrar(gen_random_uuid(), jsonb_build_object('atendimento_id', gen_random_uuid(), 'pet_id', pet3, 'servico_id', cons, 'aberto_em', now() - interval '1 hour'));
  PERFORM ci.sair();
  PERFORM ci.exige(r ->> 'modo' = 'visita_avulsa', 'visita avulsa de quem já tem outra consulta marcada no mesmo período');

  -- consulta já marcada na agenda do veterinário abre com o id do notebook
  PERFORM ci.deve_falhar(vb, format($c$SELECT clinica_visita_registrar(%L, jsonb_build_object('atendimento_id', %L, 'pet_id', %L, 'agendamento_id', %L))$c$, gen_random_uuid(), gen_random_uuid(), pet2, ag_cons), 'consulta marcada de outro veterinário');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_visita_registrar(%L, jsonb_build_object('atendimento_id', %L, 'pet_id', %L, 'agendamento_id', %L))$c$, gen_random_uuid(), gen_random_uuid(), pet2, ag_banho), 'agendamento sem serviço de consulta (ou de outro paciente)');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_visita_registrar(%L, jsonb_build_object('atendimento_id', %L, 'pet_id', %L, 'agendamento_id', %L))$c$, gen_random_uuid(), gen_random_uuid(), pet4, ag_banho), 'agendamento de banho');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_visita_registrar(%L, jsonb_build_object('atendimento_id', %L, 'pet_id', %L, 'agendamento_id', %L))$c$, gen_random_uuid(), gen_random_uuid(), pet1, ag_canc), 'consulta cancelada');
  PERFORM ci.entrar(va);
  r := clinica_visita_registrar(k2, jsonb_build_object('atendimento_id', a2, 'pet_id', pet2, 'agendamento_id', ag_cons));
  PERFORM ci.sair();
  PERFORM ci.exige(r ->> 'modo' = 'consulta_marcada' AND r ->> 'agendamento_id' = ag_cons::text, 'consulta marcada abre o atendimento com o id do notebook');
  PERFORM ci.exige((SELECT situacao = 'em_atendimento' FROM pet_agendamentos WHERE id = ag_cons), 'abrir começa a consulta marcada');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_visita_registrar(%L, jsonb_build_object('atendimento_id', %L, 'pet_id', %L, 'agendamento_id', %L))$c$, gen_random_uuid(), gen_random_uuid(), pet2, ag_cons), 'consulta já aberta em outro aparelho');

  -- preencher e fechar, com chave de repetição
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_atendimento_offline(%L, 'apagar', %L, '{}'::jsonb)$c$, gen_random_uuid(), a1), 'ação inválida');
  PERFORM ci.deve_falhar(vb, format($c$SELECT clinica_atendimento_offline(%L, 'salvar', %L, '{"queixa":"x"}'::jsonb)$c$, gen_random_uuid(), a1), 'outro veterinário preenche o atendimento');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_atendimento_offline(%L, 'salvar', %L, '{"queixa":"x","peso_kg":"500"}'::jsonb)$c$, gen_random_uuid(), a1), 'peso absurdo (a regra do prontuário vale também aqui)');
  PERFORM ci.entrar(va);
  r := clinica_atendimento_offline(k3, 'salvar', a1, '{"queixa":"Tosse há 3 dias","peso_kg":"12,5","temperatura_c":"38,6","conduta":"Repouso e hidratação"}'::jsonb);
  PERFORM ci.sair();
  PERFORM ci.exige(r ->> 'situacao' = 'aberto' AND (r ->> 'repetido')::boolean = false, 'preencher sem internet grava e segue aberto');
  PERFORM ci.exige((SELECT queixa = 'Tosse há 3 dias' AND peso_kg = 12.5 AND temperatura_c = 38.6 AND conduta = 'Repouso e hidratação' FROM pet_atendimentos_clinicos WHERE id = a1), 'o atendimento ficou com o que foi preenchido');
  PERFORM ci.entrar(va);
  r2 := clinica_atendimento_offline(k3, 'salvar', a1, '{"queixa":"OUTRA COISA"}'::jsonb);
  PERFORM ci.sair();
  PERFORM ci.exige((r2 ->> 'repetido')::boolean AND (SELECT queixa = 'Tosse há 3 dias' FROM pet_atendimentos_clinicos WHERE id = a1), 'reenviar a mesma chave não regrava o atendimento');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_atendimento_offline(%L, 'fechar', %L)$c$, gen_random_uuid(), a2), 'fechar atendimento sem queixa nem conduta');
  PERFORM ci.entrar(va);
  r := clinica_atendimento_offline(k4, 'fechar', a1);
  PERFORM ci.sair();
  PERFORM ci.exige(r ->> 'situacao' = 'fechado' AND (SELECT situacao = 'fechado' FROM pet_atendimentos_clinicos WHERE id = a1) AND (SELECT situacao = 'pronto' FROM pet_agendamentos WHERE id = agv),
                   'fechar sem internet fecha o atendimento e leva a consulta para pronto (a recepção cobra)');
  PERFORM ci.entrar(va);
  r2 := clinica_atendimento_offline(k4, 'fechar', a1);
  PERFORM ci.sair();
  PERFORM ci.exige((r2 ->> 'repetido')::boolean AND r2 ->> 'situacao' = 'fechado', 'reenviar o fechamento devolve o mesmo resultado em vez de recusar');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_atendimento_offline(%L, 'salvar', %L, '{"queixa":"depois de fechado"}'::jsonb)$c$, gen_random_uuid(), a1), 'preencher atendimento já fechado');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_atendimento_offline(%L, 'fechar', %L)$c$, gen_random_uuid(), a1), 'fechar de novo com outra chave');
  PERFORM ci.deve_falhar_dono(format($c$UPDATE pet_atendimentos_clinicos SET queixa = 'x' WHERE id = %L$c$, a1), 'alterar atendimento fechado, nem o dono do banco');
  PERFORM ci.exige((SELECT queixa = 'Tosse há 3 dias' FROM pet_atendimentos_clinicos WHERE id = a1), 'o atendimento fechado continua o mesmo');
  PERFORM ci.deve_falhar(va, 'SELECT count(*) FROM clinica_operacoes_offline', 'leitura direta do registro das operações sem internet');

  -- clínica deixa de estar liberada
  UPDATE empresas SET ramo_atividade = 'petshop', cnae = '4789-0/04', cnae_secundarios = NULL WHERE tenant_id = demo;
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_visita_registrar(%L, jsonb_build_object('atendimento_id', %L, 'pet_id', %L, 'servico_id', %L))$c$, gen_random_uuid(), gen_random_uuid(), pet3, cons), 'registrar visita sem a clínica liberada');
  PERFORM ci.deve_falhar(va, format($c$SELECT clinica_atendimento_offline(%L, 'salvar', %L, '{}'::jsonb)$c$, gen_random_uuid(), a2), 'preencher atendimento sem a clínica liberada');
  UPDATE empresas SET ramo_atividade = ramo_ant, cnae = cnae_ant, cnae_secundarios = cnae2_ant WHERE tenant_id = demo;
END $$;

-- 53. Clínica (vacina e exame sem internet): aplicar com ou sem agendamento, vacina de outro local, lote que acabou, exame aberto no notebook
DO $$
DECLARE
  demo constant uuid := '11111111-1111-1111-1111-111111111111';
  vend constant uuid := 'a0000000-0000-0000-0000-000000000002';
  gest constant uuid := 'a0000000-0000-0000-0000-000000000005';
  adm  constant uuid := 'a0000000-0000-0000-0000-000000000001';
  vc   constant uuid := 'a0000000-0000-0000-0000-0000000000ff';
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  t0 timestamptz := date_trunc('day', now()) + interval '22 days' + interval '9 hours';
  ramo_ant text; cnae_ant text; cnae2_ant text;
  tutor uuid; pet1 uuid; pet2 uuid; pet3 uuid; vacserv uuid; vacserv_sempreco uuid; pvc uuid; ag_vac uuid;
  prod uuid; dep uuid; l_a uuid; l_b uuid; cat uuid; m uuid; c_num uuid; c_txt uuid; atend uuid := gen_random_uuid();
  k uuid[] := ARRAY(SELECT gen_random_uuid() FROM generate_series(1, 14));
  r jsonb; r2 jsonb; n bigint; ex uuid; saldo0 numeric;
BEGIN
  SELECT ramo_atividade, cnae, cnae_secundarios INTO ramo_ant, cnae_ant, cnae2_ant FROM empresas WHERE tenant_id = demo ORDER BY created_at LIMIT 1;
  UPDATE empresas SET ramo_atividade = 'clinica' WHERE tenant_id = demo;
  INSERT INTO clientes (tenant_id, nome, cpf) VALUES (demo, 'Tutor Vacina Offline CI', '52998224725') RETURNING id INTO tutor;
  INSERT INTO auth.users (id, email) VALUES (vc, 'vetvacoff@ci');
  UPDATE profiles SET tenant_id = demo WHERE id = vc;
  INSERT INTO user_roles (user_id, tenant_id, role) VALUES (vc, demo, 'veterinario');
  INSERT INTO depositos (tenant_id, nome) VALUES (demo, 'Vacinas Offline CI') RETURNING id INTO dep;
  INSERT INTO produtos (tenant_id, codigo_interno, descricao, unidade, preco_venda, controla_lote) VALUES (demo, 'VAC-OFF-CI', 'Vacina Offline CI', 'UN', 0, true) RETURNING id INTO prod;
  PERFORM ci.entrar(adm);
  PERFORM registrar_movimentacao(prod, dep, 'entrada'::mov_tipo, 10, 'ci', 'ci');
  l_a := estoque_lote_lancar(prod, dep, 'OFF-A', '', '', 'entrada', 1, 'ci');
  l_b := estoque_lote_lancar(prod, dep, 'OFF-B', '', '', 'entrada', 5, 'ci');
  PERFORM ci.sair();
  UPDATE estoque_lotes SET validade = hoje + 90 WHERE id IN (l_a, l_b);

  PERFORM ci.entrar(gest);
  vacserv := pet_servico_salvar('{"nome":"Vacina Offline CI","categoria":"vacina","duracao_min":15}'::jsonb);
  vacserv_sempreco := pet_servico_salvar('{"nome":"Vacina Sem Preco Offline CI","categoria":"vacina","duracao_min":15}'::jsonb);
  PERFORM pet_preco_salvar(vacserv, NULL, NULL, NULL, 90);
  pvc := pet_profissional_salvar('{"nome":"Vet Vacina Offline","funcao":"veterinario","crmv":"7771","crmv_uf":"SP"}'::jsonb);
  PERFORM pet_profissional_vincular(pvc, vc);
  cat := clinica_vacina_catalogo_salvar(jsonb_build_object('nome', 'V10 Offline CI', 'tipo', 'vacina', 'especie', 'cao', 'doses_serie', 3, 'intervalo_serie_dias', 21, 'reforco_dias', 365, 'produto_id', prod));
  m := clinica_exame_modelo_salvar(jsonb_build_object('nome', 'Exame Offline CI', 'tipo', 'outro', 'material', 'Soro'));
  c_num := clinica_exame_campo_salvar(jsonb_build_object('modelo_id', m, 'nome', 'Glicose', 'unidade', 'mg/dL', 'forma', 'numero', 'casas', 1));
  c_txt := clinica_exame_campo_salvar(jsonb_build_object('modelo_id', m, 'nome', 'Observação do laudo', 'forma', 'texto'));
  PERFORM ci.sair();
  PERFORM ci.entrar(vend);
  pet1 := pet_salvar(jsonb_build_object('cliente_id', tutor, 'nome', 'Vacina Avulsa Offline CI', 'especie', 'cao'));
  pet2 := pet_salvar(jsonb_build_object('cliente_id', tutor, 'nome', 'Vacina Agenda Offline CI', 'especie', 'cao'));
  pet3 := pet_salvar(jsonb_build_object('cliente_id', tutor, 'nome', 'Exame Offline CI', 'especie', 'cao'));
  ag_vac := pet_agendar(jsonb_build_object('pet_id', pet2, 'profissional_id', pvc, 'inicio', t0, 'servicos', jsonb_build_array(jsonb_build_object('servico_id', vacserv))));
  PERFORM ci.sair();

  -- só o veterinário
  PERFORM ci.deve_falhar(gest, format($c$SELECT clinica_vacina_offline(%L, 'aplicar', jsonb_build_object('agendamento_id', %L, 'catalogo_id', %L, 'estoque_lote_id', %L))$c$, gen_random_uuid(), ag_vac, cat, l_b), 'gestor aplica vacina sem internet');
  PERFORM ci.deve_falhar(vend, format($c$SELECT clinica_exame_offline(%L, 'abrir', jsonb_build_object('pet_id', %L, 'modelo_id', %L, 'laboratorio', 'Lab'))$c$, gen_random_uuid(), pet3, m), 'recepção abre exame sem internet');

  -- a cópia leva os serviços de vacina
  PERFORM ci.entrar(vc);
  r := clinica_visita_preparar();
  PERFORM ci.sair();
  PERFORM ci.exige(EXISTS (SELECT 1 FROM jsonb_array_elements(r -> 'servicos_vacina') x WHERE x ->> 'id' = vacserv::text), 'a cópia da visita traz os serviços de vacina');

  -- aplicar numa consulta de vacina da agenda
  PERFORM ci.entrar(vc);
  r := clinica_vacina_offline(k[1], 'aplicar', jsonb_build_object('agendamento_id', ag_vac, 'catalogo_id', cat, 'estoque_lote_id', l_b, 'aplicada_em', hoje));
  r2 := clinica_vacina_offline(k[1], 'aplicar', jsonb_build_object('agendamento_id', ag_vac, 'catalogo_id', cat, 'estoque_lote_id', l_b, 'aplicada_em', hoje));
  PERFORM ci.sair();
  PERFORM ci.exige((r ->> 'dose_tipo') = 'serie' AND (r ->> 'dose_numero')::int = 1 AND (r ->> 'repetido')::boolean = false, 'aplicar na agenda registra a primeira dose da série');
  PERFORM ci.exige((r2 ->> 'repetido')::boolean AND r2 ->> 'vacinacao_id' = r ->> 'vacinacao_id', 'reenviar a mesma chave devolve a mesma aplicação');
  PERFORM ci.exige((SELECT count(*) FROM pet_vacinacoes WHERE pet_id = pet2) = 1 AND (SELECT quantidade = 4 FROM estoque_lotes WHERE id = l_b), 'reenviar não aplica nem baixa de novo');

  -- sem agendamento: a função cria o atendimento de vacina, com o preço do serviço
  PERFORM ci.entrar(vc);
  r := clinica_vacina_offline(k[2], 'aplicar', jsonb_build_object('pet_id', pet1, 'servico_id', vacserv, 'catalogo_id', cat, 'estoque_lote_id', l_b, 'aplicada_em', hoje - 2));
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT a.situacao = 'em_atendimento' AND a.profissional_id = pvc AND i.preco_aplicado = 90 AND i.servico_id = vacserv
                      FROM pet_agendamentos a JOIN pet_agendamento_itens i ON i.agendamento_id = a.id WHERE a.id = (r ->> 'agendamento_id')::uuid),
                   'aplicar sem agendamento cria o atendimento de vacina em andamento com o preço do serviço');
  PERFORM ci.exige((SELECT aplicada_em = hoje - 2 AND estoque_lote_id = l_b FROM pet_vacinacoes WHERE id = (r ->> 'vacinacao_id')::uuid), 'a aplicação guarda a data e o lote do notebook');
  PERFORM ci.deve_falhar(vc, format($c$SELECT clinica_vacina_offline(%L, 'aplicar', jsonb_build_object('pet_id', %L, 'servico_id', %L, 'catalogo_id', %L, 'estoque_lote_id', %L, 'aplicada_em', %L))$c$, gen_random_uuid(), pet1, vacserv_sempreco, cat, l_b, hoje), 'serviço de vacina sem preço');
  PERFORM ci.deve_falhar(vc, format($c$SELECT clinica_vacina_offline(%L, 'aplicar', jsonb_build_object('pet_id', %L, 'servico_id', %L, 'agendamento_id', %L, 'catalogo_id', %L, 'estoque_lote_id', %L))$c$, gen_random_uuid(), pet1, vacserv, ag_vac, cat, l_b), 'agendamento e serviço ao mesmo tempo');
  PERFORM ci.deve_falhar(vc, format($c$SELECT clinica_vacina_offline(%L, 'aplicar', jsonb_build_object('pet_id', %L, 'catalogo_id', %L, 'estoque_lote_id', %L))$c$, gen_random_uuid(), pet1, cat, l_b), 'sem agendamento nem serviço');
  PERFORM ci.exige((SELECT count(*) FROM pet_agendamentos WHERE pet_id = pet1) = 1, 'operação recusada não deixa atendimento para trás');

  -- lote que acabou: recusa sem gravar nada; a mesma chave serve depois com outro lote
  PERFORM ci.entrar(vc);
  r := clinica_vacina_offline(k[3], 'aplicar', jsonb_build_object('agendamento_id', ag_vac, 'catalogo_id', cat, 'estoque_lote_id', l_a, 'aplicada_em', hoje));
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT quantidade = 0 FROM estoque_lotes WHERE id = l_a), 'o último frasco do lote foi usado');
  PERFORM ci.deve_falhar(vc, format($c$SELECT clinica_vacina_offline(%L, 'aplicar', jsonb_build_object('agendamento_id', %L, 'catalogo_id', %L, 'estoque_lote_id', %L, 'aplicada_em', %L))$c$, k[4], ag_vac, cat, l_a, hoje), 'lote que acabou antes do envio');
  SELECT count(*) INTO n FROM clinica_operacoes_offline WHERE chave = k[4];
  PERFORM ci.exige(n = 0, 'a recusa não grava a chave');
  PERFORM ci.entrar(vc);
  r := clinica_vacina_offline(k[4], 'aplicar', jsonb_build_object('agendamento_id', ag_vac, 'catalogo_id', cat, 'estoque_lote_id', l_b, 'aplicada_em', hoje));
  PERFORM ci.sair();
  PERFORM ci.exige((r ->> 'repetido')::boolean = false AND (SELECT estoque_lote_id = l_b FROM pet_vacinacoes WHERE id = (r ->> 'vacinacao_id')::uuid), 'reenviar com outro lote, pela mesma chave, aplica');

  -- outro local
  PERFORM ci.entrar(vc);
  r := clinica_vacina_offline(k[5], 'externa', jsonb_build_object('pet_id', pet3, 'catalogo_id', cat, 'aplicada_em', hoje - 30, 'informado_por', 'Carteira do tutor', 'lote', 'X1'));
  r2 := clinica_vacina_offline(k[5], 'externa', jsonb_build_object('pet_id', pet3, 'catalogo_id', cat, 'aplicada_em', hoje - 30, 'informado_por', 'Carteira do tutor'));
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT origem = 'outro_local' AND aplicada_em = hoje - 30 FROM pet_vacinacoes WHERE id = (r ->> 'vacinacao_id')::uuid) AND (r2 ->> 'repetido')::boolean, 'vacina de outro local entra uma vez só');
  PERFORM ci.deve_falhar(vc, format($c$SELECT clinica_vacina_offline(%L, 'externa', jsonb_build_object('pet_id', %L, 'catalogo_id', %L, 'aplicada_em', %L))$c$, gen_random_uuid(), pet3, cat, hoje - 3), 'vacina de outro local sem quem informou');
  PERFORM ci.deve_falhar(vc, format($c$SELECT clinica_vacina_offline(%L, 'aplicar', jsonb_build_object('agendamento_id', %L, 'catalogo_id', %L, 'estoque_lote_id', %L))$c$, k[5], ag_vac, cat, l_b), 'chave de outro tipo de operação');

  -- exame aberto no notebook: abrir, salvar pelo campo do modelo, fechar
  PERFORM ci.entrar(vc);
  r := clinica_exame_offline(k[6], 'abrir', jsonb_build_object('pet_id', pet3, 'modelo_id', m, 'laboratorio', 'Lab Offline', 'data_coleta', hoje - 1));
  r2 := clinica_exame_offline(k[6], 'abrir', jsonb_build_object('pet_id', pet3, 'modelo_id', m, 'laboratorio', 'Lab Offline', 'data_coleta', hoje - 1));
  PERFORM ci.sair();
  ex := (r ->> 'exame_id')::uuid;
  PERFORM ci.exige((r2 ->> 'repetido')::boolean AND (SELECT count(*) FROM pet_exames WHERE pet_id = pet3) = 1, 'reenviar a abertura não abre outro exame');
  PERFORM ci.deve_falhar(vc, format($c$SELECT clinica_exame_offline(%L, 'salvar', jsonb_build_object('abrir_chave', %L))$c$, gen_random_uuid(), gen_random_uuid()), 'salvar exame cuja abertura não chegou');
  PERFORM ci.deve_falhar(vc, format($c$SELECT clinica_exame_offline(%L, 'salvar', jsonb_build_object('abrir_chave', %L, 'resultados', jsonb_build_array(jsonb_build_object('campo_id', %L, 'valor', '90'))))$c$, gen_random_uuid(), k[6], gen_random_uuid()), 'campo que não é do exame');
  PERFORM ci.deve_falhar(vc, format($c$SELECT clinica_exame_offline(%L, 'fechar', jsonb_build_object('abrir_chave', %L))$c$, gen_random_uuid(), k[6]), 'fechar exame sem nenhum resultado');
  PERFORM ci.entrar(vc);
  r := clinica_exame_offline(k[7], 'salvar', jsonb_build_object('abrir_chave', k[6], 'observacoes', 'coletado em jejum',
         'resultados', jsonb_build_array(jsonb_build_object('campo_id', c_num, 'valor', '92,5'), jsonb_build_object('campo_id', c_txt, 'valor', 'normal', 'nota', 'sem hemólise'))));
  r2 := clinica_exame_offline(k[7], 'salvar', jsonb_build_object('abrir_chave', k[6], 'resultados', jsonb_build_array(jsonb_build_object('campo_id', c_num, 'valor', '1'))));
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT valor_num = 92.5 FROM pet_exame_resultados WHERE exame_id = ex AND campo_id = c_num)
               AND (SELECT valor_texto = 'normal' AND nota = 'sem hemólise' FROM pet_exame_resultados WHERE exame_id = ex AND campo_id = c_txt)
               AND (SELECT observacoes = 'coletado em jejum' FROM pet_exames WHERE id = ex), 'salvar grava os resultados pelo campo do modelo');
  PERFORM ci.exige((r2 ->> 'repetido')::boolean AND (SELECT valor_num = 92.5 FROM pet_exame_resultados WHERE exame_id = ex AND campo_id = c_num), 'reenviar o salvamento não regrava');
  PERFORM ci.entrar(vc);
  r := clinica_exame_offline(k[8], 'fechar', jsonb_build_object('abrir_chave', k[6]));
  r2 := clinica_exame_offline(k[8], 'fechar', jsonb_build_object('abrir_chave', k[6]));
  PERFORM ci.sair();
  PERFORM ci.exige(r ->> 'situacao' = 'fechado' AND (r2 ->> 'repetido')::boolean AND r2 ->> 'situacao' = 'fechado', 'fechar o exame aceita repetição');
  PERFORM ci.deve_falhar(vc, format($c$SELECT clinica_exame_offline(%L, 'salvar', jsonb_build_object('abrir_chave', %L, 'resultados', jsonb_build_array(jsonb_build_object('campo_id', %L, 'valor', '5'))))$c$, gen_random_uuid(), k[6], c_num), 'salvar exame já fechado');
  PERFORM ci.deve_falhar_dono(format($c$UPDATE pet_exame_resultados SET valor_num = 1 WHERE exame_id = %L AND campo_id = %L$c$, ex, c_num), 'alterar resultado de exame fechado, nem o dono do banco');

  -- clínica deixa de estar liberada
  UPDATE empresas SET ramo_atividade = 'petshop', cnae = '4789-0/04', cnae_secundarios = NULL WHERE tenant_id = demo;
  PERFORM ci.deve_falhar(vc, format($c$SELECT clinica_vacina_offline(%L, 'externa', jsonb_build_object('pet_id', %L, 'catalogo_id', %L, 'aplicada_em', %L, 'informado_por', 'x'))$c$, gen_random_uuid(), pet3, cat, hoje - 40), 'vacina sem a clínica liberada');
  PERFORM ci.deve_falhar(vc, format($c$SELECT clinica_exame_offline(%L, 'abrir', jsonb_build_object('pet_id', %L, 'modelo_id', %L, 'laboratorio', 'L'))$c$, gen_random_uuid(), pet3, m), 'exame sem a clínica liberada');
  UPDATE empresas SET ramo_atividade = ramo_ant, cnae = cnae_ant, cnae_secundarios = cnae2_ant WHERE tenant_id = demo;
END $$;

-- 54. Login por usuário: usuário único por empresa, formato, só o administrador troca, repetido em outra empresa vale
DO $$
DECLARE
  demo constant uuid := '11111111-1111-1111-1111-111111111111';
  adm  constant uuid := 'a0000000-0000-0000-0000-000000000001';
  vend constant uuid := 'a0000000-0000-0000-0000-000000000002';
  gest constant uuid := 'a0000000-0000-0000-0000-000000000005';
  outro constant uuid := 'a0000000-0000-0000-0000-0000000000f0';
  tenant_x uuid;
  n bigint;
BEGIN
  INSERT INTO tenants (nome) VALUES ('Empresa X usuarios CI') RETURNING id INTO tenant_x;
  INSERT INTO auth.users (id, email) VALUES (outro, 'outro-usuario@ci');
  UPDATE profiles SET tenant_id = tenant_x WHERE id = outro;

  -- o administrador define; dois usuários da mesma empresa não repetem
  PERFORM ci.entrar(adm);
  UPDATE profiles SET usuario = 'maria.ci' WHERE id = vend;
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT usuario = 'maria.ci' FROM profiles WHERE id = vend), 'o administrador define o usuário de acesso');
  PERFORM ci.deve_falhar(adm, format($c$UPDATE profiles SET usuario = 'maria.ci' WHERE id = %L$c$, gest), 'mesmo usuário duas vezes na mesma empresa');

  -- formato: minúsculas, números, ponto, hífen e sublinhado, de 3 a 30
  PERFORM ci.deve_falhar(adm, format($c$UPDATE profiles SET usuario = 'Maria' WHERE id = %L$c$, gest), 'usuário com maiúscula');
  PERFORM ci.deve_falhar(adm, format($c$UPDATE profiles SET usuario = 'ab' WHERE id = %L$c$, gest), 'usuário curto demais');
  PERFORM ci.deve_falhar(adm, format($c$UPDATE profiles SET usuario = 'joao silva' WHERE id = %L$c$, gest), 'usuário com espaço');
  PERFORM ci.deve_falhar(adm, format($c$UPDATE profiles SET usuario = %L WHERE id = %L$c$, repeat('a', 31), gest), 'usuário com mais de 30 letras');

  -- a própria pessoa não troca o usuário pelo perfil, mas segue mexendo no resto
  PERFORM ci.deve_falhar(vend, format($c$UPDATE profiles SET usuario = 'outro.nome' WHERE id = %L$c$, vend), 'o próprio usuário troca o seu usuário de acesso');
  PERFORM ci.entrar(vend);
  UPDATE profiles SET telefone = '11999990000' WHERE id = vend;
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT usuario = 'maria.ci' AND telefone = '11999990000' FROM profiles WHERE id = vend), 'a pessoa ainda edita os próprios dados, sem mexer no usuário');

  -- outra empresa pode ter o mesmo usuário
  UPDATE profiles SET usuario = 'maria.ci' WHERE id = outro;
  SELECT count(*) INTO n FROM profiles WHERE usuario = 'maria.ci';
  PERFORM ci.exige(n = 2, 'o mesmo usuário vale em empresas diferentes');

  -- o e-mail é só contato: pode se repetir entre usuários da mesma empresa
  UPDATE profiles SET email = 'contato.repetido@ci' WHERE id IN (vend, gest);
  SELECT count(*) INTO n FROM profiles WHERE email = 'contato.repetido@ci';
  PERFORM ci.exige(n = 2, 'o e-mail de contato pode se repetir');
END $$;

-- 55. Locação (vistoria na devolução): dano sai da caução e a diferença vira conta a receber; equipamento com dano vai para manutenção
DO $$
DECLARE
  demo constant uuid := '11111111-1111-1111-1111-111111111111';
  adm  constant uuid := 'a0000000-0000-0000-0000-000000000001';
  gar  constant uuid := 'a0000000-0000-0000-0000-000000000006';
  cli uuid; eq_e uuid; loc5 uuid; eq_a uuid; eq_b uuid; eq_c uuid; eq_d uuid; loc1 uuid; loc2 uuid; loc3 uuid; loc4 uuid;
  r jsonb; n bigint;
BEGIN
  INSERT INTO clientes (tenant_id, nome, cpf) VALUES (demo, 'Cliente Vistoria CI', '52998224725') RETURNING id INTO cli;
  INSERT INTO locacao_equipamentos (tenant_id, nome, valor_diaria, valor_aquisicao) VALUES (demo, 'Betoneira Vistoria CI', 100, 4000) RETURNING id INTO eq_a;
  INSERT INTO locacao_equipamentos (tenant_id, nome, valor_diaria, valor_aquisicao) VALUES (demo, 'Andaime Vistoria CI', 50, 1000) RETURNING id INTO eq_b;
  INSERT INTO locacao_equipamentos (tenant_id, nome, valor_diaria, valor_aquisicao) VALUES (demo, 'Furadeira Vistoria CI', 30, 600) RETURNING id INTO eq_c;
  INSERT INTO locacao_equipamentos (tenant_id, nome, valor_diaria, valor_aquisicao) VALUES (demo, 'Serra Vistoria CI', 40, 800) RETURNING id INTO eq_d;

  -- locação 1: dois equipamentos, caução de 100; locação 2: perda total; locação 3: sem dano; locação 4: ainda reservada
  INSERT INTO locacoes (tenant_id, cliente_id, equipamento_id, inicio, entregue_em, dias, valor_diaria, valor_total, valor_faturado, caucao, situacao)
    VALUES (demo, cli, eq_a, current_date - 5, current_date - 5, 3, 150, 450, 450, 100, 'em_andamento') RETURNING id INTO loc1;
  INSERT INTO locacao_itens (tenant_id, locacao_id, equipamento_id, quantidade, dias, valor_diaria, total) VALUES (demo, loc1, eq_a, 1, 3, 100, 300), (demo, loc1, eq_b, 1, 3, 50, 150);
  INSERT INTO locacoes (tenant_id, cliente_id, equipamento_id, inicio, entregue_em, dias, valor_diaria, valor_total, valor_faturado, caucao, situacao)
    VALUES (demo, cli, eq_c, current_date - 2, current_date - 2, 2, 30, 60, 60, 500, 'em_andamento') RETURNING id INTO loc2;
  INSERT INTO locacoes (tenant_id, cliente_id, equipamento_id, inicio, entregue_em, dias, valor_diaria, valor_total, valor_faturado, caucao, situacao)
    VALUES (demo, cli, eq_d, current_date - 1, current_date - 1, 1, 40, 40, 40, 0, 'em_andamento') RETURNING id INTO loc3;
  INSERT INTO locacoes (tenant_id, cliente_id, equipamento_id, inicio, dias, valor_diaria, valor_total, valor_faturado, caucao, situacao)
    VALUES (demo, cli, eq_a, current_date + 5, 1, 100, 100, 100, 0, 'reservada') RETURNING id INTO loc4;

  -- perfis e regras de entrada
  PERFORM ci.deve_falhar(gar, format($c$SELECT locacao_devolver_vistoriada(%L, current_date, NULL, '[]'::jsonb)$c$, loc1), 'perfil do salão devolve locação');
  PERFORM ci.deve_falhar(adm, format($c$SELECT locacao_devolver(%L, current_date, NULL, 0)$c$, loc1), 'devolução antiga, sem vistoria, não é mais chamável');
  PERFORM ci.deve_falhar(adm, format($c$SELECT locacao_devolver_vistoriada(%L, current_date, NULL, '[]'::jsonb)$c$, loc1), 'devolver sem vistoriar nenhum equipamento');
  PERFORM ci.deve_falhar(adm, format($c$SELECT locacao_devolver_vistoriada(%L, current_date, NULL, jsonb_build_array(jsonb_build_object('equipamento_id', %L)))$c$, loc1, eq_a), 'devolver sem vistoriar todos os equipamentos');
  PERFORM ci.deve_falhar(adm, format($c$SELECT locacao_devolver_vistoriada(%L, current_date, NULL, jsonb_build_array(jsonb_build_object('equipamento_id', %L), jsonb_build_object('equipamento_id', %L), jsonb_build_object('equipamento_id', %L)))$c$, loc1, eq_a, eq_b, eq_c), 'vistoriar equipamento que não é da locação');
  PERFORM ci.deve_falhar(adm, format($c$SELECT locacao_devolver_vistoriada(%L, current_date, NULL, jsonb_build_array(jsonb_build_object('equipamento_id', %L), jsonb_build_object('equipamento_id', %L), jsonb_build_object('equipamento_id', %L)))$c$, loc1, eq_a, eq_b, eq_b), 'vistoriar o mesmo equipamento duas vezes');
  PERFORM ci.deve_falhar(adm, format($c$SELECT locacao_devolver_vistoriada(%L, current_date, NULL, jsonb_build_array(jsonb_build_object('equipamento_id', %L, 'avarias', jsonb_build_array(jsonb_build_object('descricao', 'Cabo', 'valor', 'abc'))), jsonb_build_object('equipamento_id', %L)))$c$, loc1, eq_a, eq_b), 'valor da avaria que não é número');
  PERFORM ci.deve_falhar(adm, format($c$SELECT locacao_devolver_vistoriada(%L, current_date, NULL, jsonb_build_array(jsonb_build_object('equipamento_id', %L, 'avarias', jsonb_build_array(jsonb_build_object('descricao', '', 'valor', '10'))), jsonb_build_object('equipamento_id', %L)))$c$, loc1, eq_a, eq_b), 'avaria sem descrição');
  PERFORM ci.deve_falhar(adm, format($c$SELECT locacao_devolver_vistoriada(%L, current_date, NULL, jsonb_build_array(jsonb_build_object('equipamento_id', %L, 'avarias', jsonb_build_array(jsonb_build_object('descricao', 'Cabo', 'valor', '-5'))), jsonb_build_object('equipamento_id', %L)))$c$, loc1, eq_a, eq_b), 'avaria com valor negativo');
  PERFORM ci.deve_falhar(adm, format($c$SELECT locacao_devolver_vistoriada(%L, current_date + 1, NULL, jsonb_build_array(jsonb_build_object('equipamento_id', %L), jsonb_build_object('equipamento_id', %L)))$c$, loc1, eq_a, eq_b), 'devolução com data no futuro');
  PERFORM ci.deve_falhar(adm, format($c$SELECT locacao_devolver_vistoriada(%L, current_date, NULL, jsonb_build_array(jsonb_build_object('equipamento_id', %L)))$c$, loc4, eq_a), 'devolver locação que ainda não foi entregue');
  SELECT count(*) INTO n FROM locacao_vistorias WHERE locacao_id = loc1;
  PERFORM ci.exige(n = 0, 'devolução recusada não deixa vistoria para trás');
  PERFORM ci.exige((SELECT situacao = 'em_andamento' FROM locacoes WHERE id = loc1), 'devolução recusada mantém a locação em andamento');

  -- dano de 150 com caução de 100: abate a caução e cobra 50; só o equipamento danificado vai para manutenção
  PERFORM ci.entrar(adm);
  r := locacao_devolver_vistoriada(loc1, current_date, 'Devolvido com um cabo partido', jsonb_build_array(
         jsonb_build_object('equipamento_id', eq_a, 'observacoes', 'Cabo do motor partido',
                            'avarias', jsonb_build_array(jsonb_build_object('descricao', 'Cabo do motor', 'valor', '120,50'), jsonb_build_object('descricao', 'Pintura', 'valor', '29,50'))),
         jsonb_build_object('equipamento_id', eq_b)), current_date + 7);
  PERFORM ci.sair();
  PERFORM ci.exige((r ->> 'valor_avarias')::numeric = 150 AND (r ->> 'caucao_abatida')::numeric = 100 AND (r ->> 'a_cobrar')::numeric = 50 AND (r ->> 'caucao_a_devolver')::numeric = 0,
                   'dano maior que a caução: abate a caução toda e cobra a diferença');
  PERFORM ci.exige((SELECT valor = 50 AND cliente_id = cli AND vencimento = current_date + 7 FROM contas_receber WHERE id = (r ->> 'conta_receber_id')::uuid),
                   'a diferença vira conta a receber do cliente, com o vencimento escolhido');
  PERFORM ci.exige((SELECT situacao = 'devolvida' AND valor_avarias = 150 AND caucao_abatida = 100 AND vistoria_em IS NOT NULL AND avarias_conta_receber_id IS NOT NULL FROM locacoes WHERE id = loc1),
                   'a locação guarda o acerto da devolução');
  PERFORM ci.exige((SELECT situacao = 'manutencao' AND ativo FROM locacao_equipamentos WHERE id = eq_a), 'equipamento com dano vai para manutenção');
  PERFORM ci.exige((SELECT situacao = 'disponivel' FROM locacao_equipamentos WHERE id = eq_b), 'equipamento sem dano volta a ficar disponível');
  PERFORM ci.exige((SELECT count(*) = 2 AND sum(valor_avarias) = 150 FROM locacao_vistorias WHERE locacao_id = loc1), 'cada equipamento tem a sua vistoria');
  PERFORM ci.deve_falhar(adm, format($c$SELECT locacao_devolver_vistoriada(%L, current_date, NULL, '[]'::jsonb)$c$, loc1), 'devolver de novo');

  -- a reserva futura de um equipamento que voltou danificado não sai para o cliente, nem pela função nem por ajuste direto
  UPDATE locacoes SET aprovada = true WHERE id = loc4;
  PERFORM ci.deve_falhar(adm, format($c$SELECT locacao_entregar(%L)$c$, loc4), 'entregar reserva de equipamento em manutenção');
  PERFORM ci.deve_falhar_dono(format($c$UPDATE locacoes SET situacao = 'em_andamento' WHERE id = %L$c$, loc4), 'pôr em andamento locação de equipamento em manutenção, nem o dono do banco');
  PERFORM ci.exige((SELECT situacao = 'reservada' FROM locacoes WHERE id = loc4), 'a reserva do equipamento danificado segue parada');

  -- perda total com caução maior que o dano: não cobra e devolve o resto; o equipamento sai de uso
  PERFORM ci.entrar(adm);
  r := locacao_devolver_vistoriada(loc2, current_date, NULL, jsonb_build_array(
         jsonb_build_object('equipamento_id', eq_c, 'avarias', jsonb_build_array(jsonb_build_object('descricao', 'Furadeira perdida', 'valor', '300', 'perda_total', true)))));
  PERFORM ci.sair();
  PERFORM ci.exige((r ->> 'a_cobrar')::numeric = 0 AND (r ->> 'caucao_abatida')::numeric = 300 AND (r ->> 'caucao_a_devolver')::numeric = 200 AND r ->> 'conta_receber_id' IS NULL,
                   'dano menor que a caução: não cobra e mostra o resto a devolver');
  PERFORM ci.exige((SELECT NOT ativo AND situacao = 'manutencao' FROM locacao_equipamentos WHERE id = eq_c), 'perda total tira o equipamento de uso');

  -- caução negativa conta como zero: devolução sem dano não vira cobrança
  INSERT INTO locacao_equipamentos (tenant_id, nome, valor_diaria, valor_aquisicao) VALUES (demo, 'Esmerilhadeira Vistoria CI', 20, 300) RETURNING id INTO eq_e;
  INSERT INTO locacoes (tenant_id, cliente_id, equipamento_id, inicio, entregue_em, dias, valor_diaria, valor_total, valor_faturado, caucao, situacao)
    VALUES (demo, cli, eq_e, current_date - 1, current_date - 1, 1, 20, 20, 20, -100, 'em_andamento') RETURNING id INTO loc5;
  PERFORM ci.entrar(adm);
  r := locacao_devolver_vistoriada(loc5, current_date, NULL, jsonb_build_array(jsonb_build_object('equipamento_id', eq_e)));
  PERFORM ci.sair();
  PERFORM ci.exige((r ->> 'a_cobrar')::numeric = 0 AND (r ->> 'caucao_abatida')::numeric = 0 AND (r ->> 'caucao_a_devolver')::numeric = 0 AND r ->> 'conta_receber_id' IS NULL,
                   'caução negativa conta como zero e não gera cobrança');

  -- sem dano: nada a cobrar e o equipamento volta a ficar disponível
  PERFORM ci.entrar(adm);
  r := locacao_devolver_vistoriada(loc3, current_date, NULL, jsonb_build_array(jsonb_build_object('equipamento_id', eq_d)));
  PERFORM ci.exige((SELECT situacao = 'disponivel' FROM locacao_equipamentos WHERE id = eq_d), 'equipamento devolvido sem dano volta a ficar disponível');
  PERFORM ci.sair();
  PERFORM ci.exige((r ->> 'valor_avarias')::numeric = 0 AND r ->> 'conta_receber_id' IS NULL AND (SELECT situacao = 'sem_avarias' FROM locacao_vistorias WHERE locacao_id = loc3), 'vistoria sem dano não cobra nada');

  -- a vistoria registrada não muda nem some, e não se grava à mão
  PERFORM ci.deve_falhar_dono(format($c$UPDATE locacao_vistorias SET valor_avarias = 0 WHERE locacao_id = %L$c$, loc1), 'alterar vistoria registrada, nem o dono do banco');
  PERFORM ci.deve_falhar_dono(format($c$DELETE FROM locacao_vistoria_avarias WHERE vistoria_id IN (SELECT id FROM locacao_vistorias WHERE locacao_id = %L)$c$, loc1), 'apagar avaria registrada, nem o dono do banco');
  PERFORM ci.deve_falhar(adm, format($c$INSERT INTO locacao_vistorias (locacao_id, equipamento_id, situacao) VALUES (%L, %L, 'sem_avarias')$c$, loc4, eq_a), 'gravar vistoria direto na tabela');
  PERFORM ci.exige(ci.contar(adm, 'SELECT count(*) FROM locacao_vistorias') >= 4, 'a empresa lê as vistorias dela');
END $$;

-- 56. Locação (plano de manutenção): dias locados acumulados, aviso e bloqueio ao vencer, registro recomeça a contagem
DO $$
DECLARE
  demo constant uuid := '11111111-1111-1111-1111-111111111111';
  adm  constant uuid := 'a0000000-0000-0000-0000-000000000001';
  gar  constant uuid := 'a0000000-0000-0000-0000-000000000006';
  cli uuid; eq1 uuid; eq2 uuid; eq3 uuid; plano uuid; plano2 uuid; plano3 uuid; locb uuid; loca uuid; locc uuid; locd uuid;
  r jsonb; s jsonb; n bigint;
BEGIN
  INSERT INTO clientes (tenant_id, nome, cpf) VALUES (demo, 'Cliente Manutencao CI', '52998224725') RETURNING id INTO cli;
  INSERT INTO locacao_equipamentos (tenant_id, nome, valor_diaria) VALUES (demo, 'Compactador Manut CI', 100) RETURNING id INTO eq1;
  INSERT INTO locacao_equipamentos (tenant_id, nome, valor_diaria, situacao) VALUES (demo, 'Gerador Manut CI', 100, 'manutencao') RETURNING id INTO eq2;
  INSERT INTO locacao_equipamentos (tenant_id, nome, valor_diaria, situacao, ativo) VALUES (demo, 'Perdido Manut CI', 100, 'manutencao', false) RETURNING id INTO eq3;

  -- perfil do salão não mexe
  PERFORM ci.deve_falhar(gar, format($c$SELECT locacao_plano_salvar(jsonb_build_object('equipamento_id', %L, 'nome', 'Troca de óleo', 'intervalo_dias', 10))$c$, eq1), 'perfil do salão cria plano de manutenção');
  PERFORM ci.deve_falhar(gar, 'SELECT locacao_manutencao_situacao()', 'perfil do salão vê a situação dos planos');
  PERFORM ci.deve_falhar(gar, format($c$SELECT locacao_manutencao_registrar(jsonb_build_object('equipamento_id', %L, 'descricao', 'Revisão'))$c$, eq1), 'perfil do salão registra manutenção');

  -- regras do plano
  PERFORM ci.deve_falhar(adm, format($c$SELECT locacao_plano_salvar(jsonb_build_object('equipamento_id', %L, 'nome', 'X', 'intervalo_dias', 10))$c$, eq1), 'plano com nome curto demais');
  PERFORM ci.deve_falhar(adm, format($c$SELECT locacao_plano_salvar(jsonb_build_object('equipamento_id', %L, 'nome', 'Troca de óleo', 'intervalo_dias', 0))$c$, eq1), 'plano com intervalo zero');
  PERFORM ci.deve_falhar(adm, format($c$SELECT locacao_plano_salvar(jsonb_build_object('equipamento_id', %L, 'nome', 'Troca de óleo', 'intervalo_dias', 4000))$c$, eq1), 'plano com intervalo acima de 3650');
  PERFORM ci.deve_falhar(adm, format($c$SELECT locacao_plano_salvar(jsonb_build_object('equipamento_id', %L, 'nome', 'Troca de óleo', 'intervalo_dias', 10, 'referencia_em', current_date + 1))$c$, eq1), 'última manutenção no futuro');
  PERFORM ci.deve_falhar(adm, format($c$SELECT locacao_plano_salvar(jsonb_build_object('equipamento_id', %L, 'nome', 'Troca de óleo', 'intervalo_dias', 10))$c$, gen_random_uuid()), 'plano de equipamento que não existe');

  PERFORM ci.entrar(adm);
  plano := locacao_plano_salvar(jsonb_build_object('equipamento_id', eq1, 'nome', 'Troca de óleo', 'intervalo_dias', 12, 'referencia_em', current_date - 30));
  PERFORM ci.sair();
  PERFORM ci.deve_falhar(adm, format($c$SELECT locacao_plano_salvar(jsonb_build_object('equipamento_id', %L, 'nome', ' troca de ÓLEO ', 'intervalo_dias', 5))$c$, eq1), 'dois planos ativos com o mesmo nome no equipamento');

  -- sem locação nenhuma: em dia
  PERFORM ci.entrar(adm);
  s := locacao_manutencao_situacao(eq1);
  PERFORM ci.sair();
  PERFORM ci.exige(jsonb_array_length(s) = 1 AND (s -> 0 ->> 'dias')::int = 0 AND s -> 0 ->> 'situacao' = 'em_dia' AND (s -> 0 ->> 'restantes')::int = 12, 'sem locação, o plano está em dia e com o intervalo todo pela frente');

  -- locação que começou antes da última manutenção só conta os dias depois dela (5); a seguinte conta inteira (6): 11 de 12 = próxima
  INSERT INTO locacoes (tenant_id, cliente_id, equipamento_id, inicio, entregue_em, devolvido_em, dias, valor_diaria, valor_total, situacao)
    VALUES (demo, cli, eq1, current_date - 35, current_date - 35, current_date - 25, 10, 100, 1000, 'devolvida') RETURNING id INTO locb;
  PERFORM ci.entrar(adm);
  s := locacao_manutencao_situacao(eq1);
  PERFORM ci.sair();
  PERFORM ci.exige((s -> 0 ->> 'dias')::int = 5 AND s -> 0 ->> 'situacao' = 'em_dia', 'locação que começou antes da última manutenção conta só os dias depois dela');
  INSERT INTO locacoes (tenant_id, cliente_id, equipamento_id, inicio, entregue_em, devolvido_em, dias, valor_diaria, valor_total, situacao)
    VALUES (demo, cli, eq1, current_date - 20, current_date - 20, current_date - 14, 6, 100, 600, 'devolvida') RETURNING id INTO loca;
  PERFORM ci.entrar(adm);
  s := locacao_manutencao_situacao(eq1);
  PERFORM ci.sair();
  PERFORM ci.exige((s -> 0 ->> 'dias')::int = 11 AND (s -> 0 ->> 'restantes')::int = 1 AND s -> 0 ->> 'situacao' = 'proxima', 'faltando 20% ou menos do intervalo, o plano avisa (próxima)');

  -- a locação em andamento conta até hoje e vence o plano
  INSERT INTO locacoes (tenant_id, cliente_id, equipamento_id, inicio, entregue_em, dias, valor_diaria, valor_total, situacao)
    VALUES (demo, cli, eq1, current_date - 2, current_date - 2, 5, 100, 500, 'em_andamento') RETURNING id INTO locc;
  PERFORM ci.entrar(adm);
  s := locacao_manutencao_situacao(eq1);
  PERFORM ci.sair();
  PERFORM ci.exige((s -> 0 ->> 'dias')::int = 13 AND s -> 0 ->> 'situacao' = 'vencida', 'a locação em andamento conta os dias até hoje e vence o plano');
  PERFORM ci.exige(ci.contar(adm, 'SELECT count(*) FROM locacao_planos_manutencao') >= 1, 'a empresa lê os planos dela');

  -- vencido: não sai para um novo cliente (nem pela função, nem por ajuste direto)
  UPDATE locacoes SET situacao = 'devolvida', devolvido_em = current_date WHERE id = locc;
  INSERT INTO locacoes (tenant_id, cliente_id, equipamento_id, inicio, dias, valor_diaria, valor_total, situacao, aprovada)
    VALUES (demo, cli, eq1, current_date, 1, 100, 100, 'reservada', true) RETURNING id INTO locd;
  PERFORM ci.deve_falhar(adm, format($c$SELECT locacao_entregar(%L)$c$, locd), 'entregar equipamento com manutenção vencida');
  PERFORM ci.deve_falhar_dono(format($c$UPDATE locacoes SET situacao = 'em_andamento' WHERE id = %L$c$, locd), 'pôr em andamento equipamento com manutenção vencida, nem o dono do banco');

  -- registrar a manutenção: validações
  PERFORM ci.deve_falhar(adm, format($c$SELECT locacao_manutencao_registrar(jsonb_build_object('equipamento_id', %L, 'plano_id', %L, 'descricao', ''))$c$, eq1, plano), 'manutenção sem descrição');
  PERFORM ci.deve_falhar(adm, format($c$SELECT locacao_manutencao_registrar(jsonb_build_object('equipamento_id', %L, 'plano_id', %L, 'descricao', 'Troca de óleo', 'realizada_em', current_date + 1))$c$, eq1, plano), 'manutenção no futuro');
  PERFORM ci.deve_falhar(adm, format($c$SELECT locacao_manutencao_registrar(jsonb_build_object('equipamento_id', %L, 'plano_id', %L, 'descricao', 'Troca de óleo', 'realizada_em', current_date - 40))$c$, eq1, plano), 'manutenção anterior à última do plano');
  PERFORM ci.deve_falhar(adm, format($c$SELECT locacao_manutencao_registrar(jsonb_build_object('equipamento_id', %L, 'plano_id', %L, 'descricao', 'Troca de óleo', 'custo', 'abc'))$c$, eq1, plano), 'custo que não é número');
  PERFORM ci.deve_falhar(adm, format($c$SELECT locacao_manutencao_registrar(jsonb_build_object('equipamento_id', %L, 'plano_id', %L, 'descricao', 'Troca de óleo', 'custo', '-1'))$c$, eq1, plano), 'custo negativo');
  PERFORM ci.deve_falhar(adm, format($c$SELECT locacao_manutencao_registrar(jsonb_build_object('equipamento_id', %L, 'plano_id', %L, 'descricao', 'Troca de óleo', 'tipo', 'qualquer'))$c$, eq1, plano), 'tipo de manutenção inválido');
  PERFORM ci.deve_falhar(adm, format($c$SELECT locacao_manutencao_registrar(jsonb_build_object('equipamento_id', %L, 'plano_id', %L, 'descricao', 'Troca de óleo'))$c$, eq2, plano), 'plano de outro equipamento');

  -- registro recomeça a contagem, soma o custo e libera a entrega
  PERFORM ci.entrar(adm);
  r := locacao_manutencao_registrar(jsonb_build_object('equipamento_id', eq1, 'plano_id', plano, 'descricao', 'Troca de óleo e filtro', 'custo', '150,50', 'responsavel', 'Oficina CI'));
  s := locacao_manutencao_situacao(eq1);
  PERFORM ci.sair();
  PERFORM ci.exige((s -> 0 ->> 'dias')::int = 0 AND s -> 0 ->> 'situacao' = 'em_dia' AND (s -> 0 ->> 'restantes')::int = 12, 'registrar a manutenção recomeça a contagem do plano');
  PERFORM ci.exige((SELECT referencia_em = current_date FROM locacao_planos_manutencao WHERE id = plano), 'o plano passa a contar da data da manutenção');
  PERFORM ci.exige((SELECT custo_manutencao = 150.5 FROM locacao_equipamentos WHERE id = eq1), 'o custo da manutenção soma ao do equipamento');
  PERFORM ci.exige((SELECT tipo = 'preventiva' AND plano_id = plano AND responsavel = 'Oficina CI' FROM locacao_manutencoes WHERE id = (r ->> 'manutencao_id')::uuid), 'a manutenção fica registrada como preventiva do plano');
  PERFORM ci.entrar(adm);
  PERFORM locacao_entregar(locd);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT situacao = 'em_andamento' FROM locacoes WHERE id = locd), 'depois da manutenção o equipamento volta a poder ser entregue');
  PERFORM ci.deve_falhar(adm, format($c$SELECT locacao_manutencao_registrar(jsonb_build_object('equipamento_id', %L, 'descricao', 'Revisão'))$c$, eq1), 'registrar manutenção de equipamento locado');

  -- reparo de avaria libera o equipamento; equipamento fora de uso não volta
  PERFORM ci.entrar(adm);
  r := locacao_manutencao_registrar(jsonb_build_object('equipamento_id', eq2, 'tipo', 'corretiva', 'descricao', 'Troca do cabo', 'custo', '80'));
  PERFORM ci.sair();
  PERFORM ci.exige((r ->> 'liberado')::boolean AND (SELECT situacao = 'disponivel' FROM locacao_equipamentos WHERE id = eq2), 'reparo de avaria tira o equipamento de manutenção');
  PERFORM ci.entrar(adm);
  r := locacao_manutencao_registrar(jsonb_build_object('equipamento_id', eq3, 'tipo', 'corretiva', 'descricao', 'Tentativa de reparo'));
  PERFORM ci.sair();
  PERFORM ci.exige(NOT (r ->> 'liberado')::boolean AND (SELECT situacao = 'manutencao' AND NOT ativo FROM locacao_equipamentos WHERE id = eq3), 'equipamento fora de uso não volta para a locação');

  -- registro de manutenção não muda nem some, e não se grava à mão
  PERFORM ci.deve_falhar_dono(format($c$UPDATE locacao_manutencoes SET custo = 0 WHERE equipamento_id = %L$c$, eq1), 'alterar manutenção registrada, nem o dono do banco');
  PERFORM ci.deve_falhar_dono(format($c$DELETE FROM locacao_manutencoes WHERE equipamento_id = %L$c$, eq1), 'apagar manutenção registrada, nem o dono do banco');
  PERFORM ci.deve_falhar(adm, format($c$INSERT INTO locacao_manutencoes (equipamento_id, tipo, realizada_em, descricao) VALUES (%L, 'preventiva', current_date, 'Direto')$c$, eq1), 'gravar manutenção direto na tabela');
  PERFORM ci.deve_falhar(adm, format($c$INSERT INTO locacao_planos_manutencao (equipamento_id, nome, intervalo_dias) VALUES (%L, 'Direto', 5)$c$, eq1), 'gravar plano direto na tabela');

  -- reparo de defeito ligado a um plano não recomeça a contagem dele (só a preventiva recomeça)
  UPDATE locacoes SET situacao = 'devolvida', devolvido_em = current_date WHERE id = locd;
  PERFORM ci.entrar(adm);
  plano3 := locacao_plano_salvar(jsonb_build_object('equipamento_id', eq1, 'nome', 'Revisão do motor', 'intervalo_dias', 1, 'referencia_em', current_date - 30));
  PERFORM locacao_manutencao_registrar(jsonb_build_object('equipamento_id', eq1, 'plano_id', plano3, 'tipo', 'corretiva', 'descricao', 'Conserto do cabo'));
  s := locacao_manutencao_situacao(eq1);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT referencia_em = current_date - 30 FROM locacao_planos_manutencao WHERE id = plano3)
               AND EXISTS (SELECT 1 FROM jsonb_array_elements(s) x WHERE x ->> 'plano_id' = plano3::text AND x ->> 'situacao' = 'vencida'), 'reparo corretivo não recomeça a contagem do plano (só a preventiva)');

  -- plano desativado sai da conta e do bloqueio
  PERFORM ci.entrar(adm);
  plano2 := locacao_plano_salvar(jsonb_build_object('id', plano, 'nome', 'Troca de óleo', 'intervalo_dias', 1, 'ativo', false));
  s := locacao_manutencao_situacao(eq1);
  PERFORM ci.sair();
  PERFORM ci.exige(plano2 = plano AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(s) x WHERE x ->> 'plano_id' = plano::text), 'plano desativado deixa de aparecer e de bloquear');
END $$;

-- 57. Locação (cobrança na devolução): locação não cobrada gera as contas pelo valor final; já cobrada e atrasada gera só os dias a mais
DO $$
DECLARE
  demo constant uuid := '11111111-1111-1111-1111-111111111111';
  adm  constant uuid := 'a0000000-0000-0000-0000-000000000001';
  cli uuid; f1 uuid; f2 uuid; f3 uuid; f4 uuid; f5 uuid; l1 uuid; l2 uuid; l3 uuid; l4 uuid; l5 uuid;
  n1 integer; n2 integer; n3 integer; n4 integer; n5 integer; r jsonb;
BEGIN
  INSERT INTO clientes (tenant_id, nome, cpf) VALUES (demo, 'Cliente Cobranca Devolucao CI', '52998224725') RETURNING id INTO cli;
  INSERT INTO locacao_equipamentos (tenant_id, nome, valor_diaria) VALUES (demo, 'Cobranca 1 CI', 100) RETURNING id INTO f1;
  INSERT INTO locacao_equipamentos (tenant_id, nome, valor_diaria) VALUES (demo, 'Cobranca 2 CI', 100) RETURNING id INTO f2;
  INSERT INTO locacao_equipamentos (tenant_id, nome, valor_diaria) VALUES (demo, 'Cobranca 3 CI', 100) RETURNING id INTO f3;
  INSERT INTO locacao_equipamentos (tenant_id, nome, valor_diaria) VALUES (demo, 'Cobranca 4 CI', 100) RETURNING id INTO f4;
  INSERT INTO locacao_equipamentos (tenant_id, nome, valor_diaria) VALUES (demo, 'Cobranca 5 CI', 0) RETURNING id INTO f5;

  -- l1: não cobrada, no prazo; l2: não cobrada, atrasada; l3: cobrada e atrasada; l4: cobrada e no prazo; l5: sem valor
  INSERT INTO locacoes (tenant_id, cliente_id, equipamento_id, inicio, entregue_em, dias, valor_diaria, valor_total, valor_faturado, situacao)
    VALUES (demo, cli, f1, current_date - 3, current_date - 3, 3, 100, 300, 0, 'em_andamento') RETURNING id INTO l1;
  INSERT INTO locacoes (tenant_id, cliente_id, equipamento_id, inicio, entregue_em, dias, valor_diaria, valor_total, valor_faturado, situacao)
    VALUES (demo, cli, f2, current_date - 5, current_date - 5, 2, 100, 200, 0, 'em_andamento') RETURNING id INTO l2;
  INSERT INTO locacoes (tenant_id, cliente_id, equipamento_id, inicio, entregue_em, dias, valor_diaria, valor_total, valor_faturado, situacao)
    VALUES (demo, cli, f3, current_date - 5, current_date - 5, 2, 100, 200, 200, 'em_andamento') RETURNING id INTO l3;
  INSERT INTO locacoes (tenant_id, cliente_id, equipamento_id, inicio, entregue_em, dias, valor_diaria, valor_total, valor_faturado, situacao)
    VALUES (demo, cli, f4, current_date - 2, current_date - 2, 2, 100, 200, 200, 'em_andamento') RETURNING id INTO l4;
  INSERT INTO locacoes (tenant_id, cliente_id, equipamento_id, inicio, entregue_em, dias, valor_diaria, valor_total, valor_faturado, situacao)
    VALUES (demo, cli, f5, current_date - 1, current_date - 1, 1, 0, 0, 0, 'em_andamento') RETURNING id INTO l5;

  -- locação ainda não cobrada exige a forma de pagamento na devolução, e a recusa não deixa nada para trás
  PERFORM ci.deve_falhar(adm, format($c$SELECT locacao_devolver_vistoriada(%L, current_date, NULL, jsonb_build_array(jsonb_build_object('equipamento_id', %L)))$c$, l1, f1), 'devolver locação não cobrada sem informar a forma de pagamento');
  PERFORM ci.exige((SELECT situacao = 'em_andamento' FROM locacoes WHERE id = l1) AND NOT EXISTS (SELECT 1 FROM locacao_vistorias WHERE locacao_id = l1), 'devolução recusada pela cobrança não deixa vistoria nem encerra a locação');

  -- l1: gera as contas pelo valor final (2 parcelas de 150)
  PERFORM ci.entrar(adm);
  r := locacao_devolver_vistoriada(l1, current_date, NULL, jsonb_build_array(jsonb_build_object('equipamento_id', f1)), current_date + 5, 'boleto'::forma_pagamento, 2);
  PERFORM ci.sair();
  SELECT count(*) INTO n1 FROM contas_receber WHERE cliente_id = cli AND descricao LIKE 'Locação nº ' || (SELECT numero FROM locacoes WHERE id = l1) || ' %';
  PERFORM ci.exige(n1 = 2 AND (SELECT sum(valor) = 300 FROM contas_receber WHERE cliente_id = cli AND descricao LIKE 'Locação nº ' || (SELECT numero FROM locacoes WHERE id = l1) || ' %'), 'devolver locação não cobrada gera as contas a receber pelo valor final');
  PERFORM ci.exige((SELECT valor_faturado = 300 AND situacao = 'devolvida' FROM locacoes WHERE id = l1) AND r ->> 'locacao_conta_receber_id' IS NOT NULL AND r ->> 'extras_conta_receber_id' IS NULL, 'a locação fica faturada e devolvida');
  PERFORM ci.exige((SELECT vencimento = current_date + 5 FROM contas_receber WHERE id = (r ->> 'locacao_conta_receber_id')::uuid), 'a primeira conta vence na data escolhida');

  -- l2: atrasada e não cobrada: cobra tudo pelos dias reais (5 x 100)
  PERFORM ci.entrar(adm);
  r := locacao_devolver_vistoriada(l2, current_date, NULL, jsonb_build_array(jsonb_build_object('equipamento_id', f2)), current_date, 'boleto'::forma_pagamento, 1);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT sum(valor) = 500 FROM contas_receber WHERE cliente_id = cli AND descricao LIKE 'Locação nº ' || (SELECT numero FROM locacoes WHERE id = l2) || ' %')
               AND (SELECT valor_faturado = 500 FROM locacoes WHERE id = l2) AND r ->> 'extras_conta_receber_id' IS NULL, 'locação atrasada e não cobrada é cobrada pelos dias reais, numa conta só');

  -- l3: já cobrada e atrasada: gera só os dias a mais (3 x 100)
  PERFORM ci.entrar(adm);
  r := locacao_devolver_vistoriada(l3, current_date, NULL, jsonb_build_array(jsonb_build_object('equipamento_id', f3)), current_date + 3);
  PERFORM ci.sair();
  SELECT count(*) INTO n3 FROM contas_receber WHERE cliente_id = cli AND descricao = 'Dias a mais da locação nº ' || (SELECT numero FROM locacoes WHERE id = l3);
  PERFORM ci.exige(n3 = 1 AND (SELECT valor = 300 AND vencimento = current_date + 3 FROM contas_receber WHERE id = (r ->> 'extras_conta_receber_id')::uuid), 'locação já cobrada e atrasada gera uma conta só com os dias a mais');
  PERFORM ci.exige((SELECT valor_faturado = 500 FROM locacoes WHERE id = l3) AND r ->> 'locacao_conta_receber_id' IS NULL, 'o faturado sobe pelos dias a mais e a locação não é cobrada de novo');

  -- l4: já cobrada e no prazo: nada de novo
  PERFORM ci.entrar(adm);
  r := locacao_devolver_vistoriada(l4, current_date, NULL, jsonb_build_array(jsonb_build_object('equipamento_id', f4)));
  PERFORM ci.sair();
  SELECT count(*) INTO n4 FROM contas_receber WHERE cliente_id = cli AND descricao LIKE '%locação nº ' || (SELECT numero FROM locacoes WHERE id = l4);
  PERFORM ci.exige(n4 = 0 AND r ->> 'extras_conta_receber_id' IS NULL AND r ->> 'locacao_conta_receber_id' IS NULL AND (SELECT valor_faturado = 200 FROM locacoes WHERE id = l4), 'locação já cobrada e devolvida no prazo não gera conta nova');

  -- l5: sem valor: devolve sem exigir cobrança
  PERFORM ci.entrar(adm);
  r := locacao_devolver_vistoriada(l5, current_date, NULL, jsonb_build_array(jsonb_build_object('equipamento_id', f5)));
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT situacao = 'devolvida' FROM locacoes WHERE id = l5) AND r ->> 'locacao_conta_receber_id' IS NULL, 'locação sem valor devolve sem cobrança');
END $$;

-- 58. Clínica (anexo sem internet): reserva pela chave da operação, sem repetir; aponta para o exame aberto no notebook; reserva velha é refeita
DO $$
DECLARE
  demo constant uuid := '11111111-1111-1111-1111-111111111111';
  vend constant uuid := 'a0000000-0000-0000-0000-000000000002';
  gest constant uuid := 'a0000000-0000-0000-0000-000000000005';
  vx   constant uuid := 'a0000000-0000-0000-0000-0000000000e0';
  vy   constant uuid := 'a0000000-0000-0000-0000-0000000000e4';
  ramo_ant text; cnae_ant text; cnae2_ant text;
  tutor uuid; pet uuid; modelo uuid; campo uuid; pvx uuid; pvy uuid; atend uuid := gen_random_uuid(); cons uuid;
  ka uuid := gen_random_uuid(); kb uuid := gen_random_uuid(); kc uuid := gen_random_uuid(); kd uuid := gen_random_uuid(); ke uuid := gen_random_uuid();
  kf uuid := gen_random_uuid(); kex uuid := gen_random_uuid(); kreg uuid := gen_random_uuid();
  r jsonb; r2 jsonb; an uuid; an2 uuid; ex uuid; n bigint;
BEGIN
  SELECT ramo_atividade, cnae, cnae_secundarios INTO ramo_ant, cnae_ant, cnae2_ant FROM empresas WHERE tenant_id = demo ORDER BY created_at LIMIT 1;
  UPDATE empresas SET ramo_atividade = 'clinica' WHERE tenant_id = demo;
  INSERT INTO clientes (tenant_id, nome, cpf) VALUES (demo, 'Tutor Anexo Offline CI', '52998224725') RETURNING id INTO tutor;
  INSERT INTO auth.users (id, email) VALUES (vx, 'vetanexooff@ci'), (vy, 'vetanexooffb@ci');
  UPDATE profiles SET tenant_id = demo WHERE id IN (vx, vy);
  INSERT INTO user_roles (user_id, tenant_id, role) VALUES (vx, demo, 'veterinario'), (vy, demo, 'veterinario');
  PERFORM ci.entrar(gest);
  cons := pet_servico_salvar('{"nome":"Consulta Anexo Offline CI","categoria":"consulta","duracao_min":30}'::jsonb);
  PERFORM pet_preco_salvar(cons, NULL, NULL, NULL, 100);
  pvx := pet_profissional_salvar('{"nome":"Vet X Anexo","funcao":"veterinario","crmv":"8881","crmv_uf":"SP"}'::jsonb);
  pvy := pet_profissional_salvar('{"nome":"Vet Y Anexo","funcao":"veterinario","crmv":"8882","crmv_uf":"RJ"}'::jsonb);
  PERFORM pet_profissional_vincular(pvx, vx);
  PERFORM pet_profissional_vincular(pvy, vy);
  modelo := clinica_exame_modelo_salvar(jsonb_build_object('nome', 'Exame Anexo Offline CI', 'tipo', 'outro'));
  campo := clinica_exame_campo_salvar(jsonb_build_object('modelo_id', modelo, 'nome', 'Valor', 'forma', 'numero'));
  PERFORM ci.sair();
  PERFORM ci.entrar(vend);
  pet := pet_salvar(jsonb_build_object('cliente_id', tutor, 'nome', 'Paciente Anexo Offline CI', 'especie', 'cao'));
  PERFORM ci.sair();

  -- só o veterinário
  PERFORM ci.deve_falhar(gest, format($c$SELECT clinica_anexo_offline_preparar(%L, jsonb_build_object('atendimento_id', %L, 'categoria', 'imagem', 'descricao', 'x', 'nome_arquivo', 'x.png', 'mime', 'image/png', 'tamanho', 100))$c$, gen_random_uuid(), atend), 'gestor reserva anexo sem internet');
  PERFORM ci.deve_falhar(vend, format($c$SELECT clinica_anexo_offline_preparar(%L, jsonb_build_object('atendimento_id', %L, 'categoria', 'imagem', 'descricao', 'x', 'nome_arquivo', 'x.png', 'mime', 'image/png', 'tamanho', 100))$c$, gen_random_uuid(), atend), 'recepção reserva anexo sem internet');

  -- o atendimento nasce no notebook; o anexo aponta para o id dele
  PERFORM ci.entrar(vx);
  PERFORM clinica_visita_registrar(kreg, jsonb_build_object('atendimento_id', atend, 'pet_id', pet, 'servico_id', cons));
  r := clinica_anexo_offline_preparar(ka, jsonb_build_object('atendimento_id', atend, 'categoria', 'imagem', 'descricao', 'Raio-x do tórax', 'nome_arquivo', 'rx.png', 'mime', 'image/png', 'tamanho', 4096));
  r2 := clinica_anexo_offline_preparar(ka, jsonb_build_object('atendimento_id', atend, 'categoria', 'imagem', 'descricao', 'Raio-x do tórax', 'nome_arquivo', 'rx.png', 'mime', 'image/png', 'tamanho', 4096));
  PERFORM ci.sair();
  an := (r ->> 'anexo_id')::uuid;
  PERFORM ci.exige((r ->> 'situacao') = 'pendente' AND NOT (r ->> 'repetido')::boolean AND (SELECT atendimento_id = atend AND situacao = 'pendente' AND tamanho = 4096 FROM pet_exame_anexos WHERE id = an), 'a reserva do anexo aponta para o atendimento nascido no notebook');
  PERFORM ci.exige((r2 ->> 'repetido')::boolean AND r2 ->> 'anexo_id' = r ->> 'anexo_id' AND r2 ->> 'caminho' = r ->> 'caminho' AND (SELECT count(*) = 1 FROM pet_exame_anexos WHERE atendimento_id = atend), 'reenviar a mesma chave devolve a mesma reserva, sem criar outra');

  -- depois do envio e da confirmação, repetir a operação só avisa que o anexo já vale
  PERFORM ci.entrar(vx);
  EXECUTE format($c$INSERT INTO storage.objects (bucket_id, name, owner, metadata) VALUES ('clinica-anexos', %L, %L, '{"size":4096,"mimetype":"image/png"}')$c$, r ->> 'caminho', vx);
  PERFORM clinica_anexo_confirmar(an);
  r2 := clinica_anexo_offline_preparar(ka, jsonb_build_object('atendimento_id', atend, 'categoria', 'imagem', 'descricao', 'Raio-x do tórax', 'nome_arquivo', 'rx.png', 'mime', 'image/png', 'tamanho', 4096));
  PERFORM ci.sair();
  PERFORM ci.exige((r2 ->> 'situacao') = 'ativo' AND (r2 ->> 'repetido')::boolean AND (SELECT count(*) = 1 FROM pet_exame_anexos WHERE atendimento_id = atend), 'anexo já confirmado: repetir a operação não reserva outro');

  -- chave de outro veterinário ou de outro tipo de operação é recusada
  PERFORM ci.deve_falhar(vy, format($c$SELECT clinica_anexo_offline_preparar(%L, jsonb_build_object('atendimento_id', %L, 'categoria', 'imagem', 'descricao', 'x', 'nome_arquivo', 'x.png', 'mime', 'image/png', 'tamanho', 100))$c$, ka, atend), 'chave de reserva de outro veterinário');
  PERFORM ci.deve_falhar(vx, format($c$SELECT clinica_anexo_offline_preparar(%L, jsonb_build_object('atendimento_id', %L, 'categoria', 'imagem', 'descricao', 'x', 'nome_arquivo', 'x.png', 'mime', 'image/png', 'tamanho', 100))$c$, kreg, atend), 'chave de outro tipo de operação');

  -- regras do anexo normal continuam valendo (a reserva falha inteira e a chave fica livre)
  PERFORM ci.deve_falhar(vx, format($c$SELECT clinica_anexo_offline_preparar(%L, jsonb_build_object('atendimento_id', %L, 'categoria', 'imagem', 'descricao', 'x', 'nome_arquivo', 'x.zip', 'mime', 'application/zip', 'tamanho', 100))$c$, kb, atend), 'formato que não é JPEG, PNG nem PDF');
  PERFORM ci.deve_falhar(vx, format($c$SELECT clinica_anexo_offline_preparar(%L, jsonb_build_object('atendimento_id', %L, 'categoria', 'imagem', 'descricao', 'x', 'nome_arquivo', 'x.png', 'mime', 'image/png', 'tamanho', 15728641))$c$, kb, atend), 'arquivo acima de 15 MB');
  SELECT count(*) INTO n FROM clinica_operacoes_offline WHERE chave = kb;
  PERFORM ci.exige(n = 0, 'reserva recusada não grava a chave');
  PERFORM ci.deve_falhar(vx, format($c$SELECT clinica_anexo_offline_preparar(%L, jsonb_build_object('exame_abrir_chave', %L, 'categoria', 'laudo', 'descricao', 'x', 'nome_arquivo', 'x.pdf', 'mime', 'application/pdf', 'tamanho', 100))$c$, kc, gen_random_uuid()), 'anexo de exame cuja abertura não chegou ao servidor');

  -- exame aberto no notebook: o anexo aponta para a chave da abertura
  PERFORM ci.entrar(vx);
  r := clinica_exame_offline(kex, 'abrir', jsonb_build_object('pet_id', pet, 'modelo_id', modelo, 'atendimento_id', atend));
  ex := (r ->> 'exame_id')::uuid;
  r := clinica_anexo_offline_preparar(kd, jsonb_build_object('exame_abrir_chave', kex, 'categoria', 'laboratorial', 'descricao', 'Hemograma do laboratório', 'nome_arquivo', 'hemo.pdf', 'mime', 'application/pdf', 'tamanho', 8000));
  PERFORM ci.sair();
  an2 := (r ->> 'anexo_id')::uuid;
  PERFORM ci.exige((SELECT exame_id = ex AND atendimento_id IS NULL AND categoria = 'laboratorial' FROM pet_exame_anexos WHERE id = an2), 'o anexo do exame aberto no notebook aponta para o exame criado pela chave da abertura');

  -- reserva de mais de 50 minutos sem envio é refeita (o armazenamento só aceita o envio na primeira hora); a chave guarda a mais nova
  ALTER TABLE pet_exame_anexos DISABLE TRIGGER trg_clinica_anexo_guarda;
  UPDATE pet_exame_anexos SET created_at = now() - interval '2 hours' WHERE id = an2;
  ALTER TABLE pet_exame_anexos ENABLE TRIGGER trg_clinica_anexo_guarda;
  PERFORM ci.entrar(vx);
  r2 := clinica_anexo_offline_preparar(kd, jsonb_build_object('exame_abrir_chave', kex, 'categoria', 'laboratorial', 'descricao', 'Hemograma do laboratório', 'nome_arquivo', 'hemo.pdf', 'mime', 'application/pdf', 'tamanho', 8000));
  PERFORM ci.sair();
  PERFORM ci.exige((r2 ->> 'anexo_id') <> (r ->> 'anexo_id') AND NOT (r2 ->> 'repetido')::boolean AND (SELECT (resultado ->> 'anexo_id') = r2 ->> 'anexo_id' FROM clinica_operacoes_offline WHERE chave = kd),
                   'reserva antiga sem envio é refeita e a chave passa a apontar para a nova');

  -- reserva velha cujo arquivo já chegou ao armazenamento (só a confirmação se perdeu): continua a mesma, não se refaz
  ALTER TABLE pet_exame_anexos DISABLE TRIGGER trg_clinica_anexo_guarda;
  UPDATE pet_exame_anexos SET created_at = now() - interval '2 hours' WHERE id = (r2 ->> 'anexo_id')::uuid;
  ALTER TABLE pet_exame_anexos ENABLE TRIGGER trg_clinica_anexo_guarda;
  EXECUTE format($c$INSERT INTO storage.objects (bucket_id, name, owner, metadata) VALUES ('clinica-anexos', %L, %L, '{"size":8000,"mimetype":"application/pdf"}')$c$, r2 ->> 'caminho', vx);
  PERFORM ci.entrar(vx);
  r := clinica_anexo_offline_preparar(kd, jsonb_build_object('exame_abrir_chave', kex, 'categoria', 'laboratorial', 'descricao', 'Hemograma do laboratório', 'nome_arquivo', 'hemo.pdf', 'mime', 'application/pdf', 'tamanho', 8000));
  PERFORM ci.sair();
  PERFORM ci.exige((r ->> 'anexo_id') = (r2 ->> 'anexo_id') AND (r ->> 'repetido')::boolean AND (r ->> 'caminho') = (r2 ->> 'caminho'),
                   'reserva velha com o arquivo já no armazenamento é reaproveitada para só confirmar');

  -- clínica deixa de estar liberada
  UPDATE empresas SET ramo_atividade = 'petshop', cnae = '4789-0/04', cnae_secundarios = NULL WHERE tenant_id = demo;
  PERFORM ci.deve_falhar(vx, format($c$SELECT clinica_anexo_offline_preparar(%L, jsonb_build_object('atendimento_id', %L, 'categoria', 'imagem', 'descricao', 'x', 'nome_arquivo', 'x.png', 'mime', 'image/png', 'tamanho', 100))$c$, ke, atend), 'anexo sem a clínica liberada');
  UPDATE empresas SET ramo_atividade = ramo_ant, cnae = cnae_ant, cnae_secundarios = cnae2_ant WHERE tenant_id = demo;
END $$;

-- 59. Clínica (Prontuário): serviços de consulta para iniciar atendimento sem consulta marcada; só o veterinário, só com a clínica liberada
DO $$
DECLARE
  demo constant uuid := '11111111-1111-1111-1111-111111111111';
  vend constant uuid := 'a0000000-0000-0000-0000-000000000002';
  gest constant uuid := 'a0000000-0000-0000-0000-000000000005';
  vz   constant uuid := 'a0000000-0000-0000-0000-0000000000e5';
  ramo_ant text; cnae_ant text; cnae2_ant text;
  tutor uuid; pet uuid; cons uuid; pvz uuid; atend uuid := gen_random_uuid(); chave uuid := gen_random_uuid();
  r jsonb; lista jsonb;
BEGIN
  SELECT ramo_atividade, cnae, cnae_secundarios INTO ramo_ant, cnae_ant, cnae2_ant FROM empresas WHERE tenant_id = demo ORDER BY created_at LIMIT 1;
  UPDATE empresas SET ramo_atividade = 'clinica' WHERE tenant_id = demo;
  INSERT INTO clientes (tenant_id, nome, cpf) VALUES (demo, 'Tutor Iniciar Atendimento CI', '52998224725') RETURNING id INTO tutor;
  INSERT INTO auth.users (id, email) VALUES (vz, 'vetiniciar@ci');
  UPDATE profiles SET tenant_id = demo WHERE id = vz;
  INSERT INTO user_roles (user_id, tenant_id, role) VALUES (vz, demo, 'veterinario');
  PERFORM ci.entrar(gest);
  cons := pet_servico_salvar('{"nome":"Consulta Iniciar CI","categoria":"consulta","duracao_min":30}'::jsonb);
  PERFORM pet_preco_salvar(cons, NULL, NULL, NULL, 120);
  pvz := pet_profissional_salvar('{"nome":"Vet Z Iniciar","funcao":"veterinario","crmv":"8883","crmv_uf":"SP"}'::jsonb);
  PERFORM pet_profissional_vincular(pvz, vz);
  PERFORM ci.sair();
  PERFORM ci.entrar(vend);
  pet := pet_salvar(jsonb_build_object('cliente_id', tutor, 'nome', 'Paciente Iniciar CI', 'especie', 'gato'));
  PERFORM ci.sair();

  PERFORM ci.entrar(vz);
  lista := clinica_servicos_consulta();
  PERFORM ci.sair();
  PERFORM ci.exige(EXISTS (SELECT 1 FROM jsonb_array_elements(lista) x WHERE x ->> 'id' = cons::text AND (x ->> 'duracao_min')::int = 30), 'o veterinário lista o serviço de consulta ativo');
  PERFORM ci.exige(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(lista) x WHERE x ->> 'id' IN (SELECT id::text FROM pet_servicos WHERE categoria <> 'consulta')), 'só serviços de consulta');
  PERFORM ci.deve_falhar(gest, 'SELECT clinica_servicos_consulta()', 'gestor lista os serviços de consulta da clínica');
  PERFORM ci.deve_falhar(vend, 'SELECT clinica_servicos_consulta()', 'recepção lista os serviços de consulta da clínica');

  -- iniciar o atendimento no Prontuário é a mesma visita avulsa do trabalho sem internet; repetir a chave não duplica
  PERFORM ci.entrar(vz);
  r := clinica_visita_registrar(chave, jsonb_build_object('atendimento_id', atend, 'pet_id', pet, 'servico_id', cons, 'aberto_em', now()));
  PERFORM ci.exige(r ->> 'modo' = 'visita_avulsa' AND NOT (r ->> 'repetido')::boolean, 'atendimento iniciado sem consulta marcada');
  r := clinica_visita_registrar(chave, jsonb_build_object('atendimento_id', atend, 'pet_id', pet, 'servico_id', cons, 'aberto_em', now()));
  PERFORM ci.sair();
  PERFORM ci.exige((r ->> 'repetido')::boolean AND (SELECT count(*) FROM pet_atendimentos_clinicos WHERE pet_id = pet) = 1, 'repetir o início do atendimento não cria outro');

  UPDATE empresas SET ramo_atividade = 'petshop', cnae = '4789-0/04', cnae_secundarios = NULL WHERE tenant_id = demo;
  PERFORM ci.deve_falhar(vz, 'SELECT clinica_servicos_consulta()', 'serviços de consulta sem a clínica liberada');
  UPDATE empresas SET ramo_atividade = ramo_ant, cnae = cnae_ant, cnae_secundarios = cnae2_ant WHERE tenant_id = demo;
END $$;
