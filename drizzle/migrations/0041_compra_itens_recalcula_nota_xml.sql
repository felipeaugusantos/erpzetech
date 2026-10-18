CREATE OR REPLACE FUNCTION public.compra_itens_recalcula()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_compra uuid := coalesce(NEW.compra_id, OLD.compra_id);
  v_sub numeric;
BEGIN
  SELECT coalesce(sum(total), 0) INTO v_sub FROM public.compra_itens WHERE compra_id = v_compra;
  -- nota importada com total da NF-e: o custo dos itens já inclui frete e desconto, o total é o da nota
  UPDATE public.compras SET subtotal = v_sub,
         total = CASE WHEN origem = 'xml_nfe' AND nfe_impostos ? 'total_nota'
                       AND nullif(nfe_impostos->>'total_nota','') IS NOT NULL
                      THEN (nfe_impostos->>'total_nota')::numeric
                      ELSE GREATEST(0, v_sub - desconto + frete) END
   WHERE id = v_compra;
  RETURN NULL;
END $function$;