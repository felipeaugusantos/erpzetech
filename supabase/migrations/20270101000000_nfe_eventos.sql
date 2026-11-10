-- Eventos fiscais da NF-e: carta de correção (CC-e) e inutilização de numeração.
-- Regras:
--   * leitura só da própria empresa (tenant), pela política abaixo;
--   * escrita SÓ pelo servidor (service_role), depois de conferir papel fiscal e empresa: o retorno da Sefaz
--     (protocolo, situação) não pode ser alterado por usuário logado direto no banco;
--   * o registro nunca é apagado nem editado depois de concluído (trigger).

CREATE TABLE IF NOT EXISTS public.nfe_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  empresa_id uuid,
  tipo text NOT NULL CHECK (tipo IN ('carta_correcao', 'inutilizacao')),
  nfe_id uuid REFERENCES public.nfe(id) ON DELETE RESTRICT,
  sequencia integer CHECK (sequencia IS NULL OR sequencia BETWEEN 1 AND 20),
  texto text NOT NULL CHECK (char_length(texto) BETWEEN 15 AND 1000),
  serie integer CHECK (serie IS NULL OR serie BETWEEN 0 AND 999),
  numero_inicial integer CHECK (numero_inicial IS NULL OR numero_inicial BETWEEN 1 AND 999999999),
  numero_final integer CHECK (numero_final IS NULL OR numero_final BETWEEN 1 AND 999999999),
  ano integer,
  ambiente text NOT NULL DEFAULT 'homologacao' CHECK (ambiente IN ('homologacao', 'producao')),
  situacao text NOT NULL DEFAULT 'pendente' CHECK (situacao IN ('pendente', 'registrado', 'rejeitado', 'erro')),
  provider_id text,
  protocolo text,
  mensagem text,
  retorno jsonb,
  usuario_id uuid NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (tipo = 'carta_correcao' AND nfe_id IS NOT NULL AND sequencia IS NOT NULL)
    OR (tipo = 'inutilizacao' AND serie IS NOT NULL AND numero_inicial IS NOT NULL
        AND numero_final IS NOT NULL AND numero_final >= numero_inicial AND ano IS NOT NULL)
  )
);
-- uma sequência por nota; só ocupa a vaga a carta pendente ou registrada (rejeitada ou com erro libera)
CREATE UNIQUE INDEX IF NOT EXISTS nfe_eventos_carta_seq_uq
  ON public.nfe_eventos (nfe_id, sequencia) WHERE tipo = 'carta_correcao' AND situacao IN ('pendente', 'registrado');
CREATE INDEX IF NOT EXISTS nfe_eventos_nota_idx ON public.nfe_eventos (tenant_id, nfe_id);
CREATE INDEX IF NOT EXISTS nfe_eventos_tipo_idx ON public.nfe_eventos (tenant_id, tipo, criado_em DESC);

CREATE OR REPLACE FUNCTION public._nfe_eventos_guarda()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Evento fiscal não se apaga';
  END IF;
  IF OLD.situacao IN ('registrado', 'rejeitado') THEN
    RAISE EXCEPTION 'Evento fiscal concluído não muda';
  END IF;
  IF (to_jsonb(NEW) - 'situacao' - 'provider_id' - 'protocolo' - 'mensagem' - 'retorno' - 'atualizado_em')
     IS DISTINCT FROM (to_jsonb(OLD) - 'situacao' - 'provider_id' - 'protocolo' - 'mensagem' - 'retorno' - 'atualizado_em') THEN
    RAISE EXCEPTION 'Os dados do evento fiscal não mudam';
  END IF;
  NEW.atualizado_em := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_nfe_eventos_guarda ON public.nfe_eventos;
CREATE TRIGGER trg_nfe_eventos_guarda BEFORE UPDATE OR DELETE ON public.nfe_eventos
  FOR EACH ROW EXECUTE FUNCTION public._nfe_eventos_guarda();

ALTER TABLE public.nfe_eventos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nfe_eventos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.nfe_eventos TO authenticated;
GRANT ALL ON public.nfe_eventos TO service_role;
DROP POLICY IF EXISTS nfe_eventos_leitura ON public.nfe_eventos;
CREATE POLICY nfe_eventos_leitura ON public.nfe_eventos FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
DROP POLICY IF EXISTS salao_restrito ON public.nfe_eventos;
CREATE POLICY salao_restrito ON public.nfe_eventos AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()));
