ALTER TABLE public.pedido_personalizacao DROP CONSTRAINT IF EXISTS pedido_personalizacao_etapa_check;
ALTER TABLE public.pedido_personalizacao ADD CONSTRAINT pedido_personalizacao_etapa_check
  CHECK (etapa IN ('aguardando_arte','impressao','prensa','montagem','pronto','entregue'));
ALTER TABLE public.pedido_personalizacao ADD COLUMN etapas_datas jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Guarda quando cada etapa começou (o banco carimba, não a tela)
CREATE OR REPLACE FUNCTION public.personalizacao_data_etapa() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.etapa IS DISTINCT FROM OLD.etapa THEN
    NEW.etapas_datas := COALESCE(NEW.etapas_datas, '{}'::jsonb) || jsonb_build_object(NEW.etapa, now());
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_personalizacao_data_etapa BEFORE INSERT OR UPDATE ON public.pedido_personalizacao
FOR EACH ROW EXECUTE FUNCTION public.personalizacao_data_etapa();

UPDATE public.pedido_personalizacao SET etapas_datas = jsonb_build_object(etapa, updated_at) WHERE etapas_datas = '{}'::jsonb;