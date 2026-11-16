DO $migration$
DECLARE v_def text;
BEGIN
 SELECT pg_get_functiondef('public._clinica_exame_json(uuid)'::regprocedure) INTO v_def;
 IF position('''data_consulta''' in v_def) = 0 THEN
   IF position('''laboratorio'', e.laboratorio' in v_def) = 0 THEN RAISE EXCEPTION 'Formato inesperado do laudo'; END IF;
   v_def := replace(v_def, '''laboratorio'', e.laboratorio', '''data_consulta'', public._clinica_atendimento_json(e.atendimento_id)->>''data_atendimento'', ''laboratorio'', e.laboratorio');
   EXECUTE v_def;
 END IF;
END $migration$;