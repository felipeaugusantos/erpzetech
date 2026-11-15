CREATE OR REPLACE FUNCTION public.frente_venda_offline(p_deposito_id uuid, p_itens jsonb, p_forma public.forma_pagamento, p_chave uuid, p_caixa_id uuid, p_cliente_id uuid DEFAULT NULL, p_desconto numeric DEFAULT 0, p_parcelas integer DEFAULT 1, p_primeiro_vencimento date DEFAULT NULL, p_autorizacao uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant uuid := public.current_tenant_id(); v_pedido uuid;
BEGIN
 PERFORM public.exige_nao_contador(); PERFORM public.exige_nao_salao();
 IF auth.uid() IS NULL OR v_tenant IS NULL OR p_chave IS NULL THEN RAISE EXCEPTION 'Sessão e chave da venda obrigatórias'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(v_tenant::text || ':' || p_chave::text, 0));
 SELECT id INTO v_pedido FROM public.pedidos WHERE tenant_id = v_tenant AND chave_idempotencia = p_chave;
 IF v_pedido IS NOT NULL THEN RETURN v_pedido; END IF;
 PERFORM 1 FROM public.caixas WHERE id = p_caixa_id AND tenant_id = v_tenant AND situacao = 'aberto' FOR UPDATE;
 IF NOT FOUND OR public.frente_caixa_atual() IS DISTINCT FROM p_caixa_id THEN RAISE EXCEPTION 'O caixa original não está aberto para este operador; confira a venda guardada'; END IF;
 RETURN public.frente_venda(p_deposito_id, p_itens, p_forma, p_cliente_id, p_desconto, p_parcelas, p_primeiro_vencimento, p_autorizacao, p_chave);
END $$;
REVOKE ALL ON FUNCTION public.frente_venda_offline(uuid,jsonb,public.forma_pagamento,uuid,uuid,uuid,numeric,integer,date,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.frente_venda_offline(uuid,jsonb,public.forma_pagamento,uuid,uuid,uuid,numeric,integer,date,uuid) TO authenticated;