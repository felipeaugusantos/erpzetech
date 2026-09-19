-- ============ Assistência técnica ============
create type public.os_situacao as enum ('aberta','em_analise','orcamento','aprovada','em_reparo','pronta','entregue','cancelada');

create table public.os_ordens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  empresa_id uuid,
  filial_id uuid,
  numero integer not null default 0,
  cliente_id uuid references public.clientes(id),
  equipamento text not null,
  marca text,
  modelo text,
  numero_serie text,
  acessorios text,
  defeito_relatado text,
  diagnostico text,
  laudo text,
  tecnico_id uuid,
  tecnico_nome text,
  prioridade text not null default 'normal',
  situacao public.os_situacao not null default 'aberta',
  abertura timestamptz not null default now(),
  previsao date,
  entregue_em timestamptz,
  garantia_dias integer not null default 90,
  valor_pecas numeric(14,2) not null default 0,
  valor_servicos numeric(14,2) not null default 0,
  desconto numeric(14,2) not null default 0,
  valor_total numeric(14,2) not null default 0,
  observacoes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index os_ordens_tenant_idx on public.os_ordens (tenant_id, situacao);

create table public.os_itens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  os_id uuid not null references public.os_ordens(id) on delete cascade,
  tipo text not null default 'peca',
  produto_id uuid references public.produtos(id),
  descricao text not null,
  quantidade numeric(14,3) not null default 1,
  preco_unitario numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  created_at timestamptz not null default now()
);
create index os_itens_os_idx on public.os_itens (os_id);

grant select, insert, update, delete on public.os_ordens to authenticated;
grant all on public.os_ordens to service_role;
grant select, insert, update, delete on public.os_itens to authenticated;
grant all on public.os_itens to service_role;

alter table public.os_ordens enable row level security;
alter table public.os_itens enable row level security;

create policy os_ordens_select on public.os_ordens for select to authenticated
  using (tenant_id = current_tenant_id());
create policy os_ordens_insert on public.os_ordens for insert to authenticated
  with check (tenant_id = current_tenant_id() and (
    has_role(auth.uid(),'administrador') or has_role(auth.uid(),'gestor')
    or has_role(auth.uid(),'vendedor') or has_role(auth.uid(),'estoquista')));
create policy os_ordens_update on public.os_ordens for update to authenticated
  using (tenant_id = current_tenant_id() and (
    has_role(auth.uid(),'administrador') or has_role(auth.uid(),'gestor')
    or has_role(auth.uid(),'vendedor') or has_role(auth.uid(),'estoquista')))
  with check (tenant_id = current_tenant_id());

create policy os_itens_select on public.os_itens for select to authenticated
  using (tenant_id = current_tenant_id());
create policy os_itens_insert on public.os_itens for insert to authenticated
  with check (tenant_id = current_tenant_id() and (
    has_role(auth.uid(),'administrador') or has_role(auth.uid(),'gestor')
    or has_role(auth.uid(),'vendedor') or has_role(auth.uid(),'estoquista')));
create policy os_itens_update on public.os_itens for update to authenticated
  using (tenant_id = current_tenant_id() and (
    has_role(auth.uid(),'administrador') or has_role(auth.uid(),'gestor')
    or has_role(auth.uid(),'vendedor') or has_role(auth.uid(),'estoquista')))
  with check (tenant_id = current_tenant_id());
create policy os_itens_delete on public.os_itens for delete to authenticated
  using (tenant_id = current_tenant_id() and (
    has_role(auth.uid(),'administrador') or has_role(auth.uid(),'gestor')
    or has_role(auth.uid(),'vendedor') or has_role(auth.uid(),'estoquista')));

-- numeração sequencial por empresa
create or replace function public.os_numero()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.numero is null or new.numero = 0 then
    select coalesce(max(numero),0) + 1 into new.numero
      from public.os_ordens where tenant_id = new.tenant_id;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.os_numero() from public, anon, authenticated;
create trigger os_ordens_numero before insert or update on public.os_ordens
  for each row execute function public.os_numero();

create or replace function public.os_recalcular()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_os uuid; v_pecas numeric; v_serv numeric;
begin
  v_os := coalesce(new.os_id, old.os_id);
  select coalesce(sum(case when tipo = 'peca' then total else 0 end),0),
         coalesce(sum(case when tipo <> 'peca' then total else 0 end),0)
    into v_pecas, v_serv
    from public.os_itens where os_id = v_os;
  update public.os_ordens
     set valor_pecas = v_pecas,
         valor_servicos = v_serv,
         valor_total = greatest(v_pecas + v_serv - coalesce(desconto,0), 0),
         updated_at = now()
   where id = v_os;
  return null;
