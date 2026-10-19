-- Clínica (Fase 4, PR 2): modelos de exame. A clínica monta (ou começa dos modelos iniciais) o hemograma, a bioquímica, a urina e outros exames:
-- cada modelo tem campos com grupo, unidade, forma de valor (número, texto, escolha ou calculado) e faixa de referência por espécie.
-- A gestão e o veterinário mantêm os modelos; o resultado (PR 3) é só do veterinário. Campo nunca se apaga: sai de uso ficando inativo, para
-- exame já feito continuar legível. O sistema não traz faixa de referência pronta: a faixa é do veterinário responsável e do laboratório da clínica.
-- Nenhuma tabela tem acesso direto: tudo passa por funções que exigem a clínica liberada (clinica_liberada).

-- ============ tabelas ============
CREATE TABLE IF NOT EXISTS public.pet_exame_modelos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (length(btrim(nome)) > 0),
  tipo text NOT NULL CHECK (tipo IN ('hemograma', 'bioquimica', 'urina', 'outro')),
  material text,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pet_exame_modelos_nome_idx ON public.pet_exame_modelos (tenant_id, lower(btrim(nome)));

CREATE TABLE IF NOT EXISTS public.pet_exame_campos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  modelo_id uuid NOT NULL REFERENCES public.pet_exame_modelos(id),
  ordem integer NOT NULL CHECK (ordem >= 0),
  grupo text,
  nome text NOT NULL CHECK (length(btrim(nome)) > 0),
  unidade text,
  forma text NOT NULL CHECK (forma IN ('numero', 'texto', 'escolha', 'calculado')),
  casas integer CHECK (casas BETWEEN 0 AND 6),
  opcoes jsonb,
  observacao text,
  -- só campo calculado: valor = total × percentual ÷ 100 (o absoluto de cada célula do leucograma)
  total_campo_id uuid REFERENCES public.pet_exame_campos(id),
  pct_campo_id uuid REFERENCES public.pet_exame_campos(id),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (forma NOT IN ('numero', 'calculado') OR casas IS NOT NULL),
  CHECK (forma <> 'escolha' OR (opcoes IS NOT NULL AND jsonb_typeof(opcoes) = 'array' AND jsonb_array_length(opcoes) > 0)),
  CHECK (forma = 'escolha' OR opcoes IS NULL),
  CHECK ((forma = 'calculado') = (total_campo_id IS NOT NULL AND pct_campo_id IS NOT NULL)),
  CHECK (forma = 'calculado' OR (total_campo_id IS NULL AND pct_campo_id IS NULL))
);
CREATE INDEX IF NOT EXISTS pet_exame_campos_modelo_idx ON public.pet_exame_campos (modelo_id, ordem);
CREATE UNIQUE INDEX IF NOT EXISTS pet_exame_campos_nome_idx
  ON public.pet_exame_campos (modelo_id, lower(btrim(coalesce(grupo, ''))), lower(btrim(nome)));

CREATE TABLE IF NOT EXISTS public.pet_exame_referencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  campo_id uuid NOT NULL REFERENCES public.pet_exame_campos(id),
  especie text NOT NULL CHECK (especie IN ('cao', 'gato', 'outro')),
  minimo numeric,
  maximo numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (minimo IS NOT NULL OR maximo IS NOT NULL),
  CHECK (minimo IS NULL OR maximo IS NULL OR minimo <= maximo),
  UNIQUE (campo_id, especie)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pet_exame_modelos', 'pet_exame_campos', 'pet_exame_referencias'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('CREATE POLICY salao_restrito ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()))', t);
    EXECUTE format('CREATE TRIGGER trg_%s_updated BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()', t, t);
  END LOOP;
END $$;

-- ============ apoio ============
-- Quem mantém e consulta os modelos: gestão e veterinário, com a clínica liberada.
CREATE OR REPLACE FUNCTION public._clinica_exige_modelos()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'veterinario']);
  IF NOT public.clinica_liberada() THEN RAISE EXCEPTION 'A clínica não está liberada para esta empresa'; END IF;
