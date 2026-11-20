DO $migration$
DECLARE definition text;
BEGIN
  definition := pg_get_functiondef('public._clinica_agendamento_avulso(uuid,uuid,text,timestamp with time zone)'::regprocedure);
  IF position('p_inicio, p_inicio, ''em_atendimento'', ''Aplicação de vacina sem serviço cobrado''' IN definition) = 0 THEN RAISE EXCEPTION 'Unexpected optional vaccination visit definition'; END IF;
  definition := replace(definition, 'p_inicio, p_inicio, ''em_atendimento'', ''Aplicação de vacina sem serviço cobrado''', 'p_inicio, p_inicio + interval ''1 minute'', ''em_atendimento'', ''Aplicação de vacina sem serviço cobrado''');
  EXECUTE definition;
END $migration$;
REVOKE ALL ON FUNCTION public._clinica_agendamento_avulso(uuid,uuid,text,timestamp with time zone) FROM PUBLIC, anon, authenticated;