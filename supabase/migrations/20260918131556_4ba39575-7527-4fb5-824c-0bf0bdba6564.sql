UPDATE public.produtos p
   SET cst_csosn = '500',
       cfop = '5405',
       aliquota_icms = CASE WHEN COALESCE(p.aliquota_icms, 0) > 0 THEN p.aliquota_icms ELSE 18 END,
       updated_at = now()
 WHERE p.deleted_at IS NULL
   AND (p.codigo_interno LIKE 'CIM%' OR p.codigo_interno LIKE 'TIN%');

UPDATE public.nfe_itens i
   SET cst_csosn = '500',
       cfop = '5405',
       aliquota_icms = CASE WHEN COALESCE(i.aliquota_icms, 0) > 0 THEN i.aliquota_icms ELSE 18 END
 WHERE EXISTS (
   SELECT 1 FROM public.produtos p
    WHERE p.id = i.produto_id
      AND (p.codigo_interno LIKE 'CIM%' OR p.codigo_interno LIKE 'TIN%')
 );