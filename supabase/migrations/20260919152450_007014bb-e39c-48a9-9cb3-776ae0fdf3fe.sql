CREATE OR REPLACE FUNCTION public.saas_assistencia_por_cliente(p_de date, p_ate date)
 RETURNS TABLE(cliente_id uuid, cliente text, plano text, tenant_id uuid,
   abertas bigint, encerradas bigint, em_reparo bigint, canceladas bigint, pendentes bigint,
   valor_pecas numeric, valor_servicos numeric, valor_total numeric,
   ticket_medio numeric, ultima_abertura timestamp with time zone)
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
           count(o.id),
           count(o.id) filter (where o.situacao = 'entregue'),
           count(o.id) filter (where o.situacao = 'em_reparo'),
           count(o.id) filter (where o.situacao = 'cancelada'),
           count(o.id) filter (where o.situacao not in ('entregue','cancelada')),
           coalesce(sum(o.valor_pecas),0),
           coalesce(sum(o.valor_servicos),0),
           coalesce(sum(o.valor_total),0),
           case when count(o.id) filter (where o.situacao <> 'cancelada') > 0
             then coalesce(sum(o.valor_total) filter (where o.situacao <> 'cancelada'),0)
                  / count(o.id) filter (where o.situacao <> 'cancelada')
             else 0 end,
           max(o.abertura)
      from public.saas_clientes c
      left join public.saas_planos p on p.id = c.plano_id
      left join public.os_ordens o
        on o.tenant_id = c.tenant_id
       and o.abertura::date between p_de and p_ate
     group by c.id, c.nome, p.nome, c.tenant_id
     order by count(o.id) desc, c.nome;
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.saas_assistencia_por_cliente(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.saas_assistencia_por_cliente(date, date) TO authenticated;