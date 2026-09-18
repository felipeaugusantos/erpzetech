CREATE TABLE public.vendedor_comissao_regras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id(),
  empresa_id uuid REFERENCES public.empresas(id) ON DELETE SET NULL,
  vendedor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  percentual numeric(6,3) NOT NULL DEFAULT 1 CHECK (percentual >= 0 AND percentual <= 100),
  base text NOT NULL DEFAULT 'venda' CHECK (base IN ('venda','lucro')),
  venda_minima numeric(14,2) NOT NULL DEFAULT 0 CHECK (venda_minima >= 0),
  observacoes text,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendedor_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendedor_comissao_regras TO authenticated;
GRANT ALL ON public.vendedor_comissao_regras TO service_role;
ALTER TABLE public.vendedor_comissao_regras ENABLE ROW LEVEL SECURITY;

CREATE POLICY "regras_comissao_select" ON public.vendedor_comissao_regras
  FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "regras_comissao_insert" ON public.vendedor_comissao_regras
  FOR INSERT TO authenticated WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor'))
  );
CREATE POLICY "regras_comissao_update" ON public.vendedor_comissao_regras
  FOR UPDATE TO authenticated USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor'))
  );
CREATE POLICY "regras_comissao_delete" ON public.vendedor_comissao_regras
  FOR DELETE TO authenticated USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor'))
  );

CREATE TRIGGER trg_regras_comissao_updated BEFORE UPDATE ON public.vendedor_comissao_regras
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.comissoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id(),
  vendedor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  pedido_id uuid REFERENCES public.pedidos(id) ON DELETE SET NULL,
  base text NOT NULL DEFAULT 'venda',
  valor_venda numeric(14,2) NOT NULL DEFAULT 0,
  valor_custo numeric(14,2) NOT NULL DEFAULT 0,
  valor_base numeric(14,2) NOT NULL DEFAULT 0,
  percentual numeric(6,3) NOT NULL DEFAULT 0,
  valor numeric(14,2) NOT NULL DEFAULT 0,
  situacao text NOT NULL DEFAULT 'a_aprovar' CHECK (situacao IN ('a_aprovar','aprovada','paga','cancelada')),
  pago_em date,
  forma_pagamento text,
  observacao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pedido_id, vendedor_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.comissoes TO authenticated;
GRANT ALL ON public.comissoes TO service_role;
ALTER TABLE public.comissoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "comissoes_select" ON public.comissoes
  FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "comissoes_insert" ON public.comissoes
  FOR INSERT TO authenticated WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY "comissoes_update" ON public.comissoes
  FOR UPDATE TO authenticated USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor'))
  );
CREATE POLICY "comissoes_delete" ON public.comissoes
  FOR DELETE TO authenticated USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor'))
  );

CREATE INDEX idx_comissoes_vendedor ON public.comissoes (vendedor_id);
CREATE INDEX idx_comissoes_created ON public.comissoes (created_at);

CREATE TRIGGER trg_comissoes_updated BEFORE UPDATE ON public.comissoes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Lança a comissão de um pedido conforme a regra do vendedor (idempotente)
CREATE OR REPLACE FUNCTION public.comissionar_pedido_id(p_pedido_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ped RECORD;
  v_regra RECORD;
  v_custo numeric := 0;
  v_base numeric := 0;
BEGIN
  SELECT * INTO v_ped FROM public.pedidos WHERE id = p_pedido_id;
  IF v_ped.id IS NULL OR v_ped.vendedor_id IS NULL THEN RETURN false; END IF;
  IF v_ped.situacao NOT IN ('entregue','concluido') THEN RETURN false; END IF;

  SELECT * INTO v_regra FROM public.vendedor_comissao_regras
   WHERE vendedor_id = v_ped.vendedor_id AND ativo;
  IF v_regra.id IS NULL OR COALESCE(v_regra.percentual,0) <= 0 THEN RETURN false; END IF;
  IF COALESCE(v_ped.total,0) < COALESCE(v_regra.venda_minima,0) THEN RETURN false; END IF;

  IF EXISTS (SELECT 1 FROM public.comissoes c
              WHERE c.pedido_id = v_ped.id AND c.vendedor_id = v_ped.vendedor_id) THEN
    RETURN false;
  END IF;

  SELECT COALESCE(SUM(i.quantidade * COALESCE(i.custo_unitario,0)), 0) INTO v_custo
    FROM public.pedido_itens i WHERE i.pedido_id = v_ped.id;

  IF v_regra.base = 'lucro' THEN
    v_base := GREATEST(COALESCE(v_ped.total,0) - v_custo, 0);
  ELSE
    v_base := COALESCE(v_ped.total,0);
  END IF;

  IF v_base <= 0 THEN RETURN false; END IF;

  INSERT INTO public.comissoes (
    tenant_id, vendedor_id, pedido_id, base, valor_venda, valor_custo,
    valor_base, percentual, valor, observacao
  ) VALUES (
    v_ped.tenant_id, v_ped.vendedor_id, v_ped.id, v_regra.base,
    COALESCE(v_ped.total,0), v_custo, v_base, v_regra.percentual,
    round(v_base * v_regra.percentual / 100, 2),
    'Lançamento automático pelo pedido'
  );
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.comissionar_pedido()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.situacao IN ('entregue','concluido') THEN
    PERFORM public.comissionar_pedido_id(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_comissionar_pedido AFTER UPDATE OF situacao ON public.pedidos
  FOR EACH ROW EXECUTE FUNCTION public.comissionar_pedido();

-- Gera comissões de pedidos antigos já entregues
CREATE OR REPLACE FUNCTION public.gerar_comissoes()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_qtd integer := 0;
BEGIN
  FOR v_id IN
    SELECT p.id FROM public.pedidos p
     WHERE p.tenant_id = public.current_tenant_id()
       AND p.situacao IN ('entregue','concluido')
       AND p.vendedor_id IS NOT NULL
     ORDER BY p.created_at
  LOOP
    IF public.comissionar_pedido_id(v_id) THEN v_qtd := v_qtd + 1; END IF;
  END LOOP;
  RETURN v_qtd;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.comissionar_pedido_id(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.gerar_comissoes() FROM anon;