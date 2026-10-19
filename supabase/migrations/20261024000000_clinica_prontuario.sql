-- Clínica (Fase 3, PR 2): consulta e prontuário. Só o perfil Veterinário lê e escreve o texto clínico, sempre por funções: as tabelas não
-- têm leitura nem escrita direta para ninguém (nem administrador, nem gestor). Atendimento fechado é imutável; correção é adendo.
-- Toda função exige o perfil Veterinário, a clínica liberada (clinica_liberada) e um cadastro de veterinário ativo com CRMV.

-- ============ tabelas ============
CREATE TABLE IF NOT EXISTS public.pet_atendimentos_clinicos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id),
  pet_id uuid NOT NULL REFERENCES public.pets(id),
  cliente_id uuid NOT NULL REFERENCES public.clientes(id),
  agendamento_id uuid NOT NULL UNIQUE REFERENCES public.pet_agendamentos(id),
  veterinario_id uuid NOT NULL REFERENCES public.pet_profissionais(id),
  -- o CRMV vale como estava na abertura, mesmo que o cadastro mude depois
  crmv text NOT NULL,
  crmv_uf text NOT NULL,
  situacao text NOT NULL DEFAULT 'aberto' CHECK (situacao IN ('aberto', 'fechado')),
  aberto_em timestamptz NOT NULL DEFAULT now(),
  fechado_em timestamptz,
  queixa text,
  anamnese text,
  peso_kg numeric(6,2) CHECK (peso_kg > 0 AND peso_kg <= 200),
  temperatura_c numeric(4,1) CHECK (temperatura_c BETWEEN 30 AND 45),
  freq_cardiaca integer CHECK (freq_cardiaca BETWEEN 10 AND 400),
  freq_respiratoria integer CHECK (freq_respiratoria BETWEEN 2 AND 200),
  exame_fisico text,
  diagnostico text,
  conduta text,
  retorno_em date,
  observacoes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((situacao = 'fechado') = (fechado_em IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS pet_atend_clin_pet_idx ON public.pet_atendimentos_clinicos (tenant_id, pet_id, aberto_em DESC);

CREATE TABLE IF NOT EXISTS public.pet_atendimento_adendos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id),
  atendimento_id uuid NOT NULL REFERENCES public.pet_atendimentos_clinicos(id),
  veterinario_id uuid NOT NULL REFERENCES public.pet_profissionais(id),
  crmv text NOT NULL,
  crmv_uf text NOT NULL,
  texto text NOT NULL CHECK (length(btrim(texto)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pet_adendos_atend_idx ON public.pet_atendimento_adendos (atendimento_id, created_at);

-- Quem abriu a ficha de um paciente (sem texto clínico): auditoria de leitura do prontuário.
CREATE TABLE IF NOT EXISTS public.clinica_acessos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id),
  profile_id uuid NOT NULL DEFAULT auth.uid(),
  pet_id uuid NOT NULL REFERENCES public.pets(id),
  atendimento_id uuid REFERENCES public.pet_atendimentos_clinicos(id),
  acao text NOT NULL CHECK (acao IN ('historico', 'atendimento', 'alergias')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clinica_acessos_idx ON public.clinica_acessos (tenant_id, created_at DESC);

-- ============ imutabilidade ============
CREATE OR REPLACE FUNCTION public._clinica_atendimento_guarda()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'O prontuário não se apaga'; END IF;
  IF OLD.situacao = 'fechado' THEN RAISE EXCEPTION 'Atendimento fechado não pode ser alterado: registre um adendo'; END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.pet_id IS DISTINCT FROM OLD.pet_id OR NEW.cliente_id IS DISTINCT FROM OLD.cliente_id
     OR NEW.agendamento_id IS DISTINCT FROM OLD.agendamento_id OR NEW.veterinario_id IS DISTINCT FROM OLD.veterinario_id
     OR NEW.crmv IS DISTINCT FROM OLD.crmv OR NEW.crmv_uf IS DISTINCT FROM OLD.crmv_uf OR NEW.aberto_em IS DISTINCT FROM OLD.aberto_em THEN
    RAISE EXCEPTION 'Estes dados do atendimento não mudam';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_clinica_atendimento_guarda ON public.pet_atendimentos_clinicos;
CREATE TRIGGER trg_clinica_atendimento_guarda BEFORE UPDATE OR DELETE ON public.pet_atendimentos_clinicos
  FOR EACH ROW EXECUTE FUNCTION public._clinica_atendimento_guarda();

CREATE OR REPLACE FUNCTION public._clinica_adendo_guarda()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'O adendo não se altera nem se apaga';
END $$;
DROP TRIGGER IF EXISTS trg_clinica_adendo_guarda ON public.pet_atendimento_adendos;
CREATE TRIGGER trg_clinica_adendo_guarda BEFORE UPDATE OR DELETE ON public.pet_atendimento_adendos
  FOR EACH ROW EXECUTE FUNCTION public._clinica_adendo_guarda();

-- ============ acesso: nenhuma leitura nem escrita direta ============
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pet_atendimentos_clinicos', 'pet_atendimento_adendos', 'clinica_acessos'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('CREATE POLICY salao_restrito ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()))', t);
  END LOOP;
END $$;
-- a auditoria de acessos (sem texto clínico) é lida pela gestão
GRANT SELECT ON public.clinica_acessos TO authenticated;
CREATE POLICY clinica_acessos_ler ON public.clinica_acessos FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.clinica_liberada()
         AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')));

-- ============ apoio ============
-- O veterinário da conta: perfil, clínica liberada e cadastro ativo com CRMV.
CREATE OR REPLACE FUNCTION public._clinica_vet()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v uuid;
BEGIN
  PERFORM public.exige_papel(ARRAY['veterinario']);
  IF NOT public.clinica_liberada() THEN RAISE EXCEPTION 'A clínica não está liberada para esta empresa'; END IF;
  SELECT id INTO v FROM public.pet_profissionais
   WHERE profile_id = auth.uid() AND tenant_id = public.current_tenant_id() AND ativo AND funcao = 'veterinario' AND crmv IS NOT NULL;
  IF v IS NULL THEN RAISE EXCEPTION 'Sua conta não está ligada a um veterinário ativo com CRMV: peça à gestão'; END IF;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public._clinica_vet() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._clinica_atendimento_json(p_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
      'id', a.id, 'pet_id', a.pet_id, 'agendamento_id', a.agendamento_id, 'situacao', a.situacao,
      'aberto_em', a.aberto_em, 'fechado_em', a.fechado_em,
      'veterinario', jsonb_build_object('id', a.veterinario_id, 'nome', v.nome, 'crmv', a.crmv, 'crmv_uf', a.crmv_uf),
      'queixa', a.queixa, 'anamnese', a.anamnese, 'peso_kg', a.peso_kg, 'temperatura_c', a.temperatura_c,
      'freq_cardiaca', a.freq_cardiaca, 'freq_respiratoria', a.freq_respiratoria, 'exame_fisico', a.exame_fisico,
      'diagnostico', a.diagnostico, 'conduta', a.conduta, 'retorno_em', a.retorno_em, 'observacoes', a.observacoes,
      'pet', jsonb_build_object('nome', pt.nome, 'especie', pt.especie, 'raca', pt.raca, 'porte', pt.porte, 'sexo', pt.sexo, 'pelagem', pt.pelagem,
                                'peso_kg', pt.peso_kg, 'nascimento', pt.nascimento, 'castrado', pt.castrado, 'alergias', pt.alergias),
      'tutor', c.nome,
      'adendos', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'texto', d.texto, 'created_at', d.created_at, 'veterinario', dv.nome,
                                                                'crmv', d.crmv, 'crmv_uf', d.crmv_uf) ORDER BY d.created_at), '[]'::jsonb)
                    FROM public.pet_atendimento_adendos d JOIN public.pet_profissionais dv ON dv.id = d.veterinario_id
                   WHERE d.atendimento_id = a.id))
    FROM public.pet_atendimentos_clinicos a
    JOIN public.pet_profissionais v ON v.id = a.veterinario_id
    JOIN public.pets pt ON pt.id = a.pet_id
    JOIN public.clientes c ON c.id = a.cliente_id
   WHERE a.id = p_id AND a.tenant_id = public.current_tenant_id()
