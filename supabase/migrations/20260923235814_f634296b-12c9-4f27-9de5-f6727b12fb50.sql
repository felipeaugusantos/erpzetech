alter table public.empresas add column if not exists pdv_desconto_limite numeric not null default 5;
alter table public.pedidos add column if not exists caixa_id uuid references public.caixas(id);
alter table public.pedidos add column if not exists cancelado_por uuid;
alter table public.pedidos add column if not exists autorizado_por uuid;

create table public.gestor_autorizacoes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  gestor_id uuid not null,
  operador_id uuid,
  acao text not null check (acao in ('cancelar_venda','desconto','sangria')),
  usado_em timestamptz,
  expira_em timestamptz not null default now() + interval '5 minutes',
  created_at timestamptz not null default now()
);
grant select on public.gestor_autorizacoes to authenticated;
grant all on public.gestor_autorizacoes to service_role;
alter table public.gestor_autorizacoes enable row level security;
create policy "Gestores veem autorizacoes do tenant" on public.gestor_autorizacoes for select to authenticated
  using (tenant_id = public.current_tenant_id() and (public.has_role(auth.uid(),'administrador') or public.has_role(auth.uid(),'gestor')));

create or replace function public.consumir_autorizacao(p_id uuid, p_acao text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_gestor uuid;
begin
  update public.gestor_autorizacoes set usado_em = now()
   where id = p_id and acao = p_acao and tenant_id = public.current_tenant_id()
     and usado_em is null and expira_em > now()
  returning gestor_id into v_gestor;
  if v_gestor is null then raise exception 'Autorização do gestor inválida ou expirada'; end if;
  return v_gestor;
end $$;
revoke execute on function public.consumir_autorizacao(uuid,text) from public, anon, authenticated;

create or replace function public.frente_caixa_atual()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.caixas where tenant_id = public.current_tenant_id()
    and aberto_por = auth.uid() and situacao = 'aberto' order by aberto_em desc limit 1;
$$;
grant execute on function public.frente_caixa_atual() to authenticated;

create or replace function public.frente_abrir_caixa(p_filial_id uuid, p_valor_abertura numeric default 0)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tenant uuid := public.current_tenant_id(); v_id uuid;
begin
  if v_tenant is null then raise exception 'Usuário sem empresa vinculada'; end if;
  if public.frente_caixa_atual() is not null then raise exception 'Você já tem um caixa aberto'; end if;
  insert into public.caixas (tenant_id, filial_id, aberto_por, valor_abertura, observacao)
  values (v_tenant, p_filial_id, auth.uid(), coalesce(p_valor_abertura,0), 'Frente de caixa')
  returning id into v_id;
  if coalesce(p_valor_abertura,0) > 0 then
    insert into public.caixa_movimentos (tenant_id, caixa_id, tipo, valor, forma_pagamento, descricao, usuario_id)
    values (v_tenant, v_id, 'abertura', p_valor_abertura, 'dinheiro', 'Valor de abertura', auth.uid());
  end if;
  return v_id;
end $$;
grant execute on function public.frente_abrir_caixa(uuid,numeric) to authenticated;

create or replace function public.frente_venda(p_deposito_id uuid, p_itens jsonb, p_forma forma_pagamento,
  p_cliente_id uuid default null, p_desconto numeric default 0, p_parcelas integer default 1,
  p_primeiro_vencimento date default null, p_autorizacao uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_caixa uuid := public.frente_caixa_atual(); v_limite numeric; v_sub numeric := 0; it jsonb;
  v_pedido uuid; v_gestor uuid;
begin
  if v_caixa is null then raise exception 'Abra o seu caixa antes de vender'; end if;
  for it in select * from jsonb_array_elements(p_itens) loop
    v_sub := v_sub + (it->>'quantidade')::numeric * coalesce((it->>'preco_unitario')::numeric,0);
  end loop;
  select coalesce(e.pdv_desconto_limite,5) into v_limite from public.empresas e
    where e.tenant_id = public.current_tenant_id() order by e.created_at limit 1;
  if v_sub > 0 and coalesce(p_desconto,0) > round(v_sub * coalesce(v_limite,5) / 100, 2) then
    if p_autorizacao is null then raise exception 'Desconto acima de %%%: exige senha do gestor', v_limite; end if;
    v_gestor := public.consumir_autorizacao(p_autorizacao, 'desconto');
  end if;
  v_pedido := public.pdv_venda(p_deposito_id, p_itens, p_forma, p_cliente_id, p_desconto, p_parcelas, p_primeiro_vencimento, 'Venda na frente de caixa');
  update public.caixa_movimentos set caixa_id = v_caixa where pedido_id = v_pedido and tipo = 'venda';
  update public.pedidos set caixa_id = v_caixa, autorizado_por = v_gestor where id = v_pedido;
  return v_pedido;
end $$;
grant execute on function public.frente_venda(uuid,jsonb,forma_pagamento,uuid,numeric,integer,date,uuid) to authenticated;

create or replace function public.frente_cancelar_venda(p_pedido_id uuid, p_autorizacao uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_tenant uuid := public.current_tenant_id(); v_ped record; v_gestor uuid; v_caixa uuid := public.frente_caixa_atual(); i record;
begin
  select * into v_ped from public.pedidos where id = p_pedido_id and tenant_id = v_tenant;
  if v_ped.id is null then raise exception 'Venda não encontrada'; end if;
  if v_ped.situacao = 'cancelado' then raise exception 'Venda já cancelada'; end if;
  if coalesce(v_ped.origem,'') <> 'pdv' then raise exception 'Só vendas de balcão podem ser canceladas aqui'; end if;
  v_gestor := public.consumir_autorizacao(p_autorizacao, 'cancelar_venda');
  for i in select produto_id, quantidade, custo_unitario from public.pedido_itens where pedido_id = p_pedido_id loop
    perform public.registrar_movimentacao(i.produto_id, v_ped.deposito_id, 'entrada'::mov_tipo, i.quantidade,
      'Cancelamento de venda', 'CANC-' || v_ped.numero, null::uuid, i.custo_unitario);
  end loop;
  if exists (select 1 from public.caixa_movimentos where pedido_id = p_pedido_id and tipo = 'venda') then
    perform public.caixa_lancar(coalesce(v_caixa, v_ped.caixa_id), 'saida'::caixa_mov_tipo, v_ped.total,
      'Cancelamento da venda nº ' || v_ped.numero, v_ped.forma_pagamento, v_ped.deposito_id, p_pedido_id);
  end if;
  update public.contas_receber set situacao = 'cancelado' where pedido_id = p_pedido_id and situacao in ('aberto','parcial');
  update public.pedidos set situacao = 'cancelado', motivo_cancelamento = coalesce(p_motivo,'Cancelada no caixa'),
    cancelado_por = auth.uid(), autorizado_por = v_gestor where id = p_pedido_id;
  insert into public.pedido_historico (tenant_id, pedido_id, situacao_anterior, situacao_nova, observacao, usuario_id)
  values (v_tenant, p_pedido_id, v_ped.situacao, 'cancelado', 'Cancelada na frente de caixa com senha do gestor', auth.uid());
end $$;
grant execute on function public.frente_cancelar_venda(uuid,uuid,text) to authenticated;

create or replace function public.frente_movimento(p_tipo caixa_mov_tipo, p_valor numeric, p_descricao text, p_autorizacao uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_caixa uuid := public.frente_caixa_atual();
begin
  if v_caixa is null then raise exception 'Abra o seu caixa primeiro'; end if;
  if p_tipo not in ('sangria','suprimento') then raise exception 'Movimento inválido'; end if;
  if p_tipo = 'sangria' then perform public.consumir_autorizacao(p_autorizacao, 'sangria'); end if;
  return public.caixa_lancar(v_caixa, p_tipo, p_valor, p_descricao, 'dinheiro'::forma_pagamento, null, null);
end $$;
grant execute on function public.frente_movimento(caixa_mov_tipo,numeric,text,uuid) to authenticated;

create or replace function public.relatorio_fechamento_operador(p_de date, p_ate date)
returns table (caixa_id uuid, numero integer, operador_id uuid, operador text, aberto_em timestamptz, fechado_em timestamptz,
  situacao text, abertura numeric, vendas numeric, qtd_vendas bigint, dinheiro numeric, pix numeric, cartao_credito numeric,
  cartao_debito numeric, outras numeric, cancelamentos numeric, qtd_cancelamentos bigint, sangrias numeric, suprimentos numeric,
  esperado numeric, informado numeric, diferenca numeric)
language sql stable security definer set search_path = public as $$
  select c.id, c.numero, c.aberto_por, coalesce(p.nome, 'Operador'), c.aberto_em, c.fechado_em, c.situacao::text,
    c.valor_abertura,
    coalesce(sum(m.valor) filter (where m.tipo='venda'),0),
    count(m.id) filter (where m.tipo='venda'),
    coalesce(sum(m.valor) filter (where m.tipo='venda' and m.forma_pagamento='dinheiro'),0),
    coalesce(sum(m.valor) filter (where m.tipo='venda' and m.forma_pagamento='pix'),0),
    coalesce(sum(m.valor) filter (where m.tipo='venda' and m.forma_pagamento='cartao_credito'),0),
    coalesce(sum(m.valor) filter (where m.tipo='venda' and m.forma_pagamento='cartao_debito'),0),
    coalesce(sum(m.valor) filter (where m.tipo='venda' and m.forma_pagamento not in ('dinheiro','pix','cartao_credito','cartao_debito')),0),
    coalesce(sum(m.valor) filter (where m.tipo='saida' and m.descricao like 'Cancelamento%'),0),
    count(m.id) filter (where m.tipo='saida' and m.descricao like 'Cancelamento%'),
    coalesce(sum(m.valor) filter (where m.tipo='sangria'),0),
    coalesce(sum(m.valor) filter (where m.tipo='suprimento'),0),
    c.valor_esperado, c.valor_informado, c.diferenca
  from public.caixas c
  left join public.profiles p on p.id = c.aberto_por
  left join public.caixa_movimentos m on m.caixa_id = c.id
  where c.tenant_id = public.current_tenant_id()
    and c.aberto_em::date between p_de and p_ate
    and (public.has_role(auth.uid(),'administrador') or public.has_role(auth.uid(),'gestor') or c.aberto_por = auth.uid())
  group by c.id, p.nome
  order by c.aberto_em desc;
$$;
grant execute on function public.relatorio_fechamento_operador(date,date) to authenticated;