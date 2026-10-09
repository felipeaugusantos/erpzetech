-- Complementa 20260926000000: o cliente também não cria linha de estoque com saldo ou reserva.
-- Antes, quem tinha permissão de inserir em `estoques` podia semear `quantidade`/`reservado`
-- arbitrários sem nenhuma movimentação. Agora o INSERT direto só aceita as colunas de cadastro;
-- saldo e reserva nascem com o padrão (zero) e só mudam pelas RPCs SECURITY DEFINER.
REVOKE INSERT ON public.estoques FROM authenticated;
GRANT INSERT (tenant_id, produto_id, deposito_id, custo_medio, localizacao)
  ON public.estoques TO authenticated;
