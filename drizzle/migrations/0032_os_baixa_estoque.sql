ALTER TABLE public.os_ordens
  ADD COLUMN IF NOT EXISTS deposito_id uuid REFERENCES public.depositos(id),
  ADD COLUMN IF NOT EXISTS controla_estoque boolean NOT NULL DEFAULT true;
UPDATE public.os_ordens SET controla_estoque = false;

ALTER TABLE public.os_itens
  ADD COLUMN IF NOT EXISTS baixa_produto_id uuid,
  ADD COLUMN IF NOT EXISTS baixa_deposito_id uuid,
  ADD COLUMN IF NOT EXISTS baixa_quantidade numeric;

CREATE OR REPLACE FUNCTION public.os_item_reconciliar(p_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  i public.os_itens;
  o public.os_ordens;
  v_deseja boolean;
BEGIN
  SELECT * INTO i FROM public.os_itens WHERE id = p_item_id;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO o FROM public.os_ordens WHERE id = i.os_id;

  v_deseja := o.controla_estoque
          AND o.situacao IN ('aprovada', 'em_reparo', 'pronta', 'entregue')
          AND i.tipo = 'peca' AND i.produto_id IS NOT NULL AND coalesce(i.quantidade, 0) > 0;

  IF v_deseja AND i.baixa_produto_id = i.produto_id AND i.baixa_deposito_id = o.deposito_id
     AND i.baixa_quantidade = i.quantidade THEN
    RETURN;
  END IF;
  IF NOT v_deseja AND i.baixa_produto_id IS NULL THEN RETURN; END IF;

  IF i.baixa_produto_id IS NOT NULL THEN
    PERFORM public.registrar_movimentacao_interno(i.baixa_produto_id, i.baixa_deposito_id, 'entrada'::public.mov_tipo,
      i.baixa_quantidade, 'Estorno de peça da ordem de serviço', 'OS nº ' || o.numero);
    UPDATE public.os_itens SET baixa_produto_id = NULL, baixa_deposito_id = NULL, baixa_quantidade = NULL WHERE id = i.id;
  END IF;

  IF v_deseja THEN
    IF o.deposito_id IS NULL THEN
      RAISE EXCEPTION 'Escolha o depósito de onde saem as peças da ordem de serviço';
    END IF;
    PERFORM public.registrar_movimentacao_interno(i.produto_id, o.deposito_id, 'saida'::public.mov_tipo,
      i.quantidade, 'Peça aplicada na ordem de serviço', 'OS nº ' || o.numero);
    UPDATE public.os_itens SET baixa_produto_id = i.produto_id, baixa_deposito_id = o.deposito_id,
           baixa_quantidade = i.quantidade WHERE id = i.id;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.os_item_reconciliar(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.os_itens_protege_baixa()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.baixa_produto_id := NULL; NEW.baixa_deposito_id := NULL; NEW.baixa_quantidade := NULL;
    ELSE
      NEW.baixa_produto_id := OLD.baixa_produto_id;
      NEW.baixa_deposito_id := OLD.baixa_deposito_id;
      NEW.baixa_quantidade := OLD.baixa_quantidade;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS os_itens_protege_baixa_trg ON public.os_itens;
CREATE TRIGGER os_itens_protege_baixa_trg BEFORE INSERT OR UPDATE ON public.os_itens
  FOR EACH ROW EXECUTE FUNCTION public.os_itens_protege_baixa();

CREATE OR REPLACE FUNCTION public.os_itens_baixa_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.os_item_reconciliar(NEW.id);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.os_itens_baixa_trg() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS os_itens_baixa_trg ON public.os_itens;
CREATE TRIGGER os_itens_baixa_trg AFTER INSERT OR UPDATE OF tipo, produto_id, quantidade ON public.os_itens
  FOR EACH ROW EXECUTE FUNCTION public.os_itens_baixa_trg();

CREATE OR REPLACE FUNCTION public.os_itens_estorno_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_numero integer;
BEGIN
  IF OLD.baixa_produto_id IS NOT NULL THEN
    SELECT numero INTO v_numero FROM public.os_ordens WHERE id = OLD.os_id;
    PERFORM public.registrar_movimentacao_interno(OLD.baixa_produto_id, OLD.baixa_deposito_id, 'entrada'::public.mov_tipo,
      OLD.baixa_quantidade, 'Estorno de peça da ordem de serviço', 'OS nº ' || v_numero);
  END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.os_itens_estorno_trg() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS os_itens_estorno_trg ON public.os_itens;
CREATE TRIGGER os_itens_estorno_trg BEFORE DELETE ON public.os_itens
  FOR EACH ROW EXECUTE FUNCTION public.os_itens_estorno_trg();

CREATE OR REPLACE FUNCTION public.os_ordens_baixa_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM public.os_itens WHERE os_id = NEW.id ORDER BY created_at, id LOOP
    PERFORM public.os_item_reconciliar(r.id);
  END LOOP;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.os_ordens_baixa_trg() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS os_ordens_baixa_trg ON public.os_ordens;
CREATE TRIGGER os_ordens_baixa_trg AFTER UPDATE ON public.os_ordens
  FOR EACH ROW WHEN (NEW.situacao IS DISTINCT FROM OLD.situacao OR NEW.deposito_id IS DISTINCT FROM OLD.deposito_id)
  EXECUTE FUNCTION public.os_ordens_baixa_trg();