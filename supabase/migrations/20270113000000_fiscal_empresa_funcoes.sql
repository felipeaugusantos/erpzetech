-- Parametrização fiscal por NCM (plano em docs/parametrizacao-fiscal.md, PR 5): a empresa sobrescreve ou oculta regras da base global.
-- Só administrador e gestor da empresa (nunca o perfil restrito do salão); tudo por função, sem acesso direto às tabelas.
-- A empresa só enxerga e altera o que é dela: as sobrescritas e as ocultações da própria empresa e os perfis dela (mais os perfis e regras
-- globais, só para leitura). As mesmas regras de versão da carga global valem aqui: nova versão encerra a anterior no dia anterior.
-- Limites por empresa: 2000 regras e 200 perfis próprios.

-- Valores de um perfil em JSON (camelCase, sem nulos). Interna.
CREATE OR REPLACE FUNCTION public._fiscal_perfil_json(p public.fiscal_perfis)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'cstIcms', p.cst_icms, 'csosn', p.csosn, 'cfop', p.cfop, 'aliqIcms', p.aliq_icms,
    'reducaoBaseIcms', p.reducao_base_icms, 'mvaSt', p.mva_st, 'cstPis', p.cst_pis, 'aliqPis', p.aliq_pis,
    'cstCofins', p.cst_cofins, 'aliqCofins', p.aliq_cofins, 'cstIbsCbs', p.cst_ibs_cbs,
    'cclasstrib', p.cclasstrib, 'origem', p.origem))
$fn$;
REVOKE ALL ON FUNCTION public._fiscal_perfil_json(public.fiscal_perfis) FROM PUBLIC, anon, authenticated;

-- Perfis que a empresa pode usar numa regra: os globais e os dela.
CREATE OR REPLACE FUNCTION public.fiscal_empresa_perfis()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_tenant uuid;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Empresa não encontrada'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'id', p.id, 'nome', p.nome, 'origem', CASE WHEN p.tenant_id IS NULL THEN 'global' ELSE 'empresa' END,
             'perfil', public._fiscal_perfil_json(p)) ORDER BY (p.tenant_id IS NOT NULL), lower(p.nome), p.id)
      FROM public.fiscal_perfis p WHERE p.tenant_id IS NULL OR p.tenant_id = v_tenant), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.fiscal_empresa_perfis() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fiscal_empresa_perfis() TO authenticated;

-- As sobrescritas da própria empresa (todas as versões). p_busca: só números (com ponto ou traço) = começo do NCM e também parte do nome; qualquer outro texto (ex.: "Revenda v2") = parte do nome do perfil.
-- status: vigente, futura, encerrada ou inativa.
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
            OR position(lower(v_busca) IN lower(p.nome)) > 0)
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

-- As regras da base global (só leitura), com a marca de quais a empresa ocultou e por quê.
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
            OR position(lower(v_busca) IN lower(p.nome)) > 0)
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

