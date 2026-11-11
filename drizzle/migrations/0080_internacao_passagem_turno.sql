-- Internação: passagem de turno vinculada à internação (resumo, pendências, autoria, horário e ciência).
-- Decisões da clínica: veterinário ou auxiliar escreve a passagem; o PRÓXIMO profissional registra "ciente" com horário (o autor não
-- dá ciente da própria passagem); pendência lida continua PENDENTE: só deixa de estar aberta por uma ação explícita de quem a resolveu
-- ou descartou, registrada à parte, com autor e horário. Nada aqui mexe em prescrição, mapa de doses ou execução de dose: trocar de
-- turno não marca dose como administrada.
-- O horário de cada registro é o instante real (clock_timestamp), não o início da transação: a ordem das passagens é sempre a do relógio.
-- Fatos não se alteram nem se apagam (gatilho). Recepção e gestão não leem. Tudo por função, sem acesso direto às tabelas.

-- ============ passagem ============
CREATE TABLE IF NOT EXISTS public.pet_internacao_turnos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id),
  internacao_id uuid NOT NULL REFERENCES public.pet_internacoes(id),
  profissional_id uuid NOT NULL REFERENCES public.pet_profissionais(id),
  resumo text NOT NULL CHECK (length(btrim(resumo)) BETWEEN 3 AND 2000),
  -- chave de repetição enviada pela tela: o mesmo envio feito duas vezes não duplica a passagem
  chave text CHECK (chave IS NULL OR length(chave) BETWEEN 8 AND 80),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS pet_internacao_turnos_idx ON public.pet_internacao_turnos (tenant_id, internacao_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS pet_internacao_turnos_chave_idx ON public.pet_internacao_turnos (tenant_id, chave) WHERE chave IS NOT NULL;

-- ============ pendências da passagem ============
CREATE TABLE IF NOT EXISTS public.pet_internacao_pendencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id),
  internacao_id uuid NOT NULL REFERENCES public.pet_internacoes(id),
  turno_id uuid NOT NULL REFERENCES public.pet_internacao_turnos(id),
  texto text NOT NULL CHECK (length(btrim(texto)) BETWEEN 1 AND 300),
  ordem smallint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS pet_internacao_pendencias_idx ON public.pet_internacao_pendencias (tenant_id, internacao_id, created_at);

-- Resolver ou descartar uma pendência é um registro à parte (uma vez só). Quem leu a passagem não resolveu nada.
CREATE TABLE IF NOT EXISTS public.pet_internacao_pendencia_baixas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id),
  pendencia_id uuid NOT NULL UNIQUE REFERENCES public.pet_internacao_pendencias(id),
  profissional_id uuid NOT NULL REFERENCES public.pet_profissionais(id),
  situacao text NOT NULL CHECK (situacao IN ('resolvida', 'descartada')),
  observacao text CHECK (observacao IS NULL OR length(btrim(observacao)) BETWEEN 3 AND 300),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- descartar (não vai ser feita) exige dizer por quê
  CHECK (situacao = 'resolvida' OR observacao IS NOT NULL)
);

-- ============ ciência ============
CREATE TABLE IF NOT EXISTS public.pet_internacao_turno_ciencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id),
  turno_id uuid NOT NULL REFERENCES public.pet_internacao_turnos(id),
  profissional_id uuid NOT NULL REFERENCES public.pet_profissionais(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (turno_id, profissional_id)
);

