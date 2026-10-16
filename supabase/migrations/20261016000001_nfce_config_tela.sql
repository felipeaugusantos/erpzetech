-- Fase 2: tela de configuração da NFC-e (CSC, série e contingência manual).
-- A tela lê e grava só por estas funções: o token do CSC nunca volta para o navegador (a lista informa apenas se está
-- configurado) e o contador de numeração continua só do banco.

-- CSC no formato aceito: código de 1 a 6 dígitos; token de 16 a 40 letras e números.
ALTER TABLE public.nfce_config DROP CONSTRAINT IF EXISTS nfce_config_csc_formato;
ALTER TABLE public.nfce_config ADD CONSTRAINT nfce_config_csc_formato CHECK (
  (csc_id IS NULL OR csc_id ~ '^[0-9]{1,6}$')
  AND (csc_token IS NULL OR csc_token ~ '^[A-Za-z0-9]{16,40}$'));

CREATE OR REPLACE FUNCTION public.nfce_config_listar()
RETURNS TABLE (
  fiscal_config_id uuid, filial_id uuid, filial_nome text, ambiente text, emissor text, certificado_nome text,
  serie integer, proximo_numero integer, csc_id text, csc_configurado boolean, contingencia_ativa boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  RETURN QUERY
    SELECT f.id, f.filial_id, coalesce(fi.nome, 'Empresa (padrão)'), f.ambiente, f.emissor, f.certificado_nome,
           coalesce(n.serie, 1), coalesce(n.proximo_numero, 1), n.csc_id,
           (coalesce(n.csc_id, '') <> '' AND coalesce(n.csc_token, '') <> ''),
           coalesce(n.contingencia_ativa, false)
      FROM public.fiscal_config f
      LEFT JOIN public.filiais fi ON fi.id = f.filial_id
      LEFT JOIN public.nfce_config n ON n.fiscal_config_id = f.id
     WHERE f.tenant_id = public.current_tenant_id()
       AND public.pode_filial(f.filial_id)
     ORDER BY (f.filial_id IS NOT NULL), fi.nome;
END $$;
REVOKE ALL ON FUNCTION public.nfce_config_listar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nfce_config_listar() TO authenticated;

-- Token em branco mantém o que já está guardado. O contador não muda por aqui.
CREATE OR REPLACE FUNCTION public.nfce_config_salvar(
  p_fiscal_config_id uuid, p_serie integer, p_csc_id text, p_csc_token text DEFAULT NULL,
  p_contingencia boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_filial uuid;
  v_id text := nullif(btrim(coalesce(p_csc_id, '')), '');
  v_token text := nullif(btrim(coalesce(p_csc_token, '')), '');
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  SELECT filial_id INTO v_filial FROM public.fiscal_config WHERE id = p_fiscal_config_id AND tenant_id = v_tenant;
  IF NOT FOUND OR NOT public.pode_filial(v_filial) THEN RAISE EXCEPTION 'Configuração fiscal não encontrada'; END IF;
  IF p_serie IS NULL OR p_serie < 0 OR p_serie > 999 THEN RAISE EXCEPTION 'A série deve estar entre 0 e 999'; END IF;
  IF v_id IS NOT NULL AND v_id !~ '^[0-9]{1,6}$' THEN
    RAISE EXCEPTION 'O código do CSC tem de 1 a 6 números';
  END IF;
  IF v_token IS NOT NULL AND v_token !~ '^[A-Za-z0-9]{16,40}$' THEN
    RAISE EXCEPTION 'O token do CSC tem de 16 a 40 letras e números';
  END IF;

  INSERT INTO public.nfce_config (tenant_id, fiscal_config_id, serie, csc_id, csc_token, contingencia_ativa)
  VALUES (v_tenant, p_fiscal_config_id, p_serie, v_id, v_token, coalesce(p_contingencia, false))
  ON CONFLICT (fiscal_config_id) DO UPDATE
     SET serie = EXCLUDED.serie,
         csc_id = EXCLUDED.csc_id,
         csc_token = coalesce(EXCLUDED.csc_token, public.nfce_config.csc_token),
         contingencia_ativa = EXCLUDED.contingencia_ativa;
END $$;
REVOKE ALL ON FUNCTION public.nfce_config_salvar(uuid, integer, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nfce_config_salvar(uuid, integer, text, text, boolean) TO authenticated;
