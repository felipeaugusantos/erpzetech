-- Testes comportamentais dos sinais vitais da internação: catálogo por empresa, registro, histórico, correção sem perda,
-- permissões (veterinário e auxiliar; recepção e gestão não leem), isolamento entre empresas e repetição. Dados fictícios; ROLLBACK.
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
CREATE FUNCTION ci.exige(condicao boolean, descricao text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF condicao IS NOT TRUE THEN RAISE EXCEPTION 'FALHA: %', descricao; END IF;
  RAISE NOTICE 'ok: %', descricao;
END $$;
-- executa como o usuário e devolve o jsonb; precisa falhar quando for o caso
CREATE FUNCTION ci.deve_falhar(uid uuid, cmd text, descricao text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE falhou boolean := false;
BEGIN
  PERFORM ci.entrar(uid);
  BEGIN EXECUTE cmd; EXCEPTION WHEN OTHERS THEN falhou := true; END;
  PERFORM ci.sair();
  IF NOT falhou THEN RAISE EXCEPTION 'FALHA: esperava erro em "%"', descricao; END IF;
  RAISE NOTICE 'ok: % recusado', descricao;
END $$;
CREATE FUNCTION ci.como(uid uuid, cmd text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  PERFORM ci.entrar(uid);
  EXECUTE cmd INTO r;
  PERFORM ci.sair();
  RETURN r;
EXCEPTION WHEN OTHERS THEN
  PERFORM ci.sair();
  RAISE;
END $$;

DO $$
DECLARE
  ta constant uuid := 'f1111111-1111-1111-1111-111111111111';
  tb constant uuid := 'f2222222-2222-2222-2222-222222222222';
  tc constant uuid := 'f3333333-3333-3333-3333-333333333333';
  vet constant uuid := 'f0000000-0000-0000-0000-000000000001';
  aux constant uuid := 'f0000000-0000-0000-0000-000000000002';
  aux2 constant uuid := 'f0000000-0000-0000-0000-000000000003';
  gest constant uuid := 'f0000000-0000-0000-0000-000000000004';
  rec constant uuid := 'f0000000-0000-0000-0000-000000000005';
  vetb constant uuid := 'f0000000-0000-0000-0000-000000000006';
  vetc constant uuid := 'f0000000-0000-0000-0000-000000000007';
  pv uuid; pa uuid; pa2 uuid; pvb uuid;
  cli uuid; clib uuid; pet uuid; petb uuid; pet2 uuid; box uuid; box2 uuid; boxb uuid;
  int_a uuid; int_enc uuid; int_b uuid;
  p_temp uuid; p_fc uuid; p_gli uuid; p_off uuid; p_b uuid;
  s1 uuid; s2 uuid; s3 uuid; s4 uuid; s5 uuid; c1 uuid; c2 uuid; an uuid; rep1 uuid; rep2 uuid;
  r jsonb; n bigint; adm timestamptz;
BEGIN
  INSERT INTO tenants (id, nome) VALUES (ta, 'Clínica A'), (tb, 'Clínica B'), (tc, 'Loja C');
  INSERT INTO empresas (tenant_id, razao_social, ramo_atividade) VALUES (ta, 'A', 'clinica'), (tb, 'B', 'clinica'), (tc, 'C', 'varejo');
  INSERT INTO auth.users (id, email) VALUES (vet, 'v@s.ci'), (aux, 'a@s.ci'), (aux2, 'a2@s.ci'), (gest, 'g@s.ci'), (rec, 'r@s.ci'), (vetb, 'vb@s.ci'), (vetc, 'vc@s.ci');
  UPDATE profiles SET tenant_id = ta WHERE id IN (vet, aux, aux2, gest, rec);
  UPDATE profiles SET tenant_id = tb WHERE id = vetb;
  UPDATE profiles SET tenant_id = tc WHERE id = vetc;
  INSERT INTO user_roles (user_id, tenant_id, role) VALUES
    (vet, ta, 'veterinario'), (aux, ta, 'profissional'), (aux2, ta, 'profissional'), (gest, ta, 'gestor'), (rec, ta, 'vendedor'),
    (vetb, tb, 'veterinario'), (vetc, tc, 'veterinario');
  INSERT INTO pet_profissionais (tenant_id, nome, funcao, crmv, crmv_uf, profile_id, ativo) VALUES (ta, 'Dra Vet', 'veterinario', '11111', 'SP', vet, true) RETURNING id INTO pv;
  INSERT INTO pet_profissionais (tenant_id, nome, funcao, profile_id, ativo) VALUES (ta, 'Aux Um', 'auxiliar', aux, true) RETURNING id INTO pa;
  INSERT INTO pet_profissionais (tenant_id, nome, funcao, profile_id, ativo) VALUES (ta, 'Aux Dois', 'auxiliar', aux2, true) RETURNING id INTO pa2;
  INSERT INTO pet_profissionais (tenant_id, nome, funcao, crmv, crmv_uf, profile_id, ativo) VALUES (tb, 'Dr Vet B', 'veterinario', '22222', 'SP', vetb, true) RETURNING id INTO pvb;
  INSERT INTO clientes (tenant_id, nome) VALUES (ta, 'Tutor A') RETURNING id INTO cli;
  INSERT INTO clientes (tenant_id, nome) VALUES (tb, 'Tutor B') RETURNING id INTO clib;
  INSERT INTO pets (tenant_id, cliente_id, nome, especie) VALUES (ta, cli, 'Rex', 'cao') RETURNING id INTO pet;
  INSERT INTO pets (tenant_id, cliente_id, nome, especie) VALUES (ta, cli, 'Mel', 'gato') RETURNING id INTO pet2;
  INSERT INTO pets (tenant_id, cliente_id, nome, especie) VALUES (tb, clib, 'Bob', 'cao') RETURNING id INTO petb;
  INSERT INTO pet_boxes (tenant_id, nome) VALUES (ta, 'Box 1') RETURNING id INTO box;
  INSERT INTO pet_boxes (tenant_id, nome) VALUES (ta, 'Box 2') RETURNING id INTO box2;
  INSERT INTO pet_boxes (tenant_id, nome) VALUES (tb, 'Box B') RETURNING id INTO boxb;
  adm := now() - interval '10 hours';
  INSERT INTO pet_internacoes (tenant_id, pet_id, cliente_id, box_id, veterinario_id, crmv, crmv_uf, motivo, admitido_em)
    VALUES (ta, pet, cli, box, pv, '11111', 'SP', 'Observação', adm) RETURNING id INTO int_a;
  INSERT INTO pet_internacoes (tenant_id, pet_id, cliente_id, box_id, veterinario_id, crmv, crmv_uf, motivo, admitido_em, situacao, encerrado_em, encerrado_por, encerramento_texto)
    VALUES (ta, pet2, cli, box2, pv, '11111', 'SP', 'Já teve alta', adm, 'alta', now() - interval '1 hour', pv, 'Alta') RETURNING id INTO int_enc;
  INSERT INTO pet_internacoes (tenant_id, pet_id, cliente_id, box_id, veterinario_id, crmv, crmv_uf, motivo, admitido_em)
    VALUES (tb, petb, clib, boxb, pvb, '22222', 'SP', 'Observação B', adm) RETURNING id INTO int_b;

  -- ===== catálogo: nasce vazio, por empresa =====
  r := ci.como(vet, 'SELECT clinica_sinais_parametros()');
  PERFORM ci.exige(jsonb_array_length(r) = 0, 'catálogo nasce vazio (o sistema não inventa parâmetros)');
  PERFORM ci.deve_falhar(rec, 'SELECT clinica_sinais_parametros()', 'recepção lê o catálogo');
  PERFORM ci.deve_falhar(vetc, 'SELECT clinica_sinais_parametros()', 'empresa sem clínica lê o catálogo');
  PERFORM ci.deve_falhar(aux, $q$SELECT clinica_sinais_parametro_salvar('{"nome":"X","unidade":"u"}'::jsonb)$q$, 'auxiliar cria parâmetro');
  PERFORM ci.deve_falhar(rec, $q$SELECT clinica_sinais_parametro_salvar('{"nome":"X","unidade":"u"}'::jsonb)$q$, 'recepção cria parâmetro');
  PERFORM ci.deve_falhar(gest, $q$SELECT clinica_sinais_parametro_salvar('{"nome":"  ","unidade":"u"}'::jsonb)$q$, 'parâmetro sem nome');
  PERFORM ci.deve_falhar(gest, $q$SELECT clinica_sinais_parametro_salvar('{"nome":"X","unidade":""}'::jsonb)$q$, 'parâmetro sem unidade');
  p_temp := (ci.como(gest, $q$SELECT to_jsonb(clinica_sinais_parametro_salvar('{"nome":"Temperatura","unidade":"°C"}'::jsonb))$q$) #>> '{}')::uuid;
  p_fc := (ci.como(vet, $q$SELECT to_jsonb(clinica_sinais_parametro_salvar('{"nome":"Frequência cardíaca","unidade":"bpm"}'::jsonb))$q$) #>> '{}')::uuid;
  p_gli := (ci.como(gest, $q$SELECT to_jsonb(clinica_sinais_parametro_salvar('{"nome":"Glicemia","unidade":"mg/dL"}'::jsonb))$q$) #>> '{}')::uuid;
  p_off := (ci.como(gest, $q$SELECT to_jsonb(clinica_sinais_parametro_salvar('{"nome":"Antigo","unidade":"x","ativo":false}'::jsonb))$q$) #>> '{}')::uuid;
  PERFORM ci.exige(p_temp IS NOT NULL AND p_fc IS NOT NULL, 'gestão e veterinário criam parâmetros');
  PERFORM ci.deve_falhar(gest, $q$SELECT clinica_sinais_parametro_salvar('{"nome":" temperatura ","unidade":"°F"}'::jsonb)$q$, 'nome repetido (sem diferenciar maiúsculas)');
  r := ci.como(aux, 'SELECT clinica_sinais_parametros()');
  PERFORM ci.exige(jsonb_array_length(r) = 3, 'auxiliar lê só os parâmetros ativos');
  r := ci.como(aux, 'SELECT clinica_sinais_parametros(true)');
  PERFORM ci.exige(jsonb_array_length(r) = 3, 'auxiliar não enxerga os desativados mesmo pedindo todos');
  r := ci.como(vet, 'SELECT clinica_sinais_parametros(true)');
  PERFORM ci.exige(jsonb_array_length(r) = 4, 'veterinário (que mantém) vê também os desativados');
  r := ci.como(vetb, 'SELECT clinica_sinais_parametros()');
  PERFORM ci.exige(jsonb_array_length(r) = 0, 'outra empresa não vê o catálogo desta');
  p_b := (ci.como(vetb, $q$SELECT to_jsonb(clinica_sinais_parametro_salvar('{"nome":"Temperatura","unidade":"°C"}'::jsonb))$q$) #>> '{}')::uuid;
  PERFORM ci.exige(p_b IS NOT NULL AND p_b <> p_temp, 'mesmo nome em outra empresa é outro parâmetro');
  PERFORM ci.deve_falhar(gest, format($q$SELECT clinica_sinais_parametro_salvar(jsonb_build_object('id', %L, 'nome', 'Hack', 'unidade', 'x'))$q$, p_b), 'editar parâmetro de outra empresa');

  -- ===== acesso direto =====
  PERFORM ci.deve_falhar(vet, 'SELECT count(*) FROM pet_internacao_sinais', 'leitura direta dos sinais');
  PERFORM ci.deve_falhar(vet, 'SELECT count(*) FROM pet_sinais_parametros', 'leitura direta do catálogo');
  PERFORM ci.deve_falhar(aux, format($q$INSERT INTO pet_internacao_sinais (internacao_id, parametro_id, parametro_nome, unidade, valor, medido_em, profissional_id) VALUES (%L, %L, 'x', 'x', 1, now(), %L)$q$, int_a, p_temp, pa), 'inserção direta');

  -- ===== registrar =====
  s1 := (ci.como(aux, format($q$SELECT to_jsonb(clinica_sinal_registrar(%L, jsonb_build_object('parametro_id', %L, 'valor', '38,5', 'medido_em', now() - interval '3 hours')))$q$, int_a, p_temp)) #>> '{}')::uuid;
  s2 := (ci.como(vet, format($q$SELECT to_jsonb(clinica_sinal_registrar(%L, jsonb_build_object('parametro_id', %L, 'valor', '0', 'medido_em', now() - interval '2 hours')))$q$, int_a, p_gli)) #>> '{}')::uuid;
  s3 := (ci.como(aux, format($q$SELECT to_jsonb(clinica_sinal_registrar(%L, jsonb_build_object('parametro_id', %L, 'valor', '38.9', 'medido_em', now() - interval '5 hours')))$q$, int_a, p_temp)) #>> '{}')::uuid;
  s4 := (ci.como(aux, format($q$SELECT to_jsonb(clinica_sinal_registrar(%L, jsonb_build_object('parametro_id', %L, 'observacao', 'Animal agitado, não foi possível medir', 'medido_em', now() - interval '1 hour')))$q$, int_a, p_fc)) #>> '{}')::uuid;
  PERFORM ci.exige(s1 IS NOT NULL AND s2 IS NOT NULL, 'veterinário e auxiliar registram (vírgula ou ponto decimal)');
  r := ci.como(aux, format('SELECT clinica_sinais_internacao(%L)', int_a));
  PERFORM ci.exige(jsonb_array_length(r -> 'registros') = 4, 'histórico traz os 4 registros');
  PERFORM ci.exige((r -> 'registros' -> 0 ->> 'id')::uuid = s3 AND (r -> 'registros' -> 1 ->> 'id')::uuid = s1, 'histórico ordenado pelo horário da medição (não pelo do registro)');
  PERFORM ci.exige((SELECT (x ->> 'valor') FROM jsonb_array_elements(r -> 'registros') x WHERE (x ->> 'id')::uuid = s1) = '38.5', 'vírgula decimal gravada como 38,5');
  PERFORM ci.exige((SELECT x ->> 'unidade' FROM jsonb_array_elements(r -> 'registros') x WHERE (x ->> 'id')::uuid = s1) = '°C', 'unidade guardada com o registro');
  PERFORM ci.exige((SELECT x -> 'valor' FROM jsonb_array_elements(r -> 'registros') x WHERE (x ->> 'id')::uuid = s2) = '0'::jsonb, 'valor zero é zero (não é ausência)');
  PERFORM ci.exige((SELECT x -> 'valor' FROM jsonb_array_elements(r -> 'registros') x WHERE (x ->> 'id')::uuid = s4) = 'null'::jsonb
                   AND (SELECT x ->> 'observacao' FROM jsonb_array_elements(r -> 'registros') x WHERE (x ->> 'id')::uuid = s4) LIKE 'Animal agitado%', '"não foi possível medir" é registro sem valor e com motivo');
  PERFORM ci.exige((SELECT x ->> 'profissional' FROM jsonb_array_elements(r -> 'registros') x WHERE (x ->> 'id')::uuid = s1) = 'Aux Um', 'autoria do auxiliar');
  PERFORM ci.exige((SELECT x ->> 'profissional' FROM jsonb_array_elements(r -> 'registros') x WHERE (x ->> 'id')::uuid = s2) = 'Dra Vet', 'autoria do veterinário');

  -- validações
  PERFORM ci.deve_falhar(aux, format($q$SELECT clinica_sinal_registrar(%L, jsonb_build_object('parametro_id', %L))$q$, int_a, p_temp), 'sem valor e sem motivo');
  PERFORM ci.deve_falhar(aux, format($q$SELECT clinica_sinal_registrar(%L, jsonb_build_object('parametro_id', %L, 'valor', 'abc'))$q$, int_a, p_temp), 'valor texto');
  PERFORM ci.deve_falhar(aux, format($q$SELECT clinica_sinal_registrar(%L, jsonb_build_object('parametro_id', %L, 'valor', '1e5'))$q$, int_a, p_temp), 'valor em notação científica');
  PERFORM ci.deve_falhar(aux, format($q$SELECT clinica_sinal_registrar(%L, jsonb_build_object('parametro_id', %L, 'valor', 'NaN'))$q$, int_a, p_temp), 'valor NaN');
  PERFORM ci.deve_falhar(aux, format($q$SELECT clinica_sinal_registrar(%L, jsonb_build_object('parametro_id', %L, 'valor', '1234567'))$q$, int_a, p_temp), 'valor grande demais');
  PERFORM ci.deve_falhar(aux, format($q$SELECT clinica_sinal_registrar(%L, jsonb_build_object('parametro_id', %L, 'valor', '38', 'medido_em', now() - interval '11 hours'))$q$, int_a, p_temp), 'medição antes da admissão');
  PERFORM ci.deve_falhar(aux, format($q$SELECT clinica_sinal_registrar(%L, jsonb_build_object('parametro_id', %L, 'valor', '38', 'medido_em', now() + interval '1 hour'))$q$, int_a, p_temp), 'medição no futuro');
  PERFORM ci.deve_falhar(aux, format($q$SELECT clinica_sinal_registrar(%L, jsonb_build_object('parametro_id', %L, 'valor', '38', 'medido_em', 'ontem'))$q$, int_a, p_temp), 'horário inválido');
  PERFORM ci.deve_falhar(aux, format($q$SELECT clinica_sinal_registrar(%L, jsonb_build_object('parametro_id', %L, 'valor', '38'))$q$, int_a, p_off), 'parâmetro desativado');
  PERFORM ci.deve_falhar(aux, format($q$SELECT clinica_sinal_registrar(%L, jsonb_build_object('parametro_id', %L, 'valor', '38'))$q$, int_a, p_b), 'parâmetro de outra empresa');
  PERFORM ci.deve_falhar(aux, format($q$SELECT clinica_sinal_registrar(%L, jsonb_build_object('parametro_id', %L, 'valor', '38'))$q$, int_enc, p_temp), 'internação já encerrada');
  PERFORM ci.deve_falhar(vetb, format($q$SELECT clinica_sinal_registrar(%L, jsonb_build_object('parametro_id', %L, 'valor', '38'))$q$, int_a, p_b), 'registrar na internação de outra empresa');
  PERFORM ci.deve_falhar(rec, format($q$SELECT clinica_sinal_registrar(%L, jsonb_build_object('parametro_id', %L, 'valor', '38'))$q$, int_a, p_temp), 'recepção registra');
  PERFORM ci.deve_falhar(gest, format($q$SELECT clinica_sinal_registrar(%L, jsonb_build_object('parametro_id', %L, 'valor', '38'))$q$, int_a, p_temp), 'gestão registra');
  PERFORM ci.deve_falhar(vetc, format($q$SELECT clinica_sinal_registrar(%L, jsonb_build_object('parametro_id', %L, 'valor', '38'))$q$, int_a, p_temp), 'empresa sem clínica registra');
  PERFORM ci.deve_falhar(NULL, format($q$SELECT clinica_sinal_registrar(%L, jsonb_build_object('parametro_id', %L, 'valor', '38'))$q$, int_a, p_temp), 'anônimo registra');

  -- leitura
  PERFORM ci.deve_falhar(rec, format('SELECT clinica_sinais_internacao(%L)', int_a), 'recepção lê os sinais');
  PERFORM ci.deve_falhar(gest, format('SELECT clinica_sinais_internacao(%L)', int_a), 'gestão lê os sinais');
  PERFORM ci.deve_falhar(vetb, format('SELECT clinica_sinais_internacao(%L)', int_a), 'outra empresa lê os sinais');
  r := ci.como(vetb, format('SELECT clinica_sinais_internacao(%L)', int_b));
  PERFORM ci.exige(jsonb_array_length(r -> 'registros') = 0, 'internação sem medida devolve lista vazia (ausência de medida)');
  SELECT count(*) INTO n FROM clinica_acessos WHERE tenant_id = ta AND pet_id = pet AND acao = 'internacao';
  PERFORM ci.como(vet, format('SELECT clinica_sinais_internacao(%L)', int_a));
  PERFORM ci.exige((SELECT count(*) FROM clinica_acessos WHERE tenant_id = ta AND pet_id = pet AND acao = 'internacao') = n + 1,
                   'cada leitura dos sinais entra no registro de acessos do pet');
  PERFORM ci.deve_falhar(rec, format('SELECT clinica_sinais_internacao(%L)', int_a), 'recepção lê os sinais (sem registrar acesso)');
  PERFORM ci.exige((SELECT count(*) FROM clinica_acessos WHERE tenant_id = ta AND pet_id = pet AND acao = 'internacao') = n + 1,
                   'leitura recusada não entra no registro de acessos');

  -- repetição
  rep1 := (ci.como(aux, format($q$SELECT to_jsonb(clinica_sinal_registrar(%L, jsonb_build_object('parametro_id', %L, 'valor', '120', 'chave', 'chave-repeticao-1')))$q$, int_a, p_fc)) #>> '{}')::uuid;
  rep2 := (ci.como(aux, format($q$SELECT to_jsonb(clinica_sinal_registrar(%L, jsonb_build_object('parametro_id', %L, 'valor', '120', 'chave', 'chave-repeticao-1')))$q$, int_a, p_fc)) #>> '{}')::uuid;
  PERFORM ci.exige(rep1 = rep2 AND (SELECT count(*) FROM pet_internacao_sinais WHERE chave = 'chave-repeticao-1') = 1, 'o mesmo envio repetido não duplica o registro');
  s5 := rep1;

  -- ===== imutabilidade =====
  BEGIN
    UPDATE pet_internacao_sinais SET valor = 99 WHERE id = s1;
    RAISE EXCEPTION 'FALHA: alterou sinal vital';
  EXCEPTION WHEN OTHERS THEN
    PERFORM ci.exige(SQLERRM LIKE '%não se altera nem se apaga%', 'sinal vital não se altera nem com acesso direto');
  END;
  BEGIN
    DELETE FROM pet_internacao_sinais WHERE id = s1;
    RAISE EXCEPTION 'FALHA: apagou sinal vital';
  EXCEPTION WHEN OTHERS THEN
    PERFORM ci.exige(SQLERRM LIKE '%não se altera nem se apaga%', 'sinal vital não se apaga nem com acesso direto');
  END;

  -- ===== correção sem perda =====
  PERFORM ci.deve_falhar(aux2, format($q$SELECT clinica_sinal_corrigir(%L, '{"valor":"37","motivo":"digitei errado"}'::jsonb)$q$, s1), 'outro auxiliar corrige registro alheio');
  PERFORM ci.deve_falhar(rec, format($q$SELECT clinica_sinal_corrigir(%L, '{"valor":"37","motivo":"digitei errado"}'::jsonb)$q$, s1), 'recepção corrige');
  PERFORM ci.deve_falhar(aux, format($q$SELECT clinica_sinal_corrigir(%L, '{"valor":"37"}'::jsonb)$q$, s1), 'correção sem motivo');
  PERFORM ci.deve_falhar(aux, format($q$SELECT clinica_sinal_corrigir(%L, '{"motivo":"digitei errado"}'::jsonb)$q$, s1), 'correção sem valor nem explicação');
  PERFORM ci.deve_falhar(vetb, format($q$SELECT clinica_sinal_corrigir(%L, '{"valor":"37","motivo":"digitei errado"}'::jsonb)$q$, s1), 'corrigir registro de outra empresa');
  c1 := (ci.como(aux, format($q$SELECT to_jsonb(clinica_sinal_corrigir(%L, '{"valor":"37,8","motivo":"Digitei 38,5 por engano"}'::jsonb))$q$, s1)) #>> '{}')::uuid;
  PERFORM ci.exige(c1 IS NOT NULL, 'o autor corrige o próprio registro');
  r := ci.como(vet, format('SELECT clinica_sinais_internacao(%L)', int_a));
  PERFORM ci.exige(jsonb_array_length(r -> 'registros') = 6, 'a correção é um novo registro: o histórico cresce (não perde o original)');
  PERFORM ci.exige((SELECT x ->> 'valor' FROM jsonb_array_elements(r -> 'registros') x WHERE (x ->> 'id')::uuid = s1) = '38.5'
                   AND (SELECT x ->> 'substituido_por' FROM jsonb_array_elements(r -> 'registros') x WHERE (x ->> 'id')::uuid = s1) = c1::text
                   AND (SELECT (x ->> 'corrente')::boolean FROM jsonb_array_elements(r -> 'registros') x WHERE (x ->> 'id')::uuid = s1) = false, 'o original continua com o valor antigo, marcado como substituído');
  PERFORM ci.exige((SELECT (x ->> 'corrente')::boolean FROM jsonb_array_elements(r -> 'registros') x WHERE (x ->> 'id')::uuid = c1) = true
                   AND (SELECT x ->> 'motivo_correcao' FROM jsonb_array_elements(r -> 'registros') x WHERE (x ->> 'id')::uuid = c1) LIKE 'Digitei%'
                   AND (SELECT x ->> 'corrige_id' FROM jsonb_array_elements(r -> 'registros') x WHERE (x ->> 'id')::uuid = c1) = s1::text, 'a correção vale, guarda o motivo e aponta o original');
  PERFORM ci.exige((SELECT x ->> 'unidade' FROM jsonb_array_elements(r -> 'registros') x WHERE (x ->> 'id')::uuid = c1) = '°C'
                   AND (SELECT x ->> 'medido_em' FROM jsonb_array_elements(r -> 'registros') x WHERE (x ->> 'id')::uuid = c1)
                     = (SELECT x ->> 'medido_em' FROM jsonb_array_elements(r -> 'registros') x WHERE (x ->> 'id')::uuid = s1), 'a correção herda parâmetro, unidade e horário do original');
  PERFORM ci.deve_falhar(aux, format($q$SELECT clinica_sinal_corrigir(%L, '{"valor":"36","motivo":"de novo o mesmo"}'::jsonb)$q$, s1), 'corrigir de novo o mesmo registro');
  c2 := (ci.como(vet, format($q$SELECT to_jsonb(clinica_sinal_corrigir(%L, '{"valor":"37,6","motivo":"Conferido no termômetro"}'::jsonb))$q$, c1)) #>> '{}')::uuid;
  PERFORM ci.exige(c2 IS NOT NULL, 'o veterinário corrige a correção (cadeia) mesmo sem ser o autor');
  an := (ci.como(vet, format($q$SELECT to_jsonb(clinica_sinal_corrigir(%L, '{"anular":true,"motivo":"Medida no animal errado"}'::jsonb))$q$, s3)) #>> '{}')::uuid;
  r := ci.como(vet, format('SELECT clinica_sinais_internacao(%L)', int_a));
  PERFORM ci.exige((SELECT (x ->> 'anulado')::boolean FROM jsonb_array_elements(r -> 'registros') x WHERE (x ->> 'id')::uuid = an) = true
                   AND (SELECT (x ->> 'corrente')::boolean FROM jsonb_array_elements(r -> 'registros') x WHERE (x ->> 'id')::uuid = an) = false
                   AND (SELECT (x ->> 'corrente')::boolean FROM jsonb_array_elements(r -> 'registros') x WHERE (x ->> 'id')::uuid = s3) = false, 'anular mantém o registro no histórico e tira do que vale');
  PERFORM ci.exige((SELECT count(*) FROM jsonb_array_elements(r -> 'registros') x WHERE (x ->> 'corrente')::boolean) = 4, 'só 4 registros valem hoje (2 viraram histórico e 1 foi anulado)');
  PERFORM ci.deve_falhar(vet, format($q$SELECT clinica_sinal_corrigir(%L, '{"valor":"36","motivo":"tentando corrigir anulação"}'::jsonb)$q$, an), 'corrigir uma anulação');
  PERFORM ci.deve_falhar(vet, format($q$SELECT clinica_sinal_corrigir(%L, '{"anular":true}'::jsonb)$q$, s2), 'anular sem motivo');

  -- catálogo renomeado depois: o que foi registrado não muda
  PERFORM ci.como(gest, format($q$SELECT to_jsonb(clinica_sinais_parametro_salvar(jsonb_build_object('id', %L, 'nome', 'Temp. retal', 'unidade', '°F')))$q$, p_temp));
  r := ci.como(vet, format('SELECT clinica_sinais_internacao(%L)', int_a));
  PERFORM ci.exige((SELECT x ->> 'parametro' || '|' || (x ->> 'unidade') FROM jsonb_array_elements(r -> 'registros') x WHERE (x ->> 'id')::uuid = s1) = 'Temperatura|°C', 'renomear ou trocar a unidade no catálogo não altera registros antigos');
  PERFORM ci.exige((SELECT x ->> 'parametro' FROM jsonb_array_elements(r -> 'registros') x WHERE (x ->> 'id')::uuid = c2) = 'Temperatura', 'nem a cadeia de correções');

  -- internação encerrada: o histórico fica, nada muda
  UPDATE pet_internacoes SET situacao = 'alta', encerrado_em = now(), encerrado_por = pv, encerramento_texto = 'Alta' WHERE id = int_a;
  PERFORM ci.deve_falhar(vet, format($q$SELECT clinica_sinal_corrigir(%L, '{"valor":"36","motivo":"depois da alta"}'::jsonb)$q$, c2), 'corrigir depois da alta');
  PERFORM ci.deve_falhar(aux, format($q$SELECT clinica_sinal_registrar(%L, jsonb_build_object('parametro_id', %L, 'valor', '38'))$q$, int_a, p_fc), 'registrar depois da alta');
  r := ci.como(aux, format('SELECT clinica_sinais_internacao(%L)', int_a));
  PERFORM ci.exige(jsonb_array_length(r -> 'registros') = 8, 'o histórico continua legível depois da alta (8 registros)');
END $$;
ROLLBACK;
