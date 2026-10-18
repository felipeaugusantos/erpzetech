DROP FUNCTION IF EXISTS public.criar_pedido_direto(uuid, uuid, jsonb, uuid, numeric, numeric, text, date, uuid, uuid, text);

CREATE FUNCTION public.criar_pedido_direto(p_cliente_id uuid, p_deposito_id uuid, p_itens jsonb, p_obra_id uuid DEFAULT NULL, p_desconto numeric DEFAULT 0, p_frete numeric DEFAULT 0, p_condicao_pagamento text DEFAULT NULL, p_previsao_entrega date DEFAULT NULL, p_vendedor_id uuid DEFAULT NULL, p_profissional_id uuid DEFAULT NULL, p_observacoes text DEFAULT NULL, p_rascunho boolean DEFAULT false)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_pedido_id uuid; v_emp uuid; v_fil uuid; it record;
  v_sit public.pedido_situacao := case when p_rascunho then 'rascunho'::public.pedido_situacao else 'aguardando_pagamento'::public.pedido_situacao end;
begin
  PERFORM public.exige_nao_salao();
  if v_tenant is null then raise exception 'Usuário sem empresa vinculada'; end if;
  if not (public.has_role(auth.uid(),'administrador') or public.has_role(auth.uid(),'gestor')
       or public.has_role(auth.uid(),'vendedor') or public.has_role(auth.uid(),'caixa')) then
    raise exception 'Sem permissão para criar pedidos';
  end if;
  if not exists (select 1 from public.clientes where id = p_cliente_id and tenant_id = v_tenant) then
    raise exception 'Cliente não encontrado nesta empresa';
  end if;
  if p_obra_id is not null and not exists (select 1 from public.obras where id = p_obra_id and tenant_id = v_tenant) then
    raise exception 'Obra não encontrada nesta empresa';
  end if;
  if p_vendedor_id is not null and not exists (select 1 from public.profiles where id = p_vendedor_id and tenant_id = v_tenant) then
    raise exception 'Vendedor não encontrado nesta empresa';
  end if;
  if p_profissional_id is not null and not exists (select 1 from public.profissionais where id = p_profissional_id and tenant_id = v_tenant) then
    raise exception 'Profissional não encontrado nesta empresa';
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
    p_profissional_id, p_deposito_id, v_sit, 'direto', p_condicao_pagamento,
    p_previsao_entrega, 0, coalesce(p_desconto,0), coalesce(p_frete,0), 0, p_observacoes)
  returning id into v_pedido_id;

  insert into public.pedido_itens (tenant_id, pedido_id, produto_id, quantidade, unidade, preco_unitario, desconto, total)
  select v_tenant, v_pedido_id, (i->>'produto_id')::uuid, (i->>'quantidade')::numeric,
    coalesce(i->>'unidade', (select unidade from public.produtos where id = (i->>'produto_id')::uuid)),
    (i->>'preco_unitario')::numeric, coalesce((i->>'desconto')::numeric, 0),
    round((i->>'quantidade')::numeric * (i->>'preco_unitario')::numeric - coalesce((i->>'desconto')::numeric,0), 2)
  from jsonb_array_elements(p_itens) i;

  perform public.recalcular_pedido(v_pedido_id);

  if not p_rascunho then
    for it in select produto_id, sum(quantidade) q from public.pedido_itens where pedido_id = v_pedido_id group by produto_id loop
      perform public.registrar_movimentacao_interno(it.produto_id, p_deposito_id, 'reserva'::mov_tipo, it.q,
        'Reserva do pedido', 'PED-' || (select numero from public.pedidos where id = v_pedido_id), null);
    end loop;
    update public.pedidos set estoque_reservado = true where id = v_pedido_id;
  end if;

  insert into public.pedido_historico (tenant_id, pedido_id, situacao_anterior, situacao_nova, observacao, usuario_id)
  values (v_tenant, v_pedido_id, null, v_sit,
    case when p_rascunho then 'Pedido salvo como rascunho, sem reserva de estoque'
         else 'Pedido criado direto no sistema com reserva de estoque' end, auth.uid());
  return v_pedido_id;
