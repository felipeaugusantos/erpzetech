ALTER TABLE public.pet_atendimentos_clinicos ADD COLUMN IF NOT EXISTS data_consulta_editada date;
COMMENT ON COLUMN public.pet_atendimentos_clinicos.data_consulta_editada IS 'Data editada diretamente, com precedência sobre adendos antigos de data.';
DO $migration$
DECLARE d text; original text;
BEGIN
 d := pg_get_functiondef('public.clinica_atendimento_corrigir(uuid,jsonb,text)'::regprocedure);
 original := d;
 d := replace(d, ' IF motivo = '''' THEN RAISE EXCEPTION ''Informe o motivo da correção''; END IF;', '');
 d := replace(d, ' IF length(motivo) > 2000 THEN RAISE EXCEPTION ''O motivo aceita até 2000 caracteres''; END IF;', '');
 d := regexp_replace(d, ' INSERT INTO public\.pet_atendimento_adendos\(tenant_id, atendimento_id, veterinario_id, crmv, crmv_uf, texto, anterior, correcao\)[[:space:]]+VALUES[^;]+;', '', 'g');
 IF d = original OR position('INSERT INTO public.pet_atendimento_adendos' in d)>0 OR position('IF motivo = ' in d)>0 THEN RAISE EXCEPTION 'Não foi possível ajustar a edição de consulta'; END IF;
 EXECUTE d;
 d := pg_get_functiondef('public._clinica_atendimento_json(uuid)'::regprocedure);
 IF position('coalesce(a.data_consulta_editada,' in d)=0 THEN
  original := d;
  d := replace(d, '''data_atendimento'', coalesce(', '''data_atendimento'', coalesce(a.data_consulta_editada,');
  IF d=original THEN RAISE EXCEPTION 'Não foi possível ajustar a leitura da data'; END IF;
  EXECUTE d;
 END IF;
END $migration$;
CREATE OR REPLACE FUNCTION public.clinica_consulta_data_alterar(p_id uuid, p_data date, p_motivo text DEFAULT '', p_data_anterior date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $function$
DECLARE v_vet uuid := public._clinica_vet(); a public.pet_atendimentos_clinicos%ROWTYPE; anterior date;
BEGIN
 PERFORM public.exige_nao_contador();
 SELECT * INTO a FROM public.pet_atendimentos_clinicos WHERE id=p_id AND tenant_id=public.current_tenant_id() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Atendimento não encontrado'; END IF;
 IF a.veterinario_id <> v_vet THEN RAISE EXCEPTION 'Só o veterinário responsável altera a data da consulta'; END IF;
 IF p_data IS NULL THEN RAISE EXCEPTION 'Informe a data da consulta'; END IF;
 IF p_data > (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN RAISE EXCEPTION 'A data do atendimento não pode ser no futuro'; END IF;
 IF EXISTS(SELECT 1 FROM public.pets WHERE id=a.pet_id AND tenant_id=a.tenant_id AND nascimento>p_data) THEN RAISE EXCEPTION 'O atendimento não pode ser anterior ao nascimento do paciente'; END IF;
 anterior := (public._clinica_atendimento_json(a.id)->>'data_atendimento')::date;
 IF p_data=anterior THEN RETURN public._clinica_atendimento_json(a.id); END IF;
 IF p_data_anterior IS NULL OR p_data_anterior IS DISTINCT FROM anterior THEN RAISE EXCEPTION 'A data foi atualizada; reabra a consulta antes de alterar'; END IF;
 PERFORM set_config('app.clinica_correcao', a.id::text, true);
 UPDATE public.pet_atendimentos_clinicos SET data_atendimento=p_data, data_consulta_editada=p_data WHERE id=a.id AND tenant_id=a.tenant_id;
 PERFORM set_config('app.clinica_correcao', '', true);
 RETURN public._clinica_atendimento_json(a.id);
END $function$;
REVOKE ALL ON FUNCTION public.clinica_consulta_data_alterar(uuid,date,text,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.clinica_consulta_data_alterar(uuid,date,text,date) TO authenticated;