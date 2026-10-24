-- Cobrança por boleto e Pix com baixa automática (base independente de provedor; o primeiro provedor previsto é a Asaas).
-- Fluxo: a tela pede ao provedor um boleto ou Pix para uma conta a receber, guarda o resultado em `cobrancas` e,
-- quando o provedor avisa o pagamento (webhook), `cobranca_evento` dá a baixa na conta uma única vez.
-- Segredos (chave da API e token do webhook) ficam só no servidor: o navegador nunca lê `cobranca_config`.

-- ===== 1. Configuração por empresa (tenant) =====
CREATE TABLE IF NOT EXISTS public.cobranca_config (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants (id) ON DELETE CASCADE,
  provedor text NOT NULL DEFAULT 'asaas' CHECK (provedor IN ('asaas')),
  ambiente text NOT NULL DEFAULT 'sandbox' CHECK (ambiente IN ('sandbox', 'producao')),
  api_key text,
  -- só o hash do token do webhook fica guardado; o token aparece uma vez, ao ser gerado
  webhook_token_hash text UNIQUE,
  ativo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cobranca_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cobranca_config FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.cobranca_config TO service_role;
CREATE POLICY salao_restrito ON public.cobranca_config AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT NOT public.eh_salao_restrito()));

-- ===== 2. Cobranças =====
CREATE TABLE IF NOT EXISTS public.cobrancas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  conta_receber_id uuid NOT NULL REFERENCES public.contas_receber (id) ON DELETE CASCADE,
  provedor text NOT NULL CHECK (provedor IN ('asaas')),
  provedor_id text NOT NULL CHECK (btrim(provedor_id) <> ''),
  tipo text NOT NULL CHECK (tipo IN ('boleto', 'pix')),
  situacao text NOT NULL DEFAULT 'pendente' CHECK (situacao IN ('pendente', 'paga', 'vencida', 'cancelada')),
  valor numeric(14,2) NOT NULL CHECK (valor > 0),
  vencimento date NOT NULL,
  linha_digitavel text,
  codigo_barras text,
  url_boleto text,
  pix_copia_cola text,
  valor_pago numeric(14,2),
  pago_em date,
  baixa_id uuid REFERENCES public.financeiro_baixas (id) ON DELETE SET NULL,
  -- algo que pede conferência de uma pessoa (ex.: pagamento estornado no provedor depois da baixa)
  alerta text,
  criada_por uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provedor, provedor_id)
);
-- uma cobrança em aberto por conta e tipo
CREATE UNIQUE INDEX IF NOT EXISTS cobrancas_conta_aberta_uk ON public.cobrancas (conta_receber_id, tipo)
  WHERE situacao IN ('pendente', 'vencida');
CREATE INDEX IF NOT EXISTS cobrancas_conta_idx ON public.cobrancas (tenant_id, conta_receber_id);
ALTER TABLE public.cobrancas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cobrancas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cobrancas TO authenticated;
GRANT ALL ON public.cobrancas TO service_role;
CREATE POLICY cobrancas_leitura ON public.cobrancas FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY salao_restrito ON public.cobrancas AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT NOT public.eh_salao_restrito()));

CREATE OR REPLACE FUNCTION public.cobrancas_atualizado_em() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cobrancas_atualizado_em ON public.cobrancas;
CREATE TRIGGER cobrancas_atualizado_em BEFORE UPDATE ON public.cobrancas
  FOR EACH ROW EXECUTE FUNCTION public.cobrancas_atualizado_em();