-- Cria uma sobrescrita da empresa ou uma nova versão dela.
-- p_dados: ncm, cest, operacao, regime, uf_destino, vigencia_inicio, vigencia_fim, observacao, e o perfil de UM destes jeitos:
--   perfil_id (um perfil global ou da própria empresa) ou perfil = { nome, cst_icms, csosn, cfop, aliq_icms, reducao_base_icms, mva_st,
--   cst_pis, aliq_pis, cst_cofins, aliq_cofins, cst_ibs_cbs, cclasstrib, origem } (cria o perfil da empresa; se o nome já existir, só vale com os
--   mesmos valores).
-- Mesma chave (NCM + CEST + operação + regime + UF) que já tem versão vigente: a nova começa depois e a anterior termina no dia anterior.
-- Reenviar o mesmo conteúdo não muda nada. Retorno: { acao: nova | nova_versao | igual, id, versao }.
CREATE OR REPLACE FUNCTION public.fiscal_empresa_regra_salvar(p_dados jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_tenant uuid;
  v_ncm text; v_cest text; v_op text; v_reg text; v_uf text; v_ini date; v_fim date;
  v_perfil_id uuid; v_perfil public.fiscal_perfis%ROWTYPE; v_pj jsonb; v_nome text;
  v_cst_icms text; v_csosn text; v_cfop text; v_aliq_icms numeric(7, 4); v_red numeric(7, 4); v_mva numeric(8, 4);
  v_cst_pis text; v_aliq_pis numeric(7, 4); v_cst_cofins text; v_aliq_cofins numeric(7, 4);
  v_cst_ibs text; v_cclass text; v_origem text;
  v_prev public.fiscal_empresa_regras%ROWTYPE;
  v_acao text; v_versao integer; v_id uuid;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Empresa não encontrada'; END IF;
  IF p_dados IS NULL OR jsonb_typeof(p_dados) <> 'object' THEN RAISE EXCEPTION 'Dados da regra inválidos'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('fiscal_empresa_regra_salvar'), hashtext(v_tenant::text));

  v_ncm := regexp_replace(coalesce(p_dados ->> 'ncm', ''), '[^0-9]', '', 'g');
  IF v_ncm !~ '^[0-9]{2,8}$' THEN RAISE EXCEPTION 'NCM deve ter de 2 a 8 dígitos'; END IF;
  v_cest := nullif(regexp_replace(coalesce(p_dados ->> 'cest', ''), '[^0-9]', '', 'g'), '');
  IF v_cest IS NOT NULL AND v_cest !~ '^[0-9]{7}$' THEN RAISE EXCEPTION 'CEST deve ter 7 dígitos'; END IF;
  v_op := nullif(lower(btrim(coalesce(p_dados ->> 'operacao', ''))), '');
  IF v_op IS NOT NULL AND v_op !~ '^[a-z_]{1,30}$' THEN RAISE EXCEPTION 'Operação inválida (use letras minúsculas e _)'; END IF;
  v_reg := nullif(lower(btrim(coalesce(p_dados ->> 'regime', ''))), '');
  IF v_reg IS NOT NULL AND v_reg NOT IN ('normal', 'simples', 'mei') THEN RAISE EXCEPTION 'Regime deve ser normal, simples ou mei'; END IF;
  v_uf := nullif(upper(btrim(coalesce(p_dados ->> 'uf_destino', ''))), '');
  IF v_uf IS NOT NULL AND v_uf !~ '^[A-Z]{2}$' THEN RAISE EXCEPTION 'UF de destino deve ter 2 letras'; END IF;
  v_ini := nullif(p_dados ->> 'vigencia_inicio', '')::date;
  IF v_ini IS NULL THEN RAISE EXCEPTION 'Informe o início da vigência'; END IF;
  v_fim := nullif(p_dados ->> 'vigencia_fim', '')::date;
  IF v_fim IS NOT NULL AND v_fim < v_ini THEN RAISE EXCEPTION 'O fim da vigência não pode ser anterior ao início'; END IF;

  -- perfil: um existente (global ou da empresa) ou um novo da empresa
  IF nullif(p_dados ->> 'perfil_id', '') IS NOT NULL THEN
    SELECT * INTO v_perfil FROM public.fiscal_perfis p
     WHERE p.id = (p_dados ->> 'perfil_id')::uuid AND (p.tenant_id IS NULL OR p.tenant_id = v_tenant);
    IF NOT FOUND THEN RAISE EXCEPTION 'Perfil não encontrado'; END IF;
    v_perfil_id := v_perfil.id;
  ELSIF jsonb_typeof(p_dados -> 'perfil') = 'object' THEN
    v_pj := p_dados -> 'perfil';
    v_nome := btrim(coalesce(v_pj ->> 'nome', ''));
    IF length(v_nome) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'Informe o nome do perfil (até 120 caracteres)'; END IF;
    v_cst_icms := nullif(btrim(v_pj ->> 'cst_icms'), '');
    v_csosn := nullif(btrim(v_pj ->> 'csosn'), '');
    v_cfop := nullif(btrim(v_pj ->> 'cfop'), '');
    v_aliq_icms := nullif(btrim(v_pj ->> 'aliq_icms'), '')::numeric;
    v_red := nullif(btrim(v_pj ->> 'reducao_base_icms'), '')::numeric;
    v_mva := nullif(btrim(v_pj ->> 'mva_st'), '')::numeric;
    v_cst_pis := nullif(btrim(v_pj ->> 'cst_pis'), '');
    v_aliq_pis := nullif(btrim(v_pj ->> 'aliq_pis'), '')::numeric;
    v_cst_cofins := nullif(btrim(v_pj ->> 'cst_cofins'), '');
    v_aliq_cofins := nullif(btrim(v_pj ->> 'aliq_cofins'), '')::numeric;
    v_cst_ibs := nullif(btrim(v_pj ->> 'cst_ibs_cbs'), '');
    v_cclass := nullif(btrim(v_pj ->> 'cclasstrib'), '');
    v_origem := nullif(btrim(v_pj ->> 'origem'), '');
    IF coalesce(v_cst_icms, v_csosn, v_cfop, v_aliq_icms::text, v_red::text, v_mva::text, v_cst_pis, v_aliq_pis::text,
                v_cst_cofins, v_aliq_cofins::text, v_cst_ibs, v_cclass, v_origem) IS NULL THEN
      RAISE EXCEPTION 'Informe ao menos um campo de tributação';
    END IF;
    SELECT * INTO v_perfil FROM public.fiscal_perfis p WHERE p.tenant_id = v_tenant AND lower(btrim(p.nome)) = lower(v_nome);
    IF FOUND THEN
      IF (v_perfil.cst_icms, v_perfil.csosn, v_perfil.cfop, v_perfil.aliq_icms, v_perfil.reducao_base_icms, v_perfil.mva_st,
          v_perfil.cst_pis, v_perfil.aliq_pis, v_perfil.cst_cofins, v_perfil.aliq_cofins, v_perfil.cst_ibs_cbs,
          v_perfil.cclasstrib, v_perfil.origem)
         IS DISTINCT FROM
         (v_cst_icms, v_csosn, v_cfop, v_aliq_icms, v_red, v_mva, v_cst_pis, v_aliq_pis, v_cst_cofins, v_aliq_cofins,
          v_cst_ibs, v_cclass, v_origem) THEN
        RAISE EXCEPTION 'Já existe um perfil seu chamado "%" com outros valores; use outro nome', v_nome;
      END IF;
      v_perfil_id := v_perfil.id;
    ELSE
      IF (SELECT count(*) FROM public.fiscal_perfis p WHERE p.tenant_id = v_tenant) >= 200 THEN
        RAISE EXCEPTION 'Limite de 200 perfis próprios atingido';
      END IF;
      INSERT INTO public.fiscal_perfis (tenant_id, nome, cst_icms, csosn, cfop, aliq_icms, reducao_base_icms, mva_st,
                                        cst_pis, aliq_pis, cst_cofins, aliq_cofins, cst_ibs_cbs, cclasstrib, origem)
      VALUES (v_tenant, v_nome, v_cst_icms, v_csosn, v_cfop, v_aliq_icms, v_red, v_mva, v_cst_pis, v_aliq_pis,
              v_cst_cofins, v_aliq_cofins, v_cst_ibs, v_cclass, v_origem)
      RETURNING id INTO v_perfil_id;
    END IF;
  ELSE
    RAISE EXCEPTION 'Informe o perfil da regra';
  END IF;

  SELECT * INTO v_prev FROM public.fiscal_empresa_regras r
   WHERE r.tenant_id = v_tenant AND r.ncm_prefixo = v_ncm AND r.cest IS NOT DISTINCT FROM v_cest
     AND r.operacao IS NOT DISTINCT FROM v_op AND r.regime IS NOT DISTINCT FROM v_reg AND r.uf_destino IS NOT DISTINCT FROM v_uf AND r.ativa
   ORDER BY r.versao DESC, r.vigencia_inicio DESC LIMIT 1;
  IF NOT FOUND THEN
    v_acao := 'nova';
    SELECT coalesce(max(r.versao), 0) + 1 INTO v_versao FROM public.fiscal_empresa_regras r
     WHERE r.tenant_id = v_tenant AND r.ncm_prefixo = v_ncm AND r.cest IS NOT DISTINCT FROM v_cest
       AND r.operacao IS NOT DISTINCT FROM v_op AND r.regime IS NOT DISTINCT FROM v_reg AND r.uf_destino IS NOT DISTINCT FROM v_uf;
  ELSIF v_prev.perfil_id = v_perfil_id AND v_prev.vigencia_inicio = v_ini AND v_prev.vigencia_fim IS NOT DISTINCT FROM v_fim THEN
    RETURN jsonb_build_object('acao', 'igual', 'id', v_prev.id, 'versao', v_prev.versao);
  ELSE
    v_acao := 'nova_versao';
    v_versao := v_prev.versao + 1;
    IF v_prev.vigencia_fim IS NULL OR v_prev.vigencia_fim >= v_ini THEN
      IF v_ini <= v_prev.vigencia_inicio THEN
        RAISE EXCEPTION 'Já existe a versão % desta regra desde %; a nova precisa começar depois', v_prev.versao, to_char(v_prev.vigencia_inicio, 'DD/MM/YYYY');
      END IF;
      UPDATE public.fiscal_empresa_regras SET vigencia_fim = v_ini - 1 WHERE id = v_prev.id;
    END IF;
  END IF;
  IF (SELECT count(*) FROM public.fiscal_empresa_regras r WHERE r.tenant_id = v_tenant) >= 2000 THEN
    RAISE EXCEPTION 'Limite de 2000 regras próprias atingido';
  END IF;
  INSERT INTO public.fiscal_empresa_regras (tenant_id, perfil_id, ncm_prefixo, cest, operacao, regime, uf_destino, vigencia_inicio,
                                            vigencia_fim, versao, ativa, observacao, criado_por)
  VALUES (v_tenant, v_perfil_id, v_ncm, v_cest, v_op, v_reg, v_uf, v_ini, v_fim, v_versao, true,
          left(nullif(btrim(p_dados ->> 'observacao'), ''), 500), auth.uid())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('acao', v_acao, 'id', v_id, 'versao', v_versao);
