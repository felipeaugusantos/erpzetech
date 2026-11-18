REVOKE ALL ON public.clinica_wa_testes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.clinica_wa_testes TO authenticated;
GRANT ALL ON public.clinica_wa_testes TO service_role;
REVOKE ALL ON public.clinica_wa_teste_status FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.clinica_wa_teste_status TO service_role;