end;
$$;
revoke all on function public.os_recalcular() from public, anon, authenticated;
create trigger os_itens_recalcular after insert or update or delete on public.os_itens
  for each row execute function public.os_recalcular();

-- ============ Locação de equipamentos ============
create type public.locacao_situacao as enum ('reservada','em_andamento','devolvida','cancelada');

create table public.locacao_equipamentos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  filial_id uuid,
  codigo text,
  nome text not null,
  categoria text,
  marca text,
  modelo text,
  numero_serie text,
  valor_diaria numeric(14,2) not null default 0,
  valor_semanal numeric(14,2) not null default 0,
  valor_mensal numeric(14,2) not null default 0,
  valor_caucao numeric(14,2) not null default 0,
  situacao text not null default 'disponivel',
  observacoes text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index locacao_equip_tenant_idx on public.locacao_equipamentos (tenant_id, situacao);

create table public.locacoes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  empresa_id uuid,
  filial_id uuid,
  numero integer not null default 0,
  cliente_id uuid references public.clientes(id),
  obra_id uuid references public.obras(id),
  equipamento_id uuid not null references public.locacao_equipamentos(id),
  inicio date not null default current_date,
  previsao_devolucao date,
  devolvido_em date,
  valor_diaria numeric(14,2) not null default 0,
  dias integer not null default 1,
  valor_total numeric(14,2) not null default 0,
  caucao numeric(14,2) not null default 0,
  situacao public.locacao_situacao not null default 'reservada',
  observacoes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index locacoes_tenant_idx on public.locacoes (tenant_id, situacao);

grant select, insert, update, delete on public.locacao_equipamentos to authenticated;
grant all on public.locacao_equipamentos to service_role;
grant select, insert, update, delete on public.locacoes to authenticated;
grant all on public.locacoes to service_role;

alter table public.locacao_equipamentos enable row level security;
alter table public.locacoes enable row level security;

create policy locacao_equip_select on public.locacao_equipamentos for select to authenticated
  using (tenant_id = current_tenant_id());
create policy locacao_equip_insert on public.locacao_equipamentos for insert to authenticated
  with check (tenant_id = current_tenant_id() and (
    has_role(auth.uid(),'administrador') or has_role(auth.uid(),'gestor') or has_role(auth.uid(),'vendedor')));
create policy locacao_equip_update on public.locacao_equipamentos for update to authenticated
  using (tenant_id = current_tenant_id() and (
    has_role(auth.uid(),'administrador') or has_role(auth.uid(),'gestor') or has_role(auth.uid(),'vendedor')))
  with check (tenant_id = current_tenant_id());

create policy locacoes_select on public.locacoes for select to authenticated
  using (tenant_id = current_tenant_id());
create policy locacoes_insert on public.locacoes for insert to authenticated
  with check (tenant_id = current_tenant_id() and (
    has_role(auth.uid(),'administrador') or has_role(auth.uid(),'gestor') or has_role(auth.uid(),'vendedor')));
create policy locacoes_update on public.locacoes for update to authenticated
  using (tenant_id = current_tenant_id() and (
    has_role(auth.uid(),'administrador') or has_role(auth.uid(),'gestor') or has_role(auth.uid(),'vendedor')))
  with check (tenant_id = current_tenant_id());

create or replace function public.locacao_sincronizar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.numero is null or new.numero = 0 then
    select coalesce(max(numero),0) + 1 into new.numero
      from public.locacoes where tenant_id = new.tenant_id;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.locacao_sincronizar() from public, anon, authenticated;
create trigger locacoes_numero before insert or update on public.locacoes
  for each row execute function public.locacao_sincronizar();

create or replace function public.locacao_situacao_equipamento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.situacao = 'em_andamento' then
    update public.locacao_equipamentos set situacao = 'locado', updated_at = now()
     where id = new.equipamento_id and situacao <> 'manutencao';
  elsif new.situacao in ('devolvida','cancelada') then
    if not exists (
      select 1 from public.locacoes
       where equipamento_id = new.equipamento_id and id <> new.id and situacao = 'em_andamento'
    ) then
      update public.locacao_equipamentos set situacao = 'disponivel', updated_at = now()
       where id = new.equipamento_id and situacao = 'locado';
    end if;
  end if;
  return null;
end;
$$;
revoke all on function public.locacao_situacao_equipamento() from public, anon, authenticated;
create trigger locacoes_sit_equip after insert or update of situacao on public.locacoes
  for each row execute function public.locacao_situacao_equipamento();

