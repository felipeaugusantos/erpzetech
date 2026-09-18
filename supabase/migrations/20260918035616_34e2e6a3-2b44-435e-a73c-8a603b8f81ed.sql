create or replace function public.planejar_entrega(
  p_pedido_id uuid,
  p_itens jsonb,
  p_veiculo_id uuid default null,
  p_motorista_id uuid default null,
  p_previsao date default null,
  p_sequencia integer default null,
  p_observacao text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  p public.pedidos;
  v_id uuid;
  r record;
  v_item public.pedido_itens;
  v_ja numeric;
begin
  select * into p from public.pedidos where id = p_pedido_id and tenant_id = v_tenant;
  if p.id is null then raise exception 'Pedido não encontrado nesta empresa'; end if;
  if p.situacao not in ('pronto_entrega','em_rota') then
    raise exception 'O pedido precisa estar pronto para entrega';
  end if;

  insert into public.entregas (tenant_id, pedido_id, situacao, veiculo_id, motorista_id, previsao_data, sequencia, observacao, usuario_id)
  values (v_tenant, p.id, 'planejada', p_veiculo_id, p_motorista_id, p_previsao, p_sequencia, p_observacao, auth.uid())
  returning id into v_id;

  for r in select (x->>'pedido_item_id')::uuid item_id, (x->>'quantidade')::numeric q
           from jsonb_array_elements(p_itens) x loop
    if r.q is null or r.q <= 0 then continue; end if;
    select * into v_item from public.pedido_itens where id = r.item_id and pedido_id = p.id;
    if v_item.id is null then raise exception 'Item do pedido não encontrado'; end if;
    -- só entregas ainda em aberto contam: o que já foi entregue está em quantidade_entregue
    select coalesce(sum(ei.quantidade),0) into v_ja
      from public.entrega_itens ei join public.entregas e on e.id = ei.entrega_id
      where ei.pedido_item_id = v_item.id and e.situacao in ('planejada','em_rota');
    if v_item.quantidade_entregue + v_ja + r.q > v_item.quantidade then
      raise exception 'Quantidade planejada maior que a pendente do pedido';
    end if;
    insert into public.entrega_itens (tenant_id, entrega_id, pedido_item_id, produto_id, quantidade)
    values (v_tenant, v_id, v_item.id, v_item.produto_id, r.q);
  end loop;

  if not exists (select 1 from public.entrega_itens where entrega_id = v_id) then
    raise exception 'Informe ao menos um produto para a entrega';
  end if;

  return v_id;
end $$;