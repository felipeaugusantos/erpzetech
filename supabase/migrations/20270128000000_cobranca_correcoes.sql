-- Correções da cobrança automática (20270124) depois da revisão, em migração própria porque a 20270124 já pode estar aplicada:
-- 1) saas_cobranca_pendentes devolve o SALDO da fatura (valor menos o já pago, por exemplo por baixa parcial manual): o gateway cobra só o que falta;
-- 2) assinatura_situacao desempata o "cliente mais recente" da empresa por created_at (resultado estável quando há mais de um cadastro no mesmo dia).
-- CREATE OR REPLACE com a mesma assinatura: reaplicável.
CREATE OR REPLACE FUNCTION public.saas_cobranca_pendentes(p_limite integer DEFAULT 20)
RETURNS TABLE (
  fatura_id uuid, cliente_id uuid, descricao text, valor numeric, vencimento date,
  cliente_nome text, documento text, email text, whatsapp text, gateway_cliente_id text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT f.id, c.id, f.descricao, (f.valor - f.valor_pago), f.vencimento, c.nome, c.documento, c.email, c.whatsapp, c.gateway_cliente_id
    FROM public.saas_faturas f
    JOIN public.saas_clientes c ON c.id = f.cliente_id
   WHERE c.cobranca_automatica AND c.situacao = 'ativo'
     AND f.gateway_cobranca_id IS NULL AND f.valor > 0 AND f.valor_pago < f.valor
     AND f.vencimento >= current_date - 30
   ORDER BY f.vencimento, f.created_at
   LIMIT least(greatest(coalesce(p_limite, 20), 1), 100)
$fn$;
REVOKE ALL ON FUNCTION public.saas_cobranca_pendentes(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.saas_cobranca_pendentes(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.assinatura_situacao()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  c record; v_adm boolean; v_dias integer; v_aberto numeric; v_lista jsonb;
BEGIN
  IF auth.uid() IS NULL OR public.eh_saas_operador() OR public.eh_contador_restrito() THEN RETURN NULL; END IF;
  SELECT * INTO c FROM public.saas_clientes WHERE tenant_id = public.current_tenant_id() AND cobranca_automatica ORDER BY inicio DESC, created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_adm := public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor');
  SELECT coalesce(max(current_date - f.vencimento), 0), coalesce(sum(f.valor - f.valor_pago), 0)
    INTO v_dias, v_aberto
    FROM public.saas_faturas f WHERE f.cliente_id = c.id AND f.valor_pago < f.valor AND f.vencimento < current_date;
  IF v_adm THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'descricao', f.descricao, 'valor', f.valor - f.valor_pago,
             'vencimento', f.vencimento, 'url', f.gateway_url) ORDER BY f.vencimento), '[]'::jsonb)
      INTO v_lista FROM public.saas_faturas f
     WHERE f.cliente_id = c.id AND f.valor_pago < f.valor AND f.vencimento < current_date + 10;
  ELSE
    v_lista := '[]'::jsonb;
  END IF;
  RETURN jsonb_build_object('bloqueado', c.situacao = 'suspenso', 'em_atraso', v_dias > 0, 'dias_atraso', v_dias,
                            'valor_em_aberto', v_aberto, 'tolerancia_dias', public._saas_tolerancia_dias(), 'faturas', v_lista);
END
$fn$;
REVOKE ALL ON FUNCTION public.assinatura_situacao() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assinatura_situacao() TO authenticated;
