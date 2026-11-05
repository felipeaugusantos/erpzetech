-- Menu personalizado por empresa: uma configuração (JSON) por empresa, lida por qualquer pessoa da empresa e gravada só pela
-- administração (administrador ou gestor). A tabela não tem acesso direto: tudo passa por funções. O app valida o conteúdo
-- (src/lib/menu-personalizado.ts); aqui o banco só confere o formato geral e o tamanho (até 20 mil caracteres).
CREATE TABLE IF NOT EXISTS public.menu_personalizado (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  config jsonb NOT NULL CHECK (jsonb_typeof(config) = 'object' AND length(config::text) <= 20000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
ALTER TABLE public.menu_personalizado ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.menu_personalizado FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.menu_personalizado TO service_role;
CREATE POLICY salao_restrito ON public.menu_personalizado AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT NOT public.eh_salao_restrito()));

-- Lê a configuração da própria empresa (null = menu padrão). Qualquer pessoa da empresa, porque o menu vale para todos.
CREATE OR REPLACE FUNCTION public.menu_personalizado_obter()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT m.config FROM public.menu_personalizado m WHERE m.tenant_id = public.current_tenant_id()
$fn$;
REVOKE ALL ON FUNCTION public.menu_personalizado_obter() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.menu_personalizado_obter() TO authenticated;

-- Grava a configuração da empresa: administrador ou gestor. Formato geral: objeto, versão 1, só as chaves conhecidas, no máximo 20 mil caracteres.
CREATE OR REPLACE FUNCTION public.menu_personalizado_salvar(p_config jsonb)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_tenant uuid;
  v_chave text;
  v_em timestamptz;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Empresa não encontrada'; END IF;
  IF p_config IS NULL OR jsonb_typeof(p_config) <> 'object' THEN
    RAISE EXCEPTION 'Configuração do menu inválida';
  END IF;
  IF length(p_config::text) > 20000 THEN
    RAISE EXCEPTION 'Configuração do menu grande demais';
  END IF;
  IF p_config -> 'versao' IS DISTINCT FROM to_jsonb(1) THEN
    RAISE EXCEPTION 'Versão da configuração do menu não suportada';
  END IF;
  FOR v_chave IN SELECT jsonb_object_keys(p_config) LOOP
    IF v_chave NOT IN ('versao', 'ocultos', 'areas', 'ordemAreas', 'itens', 'ordemItens') THEN
      RAISE EXCEPTION 'Configuração do menu com campo desconhecido: %', v_chave;
    END IF;
  END LOOP;
  IF (p_config ? 'ocultos' AND jsonb_typeof(p_config -> 'ocultos') <> 'array')
     OR (p_config ? 'areas' AND jsonb_typeof(p_config -> 'areas') <> 'array')
     OR (p_config ? 'ordemAreas' AND jsonb_typeof(p_config -> 'ordemAreas') <> 'array')
     OR (p_config ? 'itens' AND jsonb_typeof(p_config -> 'itens') <> 'object')
     OR (p_config ? 'ordemItens' AND jsonb_typeof(p_config -> 'ordemItens') <> 'object') THEN
    RAISE EXCEPTION 'Configuração do menu com formato inválido';
  END IF;
  INSERT INTO public.menu_personalizado (tenant_id, config, updated_at, updated_by)
  VALUES (v_tenant, p_config, clock_timestamp(), auth.uid())
  ON CONFLICT (tenant_id) DO UPDATE
    SET config = EXCLUDED.config, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by
  RETURNING updated_at INTO v_em;
  RETURN v_em;
END $fn$;
REVOKE ALL ON FUNCTION public.menu_personalizado_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.menu_personalizado_salvar(jsonb) TO authenticated;

-- Volta ao menu padrão (apaga a configuração da empresa): administrador ou gestor.
CREATE OR REPLACE FUNCTION public.menu_personalizado_restaurar()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  DELETE FROM public.menu_personalizado WHERE tenant_id = public.current_tenant_id();
END $fn$;
REVOKE ALL ON FUNCTION public.menu_personalizado_restaurar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.menu_personalizado_restaurar() TO authenticated;
