ALTER TABLE public.wa_config
  ADD COLUMN IF NOT EXISTS reforco_dias_antes integer NOT NULL DEFAULT 3 CHECK (reforco_dias_antes BETWEEN 0 AND 30),
  ADD COLUMN IF NOT EXISTS reforco_dias_atraso integer NOT NULL DEFAULT 7 CHECK (reforco_dias_atraso BETWEEN 0 AND 60),
  ADD COLUMN IF NOT EXISTS retorno_dias_antes integer NOT NULL DEFAULT 2 CHECK (retorno_dias_antes BETWEEN 0 AND 30);

CREATE OR REPLACE FUNCTION public.clinica_wa_regras_salvar(p_reforco boolean, p_retorno boolean, p_reforco_antes integer, p_reforco_atraso integer, p_retorno_antes integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_tenant uuid := public.current_tenant_id();
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'veterinario']);
  IF NOT public.clinica_liberada() THEN RAISE EXCEPTION 'A clínica não está liberada para esta empresa'; END IF;
  IF p_reforco_antes NOT BETWEEN 0 AND 30 OR p_retorno_antes NOT BETWEEN 0 AND 30 THEN RAISE EXCEPTION 'Dias antes: de 0 a 30'; END IF;
  IF p_reforco_atraso NOT BETWEEN 0 AND 60 THEN RAISE EXCEPTION 'Dias de atraso: de 0 a 60'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.wa_config WHERE tenant_id = v_tenant AND estado = 'conectada') THEN
    RAISE EXCEPTION 'Conecte o WhatsApp da empresa antes de configurar o envio automático';
  END IF;
  UPDATE public.wa_config
     SET auto_reforco = coalesce(p_reforco, false), auto_retorno = coalesce(p_retorno, false),
         reforco_dias_antes = p_reforco_antes, reforco_dias_atraso = p_reforco_atraso, retorno_dias_antes = p_retorno_antes,
         atualizado_em = now()
   WHERE tenant_id = v_tenant;
