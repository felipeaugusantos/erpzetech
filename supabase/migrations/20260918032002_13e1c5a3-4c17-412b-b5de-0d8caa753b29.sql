-- ============ FASE 3: COMPRAS + FINANCEIRO ============
create type public.compra_situacao as enum ('rascunho','cotacao','aprovado','pedido_enviado','parcialmente_recebido','recebido','cancelado');
create type public.conta_situacao as enum ('aberto','parcial','pago','cancelado');
create type public.forma_pagamento as enum ('dinheiro','pix','cartao_credito','cartao_debito','boleto','transferencia','crediario');
create type public.caixa_situacao as enum ('aberto','fechado');
create type public.caixa_mov_tipo as enum ('abertura','entrada','saida','sangria','suprimento','venda','recebimento','fechamento');
create type public.divergencia_tipo as enum ('quantidade','produto_errado','danificado');
create type public.autorizacao_situacao as enum ('pendente','aprovada','negada');

-- ===== COMPRAS =====
create table public.compras (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  empresa_id uuid references public.empresas(id),
  filial_id uuid references public.filiais(id),
  numero bigint,
  fornecedor_id uuid references public.fornecedores(id),
  deposito_id uuid not null references public.depositos(id),
  situacao public.compra_situacao not null default 'rascunho',
  origem text not null default 'manual',
  previsao_entrega date,
  condicao_pagamento text,
  subtotal numeric(14,2) not null default 0,
  desconto numeric(14,2) not null default 0,
  frete numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  observacoes text,
  motivo_cancelamento text,
  solicitante_id uuid references public.profiles(id),
  aprovado_por uuid references public.profiles(id),
  aprovado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, numero)
);

create table public.compra_itens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  compra_id uuid not null references public.compras(id) on delete cascade,
  produto_id uuid not null references public.produtos(id),
  quantidade numeric(14,3) not null check (quantidade > 0),
  quantidade_recebida numeric(14,3) not null default 0,
  unidade text,
  custo_unitario numeric(14,4) not null default 0,
  total numeric(14,2) not null default 0,
  observacao text,
  created_at timestamptz not null default now()
);

create table public.compra_cotacoes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  compra_id uuid not null references public.compras(id) on delete cascade,
  fornecedor_id uuid not null references public.fornecedores(id),
  valor_total numeric(14,2) not null default 0,
  prazo_entrega_dias integer,
  condicao_pagamento text,
  observacao text,
  escolhida boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.compra_recebimentos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  compra_id uuid not null references public.compras(id) on delete cascade,
  numero bigint,
  documento text,
  data_recebimento timestamptz not null default now(),
  observacao text,
  usuario_id uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, numero)
);

create table public.compra_recebimento_itens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  recebimento_id uuid not null references public.compra_recebimentos(id) on delete cascade,
  compra_item_id uuid not null references public.compra_itens(id),
  produto_id uuid not null references public.produtos(id),
  quantidade numeric(14,3) not null check (quantidade > 0),
  custo_unitario numeric(14,4) not null default 0,
  divergencia public.divergencia_tipo,
  divergencia_obs text,
  created_at timestamptz not null default now()
);

-- ===== FINANCEIRO =====
create table public.contas_receber (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  empresa_id uuid references public.empresas(id),
  filial_id uuid references public.filiais(id),
  numero bigint,
  cliente_id uuid references public.clientes(id),
  pedido_id uuid references public.pedidos(id),
  descricao text not null,
  parcela integer not null default 1,
  parcelas integer not null default 1,
  vencimento date not null,
  valor numeric(14,2) not null check (valor > 0),
  valor_recebido numeric(14,2) not null default 0,
  situacao public.conta_situacao not null default 'aberto',
  forma_pagamento public.forma_pagamento,
  observacoes text,
  motivo_cancelamento text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, numero)
);

create table public.contas_pagar (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  empresa_id uuid references public.empresas(id),
  filial_id uuid references public.filiais(id),
  numero bigint,
  fornecedor_id uuid references public.fornecedores(id),
  compra_id uuid references public.compras(id),
  descricao text not null,
  categoria text,
  parcela integer not null default 1,
  parcelas integer not null default 1,
  vencimento date not null,
  valor numeric(14,2) not null check (valor > 0),
  valor_pago numeric(14,2) not null default 0,
  situacao public.conta_situacao not null default 'aberto',
  forma_pagamento public.forma_pagamento,
  observacoes text,
  motivo_cancelamento text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, numero)
);

