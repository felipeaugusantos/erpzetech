DO $migration$
DECLARE
  signature text;
  definition text;
  marker text := 'v_dose := public._clinica_proxima_dose(pt.id, c.id);';
  replacement text := $dose$v_dose := public._clinica_proxima_dose(pt.id, c.id);
  IF p_dados ? 'dose_tipo' OR p_dados ? 'dose_numero' THEN
    IF coalesce(p_dados ->> 'dose_tipo', '') NOT IN ('serie', 'reforco')
       OR coalesce(p_dados ->> 'dose_numero', '') NOT IN ('1', '2', '3')
       OR (p_dados ->> 'dose_tipo' = 'reforco' AND p_dados ->> 'dose_numero' <> '1') THEN
      RAISE EXCEPTION 'Escolha 1ª, 2ª, 3ª dose ou reforço';
    END IF;
    v_dose := jsonb_build_object('dose_tipo', p_dados ->> 'dose_tipo', 'dose_numero', (p_dados ->> 'dose_numero')::integer);
  END IF;$dose$;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.clinica_vacina_aplicar(uuid,jsonb)',
    'public.clinica_vacina_registrar_externa(uuid,jsonb)'
  ] LOOP
    definition := pg_get_functiondef(signature::regprocedure);
    IF position('Escolha 1ª, 2ª, 3ª dose ou reforço' IN definition) > 0 THEN CONTINUE; END IF;
    IF position(marker IN definition) = 0 THEN
      RAISE EXCEPTION 'Unexpected vaccination definition: %', signature;
    END IF;
    EXECUTE replace(definition, marker, replacement);
  END LOOP;
END $migration$;