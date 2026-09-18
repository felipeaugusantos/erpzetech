-- ============ FASE 2: COMERCIAL ============
create type public.orcamento_situacao as enum ('rascunho','enviado','em_negociacao','aprovado','rejeitado','expirado');
create type public.pedido_situacao as enum ('aguardando_pagamento','aprovado','separacao','separado','conferencia','pronto_entrega','em_rota','entregue','concluido','cancelado');

-- ORCAMENTOS
create table public.orcamentos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  empresa_id uuid references public.empresas(id),
  filial_id uuid references public.filiais(id),
  numero bigint not null,
  cliente_id uuid not null references public.clientes(id),
  obra_id uuid references public.obras(id),
  vendedor_id uuid references public.profiles(id),
  situacao public.orcamento_situacao not null default 'rascunho',
  validade date,
  condicao_pagamento text,
  prazo_entrega text,
  subtotal numeric(14,2) not null default 0,
  desconto numeric(14,2) not null default 0,
  frete numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  observacoes text,
  motivo_rejeicao text,
  aprovado_em timestamptz,
  aprovado_por uuid references public.profiles(id),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, numero)
);

create table public.orcamento_itens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  orcamento_id uuid not null references public.orcamentos(id) on delete cascade,
  produto_id uuid not null references public.produtos(id),
  quantidade numeric(14,3) not null check (quantidade > 0),
  unidade text,
  preco_unitario numeric(14,2) not null default 0,
  desconto numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  observacao text,
  created_at timestamptz not null default now()
);

-- PEDIDOS
create table public.pedidos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  empresa_id uuid references public.empresas(id),
  filial_id uuid references public.filiais(id),
  numero bigint not null,
  orcamento_id uuid references public.orcamentos(id),
  cliente_id uuid not null references public.clientes(id),
  obra_id uuid references public.obras(id),
  vendedor_id uuid references public.profiles(id),
  deposito_id uuid not null references public.depositos(id),
  situacao public.pedido_situacao not null default 'aguardando_pagamento',
  forma_pagamento text,
  condicao_pagamento text,
  previsao_entrega date,
  entrega_cep text,
  entrega_endereco text,
  entrega_numero text,
  entrega_bairro text,
  entrega_cidade text,
  entrega_estado text,
  subtotal numeric(14,2) not null default 0,
  desconto numeric(14,2) not null default 0,
  frete numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  observacoes text,
  motivo_cancelamento text,
  estoque_reservado boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, numero)
);

create table public.pedido_itens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  produto_id uuid not null references public.produtos(id),
  quantidade numeric(14,3) not null check (quantidade > 0),
  quantidade_separada numeric(14,3) not null default 0,
  quantidade_conferida numeric(14,3) not null default 0,
  quantidade_entregue numeric(14,3) not null default 0,
  unidade text,
  preco_unitario numeric(14,2) not null default 0,
  desconto numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  divergencia text,
  observacao text,
  created_at timestamptz not null default now()
);

create table public.pedido_historico (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  situacao_anterior public.pedido_situacao,
  situacao_nova public.pedido_situacao not null,
  observacao text,
  usuario_id uuid,
  created_at timestamptz not null default now()
);

-- ENTREGAS (base; logística completa na fase 3)
create table public.entregas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  numero bigint not null,
  situacao text not null default 'entregue',
  data_entrega timestamptz not null default now(),
  recebedor text,
  observacao text,
  usuario_id uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, numero)
);

create table public.entrega_itens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  entrega_id uuid not null references public.entregas(id) on delete cascade,
  pedido_item_id uuid not null references public.pedido_itens(id),
  produto_id uuid not null references public.produtos(id),
  quantidade numeric(14,3) not null check (quantidade > 0),
  created_at timestamptz not null default now()
);

create index on public.orcamento_itens (orcamento_id);
create index on public.pedido_itens (pedido_id);
create index on public.pedido_historico (pedido_id);
create index on public.entrega_itens (entrega_id);
create index on public.orcamentos (tenant_id, situacao);
create index on public.pedidos (tenant_id, situacao);

-- GRANTS
grant select, insert, update, delete on public.orcamentos to authenticated;
grant select, insert, update, delete on public.orcamento_itens to authenticated;
grant select, insert, update, delete on public.pedidos to authenticated;
grant select, insert, update, delete on public.pedido_itens to authenticated;
grant select, insert on public.pedido_historico to authenticated;
grant select, insert on public.entregas to authenticated;
grant select, insert on public.entrega_itens to authenticated;
grant all on public.orcamentos, public.orcamento_itens, public.pedidos, public.pedido_itens,
  public.pedido_historico, public.entregas, public.entrega_itens to service_role;

