-- Leitura apenas: verifica as funções instaladas sem alterar pacientes reais.
DO $$
DECLARE
  info text := pg_get_functiondef('public.clinica_atendimento_corrigir(uuid,jsonb,text)'::regprocedure);
  data_fn text := pg_get_functiondef('public.clinica_consulta_data_alterar(uuid,date,text,date)'::regprocedure);
  leitura text := pg_get_functiondef('public._clinica_atendimento_json(uuid)'::regprocedure);
BEGIN
  IF info LIKE '%INSERT INTO public.pet_atendimento_adendos%' THEN
    RAISE EXCEPTION 'Editar informações não pode acrescentar histórico';
  END IF;
  IF data_fn LIKE '%INSERT INTO public.pet_atendimento_adendos%' THEN
    RAISE EXCEPTION 'Editar data não pode acrescentar histórico';
  END IF;
  IF info NOT LIKE '%UPDATE public.pet_atendimentos_clinicos SET%' OR data_fn NOT LIKE '%data_consulta_editada=p_data%' THEN
    RAISE EXCEPTION 'Edições devem atualizar a própria consulta';
  END IF;
  IF leitura NOT LIKE '%coalesce(a.data_consulta_editada,%' THEN
    RAISE EXCEPTION 'Data editada deve prevalecer sobre correções antigas';
  END IF;
  IF info NOT LIKE '%a.veterinario_id <> v_vet%' OR data_fn NOT LIKE '%a.veterinario_id <> v_vet%'
    OR info NOT LIKE '%tenant_id = public.current_tenant_id()%' OR data_fn NOT LIKE '%tenant_id=public.current_tenant_id()%' THEN
    RAISE EXCEPTION 'Edição deve manter autorização e isolamento';
  END IF;
  IF has_function_privilege('anon','public.clinica_atendimento_corrigir(uuid,jsonb,text)','EXECUTE')
    OR has_function_privilege('anon','public.clinica_consulta_data_alterar(uuid,date,text,date)','EXECUTE') THEN
    RAISE EXCEPTION 'Visitante não pode editar consulta';
  END IF;
END $$;