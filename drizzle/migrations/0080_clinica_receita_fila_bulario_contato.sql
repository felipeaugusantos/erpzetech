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

CREATE TABLE IF NOT EXISTS public.clinica_fila (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  pet_id uuid NOT NULL REFERENCES public.pets(id),
  agendamento_id uuid REFERENCES public.pet_agendamentos(id),
  chegada_em timestamptz NOT NULL DEFAULT now(),
  gravidade text NOT NULL DEFAULT 'comum' CHECK (gravidade IN ('emergencia', 'urgente', 'comum')),
  queixa text CHECK (queixa IS NULL OR length(queixa) <= 300),
  situacao text NOT NULL DEFAULT 'aguardando' CHECK (situacao IN ('aguardando', 'em_atendimento', 'atendido', 'desistiu')),
  profissional_id uuid REFERENCES public.pet_profissionais(id),
  chamado_em timestamptz,
  encerrado_em timestamptz,
  observacoes text CHECK (observacoes IS NULL OR length(observacoes) <= 300),
  registrado_por uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((situacao IN ('atendido', 'desistiu')) = (encerrado_em IS NOT NULL)),
  CHECK (situacao <> 'em_atendimento' OR chamado_em IS NOT NULL),
  CHECK (chamado_em IS NULL OR situacao <> 'aguardando')
);
CREATE UNIQUE INDEX IF NOT EXISTS clinica_fila_agendamento_idx ON public.clinica_fila (tenant_id, agendamento_id) WHERE agendamento_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS clinica_fila_pet_aberto_idx ON public.clinica_fila (tenant_id, pet_id) WHERE situacao IN ('aguardando', 'em_atendimento');
CREATE INDEX IF NOT EXISTS clinica_fila_dia_idx ON public.clinica_fila (tenant_id, chegada_em);

ALTER TABLE public.clinica_fila ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.clinica_fila FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.clinica_fila TO service_role;
CREATE POLICY salao_restrito ON public.clinica_fila AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT NOT public.eh_salao_restrito()));
DROP TRIGGER IF EXISTS trg_clinica_fila_updated ON public.clinica_fila;
CREATE TRIGGER trg_clinica_fila_updated BEFORE UPDATE ON public.clinica_fila
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public._clinica_fila_exige_equipe()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  IF NOT public.clinica_liberada() THEN RAISE EXCEPTION 'A clínica não está liberada para esta empresa'; END IF;
END $$;
REVOKE ALL ON FUNCTION public._clinica_fila_exige_equipe() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._clinica_fila_acesso()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF public.eh_salao_restrito() THEN
    PERFORM public._clinica_vet();
  ELSE
    PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  END IF;
  IF NOT public.clinica_liberada() THEN RAISE EXCEPTION 'A clínica não está liberada para esta empresa'; END IF;
END $$;
REVOKE ALL ON FUNCTION public._clinica_fila_acesso() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._clinica_fila_json(p_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
      'id', f.id, 'situacao', f.situacao, 'gravidade', f.gravidade, 'queixa', f.queixa,
      'chegada_em', f.chegada_em, 'chamado_em', f.chamado_em, 'encerrado_em', f.encerrado_em,
      'observacoes', f.observacoes, 'agendamento_id', f.agendamento_id,
      'pet', jsonb_build_object('id', pt.id, 'nome', pt.nome, 'especie', pt.especie, 'raca', pt.raca, 'alergias', pt.alergias),
      'tutor', c.nome,
      'profissional', (SELECT nome FROM public.pet_profissionais p WHERE p.id = f.profissional_id))
    FROM public.clinica_fila f
    JOIN public.pets pt ON pt.id = f.pet_id
    JOIN public.clientes c ON c.id = pt.cliente_id
   WHERE f.id = p_id AND f.tenant_id = public.current_tenant_id()