END $$;
REVOKE ALL ON FUNCTION public._clinica_exige_modelos() FROM PUBLIC, anon, authenticated;

-- ============ consulta ============
CREATE OR REPLACE FUNCTION public.clinica_exame_modelos()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public._clinica_exige_modelos();
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'id', m.id, 'nome', m.nome, 'tipo', m.tipo, 'material', m.material, 'ativo', m.ativo,
             'campos', coalesce((
               SELECT jsonb_agg(jsonb_build_object(
                        'id', c.id, 'ordem', c.ordem, 'grupo', c.grupo, 'nome', c.nome, 'unidade', c.unidade, 'forma', c.forma,
                        'casas', c.casas, 'opcoes', c.opcoes, 'observacao', c.observacao, 'ativo', c.ativo,
                        'total_campo_id', c.total_campo_id, 'pct_campo_id', c.pct_campo_id,
                        'referencias', coalesce((
                          SELECT jsonb_agg(jsonb_build_object('especie', r.especie, 'minimo', r.minimo, 'maximo', r.maximo) ORDER BY r.especie)
                            FROM public.pet_exame_referencias r WHERE r.campo_id = c.id), '[]'::jsonb)
                      ) ORDER BY c.ordem, c.id)
                 FROM public.pet_exame_campos c WHERE c.modelo_id = m.id), '[]'::jsonb)
           ) ORDER BY m.nome)
      FROM public.pet_exame_modelos m
     WHERE m.tenant_id = public.current_tenant_id()
  ), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.clinica_exame_modelos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_exame_modelos() TO authenticated;

-- ============ modelo ============
CREATE OR REPLACE FUNCTION public.clinica_exame_modelo_salvar(p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_id uuid := nullif(p_dados ->> 'id', '')::uuid;
  v_nome text := btrim(coalesce(p_dados ->> 'nome', ''));
  v_tipo text := coalesce(nullif(p_dados ->> 'tipo', ''), 'outro');
  v_material text := nullif(btrim(coalesce(p_dados ->> 'material', '')), '');
  v_ativo boolean := coalesce((p_dados ->> 'ativo')::boolean, true);
BEGIN
  PERFORM public._clinica_exige_modelos();
  IF v_nome = '' THEN RAISE EXCEPTION 'Informe o nome do modelo'; END IF;
  IF length(v_nome) > 80 THEN RAISE EXCEPTION 'O nome do modelo passa de 80 letras'; END IF;
  IF v_tipo NOT IN ('hemograma', 'bioquimica', 'urina', 'outro') THEN RAISE EXCEPTION 'Tipo de exame inválido'; END IF;
  IF length(coalesce(v_material, '')) > 80 THEN RAISE EXCEPTION 'O material passa de 80 letras'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('clinica_exame_modelo:' || v_tenant::text, 0));
  IF EXISTS (SELECT 1 FROM public.pet_exame_modelos m WHERE m.tenant_id = v_tenant AND lower(btrim(m.nome)) = lower(v_nome) AND m.id IS DISTINCT FROM v_id) THEN
    RAISE EXCEPTION 'Já existe um modelo com este nome';
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO public.pet_exame_modelos (tenant_id, nome, tipo, material, ativo) VALUES (v_tenant, v_nome, v_tipo, v_material, v_ativo) RETURNING id INTO v_id;
  ELSE
    UPDATE public.pet_exame_modelos SET nome = v_nome, tipo = v_tipo, material = v_material, ativo = v_ativo WHERE id = v_id AND tenant_id = v_tenant;
    IF NOT FOUND THEN RAISE EXCEPTION 'Modelo de exame não encontrado'; END IF;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.clinica_exame_modelo_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_exame_modelo_salvar(jsonb) TO authenticated;

