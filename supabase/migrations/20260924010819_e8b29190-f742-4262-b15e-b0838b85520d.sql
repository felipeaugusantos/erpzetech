CREATE TABLE public.tef_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id(),
  filial_id uuid REFERENCES public.filiais(id) ON DELETE CASCADE,
  credenciadora text NOT NULL DEFAULT 'stone',
  modo text NOT NULL DEFAULT 'manual' CHECK (modo IN ('manual','ponte','nuvem')),
  contrato text, codigo_estabelecimento text, terminal_id text, cnpj_credenciadora text,
  ponte_url text DEFAULT 'http://localhost:60906',
  parcelas_max int NOT NULL DEFAULT 12, parcelas_sem_juros int NOT NULL DEFAULT 3,
  taxa_debito numeric NOT NULL DEFAULT 0, taxa_credito numeric NOT NULL DEFAULT 0, taxa_parcelado numeric NOT NULL DEFAULT 0,
  exigir_nsu boolean NOT NULL DEFAULT true, ativo boolean NOT NULL DEFAULT true,
  observacoes text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, filial_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tef_config TO authenticated;
GRANT ALL ON public.tef_config TO service_role;
ALTER TABLE public.tef_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tef ver" ON public.tef_config FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "tef admin" ON public.tef_config FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND (public.has_role(auth.uid(),'administrador') OR public.has_role(auth.uid(),'gestor')))
  WITH CHECK (tenant_id = public.current_tenant_id() AND (public.has_role(auth.uid(),'administrador') OR public.has_role(auth.uid(),'gestor')));

ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS tef_credenciadora text, ADD COLUMN IF NOT EXISTS tef_nsu text,
  ADD COLUMN IF NOT EXISTS tef_autorizacao text, ADD COLUMN IF NOT EXISTS tef_bandeira text;

CREATE OR REPLACE FUNCTION public.frente_registrar_tef(p_pedido_id uuid, p_credenciadora text, p_nsu text, p_autorizacao text, p_bandeira text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.pedidos SET tef_credenciadora = p_credenciadora, tef_nsu = nullif(p_nsu,''),
    tef_autorizacao = nullif(p_autorizacao,''), tef_bandeira = nullif(p_bandeira,'')
  WHERE id = p_pedido_id AND tenant_id = public.current_tenant_id() AND origem = 'pdv';
  IF NOT FOUND THEN RAISE EXCEPTION 'Venda não encontrada'; END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.frente_registrar_tef(uuid,text,text,text,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.frente_registrar_tef(uuid,text,text,text,text) TO authenticated;