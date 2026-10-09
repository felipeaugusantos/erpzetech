-- Modo "simulado" da maquininha: permite testar o fluxo completo de venda no cartão (NSU, autorização,
-- caixa, cancelamento) antes de ligar a ponte real. As transações ficam com credenciadora "simulado" e
-- NSU começando em "SIM-", para nunca se confundirem com as reais na conciliação.
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.tef_config'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%modo%'
  LOOP
    EXECUTE format('ALTER TABLE public.tef_config DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE public.tef_config
  ADD CONSTRAINT tef_config_modo_check CHECK (modo IN ('manual', 'ponte', 'nuvem', 'simulado'));

-- Transações TEF só são gravadas pelas RPCs (SECURITY DEFINER); o cliente apenas lê.
-- Negação explícita: sem isso, um UPDATE direto seria apenas filtrado pela RLS, em silêncio.
REVOKE INSERT, UPDATE, DELETE ON public.tef_transacoes FROM authenticated, anon;

-- Correção: frente_cancelar_venda passava pedidos.forma_pagamento (texto) a caixa_lancar, que espera o enum
-- forma_pagamento; o cancelamento de qualquer venda de balcão com lançamento no caixa falhava.
create or replace function public.frente_cancelar_venda(p_pedido_id uuid, p_autorizacao uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_tenant uuid := public.current_tenant_id(); v_ped record; v_gestor uuid; v_caixa uuid := public.frente_caixa_atual(); i record;
begin
  select * into v_ped from public.pedidos where id = p_pedido_id and tenant_id = v_tenant;
  if v_ped.id is null then raise exception 'Venda não encontrada'; end if;
  if v_ped.situacao = 'cancelado' then raise exception 'Venda já cancelada'; end if;
  if coalesce(v_ped.origem,'') <> 'pdv' then raise exception 'Só vendas de balcão podem ser canceladas aqui'; end if;
  v_gestor := public.consumir_autorizacao(p_autorizacao, 'cancelar_venda');
  for i in select produto_id, quantidade, custo_unitario from public.pedido_itens where pedido_id = p_pedido_id loop
    perform public.registrar_movimentacao(i.produto_id, v_ped.deposito_id, 'entrada'::mov_tipo, i.quantidade,
      'Cancelamento de venda', 'CANC-' || v_ped.numero, null::uuid, i.custo_unitario);
  end loop;
  if exists (select 1 from public.caixa_movimentos where pedido_id = p_pedido_id and tipo = 'venda') then
    perform public.caixa_lancar(coalesce(v_caixa, v_ped.caixa_id), 'saida'::caixa_mov_tipo, v_ped.total,
      'Cancelamento da venda nº ' || v_ped.numero, v_ped.forma_pagamento::forma_pagamento, v_ped.deposito_id, p_pedido_id);
  end if;
  update public.contas_receber set situacao = 'cancelado' where pedido_id = p_pedido_id and situacao in ('aberto','parcial');
  update public.pedidos set situacao = 'cancelado', motivo_cancelamento = coalesce(p_motivo,'Cancelada no caixa'),
    cancelado_por = auth.uid(), autorizado_por = v_gestor where id = p_pedido_id;
  insert into public.pedido_historico (tenant_id, pedido_id, situacao_anterior, situacao_nova, observacao, usuario_id)
  values (v_tenant, p_pedido_id, v_ped.situacao, 'cancelado', 'Cancelada na frente de caixa com senha do gestor', auth.uid());
end $$;
grant execute on function public.frente_cancelar_venda(uuid,uuid,text) to authenticated;
revoke execute on function public.frente_cancelar_venda(uuid,uuid,text) from public, anon;
