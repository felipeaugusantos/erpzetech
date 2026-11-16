ALTER TABLE public.pet_exames ADD COLUMN IF NOT EXISTS data_emissao date;
COMMENT ON COLUMN public.pet_exames.data_emissao IS 'Data de emissão do laudo original, confirmada pelo veterinário; não inferir de coleta, consulta ou upload.';
DO $migration$
DECLARE d text;
BEGIN
 SELECT pg_get_functiondef('public.clinica_importar_pdf(uuid,uuid,jsonb)'::regprocedure) INTO d;
 IF position('data_emissao' in d)=0 THEN
  d := replace(d, 'linhas := ''[]'';', 'UPDATE public.pet_exames SET data_emissao = nullif(p_dados->>''emissao'','''')::date WHERE id=(e->>''id'')::uuid AND tenant_id=v_tenant;
  linhas := ''[]'';');
  IF position('SET data_emissao' in d)=0 THEN RAISE EXCEPTION 'Importação incompatível'; END IF;
  EXECUTE d;
 END IF;
 SELECT pg_get_functiondef('public._clinica_exame_json(uuid)'::regprocedure) INTO d;
 IF position('''data_emissao''' in d)=0 THEN
  d := replace(d, '''data_consulta'',', '''data_emissao'', e.data_emissao, ''data_consulta'',');
  EXECUTE d;
 END IF;
 SELECT pg_get_functiondef('public.clinica_exames_do_pet(uuid)'::regprocedure) INTO d;
 IF position('''data_emissao''' in d)=0 THEN
  d := replace(d, '''atendimento_id'', e.atendimento_id,', '''data_emissao'', e.data_emissao, ''data_consulta'', public._clinica_atendimento_json(e.atendimento_id)->>''data_atendimento'', ''pdf_importado'', EXISTS (SELECT 1 FROM public.pet_exame_anexos ax WHERE ax.exame_id=e.id AND ax.tenant_id=v_tenant AND ax.situacao=''ativo'' AND ax.mime=''application/pdf'' AND ax.categoria=''laudo''), ''atendimento_id'', e.atendimento_id,');
  IF position('''pdf_importado''' in d)=0 THEN RAISE EXCEPTION 'Histórico incompatível'; END IF;
  EXECUTE d;
 END IF;
END $migration$;