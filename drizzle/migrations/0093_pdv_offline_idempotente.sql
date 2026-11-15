CREATE OR REPLACE FUNCTION public.pdv_venda_offline(p_deposito_id uuid, p_itens jsonb, p_forma public.forma_pagamento, p_chave uuid, p_caixa_id uuid DEFAULT NULL, p_cliente_id uuid DEFAULT NULL, p_desconto numeric DEFAULT 0, p_parcelas integer DEFAULT 1, p_primeiro_vencimento date DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant uuid := public.current_tenant_id(); v_pedido uuid; v_selecionado uuid;
BEGIN
 PERFORM public.exige_nao_contador(); PERFORM public.exige_nao_salao();
 IF auth.uid() IS NULL OR v_tenant IS NULL OR p_chave IS NULL THEN RAISE EXCEPTION 'Sessão e chave da venda obrigatórias'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(v_tenant::text || ':' || p_chave::text, 0));
 SELECT id INTO v_pedido FROM public.pedidos WHERE tenant_id = v_tenant AND chave_idempotencia = p_chave;
 IF v_pedido IS NOT NULL THEN RETURN v_pedido; END IF;
 IF p_forma NOT IN ('crediario', 'boleto') THEN
   PERFORM 1 FROM public.caixas WHERE id = p_caixa_id AND tenant_id = v_tenant AND situacao = 'aberto' FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'O caixa original não está aberto; venda permanece guardada para conferência'; END IF;
   v_selecionado := public.frente_caixa_atual();
   IF v_selecionado IS NULL THEN
     SELECT id INTO v_selecionado FROM public.caixas WHERE tenant_id = v_tenant AND situacao = 'aberto' ORDER BY aberto_em DESC LIMIT 1;
   END IF;
   IF v_selecionado IS DISTINCT FROM p_caixa_id THEN RAISE EXCEPTION 'O caixa atual difere do caixa original; confira a venda guardada'; END IF;
 END IF;
 v_pedido := public.pdv_venda(p_deposito_id, p_itens, p_forma, p_cliente_id, p_desconto, p_parcelas, p_primeiro_vencimento, 'Venda PDV com sincronização idempotente');
 UPDATE public.pedidos SET chave_idempotencia = p_chave, caixa_id = CASE WHEN p_forma IN ('crediario', 'boleto') THEN NULL ELSE p_caixa_id END WHERE id = v_pedido AND tenant_id = v_tenant;
 RETURN v_pedido;
END $$;
REVOKE ALL ON FUNCTION public.pdv_venda_offline(uuid,jsonb,public.forma_pagamento,uuid,uuid,uuid,numeric,integer,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pdv_venda_offline(uuid,jsonb,public.forma_pagamento,uuid,uuid,uuid,numeric,integer,date) TO authenticated;