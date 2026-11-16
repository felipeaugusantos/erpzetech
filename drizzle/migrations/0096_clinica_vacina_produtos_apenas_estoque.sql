CREATE OR REPLACE FUNCTION public.clinica_vacina_produtos() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM public.exige_nao_contador();
 PERFORM public.exige_papel(ARRAY['administrador','gestor','veterinario']);
 IF NOT public.clinica_liberada() THEN RAISE EXCEPTION 'A clínica não está liberada para esta empresa'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'descricao',p.descricao,'codigo_interno',p.codigo_interno,'controla_estoque',p.controla_estoque,'controla_lote',p.controla_lote) ORDER BY p.descricao) FROM public.produtos p WHERE p.tenant_id=public.current_tenant_id() AND p.ativo AND p.controla_estoque), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.clinica_vacina_produtos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_vacina_produtos() TO authenticated, service_role;
DO $$ DECLARE d text; BEGIN
 d := pg_get_functiondef('public.clinica_vacina_catalogo_salvar(jsonb)'::regprocedure);
 d := replace(d, 'UPDATE public.produtos SET controla_estoque=true, controla_lote=true WHERE id=v_prod AND tenant_id=v_tenant AND ativo;', 'UPDATE public.produtos SET controla_lote=true WHERE id=v_prod AND tenant_id=v_tenant AND ativo AND controla_estoque;');
 EXECUTE d;
END $$;