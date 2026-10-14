ALTER TABLE public.produtos ADD COLUMN IF NOT EXISTS controla_lote boolean NOT NULL DEFAULT false;

CREATE TABLE public.estoque_lotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  produto_id uuid NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
  deposito_id uuid NOT NULL REFERENCES public.depositos(id) ON DELETE CASCADE,
  lote text NOT NULL,
  tonalidade text NOT NULL DEFAULT '',
  calibre text NOT NULL DEFAULT '',
  quantidade numeric(14,3) NOT NULL DEFAULT 0,
  validade date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (produto_id, deposito_id, lote, tonalidade, calibre)
);
CREATE TABLE public.estoque_lote_movimentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  lote_id uuid NOT NULL REFERENCES public.estoque_lotes(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('entrada','saida','ajuste')),
  quantidade numeric(14,3) NOT NULL,
  saldo_posterior numeric(14,3) NOT NULL,
  documento text,
  motivo text,
  usuario_id uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.estoque_lotes, public.estoque_lote_movimentos TO authenticated;
GRANT ALL ON public.estoque_lotes, public.estoque_lote_movimentos TO service_role;
ALTER TABLE public.estoque_lotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estoque_lote_movimentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY lotes_read ON public.estoque_lotes FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY lotes_salao ON public.estoque_lotes AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()));
CREATE POLICY lote_mov_read ON public.estoque_lote_movimentos FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY lote_mov_salao ON public.estoque_lote_movimentos AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()));

-- Registra entrada, saída ou ajuste de um lote; nunca deixa o lote negativo; histórico permanente.
CREATE OR REPLACE FUNCTION public.estoque_lote_lancar(
  p_produto_id uuid, p_deposito_id uuid, p_lote text, p_tonalidade text, p_calibre text,
  p_tipo text, p_quantidade numeric, p_documento text DEFAULT NULL, p_motivo text DEFAULT NULL)
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
  UPDATE estoque_lotes SET quantidade=v_novo, updated_at=now() WHERE id=v_l.id;
  INSERT INTO estoque_lote_movimentos(tenant_id, lote_id, tipo, quantidade, saldo_posterior, documento, motivo)
  VALUES (v_t, v_l.id, p_tipo, p_quantidade, v_novo, p_documento, p_motivo);
  RETURN v_l.id;
END $$;
REVOKE ALL ON FUNCTION public.estoque_lote_lancar(uuid,uuid,text,text,text,text,numeric,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.estoque_lote_lancar(uuid,uuid,text,text,text,text,numeric,text,text) TO authenticated;