END $fn$;
REVOKE ALL ON FUNCTION public.fiscal_empresa_regra_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fiscal_empresa_regra_salvar(jsonb) TO authenticated;

-- Encerra uma sobrescrita da PRÓPRIA empresa na data informada (nunca apaga). Só pode antecipar o fim, não estendê-lo.
CREATE OR REPLACE FUNCTION public.fiscal_empresa_regra_encerrar(p_regra_id uuid, p_fim date)
RETURNS date
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_tenant uuid;
  v public.fiscal_empresa_regras%ROWTYPE;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Empresa não encontrada'; END IF;
  IF p_fim IS NULL THEN RAISE EXCEPTION 'Informe a data de encerramento'; END IF;
  SELECT * INTO v FROM public.fiscal_empresa_regras WHERE id = p_regra_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Regra não encontrada'; END IF;
  IF p_fim < v.vigencia_inicio THEN RAISE EXCEPTION 'O encerramento não pode ser anterior ao início da vigência'; END IF;
  IF v.vigencia_fim IS NOT NULL AND p_fim > v.vigencia_fim THEN
    RAISE EXCEPTION 'A regra já termina em %; só é possível antecipar o fim', to_char(v.vigencia_fim, 'DD/MM/YYYY');
  END IF;
  UPDATE public.fiscal_empresa_regras SET vigencia_fim = p_fim WHERE id = p_regra_id;
  RETURN p_fim;
