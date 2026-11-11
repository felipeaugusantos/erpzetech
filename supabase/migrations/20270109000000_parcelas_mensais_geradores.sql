-- Os demais geradores de parcelas passam a vencimento mensal (vencimento_parcela) e a divisão em centavos
-- com o resto na última parcela (valor_parcela), como o parcelamento manual (migração 20270108):
--   gerar_contas_receber_interno (parcelas do pedido, também usado pela frente de caixa),
--   importar_nfe_entrada (contas a pagar da NF-e de entrada), receber_compra (contas a pagar da compra)
--   e locacao_faturar (faturamento da locação).
-- Só mudam a data e o valor de cada parcela; o resto das funções fica igual (gerado a partir da definição vigente).
-- Não mexe nos casos de título único com primeiro vencimento padrão de 30 dias (PDV, checkout, frete do CT-e).

-- gerar_contas_receber_interno
CREATE OR REPLACE FUNCTION public.gerar_contas_receber_interno(p_pedido_id uuid, p_parcelas integer DEFAULT 1, p_primeiro_vencimento date DEFAULT NULL::date, p_forma forma_pagamento DEFAULT 'boleto'::forma_pagamento)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := public.current_tenant_id();
  p public.pedidos;
  v_existe int;
  v_parc numeric;
  v_n int := greatest(1, coalesce(p_parcelas,1));
  i int;
begin
  PERFORM public.exige_nao_salao();
  select * into p from public.pedidos where id = p_pedido_id and tenant_id = v_tenant;
  if p.id is null then raise exception 'Pedido não encontrado nesta empresa'; end if;
  if p.situacao = 'cancelado' then raise exception 'Pedido cancelado'; end if;

  select count(*) into v_existe from public.contas_receber
    where pedido_id = p.id and situacao <> 'cancelado';
  if v_existe > 0 then raise exception 'Este pedido já possui contas a receber'; end if;

  for i in 1..v_n loop
    insert into public.contas_receber (tenant_id, empresa_id, filial_id, cliente_id, pedido_id, descricao,
      parcela, parcelas, vencimento, valor, forma_pagamento)
    values (v_tenant, p.empresa_id, p.filial_id, p.cliente_id, p.id,
      'Pedido nº ' || p.numero, i, v_n,
      public.vencimento_parcela(coalesce(p_primeiro_vencimento, current_date), i),
      public.valor_parcela(round(p.total, 2), v_n, i),
      p_forma);
  end loop;

  if p_forma = 'crediario' then
    update public.clientes set saldo_utilizado = saldo_utilizado + p.total where id = p.cliente_id;
  end if;

  return v_n;
end; $function$;