create table public.caixas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  filial_id uuid references public.filiais(id),
  numero bigint,
  situacao public.caixa_situacao not null default 'aberto',
  aberto_em timestamptz not null default now(),
  aberto_por uuid references public.profiles(id),
  valor_abertura numeric(14,2) not null default 0,
  fechado_em timestamptz,
  fechado_por uuid references public.profiles(id),
  valor_esperado numeric(14,2),
  valor_informado numeric(14,2),
  diferenca numeric(14,2),
  observacao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, numero)
);

create table public.caixa_movimentos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  caixa_id uuid not null references public.caixas(id) on delete cascade,
  tipo public.caixa_mov_tipo not null,
  valor numeric(14,2) not null check (valor > 0),
  forma_pagamento public.forma_pagamento,
  descricao text,
  usuario_id uuid,
  created_at timestamptz not null default now()
);

create table public.financeiro_baixas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  conta_receber_id uuid references public.contas_receber(id) on delete cascade,
  conta_pagar_id uuid references public.contas_pagar(id) on delete cascade,
  caixa_id uuid references public.caixas(id),
  valor numeric(14,2) not null check (valor > 0),
  forma_pagamento public.forma_pagamento not null,
  data_baixa date not null default current_date,
  observacao text,
  usuario_id uuid,
  created_at timestamptz not null default now(),
  check ((conta_receber_id is not null) <> (conta_pagar_id is not null))
);

create table public.credito_autorizacoes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  cliente_id uuid not null references public.clientes(id),
  pedido_id uuid references public.pedidos(id),
  orcamento_id uuid references public.orcamentos(id),
  valor numeric(14,2) not null,
  limite numeric(14,2) not null default 0,
  saldo_utilizado numeric(14,2) not null default 0,
  motivo text,
  situacao public.autorizacao_situacao not null default 'pendente',
  solicitante_id uuid references public.profiles(id),
  autorizado_por uuid references public.profiles(id),
  autorizado_em timestamptz,
  observacao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on public.compra_itens (compra_id);
create index on public.compra_cotacoes (compra_id);
create index on public.compra_recebimento_itens (recebimento_id);
create index on public.compras (tenant_id, situacao);
create index on public.contas_receber (tenant_id, situacao, vencimento);
create index on public.contas_pagar (tenant_id, situacao, vencimento);
create index on public.caixa_movimentos (caixa_id);
create index on public.credito_autorizacoes (tenant_id, situacao);

-- GRANTS
grant select, insert, update, delete on public.compras, public.compra_itens, public.compra_cotacoes,
  public.contas_receber, public.contas_pagar, public.caixas, public.credito_autorizacoes to authenticated;
grant select, insert on public.compra_recebimentos, public.compra_recebimento_itens,
  public.caixa_movimentos, public.financeiro_baixas to authenticated;
grant all on public.compras, public.compra_itens, public.compra_cotacoes, public.compra_recebimentos,
  public.compra_recebimento_itens, public.contas_receber, public.contas_pagar, public.caixas,
  public.caixa_movimentos, public.financeiro_baixas, public.credito_autorizacoes to service_role;

-- RLS
alter table public.compras enable row level security;
alter table public.compra_itens enable row level security;
alter table public.compra_cotacoes enable row level security;
alter table public.compra_recebimentos enable row level security;
alter table public.compra_recebimento_itens enable row level security;
alter table public.contas_receber enable row level security;
alter table public.contas_pagar enable row level security;
alter table public.caixas enable row level security;
alter table public.caixa_movimentos enable row level security;
alter table public.financeiro_baixas enable row level security;
alter table public.credito_autorizacoes enable row level security;

create policy "compras_tenant" on public.compras for all to authenticated
  using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id());
create policy "compra_itens_tenant" on public.compra_itens for all to authenticated
  using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id());
create policy "compra_cotacoes_tenant" on public.compra_cotacoes for all to authenticated
  using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id());
create policy "contas_receber_tenant" on public.contas_receber for all to authenticated
  using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id());
create policy "contas_pagar_tenant" on public.contas_pagar for all to authenticated
  using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id());
create policy "caixas_tenant" on public.caixas for all to authenticated
  using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id());
