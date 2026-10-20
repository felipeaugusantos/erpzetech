-- Validade do lote no lançamento: vacina e medicamento só são aplicados de lote com validade registrada (clinica_lotes_vacina e
-- clinica_vacina_aplicar recusam lote sem validade), e nenhuma tela gravava essa data. O lançamento passa a aceitar a validade; informada,
-- ela vale para o lote (também ao corrigir um lote que já existe); não informada, a validade do lote não muda.
DROP FUNCTION IF EXISTS public.estoque_lote_lancar(uuid, uuid, text, text, text, text, numeric, text, text);
CREATE OR REPLACE FUNCTION public.estoque_lote_lancar(
  p_produto_id uuid, p_deposito_id uuid, p_lote text, p_tonalidade text, p_calibre text,
  p_tipo text, p_quantidade numeric, p_documento text DEFAULT NULL, p_motivo text DEFAULT NULL,
  p_validade date DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_t uuid := public.current_tenant_id(); v_l public.estoque_lotes; v_novo numeric;
BEGIN
  PERFORM public.exige_nao_salao();
  IF NOT (public.has_role(auth.uid(),'administrador') OR public.has_role(auth.uid(),'gestor')
       OR public.has_role(auth.uid(),'estoquista') OR public.has_role(auth.uid(),'comprador')) THEN
    RAISE EXCEPTION 'Sem permissão para lançar lotes';
  END IF;
  IF coalesce(trim(p_lote),'') = '' THEN RAISE EXCEPTION 'Informe o lote'; END IF;
  IF p_tipo NOT IN ('entrada','saida','ajuste') THEN RAISE EXCEPTION 'Tipo inválido'; END IF;
  IF p_tipo <> 'ajuste' AND p_quantidade <= 0 THEN RAISE EXCEPTION 'Quantidade deve ser maior que zero'; END IF;
  IF p_tipo = 'ajuste' AND coalesce(trim(p_motivo),'') = '' THEN RAISE EXCEPTION 'Informe o motivo do ajuste'; END IF;
  IF p_validade IS NOT NULL AND (p_validade < DATE '2000-01-01' OR p_validade > DATE '2100-12-31') THEN
    RAISE EXCEPTION 'Validade do lote fora do esperado';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM produtos WHERE id=p_produto_id AND tenant_id=v_t)
     OR NOT EXISTS (SELECT 1 FROM depositos WHERE id=p_deposito_id AND tenant_id=v_t) THEN
    RAISE EXCEPTION 'Produto ou depósito não encontrado';
  END IF;
  INSERT INTO estoque_lotes(tenant_id, produto_id, deposito_id, lote, tonalidade, calibre)
  VALUES (v_t, p_produto_id, p_deposito_id, trim(p_lote), coalesce(trim(p_tonalidade),''), coalesce(trim(p_calibre),''))
  ON CONFLICT (produto_id, deposito_id, lote, tonalidade, calibre) DO NOTHING;
  SELECT * INTO v_l FROM estoque_lotes WHERE produto_id=p_produto_id AND deposito_id=p_deposito_id
    AND lote=trim(p_lote) AND tonalidade=coalesce(trim(p_tonalidade),'') AND calibre=coalesce(trim(p_calibre),'') FOR UPDATE;
  v_novo := CASE p_tipo WHEN 'entrada' THEN v_l.quantidade + p_quantidade
                        WHEN 'saida' THEN v_l.quantidade - p_quantidade ELSE p_quantidade END;
  IF v_novo < 0 THEN RAISE EXCEPTION 'Saldo do lote insuficiente (disponível %)', v_l.quantidade; END IF;
  UPDATE estoque_lotes SET quantidade=v_novo, validade=coalesce(p_validade, validade), updated_at=now() WHERE id=v_l.id;
  INSERT INTO estoque_lote_movimentos(tenant_id, lote_id, tipo, quantidade, saldo_posterior, documento, motivo)
  VALUES (v_t, v_l.id, p_tipo, p_quantidade, v_novo, p_documento, p_motivo);
  RETURN v_l.id;
END $$;
REVOKE ALL ON FUNCTION public.estoque_lote_lancar(uuid,uuid,text,text,text,text,numeric,text,text,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.estoque_lote_lancar(uuid,uuid,text,text,text,text,numeric,text,text,date) TO authenticated;
