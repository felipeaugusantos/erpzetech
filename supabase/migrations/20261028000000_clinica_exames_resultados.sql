-- Clínica (Fase 4, PR 3): resultados de exame. O veterinário abre um exame a partir de um modelo (PR 2), para um paciente, ligado a um atendimento
-- aberto dele ou avulso (resultado de laboratório externo, com laboratório e data da coleta), e preenche os valores. Campo em branco é "não feito".
-- Ao abrir, o exame guarda cópia de cada campo (nome, unidade, casas, opções e faixa de referência da espécie): editar o modelo depois não muda o exame.
-- Exame fechado é imutável (nem o dono do banco altera); correção é adendo com nome e CRMV; exame aberto por engano é cancelado com motivo.
-- Só o veterinário lê e escreve; as tabelas não têm acesso direto e cada acesso fica em clinica_acessos.

-- ============ tabelas ============
CREATE TABLE IF NOT EXISTS public.pet_exames (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id),
  pet_id uuid NOT NULL REFERENCES public.pets(id),
  atendimento_id uuid REFERENCES public.pet_atendimentos_clinicos(id),
  modelo_id uuid NOT NULL REFERENCES public.pet_exame_modelos(id),
  veterinario_id uuid NOT NULL REFERENCES public.pet_profissionais(id),
  -- o CRMV vale como estava na abertura
  crmv text NOT NULL,
  crmv_uf text NOT NULL,
  -- nome e tipo do modelo como estavam na abertura
  nome text NOT NULL,
  tipo text NOT NULL,
  material text,
  laboratorio text,
  data_coleta date NOT NULL,
  observacoes text,
  situacao text NOT NULL DEFAULT 'aberto' CHECK (situacao IN ('aberto', 'fechado', 'cancelado')),
  aberto_em timestamptz NOT NULL DEFAULT now(),
  fechado_em timestamptz,
  cancelado_em timestamptz,
  cancelado_motivo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (atendimento_id IS NOT NULL OR length(btrim(coalesce(laboratorio, ''))) > 0),
  CHECK ((situacao = 'fechado') = (fechado_em IS NOT NULL)),
  CHECK ((situacao = 'cancelado') = (cancelado_em IS NOT NULL AND length(btrim(coalesce(cancelado_motivo, ''))) > 0))
);
CREATE INDEX IF NOT EXISTS pet_exames_pet_idx ON public.pet_exames (tenant_id, pet_id, data_coleta DESC);
CREATE INDEX IF NOT EXISTS pet_exames_atend_idx ON public.pet_exames (atendimento_id) WHERE atendimento_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.pet_exame_resultados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id),
  exame_id uuid NOT NULL REFERENCES public.pet_exames(id),
  campo_id uuid REFERENCES public.pet_exame_campos(id),
  -- cópia do campo na abertura do exame
  ordem integer NOT NULL CHECK (ordem >= 0),
  grupo text,
  nome text NOT NULL,
  unidade text,
  forma text NOT NULL CHECK (forma IN ('numero', 'texto', 'escolha', 'calculado')),
  casas integer CHECK (casas BETWEEN 0 AND 6),
  opcoes jsonb,
  total_id uuid REFERENCES public.pet_exame_resultados(id),
  pct_id uuid REFERENCES public.pet_exame_resultados(id),
  -- faixa de referência: a do modelo para a espécie na abertura, que o veterinário pode ajustar (laudo externo traz a do laboratório)
  faixa_min numeric,
  faixa_max numeric,
  -- o que o veterinário preenche (em branco = não feito)
  valor_num numeric CHECK (valor_num IS NULL OR (valor_num >= 0 AND valor_num < 1000000000000)),
  valor_texto text,
  nota text,
  UNIQUE (exame_id, ordem),
  CHECK (faixa_min IS NULL OR faixa_max IS NULL OR faixa_min <= faixa_max),
  CHECK (forma IN ('numero', 'calculado') OR (faixa_min IS NULL AND faixa_max IS NULL AND valor_num IS NULL)),
  CHECK (forma IN ('texto', 'escolha') OR valor_texto IS NULL)
);

