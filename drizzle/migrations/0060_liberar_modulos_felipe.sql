UPDATE public.empresas
SET cnae_secundarios = cnae_secundarios || ', 5611-2/01, 7500-1/00, 4789-0/04, 9609-2/08, 7732-2/01',
    faz_personalizacao = true
WHERE id = '22222222-2222-2222-2222-222222222222';