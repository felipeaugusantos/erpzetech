alter table public.profiles add column if not exists cargo text;
alter table public.profiles add column if not exists data_admissao date;
alter table public.profiles add column if not exists data_demissao date;
alter table public.profiles add column if not exists vender_outras_lojas boolean not null default false;

create table if not exists public.pedido_orcamentos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  orcamento_id uuid not null references public.orcamentos(id),
  created_at timestamptz not null default now(),
  unique (pedido_id, orcamento_id)
);

grant select, insert on public.pedido_orcamentos to authenticated;
grant all on public.pedido_orcamentos to service_role;

alter table public.pedido_orcamentos enable row level security;

drop policy if exists "pedido_orcamentos tenant" on public.pedido_orcamentos;
create policy "pedido_orcamentos tenant" on public.pedido_orcamentos
  for all to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create index if not exists pedido_orcamentos_orcamento_idx on public.pedido_orcamentos (orcamento_id);

create or replace function public.converter_orcamentos_em_pedido(p_orcamento_ids uuid[], p_deposito_id uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_cliente uuid;
  v_qtd int;
  v_pedido_id uuid;
  o public.orcamentos;
  it record;
  v_numeros text;
begin
  if v_tenant is null then raise exception 'Usuário sem empresa vinculada'; end if;
  if p_orcamento_ids is null or array_length(p_orcamento_ids, 1) is null then
    raise exception 'Informe ao menos um orçamento';
  end if;
  if not exists (select 1 from public.depositos where id = p_deposito_id and tenant_id = v_tenant) then
    raise exception 'Depósito não encontrado nesta empresa';
  end if;

  select count(*), count(distinct cliente_id) into v_qtd, v_cliente
  from public.orcamentos where id = any(p_orcamento_ids) and tenant_id = v_tenant;
  if v_qtd <> array_length(p_orcamento_ids, 1) then
    raise exception 'Orçamento não encontrado nesta empresa';
  end if;
  if v_cliente <> 1 then
    raise exception 'Só é possível juntar orçamentos do mesmo cliente';
  end if;
  if exists (select 1 from public.orcamentos where id = any(p_orcamento_ids) and situacao <> 'aprovado') then
    raise exception 'Somente orçamentos aprovados podem gerar pedido';
  end if;
  if exists (
    select 1 from public.pedidos p
    where p.orcamento_id = any(p_orcamento_ids) and p.situacao <> 'cancelado'
  ) or exists (
    select 1 from public.pedido_orcamentos po
    join public.pedidos p on p.id = po.pedido_id and p.situacao <> 'cancelado'
    where po.orcamento_id = any(p_orcamento_ids)
  ) then
    raise exception 'Um dos orçamentos já gerou pedido';
  end if;

  select * into o from public.orcamentos
  where id = any(p_orcamento_ids) and tenant_id = v_tenant
  order by numero limit 1;

  insert into public.pedidos (tenant_id, empresa_id, filial_id, orcamento_id, cliente_id, obra_id,
    vendedor_id, profissional_id, deposito_id, situacao, condicao_pagamento,
    subtotal, desconto, frete, total, observacoes)
  select v_tenant, o.empresa_id, o.filial_id, o.id, o.cliente_id, o.obra_id,
    coalesce(o.vendedor_id, auth.uid()), o.profissional_id, p_deposito_id,
    'aguardando_pagamento', o.condicao_pagamento,
    coalesce(sum(x.subtotal),0), coalesce(sum(x.desconto),0), coalesce(sum(x.frete),0),
    coalesce(sum(x.total),0), o.observacoes
  from public.orcamentos x where x.id = any(p_orcamento_ids)
  returning id into v_pedido_id;

  insert into public.pedido_itens (tenant_id, pedido_id, produto_id, quantidade, unidade,
    preco_unitario, desconto, total, observacao)
  select v_tenant, v_pedido_id, i.produto_id, i.quantidade, i.unidade, i.preco_unitario,
    i.desconto, i.total, i.observacao
  from public.orcamento_itens i where i.orcamento_id = any(p_orcamento_ids);

  insert into public.pedido_orcamentos (tenant_id, pedido_id, orcamento_id)
  select v_tenant, v_pedido_id, unnest(p_orcamento_ids);

  for it in select produto_id, sum(quantidade) q from public.pedido_itens
            where pedido_id = v_pedido_id group by produto_id loop
    perform public.registrar_movimentacao(it.produto_id, p_deposito_id, 'reserva'::mov_tipo, it.q,
      'Reserva do pedido', 'PED-' || (select numero from public.pedidos where id = v_pedido_id), null);
  end loop;

  update public.pedidos set estoque_reservado = true where id = v_pedido_id;

  select string_agg(numero::text, ', ' order by numero) into v_numeros
  from public.orcamentos where id = any(p_orcamento_ids);

  insert into public.pedido_historico (tenant_id, pedido_id, situacao_anterior, situacao_nova, observacao, usuario_id)
  values (v_tenant, v_pedido_id, null, 'aguardando_pagamento',
    'Pedido gerado do(s) orçamento(s) nº ' || v_numeros || ' com reserva de estoque', auth.uid());

  return v_pedido_id;
end; $function$;

revoke all on function public.converter_orcamentos_em_pedido(uuid[], uuid) from anon;
grant execute on function public.converter_orcamentos_em_pedido(uuid[], uuid) to authenticated;

create or replace function public.converter_orcamento_em_pedido(p_orcamento_id uuid, p_deposito_id uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
begin
  return public.converter_orcamentos_em_pedido(array[p_orcamento_id], p_deposito_id);
end; $function$;