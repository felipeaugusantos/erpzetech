create or replace function public.pdv_venda(
  p_deposito_id uuid,
  p_itens jsonb,
  p_forma forma_pagamento default 'dinheiro',
  p_cliente_id uuid default null,
  p_desconto numeric default 0,
  p_parcelas integer default 1,
  p_primeiro_vencimento date default null,
  p_observacao text default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_empresa uuid;
  v_filial uuid;
  v_cliente uuid := p_cliente_id;
  v_caixa uuid;
  v_pedido uuid;
  v_subtotal numeric := 0;
  v_total numeric := 0;
  v_numero bigint;
  it jsonb;
  v_prod record;
  v_qtd numeric;
  v_preco numeric;
begin
  if v_tenant is null then raise exception 'Usuário sem empresa vinculada'; end if;
  if p_itens is null or jsonb_array_length(p_itens) = 0 then
    raise exception 'Inclua pelo menos um produto na venda';
  end if;
  if not exists (select 1 from public.depositos where id = p_deposito_id and tenant_id = v_tenant) then
    raise exception 'Depósito não encontrado nesta empresa';
  end if;

  select empresa_id, filial_id into v_empresa, v_filial
    from public.profiles where id = auth.uid();
  if v_filial is null then
    select id into v_filial from public.filiais where tenant_id = v_tenant order by nome limit 1;
  end if;
  if v_empresa is null then
    select id into v_empresa from public.empresas where tenant_id = v_tenant order by created_at limit 1;
  end if;

  if v_cliente is null then
    select id into v_cliente from public.clientes
      where tenant_id = v_tenant and nome = 'Consumidor final' limit 1;
    if v_cliente is null then
      insert into public.clientes (tenant_id, empresa_id, filial_id, tipo, nome, ativo)
      values (v_tenant, v_empresa, v_filial, 'PF', 'Consumidor final', true)
      returning id into v_cliente;
    end if;
  end if;

  if p_forma not in ('crediario', 'boleto') then
    select id into v_caixa from public.caixas
      where tenant_id = v_tenant and situacao = 'aberto'
      order by aberto_em desc limit 1;
    if v_caixa is null then
      raise exception 'Abra o caixa antes de vender no PDV';
    end if;
  end if;

  insert into public.pedidos (tenant_id, empresa_id, filial_id, cliente_id, vendedor_id,
    deposito_id, situacao, forma_pagamento, condicao_pagamento, subtotal, desconto, frete, total,
    observacoes, estoque_reservado)
  values (v_tenant, v_empresa, v_filial, v_cliente, auth.uid(), p_deposito_id, 'aguardando_pagamento',
    p_forma, case when p_parcelas > 1 then p_parcelas || 'x' else 'à vista' end,
    0, greatest(coalesce(p_desconto,0), 0), 0, 0,
    coalesce(p_observacao, 'Venda de balcão (PDV)'), false)
  returning id into v_pedido;

  for it in select * from jsonb_array_elements(p_itens) loop
    v_qtd := (it->>'quantidade')::numeric;
    if v_qtd is null or v_qtd <= 0 then raise exception 'Quantidade inválida na venda'; end if;
    select id, descricao, unidade_venda, unidade, preco_venda into v_prod
      from public.produtos where id = (it->>'produto_id')::uuid and tenant_id = v_tenant;
    if v_prod.id is null then raise exception 'Produto não encontrado nesta empresa'; end if;
    v_preco := coalesce(nullif((it->>'preco_unitario')::numeric, 0), v_prod.preco_venda, 0);

    insert into public.pedido_itens (tenant_id, pedido_id, produto_id, quantidade, unidade,
      preco_unitario, desconto, total)
    values (v_tenant, v_pedido, v_prod.id, v_qtd,
      coalesce(v_prod.unidade_venda, v_prod.unidade, 'UN'), v_preco, 0, v_qtd * v_preco);

    v_subtotal := v_subtotal + v_qtd * v_preco;
  end loop;

  v_total := greatest(v_subtotal - greatest(coalesce(p_desconto,0), 0), 0);
  update public.pedidos set subtotal = v_subtotal, total = v_total where id = v_pedido;
  select numero into v_numero from public.pedidos where id = v_pedido;

  for it in select * from jsonb_array_elements(p_itens) loop
    perform public.registrar_movimentacao(
      (it->>'produto_id')::uuid, p_deposito_id, 'saida'::mov_tipo, (it->>'quantidade')::numeric,
      'Venda no PDV', 'PDV-' || v_numero, null);
  end loop;

  if v_caixa is not null then
    perform public.caixa_movimento(v_caixa, 'venda'::caixa_mov_tipo, v_total,
      'Venda no PDV nº ' || v_numero, p_forma);
  else
    perform public.gerar_contas_receber(v_pedido, greatest(coalesce(p_parcelas,1),1),
      coalesce(p_primeiro_vencimento, current_date + 30), p_forma);
  end if;

  update public.pedido_itens
    set quantidade_separada = quantidade, quantidade_conferida = quantidade,
        quantidade_entregue = quantidade
    where pedido_id = v_pedido;
  update public.pedidos set situacao = 'concluido' where id = v_pedido;

  insert into public.pedido_historico (tenant_id, pedido_id, situacao_anterior, situacao_nova, observacao, usuario_id)
  values (v_tenant, v_pedido, 'aguardando_pagamento', 'concluido',
    'Venda de balcão no PDV com baixa de estoque e lançamento no caixa', auth.uid());

  perform public.comissionar_pedido_id(v_pedido);

  return v_pedido;
end; $$;

revoke all on function public.pdv_venda(uuid, jsonb, forma_pagamento, uuid, numeric, integer, date, text) from anon;
grant execute on function public.pdv_venda(uuid, jsonb, forma_pagamento, uuid, numeric, integer, date, text) to authenticated;

create or replace function public.pedido_checkout(
  p_pedido_id uuid,
  p_valor numeric,
  p_forma forma_pagamento default 'dinheiro',
  p_parcelas integer default 1,
  p_primeiro_vencimento date default null,
  p_observacao text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  p public.pedidos;
  v_caixa uuid;
  v_restante numeric := p_valor;
  v_no_caixa numeric := 0;
  v_contas int := 0;
  c record;
  v_aplicar numeric;
begin
  if v_tenant is null then raise exception 'Usuário sem empresa vinculada'; end if;
  select * into p from public.pedidos where id = p_pedido_id and tenant_id = v_tenant;
  if p.id is null then raise exception 'Pedido não encontrado nesta empresa'; end if;
  if p.situacao = 'cancelado' then raise exception 'Pedido cancelado'; end if;
  if p_valor is null or p_valor <= 0 then raise exception 'Informe o valor recebido'; end if;

  if p_forma in ('crediario', 'boleto') or coalesce(p_parcelas, 1) > 1 then
    if not exists (select 1 from public.contas_receber where pedido_id = p.id and situacao <> 'cancelado') then
      v_contas := public.gerar_contas_receber(p.id, greatest(coalesce(p_parcelas,1),1),
        coalesce(p_primeiro_vencimento, current_date + 30), p_forma);
    end if;
  else
    select id into v_caixa from public.caixas
      where tenant_id = v_tenant and situacao = 'aberto'
      order by aberto_em desc limit 1;
    if v_caixa is null then raise exception 'Abra o caixa antes de receber o pagamento'; end if;

    for c in select id, valor, valor_recebido from public.contas_receber
      where pedido_id = p.id and situacao in ('aberto','parcial')
      order by vencimento loop
      exit when v_restante <= 0;
      v_aplicar := least(v_restante, c.valor - c.valor_recebido);
      if v_aplicar > 0 then
        perform public.baixar_conta('receber', c.id, v_aplicar, p_forma, current_date,
          coalesce(p_observacao, 'Checkout do pedido nº ' || p.numero), v_caixa);
        v_restante := v_restante - v_aplicar;
        v_no_caixa := v_no_caixa + v_aplicar;
      end if;
    end loop;

    if v_restante > 0 then
      perform public.caixa_movimento(v_caixa, 'recebimento'::caixa_mov_tipo, v_restante,
        coalesce(p_observacao, 'Checkout do pedido nº ' || p.numero), p_forma);
      v_no_caixa := v_no_caixa + v_restante;
      v_restante := 0;
    end if;
  end if;

  update public.pedidos
    set forma_pagamento = p_forma,
        condicao_pagamento = case when coalesce(p_parcelas,1) > 1 then p_parcelas || 'x'
                                  else coalesce(condicao_pagamento, 'à vista') end
    where id = p.id;

  if p.situacao = 'aguardando_pagamento' then
    perform public.pedido_avancar_status(p.id, 'aprovado'::pedido_situacao,
      'Pagamento recebido no checkout (' || p_forma::text || ')');
  end if;

  return jsonb_build_object('caixa', v_no_caixa, 'contas_geradas', v_contas);
end; $$;

revoke all on function public.pedido_checkout(uuid, numeric, forma_pagamento, integer, date, text) from anon;
grant execute on function public.pedido_checkout(uuid, numeric, forma_pagamento, integer, date, text) to authenticated;