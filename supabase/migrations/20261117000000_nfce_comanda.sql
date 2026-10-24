-- NFC-e da comanda do restaurante.
-- A comanda não tem pedido, então a nota nasce direto dela (como a locação, que usa nfe.locacao_id).
-- Itens: cada item da comanda leva o NCM, CFOP e CST/CSOSN do produto ligado ao item do cardápio; item sem produto vira pendência.
-- Taxa de serviço e couvert não são mercadoria: entram na nota como "outras despesas" (valor_outras_despesas), para o total da
-- nota ser o que o cliente pagou. Quem emite confirma esse tratamento com o contador antes de transmitir.

ALTER TABLE public.nfe ADD COLUMN IF NOT EXISTS comanda_id uuid REFERENCES public.comandas (id) ON DELETE SET NULL;
ALTER TABLE public.nfe ADD COLUMN IF NOT EXISTS valor_outras_despesas numeric NOT NULL DEFAULT 0;

-- uma comanda leva uma NFC-e viva por vez (cancelada libera outra)
CREATE UNIQUE INDEX IF NOT EXISTS nfe_comanda_nfce_uk ON public.nfe (comanda_id)
  WHERE comanda_id IS NOT NULL AND modelo = 'nfce' AND situacao <> 'cancelada';

CREATE OR REPLACE FUNCTION public.nfce_criar_comanda(p_comanda_id uuid, p_cpf text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_cmd record;
  v_emp record;
  v_fil record;
  v_cfg record;
  v_nc record;
  v_item record;
  v_existente uuid;
  v_sit_existente text;
  v_nfe uuid;
  v_cpf text := nullif(regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g'), '');
  v_pend text[] := '{}';
  v_numero integer;
  v_prod numeric := 0;
  v_outras numeric;
  v_total numeric;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'financeiro', 'caixa']);
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem empresa vinculada'; END IF;

  -- trava por comanda: duas chamadas ao mesmo tempo não criam duas notas
  PERFORM pg_advisory_xact_lock(hashtextextended('nfce-comanda:' || p_comanda_id::text, 0));
  SELECT * INTO v_cmd FROM public.comandas WHERE id = p_comanda_id AND tenant_id = v_tenant;
  IF v_cmd IS NULL THEN RAISE EXCEPTION 'Comanda não encontrada'; END IF;
  IF NOT public.pode_filial(v_cmd.filial_id) THEN RAISE EXCEPTION 'Comanda não encontrada'; END IF;
  IF v_cmd.situacao = 'cancelada' THEN RAISE EXCEPTION 'Comanda cancelada não emite nota'; END IF;
  IF v_cmd.situacao <> 'fechada' THEN RAISE EXCEPTION 'Feche a conta da comanda antes de emitir a NFC-e'; END IF;

  SELECT n.id, n.situacao INTO v_existente, v_sit_existente
    FROM public.nfe n
   WHERE n.comanda_id = p_comanda_id AND n.modelo = 'nfce' AND n.situacao <> 'cancelada'
   LIMIT 1;
  IF v_existente IS NOT NULL THEN
    IF v_sit_existente <> 'rascunho' THEN RETURN v_existente; END IF;
    -- rascunho (ainda sem número): refaz com os dados de agora, para a pendência resolvida sair da lista
    DELETE FROM public.nfe WHERE id = v_existente;
  END IF;

  SELECT * INTO v_fil FROM public.filiais WHERE id = v_cmd.filial_id;
  SELECT * INTO v_emp FROM public.empresas WHERE tenant_id = v_tenant AND id = v_fil.empresa_id;
  IF v_emp IS NULL THEN
    SELECT e.* INTO v_emp FROM public.empresas e JOIN public.profiles p ON p.empresa_id = e.id
     WHERE p.id = auth.uid() AND e.tenant_id = v_tenant;
  END IF;
  IF v_emp IS NULL THEN
    SELECT * INTO v_emp FROM public.empresas WHERE tenant_id = v_tenant ORDER BY created_at, id LIMIT 1;
  END IF;
  IF v_emp IS NULL THEN RAISE EXCEPTION 'Empresa emitente não encontrada'; END IF;

  SELECT * INTO v_cfg FROM public.fiscal_config
   WHERE tenant_id = v_tenant
     AND (empresa_id = v_emp.id OR empresa_id IS NULL)
     AND (filial_id = v_cmd.filial_id OR filial_id IS NULL)
   ORDER BY (filial_id IS NOT NULL) DESC, empresa_id NULLS LAST
   LIMIT 1;
  IF v_cfg IS NULL THEN
    INSERT INTO public.fiscal_config (tenant_id, empresa_id) VALUES (v_tenant, v_emp.id) RETURNING * INTO v_cfg;
  END IF;

  INSERT INTO public.nfce_config (tenant_id, fiscal_config_id) VALUES (v_tenant, v_cfg.id)
  ON CONFLICT (fiscal_config_id) DO NOTHING;
  SELECT * INTO v_nc FROM public.nfce_config WHERE fiscal_config_id = v_cfg.id FOR UPDATE;

  IF v_cpf IS NOT NULL AND length(v_cpf) <> 11 THEN
    v_pend := array_append(v_pend, 'CPF do consumidor inválido');
  END IF;
  IF coalesce(nullif(v_fil.cnpj, ''), v_emp.cnpj, '') = ''
       OR coalesce(nullif(v_fil.inscricao_estadual, ''), v_emp.inscricao_estadual, '') = '' THEN
    v_pend := array_append(v_pend, 'CNPJ ou inscrição estadual da empresa ausente');
  END IF;
  IF coalesce(nullif(v_fil.estado, ''), v_emp.estado, '') = '' THEN
    v_pend := array_append(v_pend, 'UF da empresa ausente');
  END IF;
  IF coalesce(v_cfg.certificado_nome, '') = '' THEN
    v_pend := array_append(v_pend, 'Certificado digital A1 não configurado');
  END IF;
  IF coalesce(v_cfg.emissor, '') = '' THEN
    v_pend := array_append(v_pend, 'Emissor fiscal (API) não configurado');
  END IF;
  IF coalesce(v_nc.csc_id, '') = '' OR coalesce(v_nc.csc_token, '') = '' THEN
    v_pend := array_append(v_pend, 'CSC da NFC-e (código e token) não configurado');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.comanda_itens WHERE comanda_id = p_comanda_id AND situacao <> 'cancelado') THEN
    v_pend := array_append(v_pend, 'A comanda não tem itens');
  END IF;

  FOR v_item IN SELECT i.total, i.nome, p.id AS produto_id, p.ncm, p.cfop, p.cst_csosn
                  FROM public.comanda_itens i
                  LEFT JOIN public.cardapio_itens c ON c.id = i.cardapio_item_id
                  LEFT JOIN public.produtos p ON p.id = c.produto_id AND p.tenant_id = v_tenant
                 WHERE i.comanda_id = p_comanda_id AND i.situacao <> 'cancelado' LOOP
    IF v_item.produto_id IS NULL THEN
      v_pend := array_append(v_pend, 'Item do cardápio sem produto fiscal: ' || v_item.nome);
    ELSE
      IF coalesce(v_item.ncm, '') = '' THEN
        v_pend := array_append(v_pend, 'NCM ausente no produto de ' || v_item.nome);
      END IF;
      IF coalesce(v_item.cfop, v_cfg.cfop_padrao, '') = '' THEN
        v_pend := array_append(v_pend, 'CFOP ausente no produto de ' || v_item.nome);
      END IF;
      IF coalesce(v_item.cst_csosn, '') = '' THEN
        v_pend := array_append(v_pend, 'CST/CSOSN ausente no produto de ' || v_item.nome);
      END IF;
    END IF;
    v_prod := v_prod + v_item.total;
  END LOOP;

  v_outras := coalesce(v_cmd.couvert, 0) + coalesce(v_cmd.taxa_servico, 0);
  v_total := coalesce(v_cmd.total, 0);
  IF v_total <= 0 THEN
    v_pend := array_append(v_pend, 'Valor total da venda deve ser maior que zero');
  ELSIF v_prod + v_outras - coalesce(v_cmd.desconto, 0) <> v_total THEN
    v_pend := array_append(v_pend, 'Os itens da comanda não fecham com o total da conta');
  END IF;

  IF array_length(v_pend, 1) IS NULL THEN
    v_numero := v_nc.proximo_numero;
    UPDATE public.nfce_config SET proximo_numero = proximo_numero + 1 WHERE id = v_nc.id;
  END IF;

  INSERT INTO public.nfe (
    tenant_id, empresa_id, filial_id, comanda_id, modelo,
    numero, serie, situacao, ambiente, natureza_operacao, cfop,
    valor_produtos, valor_desconto, valor_frete, valor_outras_despesas, valor_total,
    emitente, destinatario, pendencias, mensagem, contingencia
  ) VALUES (
    v_tenant, v_emp.id, v_cmd.filial_id, p_comanda_id, 'nfce',
    v_numero, v_nc.serie,
    CASE WHEN array_length(v_pend, 1) IS NULL THEN 'pronta' ELSE 'rascunho' END,
    v_cfg.ambiente, 'Venda de mercadoria ao consumidor', v_cfg.cfop_padrao,
    v_prod, coalesce(v_cmd.desconto, 0), 0, v_outras, v_total,
    jsonb_build_object('razao_social', v_emp.razao_social, 'cnpj', coalesce(nullif(v_fil.cnpj, ''), v_emp.cnpj),
      'inscricao_estadual', coalesce(nullif(v_fil.inscricao_estadual, ''), v_emp.inscricao_estadual), 'endereco', coalesce(nullif(v_fil.endereco, ''), v_emp.endereco),
      'numero', coalesce(nullif(v_fil.numero, ''), v_emp.numero), 'bairro', coalesce(nullif(v_fil.bairro, ''), v_emp.bairro), 'cidade', coalesce(nullif(v_fil.cidade, ''), v_emp.cidade),
      'estado', coalesce(nullif(v_fil.estado, ''), v_emp.estado), 'cep', coalesce(nullif(v_fil.cep, ''), v_emp.cep), 'filial', v_fil.nome),
    CASE WHEN v_cpf IS NULL THEN jsonb_build_object('consumidor', 'não identificado')
         ELSE jsonb_build_object('consumidor', 'identificado', 'cpf', v_cpf) END,
    v_pend,
    CASE WHEN array_length(v_pend, 1) IS NULL
      THEN 'NFC-e pronta para transmissão. Falta apenas a transmissão pelo emissor fiscal.'
      ELSE 'NFC-e em rascunho: resolva as pendências listadas.' END,
    v_nc.contingencia_ativa
  ) RETURNING id INTO v_nfe;

  INSERT INTO public.nfe_itens (
    tenant_id, nfe_id, produto_id, codigo, descricao, ncm, cfop, cst_csosn,
    unidade, quantidade, preco_unitario, custo_unitario, desconto, total, aliquota_icms
  )
  SELECT v_tenant, v_nfe, p.id, p.codigo_interno, i.nome, p.ncm,
         coalesce(p.cfop, v_cfg.cfop_padrao), p.cst_csosn,
         coalesce(p.unidade, 'un'), i.quantidade, i.preco_unitario, 0,
         0, i.total, coalesce(p.aliquota_icms, 0)
    FROM public.comanda_itens i
    LEFT JOIN public.cardapio_itens c ON c.id = i.cardapio_item_id
    LEFT JOIN public.produtos p ON p.id = c.produto_id AND p.tenant_id = v_tenant
   WHERE i.comanda_id = p_comanda_id AND i.situacao <> 'cancelado';

  PERFORM public.nfe_calcular_impostos(v_nfe);

  RETURN v_nfe;
END $$;

REVOKE ALL ON FUNCTION public.nfce_criar_comanda(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nfce_criar_comanda(uuid, text) TO authenticated;
