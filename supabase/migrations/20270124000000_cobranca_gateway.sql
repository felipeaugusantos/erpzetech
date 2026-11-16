-- Cobrança automática das mensalidades pelo gateway (Asaas): a fatura continua nascendo no sistema (saas_faturas, fonte da verdade);
-- o servidor cria a cobrança no gateway, o gateway avisa o pagamento por webhook e a baixa é automática. Quem está com fatura
-- vencida além da tolerância é suspenso e volta sozinho ao pagar. Só vale para o cliente com `cobranca_automatica` ligada pela equipe;
-- os demais seguem como hoje (cobrança manual). As funções saas_cobranca_* e saas_inadimplencia_rodar só o serviço executa.
ALTER TABLE public.saas_clientes
  ADD COLUMN IF NOT EXISTS cobranca_automatica boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gateway_cliente_id text,
  ADD COLUMN IF NOT EXISTS suspenso_automaticamente boolean NOT NULL DEFAULT false;
ALTER TABLE public.saas_faturas
  ADD COLUMN IF NOT EXISTS gateway_cobranca_id text,
  ADD COLUMN IF NOT EXISTS gateway_url text,
  ADD COLUMN IF NOT EXISTS gateway_status text,
  ADD COLUMN IF NOT EXISTS gateway_evento_em timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS saas_faturas_gateway_uq ON public.saas_faturas (gateway_cobranca_id) WHERE gateway_cobranca_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS saas_clientes_gateway_uq ON public.saas_clientes (gateway_cliente_id) WHERE gateway_cliente_id IS NOT NULL;

-- Dias de tolerância depois do vencimento antes de suspender (uma só regra, no banco).
CREATE OR REPLACE FUNCTION public._saas_tolerancia_dias() RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 10 $$;
REVOKE ALL ON FUNCTION public._saas_tolerancia_dias() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._saas_tolerancia_dias() TO service_role;

