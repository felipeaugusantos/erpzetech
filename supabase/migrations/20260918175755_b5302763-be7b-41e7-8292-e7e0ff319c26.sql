DROP FUNCTION IF EXISTS public.registrar_movimentacao(uuid, uuid, public.mov_tipo, numeric, text, text, uuid);

CREATE OR REPLACE FUNCTION public.receber_compra(p_compra_id uuid, p_itens jsonb, p_documento text DEFAULT NULL::text, p_observacao text DEFAULT NULL::text, p_gerar_conta boolean DEFAULT true, p_vencimento date DEFAULT NULL::date, p_parcelas integer DEFAULT 1)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := public.current_tenant_id();
  c public.compras; it jsonb; ci public.compra_itens;
  v_rec_id uuid; v_qtd numeric; v_custo numeric; v_valor numeric := 0;
  v_pend int; i int; v_parc numeric; v_n int;
begin
  select * into c from public.compras where id = p_compra_id and tenant_id = v_tenant;
  if c.id is null then raise exception 'Compra não encontrada nesta empresa'; end if;
  if c.situacao not in ('aprovado','pedido_enviado','parcialmente_recebido') then
    raise exception 'Só é possível receber uma compra aprovada ou enviada';
  end if;
  if p_itens is null or jsonb_array_length(p_itens) = 0 then raise exception 'Informe os itens recebidos'; end if;

  insert into public.compra_recebimentos (tenant_id, compra_id, documento, observacao, usuario_id)
  values (v_tenant, c.id, p_documento, p_observacao, auth.uid())
  returning id into v_rec_id;

  for it in select * from jsonb_array_elements(p_itens) loop
    select * into ci from public.compra_itens
      where id = (it->>'compra_item_id')::uuid and compra_id = c.id and tenant_id = v_tenant;
    if ci.id is null then raise exception 'Item da compra não encontrado'; end if;

    v_qtd := coalesce((it->>'quantidade')::numeric, 0);
    if v_qtd <= 0 then continue; end if;
    if ci.quantidade_recebida + v_qtd > ci.quantidade + 0.001 then
      raise exception 'Quantidade recebida maior que a comprada';
    end if;
    v_custo := coalesce((it->>'custo_unitario')::numeric, ci.custo_unitario);

    insert into public.compra_recebimento_itens (tenant_id, recebimento_id, compra_item_id, produto_id,
      quantidade, custo_unitario, divergencia, divergencia_obs)
    values (v_tenant, v_rec_id, ci.id, ci.produto_id, v_qtd, v_custo,
      nullif(it->>'divergencia','')::public.divergencia_tipo, nullif(it->>'divergencia_obs',''));

    if coalesce(it->>'divergencia','') <> 'produto_errado' then
      perform public.registrar_movimentacao(
        p_produto_id => ci.produto_id,
        p_deposito_id => c.deposito_id,
        p_tipo => 'entrada'::public.mov_tipo,
        p_quantidade => v_qtd,
        p_motivo => 'Recebimento de compra',
        p_documento => 'COM-' || c.numero,
        p_deposito_destino_id => null,
        p_custo => nullif(v_custo, 0));
    end if;

    update public.compra_itens set quantidade_recebida = quantidade_recebida + v_qtd where id = ci.id;
    v_valor := v_valor + (v_qtd * v_custo);
  end loop;

  select count(*) into v_pend from public.compra_itens
    where compra_id = c.id and quantidade_recebida < quantidade - 0.001;

  update public.compras set situacao = case when v_pend = 0 then 'recebido'::public.compra_situacao
    else 'parcialmente_recebido'::public.compra_situacao end where id = c.id;

  if p_gerar_conta and v_valor > 0 then
    v_n := greatest(1, coalesce(p_parcelas,1));
    v_parc := round(v_valor / v_n, 2);
    for i in 1..v_n loop
      insert into public.contas_pagar (tenant_id, empresa_id, filial_id, fornecedor_id, compra_id, descricao,
        categoria, parcela, parcelas, vencimento, valor, forma_pagamento)
      values (v_tenant, c.empresa_id, c.filial_id, c.fornecedor_id, c.id,
        'Compra nº ' || c.numero || coalesce(' - NF ' || p_documento, ''), 'Mercadorias',
        i, v_n, coalesce(p_vencimento, current_date) + ((i - 1) * 30),
        case when i = v_n then v_valor - (v_parc * (v_n - 1)) else v_parc end, 'boleto');
    end loop;
  end if;

  return v_rec_id;
end; $function$;

REVOKE ALL ON FUNCTION public.receber_compra(uuid, jsonb, text, text, boolean, date, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.receber_compra(uuid, jsonb, text, text, boolean, date, integer) TO authenticated;