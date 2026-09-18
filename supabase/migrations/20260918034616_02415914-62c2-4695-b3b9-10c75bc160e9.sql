-- ===== Veículos =====
create table if not exists public.veiculos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id(),
  empresa_id uuid not null references public.empresas(id),
  filial_id uuid references public.filiais(id),
  placa text not null,
  descricao text not null,
  tipo text not null default 'caminhao',
  capacidade_kg numeric,
  capacidade_m3 numeric,
  observacao text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, placa)
);
grant select, insert, update, delete on public.veiculos to authenticated;
grant all on public.veiculos to service_role;
alter table public.veiculos enable row level security;
create policy veiculos_read on public.veiculos for select to authenticated using (tenant_id = public.current_tenant_id());
create policy veiculos_insert on public.veiculos for insert to authenticated with check (tenant_id = public.current_tenant_id());
create policy veiculos_update on public.veiculos for update to authenticated using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id());
create trigger touch_veiculos before update on public.veiculos for each row execute function public.touch_updated_at();

-- ===== Motoristas =====
create table if not exists public.motoristas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id(),
  empresa_id uuid not null references public.empresas(id),
  filial_id uuid references public.filiais(id),
  user_id uuid references auth.users(id),
  nome text not null,
  telefone text,
  cnh text,
  categoria_cnh text,
  validade_cnh date,
  veiculo_id uuid references public.veiculos(id),
  observacao text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.motoristas to authenticated;
grant all on public.motoristas to service_role;
alter table public.motoristas enable row level security;
create policy motoristas_read on public.motoristas for select to authenticated using (tenant_id = public.current_tenant_id());
create policy motoristas_insert on public.motoristas for insert to authenticated with check (tenant_id = public.current_tenant_id());
create policy motoristas_update on public.motoristas for update to authenticated using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id());
create trigger touch_motoristas before update on public.motoristas for each row execute function public.touch_updated_at();

-- ===== Entregas: planejamento e execução =====
alter table public.entregas
  add column if not exists veiculo_id uuid references public.veiculos(id),
  add column if not exists motorista_id uuid references public.motoristas(id),
  add column if not exists previsao_data date,
  add column if not exists sequencia integer,
  add column if not exists data_saida timestamptz,
  add column if not exists recebedor_documento text,
  add column if not exists assinatura text,
  add column if not exists foto_url text,
  add column if not exists motivo_insucesso text,
  add column if not exists latitude numeric,
  add column if not exists longitude numeric;

drop policy if exists entregas_update on public.entregas;
create policy entregas_update on public.entregas for update to authenticated using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id());

-- ===== Planejar entrega =====
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
    select coalesce(sum(ei.quantidade),0) into v_ja
      from public.entrega_itens ei join public.entregas e on e.id = ei.entrega_id
      where ei.pedido_item_id = v_item.id and e.situacao in ('planejada','em_rota','entregue');
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
grant execute on function public.planejar_entrega(uuid, jsonb, uuid, uuid, date, integer, text) to authenticated;

