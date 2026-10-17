DO $$
DECLARE
  def text;
  novo text;
BEGIN
  def := pg_get_functiondef('public.importar_nfe_entrada(jsonb, jsonb, jsonb, uuid, boolean, integer, date)'::regprocedure);

  novo := replace(def, E'  v_novos int := 0;\nbegin',
    E'  v_novos int := 0;\n  v_lotes jsonb := ''[]''::jsonb; l jsonb;\nbegin');
  IF novo = def THEN RAISE EXCEPTION 'Não foi possível ajustar as variáveis de importar_nfe_entrada'; END IF;
  def := novo;

  novo := replace(def, E'  if v_chave is not null and exists (',
    E'  if v_chave is not null then\n    perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || '':nfe:'' || v_chave, 0));\n  end if;\n  if v_chave is not null and exists (');
  IF novo = def THEN RAISE EXCEPTION 'Não foi possível proteger a conferência da chave em importar_nfe_entrada'; END IF;
  def := novo;

  novo := replace(def, E'    v_subtotal := v_subtotal + round(v_qtd * v_custo, 2);',
    E'    v_subtotal := v_subtotal + round(v_qtd * v_custo, 2);\n    if coalesce(it->>''lote'','''') <> '''' then\n      v_lotes := v_lotes || jsonb_build_object(''produto_id'', v_prod_id, ''lote'', it->>''lote'',\n        ''tonalidade'', coalesce(it->>''tonalidade'',''''), ''calibre'', coalesce(it->>''calibre'',''''), ''quantidade'', v_qtd);\n    end if;');
  IF novo = def THEN RAISE EXCEPTION 'Não foi possível guardar os lotes em importar_nfe_entrada'; END IF;
  def := novo;

  novo := replace(def, E'  return jsonb_build_object(''compra_id'', v_compra_id,',
    E'  for l in select * from jsonb_array_elements(v_lotes) loop\n    update public.produtos set controla_lote = true where id = (l->>''produto_id'')::uuid and tenant_id = v_tenant;\n    perform public.estoque_lote_lancar((l->>''produto_id'')::uuid, p_deposito_id, l->>''lote'', l->>''tonalidade'',\n      l->>''calibre'', ''entrada'', (l->>''quantidade'')::numeric, ''NF-e '' || coalesce(p_nota->>''numero'', ''''));\n  end loop;\n\n  return jsonb_build_object(''compra_id'', v_compra_id,');
  IF novo = def THEN RAISE EXCEPTION 'Não foi possível lançar os lotes em importar_nfe_entrada'; END IF;

  EXECUTE novo;
END $$;