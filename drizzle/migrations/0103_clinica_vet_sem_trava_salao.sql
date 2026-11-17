-- 0100 e 0102 chamavam exige_nao_salao(), que barra o veterinário (eh_salao_restrito o inclui); _clinica_vet() já exige o perfil certo.
CREATE OR REPLACE FUNCTION public.clinica_proxima_consulta_opcoes(p_pet_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v uuid := public._clinica_vet(); t uuid := public.current_tenant_id();
BEGIN
 PERFORM public.exige_nao_contador();
 PERFORM 1 FROM public.pets WHERE id=p_pet_id AND tenant_id=t;
 IF NOT FOUND THEN RAISE EXCEPTION 'Paciente não encontrado'; END IF;
 RETURN jsonb_build_object('meu_veterinario',v,
 'profissionais',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'nome',nome) ORDER BY nome),'[]'::jsonb) FROM public.pet_profissionais WHERE tenant_id=t AND ativo AND funcao='veterinario' AND crmv IS NOT NULL),
 'servicos',public.clinica_servicos_consulta(),
 'consultas',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'inicio',a.inicio,'veterinario',pf.nome,'situacao',a.situacao) ORDER BY a.inicio),'[]'::jsonb) FROM public.pet_agendamentos a JOIN public.pet_profissionais pf ON pf.id=a.profissional_id WHERE a.tenant_id=t AND a.pet_id=p_pet_id AND a.inicio>=now() AND a.situacao IN ('agendado','confirmado') AND EXISTS(SELECT 1 FROM public.pet_agendamento_itens i JOIN public.pet_servicos s ON s.id=i.servico_id WHERE i.agendamento_id=a.id AND s.categoria='consulta')));
END $$;
REVOKE ALL ON FUNCTION public.clinica_proxima_consulta_opcoes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_proxima_consulta_opcoes(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.clinica_proxima_consulta_agendar(p_chave uuid,p_dados jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v uuid := public._clinica_vet(); t uuid := public.current_tenant_id(); pt public.pets%ROWTYPE; pf public.pet_profissionais%ROWTYPE; sv public.pet_servicos%ROWTYPE; ini timestamptz; fim timestamptz; preco numeric; ag uuid; r jsonb;
BEGIN
 PERFORM public.exige_nao_contador();
 r := public._clinica_op_repetida(p_chave,'proxima_consulta'); IF r IS NOT NULL THEN RETURN r; END IF;
 ini := nullif(p_dados->>'inicio','')::timestamptz;
 IF ini IS NULL OR ini<=now() THEN RAISE EXCEPTION 'Escolha uma data e horário futuros'; END IF;
 SELECT * INTO pt FROM public.pets WHERE id=(p_dados->>'pet_id')::uuid AND tenant_id=t AND ativo AND NOT obito;
 IF NOT FOUND THEN RAISE EXCEPTION 'Paciente não encontrado ou indisponível para agendamento'; END IF;
 SELECT * INTO pf FROM public.pet_profissionais WHERE id=(p_dados->>'profissional_id')::uuid AND tenant_id=t AND ativo AND funcao='veterinario' AND crmv IS NOT NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Escolha um veterinário ativo com CRMV'; END IF;
 SELECT * INTO sv FROM public.pet_servicos WHERE id=(p_dados->>'servico_id')::uuid AND tenant_id=t AND ativo AND categoria='consulta';
 IF NOT FOUND THEN RAISE EXCEPTION 'Escolha um serviço de consulta ativo'; END IF;
 SELECT p.preco INTO preco FROM public.pet_servico_precos p WHERE p.tenant_id=t AND p.servico_id=sv.id AND (p.porte IS NULL OR p.porte=pt.porte) AND (p.raca IS NULL OR lower(btrim(p.raca))=lower(btrim(coalesce(pt.raca,'')))) AND (p.pelagem IS NULL OR p.pelagem=pt.pelagem) ORDER BY (CASE WHEN p.raca IS NOT NULL THEN 4 ELSE 0 END + CASE WHEN p.pelagem IS NOT NULL THEN 2 ELSE 0 END + CASE WHEN p.porte IS NOT NULL THEN 1 ELSE 0 END) DESC LIMIT 1;
 IF preco IS NULL THEN RAISE EXCEPTION 'O serviço não tem preço cadastrado para este paciente: peça à gestão'; END IF;
 fim := ini+make_interval(mins=>sv.duracao_min);
 PERFORM pg_advisory_xact_lock(hashtextextended('pet_agenda:'||pf.id::text,0));
 IF public._pet_conflito(pf.id,ini,fim,NULL) THEN RAISE EXCEPTION '% já tem atendimento neste horário',pf.nome; END IF;
 INSERT INTO public.pet_agendamentos(tenant_id,filial_id,pet_id,cliente_id,profissional_id,inicio,fim,observacoes) VALUES(t,pf.filial_id,pt.id,pt.cliente_id,pf.id,ini,fim,nullif(btrim(p_dados->>'observacoes'),'')) RETURNING id INTO ag;
 INSERT INTO public.pet_agendamento_itens(tenant_id,agendamento_id,servico_id,preco_aplicado,duracao_min) VALUES(t,ag,sv.id,preco,sv.duracao_min);
 r := jsonb_build_object('agendamento_id',ag,'inicio',ini,'veterinario',pf.nome);
 INSERT INTO public.clinica_operacoes_offline(chave,tenant_id,tipo,resultado) VALUES(p_chave,t,'proxima_consulta',r);
 RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.clinica_proxima_consulta_agendar(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_proxima_consulta_agendar(uuid,jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.clinica_consulta_data_alterar(p_id uuid, p_data date, p_motivo text DEFAULT '', p_data_anterior date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE v_vet uuid := public._clinica_vet(); a public.pet_atendimentos_clinicos%ROWTYPE; anterior date; motivo text := btrim(coalesce(p_motivo,''));
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
