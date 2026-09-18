CREATE TABLE public.compra_cotacao_itens (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  cotacao_id uuid NOT NULL REFERENCES public.compra_cotacoes(id) ON DELETE CASCADE,
  compra_item_id uuid NOT NULL REFERENCES public.compra_itens(id) ON DELETE CASCADE,
  produto_id uuid NOT NULL REFERENCES public.produtos(id),
  quantidade numeric(14,3) NOT NULL DEFAULT 0,
  custo_unitario numeric(14,4) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0,
  observacao text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (cotacao_id, compra_item_id)
);

CREATE INDEX compra_cotacao_itens_cotacao_idx ON public.compra_cotacao_itens(cotacao_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.compra_cotacao_itens TO authenticated;
GRANT ALL ON public.compra_cotacao_itens TO service_role;

ALTER TABLE public.compra_cotacao_itens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "compra_cotacao_itens_tenant" ON public.compra_cotacao_itens
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE TRIGGER touch_compra_cotacao_itens
  BEFORE UPDATE ON public.compra_cotacao_itens
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.cotacao_registrar_itens(
  p_cotacao_id uuid,
  p_itens jsonb,
  p_prazo_entrega_dias integer DEFAULT NULL,
  p_condicao_pagamento text DEFAULT NULL,
  p_observacao text DEFAULT NULL
) RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_tenant uuid := public.current_tenant_id();
  q public.compra_cotacoes;
  it jsonb;
  v_item public.compra_itens;
  v_custo numeric;
  v_total numeric := 0;
begin
  select * into q from public.compra_cotacoes where id = p_cotacao_id and tenant_id = v_tenant;
  if q.id is null then raise exception 'Proposta não encontrada nesta empresa'; end if;

  for it in select * from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) loop
    select * into v_item
      from public.compra_itens
     where id = (it->>'compra_item_id')::uuid
       and compra_id = q.compra_id
       and tenant_id = v_tenant;
    if v_item.id is null then
      continue;
    end if;
    v_custo := coalesce((it->>'custo_unitario')::numeric, 0);
    insert into public.compra_cotacao_itens
      (tenant_id, cotacao_id, compra_item_id, produto_id, quantidade, custo_unitario, total, observacao)
    values
      (v_tenant, q.id, v_item.id, v_item.produto_id, v_item.quantidade, v_custo,
       round(v_item.quantidade * v_custo, 2), nullif(it->>'observacao',''))
    on conflict (cotacao_id, compra_item_id) do update
      set quantidade = excluded.quantidade,
          custo_unitario = excluded.custo_unitario,
          total = excluded.total,
          observacao = excluded.observacao;
  end loop;

  select coalesce(sum(total),0) into v_total
    from public.compra_cotacao_itens where cotacao_id = q.id;

  update public.compra_cotacoes
     set valor_total = case when v_total > 0 then v_total else valor_total end,
         prazo_entrega_dias = coalesce(p_prazo_entrega_dias, prazo_entrega_dias),
         condicao_pagamento = coalesce(nullif(p_condicao_pagamento,''), condicao_pagamento),
         observacao = coalesce(nullif(p_observacao,''), observacao)
   where id = q.id;

  return v_total;
end $$;

REVOKE ALL ON FUNCTION public.cotacao_registrar_itens(uuid, jsonb, integer, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.cotacao_registrar_itens(uuid, jsonb, integer, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.compra_aplicar_cotacao(p_cotacao_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := public.current_tenant_id();
  q public.compra_cotacoes;
  c public.compras;
  v_base numeric;
  v_fator numeric := 1;
  v_tem_itens boolean;
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

  select exists (
    select 1 from public.compra_cotacao_itens
     where cotacao_id = q.id and custo_unitario > 0
  ) into v_tem_itens;

  if v_tem_itens then
    update public.compra_itens ci
       set custo_unitario = cci.custo_unitario,
           total = round(ci.quantidade * cci.custo_unitario, 2)
      from public.compra_cotacao_itens cci
     where cci.cotacao_id = q.id
       and cci.compra_item_id = ci.id
       and cci.custo_unitario > 0;
  else
    select coalesce(sum(total),0) into v_base from public.compra_itens where compra_id = c.id;
    if v_base > 0 and coalesce(q.valor_total,0) > 0 then
      v_fator := q.valor_total / v_base;
    end if;

    update public.compra_itens
       set custo_unitario = round(custo_unitario * v_fator, 4),
           total = round(quantidade * round(custo_unitario * v_fator, 4), 2)
     where compra_id = c.id;
  end if;

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
end $function$;