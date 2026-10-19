-- Pet shop (PR 3): agenda de banho e tosa. Só a recepção agenda; o profissional não pode ter dois atendimentos ao mesmo tempo.
-- A cobrança ("retirado") entra no PR seguinte: aqui o atendimento vai até "pronto".
-- A escrita passa só pelas funções, que travam o profissional (lock) antes de conferir a sobreposição.

CREATE TABLE IF NOT EXISTS public.pet_agendamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  filial_id uuid REFERENCES public.filiais(id),
  pet_id uuid NOT NULL REFERENCES public.pets(id),
  cliente_id uuid NOT NULL REFERENCES public.clientes(id),
  profissional_id uuid NOT NULL REFERENCES public.pet_profissionais(id),
  inicio timestamptz NOT NULL,
  fim timestamptz NOT NULL,
  situacao text NOT NULL DEFAULT 'agendado'
    CHECK (situacao IN ('agendado', 'confirmado', 'em_atendimento', 'pronto', 'retirado', 'cancelado', 'faltou')),
  observacoes text,
  taxi_dog boolean NOT NULL DEFAULT false,
  motivo text,
  venda_id uuid REFERENCES public.pedidos(id),
  criado_por uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (fim > inicio)
);
CREATE INDEX IF NOT EXISTS pet_agendamentos_dia_idx ON public.pet_agendamentos (tenant_id, inicio);
CREATE INDEX IF NOT EXISTS pet_agendamentos_prof_idx ON public.pet_agendamentos (profissional_id, inicio) WHERE situacao NOT IN ('cancelado', 'faltou');
CREATE INDEX IF NOT EXISTS pet_agendamentos_pet_idx ON public.pet_agendamentos (pet_id, inicio DESC);

-- Preço e duração ficam congelados na hora de agendar.
CREATE TABLE IF NOT EXISTS public.pet_agendamento_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  agendamento_id uuid NOT NULL REFERENCES public.pet_agendamentos(id) ON DELETE CASCADE,
  servico_id uuid NOT NULL REFERENCES public.pet_servicos(id),
  preco_aplicado numeric(14,2) NOT NULL CHECK (preco_aplicado >= 0),
  duracao_min integer NOT NULL CHECK (duracao_min > 0),
  preco_avulso boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agendamento_id, servico_id)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pet_agendamentos', 'pet_agendamento_itens'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id())', t || '_ler', t);
    EXECUTE format('CREATE POLICY salao_restrito ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()))', t);
  END LOOP;
  EXECUTE 'CREATE TRIGGER trg_pet_agendamentos_updated BEFORE UPDATE ON public.pet_agendamentos FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()';
END $$;

-- Apoio: o profissional já tem atendimento que cruza este intervalo? (intervalo aberto no fim: um começa quando o outro termina)
CREATE OR REPLACE FUNCTION public._pet_conflito(p_prof uuid, p_ini timestamptz, p_fim timestamptz, p_ignorar uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.pet_agendamentos a
     WHERE a.profissional_id = p_prof AND a.situacao NOT IN ('cancelado', 'faltou')
       AND a.id IS DISTINCT FROM p_ignorar
       AND a.inicio < p_fim AND a.fim > p_ini)
$$;
REVOKE ALL ON FUNCTION public._pet_conflito(uuid, timestamptz, timestamptz, uuid) FROM PUBLIC, anon, authenticated;

