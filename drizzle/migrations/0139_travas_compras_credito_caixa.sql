CREATE OR REPLACE FUNCTION public._direto() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT current_user IN ('authenticated','anon') $$;

CREATE OR REPLACE FUNCTION public._compras_guarda() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF public._direto() AND NEW.situacao IS DISTINCT FROM 'rascunho' THEN RAISE EXCEPTION 'Compra nova começa em rascunho'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.situacao IS DISTINCT FROM OLD.situacao THEN
    IF public._direto() THEN RAISE EXCEPTION 'Use as ações da compra para mudar a situação'; END IF;
    IF NEW.situacao IN ('aprovado','pedido_enviado') AND auth.uid() IS NOT NULL
       AND NOT (public.has_role(auth.uid(),'administrador') OR public.has_role(auth.uid(),'gestor') OR public.has_role(auth.uid(),'comprador')) THEN
      RAISE EXCEPTION 'Apenas administrador, gestor ou comprador pode aprovar a compra';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_compras_guarda ON public.compras;
CREATE TRIGGER trg_compras_guarda BEFORE INSERT OR UPDATE ON public.compras FOR EACH ROW EXECUTE FUNCTION public._compras_guarda();

CREATE OR REPLACE FUNCTION public._compra_itens_guarda() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_sit text; v_compra uuid;
BEGIN
  IF current_user NOT IN ('authenticated','anon') THEN RETURN coalesce(NEW, OLD); END IF;
  NULL;
  RETURN coalesce(NEW, OLD);
END $$;
-- trigger function runs as invoker for role detection
CREATE OR REPLACE FUNCTION public._compra_itens_guarda() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE v_sit text;
BEGIN
  IF NOT public._direto() THEN RETURN coalesce(NEW, OLD); END IF;
  IF NOT (public.has_role(auth.uid(),'administrador') OR public.has_role(auth.uid(),'gestor') OR public.has_role(auth.uid(),'comprador')) THEN
    RAISE EXCEPTION 'Apenas administrador, gestor ou comprador altera itens da compra';
  END IF;
  SELECT situacao::text INTO v_sit FROM public.compras WHERE id = coalesce(NEW.compra_id, OLD.compra_id);
  IF v_sit IS NULL OR v_sit NOT IN ('rascunho','cotacao') THEN RAISE EXCEPTION 'Compra não está mais editável'; END IF;
  IF TG_OP = 'UPDATE' AND NEW.compra_id IS DISTINCT FROM OLD.compra_id THEN RAISE EXCEPTION 'Item não pode mudar de compra'; END IF;
  RETURN coalesce(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS trg_compra_itens_guarda ON public.compra_itens;
CREATE TRIGGER trg_compra_itens_guarda BEFORE INSERT OR UPDATE OR DELETE ON public.compra_itens FOR EACH ROW EXECUTE FUNCTION public._compra_itens_guarda();

REVOKE INSERT, UPDATE, DELETE ON public.compra_cotacao_itens FROM authenticated, anon;

CREATE OR REPLACE FUNCTION public._credito_aut_guarda() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NOT public._direto() THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.situacao IS DISTINCT FROM 'pendente' OR NEW.autorizado_por IS NOT NULL OR NEW.autorizado_em IS NOT NULL THEN
      RAISE EXCEPTION 'Autorização de crédito começa pendente';
    END IF;
  ELSIF NEW.situacao IS DISTINCT FROM OLD.situacao OR NEW.autorizado_por IS DISTINCT FROM OLD.autorizado_por
     OR NEW.autorizado_em IS DISTINCT FROM OLD.autorizado_em THEN
    RAISE EXCEPTION 'Use a decisão de crédito para aprovar ou negar';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_credito_aut_guarda ON public.credito_autorizacoes;
CREATE TRIGGER trg_credito_aut_guarda BEFORE INSERT OR UPDATE ON public.credito_autorizacoes FOR EACH ROW EXECUTE FUNCTION public._credito_aut_guarda();

CREATE OR REPLACE FUNCTION public._tenant_suspenso() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.saas_clientes c WHERE c.tenant_id = public.current_tenant_id()
    AND c.cobranca_automatica AND c.situacao = 'suspenso') AND NOT public.eh_saas_operador()
$$;
REVOKE ALL ON FUNCTION public._tenant_suspenso() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._tenant_suspenso() TO authenticated;
DROP POLICY IF EXISTS tenant_nao_suspenso ON public.caixas;
CREATE POLICY tenant_nao_suspenso ON public.caixas AS RESTRICTIVE FOR ALL TO authenticated USING (NOT public._tenant_suspenso()) WITH CHECK (NOT public._tenant_suspenso());