END $fn$;
REVOKE ALL ON FUNCTION public.clinica_wa_regras_salvar(boolean, boolean, integer, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_wa_regras_salvar(boolean, boolean, integer, integer, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.wa_auto_varrer()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  c record; r record;
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_total integer := 0;
BEGIN
  FOR c IN SELECT * FROM public.wa_config WHERE estado = 'conectada' AND (auto_pronto OR auto_plano OR auto_reforco OR auto_retorno) LOOP
    IF c.auto_pronto THEN
      FOR r IN SELECT o.id FROM public.lr_ordens o
                WHERE o.tenant_id = c.tenant_id AND o.situacao = 'pronto' AND o.pronto_em >= coalesce(c.auto_desde, now()) AND o.pronto_em >= now() - interval '1 day'
                  AND NOT EXISTS (SELECT 1 FROM public.lr_contatos k WHERE k.tenant_id = c.tenant_id AND k.tipo = 'pronto' AND k.referencia = o.id::text)
                  AND NOT EXISTS (SELECT 1 FROM public.wa_mensagens m WHERE m.tenant_id = c.tenant_id AND m.tipo = 'pronto' AND m.referencia = o.id::text)
                ORDER BY o.pronto_em LIMIT 50 LOOP
        IF public._wa_enfileirar(c.tenant_id, 'pronto', r.id::text, 'automatico', NULL, false) IS NOT NULL THEN v_total := v_total + 1; END IF;
      END LOOP;
    END IF;
    IF c.auto_plano THEN
      FOR r IN SELECT a.id FROM public.lr_assinaturas a
                WHERE a.tenant_id = c.tenant_id AND a.situacao = 'ativa' AND a.vence_em BETWEEN v_hoje AND v_hoje + 3
                  AND NOT EXISTS (SELECT 1 FROM public.lr_assinaturas b WHERE b.veiculo_id = a.veiculo_id AND b.situacao = 'ativa' AND b.vence_em > a.vence_em)
                  AND NOT EXISTS (SELECT 1 FROM public.lr_contatos k WHERE k.tenant_id = c.tenant_id AND k.tipo = 'plano_vencendo' AND k.referencia = a.id::text)
                  AND NOT EXISTS (SELECT 1 FROM public.wa_mensagens m WHERE m.tenant_id = c.tenant_id AND m.tipo = 'plano_vencendo' AND m.referencia = a.id::text)
                ORDER BY a.vence_em LIMIT 50 LOOP
        IF public._wa_enfileirar(c.tenant_id, 'plano_vencendo', r.id::text, 'automatico', NULL, false) IS NOT NULL THEN v_total := v_total + 1; END IF;
      END LOOP;
    END IF;
    IF (c.auto_reforco OR c.auto_retorno) AND public._wa_clinica_liberada(c.tenant_id) THEN
      IF c.auto_reforco THEN
        FOR r IN SELECT q.pet_id, q.ref
                  FROM (
                    SELECT DISTINCT ON (v.pet_id, v.catalogo_id) v.pet_id, v.proxima_dose_em AS ref
                      FROM public.pet_vacinacoes v
                      JOIN public.pets p ON p.id = v.pet_id
                      JOIN public.pet_vacinas_catalogo k ON k.id = v.catalogo_id AND k.ativo
                     WHERE v.tenant_id = c.tenant_id AND v.situacao = 'ativa' AND p.ativo
                     ORDER BY v.pet_id, v.catalogo_id, v.aplicada_em DESC, v.created_at DESC
                  ) q
                 WHERE q.ref IS NOT NULL AND q.ref BETWEEN v_hoje - c.reforco_dias_atraso AND v_hoje + c.reforco_dias_antes
                   AND NOT EXISTS (SELECT 1 FROM public.pet_contatos t WHERE t.pet_id = q.pet_id AND t.tipo = 'reforco' AND t.referencia = q.ref)
                   AND NOT EXISTS (SELECT 1 FROM public.wa_mensagens m WHERE m.tenant_id = c.tenant_id AND m.tipo = 'reforco_vacina'
                                     AND m.referencia = q.pet_id::text || ':' || q.ref::text)
                   AND NOT EXISTS (SELECT 1 FROM public.pet_agendamentos a
                                     JOIN public.pet_agendamento_itens i ON i.agendamento_id = a.id
                                     JOIN public.pet_servicos s ON s.id = i.servico_id
                                    WHERE a.pet_id = q.pet_id AND s.categoria = 'vacina'
                                      AND a.situacao IN ('agendado', 'confirmado', 'em_atendimento') AND a.inicio >= now() - interval '1 day')
                 ORDER BY q.ref LIMIT 50 LOOP
          IF public._wa_enfileirar(c.tenant_id, 'reforco_vacina', r.pet_id::text || ':' || r.ref::text, 'automatico', NULL, false) IS NOT NULL THEN
            v_total := v_total + 1;
          END IF;
        END LOOP;
      END IF;
      IF c.auto_retorno THEN
        FOR r IN SELECT a.id FROM public.pet_atendimentos_clinicos a
                  JOIN public.pets p ON p.id = a.pet_id
                 WHERE a.tenant_id = c.tenant_id AND a.situacao = 'fechado' AND a.retorno_em BETWEEN v_hoje AND v_hoje + c.retorno_dias_antes AND p.ativo
                   AND NOT EXISTS (SELECT 1 FROM public.wa_mensagens m WHERE m.tenant_id = c.tenant_id AND m.tipo = 'retorno_consulta' AND m.referencia = a.id::text)
                 ORDER BY a.retorno_em LIMIT 50 LOOP
          IF public._wa_enfileirar(c.tenant_id, 'retorno_consulta', r.id::text, 'automatico', NULL, false) IS NOT NULL THEN
            v_total := v_total + 1;
          END IF;
        END LOOP;
      END IF;
    END IF;
  END LOOP;
  RETURN v_total;
END $fn$;
REVOKE ALL ON FUNCTION public.wa_auto_varrer() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_auto_varrer() TO service_role;