$$;
REVOKE ALL ON FUNCTION public._clinica_atendimento_json(uuid) FROM PUBLIC, anon, authenticated;

-- ============ buscar paciente ============
CREATE OR REPLACE FUNCTION public.clinica_pacientes(p_busca text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_busca text := btrim(coalesce(p_busca, ''));
BEGIN
  PERFORM public._clinica_vet();
  IF length(v_busca) < 2 THEN RAISE EXCEPTION 'Digite ao menos 2 letras do nome do pet ou do tutor'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(x ORDER BY x ->> 'nome')
      FROM (
        SELECT jsonb_build_object('id', pt.id, 'nome', pt.nome, 'especie', pt.especie, 'raca', pt.raca, 'tutor', c.nome) AS x
          FROM public.pets pt JOIN public.clientes c ON c.id = pt.cliente_id
         WHERE pt.tenant_id = public.current_tenant_id() AND pt.ativo
           AND (pt.nome ILIKE '%' || v_busca || '%' OR c.nome ILIKE '%' || v_busca || '%')
         ORDER BY pt.nome LIMIT 30
      ) q
  ), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.clinica_pacientes(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_pacientes(text) TO authenticated;

-- ============ abrir o atendimento da consulta agendada ============
-- Idempotente: se já existe, devolve. Só o veterinário da consulta; o agendamento precisa ter um serviço de consulta.
CREATE OR REPLACE FUNCTION public.clinica_atendimento_abrir(p_agendamento_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_vet uuid := public._clinica_vet();
  v_tenant uuid := public.current_tenant_id();
  ag public.pet_agendamentos%ROWTYPE;
  v_id uuid;
  v_crmv text; v_uf text;
BEGIN
  SELECT * INTO ag FROM public.pet_agendamentos WHERE id = p_agendamento_id AND tenant_id = v_tenant AND profissional_id = v_vet FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Consulta não encontrada na sua agenda'; END IF;
  SELECT id INTO v_id FROM public.pet_atendimentos_clinicos WHERE agendamento_id = ag.id;
  IF v_id IS NULL THEN
    IF ag.situacao NOT IN ('agendado', 'confirmado', 'em_atendimento') THEN
      RAISE EXCEPTION 'Esta consulta está "%": não dá para abrir o prontuário', ag.situacao;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.pet_agendamento_itens i JOIN public.pet_servicos s ON s.id = i.servico_id
                    WHERE i.agendamento_id = ag.id AND s.categoria = 'consulta') THEN
      RAISE EXCEPTION 'Este agendamento não tem serviço de consulta';
    END IF;
    SELECT crmv, crmv_uf INTO v_crmv, v_uf FROM public.pet_profissionais WHERE id = v_vet;
    INSERT INTO public.pet_atendimentos_clinicos (tenant_id, pet_id, cliente_id, agendamento_id, veterinario_id, crmv, crmv_uf)
    VALUES (v_tenant, ag.pet_id, ag.cliente_id, ag.id, v_vet, v_crmv, v_uf) RETURNING id INTO v_id;
    IF ag.situacao <> 'em_atendimento' THEN
      UPDATE public.pet_agendamentos SET situacao = 'em_atendimento' WHERE id = ag.id;
    END IF;
  END IF;
  INSERT INTO public.clinica_acessos (tenant_id, pet_id, atendimento_id, acao) VALUES (v_tenant, ag.pet_id, v_id, 'atendimento');
  RETURN public._clinica_atendimento_json(v_id);
END $$;
REVOKE ALL ON FUNCTION public.clinica_atendimento_abrir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_atendimento_abrir(uuid) TO authenticated;

-- ============ preencher (enquanto aberto, só quem abriu) ============
CREATE OR REPLACE FUNCTION public.clinica_atendimento_salvar(p_id uuid, p_dados jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_vet uuid := public._clinica_vet();
  a public.pet_atendimentos_clinicos%ROWTYPE;
  v_peso numeric; v_temp numeric; v_fc integer; v_fr integer; v_retorno date;
BEGIN
  SELECT * INTO a FROM public.pet_atendimentos_clinicos WHERE id = p_id AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Atendimento não encontrado'; END IF;
  IF a.veterinario_id <> v_vet THEN RAISE EXCEPTION 'Só o veterinário que abriu o atendimento preenche'; END IF;
  IF a.situacao <> 'aberto' THEN RAISE EXCEPTION 'Atendimento fechado: registre um adendo'; END IF;
  BEGIN
    v_peso := nullif(replace(btrim(coalesce(p_dados ->> 'peso_kg', '')), ',', '.'), '')::numeric;
    v_temp := nullif(replace(btrim(coalesce(p_dados ->> 'temperatura_c', '')), ',', '.'), '')::numeric;
    v_fc := nullif(btrim(coalesce(p_dados ->> 'freq_cardiaca', '')), '')::integer;
    v_fr := nullif(btrim(coalesce(p_dados ->> 'freq_respiratoria', '')), '')::integer;
    v_retorno := nullif(btrim(coalesce(p_dados ->> 'retorno_em', '')), '')::date;
  EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'Confira os números e a data do retorno';
  END;
  IF v_peso IS NOT NULL AND (v_peso <= 0 OR v_peso > 200) THEN RAISE EXCEPTION 'Peso fora do esperado (até 200 kg)'; END IF;
  IF v_temp IS NOT NULL AND (v_temp < 30 OR v_temp > 45) THEN RAISE EXCEPTION 'Temperatura fora do esperado (30 a 45 °C)'; END IF;
  IF v_fc IS NOT NULL AND (v_fc < 10 OR v_fc > 400) THEN RAISE EXCEPTION 'Frequência cardíaca fora do esperado'; END IF;
  IF v_fr IS NOT NULL AND (v_fr < 2 OR v_fr > 200) THEN RAISE EXCEPTION 'Frequência respiratória fora do esperado'; END IF;
  IF v_retorno IS NOT NULL AND v_retorno < (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN RAISE EXCEPTION 'O retorno não pode ser no passado'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['queixa', 'anamnese', 'exame_fisico', 'diagnostico', 'conduta', 'observacoes']) k
              WHERE length(coalesce(p_dados ->> k, '')) > 8000) THEN
    RAISE EXCEPTION 'Cada campo de texto aceita até 8000 caracteres';
  END IF;
  UPDATE public.pet_atendimentos_clinicos SET
      queixa = nullif(btrim(coalesce(p_dados ->> 'queixa', '')), ''),
      anamnese = nullif(btrim(coalesce(p_dados ->> 'anamnese', '')), ''),
      exame_fisico = nullif(btrim(coalesce(p_dados ->> 'exame_fisico', '')), ''),
      diagnostico = nullif(btrim(coalesce(p_dados ->> 'diagnostico', '')), ''),
      conduta = nullif(btrim(coalesce(p_dados ->> 'conduta', '')), ''),
      observacoes = nullif(btrim(coalesce(p_dados ->> 'observacoes', '')), ''),
      peso_kg = v_peso, temperatura_c = v_temp, freq_cardiaca = v_fc, freq_respiratoria = v_fr, retorno_em = v_retorno
   WHERE id = a.id;
  RETURN public._clinica_atendimento_json(a.id);
END $$;
REVOKE ALL ON FUNCTION public.clinica_atendimento_salvar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_atendimento_salvar(uuid, jsonb) TO authenticated;

-- ============ fechar: fica imutável e a consulta vai para "pronto" (a recepção cobra) ============
CREATE OR REPLACE FUNCTION public.clinica_atendimento_fechar(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_vet uuid := public._clinica_vet();
  a public.pet_atendimentos_clinicos%ROWTYPE;
BEGIN
  SELECT * INTO a FROM public.pet_atendimentos_clinicos WHERE id = p_id AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Atendimento não encontrado'; END IF;
  IF a.veterinario_id <> v_vet THEN RAISE EXCEPTION 'Só o veterinário que abriu o atendimento fecha'; END IF;
  IF a.situacao <> 'aberto' THEN RAISE EXCEPTION 'Este atendimento já está fechado'; END IF;
  IF a.queixa IS NULL THEN RAISE EXCEPTION 'Preencha a queixa antes de fechar'; END IF;
  IF a.conduta IS NULL THEN RAISE EXCEPTION 'Preencha a conduta antes de fechar'; END IF;
  UPDATE public.pet_atendimentos_clinicos SET situacao = 'fechado', fechado_em = now() WHERE id = a.id;
  UPDATE public.pet_agendamentos SET situacao = 'pronto' WHERE id = a.agendamento_id AND situacao = 'em_atendimento';
  RETURN public._clinica_atendimento_json(a.id);
END $$;
REVOKE ALL ON FUNCTION public.clinica_atendimento_fechar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_atendimento_fechar(uuid) TO authenticated;

-- ============ adendo: correção ou complemento de atendimento fechado, por qualquer veterinário da clínica (identificado) ============
CREATE OR REPLACE FUNCTION public.clinica_adendo_criar(p_atendimento_id uuid, p_texto text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_vet uuid := public._clinica_vet();
  v_texto text := btrim(coalesce(p_texto, ''));
  a public.pet_atendimentos_clinicos%ROWTYPE;
  v_crmv text; v_uf text;
BEGIN
  IF v_texto = '' THEN RAISE EXCEPTION 'Escreva o adendo'; END IF;
  IF length(v_texto) > 8000 THEN RAISE EXCEPTION 'O adendo aceita até 8000 caracteres'; END IF;
  SELECT * INTO a FROM public.pet_atendimentos_clinicos WHERE id = p_atendimento_id AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Atendimento não encontrado'; END IF;
  IF a.situacao <> 'fechado' THEN RAISE EXCEPTION 'Adendo só em atendimento fechado: edite o atendimento aberto'; END IF;
  SELECT crmv, crmv_uf INTO v_crmv, v_uf FROM public.pet_profissionais WHERE id = v_vet;
  INSERT INTO public.pet_atendimento_adendos (tenant_id, atendimento_id, veterinario_id, crmv, crmv_uf, texto)
  VALUES (a.tenant_id, a.id, v_vet, v_crmv, v_uf, v_texto);
  RETURN public._clinica_atendimento_json(a.id);
END $$;
REVOKE ALL ON FUNCTION public.clinica_adendo_criar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_adendo_criar(uuid, text) TO authenticated;

-- ============ ficha do paciente: dados do pet e histórico de atendimentos ============
CREATE OR REPLACE FUNCTION public.clinica_historico(p_pet_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  pt public.pets%ROWTYPE;
  v_tutor text;
BEGIN
  PERFORM public._clinica_vet();
  SELECT * INTO pt FROM public.pets WHERE id = p_pet_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paciente não encontrado'; END IF;
  SELECT nome INTO v_tutor FROM public.clientes WHERE id = pt.cliente_id;
  INSERT INTO public.clinica_acessos (tenant_id, pet_id, acao) VALUES (v_tenant, pt.id, 'historico');
  RETURN jsonb_build_object(
    'pet', jsonb_build_object('id', pt.id, 'nome', pt.nome, 'especie', pt.especie, 'raca', pt.raca, 'porte', pt.porte, 'sexo', pt.sexo,
                              'pelagem', pt.pelagem, 'peso_kg', pt.peso_kg, 'nascimento', pt.nascimento, 'castrado', pt.castrado,
                              'alergias', pt.alergias, 'observacoes', pt.observacoes),
    'tutor', v_tutor,
    'atendimentos', coalesce((SELECT jsonb_agg(public._clinica_atendimento_json(a.id) ORDER BY a.aberto_em DESC)
                                FROM public.pet_atendimentos_clinicos a WHERE a.pet_id = pt.id AND a.tenant_id = v_tenant), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.clinica_historico(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_historico(uuid) TO authenticated;

-- A alergia do cadastro do pet aparece na agenda do banho: o veterinário a atualiza por aqui (a recepção não edita texto clínico).
CREATE OR REPLACE FUNCTION public.clinica_pet_alergias(p_pet_id uuid, p_alergias text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_texto text := nullif(btrim(coalesce(p_alergias, '')), '');
BEGIN
  PERFORM public._clinica_vet();
  IF length(coalesce(v_texto, '')) > 1000 THEN RAISE EXCEPTION 'A alergia aceita até 1000 caracteres'; END IF;
  UPDATE public.pets SET alergias = v_texto WHERE id = p_pet_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paciente não encontrado'; END IF;
  INSERT INTO public.clinica_acessos (tenant_id, pet_id, acao) VALUES (v_tenant, p_pet_id, 'alergias');
END $$;
REVOKE ALL ON FUNCTION public.clinica_pet_alergias(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_pet_alergias(uuid, text) TO authenticated;

-- ============ a agenda do veterinário diz a categoria de cada serviço (para abrir o prontuário só da consulta) ============
DO $$
DECLARE
  def text;
  nova text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'pet_minha_agenda';
  IF def IS NULL THEN RAISE EXCEPTION 'pet_minha_agenda não encontrada'; END IF;
  IF position('''categoria''' IN def) > 0 THEN RETURN; END IF;
  nova := replace(def, '''nome'', s.nome, ''duracao_min'', i.duracao_min', '''nome'', s.nome, ''categoria'', s.categoria, ''duracao_min'', i.duracao_min');
  IF nova = def THEN RAISE EXCEPTION 'pet_minha_agenda: trecho esperado não encontrado'; END IF;
  EXECUTE nova;
END $$;
