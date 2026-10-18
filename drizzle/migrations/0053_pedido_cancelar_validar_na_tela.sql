drop trigger if exists pedido_cancelar_validar_trg on public.pedidos;
comment on function public.pedido_cancelar_validar() is 'DEPRECATED: validação movida para pedido_avancar_status (o PDV e a devolução cancelam com estorno próprio)';

create or replace function public.pedido_avancar_status(p_pedido_id uuid, p_situacao pedido_situacao, p_observacao text default null)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_tenant uuid := public.current_tenant_id();
begin
  perform public.exige_nao_salao();
  perform public.exige_papel(case p_situacao::text
       when 'separacao' then array['administrador','gestor','estoquista']
       when 'separado' then array['administrador','gestor','estoquista']
       when 'conferencia' then array['administrador','gestor','estoquista']
       when 'pronto_entrega' then array['administrador','gestor','estoquista']
       when 'em_rota' then array['administrador','gestor','logistica']
       when 'entregue' then array['administrador','gestor','logistica']
       else array['administrador','gestor'] end);
  if p_situacao = 'cancelado' then
    if not exists (select 1 from public.pedidos where id = p_pedido_id and tenant_id = v_tenant) then
      raise exception 'Pedido não encontrado nesta empresa';
    end if;
    if coalesce(trim(p_observacao),'') = '' then raise exception 'Informe o motivo do cancelamento'; end if;
    if exists (select 1 from public.contas_receber where pedido_id = p_pedido_id
               and situacao <> 'cancelado' and coalesce(valor_recebido,0) > 0) then
      raise exception 'Pedido tem pagamento recebido. Estorne o recebimento antes de cancelar';
    end if;
    if exists (select 1 from public.nfe_pedidos np join public.nfe n on n.id = np.nfe_id
               where np.pedido_id = p_pedido_id and n.situacao::text = 'autorizada') then
      raise exception 'Pedido tem NF-e autorizada. Cancele a nota antes de cancelar o pedido';
    end if;
  end if;
  perform public.pedido_avancar_status_interno(p_pedido_id, p_situacao, p_observacao);
  if p_situacao = 'cancelado' then
    update public.contas_receber set situacao = 'cancelado', motivo_cancelamento = 'Pedido cancelado: ' || trim(p_observacao)
    where pedido_id = p_pedido_id and situacao <> 'cancelado';
    update public.pedidos set cancelado_por = auth.uid() where id = p_pedido_id and cancelado_por is null;
  end if;
end $function$;