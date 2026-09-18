-- operador dedicado da área Ze Tech
INSERT INTO public.saas_operadores (user_id, nome)
SELECT u.id, 'Equipe Ze Tech' FROM auth.users u
WHERE u.email = 'zetech@zeregistra.com.br'
ON CONFLICT DO NOTHING;

-- dados de cobrança da Ze Tech (beneficiário do PIX/boleto)
CREATE TABLE public.saas_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  beneficiario text NOT NULL DEFAULT 'Ze Tech',
  documento text,
  chave_pix text,
  cidade text NOT NULL DEFAULT 'SAO PAULO',
  banco text,
  instrucoes text,
  email_cobranca text,
  whatsapp_cobranca text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.saas_config TO authenticated;
GRANT ALL ON public.saas_config TO service_role;
ALTER TABLE public.saas_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operador ve config saas" ON public.saas_config
  FOR SELECT TO authenticated USING (public.eh_saas_operador());
CREATE POLICY "Operador cria config saas" ON public.saas_config
  FOR INSERT TO authenticated WITH CHECK (public.eh_saas_operador());
CREATE POLICY "Operador edita config saas" ON public.saas_config
  FOR UPDATE TO authenticated USING (public.eh_saas_operador()) WITH CHECK (public.eh_saas_operador());

INSERT INTO public.saas_config (beneficiario, chave_pix, cidade, email_cobranca, whatsapp_cobranca, instrucoes)
VALUES ('Ze Tech', 'contato@zeregistra.com.br', 'RIBEIRAO PRETO', 'contato@zeregistra.com.br',
        '16997994239', 'Após o vencimento, cobrar multa de 2% e juros de 1% ao mês.');

-- campos de cobrança nas faturas das lojas
ALTER TABLE public.saas_faturas
  ADD COLUMN forma_cobranca text,
  ADD COLUMN pix_copia_cola text,
  ADD COLUMN boleto_linha_digitavel text,
  ADD COLUMN boleto_url text,
  ADD COLUMN enviado_em timestamptz,
  ADD COLUMN enviado_canal text,
  ADD COLUMN observacao text;

CREATE OR REPLACE FUNCTION public.saas_registrar_cobranca(
  p_cliente_id uuid,
  p_descricao text,
  p_valor numeric,
  p_vencimento date,
  p_tipo text DEFAULT 'mensalidade',
  p_forma text DEFAULT 'pix',
  p_competencia date DEFAULT NULL,
  p_pix text DEFAULT NULL,
  p_linha_digitavel text DEFAULT NULL,
  p_boleto_url text DEFAULT NULL,
  p_observacao text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.eh_saas_operador() THEN RAISE EXCEPTION 'Área exclusiva da Ze Tech'; END IF;
  IF p_valor <= 0 THEN RAISE EXCEPTION 'Informe um valor maior que zero'; END IF;

  INSERT INTO public.saas_faturas (cliente_id, competencia, descricao, tipo, valor, vencimento,
                                   forma_cobranca, pix_copia_cola, boleto_linha_digitavel, boleto_url, observacao)
  VALUES (p_cliente_id, COALESCE(p_competencia, date_trunc('month', p_vencimento)::date),
          p_descricao, p_tipo, p_valor, p_vencimento, p_forma, p_pix, p_linha_digitavel, p_boleto_url, p_observacao)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.saas_marcar_enviada(p_fatura_id uuid, p_canal text DEFAULT 'whatsapp')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.eh_saas_operador() THEN RAISE EXCEPTION 'Área exclusiva da Ze Tech'; END IF;
  UPDATE public.saas_faturas
  SET enviado_em = now(), enviado_canal = p_canal
  WHERE id = p_fatura_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.saas_registrar_cobranca(uuid, text, numeric, date, text, text, date, text, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.saas_marcar_enviada(uuid, text) FROM anon;