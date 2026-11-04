-- Internação: sinais vitais estruturados (valor, unidade, momento da medição e autor), com histórico e correção sem perda.
-- Decisões da clínica: o catálogo de parâmetros e unidades é POR EMPRESA e nasce VAZIO (o sistema não inventa parâmetros, faixas
-- nem alertas); registrar é do veterinário ou do auxiliar (mesma regra de pesagem e ocorrência); a recepção e a gestão não leem.
-- Fatos clínicos não se alteram nem se apagam: corrigir ou anular é um NOVO registro ligado ao original, com motivo.
-- Ausência de medida (nenhum registro) é diferente de valor zero (registro com valor 0) e de "não foi possível medir"
-- (registro sem valor e com motivo). Tudo por função; as tabelas não têm acesso direto.

-- ============ catálogo por empresa ============
CREATE TABLE IF NOT EXISTS public.pet_sinais_parametros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 40),
  unidade text NOT NULL CHECK (length(btrim(unidade)) BETWEEN 1 AND 20),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pet_sinais_parametros_nome_idx ON public.pet_sinais_parametros (tenant_id, lower(btrim(nome)));
DROP TRIGGER IF EXISTS trg_pet_sinais_parametros_updated ON public.pet_sinais_parametros;
CREATE TRIGGER trg_pet_sinais_parametros_updated BEFORE UPDATE ON public.pet_sinais_parametros
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ registros ============
CREATE TABLE IF NOT EXISTS public.pet_internacao_sinais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id),
  internacao_id uuid NOT NULL REFERENCES public.pet_internacoes(id),
  parametro_id uuid NOT NULL REFERENCES public.pet_sinais_parametros(id),
  -- nome e unidade do momento: mudar o catálogo depois não muda o que foi registrado
  parametro_nome text NOT NULL,
  unidade text NOT NULL,
  valor numeric CHECK (valor IS NULL OR abs(valor) <= 100000),
  observacao text CHECK (observacao IS NULL OR length(btrim(observacao)) BETWEEN 1 AND 300),
  medido_em timestamptz NOT NULL,
  registrado_em timestamptz NOT NULL DEFAULT now(),
  profissional_id uuid NOT NULL REFERENCES public.pet_profissionais(id),
  -- chave de repetição enviada pela tela: o mesmo envio feito duas vezes não duplica o registro
  chave text CHECK (chave IS NULL OR length(chave) BETWEEN 8 AND 80),
  corrige_id uuid REFERENCES public.pet_internacao_sinais(id),
  motivo_correcao text CHECK (motivo_correcao IS NULL OR length(btrim(motivo_correcao)) BETWEEN 3 AND 300),
  anulado boolean NOT NULL DEFAULT false,
  -- registro sem valor precisa dizer por quê (ex.: animal agitado); anulação não tem valor
  CHECK (anulado OR valor IS NOT NULL OR observacao IS NOT NULL),
  CHECK (NOT anulado OR (corrige_id IS NOT NULL AND valor IS NULL)),
  CHECK ((corrige_id IS NULL) = (motivo_correcao IS NULL))
);
CREATE INDEX IF NOT EXISTS pet_internacao_sinais_serie_idx ON public.pet_internacao_sinais (tenant_id, internacao_id, parametro_id, medido_em);
-- um registro só pode ser corrigido uma vez (a correção pode ser corrigida de novo: forma uma cadeia)
CREATE UNIQUE INDEX IF NOT EXISTS pet_internacao_sinais_corrige_idx ON public.pet_internacao_sinais (corrige_id) WHERE corrige_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS pet_internacao_sinais_chave_idx ON public.pet_internacao_sinais (tenant_id, chave) WHERE chave IS NOT NULL;

CREATE OR REPLACE FUNCTION public._internacao_sinal_guarda()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Sinal vital não se altera nem se apaga: registre uma correção';
END $$;
DROP TRIGGER IF EXISTS trg_internacao_sinal_guarda ON public.pet_internacao_sinais;
CREATE TRIGGER trg_internacao_sinal_guarda BEFORE UPDATE OR DELETE ON public.pet_internacao_sinais
  FOR EACH ROW EXECUTE FUNCTION public._internacao_sinal_guarda();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pet_sinais_parametros', 'pet_internacao_sinais'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS salao_restrito ON public.%I', t);
    EXECUTE format('CREATE POLICY salao_restrito ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()))', t);
  END LOOP;
