-- As tabelas antigas `assinaturas` e `assinatura_faturas` deixaram de ser usadas: a tela /planos lê a assinatura real
-- (assinatura_resumo, migração 20270125) e a cobrança vive em saas_clientes/saas_faturas. Como a própria empresa conseguia gravar
-- nelas (inclusive marcar a própria fatura como paga), a escrita é retirada: nenhum usuário (nem anônimo) insere, altera ou apaga.
-- A leitura continua (a função assinatura_taxa_inicial ainda lê `assinaturas`) e o serviço segue com acesso total.
-- Reaplicável.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.assinaturas FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.assinatura_faturas FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS "assinaturas_insert" ON public.assinaturas;
DROP POLICY IF EXISTS "assinaturas_update" ON public.assinaturas;
DROP POLICY IF EXISTS "assinatura_faturas_insert" ON public.assinatura_faturas;
DROP POLICY IF EXISTS "assinatura_faturas_update" ON public.assinatura_faturas;

-- Lançava mensalidade e filiais extras nas tabelas antigas para a empresa que a chamasse (SECURITY DEFINER). Sem uso desde a tela nova.
REVOKE EXECUTE ON FUNCTION public.gerar_faturas_assinatura() FROM PUBLIC, anon, authenticated;