CREATE TABLE IF NOT EXISTS public.pet_exame_adendos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id),
  exame_id uuid NOT NULL REFERENCES public.pet_exames(id),
  veterinario_id uuid NOT NULL REFERENCES public.pet_profissionais(id),
  crmv text NOT NULL,
  crmv_uf text NOT NULL,
  texto text NOT NULL CHECK (length(btrim(texto)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pet_exame_adendos_idx ON public.pet_exame_adendos (exame_id, created_at);

ALTER TABLE public.clinica_acessos DROP CONSTRAINT IF EXISTS clinica_acessos_acao_check;
ALTER TABLE public.clinica_acessos ADD CONSTRAINT clinica_acessos_acao_check CHECK (acao IN ('historico', 'atendimento', 'alergias', 'vacinacao', 'exame'));

-- ============ imutabilidade ============
-- O exame só muda enquanto está aberto, e nunca se apaga; fechar e cancelar são definitivos.
CREATE OR REPLACE FUNCTION public._clinica_exame_guarda()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'O exame não se apaga: cancele com motivo'; END IF;
  IF OLD.situacao = 'fechado' THEN RAISE EXCEPTION 'Exame fechado não pode ser alterado: registre um adendo'; END IF;
  IF OLD.situacao = 'cancelado' THEN RAISE EXCEPTION 'Exame cancelado não muda'; END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.pet_id IS DISTINCT FROM OLD.pet_id OR NEW.atendimento_id IS DISTINCT FROM OLD.atendimento_id
     OR NEW.modelo_id IS DISTINCT FROM OLD.modelo_id OR NEW.veterinario_id IS DISTINCT FROM OLD.veterinario_id OR NEW.crmv IS DISTINCT FROM OLD.crmv
     OR NEW.crmv_uf IS DISTINCT FROM OLD.crmv_uf OR NEW.nome IS DISTINCT FROM OLD.nome OR NEW.tipo IS DISTINCT FROM OLD.tipo
     OR NEW.aberto_em IS DISTINCT FROM OLD.aberto_em THEN
    RAISE EXCEPTION 'Estes dados do exame não mudam';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_clinica_exame_guarda ON public.pet_exames;
CREATE TRIGGER trg_clinica_exame_guarda BEFORE UPDATE OR DELETE ON public.pet_exames
  FOR EACH ROW EXECUTE FUNCTION public._clinica_exame_guarda();

-- Resultado: só nasce e muda com o exame aberto, e só nos campos que o veterinário preenche.
CREATE OR REPLACE FUNCTION public._clinica_exame_resultado_guarda()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE v_situacao text;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'O resultado do exame não se apaga'; END IF;
  SELECT situacao INTO v_situacao FROM public.pet_exames WHERE id = NEW.exame_id;
  IF v_situacao IS DISTINCT FROM 'aberto' THEN RAISE EXCEPTION 'Exame fechado ou cancelado não muda: registre um adendo'; END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'faixa_min' - 'faixa_max' - 'valor_num' - 'valor_texto' - 'nota')
                          IS DISTINCT FROM (to_jsonb(OLD) - 'faixa_min' - 'faixa_max' - 'valor_num' - 'valor_texto' - 'nota') THEN
    RAISE EXCEPTION 'A cópia do campo no exame não muda';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_clinica_exame_resultado_guarda ON public.pet_exame_resultados;
CREATE TRIGGER trg_clinica_exame_resultado_guarda BEFORE INSERT OR UPDATE OR DELETE ON public.pet_exame_resultados
  FOR EACH ROW EXECUTE FUNCTION public._clinica_exame_resultado_guarda();

CREATE OR REPLACE FUNCTION public._clinica_exame_adendo_guarda()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'O adendo do exame não se altera nem se apaga';
END $$;
DROP TRIGGER IF EXISTS trg_clinica_exame_adendo_guarda ON public.pet_exame_adendos;
CREATE TRIGGER trg_clinica_exame_adendo_guarda BEFORE UPDATE OR DELETE ON public.pet_exame_adendos
  FOR EACH ROW EXECUTE FUNCTION public._clinica_exame_adendo_guarda();

-- ============ acesso: nenhuma leitura nem escrita direta ============
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pet_exames', 'pet_exame_resultados', 'pet_exame_adendos'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('CREATE POLICY salao_restrito ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()))', t);
  END LOOP;
END $$;

