DO $$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef('public.clinica_importar_pdf_arquivo(uuid,uuid,jsonb)'::regprocedure) INTO d;
  d := replace(d, 'IF m IS NULL THEN m := public.clinica_exame_modelo_salvar(jsonb_build_object(''nome'',''Laudo em PDF'',''tipo'',''outro'')); END IF;',
    'IF m IS NULL THEN m := public.clinica_exame_modelo_salvar(jsonb_build_object(''nome'',''Laudo em PDF'',''tipo'',''outro'')); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pet_exame_campos WHERE modelo_id=m AND ativo) THEN
    PERFORM public.clinica_exame_campo_salvar(jsonb_build_object(''modelo_id'',m,''nome'',''Observação'',''forma'',''texto''));
  END IF;');
  EXECUTE d;
END $$;