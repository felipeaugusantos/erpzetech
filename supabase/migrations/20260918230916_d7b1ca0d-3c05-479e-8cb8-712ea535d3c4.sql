ALTER TABLE public.fiscal_config
  ADD COLUMN IF NOT EXISTS aliquota_icms_interna numeric NOT NULL DEFAULT 18,
  ADD COLUMN IF NOT EXISTS aliquota_icms_interestadual numeric NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS mva_st numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS aliquota_pis numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS aliquota_cofins numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS aliquota_iss numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cst_pis text NOT NULL DEFAULT '99',
  ADD COLUMN IF NOT EXISTS cst_cofins text NOT NULL DEFAULT '99',
  ADD COLUMN IF NOT EXISTS reducao_base_icms numeric NOT NULL DEFAULT 0;

ALTER TABLE public.nfe
  ADD COLUMN IF NOT EXISTS valor_icms numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valor_icms_st numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valor_pis numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valor_cofins numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valor_iss numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS base_icms numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS base_icms_st numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS impostos_calculados_em timestamptz;

ALTER TABLE public.nfe_itens
  ADD COLUMN IF NOT EXISTS base_icms numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valor_icms numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS base_icms_st numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valor_icms_st numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS aliquota_pis numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valor_pis numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS aliquota_cofins numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valor_cofins numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS aliquota_iss numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valor_iss numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cst_pis text,
  ADD COLUMN IF NOT EXISTS cst_cofins text;

CREATE OR REPLACE FUNCTION public.nfe_calcular_impostos(
  p_nfe_id uuid,
  p_aliquota_icms numeric DEFAULT NULL,
  p_aliquota_pis numeric DEFAULT NULL,
  p_aliquota_cofins numeric DEFAULT NULL,
  p_aliquota_iss numeric DEFAULT NULL,
  p_reducao_base numeric DEFAULT NULL,
  p_aplicar_icms_em_todos boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_nfe record;
  v_cfg record;
  v_item record;
  v_codigo text;
  v_icms numeric; v_pis numeric; v_cofins numeric; v_iss numeric; v_red numeric;
  v_base numeric; v_v_icms numeric; v_base_st numeric; v_v_st numeric;
  v_tot_base numeric := 0; v_tot_icms numeric := 0;
  v_tot_base_st numeric := 0; v_tot_st numeric := 0;
  v_tot_pis numeric := 0; v_tot_cofins numeric := 0; v_tot_iss numeric := 0;
BEGIN
  SELECT * INTO v_nfe FROM nfe WHERE id = p_nfe_id AND tenant_id = current_tenant_id();
  IF v_nfe IS NULL THEN
    RAISE EXCEPTION 'Nota fiscal não encontrada';
  END IF;
  IF v_nfe.situacao NOT IN ('rascunho', 'pronta') THEN
    RAISE EXCEPTION 'Só é possível recalcular impostos de nota em rascunho ou pronta';
  END IF;

  SELECT * INTO v_cfg FROM fiscal_config
   WHERE tenant_id = current_tenant_id()
     AND (empresa_id = v_nfe.empresa_id OR empresa_id IS NULL)
   ORDER BY empresa_id NULLS LAST LIMIT 1;

  v_pis := COALESCE(p_aliquota_pis, v_cfg.aliquota_pis, 0);
  v_cofins := COALESCE(p_aliquota_cofins, v_cfg.aliquota_cofins, 0);
  v_iss := COALESCE(p_aliquota_iss, v_cfg.aliquota_iss, 0);
  v_red := COALESCE(p_reducao_base, v_cfg.reducao_base_icms, 0);

  FOR v_item IN SELECT * FROM nfe_itens WHERE nfe_id = p_nfe_id LOOP
    v_codigo := regexp_replace(COALESCE(v_item.cst_csosn, ''), '\D', '', 'g');
    -- Alíquota de ICMS: a informada na tela, senão a do item, senão o padrão da empresa.
    v_icms := COALESCE(p_aliquota_icms, NULLIF(v_item.aliquota_icms, 0), v_cfg.aliquota_icms_interna, 0);
    IF p_aliquota_icms IS NOT NULL AND NOT p_aplicar_icms_em_todos AND COALESCE(v_item.aliquota_icms, 0) > 0 THEN
      v_icms := v_item.aliquota_icms;
    END IF;

    v_base := 0; v_v_icms := 0; v_base_st := 0; v_v_st := 0;

    IF v_codigo IN ('00', '10', '20', '70', '90', '900') THEN
      -- ICMS próprio, com redução de base quando configurada.
      v_base := round(v_item.total * (1 - v_red / 100), 2);
      v_v_icms := round(v_base * v_icms / 100, 2);
    ELSIF v_codigo IN ('60', '500') THEN
      -- ICMS já recolhido por substituição tributária.
      v_base_st := round(v_item.total * (1 + COALESCE(v_cfg.mva_st, 0) / 100), 2);
      v_v_st := round(v_base_st * v_icms / 100, 2);
    END IF;

    UPDATE nfe_itens SET
      aliquota_icms = v_icms,
      base_icms = v_base,
      valor_icms = v_v_icms,
      base_icms_st = v_base_st,
      valor_icms_st = v_v_st,
      aliquota_pis = v_pis,
      valor_pis = round(v_item.total * v_pis / 100, 2),
      aliquota_cofins = v_cofins,
      valor_cofins = round(v_item.total * v_cofins / 100, 2),
      aliquota_iss = v_iss,
      valor_iss = round(v_item.total * v_iss / 100, 2),
      cst_pis = COALESCE(v_cfg.cst_pis, '99'),
      cst_cofins = COALESCE(v_cfg.cst_cofins, '99')
     WHERE id = v_item.id;

    v_tot_base := v_tot_base + v_base;
    v_tot_icms := v_tot_icms + v_v_icms;
    v_tot_base_st := v_tot_base_st + v_base_st;
    v_tot_st := v_tot_st + v_v_st;
    v_tot_pis := v_tot_pis + round(v_item.total * v_pis / 100, 2);
    v_tot_cofins := v_tot_cofins + round(v_item.total * v_cofins / 100, 2);
    v_tot_iss := v_tot_iss + round(v_item.total * v_iss / 100, 2);
  END LOOP;

  UPDATE nfe SET
    base_icms = v_tot_base,
    valor_icms = v_tot_icms,
    base_icms_st = v_tot_base_st,
    valor_icms_st = v_tot_st,
    valor_pis = v_tot_pis,
    valor_cofins = v_tot_cofins,
    valor_iss = v_tot_iss,
    impostos_calculados_em = now(),
    updated_at = now()
   WHERE id = p_nfe_id;

  RETURN jsonb_build_object(
    'base_icms', v_tot_base, 'valor_icms', v_tot_icms,
    'base_icms_st', v_tot_base_st, 'valor_icms_st', v_tot_st,
    'valor_pis', v_tot_pis, 'valor_cofins', v_tot_cofins, 'valor_iss', v_tot_iss
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.nfe_calcular_impostos(uuid, numeric, numeric, numeric, numeric, numeric, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nfe_calcular_impostos(uuid, numeric, numeric, numeric, numeric, numeric, boolean) TO authenticated;