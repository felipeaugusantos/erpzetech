DO $migration$
DECLARE
  definition text := pg_get_functiondef('public.empresa_zerar_dados(text,text)'::regprocedure);
  table_name text;
  fixed_commands text := 'case tab';
  tables text[] := ARRAY['comanda_pagamentos','comanda_itens','comandas','tef_transacoes','pedido_ocorrencias','pedido_historico','pedido_orcamentos','nfe_pedidos','nfe_itens','nfe','entrega_tentativas','entrega_reagendamentos','entrega_itens','entregas','devolucao_itens','devolucoes','comissoes','premiacao_abatimentos','premiacoes','credito_autorizacoes','gestor_autorizacoes','financeiro_baixas','contas_receber','contas_pagar','banco_movimentos','caixa_movimentos','caixas','pedido_itens','pedidos','orcamento_itens','orcamentos','compra_recebimento_itens','compra_recebimentos','compra_cotacao_itens','compra_cotacoes','compra_itens','compras','nfe_entrada_produtos','estoque_lote_movimentos','estoque_lotes','estoque_movimentacoes','inventario_itens','inventarios','transferencia_itens','transferencias','os_itens','os_ordens','locacao_itens','locacoes','obras','cardapio_ficha','cardapio_opcoes','cardapio_grupos','cardapio_itens','cardapio_categorias','estoques','produto_conversoes','produto_variacoes','produtos','categorias','clientes','fornecedores'];
BEGIN
  -- SQL generation occurs only during this migration, never in the callable function.
  FOREACH table_name IN ARRAY tables LOOP
    fixed_commands := fixed_commands || format(E'\n when %L then delete from public.%I where tenant_id = t;', table_name, table_name);
  END LOOP;
  fixed_commands := fixed_commands || E'\n else raise exception ''Tabela de exclusão não autorizada'';\n end case;';
  IF position('execute format(''delete from public.%I where tenant_id = $1'', tab) using t;' in definition) > 0 THEN
    definition := replace(definition, 'execute format(''delete from public.%I where tenant_id = $1'', tab) using t;', fixed_commands);
    definition := replace(definition, 'if _modo not in (''movimentacoes'',''tudo'') then', 'if _modo is null or _modo not in (''movimentacoes'',''tudo'') then');
    EXECUTE definition;
  ELSIF position('Tabela de exclusão não autorizada' in definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected reset definition; no changes applied';
  END IF;
END $migration$;
REVOKE EXECUTE ON FUNCTION public.empresa_zerar_dados(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.empresa_zerar_dados(text,text) TO authenticated;