CREATE OR REPLACE FUNCTION public.clinica_pacientes_atendidos(p_pagina integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_t uuid := public.current_tenant_id();
BEGIN
  PERFORM public.exige_nao_contador();
  PERFORM public._clinica_vet();
  IF p_pagina IS NULL OR p_pagina < 0 OR p_pagina > 100000 THEN RAISE EXCEPTION 'Página inválida'; END IF;
  RETURN (WITH pacientes AS (
    SELECT p.id,p.nome,p.especie,p.raca,c.nome AS tutor,count(a.id)::integer AS atendimentos,max(a.aberto_em) AS ultimo_atendimento,bool_or(a.situacao='aberto') AS em_atendimento
    FROM public.pets p
    JOIN public.pet_atendimentos_clinicos a ON a.pet_id=p.id AND a.tenant_id=v_t
    LEFT JOIN public.clientes c ON c.id=p.cliente_id AND c.tenant_id=v_t
    WHERE p.tenant_id=v_t
    GROUP BY p.id,p.nome,p.especie,p.raca,c.nome
  ), pagina AS (SELECT * FROM pacientes ORDER BY ultimo_atendimento DESC,id LIMIT 24 OFFSET p_pagina*24)
  SELECT jsonb_build_object('total',(SELECT count(*) FROM pacientes),'pacientes',coalesce((
    SELECT jsonb_agg(to_jsonb(pagina) || jsonb_build_object('proxima_consulta', (
      SELECT min(ag.inicio) FROM public.pet_agendamentos ag
      WHERE ag.tenant_id=v_t AND ag.pet_id=pagina.id AND ag.inicio >= now()
        AND ag.situacao IN ('agendado','confirmado')
        AND EXISTS (SELECT 1 FROM public.pet_agendamento_itens i
          JOIN public.pet_servicos s ON s.id=i.servico_id AND s.tenant_id=v_t
          WHERE i.agendamento_id=ag.id AND i.tenant_id=v_t AND s.categoria='consulta')
    )) ORDER BY ultimo_atendimento DESC,id) FROM pagina),'[]'::jsonb)));
END $$;
REVOKE ALL ON FUNCTION public.clinica_pacientes_atendidos(integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.clinica_pacientes_atendidos(integer) TO authenticated;
COMMENT ON FUNCTION public.clinica_pacientes_atendidos(integer) IS 'Lista veterinária por empresa: visitas e próxima consulta futura agendada ou confirmada; não retorna texto clínico.';