-- RLS tenant-scoped
alter table public.orcamentos enable row level security;
alter table public.orcamento_itens enable row level security;
alter table public.pedidos enable row level security;
alter table public.pedido_itens enable row level security;
alter table public.pedido_historico enable row level security;
alter table public.entregas enable row level security;
alter table public.entrega_itens enable row level security;

create policy "orcamentos_tenant" on public.orcamentos for all to authenticated
  using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id());
create policy "orcamento_itens_tenant" on public.orcamento_itens for all to authenticated
  using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id());
create policy "pedidos_tenant" on public.pedidos for all to authenticated
  using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id());
create policy "pedido_itens_tenant" on public.pedido_itens for all to authenticated
  using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id());
create policy "pedido_historico_read" on public.pedido_historico for select to authenticated
  using (tenant_id = public.current_tenant_id());
create policy "pedido_historico_insert" on public.pedido_historico for insert to authenticated
  with check (tenant_id = public.current_tenant_id());
create policy "entregas_read" on public.entregas for select to authenticated
  using (tenant_id = public.current_tenant_id());
create policy "entregas_insert" on public.entregas for insert to authenticated
  with check (tenant_id = public.current_tenant_id());
create policy "entrega_itens_read" on public.entrega_itens for select to authenticated
  using (tenant_id = public.current_tenant_id());
create policy "entrega_itens_insert" on public.entrega_itens for insert to authenticated
  with check (tenant_id = public.current_tenant_id());

create trigger touch_orcamentos before update on public.orcamentos for each row execute function public.touch_updated_at();
create trigger touch_pedidos before update on public.pedidos for each row execute function public.touch_updated_at();
-- histórico e entregas são imutáveis
create trigger block_pedido_historico before update or delete on public.pedido_historico for each row execute function public.block_write();
create trigger block_entregas before update or delete on public.entregas for each row execute function public.block_write();
create trigger block_entrega_itens before update or delete on public.entrega_itens for each row execute function public.block_write();

-- numeração automática por tenant
create or replace function public.set_numero_sequencial()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_max bigint;
begin
  if new.numero is null or new.numero = 0 then
    execute format('select coalesce(max(numero),0) from public.%I where tenant_id = $1', tg_table_name)
      into v_max using new.tenant_id;
    new.numero := v_max + 1;
  end if;
  return new;
end; $$;

create trigger numero_orcamentos before insert on public.orcamentos for each row execute function public.set_numero_sequencial();
create trigger numero_pedidos before insert on public.pedidos for each row execute function public.set_numero_sequencial();
create trigger numero_entregas before insert on public.entregas for each row execute function public.set_numero_sequencial();

alter table public.orcamentos alter column numero drop not null;
alter table public.pedidos alter column numero drop not null;
alter table public.entregas alter column numero drop not null;