-- p_dados: {pet_id, profissional_id, inicio, servicos: [{servico_id, preco_avulso?}], observacoes?, taxi_dog?}
CREATE OR REPLACE FUNCTION public.pet_agendar(p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  pt public.pets%ROWTYPE;
  pf public.pet_profissionais%ROWTYPE;
  v_ini timestamptz := nullif(p_dados ->> 'inicio', '')::timestamptz;
  v_fim timestamptz;
  v_dur integer := 0;
  v_gestao boolean;
  it jsonb;
  sv public.pet_servicos%ROWTYPE;
  v_calc jsonb;
  v_preco numeric;
  v_avulso boolean;
  v_itens jsonb := '[]'::jsonb;
  v_vistos uuid[] := '{}';
  v_id uuid;
  r jsonb;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  v_gestao := public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor');
  IF v_ini IS NULL THEN RAISE EXCEPTION 'Informe o dia e a hora do atendimento'; END IF;
  IF jsonb_typeof(p_dados -> 'servicos') IS DISTINCT FROM 'array' OR jsonb_array_length(p_dados -> 'servicos') = 0 THEN
    RAISE EXCEPTION 'Escolha ao menos um serviço';
  END IF;

  SELECT * INTO pt FROM public.pets WHERE id = nullif(p_dados ->> 'pet_id', '')::uuid AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pet não encontrado'; END IF;
  IF NOT pt.ativo THEN RAISE EXCEPTION 'Este pet está inativo'; END IF;
  SELECT * INTO pf FROM public.pet_profissionais WHERE id = nullif(p_dados ->> 'profissional_id', '')::uuid AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profissional não encontrado'; END IF;
  IF NOT pf.ativo THEN RAISE EXCEPTION 'Este profissional está inativo'; END IF;

  FOR it IN SELECT value FROM jsonb_array_elements(p_dados -> 'servicos') LOOP
    SELECT * INTO sv FROM public.pet_servicos WHERE id = nullif(it ->> 'servico_id', '')::uuid AND tenant_id = v_tenant;
    IF NOT FOUND THEN RAISE EXCEPTION 'Serviço não encontrado'; END IF;
    IF NOT sv.ativo THEN RAISE EXCEPTION 'O serviço % está inativo', sv.nome; END IF;
    IF sv.id = ANY (v_vistos) THEN RAISE EXCEPTION 'O serviço % foi escolhido duas vezes', sv.nome; END IF;
    v_vistos := v_vistos || sv.id;

    v_calc := public.pet_preco_calcular(sv.id, pt.id);
    v_avulso := false;
    IF v_calc IS NOT NULL THEN
      v_preco := (v_calc ->> 'preco')::numeric;
    ELSIF nullif(it ->> 'preco_avulso', '') IS NOT NULL THEN
      IF NOT v_gestao THEN RAISE EXCEPTION 'Sem preço cadastrado para % neste pet; só administrador ou gestor informa preço avulso', sv.nome; END IF;
      v_preco := (it ->> 'preco_avulso')::numeric;
      IF v_preco < 0 THEN RAISE EXCEPTION 'O preço avulso não pode ser negativo'; END IF;
      v_avulso := true;
    ELSE
      RAISE EXCEPTION 'O serviço % não tem preço cadastrado para este pet', sv.nome;
    END IF;
    v_dur := v_dur + sv.duracao_min;
    v_itens := v_itens || jsonb_build_object('servico_id', sv.id, 'preco', round(v_preco, 2), 'duracao', sv.duracao_min, 'avulso', v_avulso);
  END LOOP;

  v_fim := v_ini + make_interval(mins => v_dur);
  PERFORM pg_advisory_xact_lock(hashtextextended('pet_agenda:' || pf.id::text, 0));
  IF public._pet_conflito(pf.id, v_ini, v_fim, NULL) THEN
    RAISE EXCEPTION '% já tem atendimento neste horário', pf.nome;
  END IF;

  INSERT INTO public.pet_agendamentos (tenant_id, filial_id, pet_id, cliente_id, profissional_id, inicio, fim, observacoes, taxi_dog)
  VALUES (v_tenant, pf.filial_id, pt.id, pt.cliente_id, pf.id, v_ini, v_fim, nullif(btrim(p_dados ->> 'observacoes'), ''),
          coalesce((p_dados ->> 'taxi_dog')::boolean, false))
  RETURNING id INTO v_id;
  FOR r IN SELECT value FROM jsonb_array_elements(v_itens) LOOP
    INSERT INTO public.pet_agendamento_itens (tenant_id, agendamento_id, servico_id, preco_aplicado, duracao_min, preco_avulso)
    VALUES (v_tenant, v_id, (r ->> 'servico_id')::uuid, (r ->> 'preco')::numeric, (r ->> 'duracao')::integer, (r ->> 'avulso')::boolean);
  END LOOP;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.pet_agendar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_agendar(jsonb) TO authenticated;

-- Situação: agendado → confirmado → em_atendimento → pronto. Cancelar e faltar valem enquanto o atendimento não começou.
-- "retirado" só sai da cobrança (próximo PR); por aqui não se alcança.
CREATE OR REPLACE FUNCTION public.pet_agenda_situacao(p_id uuid, p_para text, p_motivo text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  a public.pet_agendamentos%ROWTYPE;
  v_ok boolean;
  v_motivo text := nullif(btrim(p_motivo), '');
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  SELECT * INTO a FROM public.pet_agendamentos WHERE id = p_id AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento não encontrado'; END IF;
  v_ok := CASE a.situacao
    WHEN 'agendado' THEN p_para IN ('confirmado', 'em_atendimento', 'cancelado', 'faltou')
    WHEN 'confirmado' THEN p_para IN ('em_atendimento', 'cancelado', 'faltou')
    WHEN 'em_atendimento' THEN p_para = 'pronto'
    ELSE false END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'Não é possível passar de "%" para "%"', a.situacao, p_para;
  END IF;
  IF p_para IN ('cancelado', 'faltou') AND v_motivo IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo';
  END IF;
  UPDATE public.pet_agendamentos SET situacao = p_para, motivo = CASE WHEN p_para IN ('cancelado', 'faltou') THEN v_motivo ELSE motivo END
   WHERE id = a.id;
END $$;
REVOKE ALL ON FUNCTION public.pet_agenda_situacao(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_agenda_situacao(uuid, text, text) TO authenticated;

-- Remarcar: só antes de começar; o profissional pode mudar; a duração dos serviços já combinados se mantém.
CREATE OR REPLACE FUNCTION public.pet_reagendar(p_id uuid, p_inicio timestamptz, p_profissional_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  a public.pet_agendamentos%ROWTYPE;
  pf public.pet_profissionais%ROWTYPE;
  v_dur integer;
  v_fim timestamptz;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  IF p_inicio IS NULL THEN RAISE EXCEPTION 'Informe o novo horário'; END IF;
  SELECT * INTO a FROM public.pet_agendamentos WHERE id = p_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento não encontrado'; END IF;
  IF a.situacao NOT IN ('agendado', 'confirmado') THEN
    RAISE EXCEPTION 'Só dá para remarcar atendimento agendado ou confirmado';
  END IF;
  SELECT * INTO pf FROM public.pet_profissionais WHERE id = coalesce(p_profissional_id, a.profissional_id) AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profissional não encontrado'; END IF;
  IF NOT pf.ativo THEN RAISE EXCEPTION 'Este profissional está inativo'; END IF;
  SELECT coalesce(sum(duracao_min), 0) INTO v_dur FROM public.pet_agendamento_itens WHERE agendamento_id = a.id;
  v_fim := p_inicio + make_interval(mins => v_dur);
  PERFORM pg_advisory_xact_lock(hashtextextended('pet_agenda:' || pf.id::text, 0));
  IF public._pet_conflito(pf.id, p_inicio, v_fim, a.id) THEN
    RAISE EXCEPTION '% já tem atendimento neste horário', pf.nome;
  END IF;
  UPDATE public.pet_agendamentos SET inicio = p_inicio, fim = v_fim, profissional_id = pf.id, filial_id = pf.filial_id WHERE id = a.id;
END $$;
REVOKE ALL ON FUNCTION public.pet_reagendar(uuid, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_reagendar(uuid, timestamptz, uuid) TO authenticated;
