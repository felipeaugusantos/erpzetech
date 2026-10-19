-- Base do módulo Pet shop: produto que é serviço (banho, tosa, consulta) não controla estoque.
-- A isenção fica no ponto único por onde todo movimento de estoque passa (registrar_movimentacao_interno): venda, cancelamento,
-- devolução, reserva e importação de saldo ignoram o produto marcado, sem saldo e sem erro de estoque insuficiente.

ALTER TABLE public.produtos ADD COLUMN IF NOT EXISTS controla_estoque boolean NOT NULL DEFAULT true;

DO $$
DECLARE
  def text;
  nova text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'registrar_movimentacao_interno';
  IF def IS NULL THEN RAISE EXCEPTION 'registrar_movimentacao_interno não encontrada'; END IF;
  IF position('controla_estoque' IN def) > 0 THEN RETURN; END IF;
  nova := replace(def,
    E'  if p_quantidade is null or p_quantidade <= 0 then raise exception ''Informe uma quantidade maior que zero''; end if;\n',
    E'  if p_quantidade is null or p_quantidade <= 0 then raise exception ''Informe uma quantidade maior que zero''; end if;\n'
    || E'  -- serviço (controla_estoque = false): não há saldo nem movimento\n'
    || E'  if exists (select 1 from public.produtos px where px.id = p_produto_id and px.tenant_id = v_tenant and not px.controla_estoque) then\n'
    || E'    return null;\n'
    || E'  end if;\n');
  IF nova = def THEN RAISE EXCEPTION 'registrar_movimentacao_interno: trecho esperado não encontrado'; END IF;
  EXECUTE nova;
END $$;