END $fn$;
REVOKE ALL ON FUNCTION public.fiscal_empresa_regra_encerrar(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fiscal_empresa_regra_encerrar(uuid, date) TO authenticated;

-- A empresa deixa de usar uma regra da base global (o motivo é obrigatório). Vale só para a própria empresa; a regra continua na base.
CREATE OR REPLACE FUNCTION public.fiscal_empresa_ocultar(p_regra_id uuid, p_motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_tenant uuid;
  v_motivo text := btrim(coalesce(p_motivo, ''));
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Empresa não encontrada'; END IF;
  IF length(v_motivo) NOT BETWEEN 3 AND 300 THEN RAISE EXCEPTION 'Informe o motivo (de 3 a 300 caracteres)'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.fiscal_regras WHERE id = p_regra_id) THEN RAISE EXCEPTION 'Regra não encontrada'; END IF;
  INSERT INTO public.fiscal_empresa_ocultas (tenant_id, regra_id, motivo, criado_por)
  VALUES (v_tenant, p_regra_id, v_motivo, auth.uid())
  ON CONFLICT (tenant_id, regra_id) DO UPDATE SET motivo = EXCLUDED.motivo, criado_em = now(), criado_por = EXCLUDED.criado_por;
END $fn$;
REVOKE ALL ON FUNCTION public.fiscal_empresa_ocultar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fiscal_empresa_ocultar(uuid, text) TO authenticated;

-- A empresa volta a usar uma regra global que tinha ocultado.
CREATE OR REPLACE FUNCTION public.fiscal_empresa_reexibir(p_regra_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_tenant uuid;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Empresa não encontrada'; END IF;
  DELETE FROM public.fiscal_empresa_ocultas WHERE tenant_id = v_tenant AND regra_id = p_regra_id;
END $fn$;
REVOKE ALL ON FUNCTION public.fiscal_empresa_reexibir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fiscal_empresa_reexibir(uuid) TO authenticated;
