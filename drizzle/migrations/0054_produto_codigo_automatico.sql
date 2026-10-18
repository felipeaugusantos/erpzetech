CREATE OR REPLACE FUNCTION public.produto_proximo_codigo(p_tenant uuid DEFAULT NULL)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid := coalesce(p_tenant, public.current_tenant_id()); n bigint;
BEGIN
  IF p_tenant IS NOT NULL AND p_tenant IS DISTINCT FROM public.current_tenant_id() AND current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Empresa inválida';
  END IF;
  SELECT coalesce(max(codigo_interno::bigint), 0) + 1 INTO n
    FROM public.produtos WHERE tenant_id = t AND codigo_interno ~ '^[0-9]{1,15}$';
  RETURN lpad(n::text, 5, '0');
END $$;
REVOKE ALL ON FUNCTION public.produto_proximo_codigo(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.produto_proximo_codigo(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.produto_codigo_garante()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.codigo_interno := nullif(btrim(coalesce(NEW.codigo_interno, '')), '');
  IF NEW.codigo_interno IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('produto_codigo:' || NEW.tenant_id::text));
    NEW.codigo_interno := public.produto_proximo_codigo(NEW.tenant_id);
  END IF;
  IF EXISTS (SELECT 1 FROM public.produtos WHERE tenant_id = NEW.tenant_id
             AND lower(codigo_interno) = lower(NEW.codigo_interno) AND id <> NEW.id) THEN
    RAISE EXCEPTION 'Já existe produto com o código interno %', NEW.codigo_interno USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS produtos_codigo_garante ON public.produtos;
CREATE TRIGGER produtos_codigo_garante BEFORE INSERT OR UPDATE OF codigo_interno ON public.produtos
  FOR EACH ROW EXECUTE FUNCTION public.produto_codigo_garante();