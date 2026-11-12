CREATE OR REPLACE FUNCTION public.clinica_exame_agenda_do_pet(p_pet_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_tenant uuid := public.current_tenant_id();
BEGIN
  PERFORM public.exige_nao_contador();
  PERFORM public._clinica_vet();
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', a.id, 'exame', a.exame, 'agendado_para', a.agendado_para,
             'situacao', a.situacao, 'observacao', a.observacao, 'veterinario', v.nome) ORDER BY a.agendado_para DESC)
      FROM public.pet_exame_agenda a
      LEFT JOIN public.pet_profissionais v ON v.id = a.veterinario_id
     WHERE a.tenant_id = v_tenant AND a.pet_id = p_pet_id), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.clinica_exame_agenda_do_pet(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_exame_agenda_do_pet(uuid) TO authenticated;