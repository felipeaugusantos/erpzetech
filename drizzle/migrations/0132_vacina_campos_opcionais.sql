ALTER TABLE public.pet_vacinacoes DROP CONSTRAINT pet_vacinacoes_check1;
ALTER TABLE public.pet_vacinacoes ADD CONSTRAINT pet_vacinacoes_check1 CHECK (origem <> 'clinica' OR (agendamento_id IS NOT NULL AND veterinario_id IS NOT NULL));

-- Rewrite the installed definitions while preserving all current access and inventory guards.
DO $migration$
DECLARE definition text;
BEGIN
  definition := pg_get_functiondef('public.clinica_vacina_aplicar(uuid,jsonb)'::regprocedure);
  IF position('Este agendamento não tem serviço de vacina' IN definition) = 0 OR position('Informe o vencimento do lote' IN definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected vaccination definition; no changes applied';
  END IF;
  definition := replace(definition, $old$  IF NOT EXISTS (SELECT 1 FROM public.pet_agendamento_itens i JOIN public.pet_servicos s ON s.id = i.servico_id WHERE i.agendamento_id = ag.id AND s.categoria = 'vacina') THEN
    RAISE EXCEPTION 'Este agendamento não tem serviço de vacina';
  END IF;
$old$, '');
  definition := replace(definition, $old$    IF v_lote_texto IS NULL THEN RAISE EXCEPTION 'Informe o lote da vacina'; END IF;
$old$, '');
  definition := replace(definition, $old$    IF v_validade IS NULL THEN RAISE EXCEPTION 'Informe o vencimento do lote'; END IF;
$old$, '');
  IF position('Este agendamento não tem serviço de vacina' IN definition) > 0 OR position('Informe o lote da vacina' IN definition) > 0 OR position('Informe o vencimento do lote' IN definition) > 0 THEN
    RAISE EXCEPTION 'Vaccination optional-field rewrite failed';
  END IF;
  EXECUTE definition;

  definition := pg_get_functiondef('public._clinica_agendamento_avulso(uuid,uuid,text,timestamp with time zone)'::regprocedure);
  IF position('SELECT * INTO pf FROM public.pet_profissionais WHERE id = v_vet;' IN definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected appointment definition';
  END IF;
  definition := replace(definition,
    'SELECT * INTO pf FROM public.pet_profissionais WHERE id = v_vet;',
    $new$SELECT * INTO pf FROM public.pet_profissionais WHERE id = v_vet;
  -- No charged service: create only the veterinarian's visit, never a billing item.
  IF p_servico IS NULL AND p_categoria = 'vacina' THEN
    INSERT INTO public.pet_agendamentos (tenant_id, filial_id, pet_id, cliente_id, profissional_id, inicio, fim, situacao, observacoes)
    VALUES (v_tenant, pf.filial_id, pt.id, pt.cliente_id, v_vet, p_inicio, p_inicio, 'em_atendimento', 'Aplicação de vacina sem serviço cobrado')
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;$new$);
  EXECUTE definition;

  definition := pg_get_functiondef('public.clinica_vacina_offline(uuid,text,jsonb)'::regprocedure);
  IF position('(v_ag IS NULL) = (v_pet IS NULL OR v_serv IS NULL)' IN definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected offline vaccination definition';
  END IF;
  definition := replace(definition, '(v_ag IS NULL) = (v_pet IS NULL OR v_serv IS NULL)', '(v_ag IS NULL) = (v_pet IS NULL)');
  definition := replace(definition, 'Informe a consulta de vacina da agenda ou o paciente com o serviço de vacina (só um dos dois)', 'Informe a consulta da agenda ou o paciente (só um dos dois)');
  EXECUTE definition;
END $migration$;
REVOKE ALL ON FUNCTION public._clinica_agendamento_avulso(uuid,uuid,text,timestamp with time zone) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clinica_vacina_aplicar(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_vacina_aplicar(uuid,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.clinica_vacina_offline(uuid,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_vacina_offline(uuid,text,jsonb) TO authenticated;