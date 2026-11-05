-- Testes comportamentais do portal do tutor: convite (só o hash fica no banco, validade, uso único, revogação, limite de tentativas),
-- vínculo por sessão, liberação pelo veterinário, isolamento entre tutores, animais e empresas, revogação imediata, registro de consulta,
-- imutabilidade e ausência de acesso direto. Dados fictícios; ROLLBACK.
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
  rec constant uuid := 'f0000000-0000-0000-0000-000000000002';
  gest constant uuid := 'f0000000-0000-0000-0000-000000000003';
  aux constant uuid := 'f0000000-0000-0000-0000-000000000004';
  vetb constant uuid := 'f0000000-0000-0000-0000-000000000005';
  recb constant uuid := 'f0000000-0000-0000-0000-000000000006';
  vetc constant uuid := 'f0000000-0000-0000-0000-000000000007';
  tu1 constant uuid := 'f0000000-0000-0000-0000-0000000000a1';
  tu2 constant uuid := 'f0000000-0000-0000-0000-0000000000a2';
  tu3 constant uuid := 'f0000000-0000-0000-0000-0000000000a3';
  fora constant uuid := 'f0000000-0000-0000-0000-0000000000a4';
  brute constant uuid := 'f0000000-0000-0000-0000-0000000000a5';
  pv uuid; pvb uuid;
  cli1 uuid; cli2 uuid; clib uuid;
  pet1 uuid; pet2 uuid; pet3 uuid; petb uuid; petx uuid;
  modelo uuid; modelob uuid; produto uuid; cat uuid; cat_off uuid;
  ex1 uuid; ex2 uuid; ex3 uuid; exb uuid; exc uuid;
  d1 uuid; d2 uuid; d3 uuid; d4 uuid; d5 uuid; d6 uuid; db uuid;
  cv1 uuid; cv2 uuid; cvr uuid; cod1 text; cod2 text; codr text; codb text;
  r jsonb; n bigint; lib uuid; vin1 uuid; vin_b uuid; k int;
