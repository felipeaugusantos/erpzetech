-- Testes comportamentais do status do WhatsApp da clínica (o que o painel de relacionamento mostra):
-- entrega e leitura só avançam, evento repetido ou fora de ordem não retrocede, uma empresa não mexe na outra,
-- resultado do envio é idempotente e a recusa (SAIR) cancela a fila. Tudo com dados fictícios e ROLLBACK.
\set ON_ERROR_STOP on
BEGIN;
CREATE SCHEMA ci;
CREATE FUNCTION ci.exige(condicao boolean, descricao text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF condicao IS NOT TRUE THEN RAISE EXCEPTION 'FALHA: %', descricao; END IF;
  RAISE NOTICE 'ok: %', descricao;
END $$;

DO $$
DECLARE
  ta constant uuid := 'd1111111-1111-1111-1111-111111111111';
  tb constant uuid := 'd2222222-2222-2222-2222-222222222222';
  cli_a uuid; cli_b uuid; cli_s uuid; pet_a uuid; pet_b uuid; pet_s uuid;
  m1 uuid; m2 uuid; m3 uuid; m4 uuid; mb uuid; msaida uuid; menv uuid; mfila uuid;
  n integer;
  sit text;
BEGIN
  INSERT INTO tenants (id, nome) VALUES (ta, 'Clínica A'), (tb, 'Clínica B');
  INSERT INTO empresas (tenant_id, razao_social, ramo_atividade) VALUES (ta, 'A LTDA', 'clinica'), (tb, 'B LTDA', 'clinica');
  INSERT INTO wa_config (tenant_id, instancia, estado) VALUES (ta, 'inst-a', 'conectada'), (tb, 'inst-b', 'conectada');
  INSERT INTO clientes (tenant_id, nome, whatsapp, aceita_mensagens) VALUES (ta, 'Tutor A', '5516999990001', true) RETURNING id INTO cli_a;
  INSERT INTO clientes (tenant_id, nome, whatsapp, aceita_mensagens) VALUES (tb, 'Tutor B', '5516999990001', true) RETURNING id INTO cli_b;
  INSERT INTO clientes (tenant_id, nome, whatsapp, aceita_mensagens) VALUES (ta, 'Tutor Sair', '5511988887777', true) RETURNING id INTO cli_s;
  INSERT INTO pets (tenant_id, cliente_id, nome, especie) VALUES (ta, cli_a, 'Rex', 'cao') RETURNING id INTO pet_a;
  INSERT INTO pets (tenant_id, cliente_id, nome, especie) VALUES (tb, cli_b, 'Bob', 'cao') RETURNING id INTO pet_b;
  INSERT INTO pets (tenant_id, cliente_id, nome, especie) VALUES (ta, cli_s, 'Mel', 'gato') RETURNING id INTO pet_s;

  -- mensagens já aceitas pelo serviço (enviada), com id externo; uma da empresa B com o MESMO id externo
  INSERT INTO wa_mensagens (tenant_id, tipo, referencia, cliente_id, pet_id, numero, origem, situacao, id_externo)
    VALUES (ta, 'reforco_vacina', pet_a || ':2026-11-10', cli_a, pet_a, '5516999990001', 'automatico', 'enviada', 'ext-1') RETURNING id INTO m1;
  INSERT INTO wa_mensagens (tenant_id, tipo, referencia, cliente_id, pet_id, numero, origem, situacao, id_externo)
    VALUES (ta, 'reforco_vacina', pet_a || ':2026-11-11', cli_a, pet_a, '5516999990001', 'automatico', 'enviada', 'ext-2') RETURNING id INTO m2;
  INSERT INTO wa_mensagens (tenant_id, tipo, referencia, cliente_id, pet_id, numero, origem, situacao, id_externo)
    VALUES (ta, 'reforco_vacina', pet_a || ':2026-11-12', cli_a, pet_a, '5516999990001', 'automatico', 'falhou', 'ext-3') RETURNING id INTO m3;
  INSERT INTO wa_mensagens (tenant_id, tipo, referencia, cliente_id, pet_id, numero, origem, situacao, id_externo)
    VALUES (ta, 'reforco_vacina', pet_a || ':2026-11-13', cli_a, pet_a, '5516999990001', 'automatico', 'cancelada', 'ext-4') RETURNING id INTO m4;
  INSERT INTO wa_mensagens (tenant_id, tipo, referencia, cliente_id, pet_id, numero, origem, situacao, id_externo)
    VALUES (tb, 'reforco_vacina', pet_b || ':2026-11-10', cli_b, pet_b, '5516999990001', 'automatico', 'enviada', 'ext-1') RETURNING id INTO mb;

  SET ROLE service_role;

  -- entrega confirmada
  PERFORM public.wa_status('inst-a', 'ext-1', 'entregue');
  RESET ROLE;
  PERFORM ci.exige((SELECT situacao FROM wa_mensagens WHERE id = m1) = 'entregue', 'entrega confirmada avança de enviada para entregue');
  PERFORM ci.exige((SELECT situacao FROM wa_mensagens WHERE id = mb) = 'enviada', 'o mesmo id externo em outra empresa não é afetado');

  SET ROLE service_role;
  PERFORM public.wa_status('inst-a', 'ext-1', 'entregue');  -- repetido
  PERFORM public.wa_status('inst-a', 'ext-1', 'entregue');
  RESET ROLE;
  PERFORM ci.exige((SELECT situacao FROM wa_mensagens WHERE id = m1) = 'entregue', 'evento de entrega repetido não muda nada');

  SET ROLE service_role;
  PERFORM public.wa_status('inst-a', 'ext-1', 'lida');
  PERFORM public.wa_status('inst-a', 'ext-1', 'entregue');  -- atrasado, depois de lida
  RESET ROLE;
  PERFORM ci.exige((SELECT situacao FROM wa_mensagens WHERE id = m1) = 'lida', 'entrega atrasada não retrocede uma mensagem já lida');

  SET ROLE service_role;
  PERFORM public.wa_status('inst-a', 'ext-2', 'lida');  -- chegou a leitura sem a entrega
  PERFORM public.wa_status('inst-a', 'ext-2', 'entregue');
  RESET ROLE;
  PERFORM ci.exige((SELECT situacao FROM wa_mensagens WHERE id = m2) = 'lida', 'leitura sem aviso de entrega vale e a entrega que chega depois é ignorada');

  SET ROLE service_role;
  PERFORM public.wa_status('inst-a', 'ext-3', 'entregue');
  PERFORM public.wa_status('inst-a', 'ext-4', 'lida');
  PERFORM public.wa_status('inst-a', 'ext-1', 'enviada');
  PERFORM public.wa_status('inst-a', 'ext-1', 'qualquer');
  PERFORM public.wa_status('inst-inexistente', 'ext-1', 'lida');
  RESET ROLE;
  PERFORM ci.exige((SELECT situacao FROM wa_mensagens WHERE id = m3) = 'falhou', 'evento não ressuscita mensagem que falhou');
  PERFORM ci.exige((SELECT situacao FROM wa_mensagens WHERE id = m4) = 'cancelada', 'evento não altera mensagem cancelada');
  PERFORM ci.exige((SELECT situacao FROM wa_mensagens WHERE id = m1) = 'lida', 'status desconhecido ou instância inexistente são ignorados');

  -- resultado do envio: grava a aceitação uma única vez e registra o contato do pet
  INSERT INTO wa_mensagens (tenant_id, tipo, referencia, cliente_id, pet_id, numero, origem, situacao)
    VALUES (ta, 'reforco_vacina', pet_a || ':2026-12-01', cli_a, pet_a, '5516999990001', 'automatico', 'enviando') RETURNING id INTO menv;
  SET ROLE service_role;
  PERFORM public.wa_resultado(menv, true, 'ext-9', 'jid-9', NULL, NULL);
  PERFORM public.wa_resultado(menv, true, 'ext-OUTRO', 'jid-outro', NULL, NULL);  -- repetido
  PERFORM public.wa_resultado(menv, false, NULL, NULL, 'erro tardio', NULL);       -- falha tardia depois de aceita
  RESET ROLE;
  SELECT situacao INTO sit FROM wa_mensagens WHERE id = menv;
  PERFORM ci.exige(sit = 'enviada' AND (SELECT id_externo FROM wa_mensagens WHERE id = menv) = 'ext-9', 'resultado repetido ou tardio não troca o id externo nem o estado');
  PERFORM ci.exige((SELECT count(*) FROM pet_contatos WHERE pet_id = pet_a AND tipo = 'reforco' AND referencia = DATE '2026-12-01') = 1, 'a aceitação do serviço registra um único contato (comportamento atual: sai da lista manual)');

  -- falha definitiva: fica "falhou" com o motivo e não cria contato
  INSERT INTO wa_mensagens (tenant_id, tipo, referencia, cliente_id, pet_id, numero, origem, situacao)
    VALUES (ta, 'reforco_vacina', pet_a || ':2026-12-02', cli_a, pet_a, '5516999990001', 'automatico', 'enviando') RETURNING id INTO menv;
  SET ROLE service_role;
  PERFORM public.wa_resultado(menv, false, NULL, NULL, 'Número sem WhatsApp', NULL);
  RESET ROLE;
  PERFORM ci.exige((SELECT situacao || '|' || erro FROM wa_mensagens WHERE id = menv) = 'falhou|Número sem WhatsApp', 'falha definitiva guarda o motivo');
  PERFORM ci.exige((SELECT count(*) FROM pet_contatos WHERE pet_id = pet_a AND referencia = DATE '2026-12-02') = 0, 'falha não registra contato');

  -- recusa (SAIR): cancela o que está na fila do tutor, desmarca o aceite e não toca no que já foi enviado
  INSERT INTO wa_mensagens (tenant_id, tipo, referencia, cliente_id, pet_id, numero, origem, situacao)
    VALUES (ta, 'reforco_vacina', pet_s || ':2026-12-05', cli_s, pet_s, '5511988887777', 'automatico', 'na_fila') RETURNING id INTO mfila;
  INSERT INTO wa_mensagens (tenant_id, tipo, referencia, cliente_id, pet_id, numero, origem, situacao, id_externo)
    VALUES (ta, 'reforco_vacina', pet_s || ':2026-11-01', cli_s, pet_s, '5511988887777', 'automatico', 'enviada', 'ext-s') RETURNING id INTO msaida;
  SET ROLE service_role;
  n := public.wa_saida_registrar('inst-a', '5511988887777', '5511988887777@s.whatsapp.net');
  n := public.wa_saida_registrar('inst-a', '5511988887777', '5511988887777@s.whatsapp.net');  -- repetida
  RESET ROLE;
  PERFORM ci.exige((SELECT situacao FROM wa_mensagens WHERE id = mfila) = 'cancelada', 'SAIR cancela o lembrete que estava na fila');
  PERFORM ci.exige((SELECT situacao FROM wa_mensagens WHERE id = msaida) = 'enviada', 'SAIR não altera o que já foi enviado');
  PERFORM ci.exige(NOT (SELECT aceita_mensagens FROM clientes WHERE id = cli_s), 'SAIR desmarca o aceite do tutor');
  PERFORM ci.exige((SELECT aceita_mensagens FROM clientes WHERE id = cli_a), 'SAIR de um tutor não afeta outro');
  PERFORM ci.exige((SELECT aceita_mensagens FROM clientes WHERE id = cli_b), 'SAIR em uma empresa não afeta tutor de outra com número parecido');
END $$;
ROLLBACK;
