-- Testes comportamentais do status do WhatsApp da clínica (o que o painel de relacionamento mostra):
-- entrega e leitura só avançam, evento repetido ou fora de ordem não retrocede, uma empresa não mexe na outra,
-- resultado do envio é idempotente, o contato de reforço só nasce com a entrega confirmada e a recusa (SAIR) cancela a fila. Tudo com dados fictícios e ROLLBACK.
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
    VALUES (ta, 'reforco_vacina', pet_a || ':2026-11-12', cli_a, pet_a, '5516999990001', 'automatico', 'falhou', NULL) RETURNING id INTO m3;
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
  PERFORM ci.exige((SELECT situacao FROM wa_mensagens WHERE id = m3) = 'falhou', 'evento não ressuscita falha de envio (sem id externo)');
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
  PERFORM ci.exige((SELECT count(*) FROM pet_contatos WHERE pet_id = pet_a AND tipo = 'reforco' AND referencia = DATE '2026-12-01') = 0, 'a aceitação do serviço NÃO registra contato de reforço (o pet continua na lista até a entrega ser confirmada)');

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

-- Contato confirmado: o pet de reforço só sai da lista manual com entrega confirmada ou "Já falei" da recepção;
-- o WhatsApp pode informar falha depois da aceitação; o lava rápido continua gravando contato na aceitação.
DO $$
DECLARE
  tc constant uuid := 'e1111111-1111-1111-1111-111111111111';
  td constant uuid := 'e2222222-2222-2222-2222-222222222222';
  cli_c uuid; cli_d uuid; pet_c uuid; pet_d uuid; veic uuid;
  m1 uuid; m2 uuid; m3 uuid; m4 uuid; m5 uuid; m6 uuid; md uuid; ml uuid; mfila uuid;
  vet constant uuid := 'e0000000-0000-0000-0000-000000000001';
