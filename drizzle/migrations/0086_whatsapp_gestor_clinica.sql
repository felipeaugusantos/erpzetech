CREATE OR REPLACE FUNCTION public.wa_exige_gestor()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $fn$
BEGIN
  PERFORM public.exige_nao_contador();
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  IF NOT (public.clinica_liberada() OR public.lava_rapido_liberado()) THEN
    RAISE EXCEPTION 'O WhatsApp exige o módulo Clínica ou Lava rápido liberado para esta empresa';
  END IF;
  RETURN public.current_tenant_id();
END $fn$;
REVOKE ALL ON FUNCTION public.wa_exige_gestor() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wa_exige_gestor() TO authenticated;
COMMENT ON FUNCTION public.wa_exige_gestor() IS 'Autoriza a conexão compartilhada do WhatsApp para administrador ou gestor da própria clínica ou lava rápido. A lista de empresas permitidas continua verificada no servidor.';