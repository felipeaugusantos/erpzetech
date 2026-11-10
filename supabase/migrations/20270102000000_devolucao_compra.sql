-- Devolução de compra (mercadoria devolvida ao fornecedor): baixa o estoque, abate o contas a pagar e, no modo
-- "nota", gera o rascunho da NF-e de saída de devolução (CFOP 5.202/6.202), que depois segue pela transmissão normal.
-- Regras:
--   * só administrador, gestor ou comprador registram; só compra já recebida (total ou parcialmente);
--   * nunca devolve mais do que foi recebido menos o que já foi devolvido naquele item;
--   * o modo "nota" exige a chave da NF-e de entrada (compra importada do XML): é ela que a nota de devolução
--     referencia. Compra sem chave devolve só no modo "compra" (sem nota);
--   * leitura das tabelas só da própria empresa; escrita só pela função.

ALTER TABLE public.fornecedores ADD COLUMN IF NOT EXISTS inscricao_estadual text;
ALTER TABLE public.nfe ADD COLUMN IF NOT EXISTS fornecedor_id uuid REFERENCES public.fornecedores(id);
ALTER TABLE public.nfe ADD COLUMN IF NOT EXISTS compra_id uuid REFERENCES public.compras(id);

CREATE TABLE IF NOT EXISTS public.compra_devolucoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  empresa_id uuid,
  filial_id uuid,
  numero integer NOT NULL,
  compra_id uuid NOT NULL REFERENCES public.compras(id),
  fornecedor_id uuid REFERENCES public.fornecedores(id),
  deposito_id uuid NOT NULL REFERENCES public.depositos(id),
  modo text NOT NULL DEFAULT 'compra' CHECK (modo IN ('compra', 'nota')),
  motivo text,
  valor_total numeric(14,2) NOT NULL DEFAULT 0,
  valor_abatido numeric(14,2) NOT NULL DEFAULT 0,
  nfe_id uuid REFERENCES public.nfe(id),
  usuario_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS compra_devolucoes_numero_uq ON public.compra_devolucoes (tenant_id, numero);
CREATE INDEX IF NOT EXISTS compra_devolucoes_compra_idx ON public.compra_devolucoes (tenant_id, compra_id);

