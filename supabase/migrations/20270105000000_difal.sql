-- DIFAL e FCP por UF de destino: alíquota interna, FCP e método de base de cálculo que a EMPRESA cadastra.
-- Não há valor pré-carregado: alíquota estadual muda por lei, e sem cadastro da UF a emissão da venda interestadual a
-- consumidor final não contribuinte é recusada, em vez de usar uma alíquota inventada.
-- Regras:
--   * leitura só da própria empresa; escrita SÓ pela função, para administrador, gestor ou financeiro;
--   * uma linha por UF por empresa (cliente): salvar de novo atualiza.

CREATE TABLE IF NOT EXISTS public.icms_uf_destino (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  uf text NOT NULL CHECK (uf IN ('AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO')),
  aliquota_interna numeric(5,2) NOT NULL CHECK (aliquota_interna > 0 AND aliquota_interna <= 40),
  fcp numeric(5,2) NOT NULL DEFAULT 0 CHECK (fcp >= 0 AND fcp <= 10),
  metodo text NOT NULL CHECK (metodo IN ('dupla', 'unica')),
  atualizado_por uuid,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, uf)
);

ALTER TABLE public.icms_uf_destino ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.icms_uf_destino FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.icms_uf_destino TO authenticated;
GRANT ALL ON public.icms_uf_destino TO service_role;
DROP POLICY IF EXISTS icms_uf_destino_leitura ON public.icms_uf_destino;
CREATE POLICY icms_uf_destino_leitura ON public.icms_uf_destino FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
DROP POLICY IF EXISTS salao_restrito ON public.icms_uf_destino;
CREATE POLICY salao_restrito ON public.icms_uf_destino AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()));

CREATE OR REPLACE FUNCTION public.icms_uf_destino_salvar(
  p_uf text,
  p_aliquota_interna numeric,
  p_fcp numeric,
  p_metodo text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_uf text := upper(btrim(coalesce(p_uf, '')));
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem empresa vinculada'; END IF;
  PERFORM public.exige_nao_salao();
  IF NOT (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')
          OR public.has_role(auth.uid(), 'financeiro')) THEN
    RAISE EXCEPTION 'Somente administrador, gestor ou financeiro altera as alíquotas de DIFAL';
  END IF;
  IF p_aliquota_interna IS NULL OR p_aliquota_interna <= 0 OR p_aliquota_interna > 40 THEN
    RAISE EXCEPTION 'A alíquota interna deve ficar entre 0 e 40%%';
  END IF;
  IF coalesce(p_fcp, 0) < 0 OR coalesce(p_fcp, 0) > 10 THEN RAISE EXCEPTION 'O FCP deve ficar entre 0 e 10%%'; END IF;
  IF p_metodo NOT IN ('dupla', 'unica') THEN RAISE EXCEPTION 'O método deve ser base dupla ou base única'; END IF;

  INSERT INTO public.icms_uf_destino (tenant_id, uf, aliquota_interna, fcp, metodo, atualizado_por, atualizado_em)
  VALUES (v_tenant, v_uf, round(p_aliquota_interna, 2), round(coalesce(p_fcp, 0), 2), p_metodo, auth.uid(), now())
  ON CONFLICT (tenant_id, uf) DO UPDATE
    SET aliquota_interna = excluded.aliquota_interna, fcp = excluded.fcp, metodo = excluded.metodo,
        atualizado_por = excluded.atualizado_por, atualizado_em = excluded.atualizado_em;
END $$;

REVOKE ALL ON FUNCTION public.icms_uf_destino_salvar(text, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.icms_uf_destino_salvar(text, numeric, numeric, text) TO authenticated;
