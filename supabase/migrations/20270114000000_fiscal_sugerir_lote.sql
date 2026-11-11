-- Parametrização fiscal por NCM (plano em docs/parametrizacao-fiscal.md, PR 6): sugestão em lote para a tela Fiscal dos produtos.
-- Consulta vários NCMs de uma vez, cada um pela mesma função fiscal_sugerir (mesma precedência: sobrescrita da empresa, regra global,
-- ocultações, vigência, empate). Só leitura: não grava nada. A tela Fiscal coloca o que a pessoa escolher aplicar como edição em rascunho
-- e só o botão Salvar existente grava no produto.
-- Entrada: p_itens = [{ "ncm": "23091000", "cest": "0100100" }, ...] (cest opcional), até 300 itens.
-- Retorno: { regime: simples | mei | normal, itens: [{ ncm, cest, resultado: <retorno de fiscal_sugerir> }] } na ordem da entrada.
-- Qualquer pessoa da empresa, exceto o perfil restrito do salão (como fiscal_sugerir).
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
  v_regime text;
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

  SELECT e.regime_tributario INTO v_regime_empresa FROM public.empresas e
   WHERE e.tenant_id = v_tenant ORDER BY e.created_at, e.id LIMIT 1;
  v_regime := CASE v_regime_empresa WHEN 'simples' THEN 'simples' WHEN 'mei' THEN 'mei' ELSE 'normal' END;

  FOR it IN SELECT e FROM jsonb_array_elements(p_itens) AS t(e) LOOP
    IF jsonb_typeof(it) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Item da lista inválido'; END IF;
    v_ncm := it ->> 'ncm';
    v_cest := nullif(btrim(it ->> 'cest'), '');
    v_res := v_res || jsonb_build_object(
      'ncm', v_ncm, 'cest', v_cest,
      'resultado', public.fiscal_sugerir(v_ncm, v_cest, 'venda', NULL, NULL, NULL));
  END LOOP;
  RETURN jsonb_build_object('regime', v_regime, 'itens', v_res);
END $fn$;
REVOKE ALL ON FUNCTION public.fiscal_sugerir_lote(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fiscal_sugerir_lote(jsonb) TO authenticated;