-- ============ Painel Ze Tech: notas emitidas por cliente ============
create or replace function public.saas_notas_por_cliente(p_de date, p_ate date)
returns table (
  cliente_id uuid,
  cliente text,
  plano text,
  tenant_id uuid,
  notas bigint,
  autorizadas bigint,
  rascunhos bigint,
  canceladas bigint,
  valor_total numeric,
  impostos numeric,
  ultima_emissao timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not eh_saas_operador() then
    raise exception 'Acesso restrito à equipe Ze Tech';
  end if;
  return query
    select c.id,
           c.nome,
           p.nome,
           c.tenant_id,
           count(n.id),
           count(n.id) filter (where n.situacao in ('autorizada','emitida')),
           count(n.id) filter (where n.situacao in ('rascunho','pronta')),
           count(n.id) filter (where n.situacao = 'cancelada'),
           coalesce(sum(n.valor_total),0),
           coalesce(sum(coalesce(n.valor_icms,0) + coalesce(n.valor_icms_st,0)
                      + coalesce(n.valor_pis,0) + coalesce(n.valor_cofins,0)
                      + coalesce(n.valor_iss,0)),0),
           max(coalesce(n.autorizada_em, n.emitida_em, n.created_at))
      from public.saas_clientes c
      left join public.saas_planos p on p.id = c.plano_id
      left join public.nfe n
        on n.tenant_id = c.tenant_id
       and coalesce(n.autorizada_em, n.emitida_em, n.created_at)::date between p_de and p_ate
     group by c.id, c.nome, p.nome, c.tenant_id
     order by count(n.id) desc, c.nome;
end;
$$;
revoke all on function public.saas_notas_por_cliente(date, date) from public, anon;
grant execute on function public.saas_notas_por_cliente(date, date) to authenticated;

-- ============ Painel fiscal por loja ============
create or replace function public.painel_fiscal_loja(p_de date, p_ate date)
returns table (
  filial_id uuid,
  filial text,
  entradas numeric,
  saidas numeric,
  saldo_estoque numeric,
  notas bigint,
  valor_notas numeric,
  icms numeric,
  icms_st numeric,
  pis numeric,
  cofins numeric,
  iss numeric,
  impostos numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with f as (
    select id, nome from public.filiais where tenant_id = current_tenant_id()
  ),
  mov as (
    select d.filial_id,
           coalesce(sum(case when m.tipo in ('entrada','transferencia_entrada') then coalesce(m.valor_total, m.quantidade * coalesce(m.custo_unitario,0)) else 0 end),0) entradas,
           coalesce(sum(case when m.tipo in ('saida','transferencia_saida') then coalesce(m.valor_total, m.quantidade * coalesce(m.custo_unitario,0)) else 0 end),0) saidas
      from public.estoque_movimentacoes m
      join public.depositos d on d.id = m.deposito_id
     where m.tenant_id = current_tenant_id()
       and m.created_at::date between p_de and p_ate
     group by d.filial_id
  ),
  saldo as (
    select d.filial_id, coalesce(sum(e.quantidade * coalesce(e.custo_medio,0)),0) saldo
      from public.estoques e
      join public.depositos d on d.id = e.deposito_id
     where e.tenant_id = current_tenant_id()
     group by d.filial_id
  ),
  notas as (
    select n.filial_id,
           count(*) qtd,
           coalesce(sum(n.valor_total),0) valor,
           coalesce(sum(n.valor_icms),0) icms,
           coalesce(sum(n.valor_icms_st),0) icms_st,
           coalesce(sum(n.valor_pis),0) pis,
           coalesce(sum(n.valor_cofins),0) cofins,
           coalesce(sum(n.valor_iss),0) iss
      from public.nfe n
     where n.tenant_id = current_tenant_id()
       and n.situacao <> 'cancelada'
       and coalesce(n.autorizada_em, n.emitida_em, n.created_at)::date between p_de and p_ate
     group by n.filial_id
  )
  select f.id, f.nome,
         coalesce(mov.entradas,0), coalesce(mov.saidas,0), coalesce(saldo.saldo,0),
         coalesce(notas.qtd,0), coalesce(notas.valor,0),
         coalesce(notas.icms,0), coalesce(notas.icms_st,0), coalesce(notas.pis,0),
         coalesce(notas.cofins,0), coalesce(notas.iss,0),
         coalesce(notas.icms,0) + coalesce(notas.icms_st,0) + coalesce(notas.pis,0)
           + coalesce(notas.cofins,0) + coalesce(notas.iss,0)
    from f
    left join mov on mov.filial_id = f.id
    left join saldo on saldo.filial_id = f.id
    left join notas on notas.filial_id = f.id
   order by f.nome;
$$;
revoke all on function public.painel_fiscal_loja(date, date) from public, anon;
grant execute on function public.painel_fiscal_loja(date, date) to authenticated;