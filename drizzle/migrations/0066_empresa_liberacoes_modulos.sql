CREATE TABLE public.empresa_modulos_liberados (
 empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
 modulo text NOT NULL CHECK (modulo IN ('assistencia','locacao','restaurante','petshop','clinica','obras')),
 PRIMARY KEY (empresa_id, modulo)
);
GRANT SELECT ON public.empresa_modulos_liberados TO authenticated;
GRANT ALL ON public.empresa_modulos_liberados TO service_role;
ALTER TABLE public.empresa_modulos_liberados ENABLE ROW LEVEL SECURITY;
CREATE POLICY empresa_modulos_leitura ON public.empresa_modulos_liberados FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.empresas e WHERE e.id = empresa_id AND e.tenant_id = public.current_tenant_id()));
CREATE OR REPLACE FUNCTION public.clinica_liberada() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public AS $function$
 SELECT EXISTS (SELECT 1 FROM public.empresas e WHERE e.tenant_id = public.current_tenant_id() AND (
 EXISTS (SELECT 1 FROM public.empresa_modulos_liberados m WHERE m.empresa_id = e.id AND m.modulo = 'clinica')
 OR e.ramo_atividade = 'clinica'
 OR (length(regexp_replace(coalesce(e.cnpj,''), '\D','','g')) < 14 AND 'clinica' = ANY(e.modulos_sem_cnpj))
 OR EXISTS (SELECT 1 FROM unnest(regexp_split_to_array(coalesce(e.cnae,'') || ',' || coalesce(e.cnae_secundarios,''), '[,;\n|]+')) c WHERE regexp_replace(c,'\D','','g') LIKE '7500%')))
$function$;
REVOKE ALL ON FUNCTION public.clinica_liberada() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_liberada() TO authenticated;