$$;
REVOKE ALL ON FUNCTION public._clinica_fila_json(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.clinica_fila_listar(p_data date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_dia date := coalesce(p_data, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  v_ini timestamptz := v_dia::timestamp AT TIME ZONE 'America/Sao_Paulo';
  v_fim timestamptz := (v_dia + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo';
BEGIN
  PERFORM public._clinica_fila_acesso();
  RETURN jsonb_build_object(
    'dia', v_dia,
    'fila', coalesce((
      SELECT jsonb_agg(public._clinica_fila_json(f.id) ORDER BY
                       CASE f.situacao WHEN 'aguardando' THEN 0 WHEN 'em_atendimento' THEN 1 ELSE 2 END,
                       CASE WHEN f.situacao = 'aguardando' THEN CASE f.gravidade WHEN 'emergencia' THEN 0 WHEN 'urgente' THEN 1 ELSE 2 END END,
                       f.chegada_em)
        FROM public.clinica_fila f
       WHERE f.tenant_id = v_tenant AND f.chegada_em >= v_ini AND f.chegada_em < v_fim
    ), '[]'::jsonb),
    'consultas', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'agendamento_id', a.id, 'inicio', a.inicio, 'situacao', a.situacao,
               'pet', jsonb_build_object('id', pt.id, 'nome', pt.nome, 'especie', pt.especie),
               'tutor', c.nome, 'profissional', pr.nome) ORDER BY a.inicio)
        FROM public.pet_agendamentos a
        JOIN public.pets pt ON pt.id = a.pet_id
        JOIN public.clientes c ON c.id = a.cliente_id
        JOIN public.pet_profissionais pr ON pr.id = a.profissional_id
       WHERE a.tenant_id = v_tenant AND a.inicio >= v_ini AND a.inicio < v_fim
         AND a.situacao IN ('agendado', 'confirmado', 'em_atendimento') AND pt.ativo
         AND EXISTS (SELECT 1 FROM public.pet_agendamento_itens i JOIN public.pet_servicos s ON s.id = i.servico_id
                      WHERE i.agendamento_id = a.id AND s.categoria = 'consulta')
         AND NOT EXISTS (SELECT 1 FROM public.clinica_fila f WHERE f.tenant_id = v_tenant AND f.agendamento_id = a.id)
    ), '[]'::jsonb)
  );