create policy "credito_autorizacoes_tenant" on public.credito_autorizacoes for all to authenticated
  using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id());

create policy "compra_recebimentos_read" on public.compra_recebimentos for select to authenticated
  using (tenant_id = public.current_tenant_id());
create policy "compra_recebimentos_insert" on public.compra_recebimentos for insert to authenticated
  with check (tenant_id = public.current_tenant_id());
create policy "compra_receb_itens_read" on public.compra_recebimento_itens for select to authenticated
  using (tenant_id = public.current_tenant_id());
create policy "compra_receb_itens_insert" on public.compra_recebimento_itens for insert to authenticated
  with check (tenant_id = public.current_tenant_id());
create policy "caixa_movimentos_read" on public.caixa_movimentos for select to authenticated
  using (tenant_id = public.current_tenant_id());
create policy "caixa_movimentos_insert" on public.caixa_movimentos for insert to authenticated
  with check (tenant_id = public.current_tenant_id());
create policy "financeiro_baixas_read" on public.financeiro_baixas for select to authenticated
  using (tenant_id = public.current_tenant_id());
create policy "financeiro_baixas_insert" on public.financeiro_baixas for insert to authenticated
  with check (tenant_id = public.current_tenant_id());

create trigger touch_compras before update on public.compras for each row execute function public.touch_updated_at();
create trigger touch_contas_receber before update on public.contas_receber for each row execute function public.touch_updated_at();
create trigger touch_contas_pagar before update on public.contas_pagar for each row execute function public.touch_updated_at();
create trigger touch_caixas before update on public.caixas for each row execute function public.touch_updated_at();
create trigger touch_credito_autorizacoes before update on public.credito_autorizacoes for each row execute function public.touch_updated_at();

-- movimentos e baixas são imutáveis
create trigger block_compra_recebimentos before update or delete on public.compra_recebimentos for each row execute function public.block_write();
create trigger block_compra_receb_itens before update or delete on public.compra_recebimento_itens for each row execute function public.block_write();
create trigger block_caixa_movimentos before update or delete on public.caixa_movimentos for each row execute function public.block_write();
create trigger block_financeiro_baixas before update or delete on public.financeiro_baixas for each row execute function public.block_write();

create trigger numero_compras before insert on public.compras for each row execute function public.set_numero_sequencial();
create trigger numero_compra_recebimentos before insert on public.compra_recebimentos for each row execute function public.set_numero_sequencial();
create trigger numero_contas_receber before insert on public.contas_receber for each row execute function public.set_numero_sequencial();
create trigger numero_contas_pagar before insert on public.contas_pagar for each row execute function public.set_numero_sequencial();
create trigger numero_caixas before insert on public.caixas for each row execute function public.set_numero_sequencial();

