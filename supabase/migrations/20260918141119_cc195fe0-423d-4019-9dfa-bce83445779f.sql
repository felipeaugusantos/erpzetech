CREATE OR REPLACE FUNCTION public.premiar_pedido()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prof_id uuid;
  v_perc numeric;
BEGIN
  IF NEW.situacao NOT IN ('entregue','concluido') THEN
    RETURN NEW;
  END IF;

  SELECT pr.id, pr.percentual_premio
    INTO v_prof_id, v_perc
  FROM public.clientes c
  JOIN public.profissionais pr ON pr.id = c.profissional_id AND pr.ativo
  WHERE c.id = NEW.cliente_id AND c.profissional_id IS NOT NULL;

  IF v_prof_id IS NULL OR COALESCE(v_perc, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.premiacoes x
    WHERE x.pedido_id = NEW.id AND x.profissional_id = v_prof_id
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.premiacoes (
    tenant_id, profissional_id, cliente_id, pedido_id, valor_base, percentual, valor, observacao
  ) VALUES (
    NEW.tenant_id, v_prof_id, NEW.cliente_id, NEW.id, NEW.total, v_perc,
    round(NEW.total * v_perc / 100, 2),
    'Lançamento automático pelo pedido'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_premiar_pedido ON public.pedidos;
CREATE TRIGGER trg_premiar_pedido
AFTER INSERT OR UPDATE OF situacao ON public.pedidos
FOR EACH ROW EXECUTE FUNCTION public.premiar_pedido();