-- Suspende quem passou da tolerância e reativa quem quitou (só os suspensos POR ESTA ROTINA; suspensão manual da equipe não é desfeita).
-- Com p_cliente, só reavalia aquele cliente (usado logo depois de uma baixa, para o acesso voltar na hora).
CREATE OR REPLACE FUNCTION public.saas_inadimplencia_rodar(p_cliente uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_susp integer; v_reat integer;
BEGIN
  WITH s AS (
    UPDATE public.saas_clientes c
       SET situacao = 'suspenso', suspenso_automaticamente = true
     WHERE c.cobranca_automatica AND c.situacao = 'ativo' AND (p_cliente IS NULL OR c.id = p_cliente)
       AND EXISTS (SELECT 1 FROM public.saas_faturas f
                    WHERE f.cliente_id = c.id AND f.valor_pago < f.valor
                      AND f.vencimento < current_date - public._saas_tolerancia_dias())
    RETURNING 1)
  SELECT count(*) INTO v_susp FROM s;
  WITH r AS (
    UPDATE public.saas_clientes c
       SET situacao = 'ativo', suspenso_automaticamente = false
     WHERE c.cobranca_automatica AND c.situacao = 'suspenso' AND c.suspenso_automaticamente AND (p_cliente IS NULL OR c.id = p_cliente)
       AND NOT EXISTS (SELECT 1 FROM public.saas_faturas f
                        WHERE f.cliente_id = c.id AND f.valor_pago < f.valor
                          AND f.vencimento < current_date - public._saas_tolerancia_dias())
    RETURNING 1)
  SELECT count(*) INTO v_reat FROM r;
  RETURN jsonb_build_object('suspensos', v_susp, 'reativados', v_reat);
END
$fn$;
REVOKE ALL ON FUNCTION public.saas_inadimplencia_rodar(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.saas_inadimplencia_rodar(uuid) TO service_role;

-- Gera as faturas do mês só dos clientes ativos com cobrança automática (mesma regra e mesmas chaves de saas_gerar_faturas: não duplica).
CREATE OR REPLACE FUNCTION public.saas_gerar_faturas_auto() RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_cli record; v_plano record;
  v_comp date := date_trunc('month', current_date)::date;
  v_venc date; v_criadas integer := 0;
BEGIN
  FOR v_cli IN SELECT * FROM public.saas_clientes WHERE cobranca_automatica AND situacao = 'ativo' LOOP
    SELECT * INTO v_plano FROM public.saas_planos WHERE id = v_cli.plano_id;
    IF v_plano IS NULL THEN CONTINUE; END IF;
    v_venc := v_comp + (LEAST(GREATEST(v_cli.dia_vencimento, 1), 28) - 1);
    IF v_plano.valor_mensal > 0 AND NOT EXISTS (
      SELECT 1 FROM public.saas_faturas WHERE cliente_id = v_cli.id AND competencia = v_comp AND tipo = 'mensalidade') THEN
      INSERT INTO public.saas_faturas (cliente_id, competencia, descricao, tipo, valor, vencimento)
      VALUES (v_cli.id, v_comp, 'Mensalidade plano ' || v_plano.nome, 'mensalidade', v_plano.valor_mensal, v_venc);
      v_criadas := v_criadas + 1;
    END IF;
    IF v_cli.filiais_extras > 0 AND v_plano.valor_filial_extra > 0 AND NOT EXISTS (
      SELECT 1 FROM public.saas_faturas WHERE cliente_id = v_cli.id AND competencia = v_comp AND tipo = 'filial_extra') THEN
      INSERT INTO public.saas_faturas (cliente_id, competencia, descricao, tipo, valor, vencimento)
      VALUES (v_cli.id, v_comp, v_cli.filiais_extras || ' filial(is) extra(s)', 'filial_extra',
              v_cli.filiais_extras * v_plano.valor_filial_extra, v_venc);
      v_criadas := v_criadas + 1;
    END IF;
  END LOOP;
  RETURN v_criadas;
END
$fn$;
REVOKE ALL ON FUNCTION public.saas_gerar_faturas_auto() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.saas_gerar_faturas_auto() TO service_role;

-- Faturas em aberto, ainda sem cobrança no gateway, de clientes ativos com cobrança automática (não cobra de novo o que passou de 30 dias de atraso).
-- `valor` é o SALDO (valor da fatura menos o que já foi pago, por exemplo por baixa parcial manual): o gateway cobra só o que falta.
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

-- Guarda o id do cliente no gateway (só se ainda não tiver). Devolve o id que vale.
CREATE OR REPLACE FUNCTION public.saas_cobranca_vincular_cliente(p_cliente uuid, p_gateway_id text) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v text;
BEGIN
  IF coalesce(p_gateway_id, '') = '' THEN RAISE EXCEPTION 'Id do gateway ausente'; END IF;
  UPDATE public.saas_clientes SET gateway_cliente_id = p_gateway_id WHERE id = p_cliente AND gateway_cliente_id IS NULL;
  SELECT gateway_cliente_id INTO v FROM public.saas_clientes WHERE id = p_cliente;
  IF v IS NULL THEN RAISE EXCEPTION 'Cliente não encontrado'; END IF;
  RETURN v;
END
$fn$;
REVOKE ALL ON FUNCTION public.saas_cobranca_vincular_cliente(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.saas_cobranca_vincular_cliente(uuid, text) TO service_role;

-- Guarda a cobrança do gateway na fatura (uma vez; repetir com o mesmo id é seguro e outro id é recusado).
CREATE OR REPLACE FUNCTION public.saas_cobranca_vincular_fatura(p_fatura uuid, p_gateway_id text, p_url text, p_boleto_url text, p_status text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_atual text;
BEGIN
  IF coalesce(p_gateway_id, '') = '' THEN RAISE EXCEPTION 'Id do gateway ausente'; END IF;
  SELECT gateway_cobranca_id INTO v_atual FROM public.saas_faturas WHERE id = p_fatura FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fatura não encontrada'; END IF;
  IF v_atual IS NOT NULL THEN RETURN v_atual = p_gateway_id; END IF;
  UPDATE public.saas_faturas
     SET gateway_cobranca_id = p_gateway_id, gateway_url = left(p_url, 500), boleto_url = coalesce(left(p_boleto_url, 500), boleto_url),
         gateway_status = left(p_status, 40), forma_cobranca = coalesce(forma_cobranca, 'gateway')
   WHERE id = p_fatura;
  RETURN true;
END
$fn$;
REVOKE ALL ON FUNCTION public.saas_cobranca_vincular_fatura(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.saas_cobranca_vincular_fatura(uuid, text, text, text, text) TO service_role;

-- Aplica um evento do gateway: 'baixar' (pago), 'estornar' (devolvido ou contestado) ou 'status' (só anota). Idempotente: repetir não muda nada.
-- Depois de baixar ou estornar, reavalia a suspensão do cliente na hora.
CREATE OR REPLACE FUNCTION public.saas_cobranca_evento(p_gateway_id text, p_acao text, p_valor numeric, p_forma text, p_data date, p_status text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE f record; v_res text;
BEGIN
  IF p_acao NOT IN ('baixar', 'estornar', 'status') THEN RAISE EXCEPTION 'Ação inválida'; END IF;
  SELECT * INTO f FROM public.saas_faturas WHERE gateway_cobranca_id = p_gateway_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'desconhecida'; END IF;
  IF p_acao = 'baixar' THEN
    IF coalesce(p_valor, 0) <= 0 THEN RAISE EXCEPTION 'Valor pago inválido'; END IF;
    UPDATE public.saas_faturas
       SET valor_pago = valor, pago_em = coalesce(pago_em, p_data, current_date),
           forma_pagamento = coalesce(forma_pagamento, p_forma), gateway_status = left(p_status, 40), gateway_evento_em = clock_timestamp()
     WHERE id = f.id;
    v_res := CASE WHEN f.valor_pago >= f.valor THEN 'ja_baixada' ELSE 'baixada' END;
  ELSIF p_acao = 'estornar' THEN
    UPDATE public.saas_faturas
       SET valor_pago = 0, pago_em = NULL, forma_pagamento = NULL, gateway_status = left(p_status, 40), gateway_evento_em = clock_timestamp()
     WHERE id = f.id;
    v_res := CASE WHEN f.valor_pago > 0 THEN 'estornada' ELSE 'ja_estornada' END;
  ELSE
    UPDATE public.saas_faturas SET gateway_status = left(p_status, 40), gateway_evento_em = clock_timestamp() WHERE id = f.id;
    v_res := 'status';
  END IF;
  IF p_acao IN ('baixar', 'estornar') THEN PERFORM public.saas_inadimplencia_rodar(f.cliente_id); END IF;
  RETURN v_res;
END
$fn$;
REVOKE ALL ON FUNCTION public.saas_cobranca_evento(text, text, numeric, text, date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.saas_cobranca_evento(text, text, numeric, text, date, text) TO service_role;

-- Situação da assinatura para a empresa logada (menu e bloqueio). Devolve NULL quando não há nada a mostrar: sem sessão, equipe EZRA,
-- contador ou cliente sem cobrança automática. A lista de faturas (com o link de pagamento) só vai para administrador e gestor.
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