BEGIN
  INSERT INTO tenants (id, nome) VALUES (ta, 'Clínica A'), (tb, 'Clínica B'), (tc, 'Loja C');
  INSERT INTO empresas (tenant_id, razao_social, nome_fantasia, ramo_atividade) VALUES (ta, 'A LTDA', 'Clínica Alfa', 'clinica'), (tb, 'B LTDA', 'Clínica Beta', 'clinica'), (tc, 'C LTDA', 'Loja C', 'varejo');
  INSERT INTO auth.users (id, email) VALUES (vet, 'v@p.ci'), (rec, 'r@p.ci'), (gest, 'g@p.ci'), (aux, 'a@p.ci'), (vetb, 'vb@p.ci'), (recb, 'rb@p.ci'), (vetc, 'vc@p.ci'),
    (tu1, 'tutor1@exemplo.test'), (tu2, 'tutor2@exemplo.test'), (tu3, 'tutor3@exemplo.test'), (fora, 'fora@exemplo.test'), (brute, 'brute@exemplo.test');
  UPDATE profiles SET tenant_id = ta WHERE id IN (vet, rec, gest, aux);
  UPDATE profiles SET tenant_id = tb WHERE id IN (vetb, recb);
  UPDATE profiles SET tenant_id = tc WHERE id = vetc;
  INSERT INTO user_roles (user_id, tenant_id, role) VALUES
    (vet, ta, 'veterinario'), (rec, ta, 'vendedor'), (gest, ta, 'gestor'), (aux, ta, 'profissional'),
    (vetb, tb, 'veterinario'), (recb, tb, 'vendedor'), (vetc, tc, 'veterinario');
  INSERT INTO pet_profissionais (tenant_id, nome, funcao, crmv, crmv_uf, profile_id, ativo) VALUES (ta, 'Dra Vet', 'veterinario', '11111', 'SP', vet, true) RETURNING id INTO pv;
  INSERT INTO pet_profissionais (tenant_id, nome, funcao, crmv, crmv_uf, profile_id, ativo) VALUES (tb, 'Dr Vet B', 'veterinario', '22222', 'SP', vetb, true) RETURNING id INTO pvb;
  INSERT INTO clientes (tenant_id, nome) VALUES (ta, 'Tutor Um') RETURNING id INTO cli1;
  INSERT INTO clientes (tenant_id, nome) VALUES (ta, 'Tutor Dois') RETURNING id INTO cli2;
  INSERT INTO clientes (tenant_id, nome) VALUES (tb, 'Tutor da B') RETURNING id INTO clib;
  INSERT INTO pets (tenant_id, cliente_id, nome, especie, raca) VALUES (ta, cli1, 'Rex', 'cao', 'SRD') RETURNING id INTO pet1;
  INSERT INTO pets (tenant_id, cliente_id, nome, especie) VALUES (ta, cli1, 'Mel', 'gato') RETURNING id INTO pet2;
  INSERT INTO pets (tenant_id, cliente_id, nome, especie) VALUES (ta, cli2, 'Bidu', 'cao') RETURNING id INTO pet3;
  INSERT INTO pets (tenant_id, cliente_id, nome, especie) VALUES (tb, clib, 'Bob', 'cao') RETURNING id INTO petb;
  INSERT INTO pets (tenant_id, cliente_id, nome, especie, ativo) VALUES (ta, cli1, 'Inativo', 'cao', false) RETURNING id INTO petx;

  -- exames: ex1 fechado (de Rex), ex2 aberto (de Rex), ex3 fechado (de Bidu), exb fechado (de Bob, empresa B)
  INSERT INTO pet_exame_modelos (tenant_id, nome, tipo) VALUES (ta, 'Hemograma', 'hemograma') RETURNING id INTO modelo;
  INSERT INTO pet_exame_modelos (tenant_id, nome, tipo) VALUES (tb, 'Hemograma B', 'hemograma') RETURNING id INTO modelob;
  INSERT INTO pet_exames (tenant_id, pet_id, modelo_id, veterinario_id, crmv, crmv_uf, nome, tipo, material, laboratorio, data_coleta, observacoes)
    VALUES (ta, pet1, modelo, pv, '11111', 'SP', 'Hemograma completo', 'hemograma', 'Sangue', 'Lab Teste', DATE '2026-11-01', 'OBSERVAÇÃO INTERNA DO VET') RETURNING id INTO ex1;
  INSERT INTO pet_exame_resultados (tenant_id, exame_id, ordem, grupo, nome, unidade, forma, casas, valor_num, faixa_min, faixa_max, nota)
    VALUES (ta, ex1, 0, 'Eritrograma', 'Hemácias', 'milhões/µL', 'numero', 2, 6.8, 5.5, 8.5, 'NOTA INTERNA DO RESULTADO');
  INSERT INTO pet_exame_resultados (tenant_id, exame_id, ordem, nome, forma, valor_texto) VALUES (ta, ex1, 1, 'Aspecto', 'texto', 'Normal');
  INSERT INTO pet_exame_resultados (tenant_id, exame_id, ordem, nome, forma) VALUES (ta, ex1, 2, 'Sem valor', 'texto');
  UPDATE pet_exames SET situacao = 'fechado', fechado_em = now() WHERE id = ex1;
  INSERT INTO pet_exames (tenant_id, pet_id, modelo_id, veterinario_id, crmv, crmv_uf, nome, tipo, laboratorio, data_coleta)
    VALUES (ta, pet1, modelo, pv, '11111', 'SP', 'Bioquímica em andamento', 'bioquimica', 'Lab Teste', DATE '2026-11-03') RETURNING id INTO ex2;
  INSERT INTO pet_exames (tenant_id, pet_id, modelo_id, veterinario_id, crmv, crmv_uf, nome, tipo, laboratorio, data_coleta)
    VALUES (ta, pet3, modelo, pv, '11111', 'SP', 'Exame do Bidu', 'outro', 'Lab Teste', DATE '2026-11-02') RETURNING id INTO ex3;
  INSERT INTO pet_exame_resultados (tenant_id, exame_id, ordem, nome, forma, valor_texto) VALUES (ta, ex3, 0, 'Resultado do Bidu', 'texto', 'SEGREDO DO BIDU');
  UPDATE pet_exames SET situacao = 'fechado', fechado_em = now() WHERE id = ex3;
  INSERT INTO pet_exames (tenant_id, pet_id, modelo_id, veterinario_id, crmv, crmv_uf, nome, tipo, laboratorio, data_coleta)
    VALUES (tb, petb, modelob, pvb, '22222', 'SP', 'Exame do Bob', 'outro', 'Lab B', DATE '2026-11-02') RETURNING id INTO exb;
  INSERT INTO pet_exame_resultados (tenant_id, exame_id, ordem, nome, forma, valor_texto) VALUES (tb, exb, 0, 'Resultado do Bob', 'texto', 'SEGREDO DO BOB');
  UPDATE pet_exames SET situacao = 'fechado', fechado_em = now() WHERE id = exb;
  INSERT INTO pet_exames (tenant_id, pet_id, modelo_id, veterinario_id, crmv, crmv_uf, nome, tipo, laboratorio, data_coleta, situacao, cancelado_em, cancelado_motivo)
    VALUES (ta, pet1, modelo, pv, '11111', 'SP', 'Exame cancelado', 'outro', 'Lab Teste', DATE '2026-10-01', 'cancelado', now(), 'erro de cadastro') RETURNING id INTO exc;

  -- receitas e outros documentos
  INSERT INTO pet_documentos (tenant_id, pet_id, cliente_id, veterinario_id, crmv, crmv_uf, tipo, ano, numero, titulo, corpo, itens, snapshot)
    VALUES (ta, pet1, cli1, pv, '11111', 'SP', 'receita', 2026, 1, 'Receita do Rex', 'Dar com alimento.',
            '[{"medicamento":"Amoxicilina 250 mg","posologia":"1 comprimido a cada 12 horas","via":"oral","duracao":"7 dias","quantidade":"14"}]'::jsonb,
            '{"veterinario":{"nome":"Dra Vet"},"tutor":{"nome":"Tutor Um","cpf":"000.000.000-00"},"clinica":"Clínica Alfa"}'::jsonb) RETURNING id INTO d1;
  INSERT INTO pet_documentos (tenant_id, pet_id, cliente_id, veterinario_id, crmv, crmv_uf, tipo, ano, numero, titulo, itens, snapshot, situacao, cancelado_em, cancelado_motivo)
    VALUES (ta, pet1, cli1, pv, '11111', 'SP', 'receita', 2026, 2, 'Receita cancelada', '[{"medicamento":"X","posologia":"y"}]'::jsonb, '{}'::jsonb, 'cancelado', now(), 'erro de digitação') RETURNING id INTO d2;
  INSERT INTO pet_documentos (tenant_id, pet_id, cliente_id, veterinario_id, crmv, crmv_uf, tipo, ano, numero, titulo, itens, snapshot)
    VALUES (ta, pet3, cli2, pv, '11111', 'SP', 'receita', 2026, 3, 'Receita do Bidu', '[{"medicamento":"SEGREDO","posologia":"z"}]'::jsonb, '{}'::jsonb) RETURNING id INTO d3;
  INSERT INTO pet_documentos (tenant_id, pet_id, cliente_id, veterinario_id, crmv, crmv_uf, tipo, ano, numero, titulo, corpo, itens, snapshot)
    VALUES (ta, pet1, cli1, pv, '11111', 'SP', 'atestado', 2026, 4, 'Atestado do Rex', 'Atesto que o animal está apto.', '[]'::jsonb, '{}'::jsonb) RETURNING id INTO d4;
  INSERT INTO pet_documentos (tenant_id, pet_id, cliente_id, veterinario_id, crmv, crmv_uf, tipo, ano, numero, titulo, itens, snapshot)
    VALUES (ta, pet1, cli2, pv, '11111', 'SP', 'receita', 2026, 5, 'Receita emitida a outro tutor', '[{"medicamento":"Q","posologia":"w"}]'::jsonb, '{}'::jsonb) RETURNING id INTO d5;
  INSERT INTO pet_documentos (tenant_id, pet_id, cliente_id, veterinario_id, crmv, crmv_uf, tipo, ano, numero, titulo, itens, snapshot)
    VALUES (ta, pet1, cli1, pv, '11111', 'SP', 'receita', 2026, 6, 'Receita de retorno', '[{"medicamento":"R","posologia":"v"}]'::jsonb, '{}'::jsonb) RETURNING id INTO d6;
  INSERT INTO pet_documentos (tenant_id, pet_id, cliente_id, veterinario_id, crmv, crmv_uf, tipo, ano, numero, titulo, itens, snapshot)
    VALUES (tb, petb, clib, pvb, '22222', 'SP', 'receita', 2026, 1, 'Receita do Bob', '[{"medicamento":"SEGREDO B","posologia":"u"}]'::jsonb, '{}'::jsonb) RETURNING id INTO db;

  -- vacinas: Rex tem uma próxima dose futura, uma antiga demais (mais de 1 ano) e uma de catálogo inativo
  INSERT INTO produtos (tenant_id, codigo_interno, descricao, unidade, custo) VALUES (ta, 'VAC-P', 'Vacina CI', 'dose', 10) RETURNING id INTO produto;
  INSERT INTO pet_vacinas_catalogo (tenant_id, nome, tipo, reforco_dias, produto_id) VALUES (ta, 'V10', 'vacina', 365, produto) RETURNING id INTO cat;
  INSERT INTO pet_vacinas_catalogo (tenant_id, nome, tipo, reforco_dias, produto_id, ativo) VALUES (ta, 'Antiga', 'vacina', 365, produto, false) RETURNING id INTO cat_off;
  INSERT INTO pet_vacinacoes (tenant_id, pet_id, catalogo_id, nome, tipo, origem, dose_tipo, dose_numero, aplicada_em, proxima_dose_em, informado_por)
    VALUES (ta, pet1, cat, 'V10', 'vacina', 'outro_local', 'reforco', 1, CURRENT_DATE - 300, CURRENT_DATE + 20, 'Tutor');
  INSERT INTO pet_vacinacoes (tenant_id, pet_id, catalogo_id, nome, tipo, origem, dose_tipo, dose_numero, aplicada_em, proxima_dose_em, informado_por)
    VALUES (ta, pet1, cat_off, 'Antiga', 'vacina', 'outro_local', 'reforco', 1, CURRENT_DATE - 100, CURRENT_DATE + 30, 'Tutor');
  INSERT INTO pet_vacinacoes (tenant_id, pet_id, catalogo_id, nome, tipo, origem, dose_tipo, dose_numero, aplicada_em, proxima_dose_em, informado_por)
    VALUES (ta, pet3, cat, 'V10', 'vacina', 'outro_local', 'reforco', 1, CURRENT_DATE - 300, CURRENT_DATE + 15, 'Tutor');

  -- ===== convite: só a recepção e a gestão geram =====
  PERFORM ci.deve_falhar(vet, format('SELECT clinica_portal_convite_criar(%L)', cli1), 'veterinário gera convite');
  PERFORM ci.deve_falhar(aux, format('SELECT clinica_portal_convite_criar(%L)', cli1), 'auxiliar gera convite');
  PERFORM ci.deve_falhar(tu1, format('SELECT clinica_portal_convite_criar(%L)', cli1), 'tutor gera convite');
  PERFORM ci.deve_falhar(NULL, format('SELECT clinica_portal_convite_criar(%L)', cli1), 'anônimo gera convite');
  PERFORM ci.deve_falhar(vetc, format('SELECT clinica_portal_convite_criar(%L)', cli1), 'empresa sem clínica gera convite');
  PERFORM ci.deve_falhar(recb, format('SELECT clinica_portal_convite_criar(%L)', cli1), 'recepção de outra empresa gera convite para tutor desta');
  PERFORM ci.deve_falhar(rec, format('SELECT clinica_portal_convite_criar(%L)', gen_random_uuid()), 'convite para tutor inexistente');
  r := ci.como(rec, format('SELECT clinica_portal_convite_criar(%L)', cli1));
  cv1 := (r ->> 'id')::uuid; cod1 := r ->> 'codigo';
  PERFORM ci.exige(cod1 ~ '^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$', 'a recepção recebe o código no formato XXXX-XXXX-XXXX-XXXX');
  PERFORM ci.exige((r ->> 'expira_em')::timestamptz > now() + interval '6 days' AND (r ->> 'expira_em')::timestamptz <= now() + interval '7 days 1 minute', 'o convite vale 7 dias');
  PERFORM ci.exige(NOT EXISTS (SELECT 1 FROM portal_convites WHERE codigo_hash = replace(cod1, '-', '') OR codigo_hash = cod1)
                   AND (SELECT codigo_hash FROM portal_convites WHERE id = cv1) = encode(sha256(convert_to(replace(cod1, '-', ''), 'UTF8')), 'hex'), 'no banco fica só o hash do código, nunca o código');
  r := ci.como(gest, format('SELECT clinica_portal_convite_criar(%L)', cli2));
  cv2 := (r ->> 'id')::uuid; cod2 := r ->> 'codigo';
  PERFORM ci.exige(cv2 IS NOT NULL AND cod2 <> cod1, 'a gestão também gera, e cada convite tem código diferente');
  FOR k IN 1..4 LOOP r := ci.como(rec, format('SELECT clinica_portal_convite_criar(%L)', cli1)); END LOOP;
  cvr := (r ->> 'id')::uuid; codr := r ->> 'codigo';
  PERFORM ci.deve_falhar(rec, format('SELECT clinica_portal_convite_criar(%L)', cli1), 'sexto convite pendente do mesmo tutor');

  -- ===== recepção vê acessos; veterinário e tutor não =====
  r := ci.como(rec, format('SELECT clinica_portal_acessos(%L)', cli1));
  PERFORM ci.exige(jsonb_array_length(r -> 'convites') = 5 AND (SELECT count(*) FROM jsonb_array_elements(r -> 'convites') x WHERE x ->> 'estado' = 'pendente') = 5, 'a recepção lista os convites do tutor como pendentes');
  PERFORM ci.exige(NOT (r::text LIKE '%' || replace(cod1, '-', '') || '%') AND NOT (r::text LIKE '%' || cod1 || '%'), 'a lista de acessos nunca traz o código');
  PERFORM ci.deve_falhar(vet, 'SELECT clinica_portal_acessos()', 'veterinário lista acessos');
  PERFORM ci.deve_falhar(tu1, 'SELECT clinica_portal_acessos()', 'tutor lista acessos');
  r := ci.como(recb, 'SELECT clinica_portal_acessos()');
  PERFORM ci.exige(jsonb_array_length(r -> 'convites') = 0, 'a recepção de outra empresa não vê estes convites');

  -- ===== revogar convite pendente =====
  PERFORM ci.deve_falhar(vet, format('SELECT clinica_portal_convite_revogar(%L)', cvr), 'veterinário revoga convite');
  PERFORM ci.deve_falhar(recb, format('SELECT clinica_portal_convite_revogar(%L)', cv1), 'recepção de outra empresa revoga convite');
  PERFORM ci.como(rec, format('SELECT to_jsonb(clinica_portal_convite_revogar(%L))', cvr));
  PERFORM ci.deve_falhar(rec, format('SELECT clinica_portal_convite_revogar(%L)', cvr), 'revogar de novo o mesmo convite');
  r := ci.como(rec, format('SELECT clinica_portal_acessos(%L)', cli1));
  PERFORM ci.exige((SELECT x ->> 'estado' FROM jsonb_array_elements(r -> 'convites') x WHERE (x ->> 'id')::uuid = cvr) = 'revogado', 'a lista mostra o convite como revogado');

  -- ===== resgate: o tutor entra com a conta dele e usa o código =====
  PERFORM ci.deve_falhar(NULL, $q$SELECT portal_resgatar_convite('AAAA-BBBB-CCCC-DDDD')$q$, 'anônimo resgata convite');
  r := ci.como(tu1, $q$SELECT portal_resgatar_convite('AAAA-BBBB-CCCC-DDDD')$q$);
  PERFORM ci.exige((r ->> 'ok')::boolean = false AND r ->> 'erro' LIKE 'Código inválido%', 'código errado: recusado sem exceção');
  PERFORM ci.exige((SELECT count(*) FROM portal_tentativas WHERE user_id = tu1) = 1, 'a tentativa errada fica registrada');
  -- código revogado, vencido e usado dão a MESMA mensagem
  INSERT INTO portal_convites (tenant_id, cliente_id, codigo_hash, expira_em, criado_por) VALUES (ta, cli1, public._portal_codigo_hash('VENCIDO000000001'), now() - interval '1 minute', rec);
  PERFORM ci.exige((ci.como(tu1, $q$SELECT portal_resgatar_convite('VENCIDO000000001')$q$) ->> 'erro') = (ci.como(tu1, $q$SELECT portal_resgatar_convite('AAAA-BBBB-CCCC-DDDD')$q$) ->> 'erro'), 'convite vencido dá a mesma mensagem do código errado');
  r := ci.como(tu1, format('SELECT portal_resgatar_convite(%L)', 'abcd'));
  PERFORM ci.exige((r ->> 'ok')::boolean = false, 'código curto demais');
  -- convite revogado não resgata, e a mensagem é a mesma
  PERFORM ci.exige((ci.como(tu1, format('SELECT portal_resgatar_convite(%L)', codr)) ->> 'erro') = (ci.como(tu1, $q$SELECT portal_resgatar_convite('AAAA-BBBB-CCCC-DDDD')$q$) ->> 'erro'), 'convite revogado dá a mesma mensagem do código errado');
  r := ci.como(tu1, format('SELECT portal_resgatar_convite(%L)', cod1));
  PERFORM ci.exige((r ->> 'ok')::boolean AND r ->> 'clinica' = 'Clínica Alfa', 'código certo vincula o tutor e mostra o nome da clínica');
  PERFORM ci.exige((SELECT usado_por FROM portal_convites WHERE id = cv1) = tu1 AND (SELECT count(*) FROM portal_vinculos WHERE user_id = tu1 AND cliente_id = cli1 AND revogado_em IS NULL) = 1, 'convite fica usado e o vínculo ativo');
  r := ci.como(tu1, format('SELECT portal_resgatar_convite(%L)', cod1));
  PERFORM ci.exige((r ->> 'ok')::boolean = false, 'o mesmo código não vale duas vezes (nem para o mesmo tutor)');
  r := ci.como(tu2, format('SELECT portal_resgatar_convite(%L)', cod1));
  PERFORM ci.exige((r ->> 'ok')::boolean = false, 'código já usado por outro tutor não vale');
  r := ci.como(tu2, format('SELECT portal_resgatar_convite(%L)', lower(replace(cod2, '-', ''))));
  PERFORM ci.exige((r ->> 'ok')::boolean, 'minúsculas e sem hífen também valem (é o mesmo código)');
  -- limite de tentativas: 10 erros por hora bloqueiam até o código certo
  FOR k IN 1..10 LOOP PERFORM ci.como(brute, format('SELECT portal_resgatar_convite(%L)', 'ERRADO' || k)); END LOOP;
  r := ci.como(brute, format('SELECT portal_resgatar_convite(%L)', 'X'));
  PERFORM ci.exige((r ->> 'ok')::boolean = false AND r ->> 'erro' LIKE 'Muitas tentativas%', 'depois de 10 erros o tutor é barrado por uma hora');
  r := ci.como(rec, format('SELECT clinica_portal_convite_criar(%L)', cli2));
  r := ci.como(brute, format('SELECT portal_resgatar_convite(%L)', r ->> 'codigo'));
  PERFORM ci.exige((r ->> 'ok')::boolean = false AND r ->> 'erro' LIKE 'Muitas tentativas%', 'barrado vale até para um código correto');
  PERFORM ci.exige(NOT EXISTS (SELECT 1 FROM portal_vinculos WHERE user_id = brute), 'quem foi barrado não ganha vínculo');

  -- ===== o que o tutor vê antes de qualquer liberação =====
  r := ci.como(tu1, 'SELECT portal_meus_pets()');
  PERFORM ci.exige(jsonb_array_length(r) = 1 AND r -> 0 ->> 'clinica' = 'Clínica Alfa' AND r -> 0 ->> 'tutor' = 'Tutor Um', 'o tutor vê o cadastro dele e o nome da clínica');
  PERFORM ci.exige((SELECT string_agg(x ->> 'nome', ',' ORDER BY x ->> 'nome') FROM jsonb_array_elements(r -> 0 -> 'pets') x) = 'Mel,Rex', 'só os animais ativos do cadastro dele (não o inativo, não o Bidu, não o Bob)');
  PERFORM ci.exige((SELECT jsonb_array_length(x -> 'vacinas') FROM jsonb_array_elements(r -> 0 -> 'pets') x WHERE x ->> 'nome' = 'Rex') = 1
                   AND (SELECT x -> 'vacinas' -> 0 ->> 'nome' FROM jsonb_array_elements(r -> 0 -> 'pets') x WHERE x ->> 'nome' = 'Rex') = 'V10', 'próxima vacina do Rex aparece (sem liberação); a de catálogo inativo não');
  PERFORM ci.exige((SELECT (x ->> 'exames')::int + (x ->> 'receitas')::int FROM jsonb_array_elements(r -> 0 -> 'pets') x WHERE x ->> 'nome' = 'Rex') = 0, 'nada liberado ainda: zero exames e zero receitas');
  PERFORM ci.exige(NOT (r::text LIKE '%SEGREDO%') AND NOT (r::text LIKE '%Bidu%') AND NOT (r::text LIKE '%Bob%'), 'nada de outro tutor ou de outra empresa na resposta');
  PERFORM ci.exige(jsonb_array_length(ci.como(fora, 'SELECT portal_meus_pets()')) = 0, 'conta sem vínculo não vê animal nenhum');
  PERFORM ci.deve_falhar(fora, format('SELECT portal_pet_itens(%L)', pet1), 'conta sem vínculo abre os itens de um animal');
  PERFORM ci.deve_falhar(fora, format('SELECT portal_exame_obter(%L)', ex1), 'conta sem vínculo abre exame');
  PERFORM ci.deve_falhar(fora, format('SELECT portal_receita_obter(%L)', d1), 'conta sem vínculo abre receita');
  PERFORM ci.deve_falhar(NULL, 'SELECT portal_meus_pets()', 'anônimo lista animais');

  -- ===== liberar: só o veterinário, só o que é liberável =====
  PERFORM ci.deve_falhar(rec, format($q$SELECT clinica_portal_liberar('exame', %L)$q$, ex1), 'recepção libera exame');
  PERFORM ci.deve_falhar(gest, format($q$SELECT clinica_portal_liberar('exame', %L)$q$, ex1), 'gestão libera exame');
  PERFORM ci.deve_falhar(aux, format($q$SELECT clinica_portal_liberar('exame', %L)$q$, ex1), 'auxiliar libera exame');
  PERFORM ci.deve_falhar(tu1, format($q$SELECT clinica_portal_liberar('exame', %L)$q$, ex1), 'tutor se autoriza');
  PERFORM ci.deve_falhar(vetb, format($q$SELECT clinica_portal_liberar('exame', %L)$q$, ex1), 'veterinário de outra empresa libera exame desta');
  PERFORM ci.deve_falhar(vet, format($q$SELECT clinica_portal_liberar('exame', %L)$q$, ex2), 'exame ainda aberto');
  PERFORM ci.deve_falhar(vet, format($q$SELECT clinica_portal_liberar('exame', %L)$q$, exc), 'exame cancelado');
  PERFORM ci.deve_falhar(vet, format($q$SELECT clinica_portal_liberar('documento', %L)$q$, d2), 'receita cancelada');
  PERFORM ci.deve_falhar(vet, format($q$SELECT clinica_portal_liberar('documento', %L)$q$, d4), 'atestado (só receita nesta versão)');
  PERFORM ci.deve_falhar(vet, format($q$SELECT clinica_portal_liberar('documento', %L)$q$, d5), 'receita emitida para outro tutor');
  PERFORM ci.deve_falhar(vet, format($q$SELECT clinica_portal_liberar('prontuario', %L)$q$, ex1), 'tipo inválido');
  PERFORM ci.deve_falhar(vet, format($q$SELECT clinica_portal_liberar('exame', %L)$q$, gen_random_uuid()), 'exame inexistente');
  lib := (ci.como(vet, format($q$SELECT to_jsonb(clinica_portal_liberar('exame', %L))$q$, ex1)) #>> '{}')::uuid;
  PERFORM ci.exige(lib IS NOT NULL AND (ci.como(vet, format($q$SELECT to_jsonb(clinica_portal_liberar('exame', %L))$q$, ex1)) #>> '{}')::uuid = lib
                   AND (SELECT count(*) FROM portal_liberacoes WHERE ref_id = ex1) = 1, 'o veterinário libera o exame; repetir devolve a mesma liberação');
  PERFORM ci.como(vet, format($q$SELECT to_jsonb(clinica_portal_liberar('documento', %L))$q$, d1));
  PERFORM ci.como(vet, format($q$SELECT to_jsonb(clinica_portal_liberar('documento', %L))$q$, d6));

  -- ===== o que o veterinário vê para decidir =====
  r := ci.como(vet, format('SELECT clinica_portal_itens_do_pet(%L)', pet1));
  PERFORM ci.exige((r ->> 'tutor_com_acesso')::boolean AND jsonb_array_length(r -> 'exames') = 1 AND (r -> 'exames' -> 0 ->> 'liberado')::boolean
                   AND (SELECT count(*) FROM jsonb_array_elements(r -> 'receitas') x WHERE (x ->> 'liberado')::boolean) = 2, 'o veterinário vê os fechados e as receitas com o estado da liberação');
  PERFORM ci.exige(NOT (r::text LIKE '%Hemácias%') AND NOT (r::text LIKE '%Amoxicilina%'), 'a lista do veterinário traz só títulos e datas, não o conteúdo');
  PERFORM ci.deve_falhar(rec, format('SELECT clinica_portal_itens_do_pet(%L)', pet1), 'recepção lista itens do animal');
  PERFORM ci.deve_falhar(vetb, format('SELECT clinica_portal_itens_do_pet(%L)', pet1), 'veterinário de outra empresa lista animal desta');
  r := ci.como(vet, format('SELECT clinica_portal_itens_do_pet(%L)', pet3));
  PERFORM ci.exige((r ->> 'tutor_com_acesso')::boolean AND jsonb_array_length(r -> 'exames') = 1 AND NOT (r -> 'exames' -> 0 ->> 'liberado')::boolean, 'animal do segundo tutor: tutor com acesso e o exame ainda não liberado');

  -- ===== o tutor vê o que foi liberado, e só isso =====
  r := ci.como(tu1, format('SELECT portal_pet_itens(%L)', pet1));
  PERFORM ci.exige(jsonb_array_length(r -> 'exames') = 1 AND r -> 'exames' -> 0 ->> 'nome' = 'Hemograma completo' AND r -> 'exames' -> 0 ->> 'estado' = 'disponivel', 'o tutor vê o exame liberado');
  PERFORM ci.exige(jsonb_array_length(r -> 'receitas') = 2 AND NOT (r::text LIKE '%Atestado%') AND NOT (r::text LIKE '%cancelada%') AND NOT (r::text LIKE '%outro tutor%'), 'receitas liberadas sim; atestado, cancelada não liberada e receita de outro tutor não');
  PERFORM ci.deve_falhar(tu1, format('SELECT portal_pet_itens(%L)', pet3), 'tutor abre os itens do animal de outro tutor');
  PERFORM ci.deve_falhar(tu1, format('SELECT portal_pet_itens(%L)', petb), 'tutor abre os itens de animal de outra empresa');
  PERFORM ci.deve_falhar(tu1, format('SELECT portal_pet_itens(%L)', petx), 'tutor abre animal inativo');
  PERFORM ci.deve_falhar(tu1, format('SELECT portal_pet_itens(%L)', gen_random_uuid()), 'tutor abre animal inexistente');
  r := ci.como(tu1, 'SELECT portal_meus_pets()');
  PERFORM ci.exige((SELECT (x ->> 'exames')::int FROM jsonb_array_elements(r -> 0 -> 'pets') x WHERE x ->> 'nome' = 'Rex') = 1
                   AND (SELECT (x ->> 'receitas')::int FROM jsonb_array_elements(r -> 0 -> 'pets') x WHERE x ->> 'nome' = 'Rex') = 2, 'a lista de animais conta o que foi liberado');

  -- ===== exame: conteúdo, privacidade e registro de consulta =====
  r := ci.como(tu1, format('SELECT portal_exame_obter(%L)', ex1));
  PERFORM ci.exige(r ->> 'estado' = 'disponivel' AND r ->> 'nome' = 'Hemograma completo' AND r -> 'veterinario' ->> 'crmv' = '11111' AND r ->> 'clinica' = 'Clínica Alfa', 'exame disponível com autoria, CRMV e clínica');
  PERFORM ci.exige(jsonb_array_length(r -> 'resultados') = 2 AND r -> 'resultados' -> 0 ->> 'nome' = 'Hemácias' AND (r -> 'resultados' -> 0 ->> 'valor_num')::numeric = 6.8
                   AND (r -> 'resultados' -> 0 ->> 'faixa_min')::numeric = 5.5 AND r -> 'resultados' -> 1 ->> 'valor_texto' = 'Normal', 'valores com unidade e a referência da clínica; campo sem valor não aparece');
  PERFORM ci.exige(NOT (r::text LIKE '%INTERNA%') AND NOT (r::text ILIKE '%observac%') AND NOT (r::text ILIKE '%nota%'), 'nenhuma observação nem nota interna vai ao tutor');
  PERFORM ci.exige((SELECT count(*) FROM portal_acessos WHERE tipo = 'exame' AND ref_id = ex1 AND user_id = tu1) = 1, 'a consulta do tutor ao exame fica registrada');
  PERFORM ci.como(tu1, format('SELECT portal_exame_obter(%L)', ex1));
  PERFORM ci.exige((SELECT count(*) FROM portal_acessos WHERE tipo = 'exame' AND ref_id = ex1) = 2, 'cada nova consulta é registrada');
  r := ci.como(tu1, format('SELECT portal_exame_obter(%L)', ex2));
  PERFORM ci.exige(r ->> 'estado' = 'nao_liberado' AND NOT (r::text LIKE '%resultados%'), 'exame do próprio animal ainda não liberado: estado claro, sem conteúdo');
  PERFORM ci.exige((SELECT count(*) FROM portal_acessos WHERE ref_id = ex2) = 0, 'estado "não liberado" não conta como consulta');
  PERFORM ci.deve_falhar(tu1, format('SELECT portal_exame_obter(%L)', ex3), 'exame de animal de outro tutor');
  PERFORM ci.deve_falhar(tu1, format('SELECT portal_exame_obter(%L)', exb), 'exame de outra empresa');
  PERFORM ci.deve_falhar(tu1, format('SELECT portal_exame_obter(%L)', gen_random_uuid()), 'exame inexistente');
  r := ci.como(vet, format('SELECT clinica_portal_itens_do_pet(%L)', pet1));
  PERFORM ci.exige(r -> 'exames' -> 0 ->> 'ultima_consulta' IS NOT NULL, 'o veterinário vê que o tutor consultou o exame');

  -- ===== receita =====
  r := ci.como(tu1, format('SELECT portal_receita_obter(%L)', d1));
  PERFORM ci.exige(r ->> 'estado' = 'disponivel' AND r -> 'itens' -> 0 ->> 'medicamento' = 'Amoxicilina 250 mg' AND r ->> 'orientacoes' = 'Dar com alimento.'
                   AND r -> 'veterinario' ->> 'nome' = 'Dra Vet' AND r -> 'veterinario' ->> 'crmv' = '11111', 'receita disponível com itens, orientações e autoria');
  PERFORM ci.exige(NOT (r::text LIKE '%000.000%') AND NOT (r::text LIKE '%snapshot%') AND NOT (r::text LIKE '%cliente_id%'), 'dados do cadastro do tutor e da cópia interna não vão na receita');
  PERFORM ci.exige((SELECT count(*) FROM portal_acessos WHERE tipo = 'documento' AND ref_id = d1) = 1, 'a consulta à receita fica registrada');
  r := ci.como(tu1, format('SELECT portal_receita_obter(%L)', d2));
  PERFORM ci.exige(r ->> 'estado' = 'nao_liberado' AND NOT (r::text LIKE '%itens%'), 'receita cancelada que nunca foi liberada: não liberada');
  PERFORM ci.deve_falhar(tu1, format('SELECT portal_receita_obter(%L)', d4), 'atestado não abre pelo portal (só receita)');
  PERFORM ci.deve_falhar(tu1, format('SELECT portal_receita_obter(%L)', d3), 'receita de outro tutor');
  PERFORM ci.deve_falhar(tu1, format('SELECT portal_receita_obter(%L)', db), 'receita de outra empresa');
  PERFORM ci.deve_falhar(tu1, format('SELECT portal_receita_obter(%L)', d5), 'receita emitida a outro tutor para o mesmo animal');
  -- receita liberada e depois cancelada: o tutor vê o aviso, sem conteúdo e sem o motivo
  UPDATE pet_documentos SET situacao = 'cancelado', cancelado_em = now(), cancelado_motivo = 'MOTIVO INTERNO DO CANCELAMENTO' WHERE id = d6;
  r := ci.como(tu1, format('SELECT portal_receita_obter(%L)', d6));
  PERFORM ci.exige(r ->> 'estado' = 'cancelado' AND r ->> 'cancelado_em' IS NOT NULL AND NOT (r::text LIKE '%itens%') AND NOT (r::text LIKE '%INTERNO%') AND NOT (r::text LIKE '%R%posologia%'), 'receita cancelada depois de liberada: aviso claro, sem conteúdo e sem motivo');
  r := ci.como(tu1, format('SELECT portal_pet_itens(%L)', pet1));
  PERFORM ci.exige((SELECT x ->> 'estado' FROM jsonb_array_elements(r -> 'receitas') x WHERE x ->> 'titulo' = 'Receita de retorno') = 'cancelado', 'na lista a receita cancelada aparece como cancelada');

  -- ===== outro tutor, outra empresa =====
  r := ci.como(tu2, 'SELECT portal_meus_pets()');
  PERFORM ci.exige(jsonb_array_length(r) = 1 AND (SELECT string_agg(x ->> 'nome', ',') FROM jsonb_array_elements(r -> 0 -> 'pets') x) = 'Bidu', 'o segundo tutor vê só o Bidu');
  PERFORM ci.deve_falhar(tu2, format('SELECT portal_exame_obter(%L)', ex1), 'segundo tutor abre exame do Rex pelo id');
  PERFORM ci.deve_falhar(tu2, format('SELECT portal_receita_obter(%L)', d1), 'segundo tutor abre receita do Rex pelo id');
  PERFORM ci.deve_falhar(tu2, format('SELECT portal_pet_itens(%L)', pet1), 'segundo tutor abre itens do Rex');
  -- um tutor com vínculo em duas clínicas vê cada uma separada
  r := ci.como(recb, format('SELECT clinica_portal_convite_criar(%L)', clib)); codb := r ->> 'codigo';
  PERFORM ci.como(vetb, format($q$SELECT to_jsonb(clinica_portal_liberar('exame', %L))$q$, exb));
  r := ci.como(tu1, format('SELECT portal_resgatar_convite(%L)', codb));
  PERFORM ci.exige((r ->> 'ok')::boolean AND r ->> 'clinica' = 'Clínica Beta', 'o mesmo tutor se vincula também a uma segunda clínica');
  r := ci.como(tu1, 'SELECT portal_meus_pets()');
  PERFORM ci.exige(jsonb_array_length(r) = 2 AND (SELECT count(*) FROM jsonb_array_elements(r) x WHERE x ->> 'clinica' IN ('Clínica Alfa', 'Clínica Beta')) = 2, 'cada clínica aparece separada');
  PERFORM ci.exige((ci.como(tu1, format('SELECT portal_exame_obter(%L)', exb)) ->> 'estado') = 'disponivel', 'e o exame liberado na segunda clínica abre');
  PERFORM ci.exige((ci.como(tu1, format('SELECT portal_pet_itens(%L)', pet1)) -> 'pet' ->> 'nome') = 'Rex', 'sem misturar com a primeira');

  -- ===== retirar a liberação =====
  PERFORM ci.deve_falhar(rec, format($q$SELECT clinica_portal_retirar('exame', %L)$q$, ex1), 'recepção retira liberação');
  PERFORM ci.deve_falhar(vetb, format($q$SELECT clinica_portal_retirar('exame', %L)$q$, ex1), 'veterinário de outra empresa retira liberação');
  PERFORM ci.como(vet, format($q$SELECT to_jsonb(clinica_portal_retirar('exame', %L))$q$, ex1));
  PERFORM ci.exige((ci.como(tu1, format('SELECT portal_exame_obter(%L)', ex1)) ->> 'estado') = 'nao_liberado', 'retirado: o exame volta a "não liberado" na hora');
  r := ci.como(tu1, format('SELECT portal_pet_itens(%L)', pet1));
  PERFORM ci.exige(jsonb_array_length(r -> 'exames') = 0, 'retirado: some da lista do tutor');
  PERFORM ci.deve_falhar(vet, format($q$SELECT clinica_portal_retirar('exame', %L)$q$, ex1), 'retirar de novo');
  PERFORM ci.como(vet, format($q$SELECT to_jsonb(clinica_portal_liberar('exame', %L))$q$, ex1));
  PERFORM ci.exige((SELECT count(*) FROM portal_liberacoes WHERE ref_id = ex1) = 2 AND (SELECT count(*) FROM portal_liberacoes WHERE ref_id = ex1 AND retirado_em IS NULL) = 1, 'liberar de novo cria outra liberação e o histórico da retirada fica');

  -- ===== animal muda de tutor: a liberação não acompanha =====
  UPDATE pets SET cliente_id = cli2 WHERE id = pet2;
  UPDATE pets SET cliente_id = cli2 WHERE id = pet1;
  r := ci.como(tu1, 'SELECT portal_meus_pets()');
  PERFORM ci.exige(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r) c, jsonb_array_elements(c -> 'pets') p WHERE p ->> 'nome' IN ('Rex', 'Mel')), 'transferido o animal, o tutor antigo perde o acesso na hora');
  PERFORM ci.deve_falhar(tu1, format('SELECT portal_exame_obter(%L)', ex1), 'tutor antigo abre exame do animal transferido');
  r := ci.como(tu2, format('SELECT portal_exame_obter(%L)', ex1));
  PERFORM ci.exige(r ->> 'estado' = 'nao_liberado', 'o novo tutor NÃO herda a liberação feita ao antigo');
  PERFORM ci.deve_falhar(tu2, format('SELECT portal_receita_obter(%L)', d1), 'novo tutor abre receita emitida ao antigo');
  r := ci.como(tu2, format('SELECT portal_pet_itens(%L)', pet1));
  PERFORM ci.exige(jsonb_array_length(r -> 'exames') = 0 AND jsonb_array_length(r -> 'receitas') = 0, 'a lista do novo tutor vem vazia até nova liberação');
  UPDATE pets SET cliente_id = cli1 WHERE id IN (pet1, pet2);

  -- ===== revogar o acesso do tutor =====
  r := ci.como(rec, format('SELECT clinica_portal_acessos(%L)', cli1));
  vin1 := (SELECT (x ->> 'id')::uuid FROM jsonb_array_elements(r -> 'vinculos') x WHERE (x ->> 'ativo')::boolean LIMIT 1);
  PERFORM ci.exige(vin1 IS NOT NULL AND (SELECT x ->> 'email' FROM jsonb_array_elements(r -> 'vinculos') x WHERE (x ->> 'id')::uuid = vin1) = 't***@exemplo.test'
                   AND NOT (r::text LIKE '%tutor1@%'), 'a recepção vê o vínculo com o e-mail mascarado');
  PERFORM ci.exige((SELECT x ->> 'ultima_consulta' FROM jsonb_array_elements(r -> 'vinculos') x WHERE (x ->> 'id')::uuid = vin1) IS NOT NULL, 'e a data da última consulta do tutor');
  PERFORM ci.deve_falhar(vet, format($q$SELECT clinica_portal_vinculo_revogar(%L, 'sem permissão')$q$, vin1), 'veterinário revoga acesso');
  PERFORM ci.deve_falhar(recb, format($q$SELECT clinica_portal_vinculo_revogar(%L, 'outra empresa')$q$, vin1), 'recepção de outra empresa revoga acesso');
  PERFORM ci.deve_falhar(tu1, format($q$SELECT clinica_portal_vinculo_revogar(%L, 'o próprio tutor')$q$, vin1), 'tutor revoga pela função da clínica');
  PERFORM ci.deve_falhar(rec, format($q$SELECT clinica_portal_vinculo_revogar(%L, 'ab')$q$, vin1), 'motivo curto demais');
  PERFORM ci.como(rec, format($q$SELECT to_jsonb(clinica_portal_vinculo_revogar(%L, 'Tutor mudou de e-mail'))$q$, vin1));
  PERFORM ci.exige(jsonb_array_length(ci.como(tu1, 'SELECT portal_meus_pets()')) = 1, 'revogado: o tutor perde só a clínica A (a B continua)');
  PERFORM ci.deve_falhar(tu1, format('SELECT portal_exame_obter(%L)', ex1), 'revogado: exame abre?');
  PERFORM ci.deve_falhar(tu1, format('SELECT portal_receita_obter(%L)', d1), 'revogado: receita abre?');
  PERFORM ci.deve_falhar(tu1, format('SELECT portal_pet_itens(%L)', pet1), 'revogado: itens do animal abrem?');
  PERFORM ci.deve_falhar(rec, format($q$SELECT clinica_portal_vinculo_revogar(%L, 'de novo')$q$, vin1), 'revogar de novo');
  PERFORM ci.exige((SELECT revogado_motivo FROM portal_vinculos WHERE id = vin1) = 'Tutor mudou de e-mail' AND (SELECT count(*) FROM portal_acessos WHERE user_id = tu1) >= 3, 'a revogação guarda o motivo e o histórico de consultas continua');
  -- recuperar o acesso: novo convite
  r := ci.como(rec, format('SELECT clinica_portal_convite_criar(%L)', cli1));
  PERFORM ci.exige((ci.como(tu1, format('SELECT portal_resgatar_convite(%L)', r ->> 'codigo')) ->> 'ok')::boolean, 'novo convite devolve o acesso (recuperação pela recepção)');
  PERFORM ci.exige((ci.como(tu1, format('SELECT portal_exame_obter(%L)', ex1)) ->> 'estado') = 'disponivel' AND (SELECT count(*) FROM portal_vinculos WHERE user_id = tu1 AND cliente_id = cli1) = 2, 'e o histórico do vínculo antigo permanece');

  -- ===== imutabilidade e acesso direto =====
  BEGIN UPDATE portal_convites SET expira_em = now() + interval '1 year' WHERE id = cv1; RAISE EXCEPTION 'FALHA: alterou a validade do convite';
  EXCEPTION WHEN OTHERS THEN PERFORM ci.exige(SQLERRM LIKE '%não se altera%', 'a validade do convite não muda'); END;
  BEGIN UPDATE portal_convites SET usado_em = NULL, usado_por = NULL WHERE id = cv1; RAISE EXCEPTION 'FALHA: reabriu o convite usado';
  EXCEPTION WHEN OTHERS THEN PERFORM ci.exige(SQLERRM LIKE '%não se altera%', 'convite usado não volta a valer'); END;
  BEGIN DELETE FROM portal_convites WHERE id = cv1; RAISE EXCEPTION 'FALHA: apagou convite';
  EXCEPTION WHEN OTHERS THEN PERFORM ci.exige(SQLERRM LIKE '%não se apaga%', 'convite não se apaga'); END;
  BEGIN UPDATE portal_vinculos SET revogado_em = NULL, revogado_por = NULL WHERE id = vin1; RAISE EXCEPTION 'FALHA: reativou vínculo revogado';
  EXCEPTION WHEN OTHERS THEN PERFORM ci.exige(SQLERRM LIKE '%não se altera%', 'vínculo revogado não é reativado (só um novo convite)'); END;
  BEGIN UPDATE portal_vinculos SET cliente_id = cli2 WHERE id = vin1; RAISE EXCEPTION 'FALHA: trocou o cadastro do vínculo';
  EXCEPTION WHEN OTHERS THEN PERFORM ci.exige(SQLERRM LIKE '%não se altera%', 'vínculo não troca de cadastro'); END;
  BEGIN DELETE FROM portal_liberacoes WHERE ref_id = ex1; RAISE EXCEPTION 'FALHA: apagou liberação';
  EXCEPTION WHEN OTHERS THEN PERFORM ci.exige(SQLERRM LIKE '%não se apaga%', 'liberação não se apaga'); END;
  BEGIN UPDATE portal_acessos SET created_at = now() - interval '1 year'; RAISE EXCEPTION 'FALHA: alterou consulta';
  EXCEPTION WHEN OTHERS THEN PERFORM ci.exige(SQLERRM LIKE '%não se altera%', 'registro de consulta não se altera'); END;
  BEGIN DELETE FROM portal_tentativas; RAISE EXCEPTION 'FALHA: apagou tentativas';
  EXCEPTION WHEN OTHERS THEN PERFORM ci.exige(SQLERRM LIKE '%não se apaga%', 'tentativas de código não se apagam'); END;
  PERFORM ci.deve_falhar(tu1, 'SELECT count(*) FROM portal_convites', 'tutor lê convites direto');
  PERFORM ci.deve_falhar(tu1, 'SELECT count(*) FROM portal_vinculos', 'tutor lê vínculos direto');
  PERFORM ci.deve_falhar(tu1, 'SELECT count(*) FROM portal_liberacoes', 'tutor lê liberações direto');
  PERFORM ci.deve_falhar(tu1, 'SELECT count(*) FROM portal_acessos', 'tutor lê acessos direto');
  PERFORM ci.deve_falhar(rec, 'SELECT count(*) FROM portal_convites', 'recepção lê convites direto (só pela função, sem hash)');
  PERFORM ci.deve_falhar(tu1, format($q$INSERT INTO portal_vinculos (tenant_id, cliente_id, user_id) VALUES (%L, %L, %L)$q$, ta, cli2, tu1), 'tutor se vincula por inserção direta');
  PERFORM ci.deve_falhar(tu1, format($q$INSERT INTO portal_liberacoes (tipo, ref_id, pet_id, cliente_id, liberado_por) VALUES ('exame', %L, %L, %L, %L)$q$, ex3, pet3, cli2, pv), 'tutor se autoriza por inserção direta');

  -- ===== o tutor não ganha nada do aplicativo da clínica =====
  PERFORM ci.deve_falhar(tu1, format('SELECT clinica_exame_get(%L)', pet1), 'tutor usa o exame do prontuário');
  PERFORM ci.deve_falhar(tu1, format('SELECT clinica_documentos_do_pet(%L)', pet1), 'tutor lista documentos do prontuário');
  PERFORM ci.deve_falhar(tu1, format('SELECT clinica_cartao_vacinacao(%L)', pet1), 'tutor abre o cartão de vacinação da clínica');
  PERFORM ci.exige((ci.como(tu1, $q$SELECT jsonb_build_object('t', current_tenant_id())$q$) -> 't') = 'null'::jsonb, 'o tutor não pertence a empresa nenhuma');
  PERFORM ci.exige(NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id IN (tu1, tu2, tu3, fora, brute)), 'o portal não concede papel nenhum ao tutor');
END $$;
ROLLBACK;
