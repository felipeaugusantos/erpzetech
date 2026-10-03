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
  v_res text; prod uuid; est uuid; dep_est uuid; dep_novo uuid; qtd_antes numeric; qtd_depois numeric;
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

  -- 13. webhooks: tabela e funções só para o service_role; idempotência e reprocessamento
  PERFORM ci.deve_falhar(adm, 'SELECT count(*) FROM webhook_eventos', 'usuário lê webhook_eventos');
  PERFORM ci.deve_falhar(NULL, 'SELECT count(*) FROM webhook_eventos', 'anon lê webhook_eventos');
  PERFORM ci.deve_falhar(adm, $c$SELECT webhook_registrar('pix', 'x')$c$, 'usuário executa webhook_registrar');
  PERFORM ci.deve_falhar(NULL, $c$SELECT webhook_concluir('pix', 'x', 'processado')$c$, 'anon executa webhook_concluir');

  EXECUTE 'SET ROLE service_role';
  SELECT webhook_registrar('pix', 'evt-1', NULL, '{"a":1}'::jsonb) INTO v_res;
  PERFORM ci.exige(v_res = 'novo', 'primeiro registro do evento é novo');
  SELECT webhook_registrar('pix', 'evt-1') INTO v_res;
  PERFORM ci.exige(v_res = 'duplicado', 'evento em processamento é duplicado');
  SELECT webhook_registrar('boleto', 'evt-1') INTO v_res;
  PERFORM ci.exige(v_res = 'novo', 'mesmo id em outro provedor é outro evento');
  PERFORM webhook_concluir('pix', 'evt-1', 'erro', 'falhou');
  SELECT webhook_registrar('pix', 'evt-1') INTO v_res;
  PERFORM ci.exige(v_res = 'reprocessar', 'evento com erro pode ser reprocessado');
  PERFORM webhook_concluir('pix', 'evt-1', 'processado');
  SELECT webhook_registrar('pix', 'evt-1') INTO v_res;
  PERFORM ci.exige(v_res = 'duplicado', 'evento processado não é reprocessado');
  EXECUTE 'RESET ROLE';
  PERFORM ci.exige((SELECT tentativas FROM webhook_eventos WHERE provedor = 'pix' AND event_id = 'evt-1') = 2,
                   'tentativas contam o reprocessamento');

  UPDATE webhook_eventos SET recebido_em = now() - interval '10 minutes'
   WHERE provedor = 'boleto' AND event_id = 'evt-1';
  EXECUTE 'SET ROLE service_role';
  SELECT webhook_registrar('boleto', 'evt-1') INTO v_res;
  PERFORM ci.exige(v_res = 'reprocessar', 'evento preso em recebido há mais de 5 minutos é reprocessado');
  SELECT webhook_registrar('boleto', 'evt-1') INTO v_res;
  PERFORM ci.exige(v_res = 'duplicado', 'a trava impede processamento em paralelo');
  EXECUTE 'RESET ROLE';
END $$;
