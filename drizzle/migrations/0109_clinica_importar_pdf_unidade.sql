-- Rename the PL/pgSQL variable "unidade" that collides with pet_exame_campos.unidade.
DO $$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef('public.clinica_importar_pdf(uuid,uuid,jsonb)'::regprocedure) INTO d;
  IF position('v_unidade' IN d) = 0 THEN
    d := replace(d, 'quantidade integer; unidade text;', 'quantidade integer; v_unidade text;');
    d := replace(d, 'unidade := nullif(', 'v_unidade := nullif(');
    d := replace(d, '''unidade'',unidade,', '''unidade'',v_unidade,');
    d := replace(d, 'lower(coalesce(unidade,''''))', 'lower(coalesce(v_unidade,''''))');
    EXECUTE d;
  END IF;
END $$;
