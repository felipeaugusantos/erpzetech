CREATE TABLE IF NOT EXISTS public.pet_boxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 40),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pet_boxes_nome_idx ON public.pet_boxes (tenant_id, lower(btrim(nome)));

CREATE TABLE IF NOT EXISTS public.pet_internacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id),
  pet_id uuid NOT NULL REFERENCES public.pets(id),
  cliente_id uuid NOT NULL REFERENCES public.clientes(id),
  box_id uuid NOT NULL REFERENCES public.pet_boxes(id),
  veterinario_id uuid NOT NULL REFERENCES public.pet_profissionais(id),
  crmv text NOT NULL,
  crmv_uf text NOT NULL,
  situacao text NOT NULL DEFAULT 'internado' CHECK (situacao IN ('internado', 'alta', 'obito')),
  admitido_em timestamptz NOT NULL DEFAULT now(),
  motivo text NOT NULL CHECK (length(btrim(motivo)) > 0),
  observacoes text,
  encerrado_em timestamptz,
  encerrado_por uuid REFERENCES public.pet_profissionais(id),
  encerramento_texto text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((situacao = 'internado') = (encerrado_em IS NULL)),
  CHECK ((situacao = 'internado') OR (encerrado_por IS NOT NULL AND length(btrim(coalesce(encerramento_texto, ''))) > 0))
);
CREATE UNIQUE INDEX IF NOT EXISTS pet_internacoes_pet_ativa_idx ON public.pet_internacoes (pet_id) WHERE situacao = 'internado';
CREATE UNIQUE INDEX IF NOT EXISTS pet_internacoes_box_ativa_idx ON public.pet_internacoes (box_id) WHERE situacao = 'internado';
CREATE INDEX IF NOT EXISTS pet_internacoes_pet_idx ON public.pet_internacoes (tenant_id, pet_id, admitido_em DESC);

