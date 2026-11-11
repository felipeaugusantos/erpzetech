-- NF-e de ajuste (finNFe 3): gera o rascunho de uma nota de ajuste de VALOR de itens de uma NF-e de venda autorizada.
-- Uso excepcional, só onde a legislação do estado prevê; por isso a rotina é protegida:
--   * SÓ administrador; motivo (e amparo legal) obrigatório, com pelo menos 15 caracteres;
--   * só nota de venda (modelo NF-e) autorizada, com chave, que não seja ela mesma de ajuste nem nota de devolução;
--   * cada item é da nota original, com valor maior que zero, sem repetir; sem frete;
--   * a transmissão pelo fluxo normal referencia a original (NFref) e envia à Sefaz.

-- colunas que esta migração usa e que as migrações 20270102 (fornecedor_id) e 20270103 (complementa_nfe_id) também
-- criam: com IF NOT EXISTS ela roda em qualquer ordem sem erro de coluna inexistente
ALTER TABLE public.nfe ADD COLUMN IF NOT EXISTS fornecedor_id uuid REFERENCES public.fornecedores(id);
ALTER TABLE public.nfe ADD COLUMN IF NOT EXISTS complementa_nfe_id uuid REFERENCES public.nfe(id);
ALTER TABLE public.nfe ADD COLUMN IF NOT EXISTS ajusta_nfe_id uuid REFERENCES public.nfe(id);
ALTER TABLE public.nfe DROP CONSTRAINT IF EXISTS nfe_complementa_ou_ajusta;
ALTER TABLE public.nfe ADD CONSTRAINT nfe_complementa_ou_ajusta CHECK (complementa_nfe_id IS NULL OR ajusta_nfe_id IS NULL);
CREATE INDEX IF NOT EXISTS nfe_ajusta_idx ON public.nfe (tenant_id, ajusta_nfe_id) WHERE ajusta_nfe_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.nfe_ajuste_gerar(
  p_nfe_id uuid,
  p_itens jsonb,
  p_motivo text
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
  v_motivo text := btrim(regexp_replace(coalesce(p_motivo, ''), '\s+', ' ', 'g'));
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem empresa vinculada'; END IF;
  PERFORM public.exige_nao_salao();
  IF NOT public.has_role(auth.uid(), 'administrador') THEN
    RAISE EXCEPTION 'Somente administrador gera nota de ajuste';
  END IF;
  IF char_length(v_motivo) < 15 THEN
    RAISE EXCEPTION 'Informe o motivo e o amparo legal do ajuste (pelo menos 15 caracteres)';
  END IF;
  IF p_itens IS NULL OR jsonb_typeof(p_itens) <> 'array' OR jsonb_array_length(p_itens) = 0 THEN
    RAISE EXCEPTION 'Informe o valor do ajuste em pelo menos um item';
  END IF;

  SELECT * INTO o FROM public.nfe WHERE id = p_nfe_id AND tenant_id = v_tenant FOR UPDATE;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Nota fiscal não encontrada'; END IF;
  IF o.situacao <> 'autorizada' THEN RAISE EXCEPTION 'Só nota autorizada pode ser ajustada'; END IF;
  IF coalesce(o.modelo, 'nfe') NOT IN ('nfe', '55') THEN RAISE EXCEPTION 'Só NF-e (modelo 55) pode ser ajustada'; END IF;
  IF o.ajusta_nfe_id IS NOT NULL THEN RAISE EXCEPTION 'Uma nota de ajuste não pode ser ajustada de novo'; END IF;
  IF o.fornecedor_id IS NOT NULL OR o.cliente_id IS NULL THEN
    RAISE EXCEPTION 'Só nota de venda a cliente pode ser ajustada por esta rotina';
  END IF;
  IF EXISTS (SELECT 1 FROM public.devolucoes WHERE nfe_id = o.id)
     OR EXISTS (SELECT 1 FROM public.compra_devolucoes WHERE nfe_id = o.id) THEN
    RAISE EXCEPTION 'Nota de devolução não pode ser ajustada por esta rotina';
  END IF;
  IF nullif(o.chave, '') IS NULL THEN RAISE EXCEPTION 'A nota original não tem chave de acesso'; END IF;

  SELECT * INTO v_cfg FROM public.fiscal_config
   WHERE tenant_id = v_tenant AND (filial_id = o.filial_id OR filial_id IS NULL)
     AND (empresa_id = o.empresa_id OR empresa_id IS NULL)
   ORDER BY filial_id NULLS LAST, empresa_id NULLS LAST LIMIT 1;
  IF v_cfg.id IS NULL THEN RAISE EXCEPTION 'Configuração fiscal não encontrada. Preencha a configuração fiscal.'; END IF;

  FOR v_it IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    v_id := nullif(v_it->>'nfe_item_id', '')::uuid;
    v_valor := round(coalesce((v_it->>'valor')::numeric, 0), 2);
    IF v_id IS NULL OR v_id = ANY (v_vistos) THEN RAISE EXCEPTION 'Item inválido ou repetido no ajuste'; END IF;
    v_vistos := v_vistos || v_id;
    IF v_valor <= 0 THEN RAISE EXCEPTION 'O valor do ajuste de cada item precisa ser maior que zero'; END IF;
    PERFORM 1 FROM public.nfe_itens WHERE id = v_id AND nfe_id = o.id AND tenant_id = v_tenant;
    IF NOT FOUND THEN RAISE EXCEPTION 'Item não pertence à nota original'; END IF;
    v_total := v_total + v_valor;
  END LOOP;

  v_numero := v_cfg.proximo_numero;
  UPDATE public.fiscal_config SET proximo_numero = proximo_numero + 1 WHERE id = v_cfg.id;

  INSERT INTO public.nfe (tenant_id, empresa_id, filial_id, pedido_id, cliente_id, deposito_id, ajusta_nfe_id,
    numero, serie, situacao, ambiente, natureza_operacao, cfop, valor_produtos, valor_frete, valor_total,
    emitente, destinatario, mensagem)
  VALUES (v_tenant, o.empresa_id, o.filial_id, o.pedido_id, o.cliente_id, o.deposito_id, o.id,
    v_numero, v_cfg.serie, 'rascunho', v_cfg.ambiente, 'Ajuste fiscal', o.cfop, v_total, 0, v_total,
    o.emitente, o.destinatario,
    'Nota de ajuste da NF-e nº ' || coalesce(o.numero::text, '') || ' — ' || left(v_motivo, 200))
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

REVOKE ALL ON FUNCTION public.nfe_ajuste_gerar(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nfe_ajuste_gerar(uuid, jsonb, text) TO authenticated;
