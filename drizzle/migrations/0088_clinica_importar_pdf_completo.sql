CREATE OR REPLACE FUNCTION public.clinica_importar_pdf(p_pet_id uuid, p_chave uuid, p_dados jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE
 v_vet uuid; v_tenant uuid; pt public.pets%ROWTYPE; g jsonb; it jsonb; m uuid; c uuid; e jsonb; r jsonb; linhas jsonb; resultado jsonb := '[]'; anterior jsonb; quantidade integer; unidade text; nome text;
BEGIN
 PERFORM public.exige_nao_contador();
 v_vet := public._clinica_vet(); v_tenant := public.current_tenant_id();
 SELECT * INTO pt FROM public.pets WHERE id=p_pet_id AND tenant_id=v_tenant AND ativo;
 IF NOT FOUND THEN RAISE EXCEPTION 'Paciente não encontrado'; END IF;
 IF lower(btrim(p_dados->>'paciente')) IS DISTINCT FROM lower(btrim(pt.nome)) OR p_dados->>'especie' IS DISTINCT FROM pt.especie THEN RAISE EXCEPTION 'O PDF não é deste paciente e espécie'; END IF;
 IF p_dados->>'confirmado' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Confira o PDF antes de importar'; END IF;
 IF jsonb_typeof(p_dados->'grupos') IS DISTINCT FROM 'array' OR jsonb_array_length(p_dados->'grupos') NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Confira os exames do PDF'; END IF;
 anterior := public._clinica_op_repetida(p_chave, 'pdf_exames');
 IF anterior IS NOT NULL THEN RETURN anterior; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('clinica_exame_modelo:' || v_tenant::text, 0));
 FOR g IN SELECT value FROM jsonb_array_elements(p_dados->'grupos') LOOP
  IF jsonb_typeof(g->'itens') IS DISTINCT FROM 'array' OR jsonb_array_length(g->'itens') NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Confira os campos do exame'; END IF;
  m := nullif(g->>'modelo_id','')::uuid;
  IF m IS NULL THEN
   SELECT id INTO m FROM public.pet_exame_modelos WHERE tenant_id=v_tenant AND lower(btrim(nome))=lower(btrim(g->>'nome'));
   IF m IS NULL THEN m := public.clinica_exame_modelo_salvar(jsonb_build_object('nome',g->>'nome','tipo',g->>'tipo')); END IF;
  END IF;
  PERFORM 1 FROM public.pet_exame_modelos WHERE id=m AND tenant_id=v_tenant AND ativo;
  IF NOT FOUND THEN RAISE EXCEPTION 'Modelo não encontrado ou inativo'; END IF;
  FOR it IN SELECT value FROM jsonb_array_elements(g->'itens') LOOP
   nome := btrim(it->>'nome'); unidade := nullif(btrim(it->>'unidade'),'');
   IF nome IS NULL OR nome='' THEN RAISE EXCEPTION 'Campo sem nome'; END IF;
   SELECT count(*), (array_agg(id))[1] INTO quantidade,c FROM public.pet_exame_campos WHERE modelo_id=m AND lower(btrim(pet_exame_campos.nome))=lower(nome);
   IF quantidade>1 THEN RAISE EXCEPTION 'Campo ambíguo: %',nome; END IF;
   IF quantidade=0 THEN
    c := public.clinica_exame_campo_salvar(jsonb_build_object('modelo_id',m,'nome',nome,'unidade',unidade,'forma','numero','casas',6));
   ELSE
    PERFORM 1 FROM public.pet_exame_campos WHERE id=c AND ativo AND forma IN ('numero','calculado') AND lower(coalesce(pet_exame_campos.unidade,''))=lower(coalesce(unidade,''));
    IF NOT FOUND THEN RAISE EXCEPTION 'Campo inativo ou unidade incompatível: %. Confira o modelo.',nome; END IF;
   END IF;
  END LOOP;
  e := public.clinica_exame_abrir(p_pet_id,m,jsonb_build_object('laboratorio',p_dados->>'laboratorio','data_coleta',p_dados->>'coleta'));
  linhas := '[]';
  FOR it IN SELECT value FROM jsonb_array_elements(g->'itens') LOOP
   SELECT value INTO r FROM jsonb_array_elements(e->'resultados') WHERE lower(btrim(value->>'nome'))=lower(btrim(it->>'nome'));
   IF r IS NULL THEN RAISE EXCEPTION 'Resultado não encontrado'; END IF;
   IF r->>'forma'='calculado' THEN
    linhas := linhas || jsonb_build_array(jsonb_build_object('id',r->>'id','faixa_min',it->'minimo','faixa_max',it->'maximo'));
   ELSE
    linhas := linhas || jsonb_build_array(jsonb_build_object('id',r->>'id','valor',it->'valor') || CASE WHEN it->>'minimo' IS NOT NULL THEN jsonb_build_object('faixa_min',it->'minimo','faixa_max',it->'maximo') ELSE '{}'::jsonb END);
   END IF;
  END LOOP;
  e := public.clinica_exame_salvar((e->>'id')::uuid,jsonb_build_object('resultados',linhas));
  FOR it IN SELECT value FROM jsonb_array_elements(g->'itens') LOOP
   SELECT value INTO r FROM jsonb_array_elements(e->'resultados') WHERE lower(btrim(value->>'nome'))=lower(btrim(it->>'nome'));
   IF (r->>'valor_num')::numeric IS DISTINCT FROM (it->>'valor')::numeric THEN RAISE EXCEPTION 'Valor calculado divergente no PDF: %',it->>'nome'; END IF;
  END LOOP;
  resultado := resultado || jsonb_build_array(jsonb_build_object('id',e->>'id','nome',e->>'nome'));
 END LOOP;
 anterior := jsonb_build_object('exames',resultado,'pet_id',p_pet_id);
 INSERT INTO public.clinica_operacoes_offline(chave,tenant_id,tipo,resultado) VALUES(p_chave,v_tenant,'pdf_exames',anterior);
 RETURN anterior;
END $$;
REVOKE ALL ON FUNCTION public.clinica_importar_pdf(uuid,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.clinica_importar_pdf(uuid,uuid,jsonb) TO authenticated;