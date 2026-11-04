-- Conteúdo clínico próprio da empresa sobre cada medicamento do bulário: apresentações, indicações e contraindicações,
-- doses, interações e observações. O MAPA só traz o registro do produto; este texto é da clínica (escrito por ela, não copiado
-- de terceiros) e vale só para a empresa que o escreveu. Administrador, gestor e veterinário leem e escrevem, como o bulário.
-- Texto de apoio: não preenche receita nem estoque sozinho.

CREATE TABLE IF NOT EXISTS public.bulario_notas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  medicamento_id uuid NOT NULL REFERENCES public.bulario_medicamentos(id) ON DELETE CASCADE,
  apresentacoes text CHECK (apresentacoes IS NULL OR length(apresentacoes) <= 6000),
  indicacoes text CHECK (indicacoes IS NULL OR length(indicacoes) <= 6000),
  doses text CHECK (doses IS NULL OR length(doses) <= 6000),
  interacoes text CHECK (interacoes IS NULL OR length(interacoes) <= 6000),
  observacoes text CHECK (observacoes IS NULL OR length(observacoes) <= 6000),
  updated_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, medicamento_id)
);
ALTER TABLE public.bulario_notas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bulario_notas FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.bulario_notas TO service_role;
CREATE POLICY salao_restrito ON public.bulario_notas AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT NOT public.eh_salao_restrito()));
DROP TRIGGER IF EXISTS trg_bulario_notas_updated ON public.bulario_notas;
CREATE TRIGGER trg_bulario_notas_updated BEFORE UPDATE ON public.bulario_notas
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Ficha: o produto do MAPA e, se a empresa escreveu, a nota dela (nunca a de outra empresa).
CREATE OR REPLACE FUNCTION public.bulario_ficha(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_med jsonb; v_nota jsonb;
BEGIN
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'veterinario']);
  IF NOT public.clinica_liberada() THEN RAISE EXCEPTION 'A clínica não está liberada para esta empresa'; END IF;
  SELECT jsonb_build_object(
           'id', b.id, 'registro', b.registro, 'nome', b.nome, 'fabricante', b.fabricante,
           'principio_ativo', b.principio_ativo, 'especies', b.especies, 'classificacao', b.classificacao,
           'situacao', b.situacao, 'extras', b.extras)
    INTO v_med FROM public.bulario_medicamentos b WHERE b.id = p_id;
  IF v_med IS NULL THEN RAISE EXCEPTION 'Medicamento não encontrado no bulário'; END IF;
  SELECT jsonb_build_object(
           'apresentacoes', n.apresentacoes, 'indicacoes', n.indicacoes, 'doses', n.doses,
           'interacoes', n.interacoes, 'observacoes', n.observacoes, 'updated_at', n.updated_at)
    INTO v_nota FROM public.bulario_notas n
   WHERE n.medicamento_id = p_id AND n.tenant_id = public.current_tenant_id();
  RETURN jsonb_build_object('medicamento', v_med, 'nota', v_nota);
END $$;
REVOKE ALL ON FUNCTION public.bulario_ficha(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulario_ficha(uuid) TO authenticated;

-- Salva a nota da empresa (tudo em branco apaga a nota). Cada campo tem até 6000 caracteres.
CREATE OR REPLACE FUNCTION public.bulario_nota_salvar(p_id uuid, p_dados jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ap text; v_in text; v_do text; v_it text; v_ob text;
BEGIN
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'veterinario']);
  IF NOT public.clinica_liberada() THEN RAISE EXCEPTION 'A clínica não está liberada para esta empresa'; END IF;
  IF jsonb_typeof(p_dados) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Dados inválidos'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bulario_medicamentos WHERE id = p_id) THEN
    RAISE EXCEPTION 'Medicamento não encontrado no bulário';
  END IF;
  v_ap := nullif(btrim(coalesce(p_dados ->> 'apresentacoes', '')), '');
  v_in := nullif(btrim(coalesce(p_dados ->> 'indicacoes', '')), '');
  v_do := nullif(btrim(coalesce(p_dados ->> 'doses', '')), '');
  v_it := nullif(btrim(coalesce(p_dados ->> 'interacoes', '')), '');
  v_ob := nullif(btrim(coalesce(p_dados ->> 'observacoes', '')), '');
  IF greatest(length(coalesce(v_ap, '')), length(coalesce(v_in, '')), length(coalesce(v_do, '')),
              length(coalesce(v_it, '')), length(coalesce(v_ob, ''))) > 6000 THEN
    RAISE EXCEPTION 'Cada campo aceita até 6000 caracteres';
  END IF;
  IF v_ap IS NULL AND v_in IS NULL AND v_do IS NULL AND v_it IS NULL AND v_ob IS NULL THEN
    DELETE FROM public.bulario_notas WHERE medicamento_id = p_id AND tenant_id = public.current_tenant_id();
    RETURN;
  END IF;
  INSERT INTO public.bulario_notas (tenant_id, medicamento_id, apresentacoes, indicacoes, doses, interacoes, observacoes)
  VALUES (public.current_tenant_id(), p_id, v_ap, v_in, v_do, v_it, v_ob)
  ON CONFLICT (tenant_id, medicamento_id) DO UPDATE SET
    apresentacoes = EXCLUDED.apresentacoes, indicacoes = EXCLUDED.indicacoes, doses = EXCLUDED.doses,
    interacoes = EXCLUDED.interacoes, observacoes = EXCLUDED.observacoes, updated_by = auth.uid();
END $$;
REVOKE ALL ON FUNCTION public.bulario_nota_salvar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulario_nota_salvar(uuid, jsonb) TO authenticated;
