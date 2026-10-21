-- Reforma Tributária (NT 2025.002-RTC): classificação do produto no IBS/CBS.
-- cst_ibs_cbs (3 dígitos) e cclasstrib (6 dígitos) vêm da tabela do Informe Técnico; em branco vale "tributação
-- integral" (000 / 000001) na emissão. Só preenche para o produto que não é tributado integralmente.
ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS cst_ibs_cbs text,
  ADD COLUMN IF NOT EXISTS cclasstrib text;

DO $$ BEGIN
  ALTER TABLE public.produtos ADD CONSTRAINT produtos_ibs_cbs_classificacao CHECK (
    (cst_ibs_cbs IS NULL AND cclasstrib IS NULL)
    OR (cst_ibs_cbs IS NOT NULL AND cclasstrib IS NOT NULL
        AND cst_ibs_cbs ~ '^[0-9]{3}$' AND cclasstrib ~ '^[0-9]{6}$' AND left(cclasstrib, 3) = cst_ibs_cbs));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.produtos.cst_ibs_cbs IS 'CST do IBS/CBS (tabela do Informe Técnico 2025.002 RTC); nulo = tributação integral (000).';
COMMENT ON COLUMN public.produtos.cclasstrib IS 'Código de classificação tributária do IBS/CBS (6 dígitos); nulo = 000001.';
