UPDATE public.produtos SET custo = v.custo FROM (VALUES
 ('ARG001', 18.4000), ('ARE001', 75.0000), ('TEL002', 2.3000), ('HID004', 42.0000),
 ('PED002', 84.0000), ('TIN002', 118.0000), ('POR001', 52.0000), ('REV001', 31.0000),
 ('HID002', 32.0000), ('ARE002', 72.0000)
) AS v(codigo, custo) WHERE produtos.codigo_interno = v.codigo;

UPDATE public.compra_itens ci SET custo_unitario = p.custo, total = ci.quantidade * p.custo
FROM public.compras c, public.produtos p
WHERE ci.compra_id = c.id AND p.id = ci.produto_id AND c.numero = 3;

UPDATE public.compras SET situacao = 'cancelado'::compra_situacao WHERE numero IN (2, 3);