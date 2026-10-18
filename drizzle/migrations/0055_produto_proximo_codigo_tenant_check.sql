CREATE OR REPLACE FUNCTION public.produto_proximo_codigo(p_tenant uuid DEFAULT NULL)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid := coalesce(p_tenant, public.current_tenant_id()); n bigint;
BEGIN
  IF auth.uid() IS NOT NULL AND t IS DISTINCT FROM public.current_tenant_id() THEN
    RAISE EXCEPTION 'Empresa inválida';
  END IF;
  SELECT coalesce(max(codigo_interno::bigint), 0) + 1 INTO n
    FROM public.produtos WHERE tenant_id = t AND codigo_interno ~ '^[0-9]{1,15}$';
  RETURN lpad(n::text, 5, '0');
END $$;