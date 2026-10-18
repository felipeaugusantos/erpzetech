CREATE TABLE public.estoque_grade_movimentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  produto_id uuid NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
  deposito_id uuid NOT NULL REFERENCES public.depositos(id) ON DELETE CASCADE,
  tamanho text NOT NULL,
  quantidade numeric NOT NULL,
  saldo_apos numeric NOT NULL,
  origem text NOT NULL DEFAULT 'outro',
  documento text,
  usuario_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX estoque_grade_mov_tenant_data ON public.estoque_grade_movimentos (tenant_id, created_at DESC);
GRANT SELECT ON public.estoque_grade_movimentos TO authenticated;
GRANT ALL ON public.estoque_grade_movimentos TO service_role;
ALTER TABLE public.estoque_grade_movimentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY estoque_grade_mov_read ON public.estoque_grade_movimentos FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

-- Registra toda variação de saldo por tamanho; a origem vem do contexto da transação
CREATE OR REPLACE FUNCTION public.estoque_grade_registra_mov() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d numeric; r record; s numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; d := -OLD.quantidade; s := 0;
  ELSIF TG_OP = 'INSERT' THEN r := NEW; d := NEW.quantidade; s := NEW.quantidade;
  ELSE r := NEW; d := NEW.quantidade - OLD.quantidade; s := NEW.quantidade; END IF;
  IF d = 0 THEN RETURN NULL; END IF;
  INSERT INTO public.estoque_grade_movimentos (tenant_id, produto_id, deposito_id, tamanho, quantidade, saldo_apos, origem, documento, usuario_id)
  VALUES (r.tenant_id, r.produto_id, r.deposito_id, r.tamanho, d, s,
    coalesce(nullif(current_setting('app.grade_origem', true), ''), 'outro'),
    nullif(current_setting('app.grade_documento', true), ''), auth.uid());
  RETURN NULL;
END $$;
CREATE TRIGGER estoque_grade_mov AFTER INSERT OR UPDATE OF quantidade OR DELETE ON public.estoque_grade
FOR EACH ROW EXECUTE FUNCTION public.estoque_grade_registra_mov();

CREATE OR REPLACE FUNCTION public.estoque_grade_da_compra() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE dep uuid; num text; g jsonb;
BEGIN
  IF jsonb_typeof(NEW.impostos->'grade') <> 'array' THEN RETURN NEW; END IF;
  SELECT deposito_id, coalesce('NF ' || nfe_numero, 'Compra ' || numero::text) INTO dep, num FROM public.compras WHERE id = NEW.compra_id;
  IF dep IS NULL THEN RETURN NEW; END IF;
  PERFORM set_config('app.grade_origem', 'compra', true);
  PERFORM set_config('app.grade_documento', num, true);
  FOR g IN SELECT * FROM jsonb_array_elements(NEW.impostos->'grade') LOOP
    INSERT INTO public.estoque_grade (tenant_id, produto_id, deposito_id, tamanho, quantidade)
    VALUES (NEW.tenant_id, NEW.produto_id, dep, g->>'tamanho', (g->>'quantidade')::numeric)
    ON CONFLICT (produto_id, deposito_id, tamanho)
    DO UPDATE SET quantidade = estoque_grade.quantidade + EXCLUDED.quantidade, updated_at = now();
  END LOOP;
  PERFORM set_config('app.grade_origem', '', true);
  PERFORM set_config('app.grade_documento', '', true);
  RETURN NEW;
END $$;

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
  PERFORM set_config('app.grade_origem', 'ajuste', true);
  PERFORM set_config('app.grade_documento', 'Conferência manual', true);
  -- zera o que não veio na contagem e grava a contagem (atualiza em vez de apagar para o histórico mostrar a diferença)
  UPDATE public.estoque_grade SET quantidade = 0, updated_at = now()
   WHERE produto_id = p_produto_id AND deposito_id = p_deposito_id
     AND tamanho NOT IN (SELECT x->>'tamanho' FROM jsonb_array_elements(p_grade) x WHERE (x->>'quantidade')::numeric > 0);
  FOR g IN SELECT * FROM jsonb_array_elements(p_grade) LOOP
    IF (g->>'quantidade')::numeric > 0 THEN
      INSERT INTO public.estoque_grade (tenant_id, produto_id, deposito_id, tamanho, quantidade)
      VALUES (t, p_produto_id, p_deposito_id, g->>'tamanho', (g->>'quantidade')::numeric)
      ON CONFLICT (produto_id, deposito_id, tamanho) DO UPDATE SET quantidade = EXCLUDED.quantidade, updated_at = now();
    END IF;
  END LOOP;
  DELETE FROM public.estoque_grade WHERE produto_id = p_produto_id AND deposito_id = p_deposito_id AND quantidade = 0;
  PERFORM set_config('app.grade_origem', '', true);
  PERFORM set_config('app.grade_documento', '', true);
