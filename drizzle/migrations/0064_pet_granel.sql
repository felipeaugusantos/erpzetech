ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS granel_produto_id uuid REFERENCES public.produtos(id),
  ADD COLUMN IF NOT EXISTS granel_fator numeric(14,3);
ALTER TABLE public.produtos DROP CONSTRAINT IF EXISTS produtos_granel_chk;
ALTER TABLE public.produtos ADD CONSTRAINT produtos_granel_chk CHECK (
  (granel_produto_id IS NULL AND granel_fator IS NULL)
  OR (granel_produto_id IS NOT NULL AND granel_fator IS NOT NULL AND granel_fator > 0 AND granel_produto_id <> id)
);
CREATE INDEX IF NOT EXISTS produtos_granel_idx ON public.produtos (granel_produto_id) WHERE granel_produto_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public._produto_granel_valida()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE g record;
BEGIN
  IF NEW.granel_produto_id IS NULL THEN RETURN NEW; END IF;
  IF NOT NEW.controla_estoque THEN RAISE EXCEPTION 'Serviço não tem saco para abrir'; END IF;
  SELECT id, tenant_id, controla_estoque, granel_produto_id INTO g FROM public.produtos WHERE id = NEW.granel_produto_id;
  IF g.id IS NULL OR g.tenant_id <> NEW.tenant_id THEN RAISE EXCEPTION 'Produto a granel não encontrado nesta empresa'; END IF;
  IF NOT g.controla_estoque THEN RAISE EXCEPTION 'O produto a granel precisa controlar estoque'; END IF;
  IF g.granel_produto_id IS NOT NULL THEN RAISE EXCEPTION 'O produto a granel não pode ser, ele mesmo, um saco'; END IF;
  IF EXISTS (SELECT 1 FROM public.produtos o WHERE o.granel_produto_id = NEW.id) THEN
    RAISE EXCEPTION 'Este produto já é o granel de outro saco e não pode ter saco próprio';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._produto_granel_valida() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_produto_granel_valida ON public.produtos;
CREATE TRIGGER trg_produto_granel_valida BEFORE INSERT OR UPDATE OF granel_produto_id, granel_fator, controla_estoque ON public.produtos
  FOR EACH ROW EXECUTE FUNCTION public._produto_granel_valida();

CREATE TABLE IF NOT EXISTS public.granel_aberturas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  saco_produto_id uuid NOT NULL REFERENCES public.produtos(id),
  granel_produto_id uuid NOT NULL REFERENCES public.produtos(id),
  deposito_id uuid NOT NULL REFERENCES public.depositos(id),
  sacos integer NOT NULL CHECK (sacos > 0),
  kg numeric(14,3) NOT NULL CHECK (kg > 0),
  custo_saco numeric(14,4) NOT NULL DEFAULT 0,
  custo_kg numeric(14,4) NOT NULL DEFAULT 0,
  usuario_id uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS granel_aberturas_idx ON public.granel_aberturas (tenant_id, created_at DESC);

ALTER TABLE public.granel_aberturas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.granel_aberturas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.granel_aberturas TO authenticated;
GRANT ALL ON public.granel_aberturas TO service_role;
CREATE POLICY granel_aberturas_ler ON public.granel_aberturas FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY salao_restrito ON public.granel_aberturas AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()));

CREATE OR REPLACE FUNCTION public.granel_abrir_saco(p_saco_produto_id uuid, p_deposito_id uuid, p_sacos integer DEFAULT 1)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  s record;
  v_custo_saco numeric;
  v_custo_kg numeric;
  v_kg numeric;
  v_id uuid;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'estoquista']);
  IF p_sacos IS NULL OR p_sacos < 1 OR p_sacos > 1000 THEN RAISE EXCEPTION 'Informe quantos sacos serão abertos (de 1 a 1000)'; END IF;

  SELECT id, descricao, custo, granel_produto_id, granel_fator INTO s
    FROM public.produtos WHERE id = p_saco_produto_id AND tenant_id = v_tenant FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Produto não encontrado nesta empresa'; END IF;
  IF s.granel_produto_id IS NULL THEN RAISE EXCEPTION 'Este produto não tem granel cadastrado: informe o produto vendido por kg e os kg do saco no cadastro'; END IF;
  PERFORM 1 FROM public.depositos WHERE id = p_deposito_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Depósito não encontrado nesta empresa'; END IF;

  SELECT coalesce(nullif(e.custo_medio, 0), nullif(s.custo, 0), 0) INTO v_custo_saco
    FROM public.estoques e WHERE e.produto_id = s.id AND e.deposito_id = p_deposito_id FOR UPDATE;
  v_custo_saco := coalesce(v_custo_saco, nullif(s.custo, 0), 0);
  v_kg := p_sacos * s.granel_fator;
  v_custo_kg := round(v_custo_saco / s.granel_fator, 4);

  PERFORM public.registrar_movimentacao_interno(s.id, p_deposito_id, 'saida'::public.mov_tipo, p_sacos,
    'Abertura de saco para venda a granel', 'Abertura de saco');
  PERFORM public.registrar_movimentacao_interno(s.granel_produto_id, p_deposito_id, 'entrada'::public.mov_tipo, v_kg,
    'Abertura de saco para venda a granel', 'Abertura de saco', NULL, nullif(v_custo_kg, 0));

  INSERT INTO public.granel_aberturas (tenant_id, saco_produto_id, granel_produto_id, deposito_id, sacos, kg, custo_saco, custo_kg)
  VALUES (v_tenant, s.id, s.granel_produto_id, p_deposito_id, p_sacos, v_kg, round(v_custo_saco, 4), v_custo_kg)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('abertura_id', v_id, 'kg', v_kg, 'custo_kg', v_custo_kg);
END $$;
REVOKE ALL ON FUNCTION public.granel_abrir_saco(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.granel_abrir_saco(uuid, uuid, integer) TO authenticated;