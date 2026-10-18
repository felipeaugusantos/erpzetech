create or replace function public.pedido_alterar(
  p_pedido_id uuid, p_itens jsonb, p_motivo text,
  p_desconto numeric default null, p_frete numeric default null,
  p_condicao_pagamento text default null, p_previsao_entrega date default null, p_observacoes text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  p public.pedidos;
  it record;
begin
  perform public.exige_nao_salao();
  perform public.exige_papel(array['administrador','gestor','vendedor']);
  select * into p from public.pedidos where id = p_pedido_id and tenant_id = v_tenant for update;
  if p.id is null then raise exception 'Pedido não encontrado nesta empresa'; end if;
  if p.situacao not in ('aguardando_pagamento','aprovado') then
    raise exception 'Só dá para alterar pedido antes de começar a separação';
  end if;
  if coalesce(trim(p_motivo),'') = '' then raise exception 'Informe o motivo da alteração'; end if;
  if p_itens is null or jsonb_array_length(p_itens) = 0 then raise exception 'O pedido precisa de ao menos um item'; end if;
  if exists (select 1 from public.pedido_itens where pedido_id = p.id
             and (quantidade_separada > 0 or quantidade_conferida > 0 or quantidade_entregue > 0)) then
    raise exception 'Pedido já tem itens separados ou entregues';
  end if;
  if exists (select 1 from public.nfe_pedidos np join public.nfe n on n.id = np.nfe_id
             where np.pedido_id = p.id and n.situacao::text <> 'cancelada') then
    raise exception 'Pedido tem NF-e. Cancele ou exclua a nota antes de alterar';
  end if;
  if exists (select 1 from public.contas_receber where pedido_id = p.id
             and situacao <> 'cancelado' and valor_recebido > 0) then
    raise exception 'Pedido já tem pagamento recebido. Estorne o recebimento antes de alterar';
  end if;
  if exists (select 1 from public.pedido_personalizacao where pedido_id = p.id and grade_baixada) then
    raise exception 'A produção deste pedido já começou';
  end if;
  if exists (select 1 from jsonb_array_elements(p_itens) i
             where coalesce((i->>'quantidade')::numeric,0) <= 0 or coalesce((i->>'preco_unitario')::numeric,-1) < 0
                or not exists (select 1 from public.produtos pr where pr.id = (i->>'produto_id')::uuid and pr.tenant_id = v_tenant)) then
    raise exception 'Confira os itens: produto, quantidade e preço';
  end if;

  -- devolve a reserva dos itens antigos
  if p.estoque_reservado then
    for it in select produto_id, sum(quantidade) q from public.pedido_itens where pedido_id = p.id group by produto_id loop
      perform public.registrar_movimentacao_interno(it.produto_id, p.deposito_id, 'liberacao_reserva'::mov_tipo, it.q,
        'Alteração do pedido', 'PED-' || p.numero, null);
    end loop;
  end if;

  delete from public.pedido_itens where pedido_id = p.id;
  insert into public.pedido_itens (tenant_id, pedido_id, produto_id, quantidade, unidade, preco_unitario, desconto, total)
  select v_tenant, p.id, (i->>'produto_id')::uuid, (i->>'quantidade')::numeric,
    coalesce(i->>'unidade', (select unidade from public.produtos where id = (i->>'produto_id')::uuid)),
    (i->>'preco_unitario')::numeric, coalesce((i->>'desconto')::numeric,0),
    round((i->>'quantidade')::numeric * (i->>'preco_unitario')::numeric - coalesce((i->>'desconto')::numeric,0), 2)
  from jsonb_array_elements(p_itens) i;

  update public.pedidos set
    desconto = coalesce(p_desconto, desconto), frete = coalesce(p_frete, frete),
    condicao_pagamento = coalesce(p_condicao_pagamento, condicao_pagamento),
    previsao_entrega = coalesce(p_previsao_entrega, previsao_entrega),
    observacoes = coalesce(p_observacoes, observacoes)
  where id = p.id;
  perform public.recalcular_pedido(p.id);

  for it in select produto_id, sum(quantidade) q from public.pedido_itens where pedido_id = p.id group by produto_id loop
    perform public.registrar_movimentacao_interno(it.produto_id, p.deposito_id, 'reserva'::mov_tipo, it.q,
      'Reserva do pedido alterado', 'PED-' || p.numero, null);
  end loop;
  update public.pedidos set estoque_reservado = true where id = p.id;

  -- parcelas ainda não pagas ficam com valor antigo: cancela para gerar de novo
  update public.contas_receber set situacao = 'cancelado', motivo_cancelamento = 'Pedido alterado: ' || trim(p_motivo)
  where pedido_id = p.id and situacao <> 'cancelado' and coalesce(valor_recebido,0) = 0;

  insert into public.pedido_historico (tenant_id, pedido_id, situacao_anterior, situacao_nova, observacao, usuario_id)
  values (v_tenant, p.id, p.situacao, p.situacao, 'Pedido alterado: ' || trim(p_motivo), auth.uid());
end; $$;
revoke all on function public.pedido_alterar(uuid, jsonb, text, numeric, numeric, text, date, text) from anon, public;
grant execute on function public.pedido_alterar(uuid, jsonb, text, numeric, numeric, text, date, text) to authenticated;

-- Cancelamento: exige motivo, bloqueia com pagamento recebido ou NF-e válida, e cancela as parcelas em aberto.
create or replace function public.pedido_cancelar_validar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.situacao = 'cancelado' and old.situacao is distinct from 'cancelado' then
    if coalesce(trim(new.motivo_cancelamento),'') = '' then
      raise exception 'Informe o motivo do cancelamento';
    end if;
    if exists (select 1 from public.contas_receber where pedido_id = new.id
               and situacao <> 'cancelado' and coalesce(valor_recebido,0) > 0) then
      raise exception 'Pedido tem pagamento recebido. Estorne o recebimento antes de cancelar';
    end if;
    if exists (select 1 from public.nfe_pedidos np join public.nfe n on n.id = np.nfe_id
               where np.pedido_id = new.id and n.situacao::text = 'autorizada') then
      raise exception 'Pedido tem NF-e autorizada. Cancele a nota antes de cancelar o pedido';
    end if;
    update public.contas_receber set situacao = 'cancelado',
      motivo_cancelamento = 'Pedido cancelado: ' || trim(new.motivo_cancelamento)
    where pedido_id = new.id and situacao <> 'cancelado';
    new.cancelado_por := coalesce(new.cancelado_por, auth.uid());
  end if;
  return new;
end; $$;
revoke all on function public.pedido_cancelar_validar() from anon, public, authenticated;
drop trigger if exists pedido_cancelar_validar_trg on public.pedidos;
create trigger pedido_cancelar_validar_trg before update of situacao on public.pedidos
  for each row execute function public.pedido_cancelar_validar();