-- ============ apoio ============
CREATE OR REPLACE FUNCTION public._clinica_exame_json(p_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
      'id', e.id, 'pet_id', e.pet_id, 'atendimento_id', e.atendimento_id, 'nome', e.nome, 'tipo', e.tipo, 'material', e.material,
      'laboratorio', e.laboratorio, 'data_coleta', e.data_coleta, 'observacoes', e.observacoes, 'situacao', e.situacao,
      'aberto_em', e.aberto_em, 'fechado_em', e.fechado_em, 'cancelado_em', e.cancelado_em, 'cancelado_motivo', e.cancelado_motivo,
      'veterinario', jsonb_build_object('id', e.veterinario_id, 'nome', v.nome, 'crmv', e.crmv, 'crmv_uf', e.crmv_uf),
      'pet', jsonb_build_object('nome', pt.nome, 'especie', pt.especie, 'raca', pt.raca, 'sexo', pt.sexo, 'nascimento', pt.nascimento),
      'tutor', c.nome,
      'resultados', coalesce((SELECT jsonb_agg(jsonb_build_object(
                        'id', r.id, 'ordem', r.ordem, 'grupo', r.grupo, 'nome', r.nome, 'unidade', r.unidade, 'forma', r.forma, 'casas', r.casas,
                        'opcoes', r.opcoes, 'total_id', r.total_id, 'pct_id', r.pct_id, 'faixa_min', r.faixa_min, 'faixa_max', r.faixa_max,
                        'valor_num', r.valor_num, 'valor_texto', r.valor_texto, 'nota', r.nota) ORDER BY r.ordem)
                      FROM public.pet_exame_resultados r WHERE r.exame_id = e.id), '[]'::jsonb),
      'adendos', coalesce((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'texto', d.texto, 'created_at', d.created_at, 'veterinario', dv.nome,
                                                                'crmv', d.crmv, 'crmv_uf', d.crmv_uf) ORDER BY d.created_at)
                      FROM public.pet_exame_adendos d JOIN public.pet_profissionais dv ON dv.id = d.veterinario_id WHERE d.exame_id = e.id), '[]'::jsonb))
    FROM public.pet_exames e
    JOIN public.pet_profissionais v ON v.id = e.veterinario_id
    JOIN public.pets pt ON pt.id = e.pet_id
    JOIN public.clientes c ON c.id = pt.cliente_id
   WHERE e.id = p_id AND e.tenant_id = public.current_tenant_id()
$$;
REVOKE ALL ON FUNCTION public._clinica_exame_json(uuid) FROM PUBLIC, anon, authenticated;

