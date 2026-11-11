-- Testes comportamentais da passagem de turno da internação: resumo e pendências, ciente de quem recebe, pendência lida continua
-- aberta, baixa explícita, imutabilidade, permissões (veterinário e auxiliar; recepção e gestão não leem), isolamento entre empresas,
-- repetição e que nenhuma dose é tocada. Dados fictícios; ROLLBACK.
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
  cli uuid; clib uuid; pet uuid; petb uuid; pet2 uuid; pet3 uuid; box uuid; box2 uuid; boxb uuid; box3 uuid;
  int_a uuid; int_enc uuid; int_b uuid; int_c uuid;
  t1 uuid; t2 uuid; t3 uuid; b1 uuid; b2 uuid; presc uuid;
  p1 uuid; p2 uuid; p3 uuid;
  r jsonb; adm timestamptz; antes bigint; depois bigint;
BEGIN
  INSERT INTO tenants (id, nome) VALUES (ta, 'Clínica A'), (tb, 'Clínica B'), (tc, 'Loja C');
  INSERT INTO empresas (tenant_id, razao_social, ramo_atividade) VALUES (ta, 'A', 'clinica'), (tb, 'B', 'clinica'), (tc, 'C', 'varejo');
  INSERT INTO auth.users (id, email) VALUES (vet, 'v@t.ci'), (aux, 'a@t.ci'), (aux2, 'a2@t.ci'), (gest, 'g@t.ci'), (rec, 'r@t.ci'), (vetb, 'vb@t.ci'), (vetc, 'vc@t.ci');
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
  INSERT INTO pets (tenant_id, cliente_id, nome, especie) VALUES (ta, cli, 'Bidu', 'cao') RETURNING id INTO pet3;
  INSERT INTO pets (tenant_id, cliente_id, nome, especie) VALUES (tb, clib, 'Bob', 'cao') RETURNING id INTO petb;
  INSERT INTO pet_boxes (tenant_id, nome) VALUES (ta, 'Box 1') RETURNING id INTO box;
  INSERT INTO pet_boxes (tenant_id, nome) VALUES (ta, 'Box 2') RETURNING id INTO box2;
  INSERT INTO pet_boxes (tenant_id, nome) VALUES (ta, 'Box 3') RETURNING id INTO box3;
  INSERT INTO pet_boxes (tenant_id, nome) VALUES (tb, 'Box B') RETURNING id INTO boxb;
  adm := now() - interval '10 hours';
  INSERT INTO pet_internacoes (tenant_id, pet_id, cliente_id, box_id, veterinario_id, crmv, crmv_uf, motivo, admitido_em)
    VALUES (ta, pet, cli, box, pv, '11111', 'SP', 'Observação', adm) RETURNING id INTO int_a;
  INSERT INTO pet_internacoes (tenant_id, pet_id, cliente_id, box_id, veterinario_id, crmv, crmv_uf, motivo, admitido_em)
    VALUES (ta, pet3, cli, box3, pv, '11111', 'SP', 'Segundo internado', adm) RETURNING id INTO int_c;
  INSERT INTO pet_internacoes (tenant_id, pet_id, cliente_id, box_id, veterinario_id, crmv, crmv_uf, motivo, admitido_em, situacao, encerrado_em, encerrado_por, encerramento_texto)
    VALUES (ta, pet2, cli, box2, pv, '11111', 'SP', 'Já teve alta', adm, 'alta', now() - interval '1 hour', pv, 'Alta') RETURNING id INTO int_enc;
  INSERT INTO pet_internacoes (tenant_id, pet_id, cliente_id, box_id, veterinario_id, crmv, crmv_uf, motivo, admitido_em)
    VALUES (tb, petb, clib, boxb, pvb, '22222', 'SP', 'Observação B', adm) RETURNING id INTO int_b;
  -- uma prescrição com doses: a passagem de turno não pode mexer nelas
  INSERT INTO pet_internacao_prescricoes (tenant_id, internacao_id, veterinario_id, crmv, crmv_uf, medicamento, dose, frequencia_horas, dias, inicio)
    VALUES (ta, int_a, pv, '11111', 'SP', 'Amoxicilina', '10 mg', 8, 2, now()) RETURNING id INTO presc;
  INSERT INTO pet_internacao_execucoes (tenant_id, prescricao_id, internacao_id, previsto_em) VALUES
    (ta, presc, int_a, now() + interval '1 hour'), (ta, presc, int_a, now() + interval '9 hours');

  -- ===== registrar a passagem =====
  t1 := (ci.como(aux, format($q$SELECT to_jsonb(clinica_turno_registrar(%L, jsonb_build_object(
          'resumo', 'Estável, comeu metade da ração, sem vômito.',
          'pendencias', jsonb_build_array('Repetir glicemia às 22h', 'Trocar o curativo', 'Ligar para o tutor'),
          'chave', 'turno-chave-001')))$q$, int_a)) #>> '{}')::uuid;
  PERFORM ci.exige(t1 IS NOT NULL, 'auxiliar registra a passagem com resumo e pendências');
  r := ci.como(aux, format('SELECT clinica_turnos_internacao(%L)', int_a));
  PERFORM ci.exige(jsonb_array_length(r -> 'turnos') = 1 AND r -> 'turnos' -> 0 ->> 'resumo' LIKE 'Estável%', 'a passagem aparece com o resumo');
  PERFORM ci.exige(r -> 'turnos' -> 0 -> 'autor' ->> 'nome' = 'Aux Um' AND (r -> 'turnos' -> 0 ->> 'sou_autor')::boolean, 'autoria e horário registrados');
  PERFORM ci.exige(jsonb_array_length(r -> 'turnos' -> 0 -> 'pendencias') = 3
                   AND r -> 'turnos' -> 0 -> 'pendencias' -> 0 ->> 'texto' = 'Repetir glicemia às 22h'
                   AND r -> 'turnos' -> 0 -> 'pendencias' -> 2 ->> 'texto' = 'Ligar para o tutor', 'três pendências na ordem escrita');
  PERFORM ci.exige(jsonb_array_length(r -> 'pendencias_abertas') = 3, 'as 3 pendências começam abertas');
  PERFORM ci.exige(jsonb_array_length(r -> 'turnos' -> 0 -> 'ciencias') = 0 AND NOT (r -> 'turnos' -> 0 ->> 'minha_ciencia')::boolean, 'ninguém deu ciente ainda');
  t2 := (ci.como(aux, format($q$SELECT to_jsonb(clinica_turno_registrar(%L, jsonb_build_object('resumo', 'outro texto', 'chave', 'turno-chave-001')))$q$, int_a)) #>> '{}')::uuid;
  PERFORM ci.exige(t2 = t1 AND (SELECT count(*) FROM pet_internacao_turnos WHERE chave = 'turno-chave-001') = 1
                   AND (SELECT count(*) FROM pet_internacao_pendencias WHERE turno_id = t1) = 3, 'o mesmo envio repetido não duplica a passagem nem as pendências');

  -- validações
  PERFORM ci.deve_falhar(aux, format($q$SELECT clinica_turno_registrar(%L, '{"resumo":""}'::jsonb)$q$, int_a), 'resumo vazio');
  PERFORM ci.deve_falhar(aux, format($q$SELECT clinica_turno_registrar(%L, '{"resumo":"ab"}'::jsonb)$q$, int_a), 'resumo curto demais');
  PERFORM ci.deve_falhar(aux, format($q$SELECT clinica_turno_registrar(%L, jsonb_build_object('resumo', repeat('x', 2001)))$q$, int_a), 'resumo grande demais');
  PERFORM ci.deve_falhar(aux, format($q$SELECT clinica_turno_registrar(%L, jsonb_build_object('resumo', 'ok ok', 'pendencias', (SELECT jsonb_agg('p' || g) FROM generate_series(1, 21) g)))$q$, int_a), 'mais de 20 pendências');
  PERFORM ci.deve_falhar(aux, format($q$SELECT clinica_turno_registrar(%L, '{"resumo":"ok ok","pendencias":[" "]}'::jsonb)$q$, int_a), 'pendência vazia');
  PERFORM ci.deve_falhar(aux, format($q$SELECT clinica_turno_registrar(%L, '{"resumo":"ok ok","pendencias":[1]}'::jsonb)$q$, int_a), 'pendência que não é texto');
  PERFORM ci.deve_falhar(aux, format($q$SELECT clinica_turno_registrar(%L, '{"resumo":"ok ok","pendencias":"x"}'::jsonb)$q$, int_a), 'pendências que não são lista');
  PERFORM ci.deve_falhar(aux, format($q$SELECT clinica_turno_registrar(%L, jsonb_build_object('resumo', 'ok ok', 'pendencias', jsonb_build_array(repeat('x', 301))))$q$, int_a), 'pendência grande demais');
  PERFORM ci.deve_falhar(aux, format($q$SELECT clinica_turno_registrar(%L, '{"resumo":"ok ok"}'::jsonb)$q$, int_enc), 'passagem de internação encerrada');
  PERFORM ci.deve_falhar(vetb, format($q$SELECT clinica_turno_registrar(%L, '{"resumo":"ok ok"}'::jsonb)$q$, int_a), 'passagem na internação de outra empresa');
  PERFORM ci.deve_falhar(rec, format($q$SELECT clinica_turno_registrar(%L, '{"resumo":"ok ok"}'::jsonb)$q$, int_a), 'recepção escreve passagem');
  PERFORM ci.deve_falhar(gest, format($q$SELECT clinica_turno_registrar(%L, '{"resumo":"ok ok"}'::jsonb)$q$, int_a), 'gestão escreve passagem');
  PERFORM ci.deve_falhar(vetc, format($q$SELECT clinica_turno_registrar(%L, '{"resumo":"ok ok"}'::jsonb)$q$, int_a), 'empresa sem clínica escreve passagem');
  PERFORM ci.deve_falhar(NULL, format($q$SELECT clinica_turno_registrar(%L, '{"resumo":"ok ok"}'::jsonb)$q$, int_a), 'anônimo escreve passagem');

  -- ===== leitura =====
  PERFORM ci.deve_falhar(rec, format('SELECT clinica_turnos_internacao(%L)', int_a), 'recepção lê a passagem');
  PERFORM ci.deve_falhar(gest, format('SELECT clinica_turnos_internacao(%L)', int_a), 'gestão lê a passagem');
  PERFORM ci.deve_falhar(vetb, format('SELECT clinica_turnos_internacao(%L)', int_a), 'outra empresa lê a passagem');
  SELECT count(*) INTO antes FROM clinica_acessos WHERE tenant_id = ta AND pet_id = pet AND acao = 'internacao';
  PERFORM ci.como(vet, format('SELECT clinica_turnos_internacao(%L)', int_a));
  SELECT count(*) INTO depois FROM clinica_acessos WHERE tenant_id = ta AND pet_id = pet AND acao = 'internacao';
  PERFORM ci.exige(depois = antes + 1, 'cada leitura da passagem entra no registro de acessos do pet');
  PERFORM ci.deve_falhar(vet, 'SELECT count(*) FROM pet_internacao_turnos', 'leitura direta das passagens');
  PERFORM ci.deve_falhar(vet, 'SELECT count(*) FROM pet_internacao_pendencias', 'leitura direta das pendências');
  PERFORM ci.deve_falhar(vet, 'SELECT count(*) FROM pet_internacao_turno_ciencias', 'leitura direta das ciências');
  PERFORM ci.deve_falhar(aux, format($q$INSERT INTO pet_internacao_turnos (internacao_id, profissional_id, resumo) VALUES (%L, %L, 'direto')$q$, int_a, pa), 'inserção direta de passagem');

  -- ===== ciente =====
  PERFORM ci.deve_falhar(aux, format('SELECT clinica_turno_ciente(%L)', t1), 'o autor dá ciente da própria passagem');
  PERFORM ci.deve_falhar(rec, format('SELECT clinica_turno_ciente(%L)', t1), 'recepção dá ciente');
  PERFORM ci.deve_falhar(gest, format('SELECT clinica_turno_ciente(%L)', t1), 'gestão dá ciente');
  PERFORM ci.deve_falhar(vetb, format('SELECT clinica_turno_ciente(%L)', t1), 'outra empresa dá ciente');
  PERFORM ci.deve_falhar(aux2, format('SELECT clinica_turno_ciente(%L)', gen_random_uuid()), 'ciente de passagem inexistente');
  r := ci.como(aux2, 'SELECT clinica_plantao()');
  PERFORM ci.exige((SELECT (x ->> 'aguarda_minha_ciencia')::boolean FROM jsonb_array_elements(r) x WHERE (x ->> 'internacao_id')::uuid = int_a), 'a passagem aparece como esperando a ciência de quem recebe');
  PERFORM ci.como(aux2, format('SELECT to_jsonb(clinica_turno_ciente(%L))', t1));
  PERFORM ci.como(aux2, format('SELECT to_jsonb(clinica_turno_ciente(%L))', t1));
  PERFORM ci.como(vet, format('SELECT to_jsonb(clinica_turno_ciente(%L))', t1));
  PERFORM ci.exige((SELECT count(*) FROM pet_internacao_turno_ciencias WHERE turno_id = t1) = 2, 'ciente repetido não duplica; cada profissional conta uma vez');
  r := ci.como(vet, format('SELECT clinica_turnos_internacao(%L)', int_a));
  PERFORM ci.exige(jsonb_array_length(r -> 'turnos' -> 0 -> 'ciencias') = 2
                   AND (r -> 'turnos' -> 0 ->> 'minha_ciencia')::boolean
                   AND (SELECT string_agg(x ->> 'profissional', ',' ORDER BY x ->> 'profissional') FROM jsonb_array_elements(r -> 'turnos' -> 0 -> 'ciencias') x) = 'Aux Dois,Dra Vet', 'ciências guardam quem recebeu e quando');
  PERFORM ci.exige(jsonb_array_length(r -> 'pendencias_abertas') = 3, 'ciente NÃO resolve pendência: continuam as 3 abertas');
  r := ci.como(aux2, 'SELECT clinica_plantao()');
  PERFORM ci.exige(NOT (SELECT (x ->> 'aguarda_minha_ciencia')::boolean FROM jsonb_array_elements(r) x WHERE (x ->> 'internacao_id')::uuid = int_a), 'depois do ciente deixa de esperar');
  r := ci.como(aux, 'SELECT clinica_plantao()');
  PERFORM ci.exige(NOT (SELECT (x ->> 'aguarda_minha_ciencia')::boolean FROM jsonb_array_elements(r) x WHERE (x ->> 'internacao_id')::uuid = int_a), 'o autor nunca fica esperando a própria ciência');

  -- ===== pendências: só uma ação explícita as fecha =====
  SELECT id INTO p1 FROM pet_internacao_pendencias WHERE turno_id = t1 AND ordem = 1;
  SELECT id INTO p2 FROM pet_internacao_pendencias WHERE turno_id = t1 AND ordem = 2;
  SELECT id INTO p3 FROM pet_internacao_pendencias WHERE turno_id = t1 AND ordem = 3;
  PERFORM ci.deve_falhar(rec, format($q$SELECT clinica_pendencia_baixar(%L, '{"situacao":"resolvida"}'::jsonb)$q$, p1), 'recepção resolve pendência');
  PERFORM ci.deve_falhar(gest, format($q$SELECT clinica_pendencia_baixar(%L, '{"situacao":"resolvida"}'::jsonb)$q$, p1), 'gestão resolve pendência');
  PERFORM ci.deve_falhar(vetb, format($q$SELECT clinica_pendencia_baixar(%L, '{"situacao":"resolvida"}'::jsonb)$q$, p1), 'outra empresa resolve pendência');
  PERFORM ci.deve_falhar(aux2, format($q$SELECT clinica_pendencia_baixar(%L, '{"situacao":"feito"}'::jsonb)$q$, p1), 'situação inventada');
  PERFORM ci.deve_falhar(aux2, format($q$SELECT clinica_pendencia_baixar(%L, '{}'::jsonb)$q$, p1), 'baixa sem situação');
  PERFORM ci.deve_falhar(aux2, format($q$SELECT clinica_pendencia_baixar(%L, '{"situacao":"descartada"}'::jsonb)$q$, p3), 'descartar sem explicar');
  PERFORM ci.deve_falhar(aux2, format($q$SELECT clinica_pendencia_baixar(%L, '{"situacao":"descartada","observacao":"ab"}'::jsonb)$q$, p3), 'explicação curta demais');
  PERFORM ci.deve_falhar(aux2, format($q$SELECT clinica_pendencia_baixar(%L, '{"situacao":"resolvida"}'::jsonb)$q$, gen_random_uuid()), 'baixar pendência inexistente');
  b1 := (ci.como(aux2, format($q$SELECT to_jsonb(clinica_pendencia_baixar(%L, '{"situacao":"resolvida","observacao":"Glicemia repetida: 92"}'::jsonb))$q$, p1)) #>> '{}')::uuid;
  PERFORM ci.exige(b1 IS NOT NULL, 'um auxiliar resolve a pendência de outro (com observação)');
  PERFORM ci.deve_falhar(vet, format($q$SELECT clinica_pendencia_baixar(%L, '{"situacao":"resolvida"}'::jsonb)$q$, p1), 'resolver de novo uma pendência já baixada');
  b2 := (ci.como(vet, format($q$SELECT to_jsonb(clinica_pendencia_baixar(%L, '{"situacao":"descartada","observacao":"Tutor já foi avisado pela recepção"}'::jsonb))$q$, p3)) #>> '{}')::uuid;
  r := ci.como(aux, format('SELECT clinica_turnos_internacao(%L)', int_a));
  PERFORM ci.exige(jsonb_array_length(r -> 'pendencias_abertas') = 1 AND r -> 'pendencias_abertas' -> 0 ->> 'texto' = 'Trocar o curativo', 'só a que ninguém resolveu nem descartou segue aberta');
  PERFORM ci.exige(r -> 'turnos' -> 0 -> 'pendencias' -> 0 -> 'baixa' ->> 'situacao' = 'resolvida'
                   AND r -> 'turnos' -> 0 -> 'pendencias' -> 0 -> 'baixa' ->> 'profissional' = 'Aux Dois'
                   AND r -> 'turnos' -> 0 -> 'pendencias' -> 2 -> 'baixa' ->> 'situacao' = 'descartada'
                   AND r -> 'turnos' -> 0 -> 'pendencias' -> 2 -> 'baixa' ->> 'observacao' LIKE 'Tutor já%'
                   AND r -> 'turnos' -> 0 -> 'pendencias' -> 1 -> 'baixa' = 'null'::jsonb, 'cada baixa guarda quem, quando e por quê; a aberta fica sem baixa');

  -- ===== a pendência aberta passa para a próxima passagem sem se perder =====
  t3 := (ci.como(aux2, format($q$SELECT to_jsonb(clinica_turno_registrar(%L, jsonb_build_object('resumo', 'Turno da noite: dormiu bem.', 'pendencias', jsonb_build_array('Pesar pela manhã'))))$q$, int_a)) #>> '{}')::uuid;
  r := ci.como(aux, format('SELECT clinica_turnos_internacao(%L)', int_a));
  PERFORM ci.exige(jsonb_array_length(r -> 'turnos') = 2 AND (r -> 'turnos' -> 0 ->> 'id')::uuid = t3, 'a passagem mais nova vem primeiro');
  PERFORM ci.exige(jsonb_array_length(r -> 'pendencias_abertas') = 2
                   AND r -> 'pendencias_abertas' -> 0 ->> 'texto' = 'Trocar o curativo'
                   AND r -> 'pendencias_abertas' -> 1 ->> 'texto' = 'Pesar pela manhã', 'a pendência da passagem anterior continua aberta junto com a nova');
  r := ci.como(aux, 'SELECT clinica_plantao()');
  PERFORM ci.exige((SELECT (x ->> 'aguarda_minha_ciencia')::boolean FROM jsonb_array_elements(r) x WHERE (x ->> 'internacao_id')::uuid = int_a)
                   AND (SELECT (x ->> 'pendencias_abertas')::int FROM jsonb_array_elements(r) x WHERE (x ->> 'internacao_id')::uuid = int_a) = 2
                   AND (SELECT x ->> 'ultima_passagem_por' FROM jsonb_array_elements(r) x WHERE (x ->> 'internacao_id')::uuid = int_a) = 'Aux Dois', 'plantão: a nova passagem espera a ciência do outro e conta as pendências abertas');
  PERFORM ci.exige((SELECT (x ->> 'pendencias_abertas')::int FROM jsonb_array_elements(r) x WHERE (x ->> 'internacao_id')::uuid = int_c) = 0
                   AND (SELECT x -> 'ultima_passagem_em' FROM jsonb_array_elements(r) x WHERE (x ->> 'internacao_id')::uuid = int_c) = 'null'::jsonb, 'internado sem passagem: zero pendências e nenhuma passagem');
  PERFORM ci.exige(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r) x WHERE (x ->> 'internacao_id')::uuid IN (int_b, int_enc)), 'plantão só lista internados da própria empresa');
  PERFORM ci.deve_falhar(rec, 'SELECT clinica_plantao()', 'recepção vê o plantão');
  PERFORM ci.deve_falhar(gest, 'SELECT clinica_plantao()', 'gestão vê o plantão');
  PERFORM ci.deve_falhar(NULL, 'SELECT clinica_plantao()', 'anônimo vê o plantão');
  r := ci.como(vetb, 'SELECT clinica_plantao()');
  PERFORM ci.exige(jsonb_array_length(r) = 1 AND (r -> 0 ->> 'internacao_id')::uuid = int_b, 'outra empresa vê só os próprios internados');

  -- ===== imutabilidade =====
  BEGIN UPDATE pet_internacao_turnos SET resumo = 'adulterado' WHERE id = t1; RAISE EXCEPTION 'FALHA: alterou a passagem';
  EXCEPTION WHEN OTHERS THEN PERFORM ci.exige(SQLERRM LIKE '%não se altera nem se apaga%', 'passagem não se altera nem com acesso direto'); END;
  BEGIN DELETE FROM pet_internacao_turnos WHERE id = t1; RAISE EXCEPTION 'FALHA: apagou a passagem';
  EXCEPTION WHEN OTHERS THEN PERFORM ci.exige(SQLERRM LIKE '%não se altera nem se apaga%', 'passagem não se apaga nem com acesso direto'); END;
  BEGIN UPDATE pet_internacao_pendencias SET texto = 'adulterado' WHERE id = p2; RAISE EXCEPTION 'FALHA: alterou a pendência';
  EXCEPTION WHEN OTHERS THEN PERFORM ci.exige(SQLERRM LIKE '%não se altera nem se apaga%', 'pendência não se altera nem com acesso direto'); END;
  BEGIN DELETE FROM pet_internacao_pendencia_baixas WHERE id = b1; RAISE EXCEPTION 'FALHA: apagou a baixa';
  EXCEPTION WHEN OTHERS THEN PERFORM ci.exige(SQLERRM LIKE '%não se altera nem se apaga%', 'baixa não se apaga nem com acesso direto'); END;
  BEGIN DELETE FROM pet_internacao_turno_ciencias WHERE turno_id = t1; RAISE EXCEPTION 'FALHA: apagou a ciência';
  EXCEPTION WHEN OTHERS THEN PERFORM ci.exige(SQLERRM LIKE '%não se altera nem se apaga%', 'ciência não se apaga nem com acesso direto'); END;

  -- ===== a passagem não mexe em dose nem em prescrição =====
  PERFORM ci.exige((SELECT count(*) FROM pet_internacao_execucoes WHERE internacao_id = int_a AND situacao = 'pendente') = 2
                   AND (SELECT count(*) FROM pet_internacao_execucoes WHERE internacao_id = int_a AND situacao <> 'pendente') = 0
                   AND (SELECT situacao FROM pet_internacao_prescricoes WHERE id = presc) = 'ativa', 'escrever, ler, dar ciente e resolver pendência não executa dose nem altera prescrição');

  -- ===== internação encerrada: o histórico fica, nada novo entra =====
  UPDATE pet_internacoes SET situacao = 'alta', encerrado_em = now(), encerrado_por = pv, encerramento_texto = 'Alta' WHERE id = int_a;
  PERFORM ci.deve_falhar(aux, format('SELECT clinica_turno_ciente(%L)', t3), 'ciente depois da alta');
  PERFORM ci.deve_falhar(aux2, $q$SELECT clinica_pendencia_baixar((SELECT id FROM pet_internacao_pendencias WHERE texto = 'Pesar pela manhã'), '{"situacao":"resolvida"}'::jsonb)$q$, 'resolver pendência depois da alta');
  PERFORM ci.deve_falhar(aux, format($q$SELECT clinica_turno_registrar(%L, '{"resumo":"depois da alta"}'::jsonb)$q$, int_a), 'nova passagem depois da alta');
  r := ci.como(aux, format('SELECT clinica_turnos_internacao(%L)', int_a));
  PERFORM ci.exige(jsonb_array_length(r -> 'turnos') = 2 AND jsonb_array_length(r -> 'pendencias_abertas') = 2, 'o histórico continua legível depois da alta');
  r := ci.como(aux, 'SELECT clinica_plantao()');
  PERFORM ci.exige(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r) x WHERE (x ->> 'internacao_id')::uuid = int_a), 'internação encerrada sai do plantão');
END $$;
ROLLBACK;
