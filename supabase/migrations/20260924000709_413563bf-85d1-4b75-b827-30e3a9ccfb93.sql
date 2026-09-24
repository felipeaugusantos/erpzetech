do $$
declare d text;
begin
  d := pg_get_functiondef('public.pdv_venda(uuid,jsonb,forma_pagamento,uuid,numeric,integer,date,text)'::regprocedure);
  d := replace(d, 'select id into v_caixa from public.caixas
      where tenant_id = v_tenant and situacao = ''aberto''
      order by aberto_em desc limit 1;', 'v_caixa := public.frente_caixa_atual();
    if v_caixa is null then
      select id into v_caixa from public.caixas
        where tenant_id = v_tenant and situacao = ''aberto''
        order by aberto_em desc limit 1;
    end if;');
  execute d;
end $$;

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
  update public.pedidos set caixa_id = v_caixa, autorizado_por = v_gestor where id = v_pedido;
  return v_pedido;
end $$;