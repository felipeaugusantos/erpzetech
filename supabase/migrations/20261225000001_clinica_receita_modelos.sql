-- Modelos de receita da clínica: o veterinário guarda uma prescrição recorrente (medicamentos, posologias e
-- orientações) e aplica com um toque na próxima receita. Sem data nem paciente: é só texto de apoio à emissão,
-- que continua exigindo a revisão e a emissão do veterinário (documento emitido segue imutável).
-- Só o perfil Veterinário lê e escreve, como os demais documentos da clínica. Sem medicamento controlado nos
-- modelos: a emissão recusa controle especial, então o modelo também.

CREATE TABLE IF NOT EXISTS public.pet_receita_modelos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  titulo text NOT NULL CHECK (length(btrim(titulo)) BETWEEN 3 AND 120),
  itens jsonb NOT NULL CHECK (jsonb_typeof(itens) = 'array' AND jsonb_array_length(itens) BETWEEN 1 AND 30),
  orientacoes text CHECK (orientacoes IS NULL OR length(orientacoes) <= 8000),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, titulo)
);
ALTER TABLE public.pet_receita_modelos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pet_receita_modelos FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.pet_receita_modelos TO service_role;
CREATE POLICY salao_restrito ON public.pet_receita_modelos AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT NOT public.eh_salao_restrito()));
DROP TRIGGER IF EXISTS trg_pet_receita_modelos_updated ON public.pet_receita_modelos;
CREATE TRIGGER trg_pet_receita_modelos_updated BEFORE UPDATE ON public.pet_receita_modelos
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Confere e limpa os itens do modelo (mesma régua da emissão); devolve o jsonb pronto para gravar.
CREATE OR REPLACE FUNCTION public._clinica_receita_modelo_itens(p_itens jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  it jsonb;
  v_itens jsonb := '[]'::jsonb;
  v_a text; v_b text; v_c text; v_d text; v_e text;
BEGIN
  IF jsonb_typeof(p_itens) IS DISTINCT FROM 'array' OR jsonb_array_length(p_itens) = 0 THEN
    RAISE EXCEPTION 'O modelo precisa de pelo menos um medicamento';
  END IF;
  IF jsonb_array_length(p_itens) > 30 THEN RAISE EXCEPTION 'Até 30 itens por modelo'; END IF;
  FOR it IN SELECT value FROM jsonb_array_elements(p_itens) LOOP
    IF jsonb_typeof(it) <> 'object' THEN RAISE EXCEPTION 'Item inválido'; END IF;
    IF coalesce(it ->> 'controlado', 'false') NOT IN ('false', 'f', '0', '') THEN
      RAISE EXCEPTION 'Medicamento de controle especial não entra em modelo: a emissão exige receituário próprio';
    END IF;
    v_a := btrim(coalesce(it ->> 'medicamento', ''));
    v_b := btrim(coalesce(it ->> 'posologia', ''));
    v_c := nullif(btrim(coalesce(it ->> 'via', '')), '');
    v_d := nullif(btrim(coalesce(it ->> 'duracao', '')), '');
    v_e := nullif(btrim(coalesce(it ->> 'quantidade', '')), '');
    IF v_a = '' THEN RAISE EXCEPTION 'Informe o nome do medicamento'; END IF;
    IF v_b = '' THEN RAISE EXCEPTION 'Informe a posologia de %', v_a; END IF;
    IF length(v_a) > 120 OR length(v_b) > 400 OR length(coalesce(v_c, '')) > 60 OR length(coalesce(v_d, '')) > 80 OR length(coalesce(v_e, '')) > 80 THEN
      RAISE EXCEPTION 'Algum campo do medicamento % passou do tamanho permitido', v_a;
    END IF;
    v_itens := v_itens || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'medicamento', v_a, 'posologia', v_b, 'via', v_c, 'duracao', v_d, 'quantidade', v_e)));
  END LOOP;
  RETURN v_itens;
END $$;
REVOKE ALL ON FUNCTION public._clinica_receita_modelo_itens(jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.clinica_receita_modelos()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public._clinica_vet();
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', m.id, 'titulo', m.titulo, 'itens', m.itens, 'orientacoes', m.orientacoes) ORDER BY m.titulo)
      FROM public.pet_receita_modelos m
     WHERE m.tenant_id = public.current_tenant_id()
  ), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.clinica_receita_modelos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_receita_modelos() TO authenticated;

-- Mesmo título grava por cima (atualiza o modelo da clínica).
CREATE OR REPLACE FUNCTION public.clinica_receita_modelo_salvar(p_titulo text, p_itens jsonb, p_orientacoes text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_itens jsonb;
  v_id uuid;
BEGIN
  PERFORM public._clinica_vet();
  IF length(btrim(coalesce(p_titulo, ''))) < 3 OR length(btrim(p_titulo)) > 120 THEN
    RAISE EXCEPTION 'O título precisa ter de 3 a 120 caracteres';
  END IF;
  v_itens := public._clinica_receita_modelo_itens(p_itens);
  INSERT INTO public.pet_receita_modelos (tenant_id, titulo, itens, orientacoes, created_by)
  VALUES (v_tenant, btrim(p_titulo), v_itens, nullif(btrim(coalesce(p_orientacoes, '')), ''), auth.uid())
  ON CONFLICT (tenant_id, titulo) DO UPDATE SET itens = EXCLUDED.itens, orientacoes = EXCLUDED.orientacoes
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.clinica_receita_modelo_salvar(text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_receita_modelo_salvar(text, jsonb, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.clinica_receita_modelo_excluir(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public._clinica_vet();
  DELETE FROM public.pet_receita_modelos WHERE id = p_id AND tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Modelo não encontrado'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.clinica_receita_modelo_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_receita_modelo_excluir(uuid) TO authenticated;
