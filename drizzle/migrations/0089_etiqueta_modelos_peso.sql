-- Modelos de etiqueta: o campo "peso" (peso e preço do kg, para produto vendido por balança) e até 5 campos por modelo.
-- A função é a mesma da 0088 com estes dois ajustes; a 0088 já pode estar aplicada, por isso a mudança vem numa migração
-- nova e reaplicável (CREATE OR REPLACE).
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
  IF jsonb_typeof(p_config -> 'campos') IS DISTINCT FROM 'array' OR jsonb_array_length(p_config -> 'campos') NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'Escolha de 1 a 5 campos para a etiqueta';
  END IF;
  FOR v_campo IN SELECT jsonb_array_elements(p_config -> 'campos') LOOP
    IF jsonb_typeof(v_campo) IS DISTINCT FROM 'object' OR (v_campo ->> 'campo') IS NULL
       OR (v_campo ->> 'campo') NOT IN ('descricao', 'extra', 'preco', 'codigo', 'peso')
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

SELECT public._contador_travas_funcoes();
