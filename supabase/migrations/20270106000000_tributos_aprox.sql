-- Valor aproximado dos tributos (Lei 12.741/2012): alíquotas por NCM da tabela da IBPT, que a EMPRESA importa
-- (arquivo por UF, baixado no site da IBPT). Não há valor pré-carregado.
-- Regras:
--   * leitura só da própria empresa; escrita SÓ pela função, para administrador, gestor ou financeiro;
--   * uma linha por NCM por empresa: importar de novo atualiza (a tabela da IBPT muda a cada vigência);
--   * a função aceita no máximo 2000 linhas por chamada; a tela envia em lotes.

CREATE TABLE IF NOT EXISTS public.tributos_aprox_ncm (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  ncm text NOT NULL CHECK (ncm ~ '^[0-9]{8}$'),
  aliq_nacional_federal numeric(6,2) NOT NULL CHECK (aliq_nacional_federal BETWEEN 0 AND 100),
  aliq_importado_federal numeric(6,2) NOT NULL CHECK (aliq_importado_federal BETWEEN 0 AND 100),
  aliq_estadual numeric(6,2) NOT NULL CHECK (aliq_estadual BETWEEN 0 AND 100),
  aliq_municipal numeric(6,2) NOT NULL CHECK (aliq_municipal BETWEEN 0 AND 100),
  vigencia_fim date,
  versao text,
  fonte text,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, ncm)
);

ALTER TABLE public.tributos_aprox_ncm ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tributos_aprox_ncm FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.tributos_aprox_ncm TO authenticated;
GRANT ALL ON public.tributos_aprox_ncm TO service_role;
DROP POLICY IF EXISTS tributos_aprox_ncm_leitura ON public.tributos_aprox_ncm;
CREATE POLICY tributos_aprox_ncm_leitura ON public.tributos_aprox_ncm FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
DROP POLICY IF EXISTS salao_restrito ON public.tributos_aprox_ncm;
CREATE POLICY salao_restrito ON public.tributos_aprox_ncm AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()));

CREATE OR REPLACE FUNCTION public.tributos_aprox_importar(p_linhas jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_n integer;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem empresa vinculada'; END IF;
  PERFORM public.exige_nao_salao();
  IF NOT (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')
          OR public.has_role(auth.uid(), 'financeiro')) THEN
    RAISE EXCEPTION 'Somente administrador, gestor ou financeiro importa a tabela de tributos aproximados';
  END IF;
  IF p_linhas IS NULL OR jsonb_typeof(p_linhas) <> 'array' OR jsonb_array_length(p_linhas) = 0 THEN
    RAISE EXCEPTION 'Nenhuma linha para importar';
  END IF;
  IF jsonb_array_length(p_linhas) > 2000 THEN RAISE EXCEPTION 'Envie no máximo 2000 linhas por vez'; END IF;

  -- a última linha de cada NCM no lote vale (o mesmo NCM duas vezes no mesmo comando daria erro no upsert)
  WITH dados AS (
    SELECT DISTINCT ON (x.ncm) x.*
      FROM jsonb_to_recordset(p_linhas) AS x(
        ncm text, aliq_nacional_federal numeric, aliq_importado_federal numeric,
        aliq_estadual numeric, aliq_municipal numeric, vigencia_fim date, versao text, fonte text)
     ORDER BY x.ncm
  ), up AS (
    INSERT INTO public.tributos_aprox_ncm (tenant_id, ncm, aliq_nacional_federal, aliq_importado_federal,
      aliq_estadual, aliq_municipal, vigencia_fim, versao, fonte, atualizado_em)
    SELECT v_tenant, d.ncm, round(d.aliq_nacional_federal, 2), round(d.aliq_importado_federal, 2),
           round(d.aliq_estadual, 2), round(d.aliq_municipal, 2), d.vigencia_fim, d.versao, d.fonte, now()
      FROM dados d
    ON CONFLICT (tenant_id, ncm) DO UPDATE
      SET aliq_nacional_federal = excluded.aliq_nacional_federal,
          aliq_importado_federal = excluded.aliq_importado_federal,
          aliq_estadual = excluded.aliq_estadual, aliq_municipal = excluded.aliq_municipal,
          vigencia_fim = excluded.vigencia_fim, versao = excluded.versao, fonte = excluded.fonte,
          atualizado_em = excluded.atualizado_em
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM up;
  RETURN v_n;
END $$;

REVOKE ALL ON FUNCTION public.tributos_aprox_importar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tributos_aprox_importar(jsonb) TO authenticated;
