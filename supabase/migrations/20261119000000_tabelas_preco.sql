-- Tabelas de preço por cliente.
-- Uma tabela ajusta o preço de venda de todos os produtos por um percentual (negativo = desconto, positivo = acréscimo)
-- e pode fixar o preço de produtos específicos. O cliente aponta para uma tabela; sem tabela vale o preço de venda do produto.
-- A regra é aplicada pelas telas ao montar orçamento e pedido (src/lib/tabela-preco.ts).

CREATE TABLE IF NOT EXISTS public.tabelas_preco (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants (id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (btrim(nome) <> ''),
  descricao text,
  ajuste_percentual numeric(7,2) NOT NULL DEFAULT 0 CHECK (ajuste_percentual BETWEEN -100 AND 1000),
  ativa boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS tabelas_preco_nome_uk ON public.tabelas_preco (tenant_id, lower(btrim(nome)));

CREATE TABLE IF NOT EXISTS public.tabela_preco_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants (id) ON DELETE CASCADE,
  tabela_id uuid NOT NULL REFERENCES public.tabelas_preco (id) ON DELETE CASCADE,
  produto_id uuid NOT NULL REFERENCES public.produtos (id) ON DELETE CASCADE,
  preco numeric(14,2) NOT NULL CHECK (preco >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tabela_id, produto_id)
);
CREATE INDEX IF NOT EXISTS tabela_preco_itens_tabela_idx ON public.tabela_preco_itens (tenant_id, tabela_id);

ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS tabela_preco_id uuid REFERENCES public.tabelas_preco (id) ON DELETE SET NULL;

-- tabela e produto do mesmo tenant do registro (o tenant vem do banco, mas a referência é conferida)
CREATE OR REPLACE FUNCTION public.tabela_preco_confere_tenant() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'tabela_preco_itens' THEN
    IF NOT EXISTS (SELECT 1 FROM public.tabelas_preco WHERE id = NEW.tabela_id AND tenant_id = NEW.tenant_id)
       OR NOT EXISTS (SELECT 1 FROM public.produtos WHERE id = NEW.produto_id AND tenant_id = NEW.tenant_id) THEN
      RAISE EXCEPTION 'Tabela ou produto de outra empresa';
    END IF;
  ELSIF NEW.tabela_preco_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.tabelas_preco WHERE id = NEW.tabela_preco_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Tabela de preço de outra empresa';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tabela_preco_itens_tenant ON public.tabela_preco_itens;
CREATE TRIGGER tabela_preco_itens_tenant BEFORE INSERT OR UPDATE ON public.tabela_preco_itens
  FOR EACH ROW EXECUTE FUNCTION public.tabela_preco_confere_tenant();
DROP TRIGGER IF EXISTS clientes_tabela_preco_tenant ON public.clientes;
CREATE TRIGGER clientes_tabela_preco_tenant BEFORE INSERT OR UPDATE OF tabela_preco_id ON public.clientes
  FOR EACH ROW EXECUTE FUNCTION public.tabela_preco_confere_tenant();

CREATE OR REPLACE FUNCTION public.tabelas_preco_atualizado_em() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tabelas_preco_atualizado_em ON public.tabelas_preco;
CREATE TRIGGER tabelas_preco_atualizado_em BEFORE UPDATE ON public.tabelas_preco
  FOR EACH ROW EXECUTE FUNCTION public.tabelas_preco_atualizado_em();

-- Acesso: quem vende lê (para montar orçamento e pedido); só administrador e gestor mudam preço.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tabelas_preco', 'tabela_preco_itens'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format($f$CREATE POLICY %1$I ON public.%2$I FOR SELECT TO authenticated
      USING (tenant_id = public.current_tenant_id())$f$, t || '_leitura', t);
    EXECUTE format($f$CREATE POLICY %1$I ON public.%2$I FOR INSERT TO authenticated
      WITH CHECK (tenant_id = public.current_tenant_id()
                  AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')))$f$, t || '_inclusao', t);
    EXECUTE format($f$CREATE POLICY %1$I ON public.%2$I FOR UPDATE TO authenticated
      USING (tenant_id = public.current_tenant_id()
             AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')))
      WITH CHECK (tenant_id = public.current_tenant_id())$f$, t || '_alteracao', t);
    EXECUTE format($f$CREATE POLICY %1$I ON public.%2$I FOR DELETE TO authenticated
      USING (tenant_id = public.current_tenant_id()
             AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')))$f$, t || '_exclusao', t);
    EXECUTE format($f$CREATE POLICY salao_restrito ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
      USING ((SELECT NOT public.eh_salao_restrito()))$f$, t);
  END LOOP;
END $$;
