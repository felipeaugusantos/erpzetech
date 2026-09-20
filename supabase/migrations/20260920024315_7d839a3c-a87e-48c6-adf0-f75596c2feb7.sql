alter table public.locacao_equipamentos
  add column if not exists valor_aquisicao numeric(14,2) not null default 0,
  add column if not exists custo_manutencao numeric(14,2) not null default 0;

create or replace function public.saas_fiscal_por_periodo(p_de date, p_ate date)
returns table(
  cliente_id uuid, cliente text, plano text, tenant_id uuid,
  entradas numeric, saidas numeric, saldo_estoque numeric,
  notas bigint, valor_notas numeric,
  icms numeric, icms_st numeric, pis numeric, cofins numeric, iss numeric, impostos numeric
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not eh_saas_operador() then
    raise exception 'Acesso restrito à equipe Ze Tech';
  end if;
  return query
    with mov as (
      select m.tenant_id,
             coalesce(sum(case when m.tipo in ('entrada','transferencia_entrada')
               then coalesce(m.valor_total, m.quantidade * coalesce(m.custo_unitario,0)) else 0 end),0) entradas,
             coalesce(sum(case when m.tipo in ('saida','transferencia_saida')
               then coalesce(m.valor_total, m.quantidade * coalesce(m.custo_unitario,0)) else 0 end),0) saidas
        from public.estoque_movimentacoes m
       where m.created_at::date between p_de and p_ate
       group by m.tenant_id
    ),
    saldo as (
      select e.tenant_id, coalesce(sum(e.quantidade * coalesce(e.custo_medio,0)),0) saldo
        from public.estoques e
       group by e.tenant_id
    ),
    nt as (
      select n.tenant_id,
             count(*) qtd,
             coalesce(sum(n.valor_total),0) valor,
             coalesce(sum(n.valor_icms),0) icms,
             coalesce(sum(n.valor_icms_st),0) icms_st,
             coalesce(sum(n.valor_pis),0) pis,
             coalesce(sum(n.valor_cofins),0) cofins,
             coalesce(sum(n.valor_iss),0) iss
        from public.nfe n
       where n.situacao <> 'cancelada'
         and coalesce(n.autorizada_em, n.emitida_em, n.created_at)::date between p_de and p_ate
       group by n.tenant_id
    )
    select c.id, c.nome, pl.nome, c.tenant_id,
           coalesce(mov.entradas,0), coalesce(mov.saidas,0), coalesce(saldo.saldo,0),
           coalesce(nt.qtd,0), coalesce(nt.valor,0),
           coalesce(nt.icms,0), coalesce(nt.icms_st,0), coalesce(nt.pis,0),
           coalesce(nt.cofins,0), coalesce(nt.iss,0),
           coalesce(nt.icms,0)+coalesce(nt.icms_st,0)+coalesce(nt.pis,0)
             +coalesce(nt.cofins,0)+coalesce(nt.iss,0)
      from public.saas_clientes c
      left join public.saas_planos pl on pl.id = c.plano_id
      left join mov on mov.tenant_id = c.tenant_id
      left join saldo on saldo.tenant_id = c.tenant_id
      left join nt on nt.tenant_id = c.tenant_id
     order by c.nome;
end;
$$;

revoke all on function public.saas_fiscal_por_periodo(date, date) from public, anon;
grant execute on function public.saas_fiscal_por_periodo(date, date) to authenticated;