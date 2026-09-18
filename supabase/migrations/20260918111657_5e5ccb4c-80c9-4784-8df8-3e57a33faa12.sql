create or replace function public.compra_aplicar_cotacao(p_cotacao_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  q public.compra_cotacoes;
  c public.compras;
  v_base numeric;
  v_fator numeric := 1;
begin
  select * into q from public.compra_cotacoes where id = p_cotacao_id and tenant_id = v_tenant;
  if q.id is null then raise exception 'Cotação não encontrada nesta empresa'; end if;

  select * into c from public.compras where id = q.compra_id and tenant_id = v_tenant;
  if c.id is null then raise exception 'Compra não encontrada nesta empresa'; end if;
  if c.situacao not in ('rascunho','cotacao') then
    raise exception 'A compra já saiu da fase de cotação';
  end if;
  if not exists (select 1 from public.compra_itens where compra_id = c.id) then
    raise exception 'Inclua ao menos um produto na compra';
  end if;

  update public.compra_cotacoes set escolhida = false where compra_id = c.id;
  update public.compra_cotacoes set escolhida = true where id = q.id;

  select coalesce(sum(total),0) into v_base from public.compra_itens where compra_id = c.id;
  if v_base > 0 and coalesce(q.valor_total,0) > 0 then
    v_fator := q.valor_total / v_base;
  end if;

  update public.compra_itens
     set custo_unitario = round(custo_unitario * v_fator, 4),
         total = round(quantidade * round(custo_unitario * v_fator, 4), 2)
   where compra_id = c.id;

  update public.produtos p
     set custo = ci.custo_unitario, updated_at = now()
    from public.compra_itens ci
   where ci.compra_id = c.id and p.id = ci.produto_id and p.tenant_id = v_tenant
     and ci.custo_unitario > 0;

  select coalesce(sum(total),0) into v_base from public.compra_itens where compra_id = c.id;

  update public.compras
     set fornecedor_id = q.fornecedor_id,
         condicao_pagamento = coalesce(q.condicao_pagamento, condicao_pagamento),
         previsao_entrega = case when q.prazo_entrega_dias is not null
           then (current_date + q.prazo_entrega_dias) else previsao_entrega end,
         subtotal = v_base,
         total = v_base - coalesce(desconto,0) + coalesce(frete,0),
         situacao = 'cotacao'::public.compra_situacao
   where id = c.id;

  update public.compras
     set situacao = 'aprovado'::public.compra_situacao,
         aprovado_por = auth.uid(),
         aprovado_em = now()
   where id = c.id;

  update public.compras
     set situacao = 'pedido_enviado'::public.compra_situacao
   where id = c.id;
end $$;

grant execute on function public.compra_aplicar_cotacao(uuid) to authenticated;