-- ===== Iniciar rota =====
create or replace function public.entrega_iniciar_rota(p_entrega_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  e public.entregas;
  p public.pedidos;
begin
  select * into e from public.entregas where id = p_entrega_id and tenant_id = v_tenant;
  if e.id is null then raise exception 'Entrega não encontrada nesta empresa'; end if;
  if e.situacao <> 'planejada' then raise exception 'Somente entregas planejadas podem sair para rota'; end if;
  if e.veiculo_id is null or e.motorista_id is null then
    raise exception 'Defina veículo e motorista antes de sair para rota';
  end if;

  update public.entregas set situacao = 'em_rota', data_saida = now() where id = e.id;

  select * into p from public.pedidos where id = e.pedido_id;
  if p.situacao = 'pronto_entrega' then
    update public.pedidos set situacao = 'em_rota' where id = p.id;
    insert into public.pedido_historico (tenant_id, pedido_id, situacao_anterior, situacao_nova, observacao, usuario_id)
    values (v_tenant, p.id, p.situacao, 'em_rota', 'Entrega ' || e.numero || ' saiu para rota', auth.uid());
  end if;
end $$;
grant execute on function public.entrega_iniciar_rota(uuid) to authenticated;

-- ===== Concluir entrega (motorista) =====
create or replace function public.entrega_concluir(
  p_entrega_id uuid,
  p_recebedor text,
  p_documento text default null,
  p_assinatura text default null,
  p_foto_url text default null,
  p_observacao text default null,
  p_itens jsonb default null,
  p_latitude numeric default null,
  p_longitude numeric default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  e public.entregas;
  p public.pedidos;
  ei record;
  v_q numeric;
  v_item public.pedido_itens;
  v_pendentes numeric;
begin
  select * into e from public.entregas where id = p_entrega_id and tenant_id = v_tenant;
  if e.id is null then raise exception 'Entrega não encontrada nesta empresa'; end if;
  if e.situacao not in ('planejada','em_rota') then raise exception 'Entrega já finalizada'; end if;
  if coalesce(trim(p_recebedor), '') = '' then raise exception 'Informe quem recebeu a entrega'; end if;

  select * into p from public.pedidos where id = e.pedido_id;

  for ei in select * from public.entrega_itens where entrega_id = e.id loop
    v_q := ei.quantidade;
    if p_itens is not null then
      select (x->>'quantidade')::numeric into v_q from jsonb_array_elements(p_itens) x
        where (x->>'entrega_item_id')::uuid = ei.id;
      v_q := coalesce(v_q, ei.quantidade);
    end if;
    if v_q < 0 then raise exception 'Quantidade inválida'; end if;
    if v_q > ei.quantidade then raise exception 'Quantidade entregue maior que a planejada'; end if;

    select * into v_item from public.pedido_itens where id = ei.pedido_item_id;

    if v_q > 0 then
      perform public.registrar_movimentacao(ei.produto_id, p.deposito_id, 'liberacao_reserva'::mov_tipo, v_q,
        'Baixa de reserva na entrega', 'ENT-' || e.numero, null);
      perform public.registrar_movimentacao(ei.produto_id, p.deposito_id, 'saida'::mov_tipo, v_q,
        'Entrega do pedido ' || p.numero, 'ENT-' || e.numero, null);
      update public.pedido_itens set quantidade_entregue = quantidade_entregue + v_q where id = v_item.id;
    end if;

    if v_q <> ei.quantidade then
      update public.entrega_itens set quantidade = v_q where id = ei.id;
      update public.pedido_itens
        set divergencia = coalesce(nullif(divergencia,''), 'Divergência na entrega ' || e.numero)
        where id = v_item.id;
    end if;
  end loop;

  update public.entregas set
    situacao = 'entregue',
    data_entrega = now(),
    recebedor = p_recebedor,
    recebedor_documento = p_documento,
    assinatura = p_assinatura,
    foto_url = p_foto_url,
    observacao = coalesce(p_observacao, observacao),
    latitude = p_latitude,
    longitude = p_longitude
  where id = e.id;

  select coalesce(sum(quantidade - quantidade_entregue),0) into v_pendentes
    from public.pedido_itens where pedido_id = p.id;

  if v_pendentes <= 0 then
    update public.pedidos set situacao = 'entregue', estoque_reservado = false where id = p.id;
    insert into public.pedido_historico (tenant_id, pedido_id, situacao_anterior, situacao_nova, observacao, usuario_id)
    values (v_tenant, p.id, p.situacao, 'entregue', 'Entrega ' || e.numero || ' concluída', auth.uid());
  elsif p.situacao <> 'em_rota' then
    update public.pedidos set situacao = 'em_rota' where id = p.id;
    insert into public.pedido_historico (tenant_id, pedido_id, situacao_anterior, situacao_nova, observacao, usuario_id)
    values (v_tenant, p.id, p.situacao, 'em_rota', 'Entrega parcial registrada', auth.uid());
  end if;
end $$;
grant execute on function public.entrega_concluir(uuid, text, text, text, text, text, jsonb, numeric, numeric) to authenticated;

-- ===== Insucesso de entrega =====
create or replace function public.entrega_insucesso(
  p_entrega_id uuid,
  p_motivo text,
  p_observacao text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  e public.entregas;
  p public.pedidos;
begin
  select * into e from public.entregas where id = p_entrega_id and tenant_id = v_tenant;
  if e.id is null then raise exception 'Entrega não encontrada nesta empresa'; end if;
  if e.situacao not in ('planejada','em_rota') then raise exception 'Entrega já finalizada'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo do insucesso'; end if;

  update public.entregas set situacao = 'insucesso', motivo_insucesso = p_motivo,
    observacao = coalesce(p_observacao, observacao), data_entrega = now() where id = e.id;

  select * into p from public.pedidos where id = e.pedido_id;
  if not exists (select 1 from public.entregas where pedido_id = p.id and situacao in ('planejada','em_rota'))
     and p.situacao = 'em_rota' then
    insert into public.pedido_historico (tenant_id, pedido_id, situacao_anterior, situacao_nova, observacao, usuario_id)
    values (v_tenant, p.id, p.situacao, p.situacao, 'Entrega ' || e.numero || ' sem sucesso: ' || p_motivo, auth.uid());
  end if;
end $$;
grant execute on function public.entrega_insucesso(uuid, text, text) to authenticated;

-- ===== Demonstração =====
insert into public.veiculos (id, tenant_id, empresa_id, filial_id, placa, descricao, tipo, capacidade_kg, capacidade_m3)
values
  ('55555555-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','ABC1D23','Caminhão Toco Mercedes 1016','caminhao',6000,20),
  ('55555555-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','EFG4H56','Caminhão Truck Volvo VM 270','caminhao',14000,35),
  ('55555555-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','IJK7L89','Utilitário Fiorino Entrega Rápida','utilitario',650,3)
on conflict (id) do nothing;

insert into public.motoristas (id, tenant_id, empresa_id, filial_id, nome, telefone, cnh, categoria_cnh, validade_cnh, veiculo_id)
values
  ('66666666-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','João Batista da Silva','(11) 98877-1122','01234567890','C','2029-04-30','55555555-0000-0000-0000-000000000001'),
  ('66666666-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','Marcos Antônio Pereira','(11) 97766-3344','09876543211','D','2028-11-15','55555555-0000-0000-0000-000000000002'),
  ('66666666-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','Rafael Souza Lima','(11) 96655-7788','05566778899','B','2030-02-20','55555555-0000-0000-0000-000000000003')
on conflict (id) do nothing;