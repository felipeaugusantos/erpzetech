-- CNPJ alfanumérico (Receita, 2026): "empresa com CNPJ" passa a contar letras e números (14 caracteres),
-- igual à tela. Antes só números eram contados e um CNPJ com letras liberava a escolha manual de módulos.
CREATE OR REPLACE FUNCTION public.clinica_liberada() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public AS $function$
 SELECT EXISTS (SELECT 1 FROM public.empresas e WHERE e.tenant_id = public.current_tenant_id() AND (
 EXISTS (SELECT 1 FROM public.empresa_modulos_liberados m WHERE m.empresa_id = e.id AND m.modulo = 'clinica')
 OR e.ramo_atividade = 'clinica'
 OR (length(regexp_replace(coalesce(e.cnpj,''), '[^0-9A-Za-z]','','g')) < 14 AND 'clinica' = ANY(e.modulos_sem_cnpj))
 OR EXISTS (SELECT 1 FROM unnest(regexp_split_to_array(coalesce(e.cnae,'') || ',' || coalesce(e.cnae_secundarios,''), '[,;\n|]+')) c WHERE regexp_replace(c,'\D','','g') LIKE '7500%')))
$function$;
REVOKE ALL ON FUNCTION public.clinica_liberada() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_liberada() TO authenticated;