-- importar_nfe_entrada
CREATE OR REPLACE FUNCTION public.importar_nfe_entrada(p_nota jsonb, p_fornecedor jsonb, p_itens jsonb, p_deposito_id uuid, p_gerar_conta boolean DEFAULT true, p_parcelas integer DEFAULT 1, p_vencimento date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_dep public.depositos;
  v_empresa uuid;
  v_forn_id uuid;
  v_cnpj text := upper(regexp_replace(coalesce(p_fornecedor->>'cnpj',''), '[^0-9A-Za-z]', '', 'g'));
  v_chave text := nullif(p_nota->>'chave','');
  v_compra_id uuid; v_rec_id uuid; v_numero bigint;
  it jsonb; v_prod_id uuid; v_codigo text; v_seq int := 0;
  v_qtd numeric; v_custo numeric; v_subtotal numeric := 0;
  v_itens_receber jsonb := '[]'::jsonb; v_item_id uuid;
  v_novos int := 0;
  v_lotes jsonb := '[]'::jsonb; l jsonb;
begin
  PERFORM public.exige_nao_salao();
  if v_tenant is null then raise exception 'Usuário sem empresa vinculada'; end if;
  if not (public.has_role(auth.uid(), 'administrador') or public.has_role(auth.uid(), 'gestor')
          or public.has_role(auth.uid(), 'comprador') or public.has_role(auth.uid(), 'estoquista')) then
    raise exception 'Sem permissão para importar nota de entrada';
  end if;

  select * into v_dep from public.depositos where id = p_deposito_id and tenant_id = v_tenant;
  if v_dep.id is null then raise exception 'Depósito não encontrado nesta empresa'; end if;
  select empresa_id into v_empresa from public.filiais where id = v_dep.filial_id;

  if v_chave is not null then
    if not pg_try_advisory_xact_lock(hashtextextended(v_tenant::text || ':nfe:' || v_chave, 0)) then
      raise exception 'Esta nota já está em processo de importação (chave %). Aguarde a conclusão.', v_chave;
    end if;
  end if;
  if v_chave is not null and exists (
    select 1 from public.compras where tenant_id = v_tenant and nfe_chave = v_chave
  ) then
    raise exception 'Esta nota já está importada (chave %).', v_chave;
  end if;

  if p_itens is null or jsonb_array_length(p_itens) = 0 then
    raise exception 'A nota não tem itens para importar';
  end if;

  if v_cnpj <> '' then
    select id into v_forn_id from public.fornecedores
     where tenant_id = v_tenant and upper(regexp_replace(coalesce(cnpj,''), '[^0-9A-Za-z]', '', 'g')) = v_cnpj
     limit 1;
  end if;
  if v_forn_id is not null and nullif(p_nota->>'numero','') is not null then
    if not pg_try_advisory_xact_lock(hashtextextended(v_tenant::text || ':nfe:' || v_forn_id::text || ':' ||
         (p_nota->>'numero') || ':' || coalesce(p_nota->>'serie', ''), 0)) then
      raise exception 'Esta nota (nº %, série %) já está em processo de importação. Aguarde a conclusão.',
        p_nota->>'numero', coalesce(p_nota->>'serie', '—');
    end if;
    if exists (select 1 from public.compras
                where tenant_id = v_tenant and fornecedor_id = v_forn_id and nfe_numero = (p_nota->>'numero')
                  and coalesce(nfe_serie, '') = coalesce(p_nota->>'serie', '')) then
      raise exception 'Esta nota (nº %, série %) já está importada para este fornecedor.',
        p_nota->>'numero', coalesce(p_nota->>'serie', '—');
    end if;
  end if;
  if v_forn_id is null then
    insert into public.fornecedores (tenant_id, razao_social, nome_fantasia, cnpj, telefone, email,
      cep, endereco, numero, bairro, cidade, estado, condicao_pagamento)
    values (v_tenant,
      coalesce(nullif(p_fornecedor->>'razao_social',''), 'Fornecedor da NF-e'),
      nullif(p_fornecedor->>'nome_fantasia',''), nullif(p_fornecedor->>'cnpj',''),
      nullif(p_fornecedor->>'telefone',''), nullif(p_fornecedor->>'email',''),
      nullif(p_fornecedor->>'cep',''), nullif(p_fornecedor->>'endereco',''),
      nullif(p_fornecedor->>'numero',''), nullif(p_fornecedor->>'bairro',''),
      nullif(p_fornecedor->>'cidade',''), nullif(p_fornecedor->>'estado',''),
      nullif(p_nota->>'condicao_pagamento',''))
    returning id into v_forn_id;
  end if;

  insert into public.compras (tenant_id, empresa_id, filial_id, fornecedor_id, deposito_id, situacao,
    origem, previsao_entrega, condicao_pagamento, observacoes, nfe_chave, nfe_numero, nfe_emissao,
    nfe_serie, solicitante_id)
  values (v_tenant, v_empresa, v_dep.filial_id, v_forn_id, v_dep.id, 'aprovado'::public.compra_situacao,
    'xml_nfe', coalesce((p_nota->>'emissao')::date, current_date), nullif(p_nota->>'condicao_pagamento',''),
    nullif(p_nota->>'observacao',''), v_chave, nullif(p_nota->>'numero',''),
    (p_nota->>'emissao')::date, nullif(p_nota->>'serie',''), auth.uid())
  returning id, numero into v_compra_id, v_numero;

  for it in select * from jsonb_array_elements(p_itens) loop
    v_seq := v_seq + 1;
    v_qtd := coalesce((it->>'quantidade')::numeric, 0);
    v_custo := coalesce((it->>'custo_unitario')::numeric, 0);
    if v_qtd <= 0 then continue; end if;

    v_prod_id := nullif(it->>'produto_id','')::uuid;
    if v_prod_id is not null then
      perform 1 from public.produtos where id = v_prod_id and tenant_id = v_tenant;
      if not found then raise exception 'Produto informado não pertence a esta empresa'; end if;
    else
      v_codigo := upper(regexp_replace(coalesce(nullif(it->>'codigo',''), 'NF' || v_numero || '-' || v_seq),
        '[^A-Za-z0-9._-]', '', 'g'));
      if v_codigo = '' then v_codigo := 'NF' || v_numero || '-' || v_seq; end if;
      select id into v_prod_id from public.produtos
       where tenant_id = v_tenant and codigo_interno = v_codigo limit 1;
      if v_prod_id is null then
        insert into public.produtos (tenant_id, codigo_interno, codigo_barras, descricao, ncm,
          unidade, unidade_compra, custo, preco_venda, fornecedor_id, ativo)
        values (v_tenant, v_codigo, nullif(it->>'codigo_barras',''),
          coalesce(nullif(it->>'descricao',''), 'Produto da NF ' || coalesce(p_nota->>'numero','')),
          nullif(it->>'ncm',''), coalesce(nullif(it->>'unidade',''), 'UN'),
          nullif(it->>'unidade',''), v_custo,
          coalesce((it->>'preco_venda')::numeric, 0), v_forn_id, true)
        returning id into v_prod_id;
        v_novos := v_novos + 1;
      end if;
    end if;

    if coalesce(it->>'codigo','') <> '' then
      insert into public.nfe_entrada_produtos (tenant_id, fornecedor_id, codigo_fornecedor, codigo_barras, produto_id)
      values (v_tenant, v_forn_id, it->>'codigo', nullif(it->>'codigo_barras',''), v_prod_id)
      on conflict (tenant_id, fornecedor_id, codigo_fornecedor)
        do update set produto_id = excluded.produto_id, codigo_barras = excluded.codigo_barras;
    end if;

    insert into public.compra_itens (tenant_id, compra_id, produto_id, quantidade, unidade,
      custo_unitario, total, observacao, cfop, impostos)
    values (v_tenant, v_compra_id, v_prod_id, v_qtd, nullif(it->>'unidade',''), v_custo,
      round(v_qtd * v_custo, 2), nullif(it->>'observacao',''), nullif(it->>'cfop',''),
      case when jsonb_typeof(it->'impostos') = 'object' then it->'impostos' end)
    returning id into v_item_id;

    v_subtotal := v_subtotal + round(v_qtd * v_custo, 2);
    if coalesce(it->>'lote','') <> '' then
      v_lotes := v_lotes || jsonb_build_object('produto_id', v_prod_id, 'lote', it->>'lote',
        'tonalidade', coalesce(it->>'tonalidade',''), 'calibre', coalesce(it->>'calibre',''), 'quantidade', v_qtd);
    end if;
    v_itens_receber := v_itens_receber || jsonb_build_object(
      'compra_item_id', v_item_id, 'quantidade', v_qtd, 'custo_unitario', v_custo);
  end loop;

  if jsonb_array_length(v_itens_receber) = 0 then
    raise exception 'Nenhum item válido na nota';
  end if;

  update public.compras
     set subtotal = v_subtotal,
         frete = coalesce((p_nota->>'frete')::numeric, 0),
         desconto = coalesce((p_nota->>'desconto')::numeric, 0),
         total = coalesce(nullif(p_nota->>'total','')::numeric, v_subtotal + coalesce((p_nota->>'frete')::numeric, 0) - coalesce((p_nota->>'desconto')::numeric, 0)),
         aprovado_por = auth.uid(), aprovado_em = now(),
         nfe_impostos = case when jsonb_typeof(p_nota->'impostos') = 'object'
           then (p_nota->'impostos') || jsonb_build_object('total_nota', p_nota->'total', 'natureza', p_nota->'natureza') end
   where id = v_compra_id;

  v_rec_id := public.receber_compra(
    v_compra_id, v_itens_receber,
    coalesce(nullif(p_nota->>'numero',''), v_chave),
    'Entrada pela importação do XML da NF-e',
    false,
    coalesce(p_vencimento, (p_nota->>'primeiro_vencimento')::date, current_date),
    greatest(1, coalesce(p_parcelas, 1)));

  -- contas a pagar pelo total da nota (o que se paga ao fornecedor), não pelo custo líquido de créditos
  if coalesce(p_gerar_conta, true) then
    declare v_tot numeric; v_n int := greatest(1, coalesce(p_parcelas, 1)); v_parc numeric;
      v_venc date := coalesce(p_vencimento, (p_nota->>'primeiro_vencimento')::date, current_date);
      v_doc text := coalesce(nullif(p_nota->>'numero',''), v_chave);
    begin
      select total into v_tot from public.compras where id = v_compra_id;
      if coalesce(v_tot, 0) > 0 then
        for i in 1..v_n loop
          insert into public.contas_pagar (tenant_id, empresa_id, filial_id, fornecedor_id, compra_id, descricao,
            categoria, parcela, parcelas, vencimento, valor, forma_pagamento)
          values (v_tenant, v_empresa, v_dep.filial_id, v_forn_id, v_compra_id,
            'Compra nº ' || v_numero || coalesce(' - NF ' || v_doc, ''), 'Mercadorias',
            i, v_n, public.vencimento_parcela(v_venc, i),
            public.valor_parcela(round(v_tot, 2), v_n, i), 'boleto');
        end loop;
      end if;
    end;
  end if;

  for l in select * from jsonb_array_elements(v_lotes) loop
    update public.produtos set controla_lote = true where id = (l->>'produto_id')::uuid and tenant_id = v_tenant;
    perform public.estoque_lote_lancar((l->>'produto_id')::uuid, p_deposito_id, l->>'lote', l->>'tonalidade',
      l->>'calibre', 'entrada', (l->>'quantidade')::numeric, 'NF-e ' || coalesce(p_nota->>'numero', ''));
  end loop;

  return jsonb_build_object('compra_id', v_compra_id, 'numero', v_numero,
    'recebimento_id', v_rec_id, 'fornecedor_id', v_forn_id,
    'produtos_criados', v_novos, 'total', v_subtotal);
end; $function$;

-- locacao_faturar
CREATE OR REPLACE FUNCTION public.locacao_faturar(p_locacao_id uuid, p_forma forma_pagamento, p_parcelas integer DEFAULT 1, p_primeiro_vencimento date DEFAULT CURRENT_DATE, p_caixa_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_loc record; v_cli record; v_parc integer; v_valor numeric; v_resto numeric;
  v_id uuid; v_primeiro uuid; i integer; v_vparcela numeric;
begin
  PERFORM public.exige_nao_salao();
  select * into v_loc from public.locacoes where id = p_locacao_id and tenant_id = current_tenant_id();
  if v_loc is null then raise exception 'Locação não encontrada'; end if;
  if v_loc.situacao = 'cancelada' then raise exception 'Locação cancelada não é faturada'; end if;
  if coalesce(v_loc.valor_faturado, 0) > 0 then raise exception 'Locação já faturada'; end if;
  if coalesce(v_loc.valor_total, 0) <= 0 then raise exception 'Locação sem valor a faturar'; end if;

  select * into v_cli from public.clientes where id = v_loc.cliente_id;
  v_parc := greatest(coalesce(p_parcelas, 1), 1);

  for i in 1..v_parc loop
    v_vparcela := public.valor_parcela(round(v_loc.valor_total, 2), v_parc, i);
    insert into public.contas_receber (
      tenant_id, empresa_id, filial_id, cliente_id, descricao, parcela, parcelas,
      vencimento, valor, forma_pagamento, observacoes
    ) values (
      current_tenant_id(), v_loc.empresa_id, v_loc.filial_id, v_loc.cliente_id,
      'Locação nº ' || v_loc.numero || ' — ' || coalesce((select nome from public.locacao_equipamentos where id = v_loc.equipamento_id), 'equipamento'),
      i, v_parc,
      public.vencimento_parcela(coalesce(p_primeiro_vencimento, current_date), i),
      v_vparcela, p_forma, 'Faturamento da locação'
    ) returning id into v_id;
    if i = 1 then v_primeiro := v_id; end if;

    -- recebimento imediato no caixa para formas à vista
    if p_caixa_id is not null and p_forma in ('dinheiro','pix','cartao_debito') then
      insert into public.caixa_movimentos (tenant_id, caixa_id, tipo, valor, forma_pagamento, descricao, usuario_id)
      values (current_tenant_id(), p_caixa_id, 'recebimento', v_vparcela, p_forma,
              'Locação nº ' || v_loc.numero, auth.uid());
      insert into public.financeiro_baixas (tenant_id, conta_receber_id, caixa_id, valor, forma_pagamento, observacao, usuario_id)
      values (current_tenant_id(), v_id, p_caixa_id, v_vparcela, p_forma, 'Recebido no ato da locação', auth.uid());
      update public.contas_receber set valor_recebido = v_vparcela, situacao = 'pago' where id = v_id;
    end if;
  end loop;

  update public.locacoes
     set valor_faturado = v_loc.valor_total, conta_receber_id = v_primeiro
   where id = p_locacao_id;
  return v_primeiro;
end; $function$;

-- receber_compra
CREATE OR REPLACE FUNCTION public.receber_compra(p_compra_id uuid, p_itens jsonb, p_documento text DEFAULT NULL::text, p_observacao text DEFAULT NULL::text, p_gerar_conta boolean DEFAULT true, p_vencimento date DEFAULT NULL::date, p_parcelas integer DEFAULT 1)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := public.current_tenant_id();
  c public.compras; it jsonb; ci public.compra_itens;
  v_rec_id uuid; v_qtd numeric; v_custo numeric; v_valor numeric := 0;
  v_pend int; i int; v_parc numeric; v_n int;
begin
  PERFORM public.exige_nao_salao();
  select * into c from public.compras where id = p_compra_id and tenant_id = v_tenant;
  if c.id is null then raise exception 'Compra não encontrada nesta empresa'; end if;
  if c.situacao not in ('aprovado','pedido_enviado','parcialmente_recebido') then
    raise exception 'Só é possível receber uma compra aprovada ou enviada';
  end if;
  if p_itens is null or jsonb_array_length(p_itens) = 0 then raise exception 'Informe os itens recebidos'; end if;

  insert into public.compra_recebimentos (tenant_id, compra_id, documento, observacao, usuario_id)
  values (v_tenant, c.id, p_documento, p_observacao, auth.uid())
  returning id into v_rec_id;

  for it in select * from jsonb_array_elements(p_itens) loop
    select * into ci from public.compra_itens
      where id = (it->>'compra_item_id')::uuid and compra_id = c.id and tenant_id = v_tenant;
    if ci.id is null then raise exception 'Item da compra não encontrado'; end if;

    v_qtd := coalesce((it->>'quantidade')::numeric, 0);
    if v_qtd <= 0 then continue; end if;
    if ci.quantidade_recebida + v_qtd > ci.quantidade + 0.001 then
      raise exception 'Quantidade recebida maior que a comprada';
    end if;
    v_custo := coalesce((it->>'custo_unitario')::numeric, ci.custo_unitario);

    insert into public.compra_recebimento_itens (tenant_id, recebimento_id, compra_item_id, produto_id,
      quantidade, custo_unitario, divergencia, divergencia_obs)
    values (v_tenant, v_rec_id, ci.id, ci.produto_id, v_qtd, v_custo,
      nullif(it->>'divergencia','')::public.divergencia_tipo, nullif(it->>'divergencia_obs',''));

    if coalesce(it->>'divergencia','') <> 'produto_errado' then
      perform public.registrar_movimentacao_interno(
        p_produto_id => ci.produto_id,
        p_deposito_id => c.deposito_id,
        p_tipo => 'entrada'::public.mov_tipo,
        p_quantidade => v_qtd,
        p_motivo => 'Recebimento de compra',
        p_documento => 'COM-' || c.numero,
        p_deposito_destino_id => null,
        p_custo => nullif(v_custo, 0));
    end if;

    update public.compra_itens set quantidade_recebida = quantidade_recebida + v_qtd where id = ci.id;
    v_valor := v_valor + (v_qtd * v_custo);
  end loop;

  select count(*) into v_pend from public.compra_itens
    where compra_id = c.id and quantidade_recebida < quantidade - 0.001;

  update public.compras set situacao = case when v_pend = 0 then 'recebido'::public.compra_situacao
    else 'parcialmente_recebido'::public.compra_situacao end where id = c.id;

  if p_gerar_conta and v_valor > 0 then
    v_n := greatest(1, coalesce(p_parcelas,1));
    for i in 1..v_n loop
      insert into public.contas_pagar (tenant_id, empresa_id, filial_id, fornecedor_id, compra_id, descricao,
        categoria, parcela, parcelas, vencimento, valor, forma_pagamento)
      values (v_tenant, c.empresa_id, c.filial_id, c.fornecedor_id, c.id,
        'Compra nº ' || c.numero || coalesce(' - NF ' || p_documento, ''), 'Mercadorias',
        i, v_n, public.vencimento_parcela(coalesce(p_vencimento, current_date), i),
        public.valor_parcela(round(v_valor, 2), v_n, i), 'boleto');
    end loop;
  end if;

  return v_rec_id;
end; $function$;
