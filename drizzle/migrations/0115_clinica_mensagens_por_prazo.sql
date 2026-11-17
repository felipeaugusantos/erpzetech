ALTER TABLE public.pet_mensagem_modelos DROP CONSTRAINT IF EXISTS pet_mensagem_modelos_tipo_check;
ALTER TABLE public.pet_mensagem_modelos ADD CONSTRAINT pet_mensagem_modelos_tipo_check CHECK (tipo IN ('aniversario','retorno','reforco','confirmacao','pronto','exame','retorno_clinica','vacina_antes','vacina_atrasada','consulta_antes'));
DO $migration$
DECLARE v_def text; v_old text;
BEGIN
 SELECT pg_get_functiondef('public.pet_mensagem_modelo_salvar(text,text)'::regprocedure) INTO v_def;
 v_old := v_def;
 v_def := replace(v_def, 'PERFORM public.exige_papel(ARRAY[''administrador'', ''gestor'']);', 'IF p_tipo IN (''vacina_antes'', ''vacina_atrasada'', ''consulta_antes'') THEN
    PERFORM public.exige_papel(ARRAY[''administrador'', ''gestor'', ''veterinario'']);
    IF NOT public.clinica_liberada() THEN RAISE EXCEPTION ''A clínica não está liberada para esta empresa''; END IF;
  ELSE
    PERFORM public.exige_papel(ARRAY[''administrador'', ''gestor'']);
  END IF;');
 v_def := replace(v_def, '''exame'', ''retorno_clinica'') THEN', '''exame'', ''retorno_clinica'', ''vacina_antes'', ''vacina_atrasada'', ''consulta_antes'') THEN');
 IF v_def = v_old OR position('vacina_atrasada' in v_def) = 0 THEN RAISE EXCEPTION 'Definição inesperada do editor de mensagens'; END IF;
 EXECUTE v_def;
 SELECT pg_get_functiondef('public.wa_reservar(integer,integer,boolean)'::regprocedure) INTO v_def;
 v_old := v_def;
 v_def := replace(v_def, 'mm.tipo = ''reforco'')', 'mm.tipo = CASE WHEN (r.variaveis ->> ''data'')::date < (now() AT TIME ZONE ''America/Sao_Paulo'')::date THEN ''vacina_atrasada'' ELSE ''vacina_antes'' END)');
 v_def := replace(v_def, 'mm.tipo = ''retorno_clinica'')', 'mm.tipo = ''consulta_antes'')');
 IF v_def = v_old OR position('vacina_atrasada' in v_def) = 0 THEN RAISE EXCEPTION 'Definição inesperada da reserva de mensagens'; END IF;
 EXECUTE v_def;
END $migration$;
REVOKE ALL ON FUNCTION public.pet_mensagem_modelo_salvar(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_mensagem_modelo_salvar(text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.wa_reservar(integer,integer,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_reservar(integer,integer,boolean) TO service_role;