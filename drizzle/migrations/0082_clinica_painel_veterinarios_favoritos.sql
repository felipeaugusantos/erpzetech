CREATE TABLE IF NOT EXISTS public.bulario_favoritos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  medicamento_id uuid NOT NULL REFERENCES public.bulario_medicamentos(id) ON DELETE CASCADE,
  dose text CHECK (dose IS NULL OR length(dose) <= 2000),
  validade date,
  criado_por uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, medicamento_id)
);
REVOKE ALL ON public.bulario_favoritos FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.bulario_favoritos TO service_role;
ALTER TABLE public.bulario_favoritos ENABLE ROW LEVEL SECURITY;
CREATE POLICY salao_restrito ON public.bulario_favoritos AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT NOT public.eh_salao_restrito()));
DROP TRIGGER IF EXISTS trg_bulario_favoritos_updated ON public.bulario_favoritos;
CREATE TRIGGER trg_bulario_favoritos_updated BEFORE UPDATE ON public.bulario_favoritos
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.bulario_favorito_salvar(p_id uuid, p_dose text, p_validade date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_dose text := nullif(btrim(coalesce(p_dose, '')), '');
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'veterinario']);
  IF NOT public.clinica_liberada() THEN RAISE EXCEPTION 'A clínica não está liberada para esta empresa'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bulario_medicamentos WHERE id = p_id) THEN
    RAISE EXCEPTION 'Medicamento não encontrado no bulário';
  END IF;
  IF length(coalesce(v_dose, '')) > 2000 THEN RAISE EXCEPTION 'A dose aceita até 2000 caracteres'; END IF;
  INSERT INTO public.bulario_favoritos (tenant_id, medicamento_id, dose, validade)
  VALUES (public.current_tenant_id(), p_id, v_dose, p_validade)
  ON CONFLICT (tenant_id, medicamento_id) DO UPDATE SET dose = EXCLUDED.dose, validade = EXCLUDED.validade;
END $$;
REVOKE ALL ON FUNCTION public.bulario_favorito_salvar(uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulario_favorito_salvar(uuid, text, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.bulario_favorito_remover(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'veterinario']);
  IF NOT public.clinica_liberada() THEN RAISE EXCEPTION 'A clínica não está liberada para esta empresa'; END IF;
  DELETE FROM public.bulario_favoritos WHERE medicamento_id = p_id AND tenant_id = public.current_tenant_id();
END $$;
REVOKE ALL ON FUNCTION public.bulario_favorito_remover(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulario_favorito_remover(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.bulario_favoritos()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'veterinario']);
  IF NOT public.clinica_liberada() THEN RAISE EXCEPTION 'A clínica não está liberada para esta empresa'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'medicamento_id', b.id, 'nome', b.nome, 'principio_ativo', b.principio_ativo,
             'fabricante', b.fabricante, 'dose', f.dose, 'validade', f.validade, 'updated_at', f.updated_at)
           ORDER BY b.nome)
      FROM public.bulario_favoritos f JOIN public.bulario_medicamentos b ON b.id = f.medicamento_id
     WHERE f.tenant_id = public.current_tenant_id()), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.bulario_favoritos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulario_favoritos() TO authenticated;