-- Valor dos campos calculados: total × percentual ÷ 100, com as casas do campo; sem um dos dois, fica em branco.
CREATE OR REPLACE FUNCTION public._clinica_exame_recalcular(p_exame_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE public.pet_exame_resultados r
     SET valor_num = (SELECT round(t.valor_num * p.valor_num / 100, coalesce(r.casas, 2))
                        FROM public.pet_exame_resultados t, public.pet_exame_resultados p
                       WHERE t.id = r.total_id AND p.id = r.pct_id AND t.valor_num IS NOT NULL AND p.valor_num IS NOT NULL)
   WHERE r.exame_id = p_exame_id AND r.forma = 'calculado'
$$;
REVOKE ALL ON FUNCTION public._clinica_exame_recalcular(uuid) FROM PUBLIC, anon, authenticated;

-- Exame aberto do veterinário da conta (só quem abriu preenche, fecha ou cancela).
CREATE OR REPLACE FUNCTION public._clinica_exame_meu_aberto(p_id uuid, p_vet uuid)
RETURNS public.pet_exames
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE e public.pet_exames%ROWTYPE;
BEGIN
  SELECT * INTO e FROM public.pet_exames WHERE id = p_id AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Exame não encontrado'; END IF;
  IF e.veterinario_id <> p_vet THEN RAISE EXCEPTION 'Só o veterinário que abriu o exame mexe nele'; END IF;
  IF e.situacao <> 'aberto' THEN RAISE EXCEPTION 'Este exame está "%": não dá para alterar (no exame fechado, use um adendo)', e.situacao; END IF;
  RETURN e;
END $$;
REVOKE ALL ON FUNCTION public._clinica_exame_meu_aberto(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ============ abrir ============
-- p_dados: atendimento_id (atendimento aberto deste veterinário e deste pet), laboratorio (obrigatório se avulso), data_coleta, material.
CREATE OR REPLACE FUNCTION public.clinica_exame_abrir(p_pet_id uuid, p_modelo_id uuid, p_dados jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_vet uuid := public._clinica_vet();
  v_tenant uuid := public.current_tenant_id();
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_atend uuid := nullif(btrim(coalesce(p_dados ->> 'atendimento_id', '')), '')::uuid;
  v_lab text := nullif(btrim(coalesce(p_dados ->> 'laboratorio', '')), '');
  v_material text;
  v_coleta date;
  pt public.pets%ROWTYPE;
  m public.pet_exame_modelos%ROWTYPE;
  v_crmv text; v_uf text;
  v_id uuid;
BEGIN
  BEGIN
    v_coleta := coalesce(nullif(btrim(coalesce(p_dados ->> 'data_coleta', '')), '')::date, v_hoje);
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'Confira a data da coleta';
  END;
  IF v_coleta > v_hoje THEN RAISE EXCEPTION 'A data da coleta não pode ser no futuro'; END IF;
  IF length(coalesce(v_lab, '')) > 120 THEN RAISE EXCEPTION 'O nome do laboratório passa de 120 letras'; END IF;
  SELECT * INTO pt FROM public.pets WHERE id = p_pet_id AND tenant_id = v_tenant AND ativo;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paciente não encontrado'; END IF;
  SELECT * INTO m FROM public.pet_exame_modelos WHERE id = p_modelo_id AND tenant_id = v_tenant AND ativo;
  IF NOT FOUND THEN RAISE EXCEPTION 'Modelo de exame não encontrado ou inativo'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pet_exame_campos WHERE modelo_id = m.id AND ativo) THEN RAISE EXCEPTION 'O modelo não tem campos ativos'; END IF;
  v_material := coalesce(nullif(btrim(coalesce(p_dados ->> 'material', '')), ''), m.material);
  IF length(coalesce(v_material, '')) > 80 THEN RAISE EXCEPTION 'O material passa de 80 letras'; END IF;
  IF v_atend IS NOT NULL THEN
    PERFORM 1 FROM public.pet_atendimentos_clinicos a
     WHERE a.id = v_atend AND a.tenant_id = v_tenant AND a.pet_id = pt.id AND a.veterinario_id = v_vet AND a.situacao = 'aberto';
    IF NOT FOUND THEN RAISE EXCEPTION 'O atendimento precisa estar aberto, ser seu e ser deste paciente'; END IF;
  ELSIF v_lab IS NULL THEN
    RAISE EXCEPTION 'Exame avulso (sem atendimento aberto) precisa do nome do laboratório';
  END IF;
  SELECT crmv, crmv_uf INTO v_crmv, v_uf FROM public.pet_profissionais WHERE id = v_vet;

  INSERT INTO public.pet_exames (tenant_id, pet_id, atendimento_id, modelo_id, veterinario_id, crmv, crmv_uf, nome, tipo, material, laboratorio, data_coleta)
  VALUES (v_tenant, pt.id, v_atend, m.id, v_vet, v_crmv, v_uf, m.nome, m.tipo, v_material, v_lab, v_coleta) RETURNING id INTO v_id;

  -- copia os campos ativos do modelo (com a faixa da espécie do paciente); o id de cada resultado é sorteado antes para os calculados apontarem
  WITH campos AS (
    SELECT c.*, (row_number() OVER (ORDER BY c.ordem, c.id) - 1)::int AS pos, gen_random_uuid() AS rid
      FROM public.pet_exame_campos c WHERE c.modelo_id = m.id AND c.ativo
  )
  INSERT INTO public.pet_exame_resultados (id, tenant_id, exame_id, campo_id, ordem, grupo, nome, unidade, forma, casas, opcoes, total_id, pct_id, faixa_min, faixa_max)
  SELECT c.rid, v_tenant, v_id, c.id, c.pos, c.grupo, c.nome, c.unidade, c.forma, c.casas, c.opcoes,
         (SELECT x.rid FROM campos x WHERE x.id = c.total_campo_id), (SELECT x.rid FROM campos x WHERE x.id = c.pct_campo_id),
         ref.minimo, ref.maximo
    FROM campos c
    LEFT JOIN public.pet_exame_referencias ref ON ref.campo_id = c.id AND ref.especie = pt.especie AND c.forma IN ('numero', 'calculado');

  INSERT INTO public.clinica_acessos (tenant_id, pet_id, atendimento_id, acao) VALUES (v_tenant, pt.id, v_atend, 'exame');
  RETURN public._clinica_exame_json(v_id);
END $$;
REVOKE ALL ON FUNCTION public.clinica_exame_abrir(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_exame_abrir(uuid, uuid, jsonb) TO authenticated;

-- ============ preencher ============
-- p_dados: material, laboratorio, data_coleta, observacoes e resultados [{id, valor, nota, faixa_min, faixa_max}]. Chave ausente não muda o que já está.
CREATE OR REPLACE FUNCTION public.clinica_exame_salvar(p_id uuid, p_dados jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_vet uuid := public._clinica_vet();
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  e public.pet_exames%ROWTYPE;
  it jsonb;
  r public.pet_exame_resultados%ROWTYPE;
  v_texto text;
  v_num numeric;
  v_min numeric; v_max numeric;
  v_lab text; v_material text; v_obs text; v_coleta date;
BEGIN
  e := public._clinica_exame_meu_aberto(p_id, v_vet);
  v_lab := e.laboratorio; v_material := e.material; v_obs := e.observacoes; v_coleta := e.data_coleta;
  BEGIN
    IF p_dados ? 'laboratorio' THEN v_lab := nullif(btrim(coalesce(p_dados ->> 'laboratorio', '')), ''); END IF;
    IF p_dados ? 'material' THEN v_material := nullif(btrim(coalesce(p_dados ->> 'material', '')), ''); END IF;
    IF p_dados ? 'observacoes' THEN v_obs := nullif(btrim(coalesce(p_dados ->> 'observacoes', '')), ''); END IF;
    IF p_dados ? 'data_coleta' THEN v_coleta := (p_dados ->> 'data_coleta')::date; END IF;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR null_value_not_allowed THEN
    RAISE EXCEPTION 'Confira a data da coleta';
  END;
  IF v_coleta IS NULL OR v_coleta > v_hoje THEN RAISE EXCEPTION 'A data da coleta não pode ficar em branco nem ser no futuro'; END IF;
  IF e.atendimento_id IS NULL AND v_lab IS NULL THEN RAISE EXCEPTION 'Exame avulso precisa do nome do laboratório'; END IF;
  IF length(coalesce(v_lab, '')) > 120 OR length(coalesce(v_material, '')) > 80 OR length(coalesce(v_obs, '')) > 4000 THEN
    RAISE EXCEPTION 'Laboratório, material ou observações grande demais';
  END IF;
  UPDATE public.pet_exames SET laboratorio = v_lab, material = v_material, observacoes = v_obs, data_coleta = v_coleta WHERE id = e.id;

  IF p_dados ? 'resultados' THEN
    IF jsonb_typeof(p_dados -> 'resultados') <> 'array' THEN RAISE EXCEPTION 'Resultados em formato inválido'; END IF;
    FOR it IN SELECT * FROM jsonb_array_elements(p_dados -> 'resultados') LOOP
      SELECT * INTO r FROM public.pet_exame_resultados WHERE id = nullif(it ->> 'id', '')::uuid AND exame_id = e.id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Resultado não pertence a este exame'; END IF;
      v_num := r.valor_num; v_texto := r.valor_texto; v_min := r.faixa_min; v_max := r.faixa_max;
      BEGIN
        IF it ? 'valor' AND r.forma = 'numero' THEN
          v_num := nullif(replace(btrim(coalesce(it ->> 'valor', '')), ',', '.'), '')::numeric;
        ELSIF it ? 'valor' AND r.forma IN ('texto', 'escolha') THEN
          v_texto := nullif(btrim(coalesce(it ->> 'valor', '')), '');
        END IF;
        IF r.forma IN ('numero', 'calculado') THEN
          IF it ? 'faixa_min' THEN v_min := nullif(replace(btrim(coalesce(it ->> 'faixa_min', '')), ',', '.'), '')::numeric; END IF;
          IF it ? 'faixa_max' THEN v_max := nullif(replace(btrim(coalesce(it ->> 'faixa_max', '')), ',', '.'), '')::numeric; END IF;
        END IF;
      EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION 'Digite só números em "%"', r.nome;
      END;
      IF v_num IS NOT NULL AND (v_num < 0 OR v_num >= 1000000000000) THEN RAISE EXCEPTION '"%": valor fora do esperado', r.nome; END IF;
      IF v_min IS NOT NULL AND v_max IS NOT NULL AND v_min > v_max THEN RAISE EXCEPTION '"%": o mínimo da faixa não pode passar do máximo', r.nome; END IF;
      IF length(coalesce(v_texto, '')) > 2000 THEN RAISE EXCEPTION '"%": texto grande demais (até 2000 caracteres)', r.nome; END IF;
      IF r.forma = 'escolha' AND v_texto IS NOT NULL AND NOT (r.opcoes ? v_texto) THEN
        RAISE EXCEPTION '"%": escolha uma das opções da lista', r.nome;
      END IF;
      UPDATE public.pet_exame_resultados SET
             valor_num = CASE WHEN r.forma = 'numero' THEN v_num ELSE valor_num END,
             valor_texto = CASE WHEN r.forma IN ('texto', 'escolha') THEN v_texto ELSE valor_texto END,
             faixa_min = CASE WHEN r.forma IN ('numero', 'calculado') THEN v_min ELSE faixa_min END,
             faixa_max = CASE WHEN r.forma IN ('numero', 'calculado') THEN v_max ELSE faixa_max END,
             nota = CASE WHEN it ? 'nota' THEN nullif(btrim(coalesce(it ->> 'nota', '')), '') ELSE nota END
       WHERE id = r.id;
      IF it ? 'nota' AND length(coalesce(it ->> 'nota', '')) > 1000 THEN RAISE EXCEPTION '"%": nota grande demais (até 1000 caracteres)', r.nome; END IF;
    END LOOP;
    PERFORM public._clinica_exame_recalcular(e.id);
  END IF;
  RETURN public._clinica_exame_json(e.id);
END $$;
REVOKE ALL ON FUNCTION public.clinica_exame_salvar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_exame_salvar(uuid, jsonb) TO authenticated;

-- ============ fechar e cancelar ============
CREATE OR REPLACE FUNCTION public.clinica_exame_fechar(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_vet uuid := public._clinica_vet();
  e public.pet_exames%ROWTYPE;
BEGIN
  e := public._clinica_exame_meu_aberto(p_id, v_vet);
  IF NOT EXISTS (SELECT 1 FROM public.pet_exame_resultados r
                  WHERE r.exame_id = e.id AND r.forma <> 'calculado' AND (r.valor_num IS NOT NULL OR r.valor_texto IS NOT NULL)) THEN
    RAISE EXCEPTION 'Preencha ao menos um resultado antes de fechar (ou cancele o exame)';
  END IF;
  PERFORM public._clinica_exame_recalcular(e.id);
  UPDATE public.pet_exames SET situacao = 'fechado', fechado_em = now() WHERE id = e.id;
  RETURN public._clinica_exame_json(e.id);
END $$;
REVOKE ALL ON FUNCTION public.clinica_exame_fechar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_exame_fechar(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.clinica_exame_cancelar(p_id uuid, p_motivo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_vet uuid := public._clinica_vet();
  v_motivo text := btrim(coalesce(p_motivo, ''));
  e public.pet_exames%ROWTYPE;
BEGIN
  IF v_motivo = '' THEN RAISE EXCEPTION 'Informe o motivo do cancelamento'; END IF;
  IF length(v_motivo) > 500 THEN RAISE EXCEPTION 'O motivo aceita até 500 caracteres'; END IF;
  e := public._clinica_exame_meu_aberto(p_id, v_vet);
  UPDATE public.pet_exames SET situacao = 'cancelado', cancelado_em = now(), cancelado_motivo = v_motivo WHERE id = e.id;
  RETURN public._clinica_exame_json(e.id);
END $$;
REVOKE ALL ON FUNCTION public.clinica_exame_cancelar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_exame_cancelar(uuid, text) TO authenticated;

-- ============ adendo: correção ou complemento de exame fechado, por qualquer veterinário da clínica (identificado) ============
CREATE OR REPLACE FUNCTION public.clinica_exame_adendo_criar(p_exame_id uuid, p_texto text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_vet uuid := public._clinica_vet();
  v_texto text := btrim(coalesce(p_texto, ''));
  e public.pet_exames%ROWTYPE;
  v_crmv text; v_uf text;
BEGIN
  IF v_texto = '' THEN RAISE EXCEPTION 'Escreva o adendo'; END IF;
  IF length(v_texto) > 4000 THEN RAISE EXCEPTION 'O adendo aceita até 4000 caracteres'; END IF;
  SELECT * INTO e FROM public.pet_exames WHERE id = p_exame_id AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Exame não encontrado'; END IF;
  IF e.situacao <> 'fechado' THEN RAISE EXCEPTION 'Adendo só em exame fechado: edite o exame aberto'; END IF;
  SELECT crmv, crmv_uf INTO v_crmv, v_uf FROM public.pet_profissionais WHERE id = v_vet;
  INSERT INTO public.pet_exame_adendos (tenant_id, exame_id, veterinario_id, crmv, crmv_uf, texto) VALUES (e.tenant_id, e.id, v_vet, v_crmv, v_uf, v_texto);
  RETURN public._clinica_exame_json(e.id);
END $$;
REVOKE ALL ON FUNCTION public.clinica_exame_adendo_criar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_exame_adendo_criar(uuid, text) TO authenticated;

-- ============ consulta ============
CREATE OR REPLACE FUNCTION public.clinica_exame_get(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pet uuid;
  v_atend uuid;
BEGIN
  PERFORM public._clinica_vet();
  SELECT pet_id, atendimento_id INTO v_pet, v_atend FROM public.pet_exames WHERE id = p_id AND tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Exame não encontrado'; END IF;
  INSERT INTO public.clinica_acessos (tenant_id, pet_id, atendimento_id, acao) VALUES (public.current_tenant_id(), v_pet, v_atend, 'exame');
  RETURN public._clinica_exame_json(p_id);
END $$;
REVOKE ALL ON FUNCTION public.clinica_exame_get(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_exame_get(uuid) TO authenticated;

-- Paciente e lista dos exames dele (sem os valores), do mais recente para o mais antigo.
CREATE OR REPLACE FUNCTION public.clinica_exames_do_pet(p_pet_id uuid)
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
  INSERT INTO public.clinica_acessos (tenant_id, pet_id, acao) VALUES (v_tenant, pt.id, 'exame');
  RETURN jsonb_build_object(
    'pet', jsonb_build_object('id', pt.id, 'nome', pt.nome, 'especie', pt.especie, 'raca', pt.raca, 'sexo', pt.sexo, 'nascimento', pt.nascimento),
    'tutor', v_tutor,
    'exames', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', e.id, 'nome', e.nome, 'tipo', e.tipo, 'situacao', e.situacao, 'data_coleta', e.data_coleta, 'laboratorio', e.laboratorio,
               'atendimento_id', e.atendimento_id, 'aberto_em', e.aberto_em, 'veterinario', v.nome,
               'preenchidos', (SELECT count(*) FROM public.pet_exame_resultados r
                                WHERE r.exame_id = e.id AND r.forma <> 'calculado' AND (r.valor_num IS NOT NULL OR r.valor_texto IS NOT NULL)),
               'total', (SELECT count(*) FROM public.pet_exame_resultados r WHERE r.exame_id = e.id AND r.forma <> 'calculado'))
             ORDER BY e.data_coleta DESC, e.aberto_em DESC)
        FROM public.pet_exames e JOIN public.pet_profissionais v ON v.id = e.veterinario_id
       WHERE e.pet_id = pt.id AND e.tenant_id = v_tenant), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.clinica_exames_do_pet(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_exames_do_pet(uuid) TO authenticated;

-- Evolução de um valor ao longo dos exames fechados do paciente (mesmo nome e mesma unidade), do mais antigo para o mais novo.
CREATE OR REPLACE FUNCTION public.clinica_exame_evolucao(p_pet_id uuid, p_nome text, p_unidade text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
BEGIN
  PERFORM public._clinica_vet();
  PERFORM 1 FROM public.pets WHERE id = p_pet_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paciente não encontrado'; END IF;
  IF btrim(coalesce(p_nome, '')) = '' THEN RAISE EXCEPTION 'Informe o campo'; END IF;
  INSERT INTO public.clinica_acessos (tenant_id, pet_id, acao) VALUES (v_tenant, p_pet_id, 'exame');
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('exame_id', e.id, 'exame', e.nome, 'data_coleta', e.data_coleta, 'valor', r.valor_num,
                                         'faixa_min', r.faixa_min, 'faixa_max', r.faixa_max, 'casas', r.casas) ORDER BY e.data_coleta, e.fechado_em)
      FROM public.pet_exames e JOIN public.pet_exame_resultados r ON r.exame_id = e.id
     WHERE e.pet_id = p_pet_id AND e.tenant_id = v_tenant AND e.situacao = 'fechado' AND r.valor_num IS NOT NULL
       AND lower(btrim(r.nome)) = lower(btrim(p_nome)) AND coalesce(btrim(r.unidade), '') = coalesce(btrim(p_unidade), '')), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.clinica_exame_evolucao(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_exame_evolucao(uuid, text, text) TO authenticated;
