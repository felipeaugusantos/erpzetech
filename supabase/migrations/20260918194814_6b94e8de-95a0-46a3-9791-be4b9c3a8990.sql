ALTER TABLE public.empresas ADD COLUMN IF NOT EXISTS ramo_atividade text NOT NULL DEFAULT 'construcao';

CREATE TABLE IF NOT EXISTS public.produto_variacoes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  produto_id uuid NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
  tamanho text NOT NULL,
  cor text,
  codigo_barras text,
  preco_venda numeric(14,4),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (produto_id, tamanho, cor)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.produto_variacoes TO authenticated;
GRANT ALL ON public.produto_variacoes TO service_role;

ALTER TABLE public.produto_variacoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_read_produto_variacoes" ON public.produto_variacoes FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "tenant_insert_produto_variacoes" ON public.produto_variacoes FOR INSERT TO authenticated WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY "tenant_update_produto_variacoes" ON public.produto_variacoes FOR UPDATE TO authenticated USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY "tenant_delete_produto_variacoes" ON public.produto_variacoes FOR DELETE TO authenticated USING (tenant_id = public.current_tenant_id() AND (public.has_role(auth.uid(), 'administrador'::app_role) OR public.has_role(auth.uid(), 'gestor'::app_role)));

CREATE TRIGGER trg_produto_variacoes_touch BEFORE UPDATE ON public.produto_variacoes FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX IF NOT EXISTS produto_variacoes_produto_idx ON public.produto_variacoes (tenant_id, produto_id);