CREATE TABLE public.estoque_grade (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  produto_id uuid NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
  deposito_id uuid NOT NULL REFERENCES public.depositos(id) ON DELETE CASCADE,
  tamanho text NOT NULL,
  quantidade numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (produto_id, deposito_id, tamanho)
);
GRANT SELECT ON public.estoque_grade TO authenticated;
GRANT ALL ON public.estoque_grade TO service_role;
ALTER TABLE public.estoque_grade ENABLE ROW LEVEL SECURITY;
CREATE POLICY estoque_grade_read ON public.estoque_grade FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());

-- Entrada da nota com grade soma o saldo de cada tamanho
CREATE OR REPLACE FUNCTION public.estoque_grade_da_compra() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE dep uuid; g jsonb;
BEGIN
  IF jsonb_typeof(NEW.impostos->'grade') <> 'array' THEN RETURN NEW; END IF;
  SELECT deposito_id INTO dep FROM public.compras WHERE id = NEW.compra_id;
  IF dep IS NULL THEN RETURN NEW; END IF;
  FOR g IN SELECT * FROM jsonb_array_elements(NEW.impostos->'grade') LOOP
    INSERT INTO public.estoque_grade (tenant_id, produto_id, deposito_id, tamanho, quantidade)
    VALUES (NEW.tenant_id, NEW.produto_id, dep, g->>'tamanho', (g->>'quantidade')::numeric)
    ON CONFLICT (produto_id, deposito_id, tamanho)
    DO UPDATE SET quantidade = estoque_grade.quantidade + EXCLUDED.quantidade, updated_at = now();
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER compra_itens_grade AFTER INSERT ON public.compra_itens
FOR EACH ROW EXECUTE FUNCTION public.estoque_grade_da_compra();

-- Conferência manual: grava a contagem de cada tamanho
CREATE OR REPLACE FUNCTION public.estoque_grade_ajustar(p_produto_id uuid, p_deposito_id uuid, p_grade jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid := public.current_tenant_id(); g jsonb;
BEGIN
  IF t IS NULL OR NOT (public.has_role(auth.uid(),'administrador') OR public.has_role(auth.uid(),'gestor') OR public.has_role(auth.uid(),'estoquista')) THEN
    RAISE EXCEPTION 'Sem permissão para ajustar o estoque por tamanho';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.produtos WHERE id = p_produto_id AND tenant_id = t)
     OR NOT EXISTS (SELECT 1 FROM public.depositos WHERE id = p_deposito_id AND tenant_id = t) THEN
    RAISE EXCEPTION 'Produto ou depósito inválido';
  END IF;
  DELETE FROM public.estoque_grade WHERE produto_id = p_produto_id AND deposito_id = p_deposito_id;
  FOR g IN SELECT * FROM jsonb_array_elements(p_grade) LOOP
    IF (g->>'quantidade')::numeric > 0 THEN
      INSERT INTO public.estoque_grade (tenant_id, produto_id, deposito_id, tamanho, quantidade)
      VALUES (t, p_produto_id, p_deposito_id, g->>'tamanho', (g->>'quantidade')::numeric);
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.estoque_grade_ajustar(uuid, uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.estoque_grade_ajustar(uuid, uuid, jsonb) TO authenticated;

-- Notas já importadas com grade
INSERT INTO public.estoque_grade (tenant_id, produto_id, deposito_id, tamanho, quantidade)
SELECT ci.tenant_id, ci.produto_id, c.deposito_id, g->>'tamanho', sum((g->>'quantidade')::numeric)
FROM public.compra_itens ci JOIN public.compras c ON c.id = ci.compra_id,
LATERAL jsonb_array_elements(ci.impostos->'grade') g
WHERE jsonb_typeof(ci.impostos->'grade') = 'array' AND c.deposito_id IS NOT NULL
GROUP BY 1,2,3,4
ON CONFLICT DO NOTHING;