END $$;
REVOKE ALL ON FUNCTION public.clinica_fila_listar(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_fila_listar(date) TO authenticated;

CREATE OR REPLACE FUNCTION public.clinica_fila_buscar_paciente(p_busca text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_busca text := btrim(coalesce(p_busca, ''));
BEGIN
  PERFORM public._clinica_fila_exige_equipe();
  IF length(v_busca) < 2 THEN RAISE EXCEPTION 'Digite ao menos 2 letras do nome do pet ou do tutor'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(x ORDER BY x ->> 'nome')
      FROM (
        SELECT jsonb_build_object('id', pt.id, 'nome', pt.nome, 'especie', pt.especie, 'raca', pt.raca, 'tutor', c.nome) AS x
          FROM public.pets pt JOIN public.clientes c ON c.id = pt.cliente_id
         WHERE pt.tenant_id = public.current_tenant_id() AND pt.ativo
           AND (pt.nome ILIKE '%' || v_busca || '%' OR c.nome ILIKE '%' || v_busca || '%')
         ORDER BY pt.nome LIMIT 20
      ) q
  ), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.clinica_fila_buscar_paciente(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_fila_buscar_paciente(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.clinica_fila_entrada(p_dados jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_pet uuid; v_agend uuid;
  v_gravidade text := btrim(coalesce(p_dados ->> 'gravidade', 'comum'));
  v_queixa text := nullif(btrim(coalesce(p_dados ->> 'queixa', '')), '');
  v_obs text := nullif(btrim(coalesce(p_dados ->> 'observacoes', '')), '');
  v_prof uuid;
  ag public.pet_agendamentos%ROWTYPE;
  v_id uuid;
BEGIN
  PERFORM public._clinica_fila_exige_equipe();
  IF v_gravidade NOT IN ('emergencia', 'urgente', 'comum') THEN RAISE EXCEPTION 'Gravidade inválida'; END IF;
  IF length(coalesce(v_queixa, '')) > 300 OR length(coalesce(v_obs, '')) > 300 THEN RAISE EXCEPTION 'Texto longo demais (até 300 caracteres)'; END IF;
  BEGIN
    v_pet := nullif(btrim(coalesce(p_dados ->> 'pet_id', '')), '')::uuid;
    v_agend := nullif(btrim(coalesce(p_dados ->> 'agendamento_id', '')), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'Paciente ou consulta inválida'; END;
  IF v_pet IS NULL THEN RAISE EXCEPTION 'Informe o paciente'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pets WHERE id = v_pet AND tenant_id = v_tenant AND ativo) THEN
    RAISE EXCEPTION 'Paciente não encontrado';
  END IF;
  IF v_agend IS NOT NULL THEN
    SELECT * INTO ag FROM public.pet_agendamentos WHERE id = v_agend AND tenant_id = v_tenant;
    IF NOT FOUND OR ag.pet_id <> v_pet THEN RAISE EXCEPTION 'Consulta não encontrada para este paciente'; END IF;
    IF ag.situacao NOT IN ('agendado', 'confirmado', 'em_atendimento') THEN
      RAISE EXCEPTION 'Esta consulta está "%": não dá para dar entrada', ag.situacao;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.pet_agendamento_itens i JOIN public.pet_servicos s ON s.id = i.servico_id
                    WHERE i.agendamento_id = ag.id AND s.categoria = 'consulta') THEN
      RAISE EXCEPTION 'Este agendamento não tem serviço de consulta';
    END IF;
    IF (ag.inicio AT TIME ZONE 'America/Sao_Paulo')::date > (now() AT TIME ZONE 'America/Sao_Paulo')::date + 1 THEN
      RAISE EXCEPTION 'Esta consulta é de outro dia: a entrada é para o dia do atendimento';
    END IF;
    v_prof := ag.profissional_id;
  END IF;
  INSERT INTO public.clinica_fila (tenant_id, pet_id, agendamento_id, gravidade, queixa, observacoes, profissional_id, registrado_por)
  VALUES (v_tenant, v_pet, v_agend, v_gravidade, v_queixa, v_obs, v_prof, auth.uid())
  RETURNING id INTO v_id;
  RETURN public._clinica_fila_json(v_id);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Este pet já está na fila (ou a consulta já deu entrada)';
END $$;
REVOKE ALL ON FUNCTION public.clinica_fila_entrada(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_fila_entrada(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.clinica_fila_gravidade(p_id uuid, p_gravidade text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public._clinica_fila_exige_equipe();
  IF p_gravidade NOT IN ('emergencia', 'urgente', 'comum') THEN RAISE EXCEPTION 'Gravidade inválida'; END IF;
  UPDATE public.clinica_fila SET gravidade = p_gravidade
   WHERE id = p_id AND tenant_id = public.current_tenant_id() AND situacao = 'aguardando';
  IF NOT FOUND THEN RAISE EXCEPTION 'Só muda a gravidade de quem ainda está aguardando'; END IF;
  RETURN public._clinica_fila_json(p_id);
END $$;
REVOKE ALL ON FUNCTION public.clinica_fila_gravidade(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_fila_gravidade(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.clinica_fila_situacao(p_id uuid, p_para text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  f public.clinica_fila%ROWTYPE;
  v_prof uuid;
BEGIN
  PERFORM public._clinica_fila_acesso();
  IF p_para = 'desistiu' AND public.eh_salao_restrito() THEN RAISE EXCEPTION 'A desistência é registrada pela recepção'; END IF;
  IF p_para NOT IN ('aguardando', 'em_atendimento', 'atendido', 'desistiu') THEN RAISE EXCEPTION 'Situação inválida'; END IF;
  SELECT * INTO f FROM public.clinica_fila WHERE id = p_id AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entrada não encontrada'; END IF;
  IF NOT (   (p_para = 'em_atendimento' AND f.situacao = 'aguardando')
          OR (p_para = 'atendido' AND f.situacao = 'em_atendimento')
          OR (p_para = 'aguardando' AND f.situacao = 'em_atendimento')
          OR (p_para = 'desistiu' AND f.situacao = 'aguardando')) THEN
    RAISE EXCEPTION 'Não é possível passar de "%" para "%"', f.situacao, p_para;
  END IF;
  IF p_para = 'em_atendimento' THEN
    SELECT id INTO v_prof FROM public.pet_profissionais
     WHERE profile_id = auth.uid() AND tenant_id = f.tenant_id AND ativo LIMIT 1;
    UPDATE public.clinica_fila
       SET situacao = 'em_atendimento', chamado_em = now(), encerrado_em = NULL,
           profissional_id = coalesce(v_prof, profissional_id)
     WHERE id = f.id;
  ELSIF p_para IN ('atendido', 'desistiu') THEN
    UPDATE public.clinica_fila SET situacao = p_para, encerrado_em = now() WHERE id = f.id;
  ELSE
    UPDATE public.clinica_fila SET situacao = 'aguardando', chamado_em = NULL, encerrado_em = NULL WHERE id = f.id;
  END IF;
  RETURN public._clinica_fila_json(p_id);
END $$;
REVOKE ALL ON FUNCTION public.clinica_fila_situacao(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_fila_situacao(uuid, text) TO authenticated;

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

CREATE OR REPLACE FUNCTION public.wa_resultado(p_id uuid, p_ok boolean, p_id_externo text, p_jid text, p_erro text, p_proxima timestamptz)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE m public.wa_mensagens%ROWTYPE;
BEGIN
  SELECT * INTO m FROM public.wa_mensagens WHERE id = p_id AND situacao = 'enviando' FOR UPDATE;
  IF m.id IS NULL THEN RETURN; END IF;
  IF p_ok THEN
    UPDATE public.wa_mensagens SET situacao = 'enviada', enviada_em = now(), id_externo = p_id_externo, jid = p_jid, erro = NULL WHERE id = p_id;
    IF m.tipo IN ('pronto', 'plano_vencendo', 'retorno') THEN
      INSERT INTO public.lr_contatos (tenant_id, tipo, referencia, cliente_id, veiculo_id, canal, feito_por)
      VALUES (m.tenant_id, m.tipo, m.referencia, m.cliente_id, m.veiculo_id, 'whatsapp', m.criado_por)
      ON CONFLICT (tenant_id, tipo, referencia) DO NOTHING;
    END IF;
  ELSIF p_proxima IS NOT NULL THEN
    UPDATE public.wa_mensagens SET situacao = 'na_fila', proxima_tentativa = p_proxima, erro = left(p_erro, 300) WHERE id = p_id;
  ELSE
    UPDATE public.wa_mensagens SET situacao = 'falhou', erro = left(p_erro, 300) WHERE id = p_id;
  END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.wa_resultado(uuid, boolean, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_resultado(uuid, boolean, text, text, text, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.wa_status(p_instancia text, p_id_externo text, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_tenant uuid;
  m public.wa_mensagens%ROWTYPE;
BEGIN
  IF p_status NOT IN ('entregue', 'lida', 'erro') THEN RETURN; END IF;
  SELECT tenant_id INTO v_tenant FROM public.wa_config WHERE instancia = p_instancia;
  IF v_tenant IS NULL THEN RETURN; END IF;
  FOR m IN SELECT * FROM public.wa_mensagens WHERE tenant_id = v_tenant AND id_externo = p_id_externo FOR UPDATE LOOP
    IF p_status = 'erro' THEN
      IF m.situacao = 'enviada' THEN
        UPDATE public.wa_mensagens SET situacao = 'falhou', erro = 'O WhatsApp informou falha na entrega' WHERE id = m.id;
      END IF;
      CONTINUE;
    END IF;
    IF NOT (m.situacao = 'enviada'
            OR (m.situacao = 'entregue' AND p_status = 'lida')
            OR (m.situacao = 'falhou' AND m.id_externo IS NOT NULL)) THEN
      CONTINUE;
    END IF;
    UPDATE public.wa_mensagens SET situacao = p_status, erro = NULL WHERE id = m.id;
    IF m.tipo = 'reforco_vacina' AND m.pet_id IS NOT NULL AND m.referencia ~ ':\d{4}-\d{2}-\d{2}$' THEN
      INSERT INTO public.pet_contatos (tenant_id, pet_id, tipo, referencia, canal, contatado_por)
      VALUES (m.tenant_id, m.pet_id, 'reforco', right(m.referencia, 10)::date, 'whatsapp', m.criado_por)
      ON CONFLICT (pet_id, tipo, referencia) DO NOTHING;
    END IF;
  END LOOP;
END $fn$;
REVOKE ALL ON FUNCTION public.wa_status(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_status(text, text, text) TO service_role;