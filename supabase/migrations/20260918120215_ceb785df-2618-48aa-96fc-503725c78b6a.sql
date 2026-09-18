-- 1) Custo médio por depósito
alter table public.estoques add column if not exists custo_medio numeric not null default 0;
update public.estoques e set custo_medio = p.custo from public.produtos p
 where p.id = e.produto_id and e.custo_medio = 0;

-- Custo do item do pedido (congelado no momento da venda, pelo depósito escolhido)
alter table public.pedido_itens add column if not exists custo_unitario numeric not null default 0;

-- 2) Média ponderada por depósito
create or replace function public.atualizar_custo_medio(
  p_produto_id uuid, p_deposito_id uuid, p_qtd_entrada numeric, p_custo numeric
) returns numeric
language plpgsql security definer set search_path to 'public' as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_qtd numeric; v_custo_ant numeric; v_qtd_ant numeric; v_novo numeric;
begin
  if p_qtd_entrada is null or p_qtd_entrada <= 0 or p_custo is null or p_custo < 0 then
    return null;
  end if;

  select quantidade, custo_medio into v_qtd, v_custo_ant from public.estoques
   where produto_id = p_produto_id and deposito_id = p_deposito_id and tenant_id = v_tenant
   for update;
  if v_qtd is null then return null; end if;

  -- saldo antes da entrada
  v_qtd_ant := greatest(0, v_qtd - p_qtd_entrada);
  if v_qtd_ant <= 0 or coalesce(v_custo_ant,0) <= 0 then
    v_novo := p_custo;
  else
    v_novo := ((v_qtd_ant * v_custo_ant) + (p_qtd_entrada * p_custo)) / (v_qtd_ant + p_qtd_entrada);
  end if;
  v_novo := round(v_novo, 4);

  update public.estoques set custo_medio = v_novo, updated_at = now()
   where produto_id = p_produto_id and deposito_id = p_deposito_id and tenant_id = v_tenant;

  -- custo de referência do produto = média ponderada de todos os depósitos
  update public.produtos p set custo = coalesce((
      select round(sum(e.quantidade * e.custo_medio) / nullif(sum(e.quantidade),0), 4)
        from public.estoques e
       where e.produto_id = p.id and e.quantidade > 0 and e.custo_medio > 0
    ), v_novo)
   where p.id = p_produto_id and p.tenant_id = v_tenant;

  return v_novo;
end; $$;

-- 3) Recebimento de compra passa a atualizar o custo do depósito que recebeu
create or replace function public.receber_compra(p_compra_id uuid, p_itens jsonb, p_documento text default null,
  p_observacao text default null, p_gerar_conta boolean default true, p_vencimento date default null, p_parcelas integer default 1)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_tenant uuid := public.current_tenant_id();
  c public.compras; it jsonb; ci public.compra_itens;
  v_rec_id uuid; v_qtd numeric; v_custo numeric; v_valor numeric := 0;
  v_pend int; i int; v_parc numeric; v_n int;
begin
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
      perform public.registrar_movimentacao(ci.produto_id, c.deposito_id, 'entrada'::public.mov_tipo, v_qtd,
        'Recebimento de compra', 'COM-' || c.numero, null);
      if v_custo > 0 then
        perform public.atualizar_custo_medio(ci.produto_id, c.deposito_id, v_qtd, v_custo);
      end if;
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
    v_parc := round(v_valor / v_n, 2);
    for i in 1..v_n loop
      insert into public.contas_pagar (tenant_id, empresa_id, filial_id, fornecedor_id, compra_id, descricao,
        categoria, parcela, parcelas, vencimento, valor, forma_pagamento)
      values (v_tenant, c.empresa_id, c.filial_id, c.fornecedor_id, c.id,
        'Compra nº ' || c.numero || coalesce(' - NF ' || p_documento, ''), 'Mercadorias',
        i, v_n, coalesce(p_vencimento, current_date) + ((i - 1) * 30),
        case when i = v_n then v_valor - (v_parc * (v_n - 1)) else v_parc end, 'boleto');
    end loop;
  end if;

  return v_rec_id;
end; $$;

-- 4) Item do pedido guarda o custo do depósito escolhido
create or replace function public.pedido_item_custo() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_dep uuid; v_custo numeric;
begin
  if coalesce(new.custo_unitario,0) > 0 then return new; end if;
  select deposito_id into v_dep from public.pedidos where id = new.pedido_id;
  select custo_medio into v_custo from public.estoques
   where produto_id = new.produto_id and deposito_id = v_dep;
  if coalesce(v_custo,0) <= 0 then
    select custo into v_custo from public.produtos where id = new.produto_id;
  end if;
  new.custo_unitario := coalesce(v_custo, 0);
  return new;
end; $$;

drop trigger if exists trg_pedido_item_custo on public.pedido_itens;
create trigger trg_pedido_item_custo before insert on public.pedido_itens
for each row execute function public.pedido_item_custo();

-- backfill dos itens já existentes
update public.pedido_itens pi set custo_unitario = coalesce((
    select e.custo_medio from public.estoques e
     join public.pedidos pe on pe.id = pi.pedido_id
    where e.produto_id = pi.produto_id and e.deposito_id = pe.deposito_id and e.custo_medio > 0
  ), (select p.custo from public.produtos p where p.id = pi.produto_id), 0)
 where pi.custo_unitario = 0;

-- 5) Modelo de negócio (valores informados pelo usuário, usados no relatório)
create table if not exists public.modelo_negocio (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id(),
  preco_mensal_loja numeric not null default 0,
  preco_filial_extra numeric not null default 0,
  preco_implantacao numeric not null default 0,
  meta_clientes_ano1 integer not null default 0,
  meta_clientes_ano2 integer not null default 0,
  custo_infra_mensal numeric not null default 0,
  custo_equipe_mensal numeric not null default 0,
  custo_marketing_mensal numeric not null default 0,
  investimento_realizado numeric not null default 0,
  observacoes text,
  updated_at timestamptz not null default now(),
  unique (tenant_id)
);

grant select, insert, update on public.modelo_negocio to authenticated;
grant all on public.modelo_negocio to service_role;

alter table public.modelo_negocio enable row level security;

create policy "modelo_negocio_select" on public.modelo_negocio for select to authenticated
  using (tenant_id = public.current_tenant_id());
create policy "modelo_negocio_insert" on public.modelo_negocio for insert to authenticated
  with check (tenant_id = public.current_tenant_id() and (public.has_role(auth.uid(),'administrador') or public.has_role(auth.uid(),'gestor')));
create policy "modelo_negocio_update" on public.modelo_negocio for update to authenticated
  using (tenant_id = public.current_tenant_id() and (public.has_role(auth.uid(),'administrador') or public.has_role(auth.uid(),'gestor')));

create trigger trg_modelo_negocio_touch before update on public.modelo_negocio
for each row execute function public.touch_updated_at();