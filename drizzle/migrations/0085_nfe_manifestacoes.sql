-- Manifestação do destinatário (NF-e recebidas): registro de quem manifestou o quê, e quando.
-- A busca das notas e o envio do evento à Sefaz são feitos pelo emissor fiscal; aqui fica só a auditoria por empresa.
-- A tabela não tem acesso direto: o servidor lê e grava com a chave de serviço, depois de conferir papel e empresa.
CREATE TABLE IF NOT EXISTS public.nfe_manifestacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  cnpj text NOT NULL,
  ambiente text NOT NULL CHECK (ambiente IN ('homologacao', 'producao')),
  chave_acesso text NOT NULL CHECK (chave_acesso ~ '^[0-9]{44}$'),
  tipo_evento text NOT NULL CHECK (tipo_evento IN ('210200', '210210', '210220', '210240')),
  justificativa text CHECK (justificativa IS NULL OR length(justificativa) BETWEEN 15 AND 255),
  status text NOT NULL,
  protocolo text,
  mensagem text,
  emitente text,
  valor numeric,
  autor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nfe_manifestacoes_tenant_data ON public.nfe_manifestacoes (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS nfe_manifestacoes_tenant_chave ON public.nfe_manifestacoes (tenant_id, chave_acesso);
ALTER TABLE public.nfe_manifestacoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nfe_manifestacoes FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.nfe_manifestacoes TO service_role;
CREATE POLICY salao_restrito ON public.nfe_manifestacoes AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT NOT public.eh_salao_restrito()));
