-- Parametrização fiscal por NCM (plano em docs/parametrizacao-fiscal.md): a sugestão passa a considerar a UF da empresa.
-- Antes, regras com uf_destino preenchido nunca casavam quando a UF não era informada, e a ST depende da UF. Agora, sem p_uf_destino, a
-- sugestão usa a UF da própria empresa (venda dentro do estado). UF informada continua valendo. UF da empresa vazia ou que não é uma sigla
-- de 2 letras é ignorada (as regras com UF simplesmente não casam, como antes). Regra sem UF continua valendo para todas.
-- Ordem de desempate (não mudou): NCM com mais dígitos, CEST, operação e regime, e por último a UF. Uma regra de UF mais curta no NCM
-- perde para uma regra geral de NCM mais específico: se isso importar, cadastre a regra da UF com o mesmo NCM.
-- O retorno ganha "ufDestino" (a UF usada, ou nulo). Empresas com mais de um CNPJ usam a UF da primeira. Só o retorno muda; pode ser reaplicada.
-- fiscal_sugerir_lote devolve "uf" (a UF da empresa usada nas consultas).

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
  v_uf_empresa text;
  v_cand jsonb;
  v_n integer;
BEGIN
  PERFORM public.exige_nao_salao();
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Empresa não encontrada'; END IF;
  IF v_regime IS NOT NULL AND v_regime NOT IN ('normal', 'simples', 'mei') THEN
    RAISE EXCEPTION 'Regime inválido';
  END IF;
  SELECT e.regime_tributario, upper(btrim(e.estado)) INTO v_regime_empresa, v_uf_empresa FROM public.empresas e
   WHERE e.tenant_id = v_tenant ORDER BY e.created_at, e.id LIMIT 1;
  IF v_regime IS NULL THEN
    v_regime := CASE v_regime_empresa WHEN 'simples' THEN 'simples' WHEN 'mei' THEN 'mei' ELSE 'normal' END;
  END IF;
  -- UF de destino: a informada; sem informar, a UF da própria empresa (venda dentro do estado). UF da empresa que não é uma sigla é ignorada.
  IF v_uf IS NULL AND v_uf_empresa ~ '^[A-Z]{2}$' THEN v_uf := v_uf_empresa; END IF;
  IF length(v_ncm) <> 8 THEN
    RETURN jsonb_build_object('status', 'ncm_invalido', 'regra', NULL, 'candidatas', '[]'::jsonb, 'perfil', '{}'::jsonb, 'ufDestino', v_uf);
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
    RETURN jsonb_build_object('status', 'sem_regra', 'regra', NULL, 'candidatas', '[]'::jsonb, 'perfil', '{}'::jsonb, 'ufDestino', v_uf);
  ELSIF v_n > 1 THEN
    RETURN jsonb_build_object('status', 'empate', 'regra', NULL, 'candidatas', v_cand, 'perfil', '{}'::jsonb, 'ufDestino', v_uf);
  END IF;
  RETURN jsonb_build_object(
    'status', 'regra',
    'regra', jsonb_build_object('id', v_cand -> 0 -> 'id', 'versao', v_cand -> 0 -> 'versao', 'origem', v_cand -> 0 -> 'origem',
                                'ncmPrefixo', v_cand -> 0 -> 'ncmPrefixo', 'perfilNome', v_cand -> 0 -> 'perfilNome'),
    'candidatas', '[]'::jsonb,
    'perfil', v_cand -> 0 -> 'perfil',
    'ufDestino', v_uf);
END $fn$;
REVOKE ALL ON FUNCTION public.fiscal_sugerir(text, text, text, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fiscal_sugerir(text, text, text, date, text, text) TO authenticated;

-- Lote: mesma consulta para vários NCMs; devolve também a UF da empresa usada.
CREATE OR REPLACE FUNCTION public.fiscal_sugerir_lote(p_itens jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_tenant uuid;
  v_regime_empresa text;
  v_uf_empresa text;
  v_regime text;
  v_uf text;
  v_res jsonb := '[]'::jsonb;
  it jsonb;
  v_ncm text;
  v_cest text;
BEGIN
  PERFORM public.exige_nao_salao();
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Empresa não encontrada'; END IF;
  IF jsonb_typeof(p_itens) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Lista de NCMs inválida'; END IF;
  IF jsonb_array_length(p_itens) > 300 THEN RAISE EXCEPTION 'Consulte até 300 NCMs por vez'; END IF;

  SELECT e.regime_tributario, upper(btrim(e.estado)) INTO v_regime_empresa, v_uf_empresa FROM public.empresas e
   WHERE e.tenant_id = v_tenant ORDER BY e.created_at, e.id LIMIT 1;
  v_regime := CASE v_regime_empresa WHEN 'simples' THEN 'simples' WHEN 'mei' THEN 'mei' ELSE 'normal' END;
  IF v_uf_empresa ~ '^[A-Z]{2}$' THEN v_uf := v_uf_empresa; END IF;

  FOR it IN SELECT e FROM jsonb_array_elements(p_itens) AS t(e) LOOP
    IF jsonb_typeof(it) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Item da lista inválido'; END IF;
    v_ncm := it ->> 'ncm';
    v_cest := nullif(btrim(it ->> 'cest'), '');
    v_res := v_res || jsonb_build_object(
      'ncm', v_ncm, 'cest', v_cest,
      'resultado', public.fiscal_sugerir(v_ncm, v_cest, 'venda', NULL, NULL, NULL));
  END LOOP;
  RETURN jsonb_build_object('regime', v_regime, 'uf', v_uf, 'itens', v_res);
END $fn$;
REVOKE ALL ON FUNCTION public.fiscal_sugerir_lote(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fiscal_sugerir_lote(jsonb) TO authenticated;
