CREATE OR REPLACE FUNCTION public.saas_tempo_real_por_cliente(p_de date, p_ate date)
 RETURNS TABLE(cliente_id uuid, cliente text, plano text, tenant_id uuid, situacao text, pedidos bigint, valor_vendas numeric, ultima_venda timestamp with time zone, notas bigint, notas_autorizadas bigint, valor_notas numeric, impostos numeric, ultima_nota timestamp with time zone, notas_servico bigint, valor_notas_servico numeric, locacoes bigint, valor_locacoes numeric, locacoes_abertas bigint, ultima_locacao timestamp with time zone, os_abertas bigint, os_pendentes bigint, os_custo numeric, ultima_os timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  PERFORM public.exige_nao_salao();
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
               sum(pe.total) as valor,
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
GRANT EXECUTE ON FUNCTION public.saas_tempo_real_por_cliente(date, date) TO authenticated, service_role;