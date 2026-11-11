-- Parametrização fiscal por NCM: corrige a busca por nome de perfil que tem dígito (ex.: "Revenda v2") nas listagens.
-- Antes, qualquer dígito no texto da busca virava busca por NCM e desligava a busca por nome, então perfis com versão no nome
-- (que o fluxo de carga recomenda) não eram achados. Agora a busca é por NCM só quando o texto INTEIRO é numérico (aceita ponto,
-- traço e espaço, como "30.04"); qualquer outro texto busca no nome do perfil. Vale para fiscal_base_listar (equipe) e para
-- fiscal_empresa_minhas e fiscal_empresa_globais (empresa). Só muda o filtro; o retorno é o mesmo. Pode ser reaplicada.
-- (Migração nova, e não edição das anteriores, porque as 20270111 e 20270113 já foram aplicadas.)

CREATE OR REPLACE FUNCTION public.fiscal_base_listar(
  p_busca text DEFAULT NULL, p_apenas_vigentes boolean DEFAULT false, p_limite integer DEFAULT 100, p_pagina integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_lim integer := least(greatest(coalesce(p_limite, 100), 1), 200);
  v_off integer := greatest(coalesce(p_pagina, 0), 0) * v_lim;
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_busca text := nullif(btrim(coalesce(p_busca, '')), '');
  v_digitos text := CASE WHEN btrim(coalesce(p_busca, '')) ~ '^[0-9. -]+$' THEN nullif(regexp_replace(coalesce(p_busca, ''), '[^0-9]', '', 'g'), '') END;
  v_total integer;
  v_itens jsonb;
BEGIN
  WITH f AS (
    SELECT r.*, p.nome AS perfil_nome, p.cst_icms, p.csosn, p.cfop, p.aliq_icms, p.reducao_base_icms, p.mva_st, p.cst_pis,
           p.aliq_pis, p.cst_cofins, p.aliq_cofins, p.cst_ibs_cbs, p.cclasstrib, p.origem,
           CASE WHEN NOT r.ativa THEN 'inativa'
                WHEN r.vigencia_inicio > v_hoje THEN 'futura'
                WHEN r.vigencia_fim IS NOT NULL AND r.vigencia_fim < v_hoje THEN 'encerrada'
                ELSE 'vigente' END AS status
      FROM public.fiscal_regras r JOIN public.fiscal_perfis p ON p.id = r.perfil_id
     WHERE (v_busca IS NULL
            OR (v_digitos IS NOT NULL AND left(r.ncm_prefixo, length(v_digitos)) = v_digitos)
            OR (v_digitos IS NULL AND position(lower(v_busca) IN lower(p.nome)) > 0))
  ), g AS (
    SELECT * FROM f WHERE NOT p_apenas_vigentes OR status IN ('vigente', 'futura')
  ), pag AS (
    SELECT * FROM g ORDER BY ncm_prefixo, cest NULLS FIRST, operacao NULLS FIRST, regime NULLS FIRST, uf_destino NULLS FIRST,
                             versao DESC, id LIMIT v_lim OFFSET v_off
  )
  SELECT (SELECT count(*) FROM g)::integer,
         coalesce((SELECT jsonb_agg(jsonb_build_object(
           'id', id, 'ncmPrefixo', ncm_prefixo, 'cest', cest, 'operacao', operacao, 'regime', regime, 'ufDestino', uf_destino,
           'vigenciaInicio', vigencia_inicio, 'vigenciaFim', vigencia_fim, 'versao', versao, 'ativa', ativa, 'status', status,
           'fonte', fonte, 'observacao', observacao, 'criadoEm', criado_em, 'perfilNome', perfil_nome,
           'perfil', jsonb_strip_nulls(jsonb_build_object(
             'cstIcms', cst_icms, 'csosn', csosn, 'cfop', cfop, 'aliqIcms', aliq_icms, 'reducaoBaseIcms', reducao_base_icms,
             'mvaSt', mva_st, 'cstPis', cst_pis, 'aliqPis', aliq_pis, 'cstCofins', cst_cofins, 'aliqCofins', aliq_cofins,
             'cstIbsCbs', cst_ibs_cbs, 'cclasstrib', cclasstrib, 'origem', origem)))
           ORDER BY ncm_prefixo, cest NULLS FIRST, operacao NULLS FIRST, regime NULLS FIRST, uf_destino NULLS FIRST, versao DESC, id)
           FROM pag), '[]'::jsonb)
    INTO v_total, v_itens;
  RETURN jsonb_build_object('total', v_total, 'itens', v_itens);
END $fn$;
REVOKE ALL ON FUNCTION public.fiscal_base_listar(text, boolean, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fiscal_base_listar(text, boolean, integer, integer) TO service_role;


CREATE OR REPLACE FUNCTION public.fiscal_empresa_minhas(
  p_busca text DEFAULT NULL, p_apenas_vigentes boolean DEFAULT false, p_limite integer DEFAULT 100, p_pagina integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_tenant uuid;
  v_lim integer := least(greatest(coalesce(p_limite, 100), 1), 200);
  v_off integer := greatest(coalesce(p_pagina, 0), 0) * v_lim;
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_busca text := nullif(btrim(coalesce(p_busca, '')), '');
  v_digitos text := CASE WHEN btrim(coalesce(p_busca, '')) ~ '^[0-9. -]+$' THEN nullif(regexp_replace(coalesce(p_busca, ''), '[^0-9]', '', 'g'), '') END;
  v_total integer;
  v_itens jsonb;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Empresa não encontrada'; END IF;
  WITH f AS (
    SELECT r.id, r.ncm_prefixo, r.cest, r.operacao, r.regime, r.uf_destino, r.vigencia_inicio, r.vigencia_fim, r.versao, r.ativa,
           r.observacao, r.criado_em, p AS perfil_linha,
           CASE WHEN NOT r.ativa THEN 'inativa'
                WHEN r.vigencia_inicio > v_hoje THEN 'futura'
                WHEN r.vigencia_fim IS NOT NULL AND r.vigencia_fim < v_hoje THEN 'encerrada'
                ELSE 'vigente' END AS status
      FROM public.fiscal_empresa_regras r JOIN public.fiscal_perfis p ON p.id = r.perfil_id
     WHERE r.tenant_id = v_tenant
       AND (v_busca IS NULL
            OR (v_digitos IS NOT NULL AND left(r.ncm_prefixo, length(v_digitos)) = v_digitos)
            OR (v_digitos IS NULL AND position(lower(v_busca) IN lower(p.nome)) > 0))
  ), g AS (
    SELECT * FROM f WHERE NOT p_apenas_vigentes OR status IN ('vigente', 'futura')
  ), pag AS (
    SELECT * FROM g ORDER BY ncm_prefixo, cest NULLS FIRST, operacao NULLS FIRST, regime NULLS FIRST, uf_destino NULLS FIRST,
                             versao DESC, id LIMIT v_lim OFFSET v_off
  )
  SELECT (SELECT count(*) FROM g)::integer,
         coalesce((SELECT jsonb_agg(jsonb_build_object(
           'id', id, 'ncmPrefixo', ncm_prefixo, 'cest', cest, 'operacao', operacao, 'regime', regime, 'ufDestino', uf_destino,
           'vigenciaInicio', vigencia_inicio, 'vigenciaFim', vigencia_fim, 'versao', versao, 'ativa', ativa, 'status', status,
           'observacao', observacao, 'criadoEm', criado_em,
           'perfilId', (perfil_linha).id, 'perfilNome', (perfil_linha).nome,
           'perfilOrigem', CASE WHEN (perfil_linha).tenant_id IS NULL THEN 'global' ELSE 'empresa' END,
           'perfil', public._fiscal_perfil_json(perfil_linha))
           ORDER BY ncm_prefixo, cest NULLS FIRST, operacao NULLS FIRST, regime NULLS FIRST, uf_destino NULLS FIRST, versao DESC, id)
           FROM pag), '[]'::jsonb)
    INTO v_total, v_itens;
  RETURN jsonb_build_object('total', v_total, 'itens', v_itens);
END $fn$;
REVOKE ALL ON FUNCTION public.fiscal_empresa_minhas(text, boolean, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fiscal_empresa_minhas(text, boolean, integer, integer) TO authenticated;


CREATE OR REPLACE FUNCTION public.fiscal_empresa_globais(
  p_busca text DEFAULT NULL, p_apenas_vigentes boolean DEFAULT true, p_limite integer DEFAULT 100, p_pagina integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_tenant uuid;
  v_lim integer := least(greatest(coalesce(p_limite, 100), 1), 200);
  v_off integer := greatest(coalesce(p_pagina, 0), 0) * v_lim;
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_busca text := nullif(btrim(coalesce(p_busca, '')), '');
  v_digitos text := CASE WHEN btrim(coalesce(p_busca, '')) ~ '^[0-9. -]+$' THEN nullif(regexp_replace(coalesce(p_busca, ''), '[^0-9]', '', 'g'), '') END;
  v_total integer;
  v_itens jsonb;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Empresa não encontrada'; END IF;
  WITH f AS (
    SELECT r.id, r.ncm_prefixo, r.cest, r.operacao, r.regime, r.uf_destino, r.vigencia_inicio, r.vigencia_fim, r.versao, r.ativa,
           r.observacao, p AS perfil_linha, o.motivo AS motivo_oculta, (o.regra_id IS NOT NULL) AS oculta,
           CASE WHEN NOT r.ativa THEN 'inativa'
                WHEN r.vigencia_inicio > v_hoje THEN 'futura'
                WHEN r.vigencia_fim IS NOT NULL AND r.vigencia_fim < v_hoje THEN 'encerrada'
                ELSE 'vigente' END AS status
      FROM public.fiscal_regras r JOIN public.fiscal_perfis p ON p.id = r.perfil_id
      LEFT JOIN public.fiscal_empresa_ocultas o ON o.regra_id = r.id AND o.tenant_id = v_tenant
     WHERE (v_busca IS NULL
            OR (v_digitos IS NOT NULL AND left(r.ncm_prefixo, length(v_digitos)) = v_digitos)
            OR (v_digitos IS NULL AND position(lower(v_busca) IN lower(p.nome)) > 0))
  ), g AS (
    SELECT * FROM f WHERE NOT p_apenas_vigentes OR status IN ('vigente', 'futura')
  ), pag AS (
    SELECT * FROM g ORDER BY ncm_prefixo, cest NULLS FIRST, operacao NULLS FIRST, regime NULLS FIRST, uf_destino NULLS FIRST,
                             versao DESC, id LIMIT v_lim OFFSET v_off
  )
  SELECT (SELECT count(*) FROM g)::integer,
         coalesce((SELECT jsonb_agg(jsonb_build_object(
           'id', id, 'ncmPrefixo', ncm_prefixo, 'cest', cest, 'operacao', operacao, 'regime', regime, 'ufDestino', uf_destino,
           'vigenciaInicio', vigencia_inicio, 'vigenciaFim', vigencia_fim, 'versao', versao, 'ativa', ativa, 'status', status,
           'observacao', observacao, 'oculta', oculta, 'motivoOculta', motivo_oculta,
           'perfilNome', (perfil_linha).nome, 'perfil', public._fiscal_perfil_json(perfil_linha))
           ORDER BY ncm_prefixo, cest NULLS FIRST, operacao NULLS FIRST, regime NULLS FIRST, uf_destino NULLS FIRST, versao DESC, id)
           FROM pag), '[]'::jsonb)
    INTO v_total, v_itens;
  RETURN jsonb_build_object('total', v_total, 'itens', v_itens);
END $fn$;
REVOKE ALL ON FUNCTION public.fiscal_empresa_globais(text, boolean, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fiscal_empresa_globais(text, boolean, integer, integer) TO authenticated;

