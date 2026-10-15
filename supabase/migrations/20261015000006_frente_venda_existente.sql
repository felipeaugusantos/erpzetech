-- Aviso de venda repetida na frente de caixa.
--
-- Quando a resposta de uma venda se perde, a tela guarda a venda na fila e a reenvia com a mesma chave; o banco devolve a
-- venda que já existe (R4) e a tela, até aqui, tratava isso como um envio qualquer. Esta função deixa a tela perguntar,
-- antes de reenviar, se a chave já tem venda: devolve o pedido (id e número) ou nulo. Só leitura.
CREATE OR REPLACE FUNCTION public.frente_venda_existente(p_chave uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_pedido record;
BEGIN
  PERFORM public.exige_nao_salao();
  IF v_tenant IS NULL OR p_chave IS NULL THEN RETURN NULL; END IF;
  SELECT p.id, p.numero, p.filial_id INTO v_pedido FROM public.pedidos p
   WHERE p.tenant_id = v_tenant AND p.chave_idempotencia = p_chave;
  IF NOT FOUND OR NOT public.pode_filial(v_pedido.filial_id) THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('pedido_id', v_pedido.id, 'numero', v_pedido.numero);
END $$;

REVOKE ALL ON FUNCTION public.frente_venda_existente(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.frente_venda_existente(uuid) TO authenticated;
