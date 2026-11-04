-- Lava rápido (agenda): a chegada passa a aplicar plano e fidelidade, com a mesma regra da ordem aberta no pátio.
-- Só troca a função da chegada. lr_ordem_criar e as regras do pátio ficam como estão.
-- Usa a cobertura do pátio: primeiro o plano do veículo e depois um brinde por ordem, sob a mesma trava do cliente.
-- Serviço coberto não precisa de preço cadastrado. Serviço cobrado continua exigindo preço.
CREATE OR REPLACE FUNCTION public.lr_agenda_chegada(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  a public.lr_agendamentos%ROWTYPE;
  v_veic public.lr_veiculos%ROWTYPE;
  v_lav uuid;
  v_ordem uuid;
  v_item uuid;
  v_preco numeric;
  v_ids uuid[];
  r record;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._lr_exige_liberado();
  SELECT * INTO a FROM public.lr_agendamentos WHERE id = p_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento não encontrado'; END IF;
  IF a.ordem_id IS NOT NULL THEN
    RETURN jsonb_build_object('ordem_id', a.ordem_id, 'repetido', true);
  END IF;
  IF a.situacao NOT IN ('agendado', 'confirmado') THEN
    RAISE EXCEPTION 'Não dá para registrar a chegada de um agendamento "%"', a.situacao;
  END IF;

  SELECT * INTO v_veic FROM public.lr_veiculos WHERE id = a.veiculo_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Veículo não encontrado'; END IF;
  IF NOT v_veic.ativo THEN RAISE EXCEPTION 'Este veículo está inativo'; END IF;
  -- a mesma trava de cliente de lr_ordem_criar: duas ordens do cliente não gastam o mesmo brinde ou a mesma lavagem do plano
  PERFORM pg_advisory_xact_lock(hashtextextended('lr_cobertura:' || v_veic.cliente_id::text, 0));
  IF EXISTS (SELECT 1 FROM public.lr_ordens o WHERE o.veiculo_id = v_veic.id AND o.situacao IN ('aguardando', 'lavando', 'secando', 'pronto')) THEN
    RAISE EXCEPTION 'Este veículo já tem uma ordem aberta no pátio';
  END IF;
  -- o lavador do agendamento segue na ordem se ainda estiver ativo (senão a recepção escolhe no pátio)
  SELECT l.id INTO v_lav FROM public.lr_lavadores l WHERE l.id = a.lavador_id AND l.tenant_id = v_tenant AND l.ativo;

  SELECT array_agg(i.servico_id ORDER BY i.created_at, i.id) INTO v_ids
    FROM public.lr_agendamento_itens i WHERE i.agendamento_id = a.id AND i.tenant_id = v_tenant;
  IF v_ids IS NULL THEN RAISE EXCEPTION 'O agendamento não tem serviço'; END IF;

  INSERT INTO public.lr_ordens (tenant_id, veiculo_id, cliente_id, lavador_id, box, observacoes)
  VALUES (v_tenant, v_veic.id, v_veic.cliente_id, v_lav, a.box, a.observacoes)
  RETURNING id INTO v_ordem;
  FOR r IN SELECT c.servico_id, c.cobertura, c.assinatura_id, s.nome, s.ativo
             FROM public._lr_cobertura(v_veic.id, v_ids) c
             JOIN public.lr_servicos s ON s.id = c.servico_id AND s.tenant_id = v_tenant LOOP
    IF NOT r.ativo THEN RAISE EXCEPTION 'O serviço "%" está inativo', r.nome; END IF;
    v_preco := public._lr_agenda_preco(r.servico_id, v_veic.tipo);
    IF v_preco IS NULL AND r.cobertura IS NULL THEN RAISE EXCEPTION 'O serviço "%" não tem preço cadastrado', r.nome; END IF;
    INSERT INTO public.lr_ordem_itens (tenant_id, ordem_id, servico_id, preco_aplicado, cobertura, assinatura_id)
    VALUES (v_tenant, v_ordem, r.servico_id, coalesce(v_preco, 0), r.cobertura, r.assinatura_id)
    RETURNING id INTO v_item;
    IF r.cobertura = 'assinatura' THEN
      INSERT INTO public.lr_assinatura_usos (tenant_id, assinatura_id, item_id) VALUES (v_tenant, r.assinatura_id, v_item);
    END IF;
  END LOOP;
  UPDATE public.lr_agendamentos SET ordem_id = v_ordem, situacao = 'concluido', chegada_em = now() WHERE id = a.id;
  RETURN jsonb_build_object('ordem_id', v_ordem, 'repetido', false);
END $fn$;
REVOKE ALL ON FUNCTION public.lr_agenda_chegada(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_agenda_chegada(uuid) TO authenticated;