-- ===== recalcular totais =====
create or replace function public.recalcular_orcamento(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_sub numeric;
begin
  select coalesce(sum(total),0) into v_sub from public.orcamento_itens where orcamento_id = p_id;
  update public.orcamentos set subtotal = v_sub, total = greatest(0, v_sub - desconto + frete) where id = p_id;
end; $$;

create or replace function public.recalcular_pedido(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_sub numeric;
begin
  select coalesce(sum(total),0) into v_sub from public.pedido_itens where pedido_id = p_id;
  update public.pedidos set subtotal = v_sub, total = greatest(0, v_sub - desconto + frete) where id = p_id;
end; $$;

-- ===== converter orçamento em pedido (com reserva de estoque) =====
create or replace function public.converter_orcamento_em_pedido(p_orcamento_id uuid, p_deposito_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  o public.orcamentos;
  v_pedido_id uuid;
  it record;
begin
  if v_tenant is null then raise exception 'Usuário sem empresa vinculada'; end if;
  select * into o from public.orcamentos where id = p_orcamento_id and tenant_id = v_tenant;
  if o.id is null then raise exception 'Orçamento não encontrado nesta empresa'; end if;
  if o.situacao <> 'aprovado' then raise exception 'Somente orçamentos aprovados podem gerar pedido'; end if;
  if exists (select 1 from public.pedidos where orcamento_id = o.id and situacao <> 'cancelado') then
    raise exception 'Este orçamento já gerou um pedido';
  end if;
  if not exists (select 1 from public.depositos where id = p_deposito_id and tenant_id = v_tenant) then
    raise exception 'Depósito não encontrado nesta empresa';
  end if;

  insert into public.pedidos (tenant_id, empresa_id, filial_id, orcamento_id, cliente_id, obra_id,
    vendedor_id, deposito_id, situacao, condicao_pagamento, subtotal, desconto, frete, total, observacoes)
  values (v_tenant, o.empresa_id, o.filial_id, o.id, o.cliente_id, o.obra_id,
    coalesce(o.vendedor_id, auth.uid()), p_deposito_id, 'aguardando_pagamento', o.condicao_pagamento,
    o.subtotal, o.desconto, o.frete, o.total, o.observacoes)
  returning id into v_pedido_id;

  insert into public.pedido_itens (tenant_id, pedido_id, produto_id, quantidade, unidade,
    preco_unitario, desconto, total, observacao)
  select v_tenant, v_pedido_id, i.produto_id, i.quantidade, i.unidade, i.preco_unitario, i.desconto, i.total, i.observacao
  from public.orcamento_itens i where i.orcamento_id = o.id;

  -- reserva de estoque
  for it in select produto_id, sum(quantidade) q from public.pedido_itens where pedido_id = v_pedido_id group by produto_id loop
    perform public.registrar_movimentacao(it.produto_id, p_deposito_id, 'reserva'::mov_tipo, it.q,
      'Reserva do pedido', 'PED-' || (select numero from public.pedidos where id = v_pedido_id), null);
  end loop;

  update public.pedidos set estoque_reservado = true where id = v_pedido_id;

  insert into public.pedido_historico (tenant_id, pedido_id, situacao_anterior, situacao_nova, observacao, usuario_id)
  values (v_tenant, v_pedido_id, null, 'aguardando_pagamento',
    'Pedido gerado do orçamento nº ' || o.numero || ' com reserva de estoque', auth.uid());

  return v_pedido_id;
end; $$;

-- ===== avançar status do pedido =====
create or replace function public.pedido_avancar_status(p_pedido_id uuid, p_situacao public.pedido_situacao, p_observacao text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  p public.pedidos;
  it record;
  v_permitido public.pedido_situacao[];
begin
  select * into p from public.pedidos where id = p_pedido_id and tenant_id = v_tenant;
  if p.id is null then raise exception 'Pedido não encontrado nesta empresa'; end if;
  if p.situacao = p_situacao then return; end if;
  if p.situacao in ('concluido','cancelado') then raise exception 'Pedido já finalizado'; end if;

  v_permitido := case p.situacao
    when 'aguardando_pagamento' then array['aprovado','cancelado']::public.pedido_situacao[]
    when 'aprovado' then array['separacao','cancelado']::public.pedido_situacao[]
    when 'separacao' then array['separado','cancelado']::public.pedido_situacao[]
    when 'separado' then array['conferencia','separacao','cancelado']::public.pedido_situacao[]
    when 'conferencia' then array['pronto_entrega','separacao','cancelado']::public.pedido_situacao[]
    when 'pronto_entrega' then array['em_rota','cancelado']::public.pedido_situacao[]
    when 'em_rota' then array['entregue','cancelado']::public.pedido_situacao[]
    when 'entregue' then array['concluido']::public.pedido_situacao[]
    else array[]::public.pedido_situacao[] end;

  if not (p_situacao = any(v_permitido)) then
    raise exception 'Transição não permitida: % → %', p.situacao, p_situacao;
  end if;

  if p_situacao = 'separado' then
    if exists (select 1 from public.pedido_itens where pedido_id = p.id and quantidade_separada < quantidade) then
      raise exception 'Existem itens sem separação completa';
    end if;
  end if;

  if p_situacao = 'pronto_entrega' then
    if exists (select 1 from public.pedido_itens where pedido_id = p.id and (divergencia is not null and divergencia <> '')) then
      raise exception 'Existem divergências de conferência não resolvidas';
    end if;
    if exists (select 1 from public.pedido_itens where pedido_id = p.id and quantidade_conferida < quantidade) then
      raise exception 'Conferência incompleta';
    end if;
  end if;

  if p_situacao = 'entregue' then
    if exists (select 1 from public.pedido_itens where pedido_id = p.id and quantidade_entregue < quantidade) then
      raise exception 'Existem produtos pendentes de entrega';
    end if;
  end if;

  if p_situacao = 'cancelado' then
    if p.estoque_reservado then
      for it in select produto_id, sum(quantidade - quantidade_entregue) q from public.pedido_itens
                 where pedido_id = p.id group by produto_id having sum(quantidade - quantidade_entregue) > 0 loop
        perform public.registrar_movimentacao(it.produto_id, p.deposito_id, 'liberacao_reserva'::mov_tipo, it.q,
          'Cancelamento do pedido', 'PED-' || p.numero, null);
      end loop;
      update public.pedidos set estoque_reservado = false where id = p.id;
    end if;
    update public.pedidos set motivo_cancelamento = p_observacao where id = p.id;
  end if;

  update public.pedidos set situacao = p_situacao where id = p.id;

  insert into public.pedido_historico (tenant_id, pedido_id, situacao_anterior, situacao_nova, observacao, usuario_id)
  values (v_tenant, p.id, p.situacao, p_situacao, p_observacao, auth.uid());
end; $$;

-- ===== registrar entrega (total ou parcial) =====
create or replace function public.pedido_registrar_entrega(p_pedido_id uuid, p_itens jsonb, p_recebedor text default null, p_observacao text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  p public.pedidos;
  v_entrega_id uuid;
  r record;
  v_item public.pedido_itens;
  v_pendentes numeric;
begin
  select * into p from public.pedidos where id = p_pedido_id and tenant_id = v_tenant;
  if p.id is null then raise exception 'Pedido não encontrado nesta empresa'; end if;
  if p.situacao not in ('pronto_entrega','em_rota') then
    raise exception 'O pedido precisa estar pronto para entrega ou em rota';
  end if;

  insert into public.entregas (tenant_id, pedido_id, situacao, recebedor, observacao, usuario_id)
  values (v_tenant, p.id, 'entregue', p_recebedor, p_observacao, auth.uid())
  returning id into v_entrega_id;

  for r in select (x->>'pedido_item_id')::uuid item_id, (x->>'quantidade')::numeric q
           from jsonb_array_elements(p_itens) x loop
    if r.q is null or r.q <= 0 then continue; end if;
    select * into v_item from public.pedido_itens where id = r.item_id and pedido_id = p.id;
    if v_item.id is null then raise exception 'Item do pedido não encontrado'; end if;
    if v_item.quantidade_entregue + r.q > v_item.quantidade then
      raise exception 'Quantidade entregue maior que a quantidade do pedido';
    end if;

    perform public.registrar_movimentacao(v_item.produto_id, p.deposito_id, 'liberacao_reserva'::mov_tipo, r.q,
      'Baixa de reserva na entrega', 'PED-' || p.numero, null);
    perform public.registrar_movimentacao(v_item.produto_id, p.deposito_id, 'saida'::mov_tipo, r.q,
      'Entrega do pedido', 'PED-' || p.numero, null);

    update public.pedido_itens set quantidade_entregue = quantidade_entregue + r.q where id = v_item.id;

    insert into public.entrega_itens (tenant_id, entrega_id, pedido_item_id, produto_id, quantidade)
    values (v_tenant, v_entrega_id, v_item.id, v_item.produto_id, r.q);
  end loop;

  select coalesce(sum(quantidade - quantidade_entregue),0) into v_pendentes from public.pedido_itens where pedido_id = p.id;

  if v_pendentes <= 0 then
    update public.pedidos set situacao = 'entregue', estoque_reservado = false where id = p.id;
    insert into public.pedido_historico (tenant_id, pedido_id, situacao_anterior, situacao_nova, observacao, usuario_id)
    values (v_tenant, p.id, p.situacao, 'entregue', coalesce(p_observacao, 'Entrega concluída'), auth.uid());
  else
    if p.situacao <> 'em_rota' then
      update public.pedidos set situacao = 'em_rota' where id = p.id;
      insert into public.pedido_historico (tenant_id, pedido_id, situacao_anterior, situacao_nova, observacao, usuario_id)
      values (v_tenant, p.id, p.situacao, 'em_rota', 'Entrega parcial registrada', auth.uid());
    end if;
  end if;

  return v_entrega_id;
end; $$;

revoke execute on function public.set_numero_sequencial() from anon, public;
revoke execute on function public.recalcular_orcamento(uuid) from anon, public;
revoke execute on function public.recalcular_pedido(uuid) from anon, public;
revoke execute on function public.converter_orcamento_em_pedido(uuid, uuid) from anon, public;
revoke execute on function public.pedido_avancar_status(uuid, public.pedido_situacao, text) from anon, public;
revoke execute on function public.pedido_registrar_entrega(uuid, jsonb, text, text) from anon, public;
grant execute on function public.recalcular_orcamento(uuid) to authenticated;
grant execute on function public.recalcular_pedido(uuid) to authenticated;
grant execute on function public.converter_orcamento_em_pedido(uuid, uuid) to authenticated;
grant execute on function public.pedido_avancar_status(uuid, public.pedido_situacao, text) to authenticated;
grant execute on function public.pedido_registrar_entrega(uuid, jsonb, text, text) to authenticated;

-- permissões dos perfis para os novos módulos
insert into public.role_permissoes (tenant_id, role, modulo, pode_ver, pode_criar, pode_editar, pode_excluir)
select t.id, r.role, m.modulo,
  true,
  r.role in ('administrador','gestor','vendedor','caixa'),
  r.role in ('administrador','gestor','vendedor','caixa','estoquista','logistica'),
  r.role in ('administrador','gestor')
from public.tenants t
cross join (select unnest(enum_range(null::app_role)) role) r
cross join (select unnest(array['orcamentos','pedidos','entregas']) modulo) m
on conflict do nothing;
