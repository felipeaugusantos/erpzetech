-- Estorno de baixa feita com crédito de premiação do profissional (premiacao_abater_conta).
-- A baixa e o abatimento em premiacao_abatimentos nascem juntos; reabrir só o título deixava o profissional sem o
-- crédito e o cliente devendo de novo. Agora o estorno devolve o crédito (abatimento negativo) na mesma transação.
-- Só muda baixa_estornar (demais regras iguais à migração 20270107).

CREATE OR REPLACE FUNCTION public.baixa_estornar(p_baixa_id uuid, p_motivo text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_motivo text := btrim(coalesce(p_motivo, ''));
  b public.financeiro_baixas;
  v_id uuid;
  v_numero bigint; v_situacao public.conta_situacao; v_quitado numeric;
  v_cliente uuid; v_forma_orig public.forma_pagamento;
  v_cx uuid; v_cx_filial uuid; v_cx_sit public.caixa_situacao;
  bm public.banco_movimentos;
  ab public.premiacao_abatimentos;
BEGIN
  PERFORM public.exige_nao_salao();
  IF NOT (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')
          OR public.has_role(auth.uid(), 'financeiro')) THEN
    RAISE EXCEPTION 'Estorno de baixa só pelo administrador, gestor ou financeiro';
  END IF;
  IF length(v_motivo) < 3 THEN RAISE EXCEPTION 'Informe o motivo do estorno'; END IF;

  SELECT * INTO b FROM public.financeiro_baixas WHERE id = p_baixa_id AND tenant_id = v_tenant FOR UPDATE;
  IF b.id IS NULL THEN RAISE EXCEPTION 'Baixa não encontrada'; END IF;
  IF b.estorno_de IS NOT NULL THEN RAISE EXCEPTION 'Um estorno não pode ser estornado'; END IF;
  IF EXISTS (SELECT 1 FROM public.financeiro_baixas WHERE estorno_de = b.id) THEN
    RAISE EXCEPTION 'Esta baixa já foi estornada';
  END IF;

  -- trava o título
  IF b.conta_receber_id IS NOT NULL THEN
    SELECT numero, situacao, valor_recebido, cliente_id, forma_pagamento
      INTO v_numero, v_situacao, v_quitado, v_cliente, v_forma_orig
      FROM public.contas_receber WHERE id = b.conta_receber_id AND tenant_id = v_tenant FOR UPDATE;
  ELSE
    SELECT numero, situacao, valor_pago INTO v_numero, v_situacao, v_quitado
      FROM public.contas_pagar WHERE id = b.conta_pagar_id AND tenant_id = v_tenant FOR UPDATE;
  END IF;
  IF v_situacao IS NULL THEN RAISE EXCEPTION 'Título da baixa não encontrado'; END IF;
  IF v_situacao = 'cancelado' THEN RAISE EXCEPTION 'Título cancelado: não há o que estornar'; END IF;
  IF v_quitado + 0.001 < b.valor THEN RAISE EXCEPTION 'O título quitado é menor que a baixa: confira com o suporte'; END IF;

  -- dinheiro que passou pelo caixa volta pelo caixa: o da baixa, se ainda aberto; senão o aberto da mesma filial
  IF b.caixa_id IS NOT NULL THEN
    SELECT situacao, filial_id INTO v_cx_sit, v_cx_filial FROM public.caixas WHERE id = b.caixa_id AND tenant_id = v_tenant;
    IF v_cx_sit = 'aberto' THEN
      v_cx := b.caixa_id;
    ELSE
      SELECT id INTO v_cx FROM public.caixas
       WHERE tenant_id = v_tenant AND situacao = 'aberto' AND filial_id IS NOT DISTINCT FROM v_cx_filial
       ORDER BY (aberto_por = auth.uid()) DESC, aberto_em DESC LIMIT 1;
      IF v_cx IS NULL THEN
        RAISE EXCEPTION 'O caixa desta baixa já foi fechado: abra o caixa da filial para registrar o estorno';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.financeiro_baixas (tenant_id, conta_receber_id, conta_pagar_id, caixa_id, valor,
    forma_pagamento, data_baixa, observacao, usuario_id, estorno_de, motivo_estorno)
  VALUES (v_tenant, b.conta_receber_id, b.conta_pagar_id, v_cx, b.valor, b.forma_pagamento, v_hoje,
    'Estorno: ' || v_motivo, auth.uid(), b.id, v_motivo)
  RETURNING id INTO v_id;

  IF b.conta_receber_id IS NOT NULL THEN
    UPDATE public.contas_receber
       SET valor_recebido = valor_recebido - b.valor,
           situacao = CASE WHEN valor_recebido - b.valor <= 0.001 THEN 'aberto'::public.conta_situacao
                           ELSE 'parcial'::public.conta_situacao END
     WHERE id = b.conta_receber_id;
    IF v_forma_orig = 'crediario' AND v_cliente IS NOT NULL THEN
      UPDATE public.clientes SET saldo_utilizado = saldo_utilizado + b.valor WHERE id = v_cliente;
    END IF;
  ELSE
    UPDATE public.contas_pagar
       SET valor_pago = valor_pago - b.valor,
           situacao = CASE WHEN valor_pago - b.valor <= 0.001 THEN 'aberto'::public.conta_situacao
                           ELSE 'parcial'::public.conta_situacao END
     WHERE id = b.conta_pagar_id;
  END IF;

  -- caixa: movimento inverso do original (recebimento sai; pagamento volta)
  IF v_cx IS NOT NULL THEN
    INSERT INTO public.caixa_movimentos (tenant_id, caixa_id, tipo, valor, forma_pagamento, descricao, usuario_id)
    VALUES (v_tenant, v_cx,
      CASE WHEN b.conta_receber_id IS NOT NULL THEN 'saida'::public.caixa_mov_tipo ELSE 'entrada'::public.caixa_mov_tipo END,
      b.valor, b.forma_pagamento,
      'Estorno de ' || CASE WHEN b.conta_receber_id IS NOT NULL THEN 'recebimento' ELSE 'pagamento' END
        || ' do título nº ' || coalesce(v_numero::text, '—') || ': ' || v_motivo,
      auth.uid());
  END IF;

  -- banco: lançamento inverso na mesma conta bancária (o original fica; quem concilia vê os dois)
  SELECT * INTO bm FROM public.banco_movimentos
   WHERE tenant_id = v_tenant AND origem_id = b.id AND origem IN ('contas_receber', 'contas_pagar') LIMIT 1;
  IF bm.id IS NOT NULL THEN
    INSERT INTO public.banco_movimentos (tenant_id, conta_id, data, tipo, categoria, valor, descricao, forma, origem, origem_id, usuario_id)
    VALUES (v_tenant, bm.conta_id, v_hoje,
      CASE WHEN bm.tipo = 'entrada' THEN 'saida' ELSE 'entrada' END,
      'estorno', bm.valor,
      'Estorno de ' || CASE WHEN b.conta_receber_id IS NOT NULL THEN 'recebimento' ELSE 'pagamento' END
        || ' do título nº ' || coalesce(v_numero::text, '—') || ': ' || v_motivo,
      bm.forma, 'estorno_baixa', v_id, auth.uid());
  END IF;

  -- baixa feita com crédito de premiação do profissional (premiacao_abater_conta grava a baixa e o abatimento
  -- na mesma transação: mesma conta, mesmo valor e mesmo created_at): o crédito volta ao profissional por um
  -- abatimento negativo (a tabela é imutável; o saldo do profissional soma os abatimentos)
  IF b.conta_receber_id IS NOT NULL THEN
    SELECT * INTO ab FROM public.premiacao_abatimentos
     WHERE tenant_id = v_tenant AND conta_receber_id = b.conta_receber_id AND valor = b.valor AND created_at = b.created_at
     ORDER BY id LIMIT 1;
    IF ab.id IS NOT NULL THEN
      INSERT INTO public.premiacao_abatimentos (tenant_id, profissional_id, conta_receber_id, valor, data, observacao, usuario_id)
      VALUES (v_tenant, ab.profissional_id, ab.conta_receber_id, -ab.valor, v_hoje, 'Estorno: ' || v_motivo, auth.uid());
    END IF;
  END IF;

  RETURN v_id;
END $$;
