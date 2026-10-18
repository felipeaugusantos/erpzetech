CREATE TABLE public.pedido_personalizacao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id(),
  pedido_id uuid NOT NULL UNIQUE REFERENCES public.pedidos(id) ON DELETE CASCADE,
  grade jsonb NOT NULL DEFAULT '[]'::jsonb,
  arte_descricao text,
  arte_link text,
  arte_situacao text NOT NULL DEFAULT 'aguardando' CHECK (arte_situacao IN ('aguardando','aprovada','reprovada')),
  arte_aprovada_em timestamptz,
  arte_aprovada_por uuid,
  etapa text NOT NULL DEFAULT 'aguardando_arte' CHECK (etapa IN ('aguardando_arte','impressao','prensa','pronto','entregue')),
  observacoes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT personalizacao_arte_antes_producao CHECK (etapa = 'aguardando_arte' OR arte_situacao = 'aprovada')
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pedido_personalizacao TO authenticated;
GRANT ALL ON public.pedido_personalizacao TO service_role;
ALTER TABLE public.pedido_personalizacao ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_read_personalizacao" ON public.pedido_personalizacao FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "tenant_insert_personalizacao" ON public.pedido_personalizacao FOR INSERT TO authenticated WITH CHECK (tenant_id = public.current_tenant_id() AND EXISTS (SELECT 1 FROM public.pedidos p WHERE p.id = pedido_id AND p.tenant_id = public.current_tenant_id()));
CREATE POLICY "tenant_update_personalizacao" ON public.pedido_personalizacao FOR UPDATE TO authenticated USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY "tenant_delete_personalizacao" ON public.pedido_personalizacao FOR DELETE TO authenticated USING (tenant_id = public.current_tenant_id() AND (public.has_role(auth.uid(), 'administrador'::app_role) OR public.has_role(auth.uid(), 'gestor'::app_role)));
CREATE TRIGGER trg_pedido_personalizacao_touch BEFORE UPDATE ON public.pedido_personalizacao FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE INDEX pedido_personalizacao_tenant_idx ON public.pedido_personalizacao (tenant_id, etapa);