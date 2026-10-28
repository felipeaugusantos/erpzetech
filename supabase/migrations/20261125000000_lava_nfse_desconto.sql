-- Lava rápido: imposto da NFS-e sobre o valor líquido (revisão automática do PR).
-- O cálculo de impostos refaz o ISS a partir do total de cada item da nota e sobrescreve o valor do cabeçalho.
-- Com desconto na venda o item levava o preço cheio, e o ISS saía sobre o valor sem desconto.
-- Agora o desconto é rateado entre os itens (o último absorve o centavo de arredondamento) e o item guarda desconto e total líquido.

CREATE OR REPLACE FUNCTION public._lr_nfse_rascunho(p_ordem_id uuid, p_pedido_id uuid, p_liquido numeric)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  o public.lr_ordens%ROWTYPE;
  v_veic public.lr_veiculos%ROWTYPE;
  v_ped record; v_cli record; v_emp record; v_fil record;
  v_fil_cfg record; v_emp_cfg record; v_cfg record;
  v_nfe uuid; v_numero integer; v_pend text[] := '{}';
  v_doc text; v_iss numeric; v_codigo text; v_cert text; v_municipio text;
  v_bruto numeric;
BEGIN
  SELECT * INTO o FROM public.lr_ordens WHERE id = p_ordem_id AND tenant_id = v_tenant;
  SELECT * INTO v_veic FROM public.lr_veiculos WHERE id = o.veiculo_id;
  SELECT * INTO v_ped FROM public.pedidos WHERE id = p_pedido_id AND tenant_id = v_tenant;
  SELECT * INTO v_cli FROM public.clientes WHERE id = o.cliente_id;
  SELECT * INTO v_fil FROM public.filiais WHERE id = v_ped.filial_id;
  SELECT * INTO v_emp FROM public.empresas
   WHERE tenant_id = v_tenant AND id = coalesce(v_ped.empresa_id, v_fil.empresa_id);
  IF v_emp IS NULL THEN
    SELECT * INTO v_emp FROM public.empresas WHERE tenant_id = v_tenant ORDER BY created_at, id LIMIT 1;
  END IF;
  IF v_emp IS NULL THEN RAISE EXCEPTION 'Empresa emitente não encontrada'; END IF;

  SELECT * INTO v_fil_cfg FROM public.fiscal_config WHERE tenant_id = v_tenant AND filial_id = v_ped.filial_id LIMIT 1;
  SELECT * INTO v_emp_cfg FROM public.fiscal_config
   WHERE tenant_id = v_tenant AND filial_id IS NULL AND (empresa_id = v_emp.id OR empresa_id IS NULL)
   ORDER BY empresa_id NULLS LAST LIMIT 1;
  IF v_fil_cfg IS NULL AND v_emp_cfg IS NULL THEN
    INSERT INTO public.fiscal_config (tenant_id, empresa_id) VALUES (v_tenant, v_emp.id) RETURNING * INTO v_emp_cfg;
  END IF;
  -- registro não encontrado vira linha de campos nulos: escolhe pela chave, não por coalesce
  IF v_fil_cfg.id IS NOT NULL THEN v_cfg := v_fil_cfg; ELSE v_cfg := v_emp_cfg; END IF;

  v_iss := coalesce(nullif(v_fil_cfg.aliquota_iss, 0), nullif(v_emp_cfg.aliquota_iss, 0), 0);
  v_codigo := coalesce(nullif(v_fil_cfg.codigo_servico, ''), nullif(v_emp_cfg.codigo_servico, ''), '');
  v_cert := coalesce(nullif(v_fil_cfg.certificado_nome, ''), nullif(v_emp_cfg.certificado_nome, ''), '');
  v_municipio := coalesce(nullif(v_fil_cfg.nfse_prefeitura, ''), nullif(v_emp_cfg.nfse_prefeitura, ''), coalesce(v_fil.cidade, v_emp.cidade, ''));

  v_doc := coalesce(v_cli.cnpj, v_cli.cpf);
  IF v_doc IS NULL OR length(regexp_replace(v_doc, '\W', '', 'g')) NOT IN (11, 14) THEN
    v_pend := array_append(v_pend, 'CPF/CNPJ do cliente inválido ou ausente');
  END IF;
  IF coalesce(v_emp.cnpj, '') = '' THEN v_pend := array_append(v_pend, 'CNPJ da empresa ausente'); END IF;
  IF coalesce(v_emp.inscricao_municipal, '') = '' THEN
    v_pend := array_append(v_pend, 'Inscrição municipal da empresa ausente (obrigatória na nota de serviço)');
  END IF;
  IF v_codigo = '' THEN v_pend := array_append(v_pend, 'Código do serviço municipal não configurado'); END IF;
  IF v_iss <= 0 THEN v_pend := array_append(v_pend, 'Alíquota de ISS não configurada'); END IF;
  IF v_cert = '' THEN v_pend := array_append(v_pend, 'Certificado digital (A1 ou A3) não configurado'); END IF;

  IF array_length(v_pend, 1) IS NULL THEN
    v_numero := coalesce(v_cfg.proximo_numero_nfse, 1);
    UPDATE public.fiscal_config SET proximo_numero_nfse = coalesce(proximo_numero_nfse, 1) + 1 WHERE id = v_cfg.id;
  END IF;

  SELECT coalesce(sum(preco_aplicado), 0) INTO v_bruto FROM public.lr_ordem_itens WHERE ordem_id = o.id AND cobertura IS NULL;

  INSERT INTO public.nfe (
    tenant_id, empresa_id, filial_id, pedido_id, cliente_id, numero, serie, situacao, ambiente, modelo,
    codigo_servico, municipio_prestacao, iss_retido, natureza_operacao, cfop,
    valor_produtos, valor_desconto, valor_total, valor_iss, emitente, destinatario, pendencias, mensagem
  ) VALUES (
    v_tenant, v_emp.id, v_ped.filial_id, v_ped.id, o.cliente_id, v_numero, coalesce(v_cfg.serie_nfse, 1),
    CASE WHEN array_length(v_pend, 1) IS NULL THEN 'pronta' ELSE 'rascunho' END,
    v_cfg.ambiente, 'nfse', v_codigo, v_municipio, coalesce(v_cfg.nfse_iss_retido, false),
    'Prestação de serviço — lavagem, polimento e higienização de veículos', NULL,
    v_bruto, greatest(v_bruto - p_liquido, 0), p_liquido, round(p_liquido * v_iss / 100, 2),
    jsonb_build_object('razao_social', v_emp.razao_social, 'cnpj', v_emp.cnpj, 'inscricao_municipal', v_emp.inscricao_municipal,
      'inscricao_estadual', v_emp.inscricao_estadual, 'endereco', v_emp.endereco, 'numero', v_emp.numero, 'bairro', v_emp.bairro,
      'cidade', v_emp.cidade, 'estado', v_emp.estado, 'cep', v_emp.cep, 'filial', v_fil.nome),
    jsonb_build_object('nome', v_cli.nome, 'tipo', v_cli.tipo::text, 'cnpj', v_cli.cnpj, 'cpf', v_cli.cpf,
      'endereco', v_cli.endereco, 'numero', v_cli.numero, 'bairro', v_cli.bairro, 'cidade', v_cli.cidade,
      'estado', v_cli.estado, 'cep', v_cli.cep, 'telefone', v_cli.telefone, 'email', v_cli.email),
    v_pend,
    CASE WHEN array_length(v_pend, 1) IS NULL
      THEN 'Nota fiscal de serviço (NFS-e) pronta para transmissão à prefeitura.'
      ELSE 'NFS-e em rascunho: resolva as pendências listadas.' END
  ) RETURNING id INTO v_nfe;

  INSERT INTO public.nfe_pedidos (tenant_id, nfe_id, pedido_id) VALUES (v_tenant, v_nfe, p_pedido_id);

  -- o desconto da venda é rateado entre os itens da nota: o imposto é calculado sobre o total de cada item, que precisa ser o líquido
  INSERT INTO public.nfe_itens (tenant_id, nfe_id, descricao, unidade, quantidade, preco_unitario, desconto, total, cst_csosn)
  SELECT v_tenant, v_nfe, y.nome || ' — ' || v_veic.identificacao, 'UN', 1, y.preco, y.preco - y.liquido, y.liquido, '400'
    FROM (
      SELECT x.nome, x.preco,
             CASE WHEN x.pos = x.qtd THEN p_liquido - coalesce(sum(x.parcial) OVER (ORDER BY x.pos ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0)
                  ELSE x.parcial END AS liquido
        FROM (
          SELECT s.nome, i.preco_aplicado AS preco,
                 CASE WHEN v_bruto > 0 THEN round(i.preco_aplicado * p_liquido / v_bruto, 2) ELSE 0 END AS parcial,
                 row_number() OVER (ORDER BY i.created_at, i.id) AS pos,
                 count(*) OVER () AS qtd
            FROM public.lr_ordem_itens i
            JOIN public.lr_servicos s ON s.id = i.servico_id
           WHERE i.ordem_id = o.id AND i.cobertura IS NULL) x) y;

  PERFORM public.nfe_calcular_impostos_interno(v_nfe);
  RETURN v_nfe;
END $fn$;
REVOKE ALL ON FUNCTION public._lr_nfse_rascunho(uuid, uuid, numeric) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.lr_plano_vender(
  p_plano_id uuid, p_veiculo_id uuid, p_pedido_id uuid DEFAULT NULL, p_chave uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  pl public.lr_planos%ROWTYPE;
  vc public.lr_veiculos%ROWTYPE;
  v_ped public.pedidos%ROWTYPE;
  v_pedido uuid := p_pedido_id;
  v_existente uuid; v_valor numeric; v_id uuid; v_nfe uuid; v_serv text;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._lr_exige_liberado();
  SELECT * INTO pl FROM public.lr_planos WHERE id = p_plano_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plano não encontrado'; END IF;
  IF NOT pl.ativo THEN RAISE EXCEPTION 'Este plano não está à venda'; END IF;
  SELECT * INTO vc FROM public.lr_veiculos WHERE id = p_veiculo_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Veículo não encontrado'; END IF;
  IF NOT vc.ativo THEN RAISE EXCEPTION 'Este veículo está inativo'; END IF;
  IF pl.tipo IS NOT NULL AND pl.tipo <> vc.tipo THEN RAISE EXCEPTION 'Este plano é só para %', pl.tipo; END IF;

  IF v_pedido IS NULL AND p_chave IS NOT NULL THEN
    SELECT id INTO v_pedido FROM public.pedidos WHERE tenant_id = v_tenant AND chave_idempotencia = p_chave;
  END IF;
  IF v_pedido IS NULL THEN RAISE EXCEPTION 'Informe a venda do caixa'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('lr_plano_venda:' || v_pedido::text, 0));
  -- repetir a chamada (resposta perdida) devolve a mesma assinatura
  SELECT id INTO v_existente FROM public.lr_assinaturas WHERE venda_id = v_pedido;
  IF v_existente IS NOT NULL THEN
    RETURN jsonb_build_object('assinatura_id', v_existente, 'repetido', true);
  END IF;

  SELECT * INTO v_ped FROM public.pedidos WHERE id = v_pedido AND tenant_id = v_tenant;
  IF NOT FOUND OR NOT public.pode_filial(v_ped.filial_id) THEN RAISE EXCEPTION 'Venda não encontrada'; END IF;
  IF v_ped.situacao = 'cancelado' THEN RAISE EXCEPTION 'Esta venda está cancelada'; END IF;
  IF coalesce(v_ped.origem, '') <> 'pdv' THEN RAISE EXCEPTION 'A venda do plano é feita na frente de caixa'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pedido_itens pi WHERE pi.pedido_id = v_pedido AND pi.produto_id = pl.produto_id
                  AND pi.preco_unitario = pl.preco AND pi.quantidade = 1) THEN
    RAISE EXCEPTION 'A venda não traz o plano "%" uma vez, por %', pl.nome, pl.preco;
  END IF;

  v_valor := CASE WHEN coalesce(v_ped.subtotal, 0) > 0 THEN round(pl.preco * v_ped.total / v_ped.subtotal, 2) ELSE pl.preco END;
  INSERT INTO public.lr_assinaturas (tenant_id, plano_id, veiculo_id, cliente_id, servico_id, lavagens, valor, comprado_em, vence_em, venda_id)
  VALUES (v_tenant, pl.id, vc.id, vc.cliente_id, pl.servico_id, pl.lavagens, v_valor, v_hoje, v_hoje + pl.validade_dias, v_pedido)
  RETURNING id INTO v_id;

  SELECT nome INTO v_serv FROM public.lr_servicos WHERE id = pl.servico_id;
  v_nfe := public._pet_nfse_criar(vc.cliente_id, v_pedido,
             jsonb_build_array(jsonb_build_object('descricao', pl.nome || ' (' || pl.lavagens || ' x ' || coalesce(v_serv, 'serviço') || ') — ' || vc.identificacao, 'valor', pl.preco)),
             v_valor, 'Prestação de serviço — plano de lavagem de veículos');
  -- plano com desconto na venda: o item da nota fica com o valor líquido e o imposto é refeito sobre ele
  UPDATE public.nfe_itens SET desconto = greatest(total - v_valor, 0), total = v_valor WHERE nfe_id = v_nfe;
  PERFORM public.nfe_calcular_impostos_interno(v_nfe);
  RETURN jsonb_build_object('assinatura_id', v_id, 'nfe_id', v_nfe, 'vence_em', v_hoje + pl.validade_dias, 'repetido', false);
END $fn$;
REVOKE ALL ON FUNCTION public.lr_plano_vender(uuid, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_plano_vender(uuid, uuid, uuid, uuid) TO authenticated;
