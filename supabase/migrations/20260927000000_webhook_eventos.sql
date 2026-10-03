-- Fase 0 (roadmap, Rodada 6): infraestrutura de webhooks de entrada.
--
-- Cada evento recebido de um provedor (Pix, boleto, maquininha, NFC-e...) é registrado uma única vez
-- (idempotência por provedor + id do evento). A tabela e as funções só são acessíveis pelo
-- service_role: o endpoint do servidor as usa; nenhum usuário do app lê ou grava aqui.

CREATE TABLE public.webhook_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provedor text NOT NULL,
  event_id text NOT NULL,
  tenant_id uuid REFERENCES public.tenants (id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'recebido'
    CHECK (status IN ('recebido', 'processado', 'ignorado', 'erro')),
  tentativas integer NOT NULL DEFAULT 1,
  erro text,
  payload jsonb NOT NULL,
  recebido_em timestamptz NOT NULL DEFAULT now(),
  processado_em timestamptz,
  UNIQUE (provedor, event_id)
);

CREATE INDEX webhook_eventos_status_idx ON public.webhook_eventos (status, recebido_em);

ALTER TABLE public.webhook_eventos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.webhook_eventos FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.webhook_eventos TO service_role;

-- Registra o evento. Devolve:
--   'novo'         primeira vez que o evento chega: processar;
--   'reprocessar'  já existia mas falhou, ou ficou preso em 'recebido' há mais de 5 minutos: processar de novo;
--   'duplicado'    já processado (ou em processamento agora): não processar.
-- A atualização de recebido_em funciona como trava: duas entregas simultâneas do mesmo evento não
-- processam em paralelo.
CREATE OR REPLACE FUNCTION public.webhook_registrar(
  p_provedor text,
  p_event_id text,
  p_tenant_id uuid DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(btrim(p_provedor), '') = '' OR coalesce(btrim(p_event_id), '') = '' THEN
    RAISE EXCEPTION 'Provedor e id do evento são obrigatórios';
  END IF;

  INSERT INTO public.webhook_eventos (provedor, event_id, tenant_id, payload)
  VALUES (p_provedor, p_event_id, p_tenant_id, p_payload)
  ON CONFLICT (provedor, event_id) DO NOTHING;
  IF FOUND THEN RETURN 'novo'; END IF;

  UPDATE public.webhook_eventos
     SET status = 'recebido',
         tentativas = tentativas + 1,
         erro = NULL,
         recebido_em = now()
   WHERE provedor = p_provedor
     AND event_id = p_event_id
     AND (status = 'erro' OR (status = 'recebido' AND recebido_em < now() - interval '5 minutes'));
  IF FOUND THEN RETURN 'reprocessar'; END IF;

  RETURN 'duplicado';
END;
$$;

CREATE OR REPLACE FUNCTION public.webhook_concluir(
  p_provedor text,
  p_event_id text,
  p_status text,
  p_erro text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_status NOT IN ('processado', 'ignorado', 'erro') THEN
    RAISE EXCEPTION 'Situação inválida: %', p_status;
  END IF;

  UPDATE public.webhook_eventos
     SET status = p_status,
         erro = CASE WHEN p_status = 'erro' THEN left(coalesce(p_erro, 'erro sem mensagem'), 1000) ELSE NULL END,
         processado_em = CASE WHEN p_status = 'erro' THEN NULL ELSE now() END
   WHERE provedor = p_provedor AND event_id = p_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.webhook_registrar(text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.webhook_concluir(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.webhook_registrar(text, text, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.webhook_concluir(text, text, text, text) TO service_role;
