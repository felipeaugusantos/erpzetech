-- Uma configuração fiscal por empresa (padrão) e uma por filial.
CREATE UNIQUE INDEX IF NOT EXISTS fiscal_config_empresa_filial_uk
  ON public.fiscal_config (tenant_id, empresa_id, filial_id)
  WHERE filial_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS fiscal_config_empresa_padrao_uk
  ON public.fiscal_config (tenant_id, empresa_id)
  WHERE filial_id IS NULL;

CREATE OR REPLACE FUNCTION public.gerar_nfe_agrupada(p_pedido_ids uuid[], p_natureza text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_ped record;
  v_cli record;
  v_emp record;
  v_fil record;
  v_cfg record;
  v_nfe_id uuid;
  v_numero integer;
  v_pend text[] := ARRAY[]::text[];
  v_prod numeric := 0;
  v_desc numeric := 0;
  v_frete numeric := 0;
  v_total numeric := 0;
  v_item record;
  v_doc text;
  v_qtd integer;
  v_pid uuid;
BEGIN
  IF p_pedido_ids IS NULL OR array_length(p_pedido_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Escolha pelo menos um pedido';
  END IF;

  SELECT count(*) INTO v_qtd FROM pedidos
   WHERE id = ANY(p_pedido_ids) AND tenant_id = current_tenant_id();
  IF v_qtd <> array_length(p_pedido_ids, 1) THEN
    RAISE EXCEPTION 'Pedido não encontrado';
  END IF;

  IF EXISTS (SELECT 1 FROM pedidos WHERE id = ANY(p_pedido_ids) AND situacao = 'cancelado') THEN
    RAISE EXCEPTION 'Pedido cancelado não emite nota';
  END IF;

  IF (SELECT count(DISTINCT cliente_id) FROM pedidos WHERE id = ANY(p_pedido_ids)) > 1 THEN
    RAISE EXCEPTION 'Os pedidos precisam ser do mesmo cliente';
  END IF;

  IF (SELECT count(DISTINCT deposito_id) FROM pedidos WHERE id = ANY(p_pedido_ids)) > 1 THEN
    RAISE EXCEPTION 'Os pedidos precisam sair do mesmo depósito';
  END IF;

  IF EXISTS (
    SELECT 1 FROM nfe_pedidos np JOIN nfe n ON n.id = np.nfe_id
     WHERE np.pedido_id = ANY(p_pedido_ids) AND n.situacao <> 'cancelada'
  ) THEN
    RAISE EXCEPTION 'Um dos pedidos já tem nota fiscal gerada';
  END IF;

  SELECT * INTO v_ped FROM pedidos WHERE id = ANY(p_pedido_ids) ORDER BY numero LIMIT 1;
  SELECT * INTO v_cli FROM clientes WHERE id = v_ped.cliente_id;
  SELECT * INTO v_emp FROM empresas WHERE id = COALESCE(v_ped.empresa_id, v_cli.empresa_id);
  SELECT * INTO v_fil FROM filiais WHERE id = v_ped.filial_id;

  -- Configuração da filial do pedido; se não houver, a padrão da empresa.
  SELECT * INTO v_cfg FROM fiscal_config
   WHERE tenant_id = current_tenant_id()
     AND (empresa_id = v_emp.id OR empresa_id IS NULL)
     AND (filial_id = v_ped.filial_id OR filial_id IS NULL)
   ORDER BY (filial_id IS NOT NULL) DESC, empresa_id NULLS LAST
   LIMIT 1;

  IF v_cfg IS NULL THEN
    INSERT INTO fiscal_config (tenant_id, empresa_id) VALUES (current_tenant_id(), v_emp.id)
    RETURNING * INTO v_cfg;
  END IF;

  v_doc := COALESCE(v_cli.cnpj, v_cli.cpf);
  IF v_doc IS NULL OR length(regexp_replace(v_doc, '\D', '', 'g')) NOT IN (11, 14) THEN
    v_pend := array_append(v_pend, 'CPF/CNPJ do cliente inválido ou ausente');
  END IF;
  IF COALESCE(v_cli.endereco, '') = '' OR COALESCE(v_cli.cidade, '') = '' OR COALESCE(v_cli.estado, '') = '' OR COALESCE(v_cli.cep, '') = '' THEN
    v_pend := array_append(v_pend, 'Endereço completo do cliente incompleto');
  END IF;
  IF v_cli.tipo::text = 'PJ' AND COALESCE(v_cli.inscricao_estadual, '') = '' THEN
    v_pend := array_append(v_pend, 'Inscrição estadual do cliente ausente');
  END IF;
  IF v_emp IS NULL OR COALESCE(v_emp.cnpj, '') = '' OR COALESCE(v_emp.inscricao_estadual, '') = '' THEN
    v_pend := array_append(v_pend, 'CNPJ ou inscrição estadual da empresa ausente');
  END IF;
  IF COALESCE(v_cfg.certificado_nome, '') = '' THEN
    v_pend := array_append(v_pend, 'Certificado digital A1 não configurado');
  END IF;
  IF COALESCE(v_cfg.emissor, '') = '' THEN
    v_pend := array_append(v_pend, 'Emissor fiscal (API) não configurado');
  END IF;

  FOR v_item IN SELECT i.*, p.ncm, p.codigo_interno, p.cfop, p.cst_csosn
                  FROM pedido_itens i JOIN produtos p ON p.id = i.produto_id
                 WHERE i.pedido_id = ANY(p_pedido_ids) LOOP
    IF COALESCE(v_item.ncm, '') = '' THEN
      v_pend := array_append(v_pend, 'NCM ausente no produto ' || v_item.codigo_interno);
    END IF;
    IF COALESCE(v_item.cfop, v_cfg.cfop_padrao, '') = '' THEN
      v_pend := array_append(v_pend, 'CFOP ausente no produto ' || v_item.codigo_interno);
    END IF;
    IF COALESCE(v_item.cst_csosn, '') = '' THEN
      v_pend := array_append(v_pend, 'CST/CSOSN ausente no produto ' || v_item.codigo_interno);
    END IF;
    v_prod := v_prod + v_item.total;
  END LOOP;

  SELECT COALESCE(sum(desconto), 0), COALESCE(sum(frete), 0), COALESCE(sum(total), 0)
    INTO v_desc, v_frete, v_total
    FROM pedidos WHERE id = ANY(p_pedido_ids);

  IF array_length(v_pend, 1) IS NULL THEN
    v_numero := v_cfg.proximo_numero;
    UPDATE fiscal_config SET proximo_numero = proximo_numero + 1 WHERE id = v_cfg.id;
  END IF;

  INSERT INTO nfe (
    tenant_id, empresa_id, filial_id, pedido_id, cliente_id, deposito_id,
    numero, serie, situacao, ambiente, natureza_operacao, cfop,
    valor_produtos, valor_desconto, valor_frete, valor_total,
    emitente, destinatario, pendencias, mensagem
  ) VALUES (
    current_tenant_id(), v_emp.id, v_ped.filial_id, v_ped.id, v_ped.cliente_id, v_ped.deposito_id,
    v_numero, v_cfg.serie,
    CASE WHEN array_length(v_pend, 1) IS NULL THEN 'pronta' ELSE 'rascunho' END,
    v_cfg.ambiente, COALESCE(p_natureza, 'Venda de mercadoria'), v_cfg.cfop_padrao,
    v_prod, v_desc, v_frete, v_total,
    jsonb_build_object('razao_social', v_emp.razao_social, 'cnpj', v_emp.cnpj,
      'inscricao_estadual', v_emp.inscricao_estadual, 'endereco', v_emp.endereco,
      'numero', v_emp.numero, 'bairro', v_emp.bairro, 'cidade', v_emp.cidade,
      'estado', v_emp.estado, 'cep', v_emp.cep, 'filial', v_fil.nome),
    jsonb_build_object('nome', v_cli.nome, 'tipo', v_cli.tipo::text, 'cnpj', v_cli.cnpj, 'cpf', v_cli.cpf,
      'inscricao_estadual', v_cli.inscricao_estadual, 'endereco', COALESCE(v_ped.entrega_endereco, v_cli.endereco),
      'numero', COALESCE(v_ped.entrega_numero, v_cli.numero), 'bairro', COALESCE(v_ped.entrega_bairro, v_cli.bairro),
      'cidade', COALESCE(v_ped.entrega_cidade, v_cli.cidade), 'estado', COALESCE(v_ped.entrega_estado, v_cli.estado),
      'cep', COALESCE(v_ped.entrega_cep, v_cli.cep), 'telefone', v_cli.telefone, 'email', v_cli.email),
    v_pend,
    CASE WHEN array_length(v_pend, 1) IS NULL
      THEN 'Nota pronta para transmissão. Falta apenas a transmissão pelo emissor fiscal.'
      ELSE 'Nota em rascunho: resolva as pendências listadas.' END
  ) RETURNING id INTO v_nfe_id;

  FOREACH v_pid IN ARRAY p_pedido_ids LOOP
    INSERT INTO nfe_pedidos (tenant_id, nfe_id, pedido_id)
    VALUES (current_tenant_id(), v_nfe_id, v_pid);
  END LOOP;

  INSERT INTO nfe_itens (
    tenant_id, nfe_id, produto_id, codigo, descricao, ncm, cfop, cst_csosn,
    unidade, quantidade, preco_unitario, custo_unitario, desconto, total, aliquota_icms
  )
  SELECT current_tenant_id(), v_nfe_id, p.id, p.codigo_interno, p.descricao, p.ncm,
         COALESCE(p.cfop, v_cfg.cfop_padrao), p.cst_csosn,
         COALESCE(i.unidade, p.unidade), i.quantidade, i.preco_unitario, i.custo_unitario,
         i.desconto, i.total, p.aliquota_icms
    FROM pedido_itens i JOIN produtos p ON p.id = i.produto_id
   WHERE i.pedido_id = ANY(p_pedido_ids);

  PERFORM public.nfe_calcular_impostos(v_nfe_id);

  RETURN v_nfe_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.nfe_calcular_impostos(
  p_nfe_id uuid,
  p_aliquota_icms numeric DEFAULT NULL,
  p_aliquota_pis numeric DEFAULT NULL,
  p_aliquota_cofins numeric DEFAULT NULL,
  p_aliquota_iss numeric DEFAULT NULL,
  p_reducao_base numeric DEFAULT NULL,
  p_aplicar_icms_em_todos boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_nfe record;
  v_cfg record;
  v_item record;
  v_codigo text;
  v_icms numeric; v_pis numeric; v_cofins numeric; v_iss numeric; v_red numeric;
  v_base numeric; v_v_icms numeric; v_base_st numeric; v_v_st numeric;
  v_tot_base numeric := 0; v_tot_icms numeric := 0;
  v_tot_base_st numeric := 0; v_tot_st numeric := 0;
  v_tot_pis numeric := 0; v_tot_cofins numeric := 0; v_tot_iss numeric := 0;
BEGIN
  SELECT * INTO v_nfe FROM nfe WHERE id = p_nfe_id AND tenant_id = current_tenant_id();
  IF v_nfe IS NULL THEN
    RAISE EXCEPTION 'Nota fiscal não encontrada';
  END IF;
  IF v_nfe.situacao NOT IN ('rascunho', 'pronta') THEN
    RAISE EXCEPTION 'Só é possível recalcular impostos de nota em rascunho ou pronta';
  END IF;

  -- Configuração da filial da nota; se não houver, a padrão da empresa.
  SELECT * INTO v_cfg FROM fiscal_config
   WHERE tenant_id = current_tenant_id()
     AND (empresa_id = v_nfe.empresa_id OR empresa_id IS NULL)
     AND (filial_id = v_nfe.filial_id OR filial_id IS NULL)
   ORDER BY (filial_id IS NOT NULL) DESC, empresa_id NULLS LAST
   LIMIT 1;

  v_pis := COALESCE(p_aliquota_pis, v_cfg.aliquota_pis, 0);
  v_cofins := COALESCE(p_aliquota_cofins, v_cfg.aliquota_cofins, 0);
  v_iss := COALESCE(p_aliquota_iss, v_cfg.aliquota_iss, 0);
  v_red := COALESCE(p_reducao_base, v_cfg.reducao_base_icms, 0);

  FOR v_item IN SELECT * FROM nfe_itens WHERE nfe_id = p_nfe_id LOOP
    v_codigo := regexp_replace(COALESCE(v_item.cst_csosn, ''), '\D', '', 'g');
    v_icms := COALESCE(p_aliquota_icms, NULLIF(v_item.aliquota_icms, 0), v_cfg.aliquota_icms_interna, 0);
    IF p_aliquota_icms IS NOT NULL AND NOT p_aplicar_icms_em_todos AND COALESCE(v_item.aliquota_icms, 0) > 0 THEN
      v_icms := v_item.aliquota_icms;
    END IF;

    v_base := 0; v_v_icms := 0; v_base_st := 0; v_v_st := 0;

    IF v_codigo IN ('00', '10', '20', '70', '90', '900') THEN
      v_base := round(v_item.total * (1 - v_red / 100), 2);
      v_v_icms := round(v_base * v_icms / 100, 2);
    ELSIF v_codigo IN ('60', '500') THEN
      v_base_st := round(v_item.total * (1 + COALESCE(v_cfg.mva_st, 0) / 100), 2);
      v_v_st := round(v_base_st * v_icms / 100, 2);
    END IF;

    UPDATE nfe_itens SET
      aliquota_icms = v_icms,
      base_icms = v_base,
      valor_icms = v_v_icms,
      base_icms_st = v_base_st,
      valor_icms_st = v_v_st,
      aliquota_pis = v_pis,
      valor_pis = round(v_item.total * v_pis / 100, 2),
      aliquota_cofins = v_cofins,
      valor_cofins = round(v_item.total * v_cofins / 100, 2),
      aliquota_iss = v_iss,
      valor_iss = round(v_item.total * v_iss / 100, 2),
      cst_pis = COALESCE(v_cfg.cst_pis, '99'),
      cst_cofins = COALESCE(v_cfg.cst_cofins, '99')
     WHERE id = v_item.id;

    v_tot_base := v_tot_base + v_base;
    v_tot_icms := v_tot_icms + v_v_icms;
    v_tot_base_st := v_tot_base_st + v_base_st;
    v_tot_st := v_tot_st + v_v_st;
    v_tot_pis := v_tot_pis + round(v_item.total * v_pis / 100, 2);
    v_tot_cofins := v_tot_cofins + round(v_item.total * v_cofins / 100, 2);
    v_tot_iss := v_tot_iss + round(v_item.total * v_iss / 100, 2);
  END LOOP;

  UPDATE nfe SET
    base_icms = v_tot_base,
    valor_icms = v_tot_icms,
    base_icms_st = v_tot_base_st,
    valor_icms_st = v_tot_st,
    valor_pis = v_tot_pis,
    valor_cofins = v_tot_cofins,
    valor_iss = v_tot_iss,
    impostos_calculados_em = now(),
    updated_at = now()
   WHERE id = p_nfe_id;

  RETURN jsonb_build_object(
    'base_icms', v_tot_base, 'valor_icms', v_tot_icms,
    'base_icms_st', v_tot_base_st, 'valor_icms_st', v_tot_st,
    'valor_pis', v_tot_pis, 'valor_cofins', v_tot_cofins, 'valor_iss', v_tot_iss
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.nfe_calcular_impostos(uuid, numeric, numeric, numeric, numeric, numeric, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nfe_calcular_impostos(uuid, numeric, numeric, numeric, numeric, numeric, boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.gerar_nfe_agrupada(uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gerar_nfe_agrupada(uuid[], text) TO authenticated;