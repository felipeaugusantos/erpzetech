ALTER TABLE public.pedido_personalizacao ADD COLUMN IF NOT EXISTS grade_baixada boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.estoque_grade_mover_pedido(p_pp_id uuid, p_sinal int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pp record; dep uuid; g jsonb; prod uuid;
BEGIN
  SELECT * INTO pp FROM public.pedido_personalizacao WHERE id = p_pp_id;
  SELECT deposito_id INTO dep FROM public.pedidos WHERE id = pp.pedido_id;
  IF dep IS NULL OR jsonb_typeof(pp.grade) <> 'array' THEN RETURN; END IF;
  FOR g IN SELECT * FROM jsonb_array_elements(pp.grade) LOOP
    prod := NULLIF(g->>'produto_id','')::uuid;
    IF prod IS NULL OR coalesce((g->>'quantidade')::numeric,0) <= 0 THEN CONTINUE; END IF;
    INSERT INTO public.estoque_grade (tenant_id, produto_id, deposito_id, tamanho, quantidade)
    VALUES (pp.tenant_id, prod, dep, g->>'tamanho', GREATEST(0, p_sinal * (g->>'quantidade')::numeric))
    ON CONFLICT (produto_id, deposito_id, tamanho)
    DO UPDATE SET quantidade = GREATEST(0, estoque_grade.quantidade + p_sinal * (g->>'quantidade')::numeric), updated_at = now();
  END LOOP;
  UPDATE public.pedido_personalizacao SET grade_baixada = (p_sinal < 0) WHERE id = p_pp_id;
END $$;
REVOKE ALL ON FUNCTION public.estoque_grade_mover_pedido(uuid, int) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pedido_personalizacao_baixa_grade() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT NEW.grade_baixada THEN PERFORM public.estoque_grade_mover_pedido(NEW.id, -1); END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER pedido_personalizacao_grade_baixa AFTER INSERT ON public.pedido_personalizacao
FOR EACH ROW EXECUTE FUNCTION public.pedido_personalizacao_baixa_grade();

CREATE OR REPLACE FUNCTION public.pedido_cancelado_volta_grade() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pid uuid;
BEGIN
  IF NEW.situacao = 'cancelado' AND OLD.situacao IS DISTINCT FROM 'cancelado' THEN
    SELECT id INTO pid FROM public.pedido_personalizacao WHERE pedido_id = NEW.id AND grade_baixada;
    IF pid IS NOT NULL THEN PERFORM public.estoque_grade_mover_pedido(pid, 1); END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER pedidos_cancelado_grade AFTER UPDATE OF situacao ON public.pedidos
FOR EACH ROW EXECUTE FUNCTION public.pedido_cancelado_volta_grade();