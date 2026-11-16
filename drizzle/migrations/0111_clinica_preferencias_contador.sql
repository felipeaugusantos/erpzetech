CREATE POLICY contador_restrito ON public.clinica_preferencias AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT NOT public.eh_contador_restrito()));
CREATE OR REPLACE FUNCTION public.clinica_preferencias_ler()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_nao_contador();
  RETURN jsonb_build_object('importacao_exame', coalesce(
    (SELECT importacao_exame FROM public.clinica_preferencias WHERE tenant_id = public.current_tenant_id()), 'valores'));
END $$;
CREATE OR REPLACE FUNCTION public.clinica_preferencias_salvar(p_importacao_exame text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_nao_contador();
  PERFORM public.exige_papel(ARRAY['administrador','gestor']);
  IF NOT public.clinica_liberada() THEN RAISE EXCEPTION 'A clínica não está liberada para esta empresa'; END IF;
  IF p_importacao_exame NOT IN ('valores','arquivo') THEN RAISE EXCEPTION 'Opção inválida'; END IF;
  INSERT INTO public.clinica_preferencias (tenant_id, importacao_exame) VALUES (public.current_tenant_id(), p_importacao_exame)
  ON CONFLICT (tenant_id) DO UPDATE SET importacao_exame = EXCLUDED.importacao_exame, updated_at = now();
END $$;