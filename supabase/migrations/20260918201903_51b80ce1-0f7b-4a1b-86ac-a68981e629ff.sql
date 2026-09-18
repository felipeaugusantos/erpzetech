REVOKE EXECUTE ON FUNCTION public.eh_saas_operador() FROM anon;
REVOKE EXECUTE ON FUNCTION public.saas_gerar_faturas() FROM anon;
REVOKE EXECUTE ON FUNCTION public.saas_baixar_fatura(uuid, numeric, text, date) FROM anon;