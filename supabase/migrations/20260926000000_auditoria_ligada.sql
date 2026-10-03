-- Fase 0 (roadmap, Rodada 6): auditoria ligada.
--
-- Registra em `auditoria` quem alterou preço, desconto, frete e custo. Gravação feita por trigger
-- SECURITY DEFINER (o cliente não grava em `auditoria`). Só os campos que mudaram entram no registro.
--
-- Estoque: a quantidade já é auditada pelas movimentações (`estoque_movimentacoes`, imutáveis).
-- Para não haver alteração de saldo fora delas, o cliente passa a poder atualizar em `estoques`
-- apenas custo médio e localização; saldo e reserva só mudam pelas RPCs. A criação direta de uma
-- linha de estoque com saldo diferente de zero também é auditada.

CREATE OR REPLACE FUNCTION public.auditar_campos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_ant jsonb := '{}'::jsonb;
  v_nov jsonb := '{}'::jsonb;
  v_col text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF TG_TABLE_NAME = 'estoques' AND NEW.quantidade <> 0 THEN
      INSERT INTO public.auditoria (tenant_id, usuario_id, entidade, entidade_id, operacao, valor_novo)
      VALUES (NEW.tenant_id, auth.uid(), TG_TABLE_NAME, NEW.id, 'insert',
              jsonb_build_object('quantidade', NEW.quantidade, 'custo_medio', NEW.custo_medio));
    END IF;
    RETURN NEW;
  END IF;

  v_old := to_jsonb(OLD);
  v_new := to_jsonb(NEW);
  FOREACH v_col IN ARRAY TG_ARGV LOOP
    IF v_old -> v_col IS DISTINCT FROM v_new -> v_col THEN
      v_ant := v_ant || jsonb_build_object(v_col, v_old -> v_col);
      v_nov := v_nov || jsonb_build_object(v_col, v_new -> v_col);
    END IF;
  END LOOP;

  IF v_nov <> '{}'::jsonb THEN
    INSERT INTO public.auditoria (tenant_id, usuario_id, entidade, entidade_id, operacao, valor_anterior, valor_novo)
    VALUES (NEW.tenant_id, auth.uid(), TG_TABLE_NAME, NEW.id, 'update', v_ant, v_nov);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.auditar_campos() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_auditar_produtos ON public.produtos;
CREATE TRIGGER trg_auditar_produtos
  AFTER UPDATE ON public.produtos
  FOR EACH ROW EXECUTE FUNCTION public.auditar_campos('preco_venda', 'custo');

DROP TRIGGER IF EXISTS trg_auditar_pedidos ON public.pedidos;
CREATE TRIGGER trg_auditar_pedidos
  AFTER UPDATE ON public.pedidos
  FOR EACH ROW EXECUTE FUNCTION public.auditar_campos('desconto', 'frete');

DROP TRIGGER IF EXISTS trg_auditar_pedido_itens ON public.pedido_itens;
CREATE TRIGGER trg_auditar_pedido_itens
  AFTER UPDATE ON public.pedido_itens
  FOR EACH ROW EXECUTE FUNCTION public.auditar_campos('preco_unitario', 'desconto', 'quantidade');

DROP TRIGGER IF EXISTS trg_auditar_orcamentos ON public.orcamentos;
CREATE TRIGGER trg_auditar_orcamentos
  AFTER UPDATE ON public.orcamentos
  FOR EACH ROW EXECUTE FUNCTION public.auditar_campos('desconto', 'frete');

DROP TRIGGER IF EXISTS trg_auditar_orcamento_itens ON public.orcamento_itens;
CREATE TRIGGER trg_auditar_orcamento_itens
  AFTER UPDATE ON public.orcamento_itens
  FOR EACH ROW EXECUTE FUNCTION public.auditar_campos('preco_unitario', 'desconto', 'quantidade');

DROP TRIGGER IF EXISTS trg_auditar_estoques_upd ON public.estoques;
CREATE TRIGGER trg_auditar_estoques_upd
  AFTER UPDATE ON public.estoques
  FOR EACH ROW EXECUTE FUNCTION public.auditar_campos('custo_medio');

DROP TRIGGER IF EXISTS trg_auditar_estoques_ins ON public.estoques;
CREATE TRIGGER trg_auditar_estoques_ins
  AFTER INSERT ON public.estoques
  FOR EACH ROW EXECUTE FUNCTION public.auditar_campos();

-- Saldo e reserva só mudam pelas RPCs (SECURITY DEFINER); o cliente atualiza custo e localização.
REVOKE UPDATE ON public.estoques FROM authenticated;
GRANT UPDATE (custo_medio, localizacao) ON public.estoques TO authenticated;
