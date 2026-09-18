CREATE OR REPLACE FUNCTION public.gerar_nfe(p_pedido_id uuid, p_natureza text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ped record;
  v_cli record;
  v_emp record;
  v_fil record;
  v_cfg record;
  v_nfe_id uuid;
  v_numero integer;
  v_pend text[] := '{}';
  v_prod numeric := 0;
  v_item record;
  v_doc text;
BEGIN
  SELECT * INTO v_ped FROM pedidos WHERE id = p_pedido_id AND tenant_id = current_tenant_id();
  IF v_ped IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado'; END IF;
  IF v_ped.situacao = 'cancelado' THEN RAISE EXCEPTION 'Pedido cancelado não emite nota'; END IF;

  IF EXISTS (SELECT 1 FROM nfe WHERE pedido_id = p_pedido_id AND situacao <> 'cancelada') THEN
    RAISE EXCEPTION 'Este pedido já tem nota fiscal gerada';
  END IF;

  SELECT * INTO v_cli FROM clientes WHERE id = v_ped.cliente_id;
  SELECT * INTO v_emp FROM empresas WHERE id = COALESCE(v_ped.empresa_id, v_cli.empresa_id);
  SELECT * INTO v_fil FROM filiais WHERE id = v_ped.filial_id;

  SELECT * INTO v_cfg FROM fiscal_config
   WHERE tenant_id = current_tenant_id()
     AND (empresa_id = v_emp.id OR empresa_id IS NULL)
   ORDER BY empresa_id NULLS LAST LIMIT 1;

  IF v_cfg IS NULL THEN
    INSERT INTO fiscal_config (tenant_id, empresa_id) VALUES (current_tenant_id(), v_emp.id)
    RETURNING * INTO v_cfg;
  END IF;

  v_doc := COALESCE(v_cli.cnpj, v_cli.cpf);
  IF v_doc IS NULL OR length(regexp_replace(v_doc, '\D', '', 'g')) NOT IN (11, 14) THEN
    v_pend := v_pend || 'CPF/CNPJ do cliente inválido ou ausente';
  END IF;
  IF COALESCE(v_cli.endereco, '') = '' OR COALESCE(v_cli.cidade, '') = '' OR COALESCE(v_cli.estado, '') = '' OR COALESCE(v_cli.cep, '') = '' THEN
    v_pend := v_pend || 'Endereço completo do cliente incompleto';
  END IF;
  IF v_cli.tipo::text = 'PJ' AND COALESCE(v_cli.inscricao_estadual, '') = '' THEN
    v_pend := v_pend || 'Inscrição estadual do cliente ausente';
  END IF;
  IF v_emp IS NULL OR COALESCE(v_emp.cnpj, '') = '' OR COALESCE(v_emp.inscricao_estadual, '') = '' THEN
    v_pend := v_pend || 'CNPJ ou inscrição estadual da empresa ausente';
  END IF;
  IF COALESCE(v_cfg.certificado_nome, '') = '' THEN
    v_pend := v_pend || 'Certificado digital A1 não configurado';
  END IF;
  IF COALESCE(v_cfg.emissor, '') = '' THEN
    v_pend := v_pend || 'Emissor fiscal (API) não configurado';
  END IF;

  FOR v_item IN SELECT i.*, p.ncm, p.codigo_interno
                  FROM pedido_itens i JOIN produtos p ON p.id = i.produto_id
                 WHERE i.pedido_id = p_pedido_id LOOP
    IF COALESCE(v_item.ncm, '') = '' THEN
      v_pend := v_pend || ('NCM ausente no produto ' || v_item.codigo_interno);
    END IF;
    v_prod := v_prod + v_item.total;
  END LOOP;

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
    current_tenant_id(), v_emp.id, v_ped.filial_id, p_pedido_id, v_ped.cliente_id, v_ped.deposito_id,
    v_numero, v_cfg.serie,
    CASE WHEN array_length(v_pend, 1) IS NULL THEN 'pronta' ELSE 'rascunho' END,
    v_cfg.ambiente, COALESCE(p_natureza, 'Venda de mercadoria'), v_cfg.cfop_padrao,
    v_prod, v_ped.desconto, v_ped.frete, v_ped.total,
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

  INSERT INTO nfe_itens (
    tenant_id, nfe_id, produto_id, codigo, descricao, ncm, cfop, cst_csosn,
    unidade, quantidade, preco_unitario, custo_unitario, desconto, total, aliquota_icms
  )
  SELECT current_tenant_id(), v_nfe_id, p.id, p.codigo_interno, p.descricao, p.ncm,
         COALESCE(p.cfop, v_cfg.cfop_padrao), p.cst_csosn,
         COALESCE(i.unidade, p.unidade), i.quantidade, i.preco_unitario, i.custo_unitario,
         i.desconto, i.total, p.aliquota_icms
    FROM pedido_itens i JOIN produtos p ON p.id = i.produto_id
   WHERE i.pedido_id = p_pedido_id;

  RETURN v_nfe_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.gerar_nfe(uuid, text) TO authenticated;