CREATE OR REPLACE FUNCTION public.clinica_painel_pacientes(p_de date, p_ate date, p_busca text DEFAULT '', p_pagina integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_t uuid := public.current_tenant_id(); v_ini timestamptz; v_fim timestamptz;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_nao_contador();
  PERFORM public.exige_papel(ARRAY['administrador','gestor']);
  IF NOT public.clinica_liberada() THEN RAISE EXCEPTION 'A clínica não está liberada para esta empresa'; END IF;
  IF p_de IS NULL OR p_ate IS NULL OR p_ate < p_de OR p_ate-p_de > 366 OR p_pagina IS NULL OR p_pagina < 0 OR p_pagina > 100000 THEN RAISE EXCEPTION 'Período ou página inválidos'; END IF;
  v_ini := p_de::timestamp AT TIME ZONE 'America/Sao_Paulo';
  v_fim := (p_ate+1)::timestamp AT TIME ZONE 'America/Sao_Paulo';
  RETURN (WITH visitas AS (
    SELECT a.id,a.pet_id,a.aberto_em AS data,a.situacao,v.nome AS veterinario
    FROM public.pet_atendimentos_clinicos a LEFT JOIN public.pet_profissionais v ON v.id=a.veterinario_id AND v.tenant_id=v_t
    WHERE a.tenant_id=v_t AND a.aberto_em >= v_ini AND a.aberto_em < v_fim
  ), exames AS (
    SELECT e.id,e.pet_id,e.nome AS nome,e.aberto_em AS data,e.situacao,'registro'::text AS origem,v.nome AS veterinario
    FROM public.pet_exames e LEFT JOIN public.pet_profissionais v ON v.id=e.veterinario_id AND v.tenant_id=v_t
    WHERE e.tenant_id=v_t AND e.aberto_em >= v_ini AND e.aberto_em < v_fim
    UNION ALL
    SELECT e.id,e.pet_id,e.exame,e.agendado_para,e.situacao,'agenda',v.nome
    FROM public.pet_exame_agenda e LEFT JOIN public.pet_profissionais v ON v.id=e.veterinario_id AND v.tenant_id=v_t
    WHERE e.tenant_id=v_t AND e.agendado_para >= v_ini AND e.agendado_para < v_fim
  ), pacientes AS (
    SELECT p.id,p.nome,p.especie,p.raca,c.nome AS tutor
    FROM public.pets p LEFT JOIN public.clientes c ON c.id=p.cliente_id AND c.tenant_id=v_t
    WHERE p.tenant_id=v_t
      AND (EXISTS(SELECT 1 FROM visitas a WHERE a.pet_id=p.id) OR EXISTS(SELECT 1 FROM exames e WHERE e.pet_id=p.id))
      AND (coalesce(btrim(p_busca),'')='' OR strpos(lower(p.nome),lower(btrim(p_busca)))>0 OR strpos(lower(coalesce(c.nome,'')),lower(btrim(p_busca)))>0)
  ), pagina AS (SELECT * FROM pacientes ORDER BY nome,id LIMIT 20 OFFSET p_pagina*20)
  SELECT jsonb_build_object('total',(SELECT count(*) FROM pacientes),'pacientes',coalesce((
    SELECT jsonb_agg(jsonb_build_object('id',p.id,'nome',p.nome,'especie',p.especie,'raca',p.raca,'tutor',p.tutor,
      'visitas',coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'data',a.data,'situacao',a.situacao,'veterinario',a.veterinario) ORDER BY a.data DESC,a.id) FROM visitas a WHERE a.pet_id=p.id),'[]'::jsonb),
      'exames',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'nome',e.nome,'data',e.data,'situacao',e.situacao,'origem',e.origem,'veterinario',e.veterinario) ORDER BY e.data DESC,e.id) FROM exames e WHERE e.pet_id=p.id),'[]'::jsonb)
    ) ORDER BY p.nome,p.id) FROM pagina p),'[]'::jsonb)));
END $$;
REVOKE ALL ON FUNCTION public.clinica_painel_pacientes(date,date,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.clinica_painel_pacientes(date,date,text,integer) TO authenticated;
COMMENT ON FUNCTION public.clinica_painel_pacientes(date,date,text,integer) IS 'Acompanhamento administrativo por empresa: somente datas, nomes e situações; não retorna texto clínico nem resultados.';