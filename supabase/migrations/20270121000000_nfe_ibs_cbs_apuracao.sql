-- Apuração do IBS/CBS: guarda, em cada nota emitida, o IBS e a CBS que a nota destacou e o efeito dela na apuração.
-- Regras:
--   * os valores vêm do total enviado na transmissão (IBSCBSTot); nota sem o grupo fica com zero e efeito nulo;
--   * efeito: 'debito' (venda e notas complementares/de ajuste), 'estorno_debito' (devolução de venda, que entra como
--     nota de entrada) e 'estorno_credito' (devolução de compra ao fornecedor);
--   * a coluna só é escrita pelo servidor, junto com o retorno da Sefaz (a nota não é editável pelo usuário);
--   * notas autorizadas ANTES desta migração não têm o valor guardado e ficam de fora da apuração.

ALTER TABLE public.nfe ADD COLUMN IF NOT EXISTS valor_ibs numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE public.nfe ADD COLUMN IF NOT EXISTS valor_cbs numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE public.nfe ADD COLUMN IF NOT EXISTS ibs_cbs_efeito text;
ALTER TABLE public.nfe DROP CONSTRAINT IF EXISTS nfe_ibs_cbs_efeito_chk;
ALTER TABLE public.nfe ADD CONSTRAINT nfe_ibs_cbs_efeito_chk
  CHECK (ibs_cbs_efeito IS NULL OR ibs_cbs_efeito IN ('debito', 'estorno_debito', 'estorno_credito'));
