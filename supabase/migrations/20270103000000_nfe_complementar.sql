-- NF-e complementar (finNFe 2): gera o rascunho que complementa o VALOR de itens de uma NF-e de venda autorizada.
-- Regras:
--   * só administrador, gestor ou financeiro; só nota de venda (modelo NF-e) autorizada, com chave, que não seja ela
--     mesma complementar nem nota de devolução (de venda ou de compra);
--   * cada item complementado é da nota original, com valor maior que zero, sem repetir;
--   * o rascunho copia emitente, destinatário e dados fiscais do item; quantidade 1 e preço = valor complementado
--     (a transmissão envia quantidade e valor unitário zerados, com o valor em vProd);
--   * a transmissão pelo fluxo normal é que referencia a original (NFref) e envia à Sefaz.

ALTER TABLE public.nfe ADD COLUMN IF NOT EXISTS complementa_nfe_id uuid REFERENCES public.nfe(id);
CREATE INDEX IF NOT EXISTS nfe_complementa_idx ON public.nfe (tenant_id, complementa_nfe_id) WHERE complementa_nfe_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.nfe_complementar_gerar(
  p_nfe_id uuid,
  p_itens jsonb,
  p_motivo text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  o public.nfe; v_cfg public.fiscal_config;
  v_it jsonb; v_item public.nfe_itens; v_valor numeric; v_total numeric := 0;
  v_novo uuid; v_numero integer; v_vistos uuid[] := ARRAY[]::uuid[]; v_id uuid;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem empresa vinculada'; END IF;
  PERFORM public.exige_nao_salao();
  IF NOT (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')
          OR public.has_role(auth.uid(), 'financeiro')) THEN
    RAISE EXCEPTION 'Somente administrador, gestor ou financeiro gera nota complementar';
  END IF;
  IF p_itens IS NULL OR jsonb_typeof(p_itens) <> 'array' OR jsonb_array_length(p_itens) = 0 THEN
    RAISE EXCEPTION 'Informe o valor a complementar em pelo menos um item';
  END IF;

  SELECT * INTO o FROM public.nfe WHERE id = p_nfe_id AND tenant_id = v_tenant FOR UPDATE;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Nota fiscal não encontrada'; END IF;
  IF o.situacao <> 'autorizada' THEN RAISE EXCEPTION 'Só nota autorizada pode ser complementada'; END IF;
  IF coalesce(o.modelo, 'nfe') NOT IN ('nfe', '55') THEN RAISE EXCEPTION 'Só NF-e (modelo 55) pode ser complementada'; END IF;
  IF o.complementa_nfe_id IS NOT NULL THEN RAISE EXCEPTION 'Uma nota complementar não pode ser complementada de novo'; END IF;
  IF o.fornecedor_id IS NOT NULL OR o.cliente_id IS NULL THEN
    RAISE EXCEPTION 'Só nota de venda a cliente pode ser complementada por esta rotina';
  END IF;
  IF EXISTS (SELECT 1 FROM public.devolucoes WHERE nfe_id = o.id)
     OR EXISTS (SELECT 1 FROM public.compra_devolucoes WHERE nfe_id = o.id) THEN
    RAISE EXCEPTION 'Nota de devolução não pode ser complementada por esta rotina';
  END IF;
  IF nullif(o.chave, '') IS NULL THEN RAISE EXCEPTION 'A nota original não tem chave de acesso'; END IF;

  SELECT * INTO v_cfg FROM public.fiscal_config
   WHERE tenant_id = v_tenant AND (filial_id = o.filial_id OR filial_id IS NULL)
     AND (empresa_id = o.empresa_id OR empresa_id IS NULL)
   ORDER BY filial_id NULLS LAST, empresa_id NULLS LAST LIMIT 1;
  IF v_cfg.id IS NULL THEN RAISE EXCEPTION 'Configuração fiscal não encontrada. Preencha a configuração fiscal.'; END IF;

  -- confere os itens e soma o total antes de criar a nota
  FOR v_it IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    v_id := nullif(v_it->>'nfe_item_id', '')::uuid;
    v_valor := round(coalesce((v_it->>'valor')::numeric, 0), 2);
    IF v_id IS NULL OR v_id = ANY (v_vistos) THEN RAISE EXCEPTION 'Item inválido ou repetido na complementar'; END IF;
    v_vistos := v_vistos || v_id;
    IF v_valor <= 0 THEN RAISE EXCEPTION 'O valor a complementar de cada item precisa ser maior que zero'; END IF;
    PERFORM 1 FROM public.nfe_itens WHERE id = v_id AND nfe_id = o.id AND tenant_id = v_tenant;
    IF NOT FOUND THEN RAISE EXCEPTION 'Item não pertence à nota original'; END IF;
    v_total := v_total + v_valor;
  END LOOP;

  v_numero := v_cfg.proximo_numero;
  UPDATE public.fiscal_config SET proximo_numero = proximo_numero + 1 WHERE id = v_cfg.id;

  INSERT INTO public.nfe (tenant_id, empresa_id, filial_id, pedido_id, cliente_id, deposito_id, complementa_nfe_id,
    numero, serie, situacao, ambiente, natureza_operacao, cfop, valor_produtos, valor_total,
    emitente, destinatario, mensagem)
  VALUES (v_tenant, o.empresa_id, o.filial_id, o.pedido_id, o.cliente_id, o.deposito_id, o.id,
    v_numero, v_cfg.serie, 'rascunho', v_cfg.ambiente, 'Complemento de valores', o.cfop, v_total, v_total,
    o.emitente, o.destinatario,
    'Nota complementar da NF-e nº ' || coalesce(o.numero::text, '') || coalesce(' — ' || nullif(btrim(p_motivo), ''), ''))
  RETURNING id INTO v_novo;

  FOR v_it IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    v_valor := round((v_it->>'valor')::numeric, 2);
    SELECT * INTO v_item FROM public.nfe_itens WHERE id = (v_it->>'nfe_item_id')::uuid AND nfe_id = o.id;
    INSERT INTO public.nfe_itens (tenant_id, nfe_id, produto_id, codigo, descricao, ncm, cfop, cst_csosn, unidade,
      quantidade, preco_unitario, custo_unitario, total, aliquota_icms, aliquota_pis, aliquota_cofins,
      cst_pis, cst_cofins)
    VALUES (v_tenant, v_novo, v_item.produto_id, v_item.codigo, v_item.descricao, v_item.ncm, v_item.cfop,
      v_item.cst_csosn, v_item.unidade, 1, v_valor, 0, v_valor, v_item.aliquota_icms, v_item.aliquota_pis,
      v_item.aliquota_cofins, v_item.cst_pis, v_item.cst_cofins);
  END LOOP;

  PERFORM public.nfe_calcular_impostos(v_novo, NULL, NULL, NULL, NULL, NULL, false);
  RETURN v_novo;
END $$;

REVOKE ALL ON FUNCTION public.nfe_complementar_gerar(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nfe_complementar_gerar(uuid, jsonb, text) TO authenticated;