CREATE OR REPLACE FUNCTION public.clinica_painel(p_de date, p_ate date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_t uuid := public.current_tenant_id(); v jsonb;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  IF NOT public.clinica_liberada() THEN RAISE EXCEPTION 'A clínica não está liberada para esta empresa'; END IF;
  IF p_de IS NULL OR p_ate IS NULL OR p_ate < p_de OR p_ate - p_de > 366 THEN
    RAISE EXCEPTION 'Período inválido (até 366 dias)';
  END IF;
  WITH at AS (
    SELECT a.id, a.pet_id, a.agendamento_id, (a.aberto_em AT TIME ZONE 'America/Sao_Paulo')::date AS dia
      FROM public.pet_atendimentos_clinicos a
     WHERE a.tenant_id = v_t
       AND a.aberto_em >= (p_de::timestamp AT TIME ZONE 'America/Sao_Paulo')
       AND a.aberto_em < ((p_ate + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
  ), primeiro AS (
    SELECT pet_id, min((aberto_em AT TIME ZONE 'America/Sao_Paulo')::date) AS dia
      FROM public.pet_atendimentos_clinicos WHERE tenant_id = v_t GROUP BY pet_id
  ), rec AS (
    SELECT ag.id, (SELECT coalesce(sum(i.preco_aplicado), 0) FROM public.pet_agendamento_itens i WHERE i.agendamento_id = ag.id) AS valor
      FROM public.pet_agendamentos ag
     WHERE ag.tenant_id = v_t AND ag.situacao NOT IN ('cancelado', 'faltou')
       AND ag.id IN (SELECT agendamento_id FROM at WHERE agendamento_id IS NOT NULL)
  ), rec_dia AS (
    SELECT d.dia, sum(r.valor) AS receita
      FROM (SELECT DISTINCT ON (agendamento_id) agendamento_id, dia FROM at WHERE agendamento_id IS NOT NULL ORDER BY agendamento_id, dia) d
      JOIN rec r ON r.id = d.agendamento_id GROUP BY d.dia
  ), dias AS (
    SELECT g::date AS dia FROM generate_series(p_de, p_ate, interval '1 day') g
  )
  SELECT jsonb_build_object(
    'dias', (SELECT jsonb_agg(jsonb_build_object(
               'dia', d.dia,
               'atendimentos', (SELECT count(*) FROM at WHERE at.dia = d.dia),
               'pacientes', (SELECT count(DISTINCT pet_id) FROM at WHERE at.dia = d.dia),
               'novos', (SELECT count(*) FROM primeiro p WHERE p.dia = d.dia),
               'receita', coalesce((SELECT receita FROM rec_dia r WHERE r.dia = d.dia), 0)) ORDER BY d.dia)
             FROM dias d),
    'atendimentos', (SELECT count(*) FROM at),
    'pacientes', (SELECT count(DISTINCT pet_id) FROM at),
    'novos', (SELECT count(*) FROM primeiro p WHERE p.dia BETWEEN p_de AND p_ate),
    'receita', coalesce((SELECT sum(valor) FROM rec), 0),
    'especies', coalesce((SELECT jsonb_agg(jsonb_build_object('especie', e.especie, 'pacientes', e.n) ORDER BY e.n DESC)
                  FROM (SELECT p.especie, count(DISTINCT p.id) AS n FROM public.pets p
                         WHERE p.id IN (SELECT pet_id FROM at) GROUP BY p.especie) e), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.clinica_painel(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_painel(date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.clinica_visao_veterinarios(p_de date, p_ate date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_t uuid := public.current_tenant_id();
  v_ini timestamptz; v_fim timestamptz;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'veterinario']);
  IF NOT public.clinica_liberada() THEN RAISE EXCEPTION 'A clínica não está liberada para esta empresa'; END IF;
  IF p_de IS NULL OR p_ate IS NULL OR p_ate < p_de OR p_ate - p_de > 92 THEN
    RAISE EXCEPTION 'Período inválido (até 92 dias)';
  END IF;
  v_ini := p_de::timestamp AT TIME ZONE 'America/Sao_Paulo';
  v_fim := (p_ate + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo';
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', pr.id, 'nome', pr.nome, 'crmv', pr.crmv, 'crmv_uf', pr.crmv_uf,
      'atendimentos', (SELECT count(*) FROM public.pet_atendimentos_clinicos a WHERE a.tenant_id = v_t AND a.veterinario_id = pr.id AND a.aberto_em >= v_ini AND a.aberto_em < v_fim),
      'em_aberto', (SELECT count(*) FROM public.pet_atendimentos_clinicos a WHERE a.tenant_id = v_t AND a.veterinario_id = pr.id AND a.situacao = 'aberto' AND a.aberto_em >= v_ini AND a.aberto_em < v_fim),
      'pacientes', (SELECT count(DISTINCT a.pet_id) FROM public.pet_atendimentos_clinicos a WHERE a.tenant_id = v_t AND a.veterinario_id = pr.id AND a.aberto_em >= v_ini AND a.aberto_em < v_fim),
      'duracao_media_min', (SELECT round(avg(extract(epoch FROM a.fechado_em - a.aberto_em)) / 60) FROM public.pet_atendimentos_clinicos a WHERE a.tenant_id = v_t AND a.veterinario_id = pr.id AND a.fechado_em IS NOT NULL AND a.aberto_em >= v_ini AND a.aberto_em < v_fim),
      'espera_media_min', (SELECT round(avg(extract(epoch FROM f.chamado_em - f.chegada_em)) / 60) FROM public.clinica_fila f WHERE f.tenant_id = v_t AND f.profissional_id = pr.id AND f.chamado_em IS NOT NULL AND f.chegada_em >= v_ini AND f.chegada_em < v_fim),
      'chamados', (SELECT count(*) FROM public.clinica_fila f WHERE f.tenant_id = v_t AND f.profissional_id = pr.id AND f.chamado_em IS NOT NULL AND f.chegada_em >= v_ini AND f.chegada_em < v_fim)
    ) ORDER BY pr.nome)
    FROM public.pet_profissionais pr
    WHERE pr.tenant_id = v_t AND pr.ativo AND pr.funcao = 'veterinario' AND pr.crmv IS NOT NULL), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.clinica_visao_veterinarios(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_visao_veterinarios(date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.clinica_fila_aguardando_agora()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'veterinario']);
  IF NOT public.clinica_liberada() THEN RAISE EXCEPTION 'A clínica não está liberada para esta empresa'; END IF;
  RETURN jsonb_build_object(
    'aguardando', (SELECT count(*) FROM public.clinica_fila WHERE tenant_id = public.current_tenant_id() AND situacao = 'aguardando'),
    'espera_atual_max_min', (SELECT round(max(extract(epoch FROM now() - chegada_em)) / 60) FROM public.clinica_fila WHERE tenant_id = public.current_tenant_id() AND situacao = 'aguardando'));
END $$;
REVOKE ALL ON FUNCTION public.clinica_fila_aguardando_agora() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_fila_aguardando_agora() TO authenticated;