-- ===== recalcular total da compra =====
create or replace function public.recalcular_compra(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_sub numeric;
begin
  select coalesce(sum(total),0) into v_sub from public.compra_itens where compra_id = p_id;
  update public.compras set subtotal = v_sub, total = greatest(0, v_sub - desconto + frete) where id = p_id;
end; $$;

-- ===== avançar situação da compra =====
create or replace function public.compra_avancar_status(p_compra_id uuid, p_situacao public.compra_situacao, p_observacao text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  c public.compras;
  v_permitido public.compra_situacao[];
  v_itens int;
begin
  select * into c from public.compras where id = p_compra_id and tenant_id = v_tenant;
  if c.id is null then raise exception 'Compra não encontrada nesta empresa'; end if;
  if c.situacao = p_situacao then return; end if;
  if c.situacao in ('recebido','cancelado') then raise exception 'Compra já finalizada'; end if;

  v_permitido := case c.situacao
    when 'rascunho' then array['cotacao','aprovado','cancelado']::public.compra_situacao[]
    when 'cotacao' then array['aprovado','rascunho','cancelado']::public.compra_situacao[]
    when 'aprovado' then array['pedido_enviado','cancelado']::public.compra_situacao[]
    when 'pedido_enviado' then array['cancelado']::public.compra_situacao[]
    when 'parcialmente_recebido' then array['cancelado']::public.compra_situacao[]
    else array[]::public.compra_situacao[] end;

  if not (p_situacao = any(v_permitido)) then raise exception 'Mudança de situação não permitida'; end if;

  if p_situacao in ('aprovado','pedido_enviado') then
    select count(*) into v_itens from public.compra_itens where compra_id = c.id;
    if v_itens = 0 then raise exception 'Inclua itens antes de aprovar a compra'; end if;
    if c.fornecedor_id is null then raise exception 'Selecione o fornecedor antes de aprovar a compra'; end if;
  end if;

  if p_situacao = 'cancelado' then
    update public.compras set situacao = p_situacao, motivo_cancelamento = p_observacao where id = c.id;
  elsif p_situacao = 'aprovado' then
    update public.compras set situacao = p_situacao, aprovado_por = auth.uid(), aprovado_em = now() where id = c.id;
  else
    update public.compras set situacao = p_situacao where id = c.id;
  end if;
end; $$;

-- ===== escolher cotação =====
create or replace function public.compra_escolher_cotacao(p_cotacao_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  q public.compra_cotacoes;
begin
  select * into q from public.compra_cotacoes where id = p_cotacao_id and tenant_id = v_tenant;
  if q.id is null then raise exception 'Cotação não encontrada nesta empresa'; end if;
  update public.compra_cotacoes set escolhida = false where compra_id = q.compra_id;
  update public.compra_cotacoes set escolhida = true where id = q.id;
  update public.compras set fornecedor_id = q.fornecedor_id,
      condicao_pagamento = coalesce(q.condicao_pagamento, condicao_pagamento),
      previsao_entrega = case when q.prazo_entrega_dias is not null
        then (current_date + q.prazo_entrega_dias) else previsao_entrega end,
      situacao = case when situacao = 'rascunho' then 'cotacao'::public.compra_situacao else situacao end
    where id = q.compra_id;
end; $$;

-- ===== receber compra (parcial, com divergências) =====
create or replace function public.receber_compra(
  p_compra_id uuid,
  p_itens jsonb,
  p_documento text default null,
  p_observacao text default null,
  p_gerar_conta boolean default true,
  p_vencimento date default null,
  p_parcelas integer default 1
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  c public.compras;
  it jsonb;
  ci public.compra_itens;
  v_rec_id uuid;
  v_qtd numeric;
  v_custo numeric;
  v_valor numeric := 0;
  v_pend int;
  i int;
  v_parc numeric;
  v_n int;
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
      update public.produtos set custo = v_custo where id = ci.produto_id and v_custo > 0;
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
        i, v_n,
        coalesce(p_vencimento, current_date) + ((i - 1) * 30),
        case when i = v_n then v_valor - (v_parc * (v_n - 1)) else v_parc end,
        'boleto');
    end loop;
  end if;

  return v_rec_id;
end; $$;

-- ===== sugestão de compra por estoque mínimo =====
create or replace function public.gerar_compra_estoque_minimo(p_deposito_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_id uuid;
  r record;
  v_count int := 0;
  v_qtd numeric;
begin
  if v_tenant is null then raise exception 'Usuário sem empresa vinculada'; end if;

  insert into public.compras (tenant_id, empresa_id, filial_id, deposito_id, origem, observacoes, solicitante_id)
  select v_tenant, p.empresa_id, p.filial_id, p_deposito_id, 'estoque_minimo',
    'Solicitação gerada automaticamente pelo estoque mínimo', auth.uid()
  from public.profiles p where p.id = auth.uid()
  returning id into v_id;

  for r in
    select pr.id as produto_id, pr.unidade, pr.custo, pr.estoque_minimo, pr.estoque_maximo,
      coalesce(e.quantidade,0) - coalesce(e.reservado,0) as disponivel
    from public.produtos pr
    left join public.estoques e on e.produto_id = pr.id and e.deposito_id = p_deposito_id
    where pr.tenant_id = v_tenant and pr.ativo and pr.deleted_at is null
      and pr.estoque_minimo > 0
      and coalesce(e.quantidade,0) - coalesce(e.reservado,0) < pr.estoque_minimo
  loop
    v_qtd := greatest(case when r.estoque_maximo > r.estoque_minimo then r.estoque_maximo else r.estoque_minimo end - r.disponivel, 1);
    insert into public.compra_itens (tenant_id, compra_id, produto_id, quantidade, unidade, custo_unitario, total)
    values (v_tenant, v_id, r.produto_id, v_qtd, r.unidade, r.custo, round(v_qtd * r.custo, 2));
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    delete from public.compras where id = v_id;
    raise exception 'Nenhum produto abaixo do estoque mínimo neste depósito';
  end if;

  perform public.recalcular_compra(v_id);
  return v_id;
end; $$;

-- ===== gerar contas a receber do pedido =====
create or replace function public.gerar_contas_receber(
  p_pedido_id uuid,
  p_parcelas integer default 1,
  p_primeiro_vencimento date default null,
  p_forma public.forma_pagamento default 'boleto'
) returns integer language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  p public.pedidos;
  v_existe int;
  v_parc numeric;
  v_n int := greatest(1, coalesce(p_parcelas,1));
  i int;
begin
  select * into p from public.pedidos where id = p_pedido_id and tenant_id = v_tenant;
  if p.id is null then raise exception 'Pedido não encontrado nesta empresa'; end if;
  if p.situacao = 'cancelado' then raise exception 'Pedido cancelado'; end if;

  select count(*) into v_existe from public.contas_receber
    where pedido_id = p.id and situacao <> 'cancelado';
  if v_existe > 0 then raise exception 'Este pedido já possui contas a receber'; end if;

  v_parc := round(p.total / v_n, 2);
  for i in 1..v_n loop
    insert into public.contas_receber (tenant_id, empresa_id, filial_id, cliente_id, pedido_id, descricao,
      parcela, parcelas, vencimento, valor, forma_pagamento)
    values (v_tenant, p.empresa_id, p.filial_id, p.cliente_id, p.id,
      'Pedido nº ' || p.numero, i, v_n,
      coalesce(p_primeiro_vencimento, current_date) + ((i - 1) * 30),
      case when i = v_n then p.total - (v_parc * (v_n - 1)) else v_parc end,
      p_forma);
  end loop;

  if p_forma = 'crediario' then
    update public.clientes set saldo_utilizado = saldo_utilizado + p.total where id = p.cliente_id;
  end if;

  return v_n;
end; $$;

-- ===== baixar conta (receber/pagar) =====
create or replace function public.baixar_conta(
  p_tipo text,
  p_conta_id uuid,
  p_valor numeric,
  p_forma public.forma_pagamento,
  p_data date default null,
  p_observacao text default null,
  p_caixa_id uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_id uuid;
  v_total numeric; v_pago numeric; v_rest numeric;
  v_cliente uuid; v_forma_orig public.forma_pagamento;
begin
  if p_valor is null or p_valor <= 0 then raise exception 'Informe um valor maior que zero'; end if;
  if p_tipo not in ('receber','pagar') then raise exception 'Tipo inválido'; end if;

  if p_tipo = 'receber' then
    select valor, valor_recebido, cliente_id, forma_pagamento into v_total, v_pago, v_cliente, v_forma_orig
      from public.contas_receber where id = p_conta_id and tenant_id = v_tenant and situacao <> 'cancelado' for update;
  else
    select valor, valor_pago into v_total, v_pago
      from public.contas_pagar where id = p_conta_id and tenant_id = v_tenant and situacao <> 'cancelado' for update;
  end if;
  if v_total is null then raise exception 'Conta não encontrada ou cancelada'; end if;

  v_rest := v_total - v_pago;
  if p_valor > v_rest + 0.001 then raise exception 'Valor maior que o saldo em aberto da conta'; end if;

  insert into public.financeiro_baixas (tenant_id, conta_receber_id, conta_pagar_id, caixa_id, valor,
    forma_pagamento, data_baixa, observacao, usuario_id)
  values (v_tenant,
    case when p_tipo = 'receber' then p_conta_id else null end,
    case when p_tipo = 'pagar' then p_conta_id else null end,
    p_caixa_id, p_valor, p_forma, coalesce(p_data, current_date), p_observacao, auth.uid())
  returning id into v_id;

  if p_tipo = 'receber' then
    update public.contas_receber set valor_recebido = valor_recebido + p_valor,
      situacao = case when valor_recebido + p_valor >= valor - 0.001 then 'pago'::public.conta_situacao
                      else 'parcial'::public.conta_situacao end
      where id = p_conta_id;
    if v_forma_orig = 'crediario' and v_cliente is not null then
      update public.clientes set saldo_utilizado = greatest(0, saldo_utilizado - p_valor) where id = v_cliente;
    end if;
  else
    update public.contas_pagar set valor_pago = valor_pago + p_valor,
      situacao = case when valor_pago + p_valor >= valor - 0.001 then 'pago'::public.conta_situacao
                      else 'parcial'::public.conta_situacao end
      where id = p_conta_id;
  end if;

  if p_caixa_id is not null then
    insert into public.caixa_movimentos (tenant_id, caixa_id, tipo, valor, forma_pagamento, descricao, usuario_id)
    values (v_tenant, p_caixa_id,
      case when p_tipo = 'receber' then 'recebimento'::public.caixa_mov_tipo else 'saida'::public.caixa_mov_tipo end,
      p_valor, p_forma,
      case when p_tipo = 'receber' then 'Recebimento de conta' else 'Pagamento de conta' end, auth.uid());
  end if;

  return v_id;
end; $$;

-- ===== caixa =====
create or replace function public.abrir_caixa(p_filial_id uuid, p_valor_abertura numeric default 0)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_id uuid;
begin
  if v_tenant is null then raise exception 'Usuário sem empresa vinculada'; end if;
  if exists (select 1 from public.caixas where tenant_id = v_tenant and filial_id = p_filial_id and situacao = 'aberto') then
    raise exception 'Já existe um caixa aberto nesta filial';
  end if;
  insert into public.caixas (tenant_id, filial_id, aberto_por, valor_abertura)
  values (v_tenant, p_filial_id, auth.uid(), coalesce(p_valor_abertura,0))
  returning id into v_id;

  if coalesce(p_valor_abertura,0) > 0 then
    insert into public.caixa_movimentos (tenant_id, caixa_id, tipo, valor, forma_pagamento, descricao, usuario_id)
    values (v_tenant, v_id, 'abertura', p_valor_abertura, 'dinheiro', 'Valor de abertura', auth.uid());
  end if;
  return v_id;
end; $$;

create or replace function public.caixa_movimento(
  p_caixa_id uuid, p_tipo public.caixa_mov_tipo, p_valor numeric,
  p_descricao text default null, p_forma public.forma_pagamento default 'dinheiro'
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_sit public.caixa_situacao;
  v_id uuid;
begin
  select situacao into v_sit from public.caixas where id = p_caixa_id and tenant_id = v_tenant;
  if v_sit is null then raise exception 'Caixa não encontrado nesta empresa'; end if;
  if v_sit = 'fechado' then raise exception 'Caixa já fechado'; end if;
  if p_valor is null or p_valor <= 0 then raise exception 'Informe um valor maior que zero'; end if;
  insert into public.caixa_movimentos (tenant_id, caixa_id, tipo, valor, forma_pagamento, descricao, usuario_id)
  values (v_tenant, p_caixa_id, p_tipo, p_valor, p_forma, p_descricao, auth.uid())
  returning id into v_id;
  return v_id;
end; $$;

create or replace function public.fechar_caixa(p_caixa_id uuid, p_valor_informado numeric, p_observacao text default null)
returns numeric language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  c public.caixas;
  v_esperado numeric;
  v_dif numeric;
begin
  select * into c from public.caixas where id = p_caixa_id and tenant_id = v_tenant;
  if c.id is null then raise exception 'Caixa não encontrado nesta empresa'; end if;
  if c.situacao = 'fechado' then raise exception 'Caixa já fechado'; end if;

  select coalesce(sum(case
      when tipo in ('entrada','suprimento','venda','recebimento','abertura') then valor
      when tipo in ('saida','sangria') then -valor else 0 end), 0)
    into v_esperado
    from public.caixa_movimentos
    where caixa_id = c.id and coalesce(forma_pagamento,'dinheiro') = 'dinheiro';

  if not exists (select 1 from public.caixa_movimentos where caixa_id = c.id and tipo = 'abertura') then
    v_esperado := v_esperado + c.valor_abertura;
  end if;

  v_dif := coalesce(p_valor_informado,0) - v_esperado;

  update public.caixas set situacao = 'fechado', fechado_em = now(), fechado_por = auth.uid(),
    valor_esperado = v_esperado, valor_informado = coalesce(p_valor_informado,0), diferenca = v_dif,
    observacao = coalesce(p_observacao, observacao)
  where id = c.id;

  return v_dif;
end; $$;

-- ===== autorização de crédito =====
create or replace function public.solicitar_autorizacao_credito(
  p_cliente_id uuid, p_valor numeric, p_pedido_id uuid default null,
  p_orcamento_id uuid default null, p_motivo text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  cl public.clientes;
  v_id uuid;
begin
  select * into cl from public.clientes where id = p_cliente_id and tenant_id = v_tenant;
  if cl.id is null then raise exception 'Cliente não encontrado nesta empresa'; end if;

  insert into public.credito_autorizacoes (tenant_id, cliente_id, pedido_id, orcamento_id, valor,
    limite, saldo_utilizado, motivo, solicitante_id)
  values (v_tenant, cl.id, p_pedido_id, p_orcamento_id, p_valor, cl.limite_credito, cl.saldo_utilizado,
    p_motivo, auth.uid())
  returning id into v_id;
  return v_id;
end; $$;

create or replace function public.decidir_autorizacao_credito(p_id uuid, p_aprovar boolean, p_observacao text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  a public.credito_autorizacoes;
begin
  if not (public.has_role(auth.uid(), 'administrador') or public.has_role(auth.uid(), 'gestor')
       or public.has_role(auth.uid(), 'financeiro')) then
    raise exception 'Apenas gestor, financeiro ou administrador pode autorizar crédito';
  end if;
  select * into a from public.credito_autorizacoes where id = p_id and tenant_id = v_tenant;
  if a.id is null then raise exception 'Autorização não encontrada nesta empresa'; end if;
  if a.situacao <> 'pendente' then raise exception 'Autorização já decidida'; end if;

  update public.credito_autorizacoes
    set situacao = case when p_aprovar then 'aprovada'::public.autorizacao_situacao else 'negada'::public.autorizacao_situacao end,
        autorizado_por = auth.uid(), autorizado_em = now(), observacao = p_observacao
  where id = a.id;
end; $$;

-- revogações e grants de execução
revoke all on function public.recalcular_compra(uuid) from anon, public;
revoke all on function public.compra_avancar_status(uuid, public.compra_situacao, text) from anon, public;
revoke all on function public.compra_escolher_cotacao(uuid) from anon, public;
revoke all on function public.receber_compra(uuid, jsonb, text, text, boolean, date, integer) from anon, public;
revoke all on function public.gerar_compra_estoque_minimo(uuid) from anon, public;
revoke all on function public.gerar_contas_receber(uuid, integer, date, public.forma_pagamento) from anon, public;
revoke all on function public.baixar_conta(text, uuid, numeric, public.forma_pagamento, date, text, uuid) from anon, public;
revoke all on function public.abrir_caixa(uuid, numeric) from anon, public;
revoke all on function public.caixa_movimento(uuid, public.caixa_mov_tipo, numeric, text, public.forma_pagamento) from anon, public;
revoke all on function public.fechar_caixa(uuid, numeric, text) from anon, public;
revoke all on function public.solicitar_autorizacao_credito(uuid, numeric, uuid, uuid, text) from anon, public;
revoke all on function public.decidir_autorizacao_credito(uuid, boolean, text) from anon, public;

grant execute on function public.recalcular_compra(uuid) to authenticated;
grant execute on function public.compra_avancar_status(uuid, public.compra_situacao, text) to authenticated;
grant execute on function public.compra_escolher_cotacao(uuid) to authenticated;
grant execute on function public.receber_compra(uuid, jsonb, text, text, boolean, date, integer) to authenticated;
grant execute on function public.gerar_compra_estoque_minimo(uuid) to authenticated;
grant execute on function public.gerar_contas_receber(uuid, integer, date, public.forma_pagamento) to authenticated;
grant execute on function public.baixar_conta(text, uuid, numeric, public.forma_pagamento, date, text, uuid) to authenticated;
grant execute on function public.abrir_caixa(uuid, numeric) to authenticated;
grant execute on function public.caixa_movimento(uuid, public.caixa_mov_tipo, numeric, text, public.forma_pagamento) to authenticated;
grant execute on function public.fechar_caixa(uuid, numeric, text) to authenticated;
grant execute on function public.solicitar_autorizacao_credito(uuid, numeric, uuid, uuid, text) to authenticated;
grant execute on function public.decidir_autorizacao_credito(uuid, boolean, text) to authenticated;