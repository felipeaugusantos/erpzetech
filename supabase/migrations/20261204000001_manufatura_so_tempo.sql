-- Manufatura (fase 2, correção): apontamento só de tempo. A mesma peça passa por mais de uma etapa (corte, montagem, acabamento); o tempo de
-- cada etapa entra com etapa e minutos, sem peça boa nem refugo, e não consome insumo nem dá entrada no estoque de novo.
-- Sem etapa e minutos, o apontamento continua exigindo peça boa ou refugo. Migration nova (a anterior já foi aplicada). Reexecutável.
ALTER TABLE public.mf_apontamentos DROP CONSTRAINT IF EXISTS mf_apontamentos_algo_ck;
ALTER TABLE public.mf_apontamentos ADD CONSTRAINT mf_apontamentos_algo_ck
  CHECK (quantidade_boa + refugo > 0 OR (ordem_etapa_id IS NOT NULL AND coalesce(minutos, 0) > 0));

CREATE OR REPLACE FUNCTION public.mf_ordem_apontar(p_ordem_id uuid, p_boa numeric, p_refugo numeric, p_minutos integer, p_chave text, p_etapa_id uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_chave text := btrim(coalesce(p_chave, ''));
  v_boa numeric := coalesce(p_boa, 0);
  v_ref numeric := coalesce(p_refugo, 0);
  o public.mf_ordens;
  v_ap uuid; v_ap_ordem uuid;
  r record;
  v_neg boolean; v_qtd numeric; v_res numeric; v_custo_est numeric; v_custo_prod numeric; v_custo numeric;
  v_alvo numeric; v_consumo numeric; v_da_reserva numeric; v_extra numeric; v_unidade text; v_nome text;
  v_custo_total numeric := 0; v_mao_ap numeric := 0; v_oe public.mf_ordem_etapas; v_pool numeric; v_novo_saldo numeric; v_saldo_ant numeric; v_cu numeric; v_qtd_dest numeric;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'producao']);
  PERFORM public._mf_exige_liberado();
  IF v_chave = '' THEN RAISE EXCEPTION 'Informe a chave do apontamento'; END IF;
  IF v_boa < 0 OR v_ref < 0 THEN RAISE EXCEPTION 'As quantidades não podem ser negativas'; END IF;
  -- só tempo: a mesma peça passa por mais de uma etapa; o tempo de cada etapa entra sem repetir a produção
  IF v_boa + v_ref <= 0 AND NOT (p_etapa_id IS NOT NULL AND coalesce(p_minutos, 0) > 0) THEN
    RAISE EXCEPTION 'Informe a quantidade produzida, o refugo ou o tempo de uma etapa';
  END IF;
  IF p_minutos IS NOT NULL AND p_minutos < 0 THEN RAISE EXCEPTION 'Os minutos não podem ser negativos'; END IF;

  -- trava a ordem antes de olhar a chave: duas chamadas iguais ao mesmo tempo ficam em fila
  SELECT * INTO o FROM public.mf_ordens WHERE id = p_ordem_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ordem de produção não encontrada'; END IF;
  SELECT id, ordem_id INTO v_ap, v_ap_ordem FROM public.mf_apontamentos WHERE tenant_id = v_tenant AND chave_idempotente = v_chave;
  IF FOUND THEN
    IF v_ap_ordem <> p_ordem_id THEN RAISE EXCEPTION 'Esta chave já foi usada em outra ordem'; END IF;
    RETURN v_ap;
  END IF;
  IF o.situacao NOT IN ('liberada', 'em_producao') THEN RAISE EXCEPTION 'Só a ordem liberada ou em produção recebe apontamento'; END IF;
  SELECT permite_negativo INTO v_neg FROM public.depositos WHERE id = o.deposito_insumos_id AND tenant_id = v_tenant;

  IF p_etapa_id IS NOT NULL THEN
    SELECT * INTO v_oe FROM public.mf_ordem_etapas WHERE id = p_etapa_id AND ordem_id = p_ordem_id AND tenant_id = v_tenant FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'A etapa não pertence a esta ordem'; END IF;
  END IF;

  INSERT INTO public.mf_apontamentos (tenant_id, ordem_id, ordem_etapa_id, quantidade_boa, refugo, minutos, chave_idempotente, usuario_id)
  VALUES (v_tenant, p_ordem_id, p_etapa_id, v_boa, v_ref, p_minutos, v_chave, auth.uid()) RETURNING id INTO v_ap;

  FOR r IN SELECT oi.* FROM public.mf_ordem_insumos oi WHERE oi.ordem_id = p_ordem_id ORDER BY oi.insumo_id LOOP
    -- consumo acumulado esperado menos o já consumido: o arredondamento não acumula erro entre apontamentos
    v_alvo := round(r.quantidade_base * 100 / (100 - r.perda_percentual) * (o.quantidade_produzida + v_boa + o.quantidade_refugo + v_ref), 3);
    v_consumo := v_alvo - r.quantidade_consumida;
    CONTINUE WHEN v_consumo <= 0;

    SELECT p.unidade, p.descricao, p.custo INTO v_unidade, v_nome, v_custo_prod FROM public.produtos p WHERE p.id = r.insumo_id AND p.tenant_id = v_tenant;
    INSERT INTO public.estoques (tenant_id, produto_id, deposito_id, quantidade, reservado)
    VALUES (v_tenant, r.insumo_id, o.deposito_insumos_id, 0, 0) ON CONFLICT (produto_id, deposito_id) DO NOTHING;
    SELECT quantidade, reservado, custo_medio INTO v_qtd, v_res, v_custo_est FROM public.estoques
     WHERE produto_id = r.insumo_id AND deposito_id = o.deposito_insumos_id AND tenant_id = v_tenant FOR UPDATE;
    v_custo := CASE WHEN coalesce(v_custo_est, 0) > 0 THEN v_custo_est ELSE coalesce(v_custo_prod, 0) END;

    v_da_reserva := least(v_consumo, r.quantidade_reservada);
    v_extra := v_consumo - v_da_reserva;
    -- o que passa da reserva da própria ordem precisa estar livre (sem reserva de outras ordens ou pedidos)
    IF v_extra > v_qtd - v_res AND NOT coalesce(v_neg, false) THEN
      RAISE EXCEPTION 'Estoque insuficiente de % no depósito dos insumos (disponível: %, necessário: %)', v_nome, v_qtd - v_res + v_da_reserva, v_consumo;
    END IF;
    UPDATE public.estoques SET quantidade = quantidade - v_consumo, reservado = greatest(reservado - v_da_reserva, 0), updated_at = now()
     WHERE produto_id = r.insumo_id AND deposito_id = o.deposito_insumos_id AND tenant_id = v_tenant;
    INSERT INTO public.estoque_movimentacoes (tenant_id, produto_id, deposito_id, tipo, quantidade, saldo_anterior, saldo_posterior, unidade,
                                              documento, motivo, usuario_id, custo_unitario, valor_total)
    VALUES (v_tenant, r.insumo_id, o.deposito_insumos_id, 'saida', v_consumo, v_qtd, v_qtd - v_consumo, v_unidade,
            'OP-' || o.numero, 'Consumo de insumo na ordem de produção', auth.uid(), round(v_custo, 4), round(v_consumo * v_custo, 2));
    UPDATE public.mf_ordem_insumos
       SET quantidade_consumida = quantidade_consumida + v_consumo,
           quantidade_reservada = quantidade_reservada - v_da_reserva,
           custo_consumido = custo_consumido + round(v_consumo * v_custo, 2)
     WHERE id = r.id;
    v_custo_total := v_custo_total + round(v_consumo * v_custo, 2);
  END LOOP;

  -- mão de obra da etapa: minutos x custo por hora da etapa na liberação da ordem
  IF p_etapa_id IS NOT NULL AND coalesce(p_minutos, 0) > 0 THEN
    v_mao_ap := round(p_minutos * v_oe.custo_hora / 60, 2);
    UPDATE public.mf_ordem_etapas SET minutos_apontados = minutos_apontados + p_minutos WHERE id = p_etapa_id;
  END IF;

  -- custo a alocar: o que foi consumido e ainda não entrou no valor das peças boas (refugo apontado antes ou sozinho fica na fila);
  -- assim o custo do acabado não depende de como a produção agrupa os apontamentos
  v_pool := o.custo_a_alocar + v_custo_total + v_mao_ap;

  -- linha padrão: o acabado entra no estoque; o custo a alocar (insumos desta rodada e o que sobrou de antes) vai para as peças boas
  IF o.entrada_estoque AND v_boa > 0 THEN
    INSERT INTO public.estoques (tenant_id, produto_id, deposito_id, quantidade, reservado)
    VALUES (v_tenant, o.produto_id, o.deposito_destino_id, 0, 0) ON CONFLICT (produto_id, deposito_id) DO NOTHING;
    SELECT quantidade INTO v_saldo_ant FROM public.estoques
     WHERE produto_id = o.produto_id AND deposito_id = o.deposito_destino_id AND tenant_id = v_tenant FOR UPDATE;
    v_novo_saldo := v_saldo_ant + v_boa;
    UPDATE public.estoques SET quantidade = v_novo_saldo, updated_at = now()
     WHERE produto_id = o.produto_id AND deposito_id = o.deposito_destino_id AND tenant_id = v_tenant;
    v_cu := round(v_pool / v_boa, 4);
    v_pool := greatest(v_pool - round(v_boa * v_cu, 2), 0);
    SELECT unidade INTO v_unidade FROM public.produtos WHERE id = o.produto_id AND tenant_id = v_tenant;
    INSERT INTO public.estoque_movimentacoes (tenant_id, produto_id, deposito_id, tipo, quantidade, saldo_anterior, saldo_posterior, unidade,
                                              documento, motivo, usuario_id, custo_unitario, valor_total)
    VALUES (v_tenant, o.produto_id, o.deposito_destino_id, 'entrada', v_boa, v_saldo_ant, v_novo_saldo, v_unidade,
            'OP-' || o.numero, 'Entrada do produto acabado pela ordem de produção', auth.uid(), v_cu, round(v_boa * v_cu, 2));
    PERFORM public.atualizar_custo_medio(o.produto_id, o.deposito_destino_id, v_boa, v_cu);
  END IF;

  UPDATE public.mf_ordens
     SET quantidade_produzida = quantidade_produzida + v_boa, quantidade_refugo = quantidade_refugo + v_ref,
         custo_real = round(custo_real + v_custo_total + v_mao_ap, 2),
         custo_mao_obra_apontada = round(custo_mao_obra_apontada + v_mao_ap, 2),
         custo_a_alocar = CASE WHEN o.entrada_estoque THEN round(v_pool, 2) ELSE 0 END,
         situacao = 'em_producao'
   WHERE id = p_ordem_id;
  RETURN v_ap;
END $$;

REVOKE ALL ON FUNCTION public.mf_ordem_apontar(uuid, numeric, numeric, integer, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mf_ordem_apontar(uuid, numeric, numeric, integer, text, uuid) TO authenticated;
