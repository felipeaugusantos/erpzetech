ALTER TABLE public.pedido_itens ADD COLUMN IF NOT EXISTS lote_id uuid REFERENCES public.estoque_lotes(id);

-- Escolhe o lote/tonalidade de um item do pedido; confere produto, empresa e saldo do lote.
CREATE OR REPLACE FUNCTION public.pedido_item_definir_lote(p_pedido_item_id uuid, p_lote_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_t uuid := public.current_tenant_id(); v_i pedido_itens; v_l estoque_lotes; v_sit text;
BEGIN
  PERFORM public.exige_nao_salao();
  IF NOT (public.has_role(auth.uid(),'administrador') OR public.has_role(auth.uid(),'gestor')
       OR public.has_role(auth.uid(),'vendedor') OR public.has_role(auth.uid(),'estoquista')) THEN
    RAISE EXCEPTION 'Sem permissão para escolher o lote';
  END IF;
  SELECT * INTO v_i FROM pedido_itens WHERE id = p_pedido_item_id AND tenant_id = v_t FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item não encontrado'; END IF;
  SELECT situacao::text INTO v_sit FROM pedidos WHERE id = v_i.pedido_id;
  IF v_sit IN ('entregue','concluido','cancelado') THEN RAISE EXCEPTION 'Pedido encerrado, lote não pode mudar'; END IF;
  IF p_lote_id IS NOT NULL THEN
    SELECT * INTO v_l FROM estoque_lotes WHERE id = p_lote_id AND tenant_id = v_t;
    IF NOT FOUND OR v_l.produto_id <> v_i.produto_id THEN RAISE EXCEPTION 'Lote não é deste produto'; END IF;
    IF v_l.quantidade < v_i.quantidade - v_i.quantidade_entregue THEN
      RAISE EXCEPTION 'Lote % tem só % disponível', v_l.lote, v_l.quantidade;
    END IF;
  END IF;
  UPDATE pedido_itens SET lote_id = p_lote_id WHERE id = v_i.id;
END $$;
REVOKE ALL ON FUNCTION public.pedido_item_definir_lote(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pedido_item_definir_lote(uuid,uuid) TO authenticated;