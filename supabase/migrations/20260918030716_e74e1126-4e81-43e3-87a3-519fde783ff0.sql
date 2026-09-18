do $$
declare
  t uuid := '11111111-1111-1111-1111-111111111111';
  e uuid := '22222222-2222-2222-2222-222222222222';
  f uuid := '33333333-3333-3333-3333-333333333333';
  v_orc uuid;
  v_cli uuid;
  v_obra uuid;
begin
  if exists (select 1 from public.orcamentos where tenant_id = t) then return; end if;

  -- Orçamento 1: aprovado
  select id into v_cli from public.clientes where tenant_id = t order by nome limit 1;
  select id into v_obra from public.obras where cliente_id = v_cli limit 1;
  insert into public.orcamentos (tenant_id, empresa_id, filial_id, cliente_id, obra_id, situacao,
    validade, condicao_pagamento, prazo_entrega, frete, observacoes, aprovado_em)
  values (t, e, f, v_cli, v_obra, 'aprovado', current_date + 7, '28 dias', '2 dias úteis', 120,
    'Entrega na obra pela manhã.', now())
  returning id into v_orc;
  insert into public.orcamento_itens (tenant_id, orcamento_id, produto_id, quantidade, unidade, preco_unitario, total)
  select t, v_orc, p.id, q.quantidade, p.unidade, p.preco_venda, q.quantidade * p.preco_venda
  from (values ('CIM001', 50::numeric), ('ARE001', 6), ('ARG001', 20)) q(codigo, quantidade)
  join public.produtos p on p.codigo_interno = q.codigo and p.tenant_id = t;
  perform public.recalcular_orcamento(v_orc);

  -- Orçamento 2: enviado
  select id into v_cli from public.clientes where tenant_id = t order by nome offset 1 limit 1;
  select id into v_obra from public.obras where cliente_id = v_cli limit 1;
  insert into public.orcamentos (tenant_id, empresa_id, filial_id, cliente_id, obra_id, situacao,
    validade, condicao_pagamento, prazo_entrega, desconto)
  values (t, e, f, v_cli, v_obra, 'enviado', current_date + 5, 'PIX à vista', 'Imediato', 80)
  returning id into v_orc;
  insert into public.orcamento_itens (tenant_id, orcamento_id, produto_id, quantidade, unidade, preco_unitario, total)
  select t, v_orc, p.id, q.quantidade, p.unidade, p.preco_venda, q.quantidade * p.preco_venda
  from (values ('POR001', 42::numeric), ('ARG002', 12), ('TIN001', 4)) q(codigo, quantidade)
  join public.produtos p on p.codigo_interno = q.codigo and p.tenant_id = t;
  perform public.recalcular_orcamento(v_orc);

  -- Orçamento 3: em negociação
  select id into v_cli from public.clientes where tenant_id = t order by nome offset 2 limit 1;
  insert into public.orcamentos (tenant_id, empresa_id, filial_id, cliente_id, situacao,
    validade, condicao_pagamento, prazo_entrega)
  values (t, e, f, v_cli, 'em_negociacao', current_date + 10, '30/60 dias', '5 dias úteis')
  returning id into v_orc;
  insert into public.orcamento_itens (tenant_id, orcamento_id, produto_id, quantidade, unidade, preco_unitario, total)
  select t, v_orc, p.id, q.quantidade, p.unidade, p.preco_venda, q.quantidade * p.preco_venda
  from (values ('ELE001', 3::numeric), ('HID001', 10), ('MET001', 2)) q(codigo, quantidade)
  join public.produtos p on p.codigo_interno = q.codigo and p.tenant_id = t;
  perform public.recalcular_orcamento(v_orc);
end $$;
