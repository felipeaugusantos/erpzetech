UPDATE public.produtos
   SET ncm = NULLIF(regexp_replace(COALESCE(ncm, ''), '\D', '', 'g'), ''),
       cfop = COALESCE(NULLIF(cfop, ''), '5102'),
       cst_csosn = COALESCE(NULLIF(cst_csosn, ''), '102'),
       origem_mercadoria = COALESCE(NULLIF(origem_mercadoria, ''), '0'),
       updated_at = now()
 WHERE deleted_at IS NULL;

UPDATE public.nfe_itens
   SET ncm = NULLIF(regexp_replace(COALESCE(ncm, ''), '\D', '', 'g'), ''),
       cfop = COALESCE(NULLIF(cfop, ''), '5102'),
       cst_csosn = COALESCE(NULLIF(cst_csosn, ''), '102');