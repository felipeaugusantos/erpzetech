-- Parametrização fiscal por NCM (plano em docs/parametrizacao-fiscal.md, PR 4): a sugestão passa a devolver, na regra escolhida,
-- o prefixo do NCM e o nome do perfil (a tela do cadastro de produtos mostra qual regra e qual perfil estão sendo sugeridos).
-- Só o retorno muda (as chaves ncmPrefixo e perfilNome entram em "regra"; as candidatas do empate já as traziam). Pode ser reaplicada.

-- ===== Sugestão =====
-- Devolve a regra mais específica que vale para o NCM (e CEST, operação, UF de destino) na data, sem aplicar nada.
-- Precedência entre níveis: qualquer regra da empresa que case vence a global (mesmo menos específica); regra global ocultada pela
-- empresa é ignorada; dentro do mesmo nível vence a mais específica (NCM com mais dígitos, CEST, operação e regime, UF).
-- Empate real NÃO é desempatado: devolve as candidatas para a pessoa escolher.
-- Regime: o da empresa (simples, mei; o restante é normal, como crtDoRegime) ou o informado em p_regime.
-- Retorno: { status: regra | sem_regra | empate | ncm_invalido, regra: {id, versao, origem, ncmPrefixo, perfilNome} | null,
--            candidatas: [...] (só no empate), perfil: {...} (só quando há regra; chaves em camelCase, sem nulos) }.
-- Qualquer pessoa da empresa (exceto o perfil restrito do salão): é referência de consulta, nunca grava.
CREATE OR REPLACE FUNCTION public.fiscal_sugerir(
  p_ncm text, p_cest text DEFAULT NULL, p_operacao text DEFAULT 'venda',
  p_data date DEFAULT NULL, p_uf_destino text DEFAULT NULL, p_regime text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_tenant uuid;
  v_ncm text := regexp_replace(coalesce(p_ncm, ''), '[^0-9]', '', 'g');
  v_cest text := nullif(regexp_replace(coalesce(p_cest, ''), '[^0-9]', '', 'g'), '');
  v_op text := nullif(lower(btrim(coalesce(p_operacao, ''))), '');
  v_uf text := nullif(upper(btrim(coalesce(p_uf_destino, ''))), '');
  v_data date := coalesce(p_data, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  v_regime text := nullif(lower(btrim(coalesce(p_regime, ''))), '');
  v_regime_empresa text;
  v_cand jsonb;
  v_n integer;
BEGIN
  PERFORM public.exige_nao_salao();
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Empresa não encontrada'; END IF;
  IF v_regime IS NOT NULL AND v_regime NOT IN ('normal', 'simples', 'mei') THEN
    RAISE EXCEPTION 'Regime inválido';
  END IF;
  IF length(v_ncm) <> 8 THEN
    RETURN jsonb_build_object('status', 'ncm_invalido', 'regra', NULL, 'candidatas', '[]'::jsonb, 'perfil', '{}'::jsonb);
  END IF;
  IF v_regime IS NULL THEN
    SELECT e.regime_tributario INTO v_regime_empresa FROM public.empresas e
     WHERE e.tenant_id = v_tenant ORDER BY e.created_at, e.id LIMIT 1;
    v_regime := CASE v_regime_empresa WHEN 'simples' THEN 'simples' WHEN 'mei' THEN 'mei' ELSE 'normal' END;
  END IF;

  WITH base AS (
    SELECT 'empresa'::text AS origem, r.id, r.perfil_id, r.ncm_prefixo, r.cest, r.operacao, r.regime, r.uf_destino,
           r.vigencia_inicio, r.vigencia_fim, r.versao, r.ativa
      FROM public.fiscal_empresa_regras r WHERE r.tenant_id = v_tenant
    UNION ALL
    SELECT 'global'::text, r.id, r.perfil_id, r.ncm_prefixo, r.cest, r.operacao, r.regime, r.uf_destino,
           r.vigencia_inicio, r.vigencia_fim, r.versao, r.ativa
      FROM public.fiscal_regras r
     WHERE NOT EXISTS (SELECT 1 FROM public.fiscal_empresa_ocultas o WHERE o.tenant_id = v_tenant AND o.regra_id = r.id)
  ), casam AS (
    SELECT b.*, ARRAY[length(b.ncm_prefixo), (b.cest IS NOT NULL)::int,
                      (b.operacao IS NOT NULL)::int + (b.regime IS NOT NULL)::int, (b.uf_destino IS NOT NULL)::int] AS esp
      FROM base b
     WHERE b.ativa
       AND v_data >= b.vigencia_inicio AND (b.vigencia_fim IS NULL OR v_data <= b.vigencia_fim)
       AND left(v_ncm, length(b.ncm_prefixo)) = b.ncm_prefixo
       AND (b.cest IS NULL OR b.cest = v_cest)
       AND (b.operacao IS NULL OR b.operacao = v_op)
       AND (b.regime IS NULL OR b.regime = v_regime)
       AND (b.uf_destino IS NULL OR b.uf_destino = v_uf)
  ), nivel AS (
    SELECT c.origem FROM casam c ORDER BY (c.origem = 'empresa') DESC LIMIT 1
  ), topo AS (
    SELECT c.* FROM casam c
     WHERE c.origem = (SELECT origem FROM nivel)
       AND c.esp = (SELECT max(c2.esp) FROM casam c2 WHERE c2.origem = c.origem)
  )
  SELECT count(*)::integer,
         coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'versao', t.versao, 'origem', t.origem, 'ncmPrefixo', t.ncm_prefixo,
           'perfilId', p.id, 'perfilNome', p.nome,
           'perfil', jsonb_strip_nulls(jsonb_build_object(
             'cstIcms', p.cst_icms, 'csosn', p.csosn, 'cfop', p.cfop, 'aliqIcms', p.aliq_icms,
             'reducaoBaseIcms', p.reducao_base_icms, 'mvaSt', p.mva_st, 'cstPis', p.cst_pis, 'aliqPis', p.aliq_pis,
             'cstCofins', p.cst_cofins, 'aliqCofins', p.aliq_cofins, 'cstIbsCbs', p.cst_ibs_cbs,
             'cclasstrib', p.cclasstrib, 'origem', p.origem))) ORDER BY t.id), '[]'::jsonb)
    INTO v_n, v_cand
    FROM topo t JOIN public.fiscal_perfis p ON p.id = t.perfil_id;

  IF v_n = 0 THEN
    RETURN jsonb_build_object('status', 'sem_regra', 'regra', NULL, 'candidatas', '[]'::jsonb, 'perfil', '{}'::jsonb);
  ELSIF v_n > 1 THEN
    RETURN jsonb_build_object('status', 'empate', 'regra', NULL, 'candidatas', v_cand, 'perfil', '{}'::jsonb);
  END IF;
  RETURN jsonb_build_object(
    'status', 'regra',
    'regra', jsonb_build_object('id', v_cand -> 0 -> 'id', 'versao', v_cand -> 0 -> 'versao', 'origem', v_cand -> 0 -> 'origem',
                                'ncmPrefixo', v_cand -> 0 -> 'ncmPrefixo', 'perfilNome', v_cand -> 0 -> 'perfilNome'),
    'candidatas', '[]'::jsonb,
    'perfil', v_cand -> 0 -> 'perfil');
END $fn$;
REVOKE ALL ON FUNCTION public.fiscal_sugerir(text, text, text, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fiscal_sugerir(text, text, text, date, text, text) TO authenticated;
