CREATE OR REPLACE FUNCTION public.clinica_vacinas_painel(p_janela integer DEFAULT 30)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  PERFORM public.exige_nao_contador();
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador','gestor','veterinario','vendedor','caixa']);
  IF NOT public.clinica_liberada() THEN RAISE EXCEPTION 'A clínica não está liberada para esta empresa'; END IF;
  IF p_janela IS NULL OR p_janela < 0 OR p_janela > 365 THEN RAISE EXCEPTION 'A janela precisa ficar entre 0 e 365 dias'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(to_jsonb(q) || jsonb_build_object('dias', q.proxima_dose_em - v_hoje) ORDER BY q.proxima_dose_em, q.pet)
      FROM (
        SELECT DISTINCT ON (v.pet_id, coalesce(v.catalogo_id::text, lower(v.nome)))
               v.pet_id, p.nome AS pet, p.especie, c.id AS cliente_id, c.nome AS tutor,
               coalesce(nullif(btrim(c.whatsapp), ''), c.telefone) AS telefone,
               v.nome AS vacina, v.tipo, v.aplicada_em, v.proxima_dose_em
          FROM public.pet_vacinacoes v
          JOIN public.pets p ON p.id = v.pet_id
          JOIN public.clientes c ON c.id = p.cliente_id
         WHERE v.tenant_id = v_tenant AND v.situacao = 'ativa' AND p.ativo AND NOT coalesce(p.obito, false)
         ORDER BY v.pet_id, coalesce(v.catalogo_id::text, lower(v.nome)), v.aplicada_em DESC, v.created_at DESC
         LIMIT 100000
      ) q
     WHERE q.proxima_dose_em IS NOT NULL AND q.proxima_dose_em <= v_hoje + p_janela
     LIMIT 1000), '[]'::jsonb);
END $function$;
REVOKE ALL ON FUNCTION public.clinica_vacinas_painel(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_vacinas_painel(integer) TO authenticated;