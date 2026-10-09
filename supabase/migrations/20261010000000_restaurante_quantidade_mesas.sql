-- Configuração da quantidade de mesas do restaurante.
-- A gestão informa quantas mesas existem; o sistema cria as mesas numeradas de 1 até N (por filial) e,
-- ao reduzir, desativa as que sobram. Mesa com comanda aberta nunca é desativada (a conta não pode
-- ficar inacessível), e mesas com nome próprio (ex.: "Varanda") não são tocadas.
CREATE OR REPLACE FUNCTION public.restaurante_definir_mesas(
  p_quantidade integer,
  p_filial_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.restaurante_contexto(ARRAY['administrador', 'gestor']::public.app_role[]);
  v_criadas integer := 0;
  v_reativadas integer := 0;
  v_desativadas integer := 0;
  v_mantidas integer := 0;
  v_n integer;
  v_linhas integer;
BEGIN
  IF p_quantidade IS NULL OR p_quantidade < 0 OR p_quantidade > 500 THEN
    RAISE EXCEPTION 'Informe uma quantidade de mesas entre 0 e 500';
  END IF;
  IF p_filial_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.filiais WHERE id = p_filial_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Filial não encontrada';
  END IF;

  -- duas configurações ao mesmo tempo não podem criar a mesma mesa duas vezes
  PERFORM pg_advisory_xact_lock(hashtextextended('restaurante_mesas:' || v_tenant::text, 0));

  FOR v_n IN 1..p_quantidade LOOP
    UPDATE public.mesas SET ativa = true
     WHERE tenant_id = v_tenant AND filial_id IS NOT DISTINCT FROM p_filial_id AND numero = v_n::text AND NOT ativa;
    GET DIAGNOSTICS v_linhas = ROW_COUNT;
    v_reativadas := v_reativadas + v_linhas;

    INSERT INTO public.mesas (tenant_id, filial_id, numero)
    SELECT v_tenant, p_filial_id, v_n::text
     WHERE NOT EXISTS (SELECT 1 FROM public.mesas
                        WHERE tenant_id = v_tenant AND filial_id IS NOT DISTINCT FROM p_filial_id AND numero = v_n::text);
    GET DIAGNOSTICS v_linhas = ROW_COUNT;
    v_criadas := v_criadas + v_linhas;
  END LOOP;

  -- mesas numeradas acima da quantidade: desativa as livres e mantém as que têm comanda aberta
  WITH sobra AS (
    SELECT m.id,
           EXISTS (SELECT 1 FROM public.comandas c WHERE c.mesa_id = m.id AND c.situacao = 'aberta') AS ocupada
      FROM public.mesas m
     WHERE m.tenant_id = v_tenant AND m.filial_id IS NOT DISTINCT FROM p_filial_id AND m.ativa
       AND (CASE WHEN m.numero ~ '^[0-9]{1,9}$' THEN m.numero::integer END) > p_quantidade
  ), desativa AS (
    UPDATE public.mesas SET ativa = false WHERE id IN (SELECT id FROM sobra WHERE NOT ocupada) RETURNING 1
  )
  SELECT (SELECT count(*) FROM desativa), (SELECT count(*) FROM sobra WHERE ocupada)
    INTO v_desativadas, v_mantidas;

  RETURN jsonb_build_object('criadas', v_criadas, 'reativadas', v_reativadas,
                            'desativadas', v_desativadas, 'mantidas_ocupadas', v_mantidas);
END;
$$;

REVOKE ALL ON FUNCTION public.restaurante_definir_mesas(integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restaurante_definir_mesas(integer, uuid) TO authenticated;