-- ===== 3. Configuração: telas leem e gravam só por estas funções =====
CREATE OR REPLACE FUNCTION public.cobranca_config_obter()
RETURNS TABLE (provedor text, ambiente text, api_key_configurada boolean, webhook_configurado boolean, ativo boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  RETURN QUERY
    SELECT c.provedor, c.ambiente, coalesce(c.api_key, '') <> '', c.webhook_token_hash IS NOT NULL, c.ativo
      FROM public.cobranca_config c
     WHERE c.tenant_id = public.current_tenant_id();
END $$;
REVOKE ALL ON FUNCTION public.cobranca_config_obter() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cobranca_config_obter() TO authenticated;

-- Chave em branco mantém a que já está guardada. Só liga ('ativo') com chave e token do webhook definidos.
CREATE OR REPLACE FUNCTION public.cobranca_config_salvar(
  p_ambiente text, p_api_key text DEFAULT NULL, p_ativo boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_chave text := nullif(btrim(coalesce(p_api_key, '')), '');
  v_atual public.cobranca_config;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem empresa vinculada'; END IF;
  IF p_ambiente NOT IN ('sandbox', 'producao') THEN RAISE EXCEPTION 'Ambiente inválido'; END IF;
  IF v_chave IS NOT NULL AND (length(v_chave) < 20 OR v_chave ~ '\s') THEN
    RAISE EXCEPTION 'A chave da API parece incompleta: confira se foi copiada inteira';
  END IF;

  INSERT INTO public.cobranca_config (tenant_id, ambiente, api_key)
  VALUES (v_tenant, p_ambiente, v_chave)
  ON CONFLICT (tenant_id) DO UPDATE
     SET ambiente = EXCLUDED.ambiente,
         api_key = coalesce(EXCLUDED.api_key, public.cobranca_config.api_key);

  SELECT * INTO v_atual FROM public.cobranca_config WHERE tenant_id = v_tenant;
  IF coalesce(p_ativo, false) AND (coalesce(v_atual.api_key, '') = '' OR v_atual.webhook_token_hash IS NULL) THEN
    RAISE EXCEPTION 'Para ligar a cobrança, informe a chave da API e gere o token do webhook';
  END IF;
  UPDATE public.cobranca_config SET ativo = coalesce(p_ativo, false) WHERE tenant_id = v_tenant;
END $$;
REVOKE ALL ON FUNCTION public.cobranca_config_salvar(text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cobranca_config_salvar(text, text, boolean) TO authenticated;

-- Gera um token novo para o webhook e o devolve uma única vez; no banco fica só o hash.
-- Gerar de novo invalida o anterior (o provedor precisa receber o token novo).
CREATE OR REPLACE FUNCTION public.cobranca_config_gerar_token()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem empresa vinculada'; END IF;
  INSERT INTO public.cobranca_config (tenant_id, webhook_token_hash)
  VALUES (v_tenant, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'))
  ON CONFLICT (tenant_id) DO UPDATE
     SET webhook_token_hash = EXCLUDED.webhook_token_hash, ativo = false;
  RETURN v_token;
END $$;
REVOKE ALL ON FUNCTION public.cobranca_config_gerar_token() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cobranca_config_gerar_token() TO authenticated;

-- ===== 4. Servidor: empresa dona do token do webhook e chave da API (só service_role) =====
CREATE OR REPLACE FUNCTION public.cobranca_tenant_do_token(p_token text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT tenant_id FROM public.cobranca_config
   WHERE ativo AND webhook_token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
$$;
REVOKE ALL ON FUNCTION public.cobranca_tenant_do_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cobranca_tenant_do_token(text) TO service_role;

-- ===== 5. Registrar a cobrança que o provedor acabou de criar =====
CREATE OR REPLACE FUNCTION public.cobranca_registrar(
  p_conta_id uuid, p_tipo text, p_provedor text, p_provedor_id text, p_vencimento date,
  p_linha_digitavel text DEFAULT NULL, p_codigo_barras text DEFAULT NULL,
  p_url_boleto text DEFAULT NULL, p_pix_copia_cola text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_conta public.contas_receber;
  v_id uuid;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'financeiro', 'caixa']);
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem empresa vinculada'; END IF;

  SELECT * INTO v_conta FROM public.contas_receber
   WHERE id = p_conta_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND OR NOT public.pode_filial(v_conta.filial_id) THEN RAISE EXCEPTION 'Conta não encontrada'; END IF;
  IF v_conta.situacao NOT IN ('aberto', 'parcial') THEN
    RAISE EXCEPTION 'Só conta em aberto recebe cobrança';
  END IF;
  IF EXISTS (SELECT 1 FROM public.cobranca_config WHERE tenant_id = v_tenant AND provedor <> p_provedor) THEN
    RAISE EXCEPTION 'Provedor diferente do configurado';
  END IF;

  INSERT INTO public.cobrancas (tenant_id, conta_receber_id, provedor, provedor_id, tipo, valor, vencimento,
                                linha_digitavel, codigo_barras, url_boleto, pix_copia_cola, criada_por)
  VALUES (v_tenant, p_conta_id, p_provedor, p_provedor_id, p_tipo, v_conta.valor - v_conta.valor_recebido,
          p_vencimento, nullif(btrim(p_linha_digitavel), ''), nullif(btrim(p_codigo_barras), ''),
          nullif(btrim(p_url_boleto), ''), nullif(btrim(p_pix_copia_cola), ''), auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.cobranca_registrar(uuid, text, text, text, date, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cobranca_registrar(uuid, text, text, text, date, text, text, text, text) TO authenticated;

-- Cancelar localmente (o servidor cancela no provedor antes). Cobrança paga não se cancela.
CREATE OR REPLACE FUNCTION public.cobranca_cancelar(p_cobranca_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_cob public.cobrancas;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'financeiro']);
  SELECT * INTO v_cob FROM public.cobrancas WHERE id = p_cobranca_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cobrança não encontrada'; END IF;
  IF v_cob.situacao = 'paga' THEN RAISE EXCEPTION 'Cobrança já paga não pode ser cancelada'; END IF;
  UPDATE public.cobrancas SET situacao = 'cancelada' WHERE id = p_cobranca_id;
END $$;
REVOKE ALL ON FUNCTION public.cobranca_cancelar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cobranca_cancelar(uuid) TO authenticated;

-- ===== 6. Aviso do provedor (só service_role): baixa automática, idempotente =====
-- p_evento: 'paga' | 'vencida' | 'cancelada' | 'estornada'. Devolve o que foi feito:
-- 'baixada', 'repetido', 'nao_encontrada' ou 'registrado'.
CREATE OR REPLACE FUNCTION public.cobranca_evento(
  p_tenant uuid, p_provedor text, p_provedor_id text, p_evento text,
  p_valor numeric DEFAULT NULL, p_data date DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_cob public.cobrancas;
  v_conta public.contas_receber;
  v_saldo numeric;
  v_baixa numeric;
  v_baixa_id uuid;
  v_pago numeric;
  v_obs text;
BEGIN
  IF p_evento NOT IN ('paga', 'vencida', 'cancelada', 'estornada') THEN
    RAISE EXCEPTION 'Evento de cobrança desconhecido: %', p_evento;
  END IF;

  SELECT * INTO v_cob FROM public.cobrancas
   WHERE tenant_id = p_tenant AND provedor = p_provedor AND provedor_id = p_provedor_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'nao_encontrada'; END IF;

  IF p_evento = 'vencida' THEN
    IF v_cob.situacao = 'pendente' THEN UPDATE public.cobrancas SET situacao = 'vencida' WHERE id = v_cob.id; END IF;
    RETURN 'registrado';
  END IF;

  IF p_evento = 'cancelada' THEN
    IF v_cob.situacao IN ('pendente', 'vencida') THEN UPDATE public.cobrancas SET situacao = 'cancelada' WHERE id = v_cob.id; END IF;
    RETURN 'registrado';
  END IF;

  IF p_evento = 'estornada' THEN
    -- o dinheiro voltou ao cliente: a baixa não é desfeita sozinha, uma pessoa confere
    IF v_cob.situacao = 'paga' THEN
      UPDATE public.cobrancas SET alerta = 'Pagamento estornado no provedor: confira a baixa da conta' WHERE id = v_cob.id;
    END IF;
    RETURN 'registrado';
  END IF;

  -- paga
  IF v_cob.situacao = 'paga' THEN RETURN 'repetido'; END IF;
  SELECT * INTO v_conta FROM public.contas_receber WHERE id = v_cob.conta_receber_id AND tenant_id = p_tenant FOR UPDATE;
  v_pago := coalesce(p_valor, v_cob.valor);
  IF v_pago <= 0 THEN RAISE EXCEPTION 'Valor pago inválido'; END IF;

  IF v_conta.id IS NULL OR v_conta.situacao NOT IN ('aberto', 'parcial') THEN
    -- a conta já foi recebida de outro jeito (ou cancelada): a cobrança fica paga, sem baixa em duplicidade, e pede conferência
    UPDATE public.cobrancas
       SET situacao = 'paga', valor_pago = v_pago, pago_em = coalesce(p_data, current_date),
           alerta = 'Pagamento recebido, mas a conta já estava ' || coalesce(v_conta.situacao::text, 'removida') || ': confira se houve recebimento em duplicidade'
     WHERE id = v_cob.id;
    RETURN 'registrado';
  END IF;

  v_saldo := v_conta.valor - v_conta.valor_recebido;
  v_baixa := least(v_pago, v_saldo);
  v_obs := 'Cobrança ' || v_cob.tipo || ' ' || v_cob.provedor || ' ' || v_cob.provedor_id
           || CASE WHEN v_pago > v_saldo THEN ' (pago ' || v_pago || ', acima do saldo; a diferença é juros ou multa)' ELSE '' END;

  INSERT INTO public.financeiro_baixas (tenant_id, conta_receber_id, valor, forma_pagamento, data_baixa, observacao)
  VALUES (p_tenant, v_conta.id, v_baixa, CASE v_cob.tipo WHEN 'pix' THEN 'pix'::public.forma_pagamento ELSE 'boleto'::public.forma_pagamento END,
          coalesce(p_data, current_date), v_obs)
  RETURNING id INTO v_baixa_id;

  UPDATE public.contas_receber
     SET valor_recebido = valor_recebido + v_baixa,
         situacao = CASE WHEN valor_recebido + v_baixa >= valor - 0.001 THEN 'pago'::public.conta_situacao
                         ELSE 'parcial'::public.conta_situacao END
   WHERE id = v_conta.id;

  UPDATE public.cobrancas
     SET situacao = 'paga', valor_pago = v_pago, pago_em = coalesce(p_data, current_date), baixa_id = v_baixa_id,
         alerta = CASE WHEN v_pago < v_saldo - 0.001 THEN 'Pagamento menor que o saldo: a conta ficou parcial' ELSE alerta END
   WHERE id = v_cob.id;
  RETURN 'baixada';
END $$;
REVOKE ALL ON FUNCTION public.cobranca_evento(uuid, text, text, text, numeric, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cobranca_evento(uuid, text, text, text, numeric, date) TO service_role;
