-- Testes comportamentais dos RPCs da clínica (fila do dia, modelos de receita, lembretes de WhatsApp).
-- Cada verificação lança exceção se o comportamento esperado não ocorrer.
-- Roda ANTES do smoke.sql no run.sh: traz as próprias fixtures ci.* e desfaz tudo com ROLLBACK,
-- para ficar de pé mesmo se uma falha antiga do smoke interromper o script.
\set ON_ERROR_STOP on
SET timezone TO 'America/Sao_Paulo';

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
  BEGIN
    EXECUTE cmd;
  EXCEPTION WHEN OTHERS THEN
    falhou := true;
  END;
  PERFORM ci.sair();
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
  tv    constant uuid := 'b1111111-1111-1111-1111-111111111111';
  tw    constant uuid := 'b2222222-2222-2222-2222-222222222222';
  vet   constant uuid := 'b0000000-0000-0000-0000-000000000001';
  rec   constant uuid := 'b0000000-0000-0000-0000-000000000002';
  motv  constant uuid := 'b0000000-0000-0000-0000-000000000003';
  gestv constant uuid := 'b0000000-0000-0000-0000-000000000004';
  admw  constant uuid := 'b0000000-0000-0000-0000-000000000005';
  vetw  constant uuid := 'b0000000-0000-0000-0000-000000000006';
  tos   constant uuid := 'b0000000-0000-0000-0000-000000000007';
  emp_v uuid; prof_v uuid; cli_a uuid; cli_s uuid; cli_o uuid;
  pet_a uuid; pet_s uuid; pet_w uuid; pet_o uuid; ag_a uuid; ag_s uuid; ag_o uuid; at_a uuid; at_s uuid; at_o uuid;
  fila_id uuid; modelo_id uuid; n bigint; cli_w uuid;
