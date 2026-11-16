ALTER TABLE public.pet_atendimentos_clinicos ADD COLUMN IF NOT EXISTS data_atendimento date;
COMMENT ON COLUMN public.pet_atendimentos_clinicos.data_atendimento IS 'Data clínica editável enquanto aberto; aberto_em preserva a abertura original.';
DO $$
DECLARE d text;
BEGIN
 d := pg_get_functiondef('public._clinica_atendimento_json(uuid)'::regprocedure);
 IF position('''data_atendimento''' in d)=0 THEN
  d := replace(d, '''aberto_em'', a.aberto_em,', '''data_atendimento'', coalesce(a.data_atendimento, (a.aberto_em AT TIME ZONE ''America/Sao_Paulo'')::date), ''aberto_em'', a.aberto_em,');
  EXECUTE d;
 END IF;
 d := pg_get_functiondef('public.clinica_atendimento_salvar(uuid,jsonb)'::regprocedure);
 IF position('data_atendimento =' in d)=0 THEN
  d := replace(d, 'UPDATE public.pet_atendimentos_clinicos SET', 'IF nullif(p_dados ->> ''data_atendimento'', '''') IS NOT NULL THEN
    IF (p_dados ->> ''data_atendimento'')::date > (now() AT TIME ZONE ''America/Sao_Paulo'')::date THEN RAISE EXCEPTION ''A data do atendimento não pode ser no futuro''; END IF;
    IF EXISTS (SELECT 1 FROM public.pets pt WHERE pt.id=a.pet_id AND pt.tenant_id=a.tenant_id AND pt.nascimento > (p_dados ->> ''data_atendimento'')::date) THEN RAISE EXCEPTION ''O atendimento não pode ser anterior ao nascimento do paciente''; END IF;
  END IF;
  UPDATE public.pet_atendimentos_clinicos SET
      data_atendimento = coalesce(nullif(p_dados ->> ''data_atendimento'', '''')::date, a.data_atendimento),');
  EXECUTE d;
 END IF;
 d := pg_get_functiondef('public.clinica_pacientes_atendidos(integer)'::regprocedure);
 d := replace(d, 'max(a.aberto_em)', 'max(coalesce(a.data_atendimento::timestamp AT TIME ZONE ''America/Sao_Paulo'', a.aberto_em))');
 EXECUTE d;
 d := pg_get_functiondef('public.clinica_historico(uuid)'::regprocedure);
 d := replace(d, 'ORDER BY a.aberto_em DESC', 'ORDER BY coalesce(a.data_atendimento, (a.aberto_em AT TIME ZONE ''America/Sao_Paulo'')::date) DESC, a.aberto_em DESC');
 EXECUTE d;
 d := pg_get_functiondef('public.clinica_vacina_catalogo_salvar(jsonb)'::regprocedure);
 IF position('confirmar_controle_lote' in d)=0 THEN
  d := replace(d, 'PERFORM 1 FROM public.produtos WHERE id = v_prod', 'IF coalesce((p_dados ->> ''confirmar_controle_lote'')::boolean, false) THEN
    UPDATE public.produtos SET controla_estoque=true, controla_lote=true WHERE id=v_prod AND tenant_id=v_tenant AND ativo;
    IF NOT FOUND THEN RAISE EXCEPTION ''Produto ativo não encontrado nesta empresa''; END IF;
  END IF;
  PERFORM 1 FROM public.produtos WHERE id = v_prod');
  EXECUTE d;
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.clinica_vacina_produtos() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM public.exige_nao_contador();
 PERFORM public.exige_papel(ARRAY['administrador','gestor','veterinario']);
 IF NOT public.clinica_liberada() THEN RAISE EXCEPTION 'A clínica não está liberada para esta empresa'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'descricao',p.descricao,'codigo_interno',p.codigo_interno,'controla_estoque',p.controla_estoque,'controla_lote',p.controla_lote) ORDER BY p.descricao) FROM public.produtos p WHERE p.tenant_id=public.current_tenant_id() AND p.ativo), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.clinica_vacina_produtos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_vacina_produtos() TO authenticated, service_role;