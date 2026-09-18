CREATE OR REPLACE FUNCTION public.transferencia_enviar(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_tenant uuid := public.current_tenant_id();
  t public.transferencias;
  it record;
begin
  if v_tenant is null then raise exception 'Usuário sem empresa vinculada'; end if;
  if not (public.has_role(auth.uid(),'administrador') or public.has_role(auth.uid(),'gestor')
          or public.has_role(auth.uid(),'estoquista')) then
    raise exception 'Sem permissão para transferir mercadoria';
  end if;
  select * into t from public.transferencias where id = p_id and tenant_id = v_tenant;
  if t.id is null then raise exception 'Transferência não encontrada'; end if;
  if t.situacao <> 'rascunho' then raise exception 'Só é possível enviar uma transferência em rascunho'; end if;

  for it in select produto_id, sum(quantidade) q from public.transferencia_itens
            where transferencia_id = p_id group by produto_id loop
    perform public.registrar_movimentacao(it.produto_id, t.deposito_origem_id,
      'saida'::mov_tipo, it.q, 'Transferência entre lojas — saída para o depósito de destino',
      'TRANSF-' || t.numero, null, null);
  end loop;

  update public.transferencias
    set situacao = 'em_transito', enviado_em = now(), enviado_por = auth.uid()
  where id = p_id;
end $$;

CREATE OR REPLACE FUNCTION public.transferencia_receber(p_id uuid, p_itens jsonb DEFAULT NULL, p_observacao text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_tenant uuid := public.current_tenant_id();
  t public.transferencias;
  it record;
  v_qtd numeric;
  v_falta numeric;
begin
  if v_tenant is null then raise exception 'Usuário sem empresa vinculada'; end if;
  if not (public.has_role(auth.uid(),'administrador') or public.has_role(auth.uid(),'gestor')
          or public.has_role(auth.uid(),'estoquista')) then
    raise exception 'Sem permissão para receber transferência';
  end if;
  select * into t from public.transferencias where id = p_id and tenant_id = v_tenant;
  if t.id is null then raise exception 'Transferência não encontrada'; end if;
  if t.situacao <> 'em_transito' then raise exception 'Só é possível receber uma transferência em trânsito'; end if;

  if p_itens is not null then
    update public.transferencia_itens i
      set quantidade_recebida = least((x->>'quantidade_recebida')::numeric, i.quantidade)
    from jsonb_array_elements(p_itens) x
    where i.transferencia_id = p_id and i.id = (x->>'id')::uuid;
  end if;

  update public.transferencia_itens set quantidade_recebida = quantidade
   where transferencia_id = p_id and quantidade_recebida is null;

  for it in select id, produto_id, quantidade, quantidade_recebida, custo_unitario
            from public.transferencia_itens where transferencia_id = p_id loop
    v_qtd := coalesce(it.quantidade_recebida, 0);
    if v_qtd > 0 then
      perform public.registrar_movimentacao(it.produto_id, t.deposito_destino_id,
        'entrada'::mov_tipo, v_qtd, 'Recebimento de transferência entre lojas',
        'TRANSF-' || t.numero, null,
        case when it.custo_unitario > 0 then it.custo_unitario else null end);
    end if;
    v_falta := it.quantidade - v_qtd;
    if v_falta > 0 then
      perform public.registrar_movimentacao(it.produto_id, t.deposito_origem_id,
        'entrada'::mov_tipo, v_falta, 'Divergência na transferência: item não recebido no destino',
        'TRANSF-' || t.numero, null,
        case when it.custo_unitario > 0 then it.custo_unitario else null end);
    end if;
  end loop;

  update public.transferencias
    set situacao = 'recebida', recebido_em = now(), recebido_por = auth.uid(),
        observacao = coalesce(nullif(p_observacao,''), observacao),
        valor_total = (select coalesce(sum(coalesce(i.quantidade_recebida, i.quantidade) * i.custo_unitario),0)
                       from public.transferencia_itens i where i.transferencia_id = p_id)
  where id = p_id;
end $$;