ALTER TABLE public.pet_atendimento_adendos ADD COLUMN IF NOT EXISTS data_consulta date;
COMMENT ON COLUMN public.pet_atendimento_adendos.data_consulta IS 'Correção imutável da data clínica de consulta fechada, com motivo no texto.';
CREATE OR REPLACE FUNCTION public.clinica_consulta_data_alterar(p_id uuid, p_data date, p_motivo text DEFAULT '', p_data_anterior date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE v_vet uuid := public._clinica_vet(); a public.pet_atendimentos_clinicos%ROWTYPE; anterior date; motivo text := btrim(coalesce(p_motivo,''));
BEGIN
 PERFORM public.exige_nao_contador();
 PERFORM public.exige_nao_salao();
 SELECT * INTO a FROM public.pet_atendimentos_clinicos WHERE id=p_id AND tenant_id=public.current_tenant_id() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Atendimento não encontrado'; END IF;
 IF a.veterinario_id <> v_vet THEN RAISE EXCEPTION 'Só o veterinário responsável altera a data da consulta'; END IF;
 IF p_data IS NULL THEN RAISE EXCEPTION 'Informe a data da consulta'; END IF;
 IF p_data > (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN RAISE EXCEPTION 'A data do atendimento não pode ser no futuro'; END IF;
 IF EXISTS(SELECT 1 FROM public.pets WHERE id=a.pet_id AND tenant_id=a.tenant_id AND nascimento>p_data) THEN RAISE EXCEPTION 'O atendimento não pode ser anterior ao nascimento do paciente'; END IF;
 anterior := (public._clinica_atendimento_json(a.id)->>'data_atendimento')::date;
 IF p_data=anterior THEN RETURN public._clinica_atendimento_json(a.id); END IF;
 IF p_data_anterior IS NULL OR p_data_anterior IS DISTINCT FROM anterior THEN RAISE EXCEPTION 'A data foi atualizada; reabra a consulta antes de alterar'; END IF;
 IF a.situacao='fechado' THEN
  IF motivo='' THEN RAISE EXCEPTION 'Informe o motivo da correção'; END IF;
  IF length(motivo)>2000 THEN RAISE EXCEPTION 'O motivo aceita até 2000 caracteres'; END IF;
  INSERT INTO public.pet_atendimento_adendos(tenant_id,atendimento_id,veterinario_id,crmv,crmv_uf,texto,data_consulta)
  VALUES(a.tenant_id,a.id,v_vet,a.crmv,a.crmv_uf,'Correção da data da consulta: '||to_char(anterior,'DD/MM/YYYY')||' → '||to_char(p_data,'DD/MM/YYYY')||'. Motivo: '||motivo,p_data);
 ELSE
  UPDATE public.pet_atendimentos_clinicos SET data_atendimento=p_data WHERE id=a.id AND tenant_id=a.tenant_id;
 END IF;
 RETURN public._clinica_atendimento_json(a.id);
END $$;
REVOKE ALL ON FUNCTION public.clinica_consulta_data_alterar(uuid,date,text,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.clinica_consulta_data_alterar(uuid,date,text,date) TO authenticated;
DO $$ DECLARE d text; BEGIN
 d := pg_get_functiondef('public._clinica_atendimento_json(uuid)'::regprocedure);
 d := replace(d,'coalesce(a.data_atendimento, (a.aberto_em AT TIME ZONE ''America/Sao_Paulo'')::date)', 'coalesce((SELECT d.data_consulta FROM public.pet_atendimento_adendos d WHERE d.atendimento_id=a.id AND d.tenant_id=a.tenant_id AND d.data_consulta IS NOT NULL ORDER BY d.created_at DESC,d.id DESC LIMIT 1), a.data_atendimento, (a.aberto_em AT TIME ZONE ''America/Sao_Paulo'')::date)');
 EXECUTE d;
END $$;