ALTER TABLE public.filiais
  ADD COLUMN IF NOT EXISTS cnpj text,
  ADD COLUMN IF NOT EXISTS inscricao_estadual text,
  ADD COLUMN IF NOT EXISTS situacao text NOT NULL DEFAULT 'ativa';

ALTER TABLE public.fiscal_config
  ADD COLUMN IF NOT EXISTS filial_id uuid REFERENCES public.filiais(id) ON DELETE CASCADE;

ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS profissional_id uuid;

CREATE TABLE public.profissionais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  empresa_id uuid REFERENCES public.empresas(id),
  nome text NOT NULL,
  tipo text NOT NULL DEFAULT 'pedreiro',
  cpf text,
  cnpj text,
  telefone text,
  whatsapp text,
  email text,
  chave_pix text,
  percentual_premio numeric NOT NULL DEFAULT 2,
  observacoes text,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.profissionais TO authenticated;
GRANT ALL ON public.profissionais TO service_role;
ALTER TABLE public.profissionais ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profissionais_select" ON public.profissionais FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY "profissionais_insert" ON public.profissionais FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY "profissionais_update" ON public.profissionais FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id());

ALTER TABLE public.clientes
  ADD CONSTRAINT clientes_profissional_id_fkey FOREIGN KEY (profissional_id)
  REFERENCES public.profissionais(id) ON DELETE SET NULL;

CREATE TABLE public.premiacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  profissional_id uuid NOT NULL REFERENCES public.profissionais(id) ON DELETE CASCADE,
  cliente_id uuid REFERENCES public.clientes(id),
  pedido_id uuid REFERENCES public.pedidos(id),
  valor_base numeric NOT NULL DEFAULT 0,
  percentual numeric NOT NULL DEFAULT 0,
  valor numeric NOT NULL DEFAULT 0,
  situacao text NOT NULL DEFAULT 'a_aprovar',
  pago_em date,
  forma_pagamento text,
  observacao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pedido_id, profissional_id)
);

GRANT SELECT, INSERT, UPDATE ON public.premiacoes TO authenticated;
GRANT ALL ON public.premiacoes TO service_role;
ALTER TABLE public.premiacoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "premiacoes_select" ON public.premiacoes FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY "premiacoes_insert" ON public.premiacoes FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY "premiacoes_update" ON public.premiacoes FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')));

CREATE TRIGGER trg_profissionais_touch BEFORE UPDATE ON public.profissionais
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_premiacoes_touch BEFORE UPDATE ON public.premiacoes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.gerar_faturas_assinatura()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  a public.assinaturas;
  v_comp date := date_trunc('month', now())::date;
  v_venc date;
  v_criadas integer := 0;
BEGIN
  SELECT * INTO a FROM public.assinaturas WHERE tenant_id = v_tenant;
  IF a.id IS NULL THEN RETURN 0; END IF;
  IF a.situacao = 'cancelada' THEN RETURN 0; END IF;

  v_venc := v_comp + (GREATEST(a.dia_vencimento, 1) - 1);

  IF NOT EXISTS (
    SELECT 1 FROM public.assinatura_faturas
    WHERE assinatura_id = a.id AND tipo = 'mensalidade' AND competencia = v_comp
  ) THEN
    INSERT INTO public.assinatura_faturas (tenant_id, assinatura_id, tipo, descricao, competencia, valor, vencimento)
    VALUES (v_tenant, a.id, 'mensalidade',
      'Plano ' || initcap(a.plano), v_comp, a.valor_mensal, v_venc);
    v_criadas := v_criadas + 1;
  END IF;

  IF a.filiais_extras > 0 AND NOT EXISTS (
    SELECT 1 FROM public.assinatura_faturas
    WHERE assinatura_id = a.id AND tipo = 'filial_extra' AND competencia = v_comp
  ) THEN
    INSERT INTO public.assinatura_faturas (tenant_id, assinatura_id, tipo, descricao, competencia, valor, vencimento)
    VALUES (v_tenant, a.id, 'filial_extra',
      'Filial extra (' || a.filiais_extras || ')', v_comp,
      a.filiais_extras * a.valor_filial_extra, v_venc);
    v_criadas := v_criadas + 1;
  END IF;

  RETURN v_criadas;
END;
$$;

CREATE OR REPLACE FUNCTION public.gerar_premiacoes()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_criadas integer := 0;
BEGIN
  INSERT INTO public.premiacoes (tenant_id, profissional_id, cliente_id, pedido_id, valor_base, percentual, valor)
  SELECT p.tenant_id, c.profissional_id, c.id, p.id, p.total, pr.percentual_premio,
         round(p.total * pr.percentual_premio / 100, 2)
  FROM public.pedidos p
  JOIN public.clientes c ON c.id = p.cliente_id AND c.profissional_id IS NOT NULL
  JOIN public.profissionais pr ON pr.id = c.profissional_id AND pr.ativo
  WHERE p.tenant_id = v_tenant
    AND p.situacao IN ('entregue', 'concluido')
    AND NOT EXISTS (
      SELECT 1 FROM public.premiacoes x
      WHERE x.pedido_id = p.id AND x.profissional_id = c.profissional_id
    );
  GET DIAGNOSTICS v_criadas = ROW_COUNT;
  RETURN v_criadas;
END;
$$;