CREATE TABLE IF NOT EXISTS public.pet_internacao_relatos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id),
  internacao_id uuid NOT NULL REFERENCES public.pet_internacoes(id),
  veterinario_id uuid NOT NULL REFERENCES public.pet_profissionais(id),
  crmv text NOT NULL,
  crmv_uf text NOT NULL,
  texto text NOT NULL CHECK (length(btrim(texto)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pet_internacao_relatos_idx ON public.pet_internacao_relatos (internacao_id, created_at);

CREATE TABLE IF NOT EXISTS public.pet_internacao_ocorrencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id),
  internacao_id uuid NOT NULL REFERENCES public.pet_internacoes(id),
  profissional_id uuid NOT NULL REFERENCES public.pet_profissionais(id),
  tipo text NOT NULL CHECK (tipo IN ('intercorrencia', 'alimentacao', 'higiene', 'medicacao', 'transferencia', 'outro')),
  texto text NOT NULL CHECK (length(btrim(texto)) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pet_internacao_ocorrencias_idx ON public.pet_internacao_ocorrencias (internacao_id, created_at);

ALTER TABLE public.pet_pesagens ADD COLUMN IF NOT EXISTS internacao_id uuid REFERENCES public.pet_internacoes(id);
ALTER TABLE public.pet_pesagens ALTER COLUMN created_at SET DEFAULT clock_timestamp();
ALTER TABLE public.pets ADD COLUMN IF NOT EXISTS obito_em date;
ALTER TABLE public.clinica_acessos DROP CONSTRAINT IF EXISTS clinica_acessos_acao_check;
ALTER TABLE public.clinica_acessos ADD CONSTRAINT clinica_acessos_acao_check CHECK (
  acao IN ('historico', 'atendimento', 'alergias', 'vacinacao', 'exame', 'anexo', 'visita', 'documento', 'internacao'));

CREATE OR REPLACE FUNCTION public._internacao_guarda()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A internação não se apaga'; END IF;
  IF OLD.situacao <> 'internado' THEN RAISE EXCEPTION 'Internação encerrada não pode ser alterada'; END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.pet_id IS DISTINCT FROM OLD.pet_id OR NEW.cliente_id IS DISTINCT FROM OLD.cliente_id
     OR NEW.veterinario_id IS DISTINCT FROM OLD.veterinario_id OR NEW.crmv IS DISTINCT FROM OLD.crmv OR NEW.crmv_uf IS DISTINCT FROM OLD.crmv_uf
     OR NEW.admitido_em IS DISTINCT FROM OLD.admitido_em OR NEW.motivo IS DISTINCT FROM OLD.motivo THEN
    RAISE EXCEPTION 'Estes dados da internação não mudam';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_internacao_guarda ON public.pet_internacoes;
CREATE TRIGGER trg_internacao_guarda BEFORE UPDATE OR DELETE ON public.pet_internacoes
  FOR EACH ROW EXECUTE FUNCTION public._internacao_guarda();

CREATE OR REPLACE FUNCTION public._internacao_registro_guarda()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Relato e ocorrência não se alteram nem se apagam';
END $$;
DROP TRIGGER IF EXISTS trg_internacao_relato_guarda ON public.pet_internacao_relatos;
CREATE TRIGGER trg_internacao_relato_guarda BEFORE UPDATE OR DELETE ON public.pet_internacao_relatos
  FOR EACH ROW EXECUTE FUNCTION public._internacao_registro_guarda();
DROP TRIGGER IF EXISTS trg_internacao_ocorrencia_guarda ON public.pet_internacao_ocorrencias;
CREATE TRIGGER trg_internacao_ocorrencia_guarda BEFORE UPDATE OR DELETE ON public.pet_internacao_ocorrencias
  FOR EACH ROW EXECUTE FUNCTION public._internacao_registro_guarda();

DROP TRIGGER IF EXISTS trg_pet_boxes_updated ON public.pet_boxes;
CREATE TRIGGER trg_pet_boxes_updated BEFORE UPDATE ON public.pet_boxes FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pet_boxes', 'pet_internacoes', 'pet_internacao_relatos', 'pet_internacao_ocorrencias'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS salao_restrito ON public.%I', t);
    EXECUTE format('CREATE POLICY salao_restrito ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()))', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public._internacao_ator(p_so_veterinario boolean)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r public.pet_profissionais%ROWTYPE;
BEGIN
  PERFORM public.exige_papel(ARRAY['veterinario', 'profissional']);
  IF NOT public.clinica_liberada() THEN RAISE EXCEPTION 'A clínica não está liberada para esta empresa'; END IF;
  SELECT * INTO r FROM public.pet_profissionais WHERE profile_id = auth.uid() AND tenant_id = public.current_tenant_id() AND ativo;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sua conta não está ligada a um profissional ativo: peça à gestão'; END IF;
  IF p_so_veterinario THEN
    IF r.funcao <> 'veterinario' OR r.crmv IS NULL THEN RAISE EXCEPTION 'Só o veterinário com CRMV faz esta operação'; END IF;
  ELSIF r.funcao NOT IN ('veterinario', 'auxiliar') THEN
    RAISE EXCEPTION 'Só o veterinário ou o auxiliar fazem esta operação';
  END IF;
  RETURN jsonb_build_object('id', r.id, 'nome', r.nome, 'funcao', r.funcao, 'crmv', r.crmv, 'crmv_uf', r.crmv_uf);
END $$;
REVOKE ALL ON FUNCTION public._internacao_ator(boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._internacao_aberta(p_id uuid)
RETURNS public.pet_internacoes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE i public.pet_internacoes;
BEGIN
  SELECT * INTO i FROM public.pet_internacoes WHERE id = p_id AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Internação não encontrada'; END IF;
  IF i.situacao <> 'internado' THEN RAISE EXCEPTION 'Internação já encerrada'; END IF;
  RETURN i;
END $$;
REVOKE ALL ON FUNCTION public._internacao_aberta(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pet_box_salvar(p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_id uuid := nullif(p_dados ->> 'id', '')::uuid;
  v_nome text := btrim(coalesce(p_dados ->> 'nome', ''));
  v_ativo boolean := coalesce((p_dados ->> 'ativo')::boolean, true);
BEGIN
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'veterinario']);
  IF NOT public.clinica_liberada() THEN RAISE EXCEPTION 'A clínica não está liberada para esta empresa'; END IF;
  IF v_nome = '' OR length(v_nome) > 40 THEN RAISE EXCEPTION 'Informe o nome do box (até 40 letras)'; END IF;
  IF v_id IS NULL THEN
    INSERT INTO public.pet_boxes (tenant_id, nome, ativo) VALUES (v_tenant, v_nome, v_ativo) RETURNING id INTO v_id;
  ELSE
    IF NOT v_ativo AND EXISTS (SELECT 1 FROM public.pet_internacoes WHERE box_id = v_id AND situacao = 'internado') THEN
      RAISE EXCEPTION 'Há um animal internado neste box: transfira-o antes de desativar';
    END IF;
    UPDATE public.pet_boxes SET nome = v_nome, ativo = v_ativo WHERE id = v_id AND tenant_id = v_tenant;
    IF NOT FOUND THEN RAISE EXCEPTION 'Box não encontrado'; END IF;
  END IF;
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Já existe um box com este nome';
END $$;
REVOKE ALL ON FUNCTION public.pet_box_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_box_salvar(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.clinica_boxes()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'veterinario', 'profissional']);
  IF NOT public.clinica_liberada() THEN RAISE EXCEPTION 'A clínica não está liberada para esta empresa'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', b.id, 'nome', b.nome, 'ativo', b.ativo,
             'ocupado', EXISTS (SELECT 1 FROM public.pet_internacoes i WHERE i.box_id = b.id AND i.situacao = 'internado')) ORDER BY b.nome)
      FROM public.pet_boxes b WHERE b.tenant_id = public.current_tenant_id()
  ), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.clinica_boxes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_boxes() TO authenticated;

