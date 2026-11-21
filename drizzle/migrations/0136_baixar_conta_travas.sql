-- Baixa de conta (movimenta dinheiro): além do papel exigido, passa a ter as mesmas travas das demais funções do financeiro
-- (contador e perfil restrito do salão nunca baixam conta, mesmo que ganhem um papel financeiro por engano). Só acrescenta as
-- duas travas; a regra de papel, a checagem do caixa da empresa e as permissões da função continuam iguais à migração 0129.
CREATE OR REPLACE FUNCTION public.baixar_conta(p_tipo text, p_conta_id uuid, p_valor numeric, p_forma forma_pagamento, p_data date DEFAULT NULL::date, p_observacao text DEFAULT NULL::text, p_caixa_id uuid DEFAULT NULL::uuid)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.exige_nao_contador();
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador','gestor','financeiro']);
  IF p_caixa_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.caixas WHERE id = p_caixa_id AND tenant_id = public.current_tenant_id()
  ) THEN
    RAISE EXCEPTION 'Caixa não encontrado.';
  END IF;
  RETURN public._baixar_conta_interno(p_tipo, p_conta_id, p_valor, p_forma, p_data, p_observacao, p_caixa_id);
END $function$;
