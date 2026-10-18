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

  -- referências cruzadas (locação <-> nota/conta, profissional -> cliente) impedem a exclusão em qualquer ordem
  update public.locacoes set nfe_id = null, conta_receber_id = null
   where tenant_id = t and (nfe_id is not null or conta_receber_id is not null);
  if _modo = 'tudo' then
    update public.profissionais set cliente_id = null where tenant_id = t and cliente_id is not null;
  end if;

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