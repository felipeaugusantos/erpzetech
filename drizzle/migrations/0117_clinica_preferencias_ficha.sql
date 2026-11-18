ALTER TABLE public.clinica_preferencias ADD COLUMN IF NOT EXISTS proxima_consulta boolean NOT NULL DEFAULT true;
ALTER TABLE public.clinica_preferencias ADD COLUMN IF NOT EXISTS secoes_ocultas text[] NOT NULL DEFAULT '{}';
CREATE OR REPLACE FUNCTION public.clinica_preferencias_ler() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.clinica_preferencias;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_nao_contador();
  SELECT * INTO r FROM public.clinica_preferencias WHERE tenant_id = public.current_tenant_id();
  RETURN jsonb_build_object('importacao_exame', coalesce(r.importacao_exame,'valores'),
    'proxima_consulta', coalesce(r.proxima_consulta,true),
    'secoes_ocultas', to_jsonb(coalesce(r.secoes_ocultas,'{}'::text[])));
END $$;
CREATE OR REPLACE FUNCTION public.clinica_preferencias_ficha_salvar(p_proxima_consulta boolean, p_secoes_ocultas text[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_nao_contador();
  PERFORM public.exige_papel(ARRAY['administrador','gestor','veterinario']);
  IF NOT public.clinica_liberada() THEN RAISE EXCEPTION 'A clínica não está liberada para esta empresa'; END IF;
  IF p_proxima_consulta IS NULL OR coalesce(array_length(p_secoes_ocultas,1),0) > 20
     OR EXISTS (SELECT 1 FROM unnest(coalesce(p_secoes_ocultas,'{}')) s WHERE s NOT IN ('sinais','documentos','exames_agendados','resumo_ia','favoritos'))
  THEN RAISE EXCEPTION 'Opção inválida'; END IF;
  INSERT INTO public.clinica_preferencias (tenant_id, proxima_consulta, secoes_ocultas)
  VALUES (public.current_tenant_id(), p_proxima_consulta, coalesce(p_secoes_ocultas,'{}'))
  ON CONFLICT (tenant_id) DO UPDATE SET proxima_consulta = EXCLUDED.proxima_consulta, secoes_ocultas = EXCLUDED.secoes_ocultas, updated_at = now();
END $$;
REVOKE ALL ON FUNCTION public.clinica_preferencias_ficha_salvar(boolean, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_preferencias_ficha_salvar(boolean, text[]) TO authenticated;