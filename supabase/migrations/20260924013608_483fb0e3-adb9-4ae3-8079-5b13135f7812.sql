CREATE TABLE public.tef_transacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  filial_id uuid,
  caixa_id uuid,
  pedido_id uuid,
  operador_id uuid DEFAULT auth.uid(),
  credenciadora text,
  forma text,
  valor numeric(14,2) NOT NULL DEFAULT 0,
  parcelas int NOT NULL DEFAULT 1,
  status text NOT NULL CHECK (status IN ('aprovada','negada','cancelada')),
  nsu text, autorizacao text, bandeira text, motivo text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.tef_transacoes TO authenticated;
GRANT ALL ON public.tef_transacoes TO service_role;
ALTER TABLE public.tef_transacoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tef_transacoes do tenant" ON public.tef_transacoes FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE INDEX ON public.tef_transacoes(tenant_id, created_at);

-- histórico das vendas de cartão já feitas
INSERT INTO public.tef_transacoes(tenant_id, filial_id, caixa_id, pedido_id, credenciadora, forma, valor, status, nsu, autorizacao, bandeira, created_at, operador_id)
SELECT tenant_id, filial_id, caixa_id, id, tef_credenciadora, forma_pagamento::text, total,
  CASE WHEN situacao='cancelado' THEN 'cancelada' ELSE 'aprovada' END, tef_nsu, tef_autorizacao, tef_bandeira, created_at, NULL
FROM public.pedidos WHERE tef_nsu IS NOT NULL OR tef_credenciadora IS NOT NULL;

CREATE OR REPLACE FUNCTION public.frente_registrar_tef(p_pedido_id uuid, p_credenciadora text, p_nsu text, p_autorizacao text, p_bandeira text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p record;
BEGIN
  UPDATE public.pedidos SET tef_credenciadora = p_credenciadora, tef_nsu = nullif(p_nsu,''),
    tef_autorizacao = nullif(p_autorizacao,''), tef_bandeira = nullif(p_bandeira,'')
  WHERE id = p_pedido_id AND tenant_id = public.current_tenant_id() AND origem = 'pdv'
  RETURNING * INTO p;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venda não encontrada'; END IF;
  INSERT INTO public.tef_transacoes(tenant_id, filial_id, caixa_id, pedido_id, credenciadora, forma, valor, status, nsu, autorizacao, bandeira)
  VALUES (p.tenant_id, p.filial_id, p.caixa_id, p.id, p_credenciadora, p.forma_pagamento::text, p.total, 'aprovada', nullif(p_nsu,''), nullif(p_autorizacao,''), nullif(p_bandeira,''));
END $$;

CREATE OR REPLACE FUNCTION public.tef_registrar_negada(p_filial_id uuid, p_credenciadora text, p_forma text, p_valor numeric, p_parcelas int, p_bandeira text, p_motivo text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_caixa uuid;
BEGIN
  IF public.current_tenant_id() IS NULL THEN RAISE EXCEPTION 'Sem empresa'; END IF;
  SELECT id INTO v_caixa FROM public.caixas WHERE tenant_id = public.current_tenant_id() AND aberto_por = auth.uid() AND situacao = 'aberto' ORDER BY created_at DESC LIMIT 1;
  INSERT INTO public.tef_transacoes(tenant_id, filial_id, caixa_id, credenciadora, forma, valor, parcelas, status, bandeira, motivo)
  VALUES (public.current_tenant_id(), p_filial_id, v_caixa, p_credenciadora, p_forma, coalesce(p_valor,0), greatest(coalesce(p_parcelas,1),1), 'negada', nullif(p_bandeira,''), nullif(p_motivo,''))
  RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN undefined_column THEN
  INSERT INTO public.tef_transacoes(tenant_id, filial_id, credenciadora, forma, valor, parcelas, status, bandeira, motivo)
  VALUES (public.current_tenant_id(), p_filial_id, p_credenciadora, p_forma, coalesce(p_valor,0), greatest(coalesce(p_parcelas,1),1), 'negada', nullif(p_bandeira,''), nullif(p_motivo,''))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.tef_registrar_negada(uuid,text,text,numeric,int,text,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.tef_registrar_negada(uuid,text,text,numeric,int,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.tef_marcar_cancelada() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.situacao = 'cancelado' AND OLD.situacao <> 'cancelado' THEN
    UPDATE public.tef_transacoes SET status='cancelada', motivo=coalesce(NEW.motivo_cancelamento, motivo) WHERE pedido_id = NEW.id AND status='aprovada';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.tef_marcar_cancelada() FROM public, anon, authenticated;
CREATE TRIGGER trg_tef_cancelada AFTER UPDATE OF situacao ON public.pedidos FOR EACH ROW EXECUTE FUNCTION public.tef_marcar_cancelada();