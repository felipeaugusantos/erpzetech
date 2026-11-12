-- Modelos de etiqueta da empresa (tamanho, tipo e campos): vários por empresa, lidos por qualquer pessoa da empresa (quem
-- imprime etiqueta) e gravados só pela administração (administrador ou gestor). A tabela não tem acesso direto: tudo passa
-- por funções. O app valida o conteúdo em detalhe (src/lib/etiqueta-modelo.ts); aqui o banco confere o formato geral,
-- as medidas e o tamanho, para nada fora do esperado ficar gravado.
CREATE TABLE IF NOT EXISTS public.etiqueta_modelos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (length(nome) BETWEEN 2 AND 60 AND nome = btrim(nome)),
  config jsonb NOT NULL CHECK (jsonb_typeof(config) = 'object' AND length(config::text) <= 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS etiqueta_modelos_nome_uk ON public.etiqueta_modelos (tenant_id, lower(nome));
ALTER TABLE public.etiqueta_modelos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.etiqueta_modelos FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.etiqueta_modelos TO service_role;
DROP POLICY IF EXISTS salao_restrito ON public.etiqueta_modelos;
CREATE POLICY salao_restrito ON public.etiqueta_modelos AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT NOT public.eh_salao_restrito()));

-- Lista os modelos da própria empresa (qualquer pessoa da empresa, exceto o perfil restrito do salão).
CREATE OR REPLACE FUNCTION public.etiqueta_modelos_listar()
RETURNS TABLE (id uuid, nome text, config jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  PERFORM public.exige_nao_salao();
  RETURN QUERY
    SELECT m.id, m.nome, m.config
      FROM public.etiqueta_modelos m
     WHERE m.tenant_id = public.current_tenant_id()
     ORDER BY lower(m.nome);
END $fn$;
REVOKE ALL ON FUNCTION public.etiqueta_modelos_listar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.etiqueta_modelos_listar() TO authenticated;

-- Cria (p_id nulo) ou altera um modelo da própria empresa: administrador ou gestor. Até 30 modelos por empresa.
CREATE OR REPLACE FUNCTION public.etiqueta_modelo_salvar(p_id uuid, p_nome text, p_config jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_tenant uuid;
  v_nome text := btrim(coalesce(p_nome, ''));
  v_chave text;
  v_tipo text;
  v_id uuid;
  v_larg numeric;
  v_alt numeric;
  v_campo jsonb;
  v_vistos text[] := '{}';
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Empresa não encontrada'; END IF;
  IF length(v_nome) < 2 OR length(v_nome) > 60 THEN RAISE EXCEPTION 'O nome do modelo precisa ter de 2 a 60 letras'; END IF;
  IF p_config IS NULL OR jsonb_typeof(p_config) <> 'object' THEN RAISE EXCEPTION 'Modelo de etiqueta inválido'; END IF;
  IF length(p_config::text) > 4000 THEN RAISE EXCEPTION 'Modelo de etiqueta grande demais'; END IF;
  IF p_config -> 'versao' IS DISTINCT FROM to_jsonb(1) THEN RAISE EXCEPTION 'Versão do modelo de etiqueta não suportada'; END IF;
  FOR v_chave IN SELECT jsonb_object_keys(p_config) LOOP
    IF v_chave NOT IN ('versao', 'tipo', 'larguraMm', 'alturaMm', 'campos', 'colunas', 'linhas',
                       'margemSuperiorMm', 'margemEsquerdaMm', 'espacoHMm', 'espacoVMm') THEN
      RAISE EXCEPTION 'Modelo de etiqueta com campo desconhecido: %', v_chave;
    END IF;
  END LOOP;
  v_tipo := p_config ->> 'tipo';
  IF v_tipo IS NULL OR v_tipo NOT IN ('termica', 'folha') THEN RAISE EXCEPTION 'Tipo de etiqueta inválido'; END IF;
  IF jsonb_typeof(p_config -> 'larguraMm') IS DISTINCT FROM 'number' OR jsonb_typeof(p_config -> 'alturaMm') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'Medidas da etiqueta inválidas';
  END IF;
  v_larg := (p_config ->> 'larguraMm')::numeric;
  v_alt := (p_config ->> 'alturaMm')::numeric;
  IF v_larg < 10 OR v_larg > 200 OR v_alt < 8 OR v_alt > 300 THEN RAISE EXCEPTION 'Medidas da etiqueta fora do limite'; END IF;
  IF jsonb_typeof(p_config -> 'campos') IS DISTINCT FROM 'array' OR jsonb_array_length(p_config -> 'campos') NOT BETWEEN 1 AND 4 THEN
    RAISE EXCEPTION 'Escolha de 1 a 4 campos para a etiqueta';
  END IF;
  FOR v_campo IN SELECT jsonb_array_elements(p_config -> 'campos') LOOP
    IF jsonb_typeof(v_campo) IS DISTINCT FROM 'object' OR (v_campo ->> 'campo') IS NULL
       OR (v_campo ->> 'campo') NOT IN ('descricao', 'extra', 'preco', 'codigo')
       OR ((v_campo ->> 'campo') = ANY (v_vistos))
       OR (v_campo ? 'tamanho' AND (v_campo ->> 'tamanho') NOT IN ('p', 'm', 'g')) THEN
      RAISE EXCEPTION 'Campo de etiqueta inválido ou repetido';
    END IF;
    v_vistos := v_vistos || (v_campo ->> 'campo');
  END LOOP;
  IF v_tipo = 'folha' THEN
    IF jsonb_typeof(p_config -> 'colunas') IS DISTINCT FROM 'number' OR jsonb_typeof(p_config -> 'linhas') IS DISTINCT FROM 'number'
       OR (p_config ->> 'colunas')::numeric NOT BETWEEN 1 AND 8 OR (p_config ->> 'linhas')::numeric NOT BETWEEN 1 AND 30 THEN
      RAISE EXCEPTION 'Colunas e linhas da folha inválidas';
    END IF;
  END IF;

  IF p_id IS NULL THEN
    IF (SELECT count(*) FROM public.etiqueta_modelos WHERE tenant_id = v_tenant) >= 30 THEN
      RAISE EXCEPTION 'Limite de 30 modelos de etiqueta por empresa';
    END IF;
    INSERT INTO public.etiqueta_modelos (tenant_id, nome, config, updated_by)
    VALUES (v_tenant, v_nome, p_config, auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.etiqueta_modelos
       SET nome = v_nome, config = p_config, updated_at = clock_timestamp(), updated_by = auth.uid()
     WHERE id = p_id AND tenant_id = v_tenant
     RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Modelo de etiqueta não encontrado'; END IF;
  END IF;
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Já existe um modelo de etiqueta com esse nome';
END $fn$;
REVOKE ALL ON FUNCTION public.etiqueta_modelo_salvar(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.etiqueta_modelo_salvar(uuid, text, jsonb) TO authenticated;

-- Exclui um modelo da própria empresa: administrador ou gestor. Nada mais referencia o modelo.
CREATE OR REPLACE FUNCTION public.etiqueta_modelo_excluir(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_n integer;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  DELETE FROM public.etiqueta_modelos WHERE id = p_id AND tenant_id = public.current_tenant_id();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RAISE EXCEPTION 'Modelo de etiqueta não encontrado'; END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.etiqueta_modelo_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.etiqueta_modelo_excluir(uuid) TO authenticated;

-- Contador: a tabela e as funções novas recebem as mesmas travas das demais (reaplicável, como na 0087).
SELECT public._contador_travas_tabelas();
SELECT public._contador_travas_funcoes();
