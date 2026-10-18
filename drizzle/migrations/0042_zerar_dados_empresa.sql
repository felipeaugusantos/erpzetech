CREATE OR REPLACE FUNCTION public.zerar_liberado(_tenant text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  select coalesce(current_setting('app.zerar_tenant', true), '') <> ''
     and current_setting('app.zerar_tenant', true) = _tenant
$$;

CREATE OR REPLACE FUNCTION public.block_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
begin
  if tg_op = 'DELETE' and public.zerar_liberado(to_jsonb(old)->>'tenant_id') then
    return old;
  end if;
  raise exception 'Registros de entrega não podem ser excluídos';
end $$;

CREATE OR REPLACE FUNCTION public.block_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
begin
  if tg_op = 'DELETE' and public.zerar_liberado(to_jsonb(old)->>'tenant_id') then
    return old;
  end if;
  raise exception 'Movimentações de estoque não podem ser alteradas ou excluídas';
end $$;

CREATE OR REPLACE FUNCTION public.empresa_zerar_dados(_modo text, _confirmacao text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare
  t uuid := public.current_tenant_id();
  movs text[] := array['comanda_pagamentos','comanda_itens','comandas','tef_transacoes',
    'pedido_ocorrencias','pedido_historico','pedido_orcamentos','nfe_pedidos','nfe_itens','nfe',
    'entrega_tentativas','entrega_reagendamentos','entrega_itens','entregas',
    'devolucao_itens','devolucoes','comissoes','premiacao_abatimentos','premiacoes',
    'credito_autorizacoes','gestor_autorizacoes','financeiro_baixas','contas_receber','contas_pagar',
    'banco_movimentos','caixa_movimentos','caixas',
    'pedido_itens','pedidos','orcamento_itens','orcamentos',
    'compra_recebimento_itens','compra_recebimentos','compra_cotacao_itens','compra_cotacoes',
    'compra_itens','compras','nfe_entrada_produtos',
    'estoque_lote_movimentos','estoque_lotes','estoque_movimentacoes',
    'inventario_itens','inventarios','transferencia_itens','transferencias',
    'os_itens','os_ordens','locacao_itens','locacoes','obras'];
  cads text[] := array['cardapio_ficha','cardapio_opcoes','cardapio_grupos','cardapio_itens','cardapio_categorias',
    'estoques','produto_conversoes','produto_variacoes','produtos','categorias','clientes','fornecedores'];
  lista text[];
  restantes text[];
  tab text;
  n bigint;
  total bigint := 0;
  progresso boolean;
begin
  if t is null or not public.has_role(auth.uid(), 'administrador') then
    raise exception 'Somente o administrador pode zerar os dados da empresa';
  end if;
  if _confirmacao is distinct from 'ZERAR TUDO' then
    raise exception 'Digite ZERAR TUDO para confirmar';
  end if;
  if _modo not in ('movimentacoes','tudo') then
    raise exception 'Modo inválido';
  end if;

  perform set_config('app.zerar_tenant', t::text, true);
  lista := movs || case when _modo = 'tudo' then cads else array[]::text[] end;
  restantes := lista;

  loop
    progresso := false;
    lista := restantes;
    restantes := array[]::text[];
    foreach tab in array lista loop
      begin
        execute format('delete from public.%I where tenant_id = $1', tab) using t;
        get diagnostics n = row_count;
        total := total + n;
        progresso := true;
      exception when foreign_key_violation then
        restantes := restantes || tab;
      end;
    end loop;
    exit when cardinality(restantes) = 0;
    if not progresso then
      raise exception 'Não foi possível apagar: %', array_to_string(restantes, ', ');
    end if;
  end loop;

  if _modo = 'movimentacoes' then
    update public.estoques set quantidade = 0, reservado = 0, custo_medio = 0, updated_at = now()
     where tenant_id = t;
  end if;

  perform set_config('app.zerar_tenant', '', true);

  insert into public.auditoria (tenant_id, usuario_id, entidade, entidade_id, operacao, valor_novo)
  values (t, auth.uid(), 'empresa', t, 'zerar_dados', jsonb_build_object('modo', _modo, 'registros', total));

  return jsonb_build_object('modo', _modo, 'registros', total);
end $$;

REVOKE ALL ON FUNCTION public.empresa_zerar_dados(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.empresa_zerar_dados(text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.zerar_liberado(text) FROM public, anon;