END $$;

-- ============ catálogo: leitura e manutenção ============
-- Leem o catálogo quem registra (veterinário e auxiliar) e quem o mantém (gestão e veterinário).
-- p_todos (inclui os desativados) só vale para quem mantém.
CREATE OR REPLACE FUNCTION public.clinica_sinais_parametros(p_todos boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_mantem boolean;
BEGIN
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'veterinario', 'profissional']);
  IF NOT public.clinica_liberada() THEN RAISE EXCEPTION 'A clínica não está liberada para esta empresa'; END IF;
  v_mantem := public.has_role(auth.uid(), 'administrador'::public.app_role)
           OR public.has_role(auth.uid(), 'gestor'::public.app_role)
           OR public.has_role(auth.uid(), 'veterinario'::public.app_role);
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.nome, 'unidade', p.unidade, 'ativo', p.ativo) ORDER BY lower(p.nome))
      FROM public.pet_sinais_parametros p
     WHERE p.tenant_id = public.current_tenant_id() AND (p.ativo OR (p_todos AND v_mantem))
  ), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.clinica_sinais_parametros(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_sinais_parametros(boolean) TO authenticated;

-- Cria ou edita um parâmetro. Mudar nome ou unidade NÃO altera o que já foi registrado (cada registro guarda o seu).
-- Parâmetro não se apaga: desative-o (some da lista de registrar, o histórico continua).
CREATE OR REPLACE FUNCTION public.clinica_sinais_parametro_salvar(p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_id uuid;
  v_nome text;
  v_unidade text;
  v_ativo boolean;
BEGIN
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'veterinario']);
  IF NOT public.clinica_liberada() THEN RAISE EXCEPTION 'A clínica não está liberada para esta empresa'; END IF;
  IF jsonb_typeof(p_dados) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Dados inválidos'; END IF;
  v_nome := btrim(coalesce(p_dados ->> 'nome', ''));
  v_unidade := btrim(coalesce(p_dados ->> 'unidade', ''));
  v_ativo := coalesce((p_dados ->> 'ativo')::boolean, true);
  IF length(v_nome) NOT BETWEEN 1 AND 40 THEN RAISE EXCEPTION 'Informe o nome do parâmetro (até 40 caracteres)'; END IF;
  IF length(v_unidade) NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'Informe a unidade (até 20 caracteres)'; END IF;
  v_id := nullif(p_dados ->> 'id', '')::uuid;
  IF v_id IS NULL THEN
    BEGIN
      INSERT INTO public.pet_sinais_parametros (tenant_id, nome, unidade, ativo) VALUES (v_tenant, v_nome, v_unidade, v_ativo) RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'Já existe um parâmetro com o nome %', v_nome;
    END;
  ELSE
    BEGIN
      UPDATE public.pet_sinais_parametros SET nome = v_nome, unidade = v_unidade, ativo = v_ativo
       WHERE id = v_id AND tenant_id = v_tenant;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'Já existe um parâmetro com o nome %', v_nome;
    END;
    IF NOT FOUND THEN RAISE EXCEPTION 'Parâmetro não encontrado'; END IF;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.clinica_sinais_parametro_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_sinais_parametro_salvar(jsonb) TO authenticated;

