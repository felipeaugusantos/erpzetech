DROP TRIGGER IF EXISTS pedido_personalizacao_grade_baixa ON public.pedido_personalizacao;

CREATE OR REPLACE FUNCTION public.pedido_personalizacao_baixa_grade() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT NEW.grade_baixada
     AND NEW.etapa NOT IN ('aguardando_arte')
     AND NEW.etapa IS DISTINCT FROM OLD.etapa THEN
    PERFORM public.estoque_grade_mover_pedido(NEW.id, -1);
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER pedido_personalizacao_grade_baixa AFTER UPDATE OF etapa ON public.pedido_personalizacao
FOR EACH ROW EXECUTE FUNCTION public.pedido_personalizacao_baixa_grade();