CREATE OR REPLACE FUNCTION public.clinica_internacao_admitir(p_pet_id uuid, p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  a jsonb := public._internacao_ator(true);
  v_box uuid := nullif(p_dados ->> 'box_id', '')::uuid;
  v_motivo text := btrim(coalesce(p_dados ->> 'motivo', ''));
  v_peso numeric := nullif(p_dados ->> 'peso_kg', '')::numeric;
  pt public.pets%ROWTYPE;
  v_id uuid;
BEGIN
  IF v_motivo = '' THEN RAISE EXCEPTION 'Informe o motivo da internação'; END IF;
  IF v_peso IS NOT NULL AND (v_peso <= 0 OR v_peso > 200) THEN RAISE EXCEPTION 'Informe um peso entre 0,01 e 200 kg'; END IF;
  SELECT * INTO pt FROM public.pets WHERE id = p_pet_id AND tenant_id = v_tenant AND ativo;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paciente não encontrado ou inativo'; END IF;
  IF v_box IS NULL OR NOT EXISTS (SELECT 1 FROM public.pet_boxes WHERE id = v_box AND tenant_id = v_tenant AND ativo) THEN
    RAISE EXCEPTION 'Escolha um box ativo';
  END IF;
  IF EXISTS (SELECT 1 FROM public.pet_internacoes WHERE pet_id = p_pet_id AND situacao = 'internado') THEN
    RAISE EXCEPTION 'Este animal já está internado';
  END IF;
  IF EXISTS (SELECT 1 FROM public.pet_internacoes WHERE box_id = v_box AND situacao = 'internado') THEN
    RAISE EXCEPTION 'Este box já está ocupado';
  END IF;
  INSERT INTO public.pet_internacoes (tenant_id, pet_id, cliente_id, box_id, veterinario_id, crmv, crmv_uf, motivo, observacoes)
  VALUES (v_tenant, pt.id, pt.cliente_id, v_box, (a ->> 'id')::uuid, a ->> 'crmv', a ->> 'crmv_uf', v_motivo, nullif(btrim(p_dados ->> 'observacoes'), ''))
  RETURNING id INTO v_id;
  IF v_peso IS NOT NULL THEN
    INSERT INTO public.pet_pesagens (tenant_id, pet_id, peso_kg, observacao, internacao_id) VALUES (v_tenant, pt.id, v_peso, 'Admissão na internação', v_id);
    PERFORM public._pet_peso_atual(pt.id);
  END IF;
  INSERT INTO public.clinica_acessos (tenant_id, pet_id, acao) VALUES (v_tenant, pt.id, 'internacao');
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Este animal já está internado ou o box já está ocupado';
END $$;
REVOKE ALL ON FUNCTION public.clinica_internacao_admitir(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_internacao_admitir(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.clinica_internacoes(p_situacao text DEFAULT 'internado', p_pet_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  a jsonb := public._internacao_ator(false);
BEGIN
  IF p_situacao NOT IN ('internado', 'alta', 'obito', 'todas') THEN RAISE EXCEPTION 'Situação inválida'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(x ORDER BY (x ->> 'admitido_em') DESC)
      FROM (
        SELECT jsonb_build_object(
                 'id', i.id, 'situacao', i.situacao, 'admitido_em', i.admitido_em, 'encerrado_em', i.encerrado_em,
                 'box', jsonb_build_object('id', b.id, 'nome', b.nome),
                 'pet', jsonb_build_object('id', pt.id, 'nome', pt.nome, 'especie', pt.especie, 'raca', pt.raca, 'alergias', pt.alergias),
                 'tutor', c.nome, 'veterinario', v.nome,
                 'ultimo_peso', (SELECT g.peso_kg FROM public.pet_pesagens g WHERE g.internacao_id = i.id ORDER BY g.created_at DESC LIMIT 1),
                 'ocorrencias', (SELECT count(*) FROM public.pet_internacao_ocorrencias o WHERE o.internacao_id = i.id)) AS x
          FROM public.pet_internacoes i
          JOIN public.pet_boxes b ON b.id = i.box_id
          JOIN public.pets pt ON pt.id = i.pet_id
          JOIN public.clientes c ON c.id = i.cliente_id
          JOIN public.pet_profissionais v ON v.id = i.veterinario_id
         WHERE i.tenant_id = v_tenant AND (p_situacao = 'todas' OR i.situacao = p_situacao) AND (p_pet_id IS NULL OR i.pet_id = p_pet_id)
         ORDER BY i.admitido_em DESC LIMIT 200
      ) q
  ), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.clinica_internacoes(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_internacoes(text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.clinica_internacao_obter(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  a jsonb := public._internacao_ator(false);
  v_vet boolean := (a ->> 'funcao') = 'veterinario';
  i public.pet_internacoes;
  pt public.pets%ROWTYPE;
  v_tutor text; v_fone text; v_box text; v_vet_nome text;
BEGIN
  SELECT * INTO i FROM public.pet_internacoes WHERE id = p_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Internação não encontrada'; END IF;
  SELECT * INTO pt FROM public.pets WHERE id = i.pet_id;
  SELECT nome, coalesce(telefone, whatsapp) INTO v_tutor, v_fone FROM public.clientes WHERE id = i.cliente_id;
  SELECT nome INTO v_box FROM public.pet_boxes WHERE id = i.box_id;
  SELECT nome INTO v_vet_nome FROM public.pet_profissionais WHERE id = i.veterinario_id;
  INSERT INTO public.clinica_acessos (tenant_id, pet_id, acao) VALUES (v_tenant, i.pet_id, 'internacao');
  RETURN jsonb_build_object(
    'internacao', jsonb_build_object('id', i.id, 'situacao', i.situacao, 'admitido_em', i.admitido_em, 'encerrado_em', i.encerrado_em,
                    'box', jsonb_build_object('id', i.box_id, 'nome', v_box),
                    'veterinario', jsonb_build_object('nome', v_vet_nome, 'crmv', i.crmv, 'crmv_uf', i.crmv_uf),
                    'motivo', CASE WHEN v_vet THEN i.motivo END, 'observacoes', CASE WHEN v_vet THEN i.observacoes END,
                    'encerramento_texto', CASE WHEN v_vet THEN i.encerramento_texto END),
    'pet', jsonb_build_object('id', pt.id, 'nome', pt.nome, 'especie', pt.especie, 'raca', pt.raca, 'porte', pt.porte, 'sexo', pt.sexo,
                              'peso_kg', pt.peso_kg, 'nascimento', pt.nascimento, 'castrado', pt.castrado, 'alergias', pt.alergias,
                              'microchip', pt.microchip, 'obito_em', pt.obito_em),
    'tutor', v_tutor, 'tutor_telefone', v_fone,
    'relatos', CASE WHEN v_vet THEN coalesce((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'texto', r.texto, 'created_at', r.created_at,
                  'veterinario', p.nome, 'crmv', r.crmv, 'crmv_uf', r.crmv_uf) ORDER BY r.created_at DESC)
                  FROM public.pet_internacao_relatos r JOIN public.pet_profissionais p ON p.id = r.veterinario_id WHERE r.internacao_id = i.id), '[]'::jsonb) END,
    'ocorrencias', coalesce((SELECT jsonb_agg(jsonb_build_object('id', o.id, 'tipo', o.tipo, 'texto', o.texto, 'created_at', o.created_at,
                  'profissional', p.nome) ORDER BY o.created_at DESC)
                  FROM public.pet_internacao_ocorrencias o JOIN public.pet_profissionais p ON p.id = o.profissional_id WHERE o.internacao_id = i.id), '[]'::jsonb),
    'pesagens', coalesce((SELECT jsonb_agg(jsonb_build_object('id', g.id, 'peso_kg', g.peso_kg, 'created_at', g.created_at, 'observacao', g.observacao)
                  ORDER BY g.created_at DESC) FROM public.pet_pesagens g WHERE g.internacao_id = i.id), '[]'::jsonb),
    'sou_veterinario', v_vet);
END $$;
REVOKE ALL ON FUNCTION public.clinica_internacao_obter(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_internacao_obter(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.clinica_internacao_pesagem(p_id uuid, p_peso_kg numeric)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  a jsonb := public._internacao_ator(false);
  i public.pet_internacoes;
  v_id uuid;
BEGIN
  IF p_peso_kg IS NULL OR p_peso_kg <= 0 OR p_peso_kg > 200 THEN RAISE EXCEPTION 'Informe um peso entre 0,01 e 200 kg'; END IF;
  i := public._internacao_aberta(p_id);
  INSERT INTO public.pet_pesagens (tenant_id, pet_id, peso_kg, observacao, internacao_id)
  VALUES (i.tenant_id, i.pet_id, p_peso_kg, 'Internação (' || (a ->> 'nome') || ')', i.id) RETURNING id INTO v_id;
  PERFORM public._pet_peso_atual(i.pet_id);
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.clinica_internacao_pesagem(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_internacao_pesagem(uuid, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.clinica_internacao_relato(p_id uuid, p_texto text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  a jsonb := public._internacao_ator(true);
  i public.pet_internacoes;
  v_id uuid;
BEGIN
  IF btrim(coalesce(p_texto, '')) = '' THEN RAISE EXCEPTION 'Escreva o relato médico'; END IF;
  i := public._internacao_aberta(p_id);
  INSERT INTO public.pet_internacao_relatos (tenant_id, internacao_id, veterinario_id, crmv, crmv_uf, texto)
  VALUES (i.tenant_id, i.id, (a ->> 'id')::uuid, a ->> 'crmv', a ->> 'crmv_uf', btrim(p_texto)) RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.clinica_internacao_relato(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_internacao_relato(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.clinica_internacao_ocorrencia(p_id uuid, p_tipo text, p_texto text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  a jsonb := public._internacao_ator(false);
  i public.pet_internacoes;
  v_id uuid;
BEGIN
  IF p_tipo NOT IN ('intercorrencia', 'alimentacao', 'higiene', 'medicacao', 'outro') THEN RAISE EXCEPTION 'Tipo de ocorrência inválido'; END IF;
  IF btrim(coalesce(p_texto, '')) = '' OR length(btrim(p_texto)) > 1000 THEN RAISE EXCEPTION 'Descreva a ocorrência (até 1000 letras)'; END IF;
  i := public._internacao_aberta(p_id);
  INSERT INTO public.pet_internacao_ocorrencias (tenant_id, internacao_id, profissional_id, tipo, texto)
  VALUES (i.tenant_id, i.id, (a ->> 'id')::uuid, p_tipo, btrim(p_texto)) RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.clinica_internacao_ocorrencia(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_internacao_ocorrencia(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.clinica_internacao_box_trocar(p_id uuid, p_box_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  a jsonb := public._internacao_ator(true);
  i public.pet_internacoes;
  v_de text; v_para text;
BEGIN
  i := public._internacao_aberta(p_id);
  SELECT nome INTO v_para FROM public.pet_boxes WHERE id = p_box_id AND tenant_id = i.tenant_id AND ativo;
  IF NOT FOUND THEN RAISE EXCEPTION 'Escolha um box ativo'; END IF;
  IF p_box_id = i.box_id THEN RAISE EXCEPTION 'O animal já está neste box'; END IF;
  IF EXISTS (SELECT 1 FROM public.pet_internacoes WHERE box_id = p_box_id AND situacao = 'internado') THEN RAISE EXCEPTION 'Este box já está ocupado'; END IF;
  SELECT nome INTO v_de FROM public.pet_boxes WHERE id = i.box_id;
  UPDATE public.pet_internacoes SET box_id = p_box_id WHERE id = i.id;
  INSERT INTO public.pet_internacao_ocorrencias (tenant_id, internacao_id, profissional_id, tipo, texto)
  VALUES (i.tenant_id, i.id, (a ->> 'id')::uuid, 'transferencia', 'Transferido do box ' || v_de || ' para o box ' || v_para);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Este box já está ocupado';
END $$;
REVOKE ALL ON FUNCTION public.clinica_internacao_box_trocar(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_internacao_box_trocar(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.clinica_internacao_encerrar(p_id uuid, p_tipo text, p_texto text, p_quando timestamptz DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  a jsonb := public._internacao_ator(true);
  i public.pet_internacoes;
  v_quando timestamptz := coalesce(p_quando, now());
BEGIN
  IF p_tipo NOT IN ('alta', 'obito') THEN RAISE EXCEPTION 'Informe alta ou óbito'; END IF;
  IF btrim(coalesce(p_texto, '')) = '' THEN
    RAISE EXCEPTION '%', CASE WHEN p_tipo = 'alta' THEN 'Escreva o resumo da alta e as orientações' ELSE 'Escreva a causa e as circunstâncias do óbito' END;
  END IF;
  i := public._internacao_aberta(p_id);
  IF v_quando < i.admitido_em THEN RAISE EXCEPTION 'A data não pode ser anterior à admissão'; END IF;
  IF v_quando > now() + interval '5 minutes' THEN RAISE EXCEPTION 'A data não pode ser futura'; END IF;
  UPDATE public.pet_internacoes SET situacao = p_tipo, encerrado_em = v_quando, encerrado_por = (a ->> 'id')::uuid, encerramento_texto = btrim(p_texto)
   WHERE id = i.id;
  IF p_tipo = 'obito' THEN
    UPDATE public.pets SET ativo = false, obito_em = (v_quando AT TIME ZONE 'America/Sao_Paulo')::date WHERE id = i.pet_id AND tenant_id = i.tenant_id;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.clinica_internacao_encerrar(uuid, text, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_internacao_encerrar(uuid, text, text, timestamptz) TO authenticated;