-- ============ registrar ============
-- Converte o texto do valor (aceita vírgula decimal). NULL para vazio; erro para o que não for número comum.
CREATE OR REPLACE FUNCTION public._sinal_valor(p_texto text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE t text := btrim(coalesce(p_texto, ''));
BEGIN
  IF t = '' THEN RETURN NULL; END IF;
  IF t !~ '^-?[0-9]{1,6}([.,][0-9]{1,4})?$' THEN RAISE EXCEPTION 'Valor inválido: use só números (ex.: 38,5)'; END IF;
  RETURN replace(t, ',', '.')::numeric;
END $$;
REVOKE ALL ON FUNCTION public._sinal_valor(text) FROM PUBLIC, anon, authenticated;

-- p_dados: {parametro_id, valor?, observacao?, medido_em?, chave?}. Sem valor, a observação é obrigatória.
-- medido_em não pode ser antes da admissão nem mais de 5 minutos no futuro. Mesma chave devolve o registro já criado.
CREATE OR REPLACE FUNCTION public.clinica_sinal_registrar(p_internacao_id uuid, p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  a jsonb := public._internacao_ator(false);
  i public.pet_internacoes;
  par public.pet_sinais_parametros;
  v_valor numeric;
  v_obs text;
  v_quando timestamptz;
  v_chave text;
  v_id uuid;
BEGIN
  IF jsonb_typeof(p_dados) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Dados inválidos'; END IF;
  i := public._internacao_aberta(p_internacao_id);
  v_chave := nullif(btrim(coalesce(p_dados ->> 'chave', '')), '');
  IF v_chave IS NOT NULL THEN
    SELECT id INTO v_id FROM public.pet_internacao_sinais WHERE tenant_id = i.tenant_id AND chave = v_chave;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;
  SELECT * INTO par FROM public.pet_sinais_parametros
   WHERE id = nullif(p_dados ->> 'parametro_id', '')::uuid AND tenant_id = i.tenant_id AND ativo;
  IF par.id IS NULL THEN RAISE EXCEPTION 'Escolha um parâmetro ativo'; END IF;
  v_valor := public._sinal_valor(p_dados ->> 'valor');
  v_obs := nullif(btrim(coalesce(p_dados ->> 'observacao', '')), '');
  IF v_valor IS NULL AND v_obs IS NULL THEN RAISE EXCEPTION 'Informe o valor ou explique por que não foi possível medir'; END IF;
  IF v_obs IS NOT NULL AND length(v_obs) > 300 THEN RAISE EXCEPTION 'A observação aceita até 300 caracteres'; END IF;
  BEGIN
    v_quando := coalesce(nullif(p_dados ->> 'medido_em', '')::timestamptz, now());
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Horário da medição inválido';
  END;
  IF v_quando < i.admitido_em THEN RAISE EXCEPTION 'A medição não pode ser anterior à admissão'; END IF;
  IF v_quando > now() + interval '5 minutes' THEN RAISE EXCEPTION 'A medição não pode estar no futuro'; END IF;
  INSERT INTO public.pet_internacao_sinais (tenant_id, internacao_id, parametro_id, parametro_nome, unidade, valor, observacao, medido_em, profissional_id, chave)
  VALUES (i.tenant_id, i.id, par.id, par.nome, par.unidade, v_valor, v_obs, v_quando, (a ->> 'id')::uuid, v_chave)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.clinica_sinal_registrar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_sinal_registrar(uuid, jsonb) TO authenticated;

-- ============ corrigir ou anular ============
-- Cria um NOVO registro ligado ao original (que continua no histórico). p_dados: {motivo, anular?, valor?, observacao?, medido_em?}.
-- Quem corrige: o veterinário, ou o próprio autor do registro. Só com a internação aberta. Parâmetro e unidade são os do original.
CREATE OR REPLACE FUNCTION public.clinica_sinal_corrigir(p_id uuid, p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  a jsonb := public._internacao_ator(false);
  o public.pet_internacao_sinais;
  i public.pet_internacoes;
  v_anular boolean;
  v_motivo text;
  v_valor numeric;
  v_obs text;
  v_quando timestamptz;
  v_id uuid;
BEGIN
  IF jsonb_typeof(p_dados) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Dados inválidos'; END IF;
  SELECT * INTO o FROM public.pet_internacao_sinais WHERE id = p_id AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Registro não encontrado'; END IF;
  i := public._internacao_aberta(o.internacao_id);
  IF (a ->> 'funcao') <> 'veterinario' AND o.profissional_id <> (a ->> 'id')::uuid THEN
    RAISE EXCEPTION 'Só o veterinário ou quem fez o registro pode corrigi-lo';
  END IF;
  IF o.anulado THEN RAISE EXCEPTION 'Este registro é uma anulação: não há o que corrigir'; END IF;
  IF EXISTS (SELECT 1 FROM public.pet_internacao_sinais WHERE corrige_id = o.id) THEN
    RAISE EXCEPTION 'Este registro já foi corrigido: corrija a versão mais recente';
  END IF;
  v_motivo := btrim(coalesce(p_dados ->> 'motivo', ''));
  IF length(v_motivo) NOT BETWEEN 3 AND 300 THEN RAISE EXCEPTION 'Informe o motivo da correção (3 a 300 caracteres)'; END IF;
  v_anular := coalesce((p_dados ->> 'anular')::boolean, false);
  v_obs := nullif(btrim(coalesce(p_dados ->> 'observacao', '')), '');
  IF v_obs IS NOT NULL AND length(v_obs) > 300 THEN RAISE EXCEPTION 'A observação aceita até 300 caracteres'; END IF;
  IF v_anular THEN
    v_valor := NULL;
  ELSE
    v_valor := public._sinal_valor(p_dados ->> 'valor');
    IF v_valor IS NULL AND v_obs IS NULL THEN RAISE EXCEPTION 'Informe o valor corrigido ou explique por que não foi possível medir'; END IF;
  END IF;
  BEGIN
    v_quando := coalesce(nullif(p_dados ->> 'medido_em', '')::timestamptz, o.medido_em);
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Horário da medição inválido';
  END;
  IF v_quando < i.admitido_em THEN RAISE EXCEPTION 'A medição não pode ser anterior à admissão'; END IF;
  IF v_quando > now() + interval '5 minutes' THEN RAISE EXCEPTION 'A medição não pode estar no futuro'; END IF;
  INSERT INTO public.pet_internacao_sinais (tenant_id, internacao_id, parametro_id, parametro_nome, unidade, valor, observacao, medido_em,
                                            profissional_id, corrige_id, motivo_correcao, anulado)
  VALUES (o.tenant_id, o.internacao_id, o.parametro_id, o.parametro_nome, o.unidade, v_valor, v_obs, v_quando,
          (a ->> 'id')::uuid, o.id, v_motivo, v_anular)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.clinica_sinal_corrigir(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_sinal_corrigir(uuid, jsonb) TO authenticated;

-- ============ histórico da internação ============
-- Todos os registros (inclusive os corrigidos e as anulações), do mais antigo ao mais novo por horário de medição.
-- "substituido_por" aponta a correção que o substituiu; "corrente" = vale hoje (não foi substituído e não é anulação).
-- Quem lê: veterinário e auxiliar (a recepção e a gestão não veem sinais vitais). A leitura entra no registro de acessos.
CREATE OR REPLACE FUNCTION public.clinica_sinais_internacao(p_internacao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  a jsonb := public._internacao_ator(false);
  v_tenant uuid := public.current_tenant_id();
  i public.pet_internacoes;
BEGIN
  SELECT * INTO i FROM public.pet_internacoes WHERE id = p_internacao_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Internação não encontrada'; END IF;
  INSERT INTO public.clinica_acessos (tenant_id, pet_id, acao) VALUES (v_tenant, i.pet_id, 'internacao');
  RETURN jsonb_build_object(
    'sou_veterinario', (a ->> 'funcao') = 'veterinario',
    'meu_profissional_id', a ->> 'id',
    'registros', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', s.id, 'parametro_id', s.parametro_id, 'parametro', s.parametro_nome, 'unidade', s.unidade,
               'valor', s.valor, 'observacao', s.observacao, 'medido_em', s.medido_em, 'registrado_em', s.registrado_em,
               'profissional_id', s.profissional_id, 'profissional', p.nome, 'funcao', p.funcao,
               'corrige_id', s.corrige_id, 'motivo_correcao', s.motivo_correcao, 'anulado', s.anulado,
               'substituido_por', (SELECT c.id FROM public.pet_internacao_sinais c WHERE c.corrige_id = s.id),
               'corrente', (NOT s.anulado AND NOT EXISTS (SELECT 1 FROM public.pet_internacao_sinais c WHERE c.corrige_id = s.id))
             ) ORDER BY s.medido_em, s.registrado_em, s.id)
        FROM public.pet_internacao_sinais s JOIN public.pet_profissionais p ON p.id = s.profissional_id
       WHERE s.internacao_id = i.id AND s.tenant_id = v_tenant
    ), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.clinica_sinais_internacao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_sinais_internacao(uuid) TO authenticated;
