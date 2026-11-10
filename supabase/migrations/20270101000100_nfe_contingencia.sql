-- Contingência SVC da NF-e: período em que a empresa emite pela SVC-AN/SVC-RS porque a Sefaz da UF está fora.
-- Regras:
--   * no máximo UMA contingência aberta por empresa (índice único parcial);
--   * leitura só da própria empresa; escrita SÓ pelo servidor (service_role), depois de conferir administrador/gestor;
--   * o registro não se apaga e só muda para registrar a saída (saiu_em, usuario_saida), uma vez.

CREATE TABLE IF NOT EXISTS public.nfe_contingencia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  empresa_id uuid NOT NULL,
  tp_emis smallint NOT NULL CHECK (tp_emis IN (6, 7)),
  autorizador text NOT NULL CHECK (autorizador IN ('SVCAN', 'SVCRS')),
  justificativa text NOT NULL CHECK (char_length(justificativa) BETWEEN 15 AND 256),
  entrou_em timestamptz NOT NULL DEFAULT now(),
  usuario_entrada uuid NOT NULL,
  saiu_em timestamptz,
  usuario_saida uuid,
  CHECK ((saiu_em IS NULL) = (usuario_saida IS NULL)),
  CHECK (saiu_em IS NULL OR saiu_em >= entrou_em)
);
CREATE UNIQUE INDEX IF NOT EXISTS nfe_contingencia_uma_aberta
  ON public.nfe_contingencia (tenant_id, empresa_id) WHERE saiu_em IS NULL;
CREATE INDEX IF NOT EXISTS nfe_contingencia_hist_idx ON public.nfe_contingencia (tenant_id, empresa_id, entrou_em DESC);

CREATE OR REPLACE FUNCTION public._nfe_contingencia_guarda()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Contingência não se apaga';
  END IF;
  IF OLD.saiu_em IS NOT NULL THEN
    RAISE EXCEPTION 'Contingência encerrada não muda';
  END IF;
  IF (to_jsonb(NEW) - 'saiu_em' - 'usuario_saida') IS DISTINCT FROM (to_jsonb(OLD) - 'saiu_em' - 'usuario_saida') THEN
    RAISE EXCEPTION 'Os dados da contingência não mudam';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_nfe_contingencia_guarda ON public.nfe_contingencia;
CREATE TRIGGER trg_nfe_contingencia_guarda BEFORE UPDATE OR DELETE ON public.nfe_contingencia
  FOR EACH ROW EXECUTE FUNCTION public._nfe_contingencia_guarda();

ALTER TABLE public.nfe_contingencia ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nfe_contingencia FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.nfe_contingencia TO authenticated;
GRANT ALL ON public.nfe_contingencia TO service_role;
CREATE POLICY nfe_contingencia_leitura ON public.nfe_contingencia FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY salao_restrito ON public.nfe_contingencia AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()));

-- forma de emissão com que cada nota saiu (1 normal, 6 SVC-AN, 7 SVC-RS): vale para auditoria e para o DANFE
ALTER TABLE public.nfe ADD COLUMN IF NOT EXISTS tp_emis smallint NOT NULL DEFAULT 1;
