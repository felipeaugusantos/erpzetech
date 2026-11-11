-- Parametrização fiscal por NCM (plano em docs/parametrizacao-fiscal.md, PR 3): carga da base global pela equipe Ze Tech.
-- Todas as funções são SÓ de service_role (a tela da equipe chama por função de servidor, depois de conferir que a pessoa é da equipe).
-- Prévia e publicação usam o MESMO caminho de código (fiscal_base_aplicar): a prévia roda tudo e desfaz, para nunca divergir do que será gravado.
-- Regras da carga:
--   * cada linha traz a regra (NCM, CEST, operação, regime, UF, vigência) e o perfil tributário (nome + valores);
--   * perfil novo é criado; perfil existente só é reaproveitado se os valores forem idênticos (senão a linha é recusada: use outro nome),
--     porque regras antigas apontam para ele e mudar o perfil mudaria o passado;
--   * regra nova de uma chave (NCM + CEST + operação + regime + UF) que já tem versão vigente encerra a anterior no dia anterior ao início da nova;
--   * a mesma planilha enviada de novo não muda nada ("igual");
--   * com qualquer erro, nada é publicado (tudo ou nada).

ALTER TABLE public.fiscal_regras ADD COLUMN IF NOT EXISTS criado_por uuid;

-- Aplica as linhas e devolve o que aconteceu em cada uma. Interna: quem chama é fiscal_base_publicar.
-- Cada linha roda num bloco próprio: erro numa linha não derruba as outras (vira acao "erro" com o motivo).
CREATE OR REPLACE FUNCTION public.fiscal_base_aplicar(p_linhas jsonb, p_fonte text, p_operador uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  it jsonb;
  v_ord integer;
  v_res jsonb := '[]'::jsonb;
  v_linha integer;
  v_nome text;
  v_ncm text; v_cest text; v_op text; v_reg text; v_uf text; v_ini date; v_fim date;
  v_cst_icms text; v_csosn text; v_cfop text; v_aliq_icms numeric(7, 4); v_red numeric(7, 4); v_mva numeric(8, 4);
  v_cst_pis text; v_aliq_pis numeric(7, 4); v_cst_cofins text; v_aliq_cofins numeric(7, 4);
  v_cst_ibs text; v_cclass text; v_origem text;
  v_perfil public.fiscal_perfis%ROWTYPE;
  v_perfil_id uuid;
  v_prev public.fiscal_regras%ROWTYPE;
  v_acao text; v_versao integer; v_id uuid;
BEGIN
  FOR it, v_ord IN SELECT e, o::integer FROM jsonb_array_elements(p_linhas) WITH ORDINALITY AS t(e, o) LOOP
    v_linha := coalesce(nullif(it ->> 'linha', '')::integer, v_ord);
    BEGIN
      IF jsonb_typeof(it) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Linha inválida'; END IF;
      v_ncm := regexp_replace(coalesce(it ->> 'ncm', ''), '[^0-9]', '', 'g');
      IF v_ncm !~ '^[0-9]{2,8}$' THEN RAISE EXCEPTION 'NCM deve ter de 2 a 8 dígitos'; END IF;
      v_cest := nullif(regexp_replace(coalesce(it ->> 'cest', ''), '[^0-9]', '', 'g'), '');
      IF v_cest IS NOT NULL AND v_cest !~ '^[0-9]{7}$' THEN RAISE EXCEPTION 'CEST deve ter 7 dígitos'; END IF;
      v_op := nullif(lower(btrim(coalesce(it ->> 'operacao', ''))), '');
      IF v_op IS NOT NULL AND v_op !~ '^[a-z_]{1,30}$' THEN RAISE EXCEPTION 'Operação inválida (use letras minúsculas e _)'; END IF;
      v_reg := nullif(lower(btrim(coalesce(it ->> 'regime', ''))), '');
      IF v_reg IS NOT NULL AND v_reg NOT IN ('normal', 'simples', 'mei') THEN RAISE EXCEPTION 'Regime deve ser normal, simples ou mei'; END IF;
      v_uf := nullif(upper(btrim(coalesce(it ->> 'uf_destino', ''))), '');
      IF v_uf IS NOT NULL AND v_uf !~ '^[A-Z]{2}$' THEN RAISE EXCEPTION 'UF de destino deve ter 2 letras'; END IF;
      v_ini := nullif(it ->> 'vigencia_inicio', '')::date;
      IF v_ini IS NULL THEN RAISE EXCEPTION 'Informe o início da vigência'; END IF;
      v_fim := nullif(it ->> 'vigencia_fim', '')::date;
      IF v_fim IS NOT NULL AND v_fim < v_ini THEN RAISE EXCEPTION 'O fim da vigência não pode ser anterior ao início'; END IF;

      v_nome := btrim(coalesce(it ->> 'perfil', ''));
      IF length(v_nome) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'Informe o nome do perfil (até 120 caracteres)'; END IF;
      v_cst_icms := nullif(btrim(it ->> 'cst_icms'), '');
      v_csosn := nullif(btrim(it ->> 'csosn'), '');
      v_cfop := nullif(btrim(it ->> 'cfop'), '');
      v_aliq_icms := nullif(btrim(it ->> 'aliq_icms'), '')::numeric;
      v_red := nullif(btrim(it ->> 'reducao_base_icms'), '')::numeric;
      v_mva := nullif(btrim(it ->> 'mva_st'), '')::numeric;
      v_cst_pis := nullif(btrim(it ->> 'cst_pis'), '');
      v_aliq_pis := nullif(btrim(it ->> 'aliq_pis'), '')::numeric;
      v_cst_cofins := nullif(btrim(it ->> 'cst_cofins'), '');
      v_aliq_cofins := nullif(btrim(it ->> 'aliq_cofins'), '')::numeric;
      v_cst_ibs := nullif(btrim(it ->> 'cst_ibs_cbs'), '');
      v_cclass := nullif(btrim(it ->> 'cclasstrib'), '');
      v_origem := nullif(btrim(it ->> 'origem'), '');
      IF coalesce(v_cst_icms, v_csosn, v_cfop, v_aliq_icms::text, v_red::text, v_mva::text, v_cst_pis, v_aliq_pis::text,
                  v_cst_cofins, v_aliq_cofins::text, v_cst_ibs, v_cclass, v_origem) IS NULL THEN
        RAISE EXCEPTION 'Informe ao menos um campo de tributação';
      END IF;

      -- perfil: reaproveita o que já existe só se for idêntico
      SELECT * INTO v_perfil FROM public.fiscal_perfis p WHERE p.tenant_id IS NULL AND lower(btrim(p.nome)) = lower(v_nome);
      IF FOUND THEN
        IF (v_perfil.cst_icms, v_perfil.csosn, v_perfil.cfop, v_perfil.aliq_icms, v_perfil.reducao_base_icms, v_perfil.mva_st,
            v_perfil.cst_pis, v_perfil.aliq_pis, v_perfil.cst_cofins, v_perfil.aliq_cofins, v_perfil.cst_ibs_cbs,
            v_perfil.cclasstrib, v_perfil.origem)
           IS DISTINCT FROM
           (v_cst_icms, v_csosn, v_cfop, v_aliq_icms, v_red, v_mva, v_cst_pis, v_aliq_pis, v_cst_cofins, v_aliq_cofins,
            v_cst_ibs, v_cclass, v_origem) THEN
          RAISE EXCEPTION 'O perfil "%" já existe com outros valores; use outro nome (ex.: "% v2")', v_nome, v_nome;
        END IF;
        v_perfil_id := v_perfil.id;
      ELSE
        INSERT INTO public.fiscal_perfis (tenant_id, nome, cst_icms, csosn, cfop, aliq_icms, reducao_base_icms, mva_st,
                                          cst_pis, aliq_pis, cst_cofins, aliq_cofins, cst_ibs_cbs, cclasstrib, origem)
        VALUES (NULL, v_nome, v_cst_icms, v_csosn, v_cfop, v_aliq_icms, v_red, v_mva, v_cst_pis, v_aliq_pis,
                v_cst_cofins, v_aliq_cofins, v_cst_ibs, v_cclass, v_origem)
        RETURNING id INTO v_perfil_id;
      END IF;

      -- chave da regra: a última versão ativa
      SELECT * INTO v_prev FROM public.fiscal_regras r
       WHERE r.ncm_prefixo = v_ncm AND r.cest IS NOT DISTINCT FROM v_cest AND r.operacao IS NOT DISTINCT FROM v_op
         AND r.regime IS NOT DISTINCT FROM v_reg AND r.uf_destino IS NOT DISTINCT FROM v_uf AND r.ativa
       ORDER BY r.versao DESC, r.vigencia_inicio DESC LIMIT 1;
      v_id := NULL;
      IF NOT FOUND THEN
        v_acao := 'nova';
        SELECT coalesce(max(r.versao), 0) + 1 INTO v_versao FROM public.fiscal_regras r
         WHERE r.ncm_prefixo = v_ncm AND r.cest IS NOT DISTINCT FROM v_cest AND r.operacao IS NOT DISTINCT FROM v_op
           AND r.regime IS NOT DISTINCT FROM v_reg AND r.uf_destino IS NOT DISTINCT FROM v_uf;
      ELSIF v_prev.perfil_id = v_perfil_id AND v_prev.vigencia_inicio = v_ini AND v_prev.vigencia_fim IS NOT DISTINCT FROM v_fim THEN
        v_acao := 'igual'; v_versao := v_prev.versao; v_id := v_prev.id;
      ELSE
        v_acao := 'nova_versao'; v_versao := v_prev.versao + 1;
        IF v_prev.vigencia_fim IS NULL OR v_prev.vigencia_fim >= v_ini THEN
          IF v_ini <= v_prev.vigencia_inicio THEN
            RAISE EXCEPTION 'Já existe a versão % desta regra desde %; a nova precisa começar depois', v_prev.versao, to_char(v_prev.vigencia_inicio, 'DD/MM/YYYY');
          END IF;
          UPDATE public.fiscal_regras SET vigencia_fim = v_ini - 1 WHERE id = v_prev.id;
        END IF;
      END IF;
      IF v_acao <> 'igual' THEN
        INSERT INTO public.fiscal_regras (perfil_id, ncm_prefixo, cest, operacao, regime, uf_destino, vigencia_inicio, vigencia_fim,
                                          versao, ativa, observacao, fonte, criado_por)
        VALUES (v_perfil_id, v_ncm, v_cest, v_op, v_reg, v_uf, v_ini, v_fim, v_versao, true,
                left(nullif(btrim(it ->> 'observacao'), ''), 500), left(p_fonte, 200), p_operador)
        RETURNING id INTO v_id;
      END IF;
      v_res := v_res || jsonb_build_object('linha', v_linha, 'acao', v_acao, 'versao', v_versao, 'regraId', v_id, 'perfil', v_nome);
    EXCEPTION WHEN OTHERS THEN
      v_res := v_res || jsonb_build_object('linha', v_linha, 'acao', 'erro', 'motivo', SQLERRM);
    END;
  END LOOP;
  RETURN v_res;
END $fn$;
REVOKE ALL ON FUNCTION public.fiscal_base_aplicar(jsonb, text, uuid) FROM PUBLIC, anon, authenticated;

-- Prévia (p_confirmar = false: roda tudo e desfaz) ou publicação (p_confirmar = true: só grava se NENHUMA linha tiver erro).
-- Retorno: { publicado, resumo: { total, novas, novasVersoes, iguais, erros }, linhas: [{ linha, acao, versao, regraId, perfil, motivo }] }
CREATE OR REPLACE FUNCTION public.fiscal_base_publicar(
  p_linhas jsonb, p_fonte text, p_confirmar boolean DEFAULT false, p_operador uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_res jsonb := '[]'::jsonb;
  v_erros integer := 0;
  v_publicou boolean := false;
  v_fonte text := btrim(coalesce(p_fonte, ''));
BEGIN
  IF jsonb_typeof(p_linhas) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Planilha inválida'; END IF;
  IF jsonb_array_length(p_linhas) = 0 THEN RAISE EXCEPTION 'Planilha sem linhas'; END IF;
  IF jsonb_array_length(p_linhas) > 2000 THEN RAISE EXCEPTION 'Planilha grande demais (até 2000 linhas)'; END IF;
  IF length(v_fonte) NOT BETWEEN 3 AND 200 THEN RAISE EXCEPTION 'Informe a fonte da carga (3 a 200 caracteres)'; END IF;
  -- uma carga por vez: duas ao mesmo tempo poderiam criar a mesma versão duas vezes
  PERFORM pg_advisory_xact_lock(hashtext('fiscal_base_publicar'));
  BEGIN
    v_res := public.fiscal_base_aplicar(p_linhas, v_fonte, p_operador);
    SELECT count(*)::integer INTO v_erros FROM jsonb_array_elements(v_res) e WHERE e ->> 'acao' = 'erro';
    IF p_confirmar AND v_erros = 0 THEN
      v_publicou := true;
    ELSE
      -- desfaz o que o bloco gravou; as variáveis (o resultado) continuam
      RAISE EXCEPTION 'previa' USING ERRCODE = 'P0FPV';
    END IF;
  EXCEPTION WHEN SQLSTATE 'P0FPV' THEN
    NULL;
  END;
  RETURN jsonb_build_object(
    'publicado', v_publicou,
    'resumo', jsonb_build_object(
      'total', jsonb_array_length(v_res),
      'novas', (SELECT count(*) FROM jsonb_array_elements(v_res) e WHERE e ->> 'acao' = 'nova'),
      'novasVersoes', (SELECT count(*) FROM jsonb_array_elements(v_res) e WHERE e ->> 'acao' = 'nova_versao'),
      'iguais', (SELECT count(*) FROM jsonb_array_elements(v_res) e WHERE e ->> 'acao' = 'igual'),
      'erros', v_erros),
    'linhas', v_res);
END $fn$;
REVOKE ALL ON FUNCTION public.fiscal_base_publicar(jsonb, text, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fiscal_base_publicar(jsonb, text, boolean, uuid) TO service_role;

-- Lista as regras globais (todas as versões) para a tela da equipe.
-- p_busca: só números (com ponto ou traço) = começo do NCM e também parte do nome; qualquer outro texto (ex.: "Revenda v2") = parte do nome do perfil. status: vigente, futura, encerrada ou inativa.
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

-- Encerra uma regra na data informada (nunca apaga). Só pode antecipar o fim, não estendê-lo.
CREATE OR REPLACE FUNCTION public.fiscal_base_encerrar(p_regra_id uuid, p_fim date)
RETURNS date
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v public.fiscal_regras%ROWTYPE;
BEGIN
  IF p_fim IS NULL THEN RAISE EXCEPTION 'Informe a data de encerramento'; END IF;
  SELECT * INTO v FROM public.fiscal_regras WHERE id = p_regra_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Regra não encontrada'; END IF;
  IF p_fim < v.vigencia_inicio THEN RAISE EXCEPTION 'O encerramento não pode ser anterior ao início da vigência'; END IF;
  IF v.vigencia_fim IS NOT NULL AND p_fim > v.vigencia_fim THEN
    RAISE EXCEPTION 'A regra já termina em %; só é possível antecipar o fim', to_char(v.vigencia_fim, 'DD/MM/YYYY');
  END IF;
  UPDATE public.fiscal_regras SET vigencia_fim = p_fim WHERE id = p_regra_id;
  RETURN p_fim;
END $fn$;
REVOKE ALL ON FUNCTION public.fiscal_base_encerrar(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fiscal_base_encerrar(uuid, date) TO service_role;
