-- Correção da CI (17/11/2026): clinica_wa_regras_salvar (regras de envio automático do WhatsApp da clínica)
-- estava sem a trava do contador exigida pelo smoke.sql. O contador é um perfil de leitura fiscal e não
-- deve alterar regras de envio. Mesma função, mesmas permissões; só acrescenta exige_nao_contador().

CREATE OR REPLACE FUNCTION public.clinica_wa_regras_salvar(p_reforco boolean, p_retorno boolean, p_reforco_antes integer, p_reforco_atraso integer, p_retorno_antes integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_tenant uuid := public.current_tenant_id();
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_nao_contador();
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
