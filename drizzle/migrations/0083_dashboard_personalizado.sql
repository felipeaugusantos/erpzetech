-- Dashboard personalizado por empresa: a administração (administrador ou gestor) liga, desliga e reordena as peças do dashboard.
-- Uma configuração (JSON pequeno) por empresa e por painel (hoje só 'pet': clínica e pet shop). Sem acesso direto à tabela: tudo por
-- funções. O app valida o conteúdo (src/lib/dashboard-personalizado.ts); aqui o banco confere o formato geral e o tamanho.
CREATE TABLE IF NOT EXISTS public.dashboard_personalizado (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  painel text NOT NULL CHECK (painel IN ('pet')),
  config jsonb NOT NULL CHECK (jsonb_typeof(config) = 'object' AND length(config::text) <= 5000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  PRIMARY KEY (tenant_id, painel)
);
ALTER TABLE public.dashboard_personalizado ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dashboard_personalizado FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.dashboard_personalizado TO service_role;
CREATE POLICY salao_restrito ON public.dashboard_personalizado AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT NOT public.eh_salao_restrito()));

-- Lê a configuração da própria empresa (null = dashboard padrão). Qualquer pessoa da empresa: o dashboard vale para todos.
CREATE OR REPLACE FUNCTION public.dashboard_personalizado_obter(p_painel text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT d.config FROM public.dashboard_personalizado d
   WHERE d.tenant_id = public.current_tenant_id() AND d.painel = p_painel
$fn$;
REVOKE ALL ON FUNCTION public.dashboard_personalizado_obter(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_personalizado_obter(text) TO authenticated;

-- Grava a configuração: administrador ou gestor. Formato geral: objeto, versão 1, só as chaves conhecidas, listas de textos, até 5 mil caracteres.
CREATE OR REPLACE FUNCTION public.dashboard_personalizado_salvar(p_painel text, p_config jsonb)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_tenant uuid;
  v_chave text;
  v_lista text;
  v_em timestamptz;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Empresa não encontrada'; END IF;
  IF p_painel IS DISTINCT FROM 'pet' THEN RAISE EXCEPTION 'Painel do dashboard desconhecido'; END IF;
  IF p_config IS NULL OR jsonb_typeof(p_config) <> 'object' THEN
    RAISE EXCEPTION 'Configuração do dashboard inválida';
  END IF;
  IF length(p_config::text) > 5000 THEN RAISE EXCEPTION 'Configuração do dashboard grande demais'; END IF;
  IF p_config -> 'versao' IS DISTINCT FROM to_jsonb(1) THEN
    RAISE EXCEPTION 'Versão da configuração do dashboard não suportada';
  END IF;
  FOR v_chave IN SELECT jsonb_object_keys(p_config) LOOP
    IF v_chave NOT IN ('versao', 'ordem', 'ocultos') THEN
      RAISE EXCEPTION 'Configuração do dashboard com campo desconhecido: %', v_chave;
    END IF;
  END LOOP;
  FOREACH v_lista IN ARRAY ARRAY['ordem', 'ocultos'] LOOP
    IF p_config ? v_lista THEN
      IF jsonb_typeof(p_config -> v_lista) <> 'array' THEN
        RAISE EXCEPTION 'Configuração do dashboard com formato inválido';
      END IF;
      IF jsonb_array_length(p_config -> v_lista) > 40
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_config -> v_lista) e WHERE jsonb_typeof(e) <> 'string') THEN
        RAISE EXCEPTION 'Configuração do dashboard com formato inválido';
      END IF;
    END IF;
  END LOOP;
  INSERT INTO public.dashboard_personalizado (tenant_id, painel, config, updated_at, updated_by)
  VALUES (v_tenant, p_painel, p_config, clock_timestamp(), auth.uid())
  ON CONFLICT (tenant_id, painel) DO UPDATE
    SET config = EXCLUDED.config, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by
  RETURNING updated_at INTO v_em;
  RETURN v_em;
END $fn$;
REVOKE ALL ON FUNCTION public.dashboard_personalizado_salvar(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_personalizado_salvar(text, jsonb) TO authenticated;

-- Volta ao dashboard padrão (apaga a configuração do painel): administrador ou gestor.
CREATE OR REPLACE FUNCTION public.dashboard_personalizado_restaurar(p_painel text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  DELETE FROM public.dashboard_personalizado
   WHERE tenant_id = public.current_tenant_id() AND painel = p_painel;
END $fn$;
REVOKE ALL ON FUNCTION public.dashboard_personalizado_restaurar(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_personalizado_restaurar(text) TO authenticated;
