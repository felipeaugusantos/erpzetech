DROP FUNCTION IF EXISTS public.saas_fiscal_por_periodo(date, date);

CREATE OR REPLACE FUNCTION public.saas_fiscal_por_periodo(p_de date, p_ate date)
 RETURNS TABLE(cliente_id uuid, cliente text, plano text, tenant_id uuid, entradas numeric, saidas numeric, saldo_estoque numeric, notas bigint, valor_notas numeric, notas_venda bigint, valor_notas_venda numeric, notas_servico bigint, valor_notas_servico numeric, iss_servico numeric, icms numeric, icms_st numeric, pis numeric, cofins numeric, iss numeric, impostos numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
             count(*) filter (where coalesce(n.modelo,'nfe') <> 'nfse') qtd_venda,
             coalesce(sum(case when coalesce(n.modelo,'nfe') <> 'nfse' then n.valor_total else 0 end),0) valor_venda,
             count(*) filter (where n.modelo = 'nfse') qtd_servico,
             coalesce(sum(case when n.modelo = 'nfse' then n.valor_total else 0 end),0) valor_servico,
             coalesce(sum(case when n.modelo = 'nfse' then coalesce(n.valor_iss,0) else 0 end),0) iss_servico,
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
           coalesce(nt.qtd_venda,0), coalesce(nt.valor_venda,0),
           coalesce(nt.qtd_servico,0), coalesce(nt.valor_servico,0), coalesce(nt.iss_servico,0),
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
$function$;

REVOKE ALL ON FUNCTION public.saas_fiscal_por_periodo(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.saas_fiscal_por_periodo(date, date) TO authenticated;

DROP FUNCTION IF EXISTS public.saas_tempo_real_por_cliente(date, date);

CREATE OR REPLACE FUNCTION public.saas_tempo_real_por_cliente(p_de date, p_ate date)
 RETURNS TABLE(cliente_id uuid, cliente text, plano text, tenant_id uuid, situacao text, pedidos bigint, valor_vendas numeric, ultima_venda timestamp with time zone, notas bigint, notas_autorizadas bigint, valor_notas numeric, impostos numeric, ultima_nota timestamp with time zone, notas_servico bigint, valor_notas_servico numeric, locacoes bigint, valor_locacoes numeric, locacoes_abertas bigint, ultima_locacao timestamp with time zone, os_abertas bigint, os_pendentes bigint, os_custo numeric, ultima_os timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not eh_saas_operador() then
    raise exception 'Acesso restrito à equipe Ze Tech';
  end if;
  return query
    select c.id,
           c.nome,
           p.nome,
           c.tenant_id,
           c.situacao::text,
           coalesce(v.pedidos,0),
           coalesce(v.valor,0),
           v.ultima,
           coalesce(n.notas,0),
           coalesce(n.autorizadas,0),
           coalesce(n.valor,0),
           coalesce(n.impostos,0),
           n.ultima,
           coalesce(n.servico,0),
           coalesce(n.valor_servico,0),
           coalesce(l.locacoes,0),
           coalesce(l.valor,0),
           coalesce(l.abertas,0),
           l.ultima,
           coalesce(o.abertas,0),
           coalesce(o.pendentes,0),
           coalesce(o.custo,0),
           o.ultima
      from public.saas_clientes c
      left join public.saas_planos p on p.id = c.plano_id
      left join (
        select pe.tenant_id,
               count(*) as pedidos,
               sum(pe.valor_total) as valor,
               max(pe.created_at) as ultima
          from public.pedidos pe
         where pe.created_at::date between p_de and p_ate
           and pe.situacao <> 'cancelado'
         group by pe.tenant_id
      ) v on v.tenant_id = c.tenant_id
      left join (
        select nf.tenant_id,
               count(*) as notas,
               count(*) filter (where nf.situacao in ('autorizada','emitida')) as autorizadas,
               count(*) filter (where nf.modelo = 'nfse') as servico,
               sum(case when nf.modelo = 'nfse' then nf.valor_total else 0 end) as valor_servico,
               sum(nf.valor_total) as valor,
               sum(coalesce(nf.valor_icms,0) + coalesce(nf.valor_icms_st,0)
                   + coalesce(nf.valor_pis,0) + coalesce(nf.valor_cofins,0)
                   + coalesce(nf.valor_iss,0)) as impostos,
               max(coalesce(nf.autorizada_em, nf.created_at)) as ultima
          from public.nfe nf
         where coalesce(nf.autorizada_em, nf.created_at)::date between p_de and p_ate
         group by nf.tenant_id
      ) n on n.tenant_id = c.tenant_id
      left join (
        select lo.tenant_id,
               count(*) as locacoes,
               sum(lo.valor_total) as valor,
               count(*) filter (where lo.situacao in ('reservada','em_andamento')) as abertas,
               max(lo.created_at) as ultima
          from public.locacoes lo
         where lo.created_at::date between p_de and p_ate
           and lo.situacao <> 'cancelada'
         group by lo.tenant_id
      ) l on l.tenant_id = c.tenant_id
      left join (
        select os.tenant_id,
               count(*) as abertas,
               count(*) filter (where os.situacao not in ('entregue','cancelada')) as pendentes,
               sum(os.valor_total) as custo,
               max(os.abertura) as ultima
          from public.os_ordens os
         where os.abertura::date between p_de and p_ate
         group by os.tenant_id
      ) o on o.tenant_id = c.tenant_id
     order by coalesce(v.valor,0) desc, c.nome;
end;
$function$;

REVOKE ALL ON FUNCTION public.saas_tempo_real_por_cliente(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.saas_tempo_real_por_cliente(date, date) TO authenticated;