-- ============ campo ============
CREATE OR REPLACE FUNCTION public.clinica_exame_campo_salvar(p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_id uuid := nullif(p_dados ->> 'id', '')::uuid;
  v_modelo uuid := nullif(p_dados ->> 'modelo_id', '')::uuid;
  v_nome text := btrim(coalesce(p_dados ->> 'nome', ''));
  v_grupo text := nullif(btrim(coalesce(p_dados ->> 'grupo', '')), '');
  v_unidade text := nullif(btrim(coalesce(p_dados ->> 'unidade', '')), '');
  v_obs text := nullif(btrim(coalesce(p_dados ->> 'observacao', '')), '');
  v_forma text := coalesce(nullif(p_dados ->> 'forma', ''), 'numero');
  v_casas integer;
  v_opcoes jsonb := p_dados -> 'opcoes';
  v_total uuid := nullif(p_dados ->> 'total_campo_id', '')::uuid;
  v_pct uuid := nullif(p_dados ->> 'pct_campo_id', '')::uuid;
  v_ativo boolean := coalesce((p_dados ->> 'ativo')::boolean, true);
  v_ordem integer;
  v_antes record;
BEGIN
  PERFORM public._clinica_exige_modelos();
  BEGIN
    v_casas := nullif(p_dados ->> 'casas', '')::integer;
    v_ordem := nullif(p_dados ->> 'ordem', '')::integer;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Confira os números do campo';
  END;
  IF v_nome = '' THEN RAISE EXCEPTION 'Informe o nome do campo'; END IF;
  IF length(v_nome) > 80 OR length(coalesce(v_grupo, '')) > 80 OR length(coalesce(v_unidade, '')) > 30 OR length(coalesce(v_obs, '')) > 300 THEN
    RAISE EXCEPTION 'Nome, grupo, unidade ou observação grande demais';
  END IF;
  IF v_forma NOT IN ('numero', 'texto', 'escolha', 'calculado') THEN RAISE EXCEPTION 'Forma de valor inválida'; END IF;
  IF v_ordem IS NOT NULL AND v_ordem < 0 THEN RAISE EXCEPTION 'Ordem inválida'; END IF;

  IF v_id IS NOT NULL THEN
    SELECT * INTO v_antes FROM public.pet_exame_campos WHERE id = v_id AND tenant_id = v_tenant FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Campo não encontrado'; END IF;
    v_modelo := v_antes.modelo_id;
  END IF;
  PERFORM 1 FROM public.pet_exame_modelos WHERE id = v_modelo AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Modelo de exame não encontrado'; END IF;

  IF v_forma IN ('numero', 'calculado') THEN
    IF v_casas IS NULL THEN v_casas := 2; END IF;
    IF v_casas < 0 OR v_casas > 6 THEN RAISE EXCEPTION 'Casas decimais de 0 a 6'; END IF;
  ELSE
    v_casas := NULL;
  END IF;

  IF v_forma = 'escolha' THEN
    IF v_opcoes IS NULL OR jsonb_typeof(v_opcoes) <> 'array' OR jsonb_array_length(v_opcoes) = 0 OR jsonb_array_length(v_opcoes) > 30 THEN
      RAISE EXCEPTION 'Informe de 1 a 30 opções para o campo de escolha';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_opcoes) o WHERE jsonb_typeof(o) <> 'string' OR btrim(o #>> '{}') = '' OR length(o #>> '{}') > 60) THEN
      RAISE EXCEPTION 'Cada opção precisa ter texto, de até 60 letras';
    END IF;
    v_opcoes := (SELECT jsonb_agg(DISTINCT btrim(o #>> '{}')) FROM jsonb_array_elements(v_opcoes) o);
  ELSE
    v_opcoes := NULL;
  END IF;

  IF v_forma = 'calculado' THEN
    IF v_total IS NULL OR v_pct IS NULL OR v_total = v_pct OR v_total IS NOT DISTINCT FROM v_id OR v_pct IS NOT DISTINCT FROM v_id THEN
      RAISE EXCEPTION 'Escolha o campo do total e o campo do percentual (dois campos diferentes)';
    END IF;
    IF (SELECT count(*) FROM public.pet_exame_campos x
         WHERE x.id IN (v_total, v_pct) AND x.modelo_id = v_modelo AND x.tenant_id = v_tenant AND x.forma = 'numero' AND x.ativo) <> 2 THEN
      RAISE EXCEPTION 'O total e o percentual precisam ser campos numéricos ativos deste modelo';
    END IF;
  ELSE
    v_total := NULL; v_pct := NULL;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('clinica_exame_campo:' || v_modelo::text, 0));
  IF EXISTS (SELECT 1 FROM public.pet_exame_campos c WHERE c.modelo_id = v_modelo AND lower(btrim(coalesce(c.grupo, ''))) = lower(coalesce(v_grupo, ''))
                AND lower(btrim(c.nome)) = lower(v_nome) AND c.id IS DISTINCT FROM v_id) THEN
    RAISE EXCEPTION 'Já existe um campo com este nome neste grupo do modelo';
  END IF;

  IF v_id IS NULL THEN
    IF v_ordem IS NULL THEN v_ordem := coalesce((SELECT max(ordem) + 1 FROM public.pet_exame_campos WHERE modelo_id = v_modelo), 0); END IF;
    INSERT INTO public.pet_exame_campos (tenant_id, modelo_id, ordem, grupo, nome, unidade, forma, casas, opcoes, observacao, total_campo_id, pct_campo_id, ativo)
    VALUES (v_tenant, v_modelo, v_ordem, v_grupo, v_nome, v_unidade, v_forma, v_casas, v_opcoes, v_obs, v_total, v_pct, v_ativo) RETURNING id INTO v_id;
  ELSE
    -- um campo que alimenta um cálculo ativo não muda de forma nem sai de uso
    IF EXISTS (SELECT 1 FROM public.pet_exame_campos d WHERE d.ativo AND d.forma = 'calculado' AND v_id IN (d.total_campo_id, d.pct_campo_id))
       AND (v_forma <> 'numero' OR NOT v_ativo) THEN
      RAISE EXCEPTION 'Este campo alimenta um campo calculado ativo: ele precisa continuar numérico e ativo';
    END IF;
    -- campo que já tem faixa de referência só aceita faixa se continuar numérico
    IF v_forma NOT IN ('numero', 'calculado') AND EXISTS (SELECT 1 FROM public.pet_exame_referencias r WHERE r.campo_id = v_id) THEN
      RAISE EXCEPTION 'Remova as faixas de referência antes de trocar para texto ou escolha';
    END IF;
    UPDATE public.pet_exame_campos SET ordem = coalesce(v_ordem, ordem), grupo = v_grupo, nome = v_nome, unidade = v_unidade, forma = v_forma,
           casas = v_casas, opcoes = v_opcoes, observacao = v_obs, total_campo_id = v_total, pct_campo_id = v_pct, ativo = v_ativo
     WHERE id = v_id AND tenant_id = v_tenant;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.clinica_exame_campo_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_exame_campo_salvar(jsonb) TO authenticated;

-- Sobe ou desce o campo uma posição, trocando a ordem com o vizinho do mesmo modelo.
CREATE OR REPLACE FUNCTION public.clinica_exame_campo_mover(p_campo_id uuid, p_delta integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_modelo uuid;
  v_ordem integer;
  v_viz record;
BEGIN
  PERFORM public._clinica_exige_modelos();
  IF p_delta IS NULL OR p_delta NOT IN (-1, 1) THEN RAISE EXCEPTION 'Movimento inválido'; END IF;
  SELECT modelo_id, ordem INTO v_modelo, v_ordem FROM public.pet_exame_campos WHERE id = p_campo_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Campo não encontrado'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('clinica_exame_campo:' || v_modelo::text, 0));
  -- renumera o modelo inteiro de 0 em diante (a ordem pode ter buracos ou repetições) e troca com o vizinho
  WITH n AS (
    SELECT id, (row_number() OVER (ORDER BY ordem, id) - 1)::int AS pos FROM public.pet_exame_campos WHERE modelo_id = v_modelo
  )
  UPDATE public.pet_exame_campos c SET ordem = n.pos FROM n WHERE c.id = n.id AND c.ordem <> n.pos;
  SELECT ordem INTO v_ordem FROM public.pet_exame_campos WHERE id = p_campo_id;
  SELECT id, ordem INTO v_viz FROM public.pet_exame_campos WHERE modelo_id = v_modelo AND ordem = v_ordem + p_delta;
  IF v_viz.id IS NULL THEN RETURN; END IF;
  UPDATE public.pet_exame_campos SET ordem = v_viz.ordem WHERE id = p_campo_id;
  UPDATE public.pet_exame_campos SET ordem = v_ordem WHERE id = v_viz.id;
END $$;
REVOKE ALL ON FUNCTION public.clinica_exame_campo_mover(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_exame_campo_mover(uuid, integer) TO authenticated;

-- ============ faixa de referência ============
-- Mínimo e máximo ficam em branco juntos para tirar a faixa. A faixa é do veterinário responsável: o sistema não traz valor pronto.
CREATE OR REPLACE FUNCTION public.clinica_exame_referencia_salvar(p_campo_id uuid, p_especie text, p_minimo numeric, p_maximo numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_forma text;
BEGIN
  PERFORM public._clinica_exige_modelos();
  IF p_especie IS NULL OR p_especie NOT IN ('cao', 'gato', 'outro') THEN RAISE EXCEPTION 'Espécie inválida'; END IF;
  SELECT forma INTO v_forma FROM public.pet_exame_campos WHERE id = p_campo_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Campo não encontrado'; END IF;
  IF v_forma NOT IN ('numero', 'calculado') THEN RAISE EXCEPTION 'Só campo numérico ou calculado tem faixa de referência'; END IF;
  IF p_minimo IS NULL AND p_maximo IS NULL THEN
    DELETE FROM public.pet_exame_referencias WHERE campo_id = p_campo_id AND especie = p_especie AND tenant_id = v_tenant;
    RETURN;
  END IF;
  IF p_minimo IS NOT NULL AND p_maximo IS NOT NULL AND p_minimo > p_maximo THEN RAISE EXCEPTION 'O mínimo não pode passar do máximo'; END IF;
  INSERT INTO public.pet_exame_referencias (tenant_id, campo_id, especie, minimo, maximo)
  VALUES (v_tenant, p_campo_id, p_especie, p_minimo, p_maximo)
  ON CONFLICT (campo_id, especie) DO UPDATE SET minimo = EXCLUDED.minimo, maximo = EXCLUDED.maximo;
END $$;
REVOKE ALL ON FUNCTION public.clinica_exame_referencia_salvar(uuid, text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_exame_referencia_salvar(uuid, text, numeric, numeric) TO authenticated;

-- ============ modelos iniciais ============
-- Cria um modelo (e seus campos, na ordem) se a empresa ainda não tem um com o mesmo nome. Cada campo: [grupo, nome, unidade, forma, casas, extra],
-- onde extra é a lista de opções (escolha) ou {"total": nome, "pct": nome} (calculado, apontando para campos já criados acima).
CREATE OR REPLACE FUNCTION public._clinica_exame_semear(p_tenant uuid, p_nome text, p_tipo text, p_material text, p_campos jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_modelo uuid;
  c record;
  v_total uuid;
  v_pct uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.pet_exame_modelos m WHERE m.tenant_id = p_tenant AND lower(btrim(m.nome)) = lower(btrim(p_nome))) THEN RETURN false; END IF;
  INSERT INTO public.pet_exame_modelos (tenant_id, nome, tipo, material) VALUES (p_tenant, p_nome, p_tipo, p_material) RETURNING id INTO v_modelo;
  FOR c IN SELECT e AS campo, (n - 1)::int AS pos FROM jsonb_array_elements(p_campos) WITH ORDINALITY AS t(e, n) LOOP
    v_total := NULL; v_pct := NULL;
    IF c.campo ->> 3 = 'calculado' THEN
      SELECT id INTO v_total FROM public.pet_exame_campos WHERE modelo_id = v_modelo AND nome = c.campo -> 5 ->> 'total';
      SELECT id INTO v_pct FROM public.pet_exame_campos WHERE modelo_id = v_modelo AND nome = c.campo -> 5 ->> 'pct';
    END IF;
    INSERT INTO public.pet_exame_campos (tenant_id, modelo_id, ordem, grupo, nome, unidade, forma, casas, opcoes, total_campo_id, pct_campo_id)
    VALUES (p_tenant, v_modelo, c.pos, nullif(c.campo ->> 0, ''), c.campo ->> 1, nullif(c.campo ->> 2, ''), c.campo ->> 3,
            CASE WHEN jsonb_typeof(c.campo -> 4) = 'number' THEN (c.campo ->> 4)::int END,
            CASE WHEN c.campo ->> 3 = 'escolha' THEN c.campo -> 5 END, v_total, v_pct);
  END LOOP;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public._clinica_exame_semear(uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.clinica_exame_modelos_iniciais()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_criados integer := 0;
  v_diferencial jsonb := jsonb_build_array('Metamielócitos', 'Bastonetes', 'Segmentados', 'Eosinófilos', 'Basófilos', 'Linfócitos', 'Monócitos');
  v_hemo jsonb;
  v_bioq jsonb;
  v_urina jsonb;
  v_neg5 jsonb := jsonb_build_array('Negativo', 'Traços', '+', '++', '+++');
  d text;
BEGIN
  PERFORM public._clinica_exige_modelos();
  PERFORM pg_advisory_xact_lock(hashtextextended('clinica_exame_modelo:' || v_tenant::text, 0));

  v_hemo := '[
    ["Eritrograma","Hemácias","milhões/mm³","numero",2],
    ["Eritrograma","Hemoglobina","g/dL","numero",1],
    ["Eritrograma","Hematócrito","%","numero",1],
    ["Eritrograma","VCM","fl","numero",1],
    ["Eritrograma","HCM","pg","numero",1],
    ["Eritrograma","CHCM","%","numero",1],
    ["Eritrograma","RDW","%","numero",1],
    ["Proteínas","Proteínas totais","g/dL","numero",1],
    ["Leucograma","Leucócitos totais","células/mm³","numero",0]
  ]'::jsonb;
  FOR d IN SELECT jsonb_array_elements_text(v_diferencial) LOOP
    v_hemo := v_hemo || jsonb_build_array(jsonb_build_array('Leucograma — relativo', d || ' (%)', '%', 'numero', 0));
  END LOOP;
  FOR d IN SELECT jsonb_array_elements_text(v_diferencial) LOOP
    v_hemo := v_hemo || jsonb_build_array(jsonb_build_array('Leucograma — absoluto', d || ' (abs.)', 'células/mm³', 'calculado', 0,
                jsonb_build_object('total', 'Leucócitos totais', 'pct', d || ' (%)')));
  END LOOP;
  v_hemo := v_hemo || '[
    ["Plaquetograma","Plaquetas","mil/mm³","numero",0],
    ["Plaquetograma","Observação do plaquetograma","","texto"],
    ["","Observações","","texto"]
  ]'::jsonb;

  v_bioq := '[
    ["Bioquímica","Albumina","g/dL","numero",1],
    ["Bioquímica","Proteínas totais","g/dL","numero",1],
    ["Bioquímica","Globulinas","g/dL","numero",1],
    ["Bioquímica","Fibrinogênio","mg/dL","numero",0],
    ["Bioquímica","Bilirrubina total","mg/dL","numero",2],
    ["Bioquímica","Bilirrubina direta","mg/dL","numero",2],
    ["Bioquímica","AST (TGO)","U/L","numero",0],
    ["Bioquímica","ALT (TGP)","U/L","numero",0],
    ["Bioquímica","Fosfatase alcalina","U/L","numero",0],
    ["Bioquímica","Ureia","mg/dL","numero",0],
    ["Bioquímica","Creatinina","mg/dL","numero",2],
    ["Bioquímica","Glicose","mg/dL","numero",0],
    ["Bioquímica","Colesterol","mg/dL","numero",0],
    ["Bioquímica","Amilase","U/L","numero",0],
    ["Bioquímica","Lipase","U/L","numero",0],
    ["Bioquímica","Cálcio","mg/dL","numero",1],
    ["Bioquímica","Fósforo","mg/dL","numero",1],
    ["Bioquímica","Sódio","mEq/L","numero",0],
    ["Bioquímica","Potássio","mEq/L","numero",1],
    ["Bioquímica","Ácido úrico","mg/dL","numero",1],
    ["Bioquímica","Creatinoquinase (CK)","U/L","numero",0],
    ["","Observações","","texto"]
  ]'::jsonb;

  v_urina := jsonb_build_array(
    jsonb_build_array('Físico', 'Volume', 'ml', 'numero', 0),
    jsonb_build_array('Físico', 'Colheita', '', 'texto'),
    jsonb_build_array('Físico', 'Aspecto', '', 'escolha', NULL, jsonb_build_array('Límpido', 'Ligeiramente turvo', 'Turvo')),
    jsonb_build_array('Físico', 'Cor', '', 'texto'),
    jsonb_build_array('Físico', 'Odor', '', 'texto'),
    jsonb_build_array('Físico', 'Densidade', '', 'numero', 3),
    jsonb_build_array('Físico', 'pH', '', 'numero', 1),
    jsonb_build_array('Químico', 'Proteínas', 'mg%', 'numero', 0),
    jsonb_build_array('Químico', 'Glicose', 'mg%', 'numero', 0),
    jsonb_build_array('Químico', 'Corpos cetônicos', '', 'escolha', NULL, v_neg5),
    jsonb_build_array('Químico', 'Bilirrubina', '', 'escolha', NULL, v_neg5),
    jsonb_build_array('Químico', 'Urobilinogênio', '', 'escolha', NULL, jsonb_build_array('Normal', 'Aumentado')),
    jsonb_build_array('Químico', 'Sangue oculto', '', 'escolha', NULL, jsonb_build_array('Negativo', '+', '++', '+++')),
    jsonb_build_array('Químico', 'Nitritos', '', 'escolha', NULL, jsonb_build_array('Negativo', 'Positivo')),
    jsonb_build_array('Sedimentoscopia', 'Hemácias', '', 'texto'),
    jsonb_build_array('Sedimentoscopia', 'Leucócitos', '', 'texto'),
    jsonb_build_array('Sedimentoscopia', 'Cilindros', '', 'texto'),
    jsonb_build_array('Sedimentoscopia', 'Células descamativas', '', 'texto'),
    jsonb_build_array('Sedimentoscopia', 'Cristais', '', 'texto'),
    jsonb_build_array('Sedimentoscopia', 'Outros', '', 'texto'),
    jsonb_build_array('', 'Observações', '', 'texto')
  );

  IF public._clinica_exame_semear(v_tenant, 'Hemograma', 'hemograma', 'Sangue total em EDTA', v_hemo) THEN v_criados := v_criados + 1; END IF;
  IF public._clinica_exame_semear(v_tenant, 'Bioquímica sanguínea', 'bioquimica', 'Soro sanguíneo', v_bioq) THEN v_criados := v_criados + 1; END IF;
  IF public._clinica_exame_semear(v_tenant, 'Urina', 'urina', 'Urina', v_urina) THEN v_criados := v_criados + 1; END IF;
  RETURN v_criados;
END $$;
REVOKE ALL ON FUNCTION public.clinica_exame_modelos_iniciais() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_exame_modelos_iniciais() TO authenticated;
