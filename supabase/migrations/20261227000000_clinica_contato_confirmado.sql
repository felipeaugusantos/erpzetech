-- Lembrete de vacina/vermífugo da clínica: o pet só sai da lista manual da recepção quando há CONTATO CONFIRMADO.
-- Antes, o contato era gravado assim que o serviço do WhatsApp ACEITAVA a mensagem (situação "enviada"), o que não prova
-- entrega. Agora:
--   * o contato do envio automático é gravado quando o WhatsApp confirma a ENTREGA (entregue) ou a leitura (lida);
--   * contato assistido (recepção) é gravado quando ela marca "Já falei" (a tela deixou de gravar só por abrir o link);
--   * o WhatsApp pode informar FALHA depois da aceitação ("erro"): a mensagem vira "falhou", sem contato, e o pet volta
--     para a lista; uma confirmação de entrega que chegue depois prevalece e grava o contato.
-- Não mexe no lava rápido (pronto, plano_vencendo, retorno continuam gravando lr_contatos na aceitação), em
-- clinica_reforcos_pendentes nem no histórico: contatos já gravados ficam como estão.
-- Assinaturas inalteradas: wa_resultado(uuid, boolean, text, text, text, timestamptz) e wa_status(text, text, text).

CREATE OR REPLACE FUNCTION public.wa_resultado(p_id uuid, p_ok boolean, p_id_externo text, p_jid text, p_erro text, p_proxima timestamptz)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE m public.wa_mensagens%ROWTYPE;
BEGIN
  SELECT * INTO m FROM public.wa_mensagens WHERE id = p_id AND situacao = 'enviando' FOR UPDATE;
  IF m.id IS NULL THEN RETURN; END IF;
  IF p_ok THEN
    UPDATE public.wa_mensagens SET situacao = 'enviada', enviada_em = now(), id_externo = p_id_externo, jid = p_jid, erro = NULL WHERE id = p_id;
    -- aceitação não é contato feito para a clínica (reforco_vacina e retorno_consulta): o contato nasce na entrega (wa_status)
    IF m.tipo IN ('pronto', 'plano_vencendo', 'retorno') THEN
      INSERT INTO public.lr_contatos (tenant_id, tipo, referencia, cliente_id, veiculo_id, canal, feito_por)
      VALUES (m.tenant_id, m.tipo, m.referencia, m.cliente_id, m.veiculo_id, 'whatsapp', m.criado_por)
      ON CONFLICT (tenant_id, tipo, referencia) DO NOTHING;
    END IF;
  ELSIF p_proxima IS NOT NULL THEN
    UPDATE public.wa_mensagens SET situacao = 'na_fila', proxima_tentativa = p_proxima, erro = left(p_erro, 300) WHERE id = p_id;
  ELSE
    UPDATE public.wa_mensagens SET situacao = 'falhou', erro = left(p_erro, 300) WHERE id = p_id;
  END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.wa_resultado(uuid, boolean, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_resultado(uuid, boolean, text, text, text, timestamptz) TO service_role;

-- Eventos do WhatsApp: só avançam (enviada → entregue → lida); repetido ou atrasado não retrocede nada.
-- p_status 'erro' = o WhatsApp informou falha na mensagem: vale só para quem ainda está "enviada" (nunca para entregue ou lida).
-- "falhou" com id externo (falha informada depois da aceitação) ainda pode ser corrigida por uma entrega/leitura posterior.
CREATE OR REPLACE FUNCTION public.wa_status(p_instancia text, p_id_externo text, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_tenant uuid;
  m public.wa_mensagens%ROWTYPE;
BEGIN
  IF p_status NOT IN ('entregue', 'lida', 'erro') THEN RETURN; END IF;
  SELECT tenant_id INTO v_tenant FROM public.wa_config WHERE instancia = p_instancia;
  IF v_tenant IS NULL THEN RETURN; END IF;
  FOR m IN SELECT * FROM public.wa_mensagens WHERE tenant_id = v_tenant AND id_externo = p_id_externo FOR UPDATE LOOP
    IF p_status = 'erro' THEN
      IF m.situacao = 'enviada' THEN
        UPDATE public.wa_mensagens SET situacao = 'falhou', erro = 'O WhatsApp informou falha na entrega' WHERE id = m.id;
      END IF;
      CONTINUE;
    END IF;
    IF NOT (m.situacao = 'enviada'
            OR (m.situacao = 'entregue' AND p_status = 'lida')
            OR (m.situacao = 'falhou' AND m.id_externo IS NOT NULL)) THEN
      CONTINUE;
    END IF;
    UPDATE public.wa_mensagens SET situacao = p_status, erro = NULL WHERE id = m.id;
    -- entrega (ou leitura) confirmada: só agora o lembrete de vacina conta como contato feito
    IF m.tipo = 'reforco_vacina' AND m.pet_id IS NOT NULL AND m.referencia ~ ':\d{4}-\d{2}-\d{2}$' THEN
      INSERT INTO public.pet_contatos (tenant_id, pet_id, tipo, referencia, canal, contatado_por)
      VALUES (m.tenant_id, m.pet_id, 'reforco', right(m.referencia, 10)::date, 'whatsapp', m.criado_por)
      ON CONFLICT (pet_id, tipo, referencia) DO NOTHING;
    END IF;
  END LOOP;
END $fn$;
REVOKE ALL ON FUNCTION public.wa_status(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_status(text, text, text) TO service_role;
