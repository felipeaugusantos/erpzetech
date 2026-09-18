alter table public.profiles add column if not exists codigo text;
alter table public.profissionais add column if not exists codigo text;

with n as (
  select id, lpad((row_number() over (partition by tenant_id order by created_at, id))::text, 3, '0') c
  from public.profiles where codigo is null
)
update public.profiles p set codigo = n.c from n where n.id = p.id;

with n as (
  select id, lpad((row_number() over (partition by tenant_id order by created_at, id))::text, 3, '0') c
  from public.profissionais where codigo is null
)
update public.profissionais pr set codigo = n.c from n where n.id = pr.id;

create unique index if not exists profiles_tenant_codigo_uk on public.profiles (tenant_id, codigo) where codigo is not null;
create unique index if not exists profissionais_tenant_codigo_uk on public.profissionais (tenant_id, codigo) where codigo is not null;

alter table public.orcamentos add column if not exists profissional_id uuid references public.profissionais(id);
alter table public.pedidos add column if not exists profissional_id uuid references public.profissionais(id);

create or replace function public.premiar_pedido()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
DECLARE
  v_prof_id uuid;
  v_perc numeric;
BEGIN
  IF NEW.situacao NOT IN ('entregue','concluido') THEN
    RETURN NEW;
  END IF;

  IF NEW.profissional_id IS NOT NULL THEN
    SELECT pr.id, pr.percentual_premio INTO v_prof_id, v_perc
    FROM public.profissionais pr WHERE pr.id = NEW.profissional_id AND pr.ativo;
  END IF;

  IF v_prof_id IS NULL THEN
    SELECT pr.id, pr.percentual_premio INTO v_prof_id, v_perc
    FROM public.clientes c
    JOIN public.profissionais pr ON pr.id = c.profissional_id AND pr.ativo
    WHERE c.id = NEW.cliente_id AND c.profissional_id IS NOT NULL;
  END IF;

  IF v_prof_id IS NULL OR COALESCE(v_perc, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.premiacoes x
    WHERE x.pedido_id = NEW.id AND x.profissional_id = v_prof_id
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.premiacoes (
    tenant_id, profissional_id, cliente_id, pedido_id, valor_base, percentual, valor, observacao
  ) VALUES (
    NEW.tenant_id, v_prof_id, NEW.cliente_id, NEW.id, NEW.total, v_perc,
    round(NEW.total * v_perc / 100, 2),
    'Lançamento automático pelo pedido'
  );

  RETURN NEW;
END;
$function$;

create or replace function public.converter_orcamento_em_pedido(p_orcamento_id uuid, p_deposito_id uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
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
    vendedor_id, profissional_id, deposito_id, situacao, condicao_pagamento, subtotal, desconto, frete, total, observacoes)
  values (v_tenant, o.empresa_id, o.filial_id, o.id, o.cliente_id, o.obra_id,
    coalesce(o.vendedor_id, auth.uid()), o.profissional_id, p_deposito_id, 'aguardando_pagamento', o.condicao_pagamento,
    o.subtotal, o.desconto, o.frete, o.total, o.observacoes)
  returning id into v_pedido_id;

  insert into public.pedido_itens (tenant_id, pedido_id, produto_id, quantidade, unidade,
    preco_unitario, desconto, total, observacao)
  select v_tenant, v_pedido_id, i.produto_id, i.quantidade, i.unidade, i.preco_unitario, i.desconto, i.total, i.observacao
  from public.orcamento_itens i where i.orcamento_id = o.id;

  for it in select produto_id, sum(quantidade) q from public.pedido_itens where pedido_id = v_pedido_id group by produto_id loop
    perform public.registrar_movimentacao(it.produto_id, p_deposito_id, 'reserva'::mov_tipo, it.q,
      'Reserva do pedido', 'PED-' || (select numero from public.pedidos where id = v_pedido_id), null);
  end loop;

  update public.pedidos set estoque_reservado = true where id = v_pedido_id;

  insert into public.pedido_historico (tenant_id, pedido_id, situacao_anterior, situacao_nova, observacao, usuario_id)
  values (v_tenant, v_pedido_id, null, 'aguardando_pagamento',
    'Pedido gerado do orçamento nº ' || o.numero || ' com reserva de estoque', auth.uid());

  return v_pedido_id;
end; $function$;

create or replace function public.criar_pedido_direto(
  p_cliente_id uuid,
  p_deposito_id uuid,
  p_itens jsonb,
  p_obra_id uuid default null,
  p_desconto numeric default 0,
  p_frete numeric default 0,
  p_condicao_pagamento text default null,
  p_previsao_entrega date default null,
  p_vendedor_id uuid default null,
  p_profissional_id uuid default null,
  p_observacoes text default null
) returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_pedido_id uuid;
  v_emp uuid;
  v_fil uuid;
  it record;
begin
  if v_tenant is null then raise exception 'Usuário sem empresa vinculada'; end if;
  if not (public.has_role(auth.uid(),'administrador') or public.has_role(auth.uid(),'gestor')
       or public.has_role(auth.uid(),'vendedor') or public.has_role(auth.uid(),'caixa')) then
    raise exception 'Sem permissão para criar pedidos';
  end if;
  if not exists (select 1 from public.clientes where id = p_cliente_id and tenant_id = v_tenant) then
    raise exception 'Cliente não encontrado nesta empresa';
  end if;
  select d.filial_id, f.empresa_id into v_fil, v_emp
  from public.depositos d left join public.filiais f on f.id = d.filial_id
  where d.id = p_deposito_id and d.tenant_id = v_tenant;
  if v_fil is null and not exists (select 1 from public.depositos where id = p_deposito_id and tenant_id = v_tenant) then
    raise exception 'Depósito não encontrado nesta empresa';
  end if;
  if p_itens is null or jsonb_array_length(p_itens) = 0 then
    raise exception 'Informe ao menos um item no pedido';
  end if;

  insert into public.pedidos (tenant_id, empresa_id, filial_id, cliente_id, obra_id, vendedor_id,
    profissional_id, deposito_id, situacao, origem, condicao_pagamento, previsao_entrega,
    subtotal, desconto, frete, total, observacoes)
  values (v_tenant, v_emp, v_fil, p_cliente_id, p_obra_id, coalesce(p_vendedor_id, auth.uid()),
    p_profissional_id, p_deposito_id, 'aguardando_pagamento', 'direto', p_condicao_pagamento,
    p_previsao_entrega, 0, coalesce(p_desconto,0), coalesce(p_frete,0), 0, p_observacoes)
  returning id into v_pedido_id;

  insert into public.pedido_itens (tenant_id, pedido_id, produto_id, quantidade, unidade,
    preco_unitario, desconto, total)
  select v_tenant, v_pedido_id, (i->>'produto_id')::uuid,
    (i->>'quantidade')::numeric,
    coalesce(i->>'unidade', (select unidade from public.produtos where id = (i->>'produto_id')::uuid)),
    (i->>'preco_unitario')::numeric,
    coalesce((i->>'desconto')::numeric, 0),
    round((i->>'quantidade')::numeric * (i->>'preco_unitario')::numeric - coalesce((i->>'desconto')::numeric,0), 2)
  from jsonb_array_elements(p_itens) i;

  perform public.recalcular_pedido(v_pedido_id);

  for it in select produto_id, sum(quantidade) q from public.pedido_itens where pedido_id = v_pedido_id group by produto_id loop
    perform public.registrar_movimentacao(it.produto_id, p_deposito_id, 'reserva'::mov_tipo, it.q,
      'Reserva do pedido', 'PED-' || (select numero from public.pedidos where id = v_pedido_id), null);
  end loop;

  update public.pedidos set estoque_reservado = true where id = v_pedido_id;

  insert into public.pedido_historico (tenant_id, pedido_id, situacao_anterior, situacao_nova, observacao, usuario_id)
  values (v_tenant, v_pedido_id, null, 'aguardando_pagamento',
    'Pedido criado direto no sistema com reserva de estoque', auth.uid());

  return v_pedido_id;
end; $function$;

revoke all on function public.criar_pedido_direto(uuid, uuid, jsonb, uuid, numeric, numeric, text, date, uuid, uuid, text) from anon;
grant execute on function public.criar_pedido_direto(uuid, uuid, jsonb, uuid, numeric, numeric, text, date, uuid, uuid, text) to authenticated;