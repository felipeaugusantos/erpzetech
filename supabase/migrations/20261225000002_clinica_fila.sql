-- Fila do dia da clínica: a recepção registra a chegada (da consulta marcada ou avulsa) com a gravidade da
-- triagem, e a fila ordena quem espera: emergência, urgente e comum, cada grupo por ordem de chegada.
-- A fila organiza a recepção; o prontuário continua sendo aberto pelo veterinário nos caminhos de sempre
-- (consulta marcada ou visita avulsa). "Chamar" liga o profissional que chamou; "atendido" e "desistiu" fecham
-- a passagem. Um pet não entra duas vezes enquanto ainda espera ou está em atendimento, e a consulta marcada
-- entra uma única vez.

CREATE TABLE IF NOT EXISTS public.clinica_fila (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  pet_id uuid NOT NULL REFERENCES public.pets(id),
  -- a consulta marcada que motivou a entrada (quando há)
  agendamento_id uuid REFERENCES public.pet_agendamentos(id),
  chegada_em timestamptz NOT NULL DEFAULT now(),
  gravidade text NOT NULL DEFAULT 'comum' CHECK (gravidade IN ('emergencia', 'urgente', 'comum')),
  queixa text CHECK (queixa IS NULL OR length(queixa) <= 300),
  situacao text NOT NULL DEFAULT 'aguardando' CHECK (situacao IN ('aguardando', 'em_atendimento', 'atendido', 'desistiu')),
  -- o veterinário que chamou o pet (quando a entrada já aponta o profissional, fica como preferência)
  profissional_id uuid REFERENCES public.pet_profissionais(id),
  chamado_em timestamptz,
  encerrado_em timestamptz,
  observacoes text CHECK (observacoes IS NULL OR length(observacoes) <= 300),
  registrado_por uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((situacao IN ('atendido', 'desistiu')) = (encerrado_em IS NOT NULL)),
  -- chamado_em fica registrado depois do atendimento (histórico de espera)
  CHECK (situacao <> 'em_atendimento' OR chamado_em IS NOT NULL),
  CHECK (chamado_em IS NULL OR situacao <> 'aguardando')
);
-- a consulta marcada entra na fila uma única vez
CREATE UNIQUE INDEX IF NOT EXISTS clinica_fila_agendamento_idx ON public.clinica_fila (tenant_id, agendamento_id) WHERE agendamento_id IS NOT NULL;
-- o mesmo pet não espera (nem está sendo atendido) em duas entradas ao mesmo tempo
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

-- Quem trabalha na fila: recepção e gestão (perfis amplos, com a trava anti-salão).
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

-- Acompanhar a fila e chamar/atender o paciente também é trabalho do veterinário. Ele é perfil
-- restrito no app (como o profissional do salão), então entra pela mesma regra do prontuário
-- (_clinica_vet: veterinário ativo com CRMV ligado à conta). Perfis restritos que não são
-- veterinários (garçom, cozinha, tosador) continuam de fora, e a tabela segue inacessível
-- fora destas funções.
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

-- A fila de um dia (padrão: hoje, horário de Brasília) mais as consultas marcadas do dia que ainda não deram
-- entrada, para a recepção incluir com um toque.
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

-- Busca de paciente para a entrada avulsa (sem consulta marcada). Só nome do pet e do tutor: nada clínico.
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

-- Entrada na fila. p_dados: {pet_id, agendamento_id?, gravidade?, queixa?, observacoes?}.
-- Com agendamento: precisa ser consulta do dia (até o fim do dia seguinte ao horário marcado) e o pet confere.
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

-- Mudança de situação: chamar (aguardando → em atendimento), atender (em atendimento → atendido),
-- devolver (em atendimento → aguardando) e desistência (aguardando → desistiu).
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
  -- desistência é baixa da recepção; o veterinário chama, atende e devolve
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
  -- quem chama: o veterinário da conta, quando há (senão mantém o profissional da consulta marcada)
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
