ALTER TABLE public.compras ADD COLUMN IF NOT EXISTS nfe_serie text;

DO $$
DECLARE
  def text;
  novo text;
BEGIN
  def := pg_get_functiondef('public.importar_nfe_entrada(jsonb, jsonb, jsonb, uuid, boolean, integer, date)'::regprocedure);

  novo := replace(def,
    E'    perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || '':nfe:'' || v_chave, 0));',
    E'    if not pg_try_advisory_xact_lock(hashtextextended(v_tenant::text || '':nfe:'' || v_chave, 0)) then\n      raise exception ''Esta nota já está em processo de importação (chave %). Aguarde a conclusão.'', v_chave;\n    end if;');
  IF novo = def THEN RAISE EXCEPTION 'Não foi possível ajustar a trava da chave em importar_nfe_entrada'; END IF;
  def := novo;

  novo := replace(def,
    E'    raise exception ''Esta nota já foi importada (chave %).'', v_chave;',
    E'    raise exception ''Esta nota já está importada (chave %).'', v_chave;');
  IF novo = def THEN RAISE EXCEPTION 'Não foi possível ajustar a mensagem da chave em importar_nfe_entrada'; END IF;
  def := novo;

  novo := replace(def,
    E'  if v_forn_id is null then',
    E'  if v_forn_id is not null and nullif(p_nota->>''numero'','''') is not null then\n    if not pg_try_advisory_xact_lock(hashtextextended(v_tenant::text || '':nfe:'' || v_forn_id::text || '':'' ||\n         (p_nota->>''numero'') || '':'' || coalesce(p_nota->>''serie'', ''''), 0)) then\n      raise exception ''Esta nota (nº %, série %) já está em processo de importação. Aguarde a conclusão.'',\n        p_nota->>''numero'', coalesce(p_nota->>''serie'', ''—'');\n    end if;\n    if exists (select 1 from public.compras\n                where tenant_id = v_tenant and fornecedor_id = v_forn_id and nfe_numero = (p_nota->>''numero'')\n                  and coalesce(nfe_serie, '''') = coalesce(p_nota->>''serie'', '''')) then\n      raise exception ''Esta nota (nº %, série %) já está importada para este fornecedor.'',\n        p_nota->>''numero'', coalesce(p_nota->>''serie'', ''—'');\n    end if;\n  end if;\n  if v_forn_id is null then');
  IF novo = def THEN RAISE EXCEPTION 'Não foi possível incluir a conferência de número e série em importar_nfe_entrada'; END IF;
  def := novo;

  novo := replace(def, E'nfe_chave, nfe_numero, nfe_emissao,\n    solicitante_id)', E'nfe_chave, nfe_numero, nfe_emissao,\n    nfe_serie, solicitante_id)');
  IF novo = def THEN RAISE EXCEPTION 'Não foi possível incluir a série nas colunas da compra'; END IF;
  def := novo;
  novo := replace(def, E'    (p_nota->>''emissao'')::date, auth.uid())', E'    (p_nota->>''emissao'')::date, nullif(p_nota->>''serie'',''''), auth.uid())');
  IF novo = def THEN RAISE EXCEPTION 'Não foi possível incluir a série nos valores da compra'; END IF;

  EXECUTE novo;
END $$;

CREATE OR REPLACE FUNCTION public.nfe_entrada_ja_importada(
  p_chave text DEFAULT NULL, p_numero text DEFAULT NULL, p_serie text DEFAULT NULL, p_cnpj text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_cnpj text := regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g');
  v_compra record;
BEGIN
  PERFORM public.exige_nao_salao();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem empresa vinculada'; END IF;
  IF NOT (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')
          OR public.has_role(auth.uid(), 'comprador') OR public.has_role(auth.uid(), 'estoquista')) THEN
    RAISE EXCEPTION 'Sem permissão para importar nota de entrada';
  END IF;

  IF nullif(p_chave, '') IS NOT NULL THEN
    SELECT c.id, c.numero INTO v_compra FROM public.compras c
     WHERE c.tenant_id = v_tenant AND c.nfe_chave = p_chave LIMIT 1;
    IF FOUND THEN RETURN jsonb_build_object('compra_id', v_compra.id, 'numero', v_compra.numero); END IF;
  END IF;

  IF nullif(p_numero, '') IS NOT NULL AND v_cnpj <> '' THEN
    SELECT c.id, c.numero INTO v_compra
      FROM public.compras c
      JOIN public.fornecedores f ON f.id = c.fornecedor_id AND f.tenant_id = v_tenant
     WHERE c.tenant_id = v_tenant AND c.nfe_numero = p_numero
       AND coalesce(c.nfe_serie, '') = coalesce(p_serie, '')
       AND regexp_replace(coalesce(f.cnpj, ''), '\D', '', 'g') = v_cnpj
     LIMIT 1;
    IF FOUND THEN RETURN jsonb_build_object('compra_id', v_compra.id, 'numero', v_compra.numero); END IF;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.nfe_entrada_ja_importada(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nfe_entrada_ja_importada(text, text, text, text) TO authenticated;