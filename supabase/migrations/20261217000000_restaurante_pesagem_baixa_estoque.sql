-- Restaurante: a pesagem tambem baixa os insumos do estoque.
--
-- restaurante_lancar_pesagem grava o item ja como entregue, e a baixa pela ficha tecnica so acontecia ao enviar
-- a comanda a cozinha (restaurante_enviar_cozinha). Item pesado nunca passava por la, entao o estoque ficava
-- acima do real e a falta de saldo nao era conferida. Agora a pesagem chama a mesma baixa, na mesma transacao:
-- a quantidade baixada e o peso liquido em kg x a quantidade da ficha (por kg vendido), com a perda de preparo.
-- A funcao atual e ajustada no lugar; rodar de novo nao faz nada.
DO $$
DECLARE
  def text := pg_get_functiondef('public.restaurante_lancar_pesagem(uuid, uuid, integer, uuid, text)'::regprocedure);
  novo text;
BEGIN
  IF def LIKE '%restaurante_movimentar_insumos%' THEN RETURN; END IF;
  novo := replace(def,
    $q$  PERFORM set_config('restaurante.pesagem', '0', true);$q$,
    $q$  PERFORM set_config('restaurante.pesagem', '0', true);
  PERFORM public.restaurante_movimentar_insumos(ARRAY[v_id], 'saida');$q$);
  IF novo = def THEN RAISE EXCEPTION 'Não foi possível ligar restaurante_lancar_pesagem à baixa de estoque'; END IF;
  EXECUTE novo;
END $$;