BEGIN
  -- ===== fixtures: duas empresas com clínica (V e W) e papéis variados =====
  INSERT INTO tenants (id, nome) VALUES (tv, 'Clínica V'), (tw, 'Clínica W');
  INSERT INTO empresas (tenant_id, razao_social, ramo_atividade) VALUES (tv, 'Clínica V LTDA', 'clinica') RETURNING id INTO emp_v;
  INSERT INTO empresas (tenant_id, razao_social, ramo_atividade) VALUES (tw, 'Clínica W LTDA', 'clinica');
  INSERT INTO auth.users (id, email) VALUES
    (vet, 'vet@v.ci'), (rec, 'rec@v.ci'), (motv, 'mot@v.ci'), (gestv, 'gest@v.ci'), (admw, 'adm@w.ci'), (vetw, 'vet@w.ci'), (tos, 'tos@v.ci');
  UPDATE profiles SET tenant_id = tv, nome = 'vet' WHERE id = vet;
  UPDATE profiles SET tenant_id = tv, nome = 'rec' WHERE id = rec;
  UPDATE profiles SET tenant_id = tv, nome = 'mot' WHERE id = motv;
  UPDATE profiles SET tenant_id = tv, nome = 'gest' WHERE id = gestv;
  UPDATE profiles SET tenant_id = tv, nome = 'tos' WHERE id = tos;
  UPDATE profiles SET tenant_id = tw, nome = 'admw' WHERE id = admw;
  UPDATE profiles SET tenant_id = tw, nome = 'vetw' WHERE id = vetw;
  INSERT INTO user_roles (user_id, tenant_id, role) VALUES
    (vet, tv, 'veterinario'), (rec, tv, 'vendedor'), (motv, tv, 'motorista'), (gestv, tv, 'gestor'), (admw, tw, 'administrador'), (vetw, tw, 'veterinario'), (tos, tv, 'profissional');
  INSERT INTO pet_profissionais (tenant_id, nome, funcao, crmv, crmv_uf, profile_id, ativo)
    VALUES (tv, 'Dra Vet', 'veterinario', '12345', 'SP', vet, true) RETURNING id INTO prof_v;
  INSERT INTO pet_profissionais (tenant_id, nome, funcao, crmv, crmv_uf, profile_id, ativo)
    VALUES (tw, 'Dr Vet W', 'veterinario', '54321', 'SP', vetw, true);
  INSERT INTO clientes (tenant_id, empresa_id, nome, telefone, aceita_mensagens) VALUES
    (tv, emp_v, 'Tutor A', '5516999990001', true),
    (tv, emp_v, 'Tutor Sem Consent', '5516999990002', false),
    (tv, emp_v, 'Tutor OptOut', '5516999990003', true);
  SELECT id INTO cli_a FROM clientes WHERE tenant_id = tv AND nome = 'Tutor A';
  SELECT id INTO cli_s FROM clientes WHERE tenant_id = tv AND nome = 'Tutor Sem Consent';
  SELECT id INTO cli_o FROM clientes WHERE tenant_id = tv AND nome = 'Tutor OptOut';
  INSERT INTO pets (tenant_id, cliente_id, nome, especie) VALUES
    (tv, cli_a, 'Rex', 'cao'), (tv, cli_s, 'Mimi', 'gato');
  SELECT id INTO pet_a FROM pets WHERE tenant_id = tv AND nome = 'Rex';
  SELECT id INTO pet_s FROM pets WHERE tenant_id = tv AND nome = 'Mimi';
  INSERT INTO clientes (tenant_id, nome, telefone, aceita_mensagens) VALUES (tw, 'Tutor W', '5516999990009', true) RETURNING id INTO cli_w;
  INSERT INTO pets (tenant_id, cliente_id, nome, especie) VALUES (tw, cli_w, 'PetW', 'cao') RETURNING id INTO pet_w;
  INSERT INTO pets (tenant_id, cliente_id, nome, especie) VALUES (tv, cli_o, 'Lulu', 'gato') RETURNING id INTO pet_o;
  INSERT INTO pet_agendamentos (tenant_id, pet_id, cliente_id, profissional_id, inicio, fim, situacao)
    VALUES (tv, pet_a, cli_a, prof_v, now(), now() + interval '1 hour', 'retirado') RETURNING id INTO ag_a;
  INSERT INTO pet_agendamentos (tenant_id, pet_id, cliente_id, profissional_id, inicio, fim, situacao)
    VALUES (tv, pet_s, cli_s, prof_v, now(), now() + interval '1 hour', 'retirado') RETURNING id INTO ag_s;
  INSERT INTO pet_agendamentos (tenant_id, pet_id, cliente_id, profissional_id, inicio, fim, situacao)
    VALUES (tv, pet_o, cli_o, prof_v, now(), now() + interval '1 hour', 'retirado') RETURNING id INTO ag_o;
  INSERT INTO pet_atendimentos_clinicos (tenant_id, pet_id, cliente_id, agendamento_id, veterinario_id, crmv, crmv_uf, situacao, fechado_em, retorno_em)
    VALUES (tv, pet_a, cli_a, ag_a, prof_v, '12345', 'SP', 'fechado', now(), (now()::date + 1)) RETURNING id INTO at_a;
  INSERT INTO pet_atendimentos_clinicos (tenant_id, pet_id, cliente_id, agendamento_id, veterinario_id, crmv, crmv_uf, situacao, fechado_em, retorno_em)
    VALUES (tv, pet_s, cli_s, ag_s, prof_v, '12345', 'SP', 'fechado', now(), (now()::date + 1)) RETURNING id INTO at_s;
  INSERT INTO pet_atendimentos_clinicos (tenant_id, pet_id, cliente_id, agendamento_id, veterinario_id, crmv, crmv_uf, situacao, fechado_em, retorno_em)
    VALUES (tv, pet_o, cli_o, ag_o, prof_v, '12345', 'SP', 'fechado', now(), (now()::date + 1)) RETURNING id INTO at_o;
  INSERT INTO wa_saidas (tenant_id, chave) VALUES (tv, '5516999990003');
  INSERT INTO wa_config (tenant_id, instancia, estado) VALUES (tv, 'zt-v', 'conectada'), (tw, 'zt-w', 'conectada');

  -- ===== 1. fila: equipe opera, demais papéis são recusados =====
  PERFORM ci.entrar(rec);
  fila_id := (SELECT (clinica_fila_entrada(jsonb_build_object('pet_id', pet_a, 'gravidade', 'urgente', 'queixa', 'vômito')) ->> 'id')::uuid);
  PERFORM ci.sair();
  PERFORM ci.exige(fila_id IS NOT NULL, 'recepção dá entrada na fila');
  PERFORM ci.deve_falhar(rec, format('SELECT count(*) FROM clinica_fila WHERE id = %L', fila_id),
    'leitura direta da tabela clinica_fila é negada (só via RPC)');
  PERFORM ci.deve_falhar(rec, format($c$SELECT clinica_fila_entrada(jsonb_build_object('pet_id', %L, 'gravidade', 'comum'))$c$, pet_a),
    'o mesmo pet não entra duas vezes enquanto aguarda');
  PERFORM ci.deve_falhar(rec, format($c$SELECT clinica_fila_situacao(%L, 'atendido')$c$, fila_id),
    'transição aguardando -> atendido é recusada (precisa chamar antes)');
  PERFORM ci.deve_falhar(motv, $c$SELECT clinica_fila_listar()$c$, 'motorista não lê a fila');
  PERFORM ci.deve_falhar(motv, format($c$SELECT clinica_fila_entrada(jsonb_build_object('pet_id', %L))$c$, pet_a),
    'motorista não dá entrada na fila');
  PERFORM ci.deve_falhar(tos, $c$SELECT clinica_fila_listar()$c$, 'tosador (restrito, não veterinário) não lê a fila');
  PERFORM ci.deve_falhar(vet, format($c$SELECT clinica_fila_entrada(jsonb_build_object('pet_id', %L))$c$, pet_s),
    'veterinário não registra entrada (é da recepção)');
  PERFORM ci.deve_falhar(vet, format($c$SELECT clinica_fila_gravidade(%L, 'emergencia')$c$, fila_id),
    'veterinário não muda a triagem (é da recepção)');
  PERFORM ci.deve_falhar(vet, format($c$SELECT clinica_fila_buscar_paciente(%L)$c$, 'Rex'),
    'veterinário não usa a busca de chegada (é da recepção)');
  PERFORM ci.exige(ci.contar(vet, $c$SELECT jsonb_array_length(clinica_fila_listar() -> 'fila')$c$) = 1,
    'veterinário acompanha a fila do dia');
  PERFORM ci.deve_falhar(NULL, $c$SELECT clinica_fila_listar()$c$, 'anônimo não lê a fila');
  PERFORM ci.deve_falhar(NULL, format($c$SELECT clinica_fila_situacao(%L, 'em_atendimento')$c$, fila_id), 'anônimo não muda situação');

  -- ===== 2. isolamento entre empresas na fila =====
  PERFORM ci.exige(ci.contar(admw, $c$SELECT jsonb_array_length(clinica_fila_listar() -> 'fila')$c$) = 0,
    'empresa W não vê a fila da empresa V');
  PERFORM ci.deve_falhar(admw, format($c$SELECT clinica_fila_situacao(%L, 'em_atendimento')$c$, fila_id),
    'empresa W não altera entrada da fila da empresa V');
  PERFORM ci.deve_falhar(admw, format($c$SELECT clinica_fila_gravidade(%L, 'emergencia')$c$, fila_id),
    'empresa W não muda gravidade na empresa V');
  PERFORM ci.exige(ci.contar(admw, format($c$SELECT jsonb_array_length(clinica_fila_buscar_paciente(%L))$c$, 'Rex')) = 0,
    'busca de paciente não vaza pet de outra empresa');
  PERFORM ci.deve_falhar(admw, format($c$SELECT clinica_fila_entrada(jsonb_build_object('pet_id', %L))$c$, pet_a),
    'empresa W não dá entrada para pet da empresa V (id externo)');

  -- ===== 3. fluxo da fila: o veterinário chama e atende; desistência é da recepção =====
  PERFORM ci.deve_falhar(vet, format($c$SELECT clinica_fila_situacao(%L, 'desistiu')$c$, fila_id),
    'veterinário não baixa desistência (é da recepção)');
  PERFORM ci.entrar(vet);
  PERFORM clinica_fila_situacao(fila_id, 'em_atendimento');
  PERFORM clinica_fila_situacao(fila_id, 'atendido');
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT situacao FROM public.clinica_fila WHERE id = fila_id) = 'atendido', 'fila fecha após o veterinário chamar e atender');
  PERFORM ci.deve_falhar(rec, format($c$SELECT clinica_fila_situacao(%L, 'aguardando')$c$, fila_id), 'atendido não volta para a fila');

  -- ===== 4. modelos de receita: só veterinário, isolados por empresa =====
  PERFORM ci.deve_falhar(rec, $c$SELECT clinica_receita_modelos()$c$, 'recepção não lê modelos de receita');
  PERFORM ci.deve_falhar(rec, $c$SELECT clinica_receita_modelo_salvar('Modelo X', '[{"medicamento":"Dipirona","posologia":"1ml"}]')$c$,
    'recepção não grava modelo de receita');
  PERFORM ci.deve_falhar(motv, $c$SELECT clinica_receita_modelos()$c$, 'motorista não lê modelos de receita');
  PERFORM ci.deve_falhar(NULL, $c$SELECT clinica_receita_modelos()$c$, 'anônimo não lê modelos de receita');
  PERFORM ci.entrar(vet);
  modelo_id := clinica_receita_modelo_salvar('Pós-cirúrgico', '[{"medicamento":"Melox","posologia":"1 cp/dia"}]', 'Repouso');
  PERFORM ci.sair();
  PERFORM ci.exige(modelo_id IS NOT NULL, 'veterinário grava modelo de receita');
  PERFORM ci.deve_falhar(vet, $c$SELECT clinica_receita_modelo_salvar('Controlado', '[{"medicamento":"X","posologia":"1","controlado":true}]')$c$,
    'modelo com medicamento controlado é recusado');
  PERFORM ci.exige(ci.contar(vet, $c$SELECT jsonb_array_length(clinica_receita_modelos())$c$) = 1, 'veterinário lê o próprio modelo');
  PERFORM ci.exige(ci.contar(vetw, $c$SELECT jsonb_array_length(clinica_receita_modelos())$c$) = 0,
    'empresa W não vê modelos da empresa V');
  PERFORM ci.deve_falhar(vetw, format($c$SELECT clinica_receita_modelo_excluir(%L)$c$, modelo_id),
    'empresa W não exclui modelo da empresa V');
  PERFORM ci.deve_falhar(vetw, format($c$SELECT clinica_receita_modelo_salvar('Cópia', (SELECT itens::text FROM pet_receita_modelos WHERE id = %L))$c$, modelo_id),
    'modelo de outra empresa não é acessível por id externo');
  PERFORM ci.entrar(vet);
  PERFORM clinica_receita_modelo_salvar('Pós-cirúrgico', '[{"medicamento":"Dipirona","posologia":"1ml 8/8h"}]', NULL);
  PERFORM ci.sair();
  PERFORM ci.exige((SELECT count(*) FROM pet_receita_modelos WHERE tenant_id = 'b1111111-1111-1111-1111-111111111111') = 1,
    'mesmo título atualiza em vez de duplicar');

  -- ===== 5. automação desligada por padrão não enfileira =====
  PERFORM ci.exige(public.wa_auto_varrer() = 0, 'com auto_reforco/auto_retorno desligados (padrão) a varredura não enfileira nada');

  -- ===== 6. ligar automação exige gestão e conexão; depois enfileira sem duplicar =====
  PERFORM ci.deve_falhar(rec, $c$SELECT clinica_wa_automatico_salvar(true, true)$c$, 'recepção não liga a automação');
  UPDATE wa_config SET estado = 'desconectada' WHERE tenant_id = 'b1111111-1111-1111-1111-111111111111';
  PERFORM ci.deve_falhar(gestv, $c$SELECT clinica_wa_automatico_salvar(true, true)$c$, 'não liga automação com WhatsApp desconectado');
  UPDATE wa_config SET estado = 'conectada' WHERE tenant_id = 'b1111111-1111-1111-1111-111111111111';
  PERFORM ci.entrar(gestv);
  PERFORM clinica_wa_automatico_salvar(false, true);
  PERFORM ci.sair();
  PERFORM ci.exige(public.wa_auto_varrer() = 1,
    'com auto_retorno ligado enfileira só o tutor com consentimento e sem opt-out (1 de 3 retornos)');
  PERFORM ci.exige(public.wa_auto_varrer() = 0, 'segunda varredura não duplica o lembrete');
  PERFORM ci.deve_falhar(rec, format($c$SELECT clinica_wa_enfileirar('retorno_consulta', %L)$c$, at_a),
    'envio manual do mesmo lembrete é recusado (já na fila)');
  PERFORM ci.exige(NOT EXISTS (SELECT 1 FROM wa_mensagens WHERE tenant_id = 'b1111111-1111-1111-1111-111111111111' AND tipo = 'retorno_consulta' AND referencia = at_s::text),
    'tutor que não aceita mensagens não entra na fila');
  PERFORM ci.exige(NOT EXISTS (SELECT 1 FROM wa_mensagens WHERE tenant_id = 'b1111111-1111-1111-1111-111111111111' AND tipo = 'retorno_consulta' AND referencia = at_o::text),
    'tutor que pediu SAIR não entra na fila');

  -- ===== 7. desligar a chave cancela o pendente na reserva =====
  PERFORM ci.entrar(gestv);
  PERFORM clinica_wa_automatico_salvar(false, false);
  PERFORM ci.sair();
  PERFORM public.wa_reservar(10, 5, true);
  PERFORM ci.exige((SELECT situacao FROM wa_mensagens WHERE tenant_id = 'b1111111-1111-1111-1111-111111111111' AND tipo = 'retorno_consulta') = 'cancelada',
    'desligar a automação cancela o lembrete pendente na próxima rodada');

  -- ===== 8. envio manual exige conexão e papel =====
  PERFORM ci.deve_falhar(motv, format($c$SELECT clinica_wa_enfileirar('retorno_consulta', %L)$c$, at_a), 'motorista não enfileira lembrete');
  PERFORM ci.deve_falhar(NULL, format($c$SELECT clinica_wa_enfileirar('retorno_consulta', %L)$c$, at_a), 'anônimo não enfileira lembrete');
  UPDATE wa_config SET estado = 'desconectada' WHERE tenant_id = 'b1111111-1111-1111-1111-111111111111';
  PERFORM ci.deve_falhar(rec, format($c$SELECT clinica_wa_enfileirar('retorno_consulta', %L)$c$, at_a),
    'sem WhatsApp conectado o envio manual é recusado');
  UPDATE wa_config SET estado = 'conectada' WHERE tenant_id = 'b1111111-1111-1111-1111-111111111111';

  -- ===== 9. empresa sem clínica liberada (demo/construção) é recusada =====
  PERFORM ci.deve_falhar('a0000000-0000-0000-0000-000000000001', $c$SELECT clinica_fila_listar()$c$,
    'empresa sem módulo clínica não usa a fila');
  PERFORM ci.deve_falhar('a0000000-0000-0000-0000-000000000001', $c$SELECT clinica_wa_automatico_salvar(true, true)$c$,
    'empresa sem módulo clínica não liga automação da clínica');
  PERFORM ci.deve_falhar('a0000000-0000-0000-0000-000000000001', format($c$SELECT clinica_wa_enfileirar('retorno_consulta', %L)$c$, at_a),
    'empresa sem módulo clínica não enfileira lembrete da clínica');

  RAISE NOTICE 'TODOS OS TESTES COMPORTAMENTAIS PASSARAM';
END $$;

RESET ROLE;
ROLLBACK;
