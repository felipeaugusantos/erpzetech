ALTER TABLE public.empresas ADD COLUMN modulos_sem_cnpj text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.empresas ADD CONSTRAINT empresas_modulos_sem_cnpj_validos CHECK (modulos_sem_cnpj <@ ARRAY['assistencia','locacao','restaurante','petshop','clinica']::text[]);
COMMENT ON COLUMN public.empresas.modulos_sem_cnpj IS 'Módulos opcionais escolhidos para negócios sem CNPJ; não altera CNAEs nem permissões de usuário.';
CREATE OR REPLACE FUNCTION public.clinica_liberada() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
SELECT EXISTS (SELECT 1 FROM public.empresas e WHERE e.tenant_id = public.current_tenant_id() AND (e.ramo_atividade = 'clinica' OR (length(regexp_replace(coalesce(e.cnpj,''), '\D','','g')) < 14 AND 'clinica' = ANY(e.modulos_sem_cnpj)) OR EXISTS (SELECT 1 FROM unnest(regexp_split_to_array(coalesce(e.cnae,'') || ',' || coalesce(e.cnae_secundarios,''), '[,;\n|]+')) c WHERE regexp_replace(c,'\D','','g') LIKE '7500%')))
$$;
REVOKE ALL ON FUNCTION public.clinica_liberada() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_liberada() TO authenticated;