END $$;

CREATE OR REPLACE FUNCTION public.estoque_grade_mover_pedido(p_pp_id uuid, p_sinal int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pp record; dep uuid; num text; g jsonb; prod uuid;
BEGIN
  SELECT * INTO pp FROM public.pedido_personalizacao WHERE id = p_pp_id;
  SELECT deposito_id, 'Pedido ' || numero::text INTO dep, num FROM public.pedidos WHERE id = pp.pedido_id;
  IF dep IS NULL OR jsonb_typeof(pp.grade) <> 'array' THEN RETURN; END IF;
  PERFORM set_config('app.grade_origem', CASE WHEN p_sinal < 0 THEN 'producao' ELSE 'cancelamento' END, true);
  PERFORM set_config('app.grade_documento', num, true);
  FOR g IN SELECT * FROM jsonb_array_elements(pp.grade) LOOP
    prod := NULLIF(g->>'produto_id','')::uuid;
    IF prod IS NULL OR coalesce((g->>'quantidade')::numeric,0) <= 0 THEN CONTINUE; END IF;
    INSERT INTO public.estoque_grade (tenant_id, produto_id, deposito_id, tamanho, quantidade)
    VALUES (pp.tenant_id, prod, dep, g->>'tamanho', GREATEST(0, p_sinal * (g->>'quantidade')::numeric))
    ON CONFLICT (produto_id, deposito_id, tamanho)
    DO UPDATE SET quantidade = GREATEST(0, estoque_grade.quantidade + p_sinal * (g->>'quantidade')::numeric), updated_at = now();
  END LOOP;
  UPDATE public.pedido_personalizacao SET grade_baixada = (p_sinal < 0) WHERE id = p_pp_id;
  PERFORM set_config('app.grade_origem', '', true);
  PERFORM set_config('app.grade_documento', '', true);
END $$;
REVOKE ALL ON FUNCTION public.estoque_grade_mover_pedido(uuid, int) FROM public, anon, authenticated;

-- Histórico anterior: entradas das notas e baixas de pedidos já feitas (sem saldo exato na época)
INSERT INTO public.estoque_grade_movimentos (tenant_id, produto_id, deposito_id, tamanho, quantidade, saldo_apos, origem, documento, created_at)
SELECT ci.tenant_id, ci.produto_id, c.deposito_id, g->>'tamanho', (g->>'quantidade')::numeric, 0, 'compra',
       coalesce('NF ' || c.nfe_numero, 'Compra ' || c.numero::text), ci.created_at
FROM public.compra_itens ci JOIN public.compras c ON c.id = ci.compra_id,
LATERAL jsonb_array_elements(ci.impostos->'grade') g
WHERE jsonb_typeof(ci.impostos->'grade') = 'array' AND c.deposito_id IS NOT NULL AND (g->>'quantidade')::numeric > 0;

INSERT INTO public.estoque_grade_movimentos (tenant_id, produto_id, deposito_id, tamanho, quantidade, saldo_apos, origem, documento, created_at)
SELECT pp.tenant_id, NULLIF(g->>'produto_id','')::uuid, p.deposito_id, g->>'tamanho', -(g->>'quantidade')::numeric, 0, 'producao',
       'Pedido ' || p.numero::text, pp.updated_at
FROM public.pedido_personalizacao pp JOIN public.pedidos p ON p.id = pp.pedido_id,
LATERAL jsonb_array_elements(pp.grade) g
WHERE pp.grade_baixada AND jsonb_typeof(pp.grade) = 'array' AND p.deposito_id IS NOT NULL
  AND NULLIF(g->>'produto_id','') IS NOT NULL AND (g->>'quantidade')::numeric > 0
  AND EXISTS (SELECT 1 FROM public.produtos WHERE id = NULLIF(g->>'produto_id','')::uuid);