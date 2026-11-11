-- Acesso do contador: restrito a uma empresa, só lê notas autorizadas/canceladas dela, não vê nada do resto, e só edita tributos quando liberado; revogar fecha tudo.
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
-- Falha com mensagem que contenha o trecho informado.
CREATE FUNCTION ci.deve_falhar_msg(uid uuid, cmd text, trecho text, descricao text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE msg text := NULL;
BEGIN
  PERFORM ci.entrar(uid);
  BEGIN EXECUTE cmd; EXCEPTION WHEN OTHERS THEN msg := SQLERRM; END;
  PERFORM ci.sair();
  IF msg IS NULL THEN RAISE EXCEPTION 'FALHA: esperava erro em "%"', descricao; END IF;
  IF position(trecho IN msg) = 0 THEN RAISE EXCEPTION 'FALHA: "%" falhou com "%" (esperava "%")', descricao, msg, trecho; END IF;
  RAISE NOTICE 'ok: % recusado (%)', descricao, trecho;
END $$;
CREATE FUNCTION ci.exige(condicao boolean, descricao text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF condicao IS NOT TRUE THEN RAISE EXCEPTION 'FALHA: %', descricao; END IF;
  RAISE NOTICE 'ok: %', descricao;
END $$;
-- Chama como a pessoa indicada e devolve o jsonb.
CREATE FUNCTION ci.como(uid uuid, cmd text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  PERFORM ci.entrar(uid);
  EXECUTE cmd INTO r;
  PERFORM ci.sair();
  RETURN r;
END $$;
-- Roda como a pessoa indicada, sem esperar retorno (funções void).
CREATE FUNCTION ci.rodar(uid uuid, cmd text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM ci.entrar(uid);
  EXECUTE cmd;
  PERFORM ci.sair();
END $$;

-- Número inteiro devolvido por uma consulta feita como a pessoa indicada.
CREATE FUNCTION ci.contar(uid uuid, cmd text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  PERFORM ci.entrar(uid);
  EXECUTE cmd INTO n;
  PERFORM ci.sair();
  RETURN n;
END $$;
-- Linhas afetadas por um UPDATE ou DELETE feito como a pessoa indicada (RLS filtra em silêncio).
CREATE FUNCTION ci.afetadas(uid uuid, cmd text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  PERFORM ci.entrar(uid);
  BEGIN EXECUTE cmd; GET DIAGNOSTICS n = ROW_COUNT; EXCEPTION WHEN OTHERS THEN n := -1; END;
  PERFORM ci.sair();
  RETURN n;
END $$;
-- Linhas devolvidas por uma consulta feita como a pessoa indicada.
CREATE FUNCTION ci.como_linhas(uid uuid, cmd text) RETURNS TABLE (linha jsonb) LANGUAGE plpgsql AS $$
BEGIN
  PERFORM ci.entrar(uid);
  RETURN QUERY EXECUTE format('SELECT to_jsonb(t) FROM (%s) t', cmd);
  PERFORM ci.sair();
END $$;

DO $$
DECLARE
  ta constant uuid := 'f5111111-1111-1111-1111-111111111111';
  tb constant uuid := 'f5222222-2222-2222-2222-222222222222';
  adm constant uuid := 'f5000000-0000-0000-0000-000000000001';
  ges constant uuid := 'f5000000-0000-0000-0000-000000000002';
  vend constant uuid := 'f5000000-0000-0000-0000-000000000003';
  cont constant uuid := 'f5000000-0000-0000-0000-000000000004';
  admb constant uuid := 'f5000000-0000-0000-0000-000000000005';
  cont2 constant uuid := 'f5000000-0000-0000-0000-000000000006';
  e1 uuid; e2 uuid; eb uuid; n1 uuid; n2 uuid; n3 uuid; nb uuid; n integer; v_id uuid;
BEGIN
  INSERT INTO tenants (id, nome) VALUES (ta, 'Conta F'), (tb, 'Conta G');
  INSERT INTO empresas (tenant_id, razao_social, ramo_atividade, regime_tributario) VALUES (ta, 'F1 LTDA', 'comercio', 'simples_nacional') RETURNING id INTO e1;
  INSERT INTO empresas (tenant_id, razao_social, ramo_atividade, regime_tributario) VALUES (ta, 'F2 LTDA', 'comercio', 'simples_nacional') RETURNING id INTO e2;
  INSERT INTO empresas (tenant_id, razao_social, ramo_atividade, regime_tributario) VALUES (tb, 'G LTDA', 'comercio', 'simples_nacional') RETURNING id INTO eb;
  INSERT INTO auth.users (id, email) VALUES (adm, 'a@f.ci'), (ges, 'g@f.ci'), (vend, 'v@f.ci'), (cont, 'c@f.ci'), (admb, 'b@g.ci'), (cont2, 'c2@f.ci');
  UPDATE profiles SET tenant_id = ta, nome = 'adm' WHERE id = adm;
  UPDATE profiles SET tenant_id = ta, nome = 'ges' WHERE id = ges;
  UPDATE profiles SET tenant_id = ta, nome = 'vend' WHERE id = vend;
  UPDATE profiles SET tenant_id = ta, nome = 'cont' WHERE id = cont;
  UPDATE profiles SET tenant_id = ta, nome = 'cont2' WHERE id = cont2;
  UPDATE profiles SET tenant_id = tb, nome = 'admb' WHERE id = admb;
  DELETE FROM user_roles WHERE user_id IN (adm, ges, vend, cont, cont2, admb);
  INSERT INTO user_roles (user_id, tenant_id, role) VALUES
    (adm, ta, 'administrador'), (ges, ta, 'gestor'), (vend, ta, 'vendedor'), (admb, tb, 'administrador');
  INSERT INTO nfe (tenant_id, empresa_id, numero, situacao) VALUES (ta, e1, 1, 'autorizada') RETURNING id INTO n1;
  INSERT INTO nfe (tenant_id, empresa_id, numero, situacao) VALUES (ta, e1, 2, 'rascunho') RETURNING id INTO n3;
  INSERT INTO nfe (tenant_id, empresa_id, numero, situacao) VALUES (ta, e2, 3, 'autorizada') RETURNING id INTO n2;
  INSERT INTO nfe (tenant_id, empresa_id, numero, situacao) VALUES (tb, eb, 4, 'autorizada') RETURNING id INTO nb;
  INSERT INTO nfe_itens (tenant_id, nfe_id, descricao) VALUES (ta, n1, 'item e1'), (ta, n2, 'item e2'), (ta, n3, 'item rascunho'), (tb, nb, 'item g');

  -- conceder: só administrador; empresa e pessoa da própria conta; sem conta de funcionário; sem edição com 2 empresas
  PERFORM ci.deve_falhar_msg(ges, format($c$SELECT public.contador_conceder(%L, %L)$c$, cont, e1), 'administrador', 'gestor não libera contador');
  PERFORM ci.deve_falhar_msg(vend, format($c$SELECT public.contador_conceder(%L, %L)$c$, cont, e1), 'administrador', 'vendedor não libera contador');
  PERFORM ci.deve_falhar_msg(adm, format($c$SELECT public.contador_conceder(%L, %L)$c$, cont, eb), 'Empresa não encontrada', 'empresa de outra conta');
  PERFORM ci.deve_falhar_msg(adm, format($c$SELECT public.contador_conceder(%L, %L)$c$, admb, e1), 'Pessoa não encontrada', 'pessoa de outra conta');
  PERFORM ci.deve_falhar_msg(adm, format($c$SELECT public.contador_conceder(%L, %L)$c$, vend, e1), 'outro perfil', 'conta de funcionário não vira contador');
  PERFORM ci.deve_falhar_msg(adm, format($c$SELECT public.contador_conceder(%L, %L)$c$, adm, e1), 'se dar', 'ninguém se dá o acesso');
  PERFORM ci.deve_falhar_msg(adm, format($c$SELECT public.contador_conceder(%L, %L, true)$c$, cont, e1), 'mais de uma empresa', 'edição tributária recusada com 2 empresas');
  -- antes de conceder, a pessoa (sem papel) não enxerga o que é só de quem tem papel
  PERFORM ci.rodar(adm, format($c$SELECT public.contador_conceder(%L, %L)$c$, cont, e1));
  PERFORM ci.deve_falhar_msg(adm, format($c$SELECT public.contador_conceder(%L, %L)$c$, cont, e1), 'já tem acesso', 'acesso duplicado');

  -- leitura: só notas autorizadas/canceladas da empresa autorizada
  PERFORM ci.exige(ci.contar(cont, 'SELECT count(*) FROM nfe') = 1, 'contador lê 1 nota (autorizada da empresa dele)');
  PERFORM ci.exige(ci.contar(cont, format($c$SELECT count(*) FROM nfe WHERE id = %L$c$, n2)) = 0, 'contador não lê nota de outra empresa da mesma conta');
  PERFORM ci.exige(ci.contar(cont, format($c$SELECT count(*) FROM nfe WHERE id = %L$c$, n3)) = 0, 'contador não lê rascunho');
  PERFORM ci.exige(ci.contar(cont, format($c$SELECT count(*) FROM nfe WHERE id = %L$c$, nb)) = 0, 'contador não lê nota de outra conta');
  PERFORM ci.exige(ci.contar(cont, 'SELECT count(*) FROM nfe_itens') = 1, 'contador lê só os itens da nota liberada');
  PERFORM ci.exige(ci.contar(cont, 'SELECT count(*) FROM empresas') = 1, 'contador vê só a empresa autorizada');
  PERFORM ci.exige(ci.contar(cont, 'SELECT count(*) FROM profiles') = 1, 'contador vê só o próprio perfil');
  PERFORM ci.exige(ci.contar(cont, 'SELECT count(*) FROM user_roles') = 1, 'contador vê só o próprio papel');
  -- o resto do sistema
  PERFORM ci.exige(ci.contar(cont, 'SELECT count(*) FROM produtos') = 0, 'contador não lê produtos');
  PERFORM ci.exige(ci.contar(cont, 'SELECT count(*) FROM clientes') = 0, 'contador não lê clientes');
  PERFORM ci.exige(ci.contar(cont, 'SELECT count(*) FROM contas_receber') = 0, 'contador não lê financeiro');
  PERFORM ci.exige(ci.contar(cont, 'SELECT count(*) FROM auditoria') = 0, 'contador não lê auditoria');
  PERFORM ci.exige(ci.contar(cont, 'SELECT count(*) FROM storage.objects') = 0, 'contador não lê arquivos');
  PERFORM ci.exige(ci.afetadas(cont, format($c$UPDATE nfe SET numero = 99 WHERE id = %L$c$, n1)) <= 0, 'contador altera nota');
  PERFORM ci.exige(ci.contar(adm, format($c$SELECT count(*) FROM nfe WHERE id = %L AND numero = 1$c$, n1)) = 1, 'nota intacta depois da tentativa');
  PERFORM ci.deve_falhar(cont, format($c$INSERT INTO nfe (tenant_id, empresa_id, numero, situacao) VALUES (%L, %L, 77, 'autorizada')$c$, ta, e1), 'contador cria nota');
  PERFORM ci.exige(ci.afetadas(cont, format($c$DELETE FROM nfe WHERE id = %L$c$, n1)) <= 0, 'contador apaga nota');
  PERFORM ci.exige(ci.afetadas(cont, format($c$UPDATE profiles SET empresa_id = %L WHERE id = %L$c$, e2, cont)) <= 0, 'contador troca a própria empresa');
  PERFORM ci.deve_falhar(cont, format($c$INSERT INTO user_roles (user_id, tenant_id, role) VALUES (%L, %L, 'administrador')$c$, cont, ta), 'contador se dá papel');
  PERFORM ci.deve_falhar(cont, format($c$INSERT INTO contador_acessos (tenant_id, empresa_id, user_id, concedido_por) VALUES (%L, %L, %L, %L)$c$, ta, e2, cont, cont), 'contador se dá acesso a outra empresa');
  PERFORM ci.exige(ci.contar(cont, 'SELECT count(*) FROM contador_acessos') = 0, 'contador não lê a tabela de acessos');
  -- funções: sem a trava, tudo que é de operação fica fora
  PERFORM ci.deve_falhar_msg(cont, 'SELECT public.contador_acessos_listar()', 'não tem acesso', 'contador não lista acessos');
  PERFORM ci.deve_falhar_msg(cont, format($c$SELECT public.contador_conceder(%L, %L)$c$, cont2, e2), 'não tem acesso', 'contador não concede acesso');
  PERFORM ci.deve_falhar_msg(cont, format($c$SELECT public.contador_revogar(%L)$c$, cont), 'não tem acesso', 'contador não revoga');
  -- sem permissão de edição tributária, as funções tributárias recusam
  PERFORM ci.deve_falhar_msg(cont, 'SELECT public.fiscal_empresa_minhas()', 'não permite alterar a parte tributária', 'sem permissão: regras fiscais');
  PERFORM ci.deve_falhar_msg(cont, $c$SELECT public.tributos_aprox_ajustar('12345678', 1, 1, 1, 1, current_date + 30, 'orientação do contador')$c$, 'não permite alterar a parte tributária', 'sem permissão: ajuste IBPT');
  PERFORM ci.exige(ci.contar(cont, 'SELECT count(*) FROM tributos_aprox_ncm') = 0, 'sem permissão: não lê tabela IBPT');
  PERFORM ci.exige((SELECT count(*) FROM ci.como_linhas(cont, 'SELECT * FROM public.contador_meu_acesso()')) = 1, 'contador consulta o próprio acesso');

  -- administrador e gestor listam
  PERFORM ci.exige((SELECT count(*) FROM ci.como_linhas(ges, 'SELECT * FROM public.contador_acessos_listar()')) = 1, 'gestor lista os acessos');
  PERFORM ci.exige(ci.contar(adm, 'SELECT count(*) FROM nfe') = 3, 'administrador continua vendo as notas da conta');
  PERFORM ci.exige(ci.contar(adm, format($c$SELECT count(*) FROM contador_acessos WHERE tenant_id = %L$c$, ta)) = 1, 'administrador lê os acessos');
  PERFORM ci.exige(ci.contar(admb, format($c$SELECT count(*) FROM contador_acessos WHERE tenant_id = %L$c$, ta)) = 0, 'outra conta não lê os acessos');
  PERFORM ci.deve_falhar_msg(admb, format($c$SELECT public.contador_revogar(%L)$c$, cont), 'não encontrado', 'outra conta não revoga');

  -- revogar fecha tudo
  PERFORM ci.rodar(adm, format($c$SELECT public.contador_revogar(%L)$c$, cont));
  PERFORM ci.exige(ci.contar(cont, 'SELECT count(*) FROM nfe') = 0, 'revogado: não lê notas');
  PERFORM ci.exige(ci.contar(cont, 'SELECT count(*) FROM empresas') = 0, 'revogado: não lê empresas');
  PERFORM ci.exige(ci.contar(cont, 'SELECT count(*) FROM tenants') = 0, 'revogado: não lê a conta');
  PERFORM ci.exige((SELECT count(*) FROM ci.como_linhas(cont, 'SELECT * FROM public.contador_meu_acesso()')) = 0, 'revogado: sem acesso na consulta');
  PERFORM ci.exige((SELECT count(*) FROM auditoria WHERE tenant_id = ta AND entidade = 'contador_acessos') = 2, 'conceder e revogar auditados');

  -- conta com uma empresa só: edição tributária liberada e limitada às funções tributárias
  DELETE FROM nfe_itens WHERE tenant_id = ta; DELETE FROM nfe WHERE tenant_id = ta; DELETE FROM empresas WHERE id = e2;
  PERFORM ci.rodar(adm, format($c$SELECT public.contador_conceder(%L, %L, true)$c$, cont2, e1));
  INSERT INTO tributos_aprox_ncm (tenant_id, ncm, aliq_nacional_federal, aliq_importado_federal, aliq_estadual, aliq_municipal)
    VALUES (ta, '12345678', 5, 6, 7, 0);
  PERFORM ci.exige(ci.contar(cont2, 'SELECT count(*) FROM tributos_aprox_ncm') = 1, 'contador com permissão lê a tabela IBPT');
  PERFORM ci.rodar(cont2, $c$SELECT public.tributos_aprox_ajustar('12345678', 4, 5, 6, 0, current_date + 30, 'orientação do contador')$c$);
  PERFORM ci.exige((SELECT count(*) FROM tributos_aprox_ajuste WHERE tenant_id = ta AND criado_por = cont2) = 1, 'ajuste feito pelo contador, com autor');
  PERFORM ci.exige((SELECT count(*) FROM auditoria WHERE tenant_id = ta AND entidade = 'tributos_aprox_ajuste' AND usuario_id = cont2) = 1, 'ajuste do contador auditado');
  PERFORM ci.exige(ci.afetadas(cont2, format($c$UPDATE tributos_aprox_ncm SET aliq_estadual = 0 WHERE tenant_id = %L$c$, ta)) <= 0, 'contador altera a base IBPT direto');
  PERFORM ci.deve_falhar_msg(cont2, $c$SELECT public.tributos_aprox_importar('[]'::jsonb)$c$, 'não tem acesso', 'contador não importa a base IBPT');
  PERFORM ci.rodar(cont2, $c$SELECT public.fiscal_empresa_minhas()$c$);
  PERFORM ci.exige(ci.contar(cont2, 'SELECT count(*) FROM produtos') = 0, 'contador com permissão continua sem ler produtos');
  -- segunda empresa criada DEPOIS da concessão: a edição tributária fecha na hora (a conta passa a ter dois CNPJs)
  INSERT INTO empresas (tenant_id, razao_social, ramo_atividade, regime_tributario) VALUES (ta, 'F3 LTDA', 'comercio', 'simples_nacional');
  PERFORM ci.deve_falhar_msg(cont2, $c$SELECT public.fiscal_empresa_minhas()$c$, 'não permite alterar a parte tributária', 'segunda empresa criada depois: regras fiscais');
  PERFORM ci.deve_falhar_msg(cont2, $c$SELECT public.tributos_aprox_ajustar('12345678', 1, 1, 1, 1, current_date + 30, 'orientação do contador')$c$, 'não permite alterar a parte tributária', 'segunda empresa criada depois: ajuste IBPT');
  PERFORM ci.exige(ci.contar(cont2, 'SELECT count(*) FROM tributos_aprox_ncm') = 0, 'segunda empresa criada depois: não lê a base IBPT');
  PERFORM ci.exige(ci.contar(cont2, 'SELECT count(*) FROM empresas') = 1, 'segunda empresa criada depois: contador vê só a empresa dele');
  DELETE FROM empresas WHERE razao_social = 'F3 LTDA' AND tenant_id = ta;
  PERFORM ci.exige(ci.contar(cont2, 'SELECT count(*) FROM tributos_aprox_ncm') = 1, 'com uma empresa de novo: lê a base IBPT');
  PERFORM ci.rodar(adm, format($c$SELECT public.contador_revogar(%L)$c$, cont2));
  PERFORM ci.deve_falhar_msg(cont2, $c$SELECT public.fiscal_empresa_minhas()$c$, 'não permite alterar a parte tributária', 'revogado: regras fiscais');
  PERFORM ci.deve_falhar_msg(cont2, $c$SELECT public.tributos_aprox_ajustar('12345678', 1, 1, 1, 1, current_date + 30, 'orientação do contador')$c$, 'não permite alterar a parte tributária', 'revogado: ajuste IBPT');
  RAISE NOTICE 'contador: tudo ok';
END $$;
ROLLBACK;
