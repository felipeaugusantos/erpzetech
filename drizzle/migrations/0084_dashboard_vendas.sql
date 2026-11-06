-- Dashboard de vendas: a tabela e a gravação passam a aceitar o painel 'vendas' (empresas que não são clínica nem pet shop), além do 'pet'.
-- Só amplia a lista de painéis; nada muda para quem já tem configuração do painel 'pet'.
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.dashboard_personalizado'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) LIKE '%painel%' LOOP
    EXECUTE format('ALTER TABLE public.dashboard_personalizado DROP CONSTRAINT %I', c.conname);
  END LOOP;
  ALTER TABLE public.dashboard_personalizado ADD CONSTRAINT dashboard_personalizado_painel_check CHECK (painel IN ('pet', 'vendas'));
END $$;

-- Grava a configuração (painéis 'pet' e 'vendas'): administrador ou gestor. Formato geral: objeto, versão 1, só as chaves conhecidas, listas de textos, até 5 mil caracteres.
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
  IF p_painel IS NULL OR p_painel NOT IN ('pet', 'vendas') THEN RAISE EXCEPTION 'Painel do dashboard desconhecido'; END IF;
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
