ALTER TABLE public.compras ADD COLUMN IF NOT EXISTS nfe_impostos jsonb;
ALTER TABLE public.compra_itens ADD COLUMN IF NOT EXISTS impostos jsonb;
ALTER TABLE public.compra_itens ADD COLUMN IF NOT EXISTS cfop text;

DO $do$
DECLARE d text := pg_get_functiondef('public.importar_nfe_entrada'::regproc);
BEGIN
  d := replace(d,
    'custo_unitario, total, observacao)
    values (v_tenant, v_compra_id, v_prod_id, v_qtd, nullif(it->>''unidade'',''''), v_custo,
      round(v_qtd * v_custo, 2), nullif(it->>''observacao'',''''))',
    'custo_unitario, total, observacao, cfop, impostos)
    values (v_tenant, v_compra_id, v_prod_id, v_qtd, nullif(it->>''unidade'',''''), v_custo,
      round(v_qtd * v_custo, 2), nullif(it->>''observacao'',''''), nullif(it->>''cfop'',''''),
      case when jsonb_typeof(it->''impostos'') = ''object'' then it->''impostos'' end)');
  d := replace(d,
    'aprovado_por = auth.uid(), aprovado_em = now()',
    'aprovado_por = auth.uid(), aprovado_em = now(),
         nfe_impostos = case when jsonb_typeof(p_nota->''impostos'') = ''object''
           then (p_nota->''impostos'') || jsonb_build_object(''total_nota'', p_nota->''total'', ''natureza'', p_nota->''natureza'') end');
  IF position('nfe_impostos' in d) = 0 OR position('cfop, impostos' in d) = 0 THEN
    RAISE EXCEPTION 'Não foi possível ajustar importar_nfe_entrada';
  END IF;
  EXECUTE d;
END $do$;