CREATE TABLE IF NOT EXISTS public.compra_devolucao_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  devolucao_id uuid NOT NULL REFERENCES public.compra_devolucoes(id) ON DELETE CASCADE,
  compra_item_id uuid NOT NULL REFERENCES public.compra_itens(id),
  produto_id uuid NOT NULL REFERENCES public.produtos(id),
  quantidade numeric NOT NULL CHECK (quantidade > 0),
  unidade text,
  custo_unitario numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS compra_devolucao_itens_item_idx ON public.compra_devolucao_itens (compra_item_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['compra_devolucoes', 'compra_devolucao_itens'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id())', t || '_leitura', t);
    EXECUTE format('CREATE POLICY salao_restrito ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()))', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.compra_devolucao_registrar(
  p_compra_id uuid,
  p_itens jsonb,
  p_modo text DEFAULT 'compra',
  p_motivo text DEFAULT NULL,
  p_abater_pagar boolean DEFAULT true
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  c public.compras; ci public.compra_itens;
  v_forn public.fornecedores; v_emp public.empresas; v_fil public.filiais; v_cfg public.fiscal_config;
  v_dev_id uuid; v_num integer; v_it jsonb; v_qtd numeric; v_devolvido numeric;
  v_total numeric := 0; v_abater numeric; v_aplicar numeric; v_abatido numeric := 0; v_conta record;
  v_nfe_id uuid; v_numero integer; v_interestadual boolean;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem empresa vinculada'; END IF;
  PERFORM public.exige_nao_salao();
  IF NOT (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')
          OR public.has_role(auth.uid(), 'comprador')) THEN
    RAISE EXCEPTION 'Somente administrador, gestor ou comprador registra devolução de compra';
  END IF;
  IF p_modo NOT IN ('compra', 'nota') THEN RAISE EXCEPTION 'Modo de devolução inválido'; END IF;
  IF p_itens IS NULL OR jsonb_typeof(p_itens) <> 'array' OR jsonb_array_length(p_itens) = 0 THEN
    RAISE EXCEPTION 'Escolha os itens devolvidos';
  END IF;

  SELECT * INTO c FROM public.compras WHERE id = p_compra_id AND tenant_id = v_tenant FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Compra não encontrada nesta empresa'; END IF;
  IF c.situacao NOT IN ('recebido', 'parcialmente_recebido') THEN
    RAISE EXCEPTION 'Só compra já recebida pode ser devolvida ao fornecedor';
  END IF;
  IF p_modo = 'nota' THEN
    IF nullif(c.nfe_chave, '') IS NULL THEN
      RAISE EXCEPTION 'Esta compra não tem a chave da NF-e de entrada, que a nota de devolução precisa referenciar. Registre a devolução sem nota.';
    END IF;
    IF c.fornecedor_id IS NULL THEN RAISE EXCEPTION 'A compra não tem fornecedor'; END IF;
  END IF;

  SELECT coalesce(max(numero), 0) + 1 INTO v_num FROM public.compra_devolucoes WHERE tenant_id = v_tenant;

  INSERT INTO public.compra_devolucoes (tenant_id, empresa_id, filial_id, numero, compra_id, fornecedor_id,
    deposito_id, modo, motivo, usuario_id)
  VALUES (v_tenant, c.empresa_id, c.filial_id, v_num, c.id, c.fornecedor_id, c.deposito_id, p_modo,
    nullif(btrim(p_motivo), ''), auth.uid())
  RETURNING id INTO v_dev_id;

  FOR v_it IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    v_qtd := coalesce((v_it->>'quantidade')::numeric, 0);
    IF v_qtd <= 0 THEN CONTINUE; END IF;

    SELECT * INTO ci FROM public.compra_itens
     WHERE id = (v_it->>'compra_item_id')::uuid AND compra_id = c.id AND tenant_id = v_tenant;
    IF ci.id IS NULL THEN RAISE EXCEPTION 'Item da compra não encontrado'; END IF;

    SELECT coalesce(sum(di.quantidade), 0) INTO v_devolvido
      FROM public.compra_devolucao_itens di WHERE di.compra_item_id = ci.id;
    IF v_qtd > (ci.quantidade_recebida - v_devolvido) + 0.0001 THEN
      RAISE EXCEPTION 'Quantidade devolvida maior que a recebida e ainda não devolvida no item';
    END IF;

    INSERT INTO public.compra_devolucao_itens (tenant_id, devolucao_id, compra_item_id, produto_id, quantidade,
      unidade, custo_unitario, total)
    VALUES (v_tenant, v_dev_id, ci.id, ci.produto_id, v_qtd, ci.unidade, ci.custo_unitario,
      round(v_qtd * ci.custo_unitario, 2));

    -- baixa do estoque do depósito que recebeu a compra (recusa se faltar saldo e o depósito não permitir negativo)
    PERFORM public.registrar_movimentacao(
      p_produto_id => ci.produto_id, p_deposito_id => c.deposito_id, p_tipo => 'saida'::public.mov_tipo,
      p_quantidade => v_qtd, p_motivo => 'Devolução ao fornecedor, compra nº ' || c.numero,
      p_documento => 'DVC-' || v_num, p_deposito_destino_id => NULL, p_custo => NULL);

    v_total := v_total + round(v_qtd * ci.custo_unitario, 2);
  END LOOP;

  IF v_total <= 0 THEN RAISE EXCEPTION 'Nenhum item válido para devolução'; END IF;

  -- abate o valor devolvido nos títulos em aberto da compra, dos mais distantes para os mais próximos
  IF p_abater_pagar THEN
    v_abater := v_total;
    FOR v_conta IN
      SELECT * FROM public.contas_pagar
       WHERE compra_id = c.id AND tenant_id = v_tenant AND situacao IN ('aberto', 'parcial')
       ORDER BY vencimento DESC
    LOOP
      EXIT WHEN v_abater <= 0;
      v_aplicar := least(v_abater, v_conta.valor - v_conta.valor_pago);
      IF v_aplicar <= 0 THEN CONTINUE; END IF;
      IF v_aplicar >= (v_conta.valor - v_conta.valor_pago) THEN
        UPDATE public.contas_pagar
           SET valor = greatest(v_conta.valor_pago, v_conta.valor - v_aplicar),
               situacao = CASE WHEN v_conta.valor_pago > 0 THEN 'pago'::public.conta_situacao ELSE 'cancelado'::public.conta_situacao END,
               observacoes = concat_ws(' · ', observacoes, 'Abatido pela devolução de compra nº ' || v_num)
         WHERE id = v_conta.id;
      ELSE
        UPDATE public.contas_pagar
           SET valor = v_conta.valor - v_aplicar,
               observacoes = concat_ws(' · ', observacoes, 'Abatido pela devolução de compra nº ' || v_num)
         WHERE id = v_conta.id;
      END IF;
      v_abatido := v_abatido + v_aplicar;
      v_abater := v_abater - v_aplicar;
    END LOOP;
  END IF;

  -- rascunho da NF-e de saída de devolução (a transmissão faz o resto)
  IF p_modo = 'nota' THEN
    SELECT * INTO v_forn FROM public.fornecedores WHERE id = c.fornecedor_id AND tenant_id = v_tenant;
    SELECT * INTO v_emp FROM public.empresas WHERE id = c.empresa_id AND tenant_id = v_tenant;
    IF v_emp.id IS NULL THEN RAISE EXCEPTION 'Empresa emitente da compra não encontrada'; END IF;
    SELECT * INTO v_fil FROM public.filiais WHERE id = c.filial_id;
    SELECT * INTO v_cfg FROM public.fiscal_config
     WHERE tenant_id = v_tenant AND (filial_id = c.filial_id OR filial_id IS NULL)
       AND (empresa_id = v_emp.id OR empresa_id IS NULL)
     ORDER BY filial_id NULLS LAST, empresa_id NULLS LAST LIMIT 1;
    IF v_cfg.id IS NULL THEN
      INSERT INTO public.fiscal_config (tenant_id, empresa_id) VALUES (v_tenant, v_emp.id) RETURNING * INTO v_cfg;
    END IF;

    v_numero := v_cfg.proximo_numero;
    UPDATE public.fiscal_config SET proximo_numero = proximo_numero + 1 WHERE id = v_cfg.id;
    v_interestadual := upper(coalesce(v_emp.estado, '')) <> upper(coalesce(v_forn.estado, ''));

    INSERT INTO public.nfe (tenant_id, empresa_id, filial_id, fornecedor_id, compra_id, deposito_id, numero, serie,
      situacao, ambiente, natureza_operacao, cfop, valor_produtos, valor_total, emitente, destinatario, mensagem)
    VALUES (v_tenant, v_emp.id, c.filial_id, c.fornecedor_id, c.id, c.deposito_id, v_numero, v_cfg.serie,
      'rascunho', v_cfg.ambiente, 'Devolução de compra', CASE WHEN v_interestadual THEN '6202' ELSE '5202' END,
      v_total, v_total,
      jsonb_build_object('razao_social', v_emp.razao_social, 'cnpj', v_emp.cnpj,
        'inscricao_estadual', v_emp.inscricao_estadual, 'endereco', v_emp.endereco,
        'numero', v_emp.numero, 'bairro', v_emp.bairro, 'cidade', v_emp.cidade,
        'estado', v_emp.estado, 'cep', v_emp.cep, 'filial', v_fil.nome),
      jsonb_build_object('nome', v_forn.razao_social, 'tipo', 'juridica', 'cnpj', v_forn.cnpj,
        'inscricao_estadual', v_forn.inscricao_estadual, 'endereco', v_forn.endereco, 'numero', v_forn.numero,
        'bairro', v_forn.bairro, 'cidade', v_forn.cidade, 'estado', v_forn.estado, 'cep', v_forn.cep,
        'telefone', v_forn.telefone, 'email', v_forn.email),
      'Nota de devolução de compra gerada pela devolução nº ' || v_num)
    RETURNING id INTO v_nfe_id;

    INSERT INTO public.nfe_itens (tenant_id, nfe_id, produto_id, codigo, descricao, ncm, cfop, cst_csosn,
      unidade, quantidade, preco_unitario, custo_unitario, total, aliquota_icms)
    SELECT v_tenant, v_nfe_id, p.id, p.codigo_interno, p.descricao, p.ncm,
           coalesce(ci2.cfop, CASE WHEN v_interestadual THEN '6202' ELSE '5202' END), p.cst_csosn,
           coalesce(di.unidade, p.unidade), di.quantidade, di.custo_unitario, di.custo_unitario, di.total,
           p.aliquota_icms
      FROM public.compra_devolucao_itens di
      JOIN public.produtos p ON p.id = di.produto_id
      JOIN public.compra_itens ci2 ON ci2.id = di.compra_item_id
     WHERE di.devolucao_id = v_dev_id
     ORDER BY ci2.created_at, di.id;

    UPDATE public.compra_devolucoes SET nfe_id = v_nfe_id WHERE id = v_dev_id;
    PERFORM public.nfe_calcular_impostos(v_nfe_id, NULL, NULL, NULL, NULL, NULL, false);
  END IF;

  UPDATE public.compra_devolucoes SET valor_total = v_total, valor_abatido = v_abatido WHERE id = v_dev_id;
  RETURN v_dev_id;
END $$;

REVOKE ALL ON FUNCTION public.compra_devolucao_registrar(uuid, jsonb, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compra_devolucao_registrar(uuid, jsonb, text, text, boolean) TO authenticated;
