-- Apaga as tabelas antigas `assinaturas` e `assinatura_faturas` e as funções que só existiam para elas. A assinatura real vive em
-- saas_clientes/saas_planos/saas_faturas, a tela /planos lê assinatura_resumo (migração 20270125) e a escrita das tabelas antigas já
-- tinha sido retirada (20270126). IRREVERSÍVEL: antes de aplicar, guarde uma cópia se quiser o histórico antigo, por exemplo
--   COPY (SELECT * FROM public.assinatura_faturas) TO STDOUT WITH CSV HEADER;
-- Sem CASCADE de propósito: se algum outro objeto ainda depender delas, a migração falha e mostra qual, em vez de apagá-lo junto.
-- Reaplicável (IF EXISTS).
DROP FUNCTION IF EXISTS public.gerar_faturas_assinatura();
DROP FUNCTION IF EXISTS public.assinatura_taxa_inicial();
DROP TABLE IF EXISTS public.assinatura_faturas;
DROP TABLE IF EXISTS public.assinaturas;
