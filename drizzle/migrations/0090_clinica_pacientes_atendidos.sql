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
  SELECT jsonb_build_object('total',(SELECT count(*) FROM pacientes),'pacientes',coalesce((SELECT jsonb_agg(to_jsonb(pagina) ORDER BY ultimo_atendimento DESC,id) FROM pagina),'[]'::jsonb)));
END $$;
REVOKE ALL ON FUNCTION public.clinica_pacientes_atendidos(integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.clinica_pacientes_atendidos(integer) TO authenticated;
COMMENT ON FUNCTION public.clinica_pacientes_atendidos(integer) IS 'Lista paginada de todos os pacientes com atendimento da empresa, sem texto clínico e com o mesmo acesso veterinário do prontuário.';