BEGIN
  INSERT INTO tenants (id, nome) VALUES (tc, 'Clínica C'), (td, 'Clínica D');
  INSERT INTO empresas (tenant_id, razao_social, ramo_atividade) VALUES (tc, 'C LTDA', 'clinica'), (td, 'D LTDA', 'clinica');
  INSERT INTO wa_config (tenant_id, instancia, estado) VALUES (tc, 'inst-c', 'conectada'), (td, 'inst-d', 'conectada');
  INSERT INTO auth.users (id, email) VALUES (vet, 'recepcao@c.ci');
  INSERT INTO clientes (tenant_id, nome, whatsapp, aceita_mensagens) VALUES (tc, 'Tutor C', '5516999990011', true) RETURNING id INTO cli_c;
  INSERT INTO clientes (tenant_id, nome, whatsapp, aceita_mensagens) VALUES (td, 'Tutor D', '5516999990011', true) RETURNING id INTO cli_d;
  INSERT INTO pets (tenant_id, cliente_id, nome, especie) VALUES (tc, cli_c, 'Luna', 'cao') RETURNING id INTO pet_c;
  INSERT INTO pets (tenant_id, cliente_id, nome, especie) VALUES (td, cli_d, 'Thor', 'cao') RETURNING id INTO pet_d;

  INSERT INTO wa_mensagens (tenant_id, tipo, referencia, cliente_id, pet_id, numero, origem, situacao, id_externo, criado_por)
    VALUES (tc, 'reforco_vacina', pet_c || ':2026-12-10', cli_c, pet_c, '5516999990011', 'manual', 'enviada', 'c-1', vet) RETURNING id INTO m1;
  INSERT INTO wa_mensagens (tenant_id, tipo, referencia, cliente_id, pet_id, numero, origem, situacao, id_externo)
    VALUES (tc, 'reforco_vacina', pet_c || ':2026-12-11', cli_c, pet_c, '5516999990011', 'automatico', 'enviada', 'c-2') RETURNING id INTO m2;
  INSERT INTO wa_mensagens (tenant_id, tipo, referencia, cliente_id, pet_id, numero, origem, situacao, id_externo)
    VALUES (tc, 'reforco_vacina', pet_c || ':2026-12-12', cli_c, pet_c, '5516999990011', 'automatico', 'enviada', 'c-3') RETURNING id INTO m3;
  INSERT INTO wa_mensagens (tenant_id, tipo, referencia, cliente_id, pet_id, numero, origem, situacao, id_externo)
    VALUES (tc, 'reforco_vacina', pet_c || ':2026-12-13', cli_c, pet_c, '5516999990011', 'automatico', 'enviada', 'c-4') RETURNING id INTO m4;
  INSERT INTO wa_mensagens (tenant_id, tipo, referencia, cliente_id, pet_id, numero, origem, situacao, id_externo)
    VALUES (tc, 'reforco_vacina', pet_c || ':2026-12-14', cli_c, pet_c, '5516999990011', 'automatico', 'falhou', NULL) RETURNING id INTO m5;
  INSERT INTO wa_mensagens (tenant_id, tipo, referencia, cliente_id, pet_id, numero, origem, situacao, id_externo)
    VALUES (tc, 'reforco_vacina', pet_c || ':2026-12-15', cli_c, pet_c, '5516999990011', 'automatico', 'enviada', 'c-6') RETURNING id INTO m6;
  INSERT INTO wa_mensagens (tenant_id, tipo, referencia, cliente_id, pet_id, numero, origem, situacao, id_externo)
    VALUES (td, 'reforco_vacina', pet_d || ':2026-12-10', cli_d, pet_d, '5516999990011', 'automatico', 'enviada', 'c-1') RETURNING id INTO md;
  INSERT INTO wa_mensagens (tenant_id, tipo, referencia, cliente_id, pet_id, numero, origem, situacao)
    VALUES (tc, 'retorno_consulta', gen_random_uuid()::text, cli_c, pet_c, '5516999990011', 'automatico', 'enviando') RETURNING id INTO mfila;

  SET ROLE service_role;
  -- aceitação (retorno de consulta também): sem contato
  PERFORM public.wa_resultado(mfila, true, 'c-7', 'jid', NULL, NULL);
  RESET ROLE;
  PERFORM ci.exige((SELECT situacao FROM wa_mensagens WHERE id = mfila) = 'enviada', 'aceitação continua marcando enviada');
  PERFORM ci.exige((SELECT count(*) FROM pet_contatos WHERE tenant_id = tc) = 0, 'aceitação de lembrete da clínica não grava contato');

  -- entrega confirmada grava um único contato, do pedido da recepção
  SET ROLE service_role;
  PERFORM public.wa_status('inst-c', 'c-1', 'entregue');
  PERFORM public.wa_status('inst-c', 'c-1', 'entregue');
  PERFORM public.wa_status('inst-c', 'c-1', 'lida');
  RESET ROLE;
  PERFORM ci.exige((SELECT count(*) FROM pet_contatos WHERE pet_id = pet_c AND tipo = 'reforco' AND referencia = DATE '2026-12-10' AND canal = 'whatsapp' AND contatado_por = vet) = 1,
                   'entrega confirmada grava um único contato (repetição e leitura não duplicam)');
  PERFORM ci.exige((SELECT count(*) FROM pet_contatos WHERE tenant_id = td) = 0, 'a confirmação de uma empresa não grava contato na outra');
  PERFORM ci.exige((SELECT situacao FROM wa_mensagens WHERE id = md) = 'enviada', 'mesmo id externo em outra empresa continua intacto');

  -- leitura sem aviso de entrega também prova o contato
  SET ROLE service_role;
  PERFORM public.wa_status('inst-c', 'c-2', 'lida');
  RESET ROLE;
  PERFORM ci.exige((SELECT count(*) FROM pet_contatos WHERE pet_id = pet_c AND referencia = DATE '2026-12-11') = 1, 'leitura sem aviso de entrega grava o contato');

  -- falha informada depois da aceitação: vira falhou, sem contato; entrega posterior prevalece
  SET ROLE service_role;
  PERFORM public.wa_status('inst-c', 'c-3', 'erro');
  RESET ROLE;
  PERFORM ci.exige((SELECT situacao || '|' || erro FROM wa_mensagens WHERE id = m3) = 'falhou|O WhatsApp informou falha na entrega', 'falha informada pelo WhatsApp registra o motivo');
  PERFORM ci.exige((SELECT count(*) FROM pet_contatos WHERE pet_id = pet_c AND referencia = DATE '2026-12-12') = 0, 'falha não grava contato (o pet volta para a lista)');
  SET ROLE service_role;
  PERFORM public.wa_status('inst-c', 'c-3', 'entregue');
  RESET ROLE;
  PERFORM ci.exige((SELECT situacao FROM wa_mensagens WHERE id = m3) = 'entregue' AND (SELECT erro FROM wa_mensagens WHERE id = m3) IS NULL, 'entrega confirmada depois da falha prevalece e limpa o erro');
  PERFORM ci.exige((SELECT count(*) FROM pet_contatos WHERE pet_id = pet_c AND referencia = DATE '2026-12-12') = 1, 'e grava o contato');

  -- falha tardia nunca derruba entrega ou leitura
  SET ROLE service_role;
  PERFORM public.wa_status('inst-c', 'c-4', 'entregue');
  PERFORM public.wa_status('inst-c', 'c-4', 'erro');
  PERFORM public.wa_status('inst-c', 'c-2', 'erro');
  RESET ROLE;
  PERFORM ci.exige((SELECT situacao FROM wa_mensagens WHERE id = m4) = 'entregue', 'erro depois de entregue é ignorado');
  PERFORM ci.exige((SELECT situacao FROM wa_mensagens WHERE id = m2) = 'lida', 'erro depois de lida é ignorado');

  -- falha de envio (sem id externo) não é ressuscitada por evento
  SET ROLE service_role;
  PERFORM public.wa_status('inst-c', 'qualquer', 'entregue');
  RESET ROLE;
  PERFORM ci.exige((SELECT situacao FROM wa_mensagens WHERE id = m5) = 'falhou', 'falha de envio sem id externo continua falhou');

  -- erro só vale na própria empresa e só para quem está "enviada"
  SET ROLE service_role;
  PERFORM public.wa_status('inst-c', 'c-6', 'erro');
  RESET ROLE;
  PERFORM ci.exige((SELECT situacao FROM wa_mensagens WHERE id = m6) = 'falhou', 'erro informado marca falhou quem estava apenas aceita');
  PERFORM ci.exige((SELECT situacao FROM wa_mensagens WHERE id = md) = 'enviada', 'erro de uma empresa não afeta a outra');

  -- lava rápido: continua gravando contato na aceitação (função compartilhada)
  INSERT INTO lr_veiculos (tenant_id, cliente_id, tipo, identificacao, fabricante, modelo) VALUES (tc, cli_c, 'carro', 'ABC1D23', 'Marca', 'Modelo') RETURNING id INTO veic;
  INSERT INTO wa_mensagens (tenant_id, tipo, referencia, cliente_id, veiculo_id, numero, origem, situacao)
    VALUES (tc, 'pronto', 'os-ci-1', cli_c, veic, '5516999990011', 'automatico', 'enviando') RETURNING id INTO ml;
  SET ROLE service_role;
  PERFORM public.wa_resultado(ml, true, 'lr-1', 'jid', NULL, NULL);
  RESET ROLE;
  PERFORM ci.exige((SELECT count(*) FROM lr_contatos WHERE tenant_id = tc AND tipo = 'pronto' AND referencia = 'os-ci-1') = 1, 'lava rápido continua gravando o contato na aceitação');
END $$;
ROLLBACK;
