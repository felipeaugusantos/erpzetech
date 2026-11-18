CREATE OR REPLACE FUNCTION public._empresa_logo_publicavel(p_caminho text, p_tenant uuid)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = public AS $$
 SELECT CASE
 WHEN p_caminho ~ '^https?://' THEN p_caminho
 WHEN p_tenant IS NOT NULL AND p_caminho ~ ('^' || p_tenant::text || '/logo-[A-Za-z0-9-]+\.(png|jpg|jpeg|webp|svg)$') THEN p_caminho
 ELSE NULL END
$$;
REVOKE ALL ON FUNCTION public._empresa_logo_publicavel(text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._empresa_logo_publicavel(text,uuid) TO service_role;
DO $$
DECLARE d text;
BEGIN
 SELECT pg_get_functiondef('public.empresa_por_slug(text)'::regprocedure) INTO d;
 IF position('public._empresa_logo_publicavel' in d) = 0 THEN
   IF position('e.cor_primaria, e.logo_path' in d)=0 OR position('e2.cor_primaria, e2.logo_path' in d)=0 THEN RAISE EXCEPTION 'Unexpected branding function'; END IF;
   d := replace(d,'e.cor_primaria, e.logo_path','e.cor_primaria, public._empresa_logo_publicavel(e.logo_path, e.tenant_id) AS logo_path');
   d := replace(d,'e2.cor_primaria, e2.logo_path','e2.cor_primaria, public._empresa_logo_publicavel(e2.logo_path, e2.tenant_id)');
   EXECUTE d;
 END IF;
 SELECT pg_get_functiondef('public.restaurante_cardapio_publico(text)'::regprocedure) INTO d;
 IF position('public._empresa_logo_publicavel' in d) = 0 THEN
   IF position('e.cor_primaria, e.logo_path' in d)=0 THEN RAISE EXCEPTION 'Unexpected menu function'; END IF;
   d := replace(d,'e.cor_primaria, e.logo_path','e.cor_primaria, public._empresa_logo_publicavel(e.logo_path, e.tenant_id) AS logo_path');
   EXECUTE d;
 END IF;
 SELECT pg_get_functiondef('public.compra_aplicar_cotacao(uuid)'::regprocedure) INTO d;
 IF position('public.exige_papel' in d) = 0 THEN
   IF position('begin PERFORM public.exige_nao_contador();' in d)=0 THEN RAISE EXCEPTION 'Unexpected quote function'; END IF;
   d := replace(d,'begin PERFORM public.exige_nao_contador();', 'begin PERFORM public.exige_nao_contador(); PERFORM public.exige_papel(ARRAY[''administrador'', ''gestor'', ''comprador'']);');
   EXECUTE d;
 END IF;
END $$;