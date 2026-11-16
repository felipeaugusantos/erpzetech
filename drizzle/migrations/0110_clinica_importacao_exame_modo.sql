CREATE TABLE IF NOT EXISTS public.clinica_preferencias (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  importacao_exame text NOT NULL DEFAULT 'valores' CHECK (importacao_exame IN ('valores','arquivo')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.clinica_preferencias FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.clinica_preferencias TO service_role;
ALTER TABLE public.clinica_preferencias ENABLE ROW LEVEL SECURITY;
CREATE POLICY salao_restrito ON public.clinica_preferencias AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT NOT public.eh_salao_restrito()));

CREATE OR REPLACE FUNCTION public.clinica_preferencias_ler()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.exige_nao_salao();
  RETURN jsonb_build_object('importacao_exame', coalesce(
    (SELECT importacao_exame FROM public.clinica_preferencias WHERE tenant_id = public.current_tenant_id()), 'valores'));
END $$;
REVOKE ALL ON FUNCTION public.clinica_preferencias_ler() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_preferencias_ler() TO authenticated;

CREATE OR REPLACE FUNCTION public.clinica_preferencias_salvar(p_importacao_exame text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador','gestor']);
  IF NOT public.clinica_liberada() THEN RAISE EXCEPTION 'A clínica não está liberada para esta empresa'; END IF;
  IF p_importacao_exame NOT IN ('valores','arquivo') THEN RAISE EXCEPTION 'Opção inválida'; END IF;
  INSERT INTO public.clinica_preferencias (tenant_id, importacao_exame) VALUES (public.current_tenant_id(), p_importacao_exame)
  ON CONFLICT (tenant_id) DO UPDATE SET importacao_exame = EXCLUDED.importacao_exame, updated_at = now();
END $$;
REVOKE ALL ON FUNCTION public.clinica_preferencias_salvar(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_preferencias_salvar(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.clinica_importar_pdf_arquivo(p_pet_id uuid, p_chave uuid, p_dados jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_tenant uuid; pt public.pets%ROWTYPE; m uuid; e jsonb; anterior jsonb;
BEGIN
  PERFORM public.exige_nao_contador();
  PERFORM public._clinica_vet(); v_tenant := public.current_tenant_id();
  SELECT * INTO pt FROM public.pets WHERE id=p_pet_id AND tenant_id=v_tenant AND ativo;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paciente não encontrado'; END IF;
  IF lower(btrim(p_dados->>'paciente')) IS DISTINCT FROM lower(btrim(pt.nome)) OR p_dados->>'especie' IS DISTINCT FROM pt.especie THEN RAISE EXCEPTION 'O PDF não é deste paciente e espécie'; END IF;
  IF p_dados->>'confirmado' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Confira o PDF antes de importar'; END IF;
  anterior := public._clinica_op_repetida(p_chave, 'pdf_arquivo');
  IF anterior IS NOT NULL THEN RETURN anterior; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('clinica_exame_modelo:' || v_tenant::text, 0));
  SELECT id INTO m FROM public.pet_exame_modelos WHERE tenant_id=v_tenant AND lower(btrim(nome))='laudo em pdf';
  IF m IS NULL THEN m := public.clinica_exame_modelo_salvar(jsonb_build_object('nome','Laudo em PDF','tipo','outro')); END IF;
  e := public.clinica_exame_abrir(p_pet_id,m,jsonb_build_object('laboratorio',p_dados->>'laboratorio','data_coleta',p_dados->>'coleta'));
  UPDATE public.pet_exames SET data_emissao = nullif(p_dados->>'emissao','')::date WHERE id=(e->>'id')::uuid AND tenant_id=v_tenant;
  anterior := jsonb_build_object('exames', jsonb_build_array(jsonb_build_object('id',e->>'id','nome',e->>'nome')),'pet_id',p_pet_id);
  INSERT INTO public.clinica_operacoes_offline(chave,tenant_id,tipo,resultado) VALUES(p_chave,v_tenant,'pdf_arquivo',anterior);
  RETURN anterior;
END $$;
REVOKE ALL ON FUNCTION public.clinica_importar_pdf_arquivo(uuid,uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_importar_pdf_arquivo(uuid,uuid,jsonb) TO authenticated;