CREATE OR REPLACE FUNCTION public.nfe_preencher_destinatario(p_nfe_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nfe record;
  v_ped record;
  v_cli record;
  v_emp record;
  v_fil record;
  v_cfg record;
  v_pend text[] := ARRAY[]::text[];
  v_doc text;
  v_item record;
BEGIN
  SELECT * INTO v_nfe FROM nfe WHERE id = p_nfe_id AND tenant_id = current_tenant_id();
  IF v_nfe IS NULL THEN
    RAISE EXCEPTION 'Nota não encontrada';
  END IF;
  IF v_nfe.situacao IN ('autorizada', 'cancelada') THEN
    RAISE EXCEPTION 'Nota já autorizada ou cancelada não pode ser alterada';
  END IF;

  SELECT * INTO v_ped FROM pedidos WHERE id = v_nfe.pedido_id;
  SELECT * INTO v_cli FROM clientes WHERE id = v_nfe.cliente_id;
  SELECT * INTO v_emp FROM empresas WHERE id = v_nfe.empresa_id;
  SELECT * INTO v_fil FROM filiais WHERE id = v_nfe.filial_id;

  SELECT * INTO v_cfg FROM fiscal_config
   WHERE tenant_id = current_tenant_id()
     AND (empresa_id = v_nfe.empresa_id OR empresa_id IS NULL)
     AND (filial_id = v_nfe.filial_id OR filial_id IS NULL)
   ORDER BY (filial_id IS NOT NULL) DESC, empresa_id NULLS LAST
   LIMIT 1;

  v_doc := COALESCE(v_cli.cnpj, v_cli.cpf);
  IF v_doc IS NULL OR length(regexp_replace(v_doc, '\D', '', 'g')) NOT IN (11, 14) THEN
    v_pend := array_append(v_pend, 'CPF/CNPJ do cliente inválido ou ausente');
  END IF;
  IF COALESCE(v_cli.endereco, '') = '' OR COALESCE(v_cli.cidade, '') = ''
     OR COALESCE(v_cli.estado, '') = '' OR COALESCE(v_cli.cep, '') = '' THEN
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

  FOR v_item IN SELECT i.codigo, i.ncm, i.cfop, i.cst_csosn FROM nfe_itens i WHERE i.nfe_id = p_nfe_id LOOP
    IF COALESCE(v_item.ncm, '') = '' THEN
      v_pend := array_append(v_pend, 'NCM ausente no produto ' || COALESCE(v_item.codigo, ''));
    END IF;
    IF COALESCE(v_item.cfop, v_cfg.cfop_padrao, '') = '' THEN
      v_pend := array_append(v_pend, 'CFOP ausente no produto ' || COALESCE(v_item.codigo, ''));
    END IF;
    IF COALESCE(v_item.cst_csosn, '') = '' THEN
      v_pend := array_append(v_pend, 'CST/CSOSN ausente no produto ' || COALESCE(v_item.codigo, ''));
    END IF;
  END LOOP;

  UPDATE nfe SET
    emitente = jsonb_build_object('razao_social', v_emp.razao_social, 'cnpj', v_emp.cnpj,
      'inscricao_estadual', v_emp.inscricao_estadual, 'endereco', v_emp.endereco,
      'numero', v_emp.numero, 'bairro', v_emp.bairro, 'cidade', v_emp.cidade,
      'estado', v_emp.estado, 'cep', v_emp.cep, 'filial', v_fil.nome),
    destinatario = jsonb_build_object('nome', v_cli.nome, 'tipo', v_cli.tipo::text,
      'cnpj', v_cli.cnpj, 'cpf', v_cli.cpf, 'inscricao_estadual', v_cli.inscricao_estadual,
      'endereco', COALESCE(v_ped.entrega_endereco, v_cli.endereco),
      'numero', COALESCE(v_ped.entrega_numero, v_cli.numero),
      'bairro', COALESCE(v_ped.entrega_bairro, v_cli.bairro),
      'cidade', COALESCE(v_ped.entrega_cidade, v_cli.cidade),
      'estado', COALESCE(v_ped.entrega_estado, v_cli.estado),
      'cep', COALESCE(v_ped.entrega_cep, v_cli.cep),
      'telefone', v_cli.telefone, 'email', v_cli.email),
    pendencias = v_pend,
    situacao = CASE
      WHEN array_length(v_pend, 1) IS NULL AND v_nfe.situacao = 'rascunho' THEN 'pronta'
      WHEN array_length(v_pend, 1) IS NOT NULL AND v_nfe.situacao = 'pronta' THEN 'rascunho'
      ELSE v_nfe.situacao END,
    mensagem = CASE WHEN array_length(v_pend, 1) IS NULL
      THEN 'Dados do cliente atualizados. Nota pronta para transmissão.'
      ELSE 'Dados do cliente atualizados. Ainda há pendências listadas.' END,
    numero = CASE
      WHEN array_length(v_pend, 1) IS NULL AND v_nfe.numero IS NULL THEN v_cfg.proximo_numero
      ELSE v_nfe.numero END,
    serie = COALESCE(v_nfe.serie, v_cfg.serie)
  WHERE id = p_nfe_id;

  IF array_length(v_pend, 1) IS NULL AND v_nfe.numero IS NULL THEN
    UPDATE fiscal_config SET proximo_numero = proximo_numero + 1 WHERE id = v_cfg.id;
  END IF;

  RETURN jsonb_build_object('pendencias', to_jsonb(v_pend));
END;
$$;

REVOKE ALL ON FUNCTION public.nfe_preencher_destinatario(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.nfe_preencher_destinatario(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.nfe_preencher_destinatario(uuid) TO authenticated;