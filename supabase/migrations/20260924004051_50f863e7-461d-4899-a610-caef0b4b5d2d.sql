alter table public.profiles add column if not exists pode_abrir_caixa boolean not null default true,
  add column if not exists pode_ver_fechamento boolean not null default false;

create or replace function public.operador_definir_permissoes(p_user_id uuid, p_abrir boolean, p_ver boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(),'administrador') then raise exception 'Somente o administrador altera permissões'; end if;
  update public.profiles set pode_abrir_caixa = p_abrir, pode_ver_fechamento = p_ver
   where id = p_user_id and tenant_id = public.current_tenant_id();
  if not found then raise exception 'Operador não encontrado nesta empresa'; end if;
end $$;
revoke execute on function public.operador_definir_permissoes(uuid,boolean,boolean) from public, anon;
grant execute on function public.operador_definir_permissoes(uuid,boolean,boolean) to authenticated;

create or replace function public.frente_abrir_caixa(p_filial_id uuid, p_valor_abertura numeric default 0)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tenant uuid := public.current_tenant_id(); v_id uuid;
begin
  if v_tenant is null then raise exception 'Usuário sem empresa vinculada'; end if;
  if not coalesce((select pode_abrir_caixa and coalesce(ativo,true) from public.profiles where id = auth.uid()), false) then
    raise exception 'Você não tem permissão para abrir caixa';
  end if;
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
    and (public.has_role(auth.uid(),'administrador') or public.has_role(auth.uid(),'gestor') or c.aberto_por = auth.uid()
         or coalesce((select pode_ver_fechamento from public.profiles where id = auth.uid()), false))
  group by c.id, p.nome
  order by c.aberto_em desc;
$$;