CREATE OR REPLACE FUNCTION public._internacao_turno_guarda()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Passagem de turno não se altera nem se apaga';
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pet_internacao_turnos', 'pet_internacao_pendencias', 'pet_internacao_pendencia_baixas', 'pet_internacao_turno_ciencias'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS salao_restrito ON public.%I', t);
    EXECUTE format('CREATE POLICY salao_restrito ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()))', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_turno_guarda ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_turno_guarda BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public._internacao_turno_guarda()', t);
  END LOOP;
END $$;

-- ============ registrar a passagem ============
-- p_dados: {resumo, pendencias?: [texto, ...] (até 20), chave?}. Só com a internação aberta. Mesma chave devolve a passagem já criada.
CREATE OR REPLACE FUNCTION public.clinica_turno_registrar(p_internacao_id uuid, p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  a jsonb := public._internacao_ator(false);
  i public.pet_internacoes;
  v_resumo text;
  v_chave text;
  v_id uuid;
  v_pend jsonb;
  v_texto text;
  v_ordem integer := 0;
  el jsonb;
BEGIN
  IF jsonb_typeof(p_dados) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Dados inválidos'; END IF;
  i := public._internacao_aberta(p_internacao_id);
  v_chave := nullif(btrim(coalesce(p_dados ->> 'chave', '')), '');
  IF v_chave IS NOT NULL THEN
    SELECT id INTO v_id FROM public.pet_internacao_turnos WHERE tenant_id = i.tenant_id AND chave = v_chave;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;
  v_resumo := btrim(coalesce(p_dados ->> 'resumo', ''));
  IF length(v_resumo) NOT BETWEEN 3 AND 2000 THEN RAISE EXCEPTION 'Escreva o resumo da passagem (3 a 2000 caracteres)'; END IF;
  v_pend := coalesce(p_dados -> 'pendencias', '[]'::jsonb);
  IF jsonb_typeof(v_pend) <> 'array' THEN RAISE EXCEPTION 'Pendências inválidas'; END IF;
  IF jsonb_array_length(v_pend) > 20 THEN RAISE EXCEPTION 'Até 20 pendências por passagem'; END IF;
  FOR el IN SELECT value FROM jsonb_array_elements(v_pend) LOOP
    IF jsonb_typeof(el) <> 'string' THEN RAISE EXCEPTION 'Pendência inválida'; END IF;
    v_texto := btrim(el #>> '{}');
    IF length(v_texto) NOT BETWEEN 1 AND 300 THEN RAISE EXCEPTION 'Cada pendência precisa ter de 1 a 300 caracteres'; END IF;
  END LOOP;
  INSERT INTO public.pet_internacao_turnos (tenant_id, internacao_id, profissional_id, resumo, chave)
  VALUES (i.tenant_id, i.id, (a ->> 'id')::uuid, v_resumo, v_chave) RETURNING id INTO v_id;
  FOR el IN SELECT value FROM jsonb_array_elements(v_pend) LOOP
    v_ordem := v_ordem + 1;
    INSERT INTO public.pet_internacao_pendencias (tenant_id, internacao_id, turno_id, texto, ordem)
    VALUES (i.tenant_id, i.id, v_id, btrim(el #>> '{}'), v_ordem);
  END LOOP;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.clinica_turno_registrar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_turno_registrar(uuid, jsonb) TO authenticated;

-- ============ ciente ============
-- Quem recebe o plantão registra que leu. Só vale para a passagem de OUTRO profissional e com a internação aberta.
-- Repetir não duplica. Ciente NÃO resolve pendência nem executa dose.
CREATE OR REPLACE FUNCTION public.clinica_turno_ciente(p_turno_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  a jsonb := public._internacao_ator(false);
  t public.pet_internacao_turnos;
  i public.pet_internacoes;
BEGIN
  SELECT * INTO t FROM public.pet_internacao_turnos WHERE id = p_turno_id AND tenant_id = public.current_tenant_id();
  IF t.id IS NULL THEN RAISE EXCEPTION 'Passagem não encontrada'; END IF;
  i := public._internacao_aberta(t.internacao_id);
  IF t.profissional_id = (a ->> 'id')::uuid THEN
    RAISE EXCEPTION 'Quem escreveu a passagem não registra ciência dela: o ciente é de quem recebe';
  END IF;
  INSERT INTO public.pet_internacao_turno_ciencias (tenant_id, turno_id, profissional_id)
  VALUES (t.tenant_id, t.id, (a ->> 'id')::uuid)
  ON CONFLICT (turno_id, profissional_id) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.clinica_turno_ciente(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_turno_ciente(uuid) TO authenticated;

-- ============ resolver ou descartar uma pendência ============
-- p_dados: {situacao: 'resolvida' | 'descartada', observacao?}. Descartar exige observação. Uma vez só.
CREATE OR REPLACE FUNCTION public.clinica_pendencia_baixar(p_id uuid, p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  a jsonb := public._internacao_ator(false);
  pd public.pet_internacao_pendencias;
  i public.pet_internacoes;
  v_sit text;
  v_obs text;
  v_id uuid;
  v_quem text;
BEGIN
  IF jsonb_typeof(p_dados) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Dados inválidos'; END IF;
  SELECT * INTO pd FROM public.pet_internacao_pendencias WHERE id = p_id AND tenant_id = public.current_tenant_id();
  IF pd.id IS NULL THEN RAISE EXCEPTION 'Pendência não encontrada'; END IF;
  i := public._internacao_aberta(pd.internacao_id);
  v_sit := coalesce(p_dados ->> 'situacao', '');
  IF v_sit NOT IN ('resolvida', 'descartada') THEN RAISE EXCEPTION 'Informe se a pendência foi resolvida ou descartada'; END IF;
  v_obs := nullif(btrim(coalesce(p_dados ->> 'observacao', '')), '');
  IF v_obs IS NOT NULL AND length(v_obs) NOT BETWEEN 3 AND 300 THEN RAISE EXCEPTION 'A observação precisa ter de 3 a 300 caracteres'; END IF;
  IF v_sit = 'descartada' AND v_obs IS NULL THEN RAISE EXCEPTION 'Explique por que a pendência foi descartada'; END IF;
  BEGIN
    INSERT INTO public.pet_internacao_pendencia_baixas (tenant_id, pendencia_id, profissional_id, situacao, observacao)
    VALUES (pd.tenant_id, pd.id, (a ->> 'id')::uuid, v_sit, v_obs) RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT p.nome INTO v_quem FROM public.pet_internacao_pendencia_baixas b JOIN public.pet_profissionais p ON p.id = b.profissional_id WHERE b.pendencia_id = pd.id;
    RAISE EXCEPTION 'Esta pendência já foi baixada por %', coalesce(v_quem, 'outro profissional');
  END;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.clinica_pendencia_baixar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_pendencia_baixar(uuid, jsonb) TO authenticated;

-- ============ leitura da internação ============
-- Últimas 30 passagens (mais nova primeiro) com pendências, baixas e ciências, e TODAS as pendências ainda abertas da internação
-- (as que ninguém resolveu nem descartou, de qualquer passagem). Veterinário e auxiliar; a leitura entra no registro de acessos.
CREATE OR REPLACE FUNCTION public.clinica_turnos_internacao(p_internacao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  a jsonb := public._internacao_ator(false);
  v_me uuid := (a ->> 'id')::uuid;
  v_tenant uuid := public.current_tenant_id();
  i public.pet_internacoes;
BEGIN
  SELECT * INTO i FROM public.pet_internacoes WHERE id = p_internacao_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Internação não encontrada'; END IF;
  INSERT INTO public.clinica_acessos (tenant_id, pet_id, acao) VALUES (v_tenant, i.pet_id, 'internacao');
  RETURN jsonb_build_object(
    'meu_profissional_id', v_me,
    'turnos', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', t.id, 'resumo', t.resumo, 'created_at', t.created_at,
               'autor', jsonb_build_object('id', t.profissional_id, 'nome', p.nome, 'funcao', p.funcao),
               'sou_autor', t.profissional_id = v_me,
               'minha_ciencia', EXISTS (SELECT 1 FROM public.pet_internacao_turno_ciencias c WHERE c.turno_id = t.id AND c.profissional_id = v_me),
               'pendencias', coalesce((
                 SELECT jsonb_agg(jsonb_build_object(
                          'id', pd.id, 'texto', pd.texto, 'ordem', pd.ordem,
                          'baixa', (SELECT jsonb_build_object('situacao', b.situacao, 'observacao', b.observacao,
                                                              'profissional', bp.nome, 'created_at', b.created_at)
                                      FROM public.pet_internacao_pendencia_baixas b JOIN public.pet_profissionais bp ON bp.id = b.profissional_id
                                     WHERE b.pendencia_id = pd.id)
                        ) ORDER BY pd.ordem)
                   FROM public.pet_internacao_pendencias pd WHERE pd.turno_id = t.id), '[]'::jsonb),
               'ciencias', coalesce((
                 SELECT jsonb_agg(jsonb_build_object('profissional', cp.nome, 'funcao', cp.funcao, 'created_at', c.created_at) ORDER BY c.created_at)
                   FROM public.pet_internacao_turno_ciencias c JOIN public.pet_profissionais cp ON cp.id = c.profissional_id
                  WHERE c.turno_id = t.id), '[]'::jsonb)
             ) ORDER BY t.created_at DESC)
        FROM (SELECT * FROM public.pet_internacao_turnos WHERE internacao_id = i.id AND tenant_id = v_tenant ORDER BY created_at DESC LIMIT 30) t
        JOIN public.pet_profissionais p ON p.id = t.profissional_id
    ), '[]'::jsonb),
    'pendencias_abertas', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', pd.id, 'texto', pd.texto, 'turno_id', pd.turno_id, 'created_at', pd.created_at,
                                          'autor', tp.nome) ORDER BY pd.created_at, pd.ordem)
        FROM public.pet_internacao_pendencias pd
        JOIN public.pet_internacao_turnos tt ON tt.id = pd.turno_id
        JOIN public.pet_profissionais tp ON tp.id = tt.profissional_id
       WHERE pd.internacao_id = i.id AND pd.tenant_id = v_tenant
         AND NOT EXISTS (SELECT 1 FROM public.pet_internacao_pendencia_baixas b WHERE b.pendencia_id = pd.id)
    ), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.clinica_turnos_internacao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_turnos_internacao(uuid) TO authenticated;

-- ============ plantão: o que cada internado tem em aberto ============
-- Uma linha por animal internado: pendências abertas, última passagem (quando e quem) e se a última passagem espera a MINHA ciência.
-- Só números e nomes de profissionais, sem conteúdo clínico. Veterinário e auxiliar.
CREATE OR REPLACE FUNCTION public.clinica_plantao()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  a jsonb := public._internacao_ator(false);
  v_me uuid := (a ->> 'id')::uuid;
  v_tenant uuid := public.current_tenant_id();
BEGIN
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'internacao_id', i.id,
             'pendencias_abertas', (SELECT count(*) FROM public.pet_internacao_pendencias pd
                                     WHERE pd.internacao_id = i.id
                                       AND NOT EXISTS (SELECT 1 FROM public.pet_internacao_pendencia_baixas b WHERE b.pendencia_id = pd.id)),
             'ultima_passagem_em', u.created_at,
             'ultima_passagem_por', up.nome,
             'aguarda_minha_ciencia', (u.id IS NOT NULL AND u.profissional_id <> v_me
                                       AND NOT EXISTS (SELECT 1 FROM public.pet_internacao_turno_ciencias c WHERE c.turno_id = u.id AND c.profissional_id = v_me))
           ))
      FROM public.pet_internacoes i
      LEFT JOIN LATERAL (SELECT t.* FROM public.pet_internacao_turnos t WHERE t.internacao_id = i.id ORDER BY t.created_at DESC LIMIT 1) u ON true
      LEFT JOIN public.pet_profissionais up ON up.id = u.profissional_id
     WHERE i.tenant_id = v_tenant AND i.situacao = 'internado'
  ), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.clinica_plantao() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_plantao() TO authenticated;
