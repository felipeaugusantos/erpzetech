-- Quando o item do pedido sai (retirada ou entrega), baixa o mesmo tanto do lote escolhido.
CREATE OR REPLACE FUNCTION public.pedido_item_baixar_lote()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_delta numeric := NEW.quantidade_entregue - OLD.quantidade_entregue; v_l estoque_lotes; v_num text;
BEGIN
  IF NEW.lote_id IS NULL OR v_delta = 0 THEN RETURN NEW; END IF;
  SELECT * INTO v_l FROM estoque_lotes WHERE id = NEW.lote_id FOR UPDATE;
  IF v_l.quantidade - v_delta < 0 THEN
    RAISE EXCEPTION 'Lote % tem só % disponível para esta saída', v_l.lote, v_l.quantidade;
  END IF;
  SELECT 'Pedido nº ' || numero INTO v_num FROM pedidos WHERE id = NEW.pedido_id;
  UPDATE estoque_lotes SET quantidade = quantidade - v_delta, updated_at = now() WHERE id = v_l.id;
  INSERT INTO estoque_lote_movimentos(tenant_id, lote_id, tipo, quantidade, saldo_posterior, documento, motivo)
  VALUES (v_l.tenant_id, v_l.id, CASE WHEN v_delta > 0 THEN 'saida' ELSE 'entrada' END,
          abs(v_delta), v_l.quantidade - v_delta, v_num,
          CASE WHEN v_delta > 0 THEN 'Saída do pedido' ELSE 'Estorno de saída do pedido' END);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.pedido_item_baixar_lote() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS pedido_item_baixar_lote_trg ON public.pedido_itens;
CREATE TRIGGER pedido_item_baixar_lote_trg AFTER UPDATE OF quantidade_entregue ON public.pedido_itens
FOR EACH ROW EXECUTE FUNCTION public.pedido_item_baixar_lote();