end; $function$;
REVOKE ALL ON FUNCTION public.criar_pedido_direto(uuid, uuid, jsonb, uuid, numeric, numeric, text, date, uuid, uuid, text, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.criar_pedido_direto(uuid, uuid, jsonb, uuid, numeric, numeric, text, date, uuid, uuid, text, boolean) TO authenticated;

-- Confirma o rascunho: reserva o estoque e o pedido passa a aguardar pagamento.
CREATE OR REPLACE FUNCTION public.pedido_confirmar_rascunho(p_pedido_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_tenant uuid := public.current_tenant_id(); p public.pedidos; it record;
begin
  perform public.exige_nao_salao();
  perform public.exige_papel(array['administrador','gestor','vendedor','caixa']);
  select * into p from public.pedidos where id = p_pedido_id and tenant_id = v_tenant for update;
  if p.id is null then raise exception 'Pedido não encontrado nesta empresa'; end if;
  if p.situacao <> 'rascunho' then raise exception 'Este pedido não está em rascunho'; end if;
  if not exists (select 1 from public.pedido_itens where pedido_id = p.id) then
    raise exception 'Informe ao menos um item no pedido';
  end if;
  for it in select produto_id, sum(quantidade) q from public.pedido_itens where pedido_id = p.id group by produto_id loop
    perform public.registrar_movimentacao_interno(it.produto_id, p.deposito_id, 'reserva'::mov_tipo, it.q,
      'Reserva do pedido', 'PED-' || p.numero, null);
  end loop;
  update public.pedidos set situacao = 'aguardando_pagamento', estoque_reservado = true where id = p.id;
  insert into public.pedido_historico (tenant_id, pedido_id, situacao_anterior, situacao_nova, observacao, usuario_id)
  values (v_tenant, p.id, 'rascunho', 'aguardando_pagamento', 'Rascunho confirmado com reserva de estoque', auth.uid());
end; $function$;
REVOKE ALL ON FUNCTION public.pedido_confirmar_rascunho(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.pedido_confirmar_rascunho(uuid) TO authenticated;

-- Descarta o rascunho (fica como cancelado no histórico; nada de estoque a devolver).
CREATE OR REPLACE FUNCTION public.pedido_descartar_rascunho(p_pedido_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_tenant uuid := public.current_tenant_id(); p public.pedidos;
begin
  perform public.exige_nao_salao();
  perform public.exige_papel(array['administrador','gestor','vendedor','caixa']);
  select * into p from public.pedidos where id = p_pedido_id and tenant_id = v_tenant for update;
  if p.id is null then raise exception 'Pedido não encontrado nesta empresa'; end if;
  if p.situacao <> 'rascunho' then raise exception 'Este pedido não está em rascunho'; end if;
  update public.pedidos set situacao = 'cancelado', cancelado_por = auth.uid() where id = p.id;
  insert into public.pedido_historico (tenant_id, pedido_id, situacao_anterior, situacao_nova, observacao, usuario_id)
  values (v_tenant, p.id, 'rascunho', 'cancelado', 'Rascunho descartado', auth.uid());
end; $function$;
REVOKE ALL ON FUNCTION public.pedido_descartar_rascunho(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.pedido_descartar_rascunho(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.pedido_alterar(p_pedido_id uuid, p_itens jsonb, p_motivo text, p_desconto numeric DEFAULT NULL::numeric, p_frete numeric DEFAULT NULL::numeric, p_condicao_pagamento text DEFAULT NULL::text, p_previsao_entrega date DEFAULT NULL::date, p_observacoes text DEFAULT NULL::text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := public.current_tenant_id();
  p public.pedidos;
  it record;
  v_motivo text;
begin
  perform public.exige_nao_salao();
  perform public.exige_papel(array['administrador','gestor','vendedor']);
  select * into p from public.pedidos where id = p_pedido_id and tenant_id = v_tenant for update;
  if p.id is null then raise exception 'Pedido não encontrado nesta empresa'; end if;
  if p.situacao not in ('rascunho','aguardando_pagamento','aprovado') then
    raise exception 'Só dá para alterar pedido antes de começar a separação';
  end if;
  v_motivo := nullif(trim(coalesce(p_motivo,'')), '');
  if v_motivo is null and p.situacao <> 'rascunho' then raise exception 'Informe o motivo da alteração'; end if;
  v_motivo := coalesce(v_motivo, 'rascunho editado');
  if p_itens is null or jsonb_array_length(p_itens) = 0 then raise exception 'O pedido precisa de ao menos um item'; end if;
  if exists (select 1 from public.pedido_itens where pedido_id = p.id
             and (quantidade_separada > 0 or quantidade_conferida > 0 or quantidade_entregue > 0)) then
    raise exception 'Pedido já tem itens separados ou entregues';
  end if;
  if exists (select 1 from public.nfe_pedidos np join public.nfe n on n.id = np.nfe_id
             where np.pedido_id = p.id and n.situacao::text <> 'cancelada') then
    raise exception 'Pedido tem NF-e. Cancele ou exclua a nota antes de alterar';
  end if;
  if exists (select 1 from public.contas_receber where pedido_id = p.id
             and situacao <> 'cancelado' and valor_recebido > 0) then
    raise exception 'Pedido já tem pagamento recebido. Estorne o recebimento antes de alterar';
  end if;
  if exists (select 1 from public.pedido_personalizacao where pedido_id = p.id and grade_baixada) then
    raise exception 'A produção deste pedido já começou';
  end if;
  if exists (select 1 from jsonb_array_elements(p_itens) i
             where coalesce((i->>'quantidade')::numeric,0) <= 0 or coalesce((i->>'preco_unitario')::numeric,-1) < 0
                or not exists (select 1 from public.produtos pr where pr.id = (i->>'produto_id')::uuid and pr.tenant_id = v_tenant)) then
    raise exception 'Confira os itens: produto, quantidade e preço';
  end if;

  if p.estoque_reservado then
    for it in select produto_id, sum(quantidade) q from public.pedido_itens where pedido_id = p.id group by produto_id loop
      perform public.registrar_movimentacao_interno(it.produto_id, p.deposito_id, 'liberacao_reserva'::mov_tipo, it.q,
        'Alteração do pedido', 'PED-' || p.numero, null);
    end loop;
  end if;

  delete from public.pedido_itens where pedido_id = p.id;
  insert into public.pedido_itens (tenant_id, pedido_id, produto_id, quantidade, unidade, preco_unitario, desconto, total)
  select v_tenant, p.id, (i->>'produto_id')::uuid, (i->>'quantidade')::numeric,
    coalesce(i->>'unidade', (select unidade from public.produtos where id = (i->>'produto_id')::uuid)),
    (i->>'preco_unitario')::numeric, coalesce((i->>'desconto')::numeric,0),
    round((i->>'quantidade')::numeric * (i->>'preco_unitario')::numeric - coalesce((i->>'desconto')::numeric,0), 2)
  from jsonb_array_elements(p_itens) i;

  update public.pedidos set
    desconto = coalesce(p_desconto, desconto), frete = coalesce(p_frete, frete),
    condicao_pagamento = coalesce(p_condicao_pagamento, condicao_pagamento),
    previsao_entrega = coalesce(p_previsao_entrega, previsao_entrega),
    observacoes = coalesce(p_observacoes, observacoes)
  where id = p.id;
  perform public.recalcular_pedido(p.id);

  if p.situacao <> 'rascunho' then
    for it in select produto_id, sum(quantidade) q from public.pedido_itens where pedido_id = p.id group by produto_id loop
      perform public.registrar_movimentacao_interno(it.produto_id, p.deposito_id, 'reserva'::mov_tipo, it.q,
        'Reserva do pedido alterado', 'PED-' || p.numero, null);
    end loop;
    update public.pedidos set estoque_reservado = true where id = p.id;
  end if;

  update public.contas_receber set situacao = 'cancelado', motivo_cancelamento = 'Pedido alterado: ' || v_motivo
  where pedido_id = p.id and situacao <> 'cancelado' and coalesce(valor_recebido,0) = 0;

  insert into public.pedido_historico (tenant_id, pedido_id, situacao_anterior, situacao_nova, observacao, usuario_id)
  values (v_tenant, p.id, p.situacao, p.situacao, 'Pedido alterado: ' || v_motivo, auth.uid());
end; $function$;