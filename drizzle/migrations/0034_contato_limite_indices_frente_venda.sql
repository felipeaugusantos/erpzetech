ALTER TABLE public.contatos ADD COLUMN IF NOT EXISTS origem text;
CREATE INDEX IF NOT EXISTS contatos_origem_criado_idx ON public.contatos (origem, created_at);

ALTER TABLE public.contatos DROP CONSTRAINT IF EXISTS contatos_tamanho_ck;
ALTER TABLE public.contatos ADD CONSTRAINT contatos_tamanho_ck CHECK (
  char_length(nome) <= 120 AND char_length(coalesce(email, '')) <= 200
  AND char_length(coalesce(whatsapp, '')) <= 40 AND char_length(coalesce(plano_interesse, '')) <= 30
  AND char_length(coalesce(mensagem, '')) <= 2000) NOT VALID;

CREATE OR REPLACE FUNCTION public.contato_enviar(
  p_nome text, p_email text DEFAULT NULL, p_whatsapp text DEFAULT NULL, p_plano text DEFAULT NULL,
  p_mensagem text DEFAULT NULL, p_site text DEFAULT NULL, p_aberto_em timestamptz DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_nome text := btrim(coalesce(p_nome, ''));
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_whats text := nullif(btrim(coalesce(p_whatsapp, '')), '');
  v_digitos text;
  v_plano text := nullif(btrim(coalesce(p_plano, '')), '');
  v_msg text := nullif(btrim(coalesce(p_mensagem, '')), '');
  v_ip text;
  v_origem text;
BEGIN
  IF btrim(coalesce(p_site, '')) <> '' THEN RETURN true; END IF;
  IF p_aberto_em IS NOT NULL AND now() - p_aberto_em < interval '3 seconds' THEN
    RAISE EXCEPTION 'Aguarde alguns segundos e envie de novo.';
  END IF;

  IF char_length(v_nome) < 2 THEN RAISE EXCEPTION 'Informe o seu nome'; END IF;
  IF char_length(v_nome) > 120 THEN RAISE EXCEPTION 'Nome muito longo'; END IF;
  IF v_email IS NULL AND v_whats IS NULL THEN RAISE EXCEPTION 'Informe e-mail ou WhatsApp para eu responder'; END IF;
  IF v_email IS NOT NULL AND (char_length(v_email) > 200 OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') THEN
    RAISE EXCEPTION 'E-mail inválido';
  END IF;
  IF v_whats IS NOT NULL THEN
    v_digitos := regexp_replace(v_whats, '\D', '', 'g');
    IF char_length(v_whats) > 40 OR char_length(v_digitos) NOT BETWEEN 10 AND 15 THEN
      RAISE EXCEPTION 'WhatsApp inválido (use o DDD e o número)';
    END IF;
  END IF;
  IF char_length(coalesce(v_msg, '')) > 2000 THEN RAISE EXCEPTION 'Mensagem muito longa (máximo 2000 caracteres)'; END IF;
  IF char_length(coalesce(v_plano, '')) > 30 THEN v_plano := NULL; END IF;

  BEGIN
    v_ip := coalesce(nullif(current_setting('request.headers', true)::json ->> 'cf-connecting-ip', ''),
                     nullif(split_part(coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1), ''));
  EXCEPTION WHEN OTHERS THEN
    v_ip := NULL;
  END;
  IF v_ip IS NOT NULL THEN v_origem := md5('contato:' || btrim(v_ip)); END IF;

  IF EXISTS (SELECT 1 FROM public.contatos c
              WHERE c.created_at > now() - interval '10 minutes'
                AND c.nome = v_nome AND coalesce(c.email, '') = coalesce(v_email, '')
                AND coalesce(c.whatsapp, '') = coalesce(v_whats, '') AND coalesce(c.mensagem, '') = coalesce(v_msg, '')) THEN
    RETURN true;
  END IF;

  IF v_origem IS NOT NULL AND (SELECT count(*) FROM public.contatos c
                                WHERE c.origem = v_origem AND c.created_at > now() - interval '1 hour') >= 5 THEN
    RAISE EXCEPTION 'Muitos envios deste aparelho. Tente de novo mais tarde ou fale pelo WhatsApp.';
  END IF;
  IF (SELECT count(*) FROM public.contatos c WHERE c.created_at > now() - interval '1 hour') >= 100 THEN
    RAISE EXCEPTION 'Estamos recebendo muitos contatos agora. Fale pelo WhatsApp ou tente de novo mais tarde.';
  END IF;

  INSERT INTO public.contatos (nome, email, whatsapp, plano_interesse, mensagem, origem)
  VALUES (v_nome, v_email, v_whats, v_plano, v_msg, v_origem);
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.contato_enviar(text, text, text, text, text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.contato_enviar(text, text, text, text, text, text, timestamptz) TO anon, authenticated;

DROP POLICY IF EXISTS contatos_insert_publico ON public.contatos;
REVOKE INSERT ON public.contatos FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS auditoria_tenant_criado_idx ON public.auditoria (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS auditoria_tenant_entidade_criado_idx ON public.auditoria (tenant_id, entidade, created_at DESC);

CREATE OR REPLACE FUNCTION public.frente_venda_existente(p_chave uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_pedido record;
BEGIN
  PERFORM public.exige_nao_salao();
  IF v_tenant IS NULL OR p_chave IS NULL THEN RETURN NULL; END IF;
  SELECT p.id, p.numero, p.filial_id INTO v_pedido FROM public.pedidos p
   WHERE p.tenant_id = v_tenant AND p.chave_idempotencia = p_chave;
  IF NOT FOUND OR NOT public.pode_filial(v_pedido.filial_id) THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('pedido_id', v_pedido.id, 'numero', v_pedido.numero);
END $$;

REVOKE ALL ON FUNCTION public.frente_venda_existente(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.frente_venda_existente(uuid) TO authenticated;