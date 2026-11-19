DO $$
DECLARE v_def text; r record;
BEGIN
  v_def := pg_get_functiondef('public.baixar_conta(text,uuid,numeric,forma_pagamento,date,text,uuid)'::regprocedure);
  v_def := replace(v_def, 'FUNCTION public.baixar_conta(', 'FUNCTION public._baixar_conta_interno(');
  EXECUTE v_def;
  FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname IN ('pedido_checkout','premiacao_abater_conta') LOOP
    EXECUTE replace(pg_get_functiondef(r.oid), 'public.baixar_conta(', 'public._baixar_conta_interno(');
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public._baixar_conta_interno(text,uuid,numeric,forma_pagamento,date,text,uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.baixar_conta(p_tipo text, p_conta_id uuid, p_valor numeric, p_forma forma_pagamento, p_data date DEFAULT NULL::date, p_observacao text DEFAULT NULL::text, p_caixa_id uuid DEFAULT NULL::uuid)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.exige_papel(ARRAY['administrador','gestor','financeiro']);
  RETURN public._baixar_conta_interno(p_tipo, p_conta_id, p_valor, p_forma, p_data, p_observacao, p_caixa_id);
END $function$;

REVOKE ALL ON FUNCTION public.atualizar_custo_medio(uuid,uuid,numeric,numeric) FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS premiacoes_insert ON public.premiacoes;
CREATE POLICY premiacoes_insert ON public.premiacoes FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'administrador'::app_role) OR public.has_role(auth.uid(), 'gestor'::app_role)));