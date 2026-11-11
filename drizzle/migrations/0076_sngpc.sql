ALTER TABLE public.pet_profissionais ADD COLUMN IF NOT EXISTS cpf text;
ALTER TABLE public.pet_profissionais DROP CONSTRAINT IF EXISTS pet_profissionais_cpf_chk;
ALTER TABLE public.pet_profissionais ADD CONSTRAINT pet_profissionais_cpf_chk CHECK (cpf IS NULL OR cpf ~ '^[0-9]{11}$');

CREATE OR REPLACE FUNCTION public._cpf_valido(p_cpf text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  c text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  s integer; d1 integer; d2 integer; i integer;
BEGIN
  IF length(c) <> 11 OR c ~ '^(.)\1{10}$' THEN RETURN false; END IF;
  s := 0; FOR i IN 1..9 LOOP s := s + substr(c, i, 1)::integer * (11 - i); END LOOP;
  d1 := 11 - (s % 11); IF d1 >= 10 THEN d1 := 0; END IF;
  s := 0; FOR i IN 1..10 LOOP s := s + substr(c, i, 1)::integer * (12 - i); END LOOP;
  d2 := 11 - (s % 11); IF d2 >= 10 THEN d2 := 0; END IF;
  RETURN d1 = substr(c, 10, 1)::integer AND d2 = substr(c, 11, 1)::integer;
END $$;
REVOKE ALL ON FUNCTION public._cpf_valido(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pet_profissional_salvar(p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_id uuid := nullif(p_dados ->> 'id', '')::uuid;
  v_nome text := btrim(coalesce(p_dados ->> 'nome', ''));
  v_funcao text := coalesce(nullif(p_dados ->> 'funcao', ''), 'tosador');
  v_com numeric := coalesce(nullif(p_dados ->> 'comissao_percentual', '')::numeric, 0);
  v_filial uuid := nullif(p_dados ->> 'filial_id', '')::uuid;
  v_crmv text := upper(regexp_replace(coalesce(p_dados ->> 'crmv', ''), '[^0-9A-Za-z]', '', 'g'));
  v_uf text := upper(btrim(coalesce(p_dados ->> 'crmv_uf', '')));
  v_crf text := upper(regexp_replace(coalesce(p_dados ->> 'crf', ''), '[^0-9A-Za-z]', '', 'g'));
  v_crf_uf text := upper(btrim(coalesce(p_dados ->> 'crf_uf', '')));
  v_ufs constant text := '^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$';
  v_cpf text := regexp_replace(coalesce(p_dados ->> 'cpf', ''), '\D', '', 'g');
  v_profile uuid;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  IF v_nome = '' THEN RAISE EXCEPTION 'Informe o nome do profissional'; END IF;
  IF v_funcao NOT IN ('banhista', 'tosador', 'groomer', 'veterinario', 'farmaceutico', 'auxiliar', 'outro') THEN RAISE EXCEPTION 'Função inválida'; END IF;
  IF v_com < 0 OR v_com > 100 THEN RAISE EXCEPTION 'A comissão precisa ficar entre 0 e 100%%'; END IF;
  IF v_filial IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.filiais f WHERE f.id = v_filial AND f.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Loja não encontrada';
  END IF;
  IF v_funcao = 'veterinario' THEN
    IF NOT public.clinica_liberada() THEN RAISE EXCEPTION 'A clínica não está liberada para esta empresa: informe o CNAE 7500 ou o ramo Clínica veterinária no cadastro da empresa'; END IF;
    IF v_crmv !~ '^[0-9A-Z]{3,12}$' THEN RAISE EXCEPTION 'Informe o CRMV do veterinário'; END IF;
    IF v_uf !~ v_ufs THEN RAISE EXCEPTION 'Informe a UF do CRMV'; END IF;
  ELSE
    v_crmv := NULL; v_uf := NULL;
  END IF;
  IF v_funcao = 'farmaceutico' THEN
    IF v_crf !~ '^[0-9A-Z]{3,12}$' THEN RAISE EXCEPTION 'Informe o CRF do farmacêutico'; END IF;
    IF v_crf_uf !~ v_ufs THEN RAISE EXCEPTION 'Informe a UF do CRF'; END IF;
    IF NOT public._cpf_valido(v_cpf) THEN RAISE EXCEPTION 'Informe o CPF do farmacêutico (11 números, válido)'; END IF;
  ELSE
    v_crf := NULL; v_crf_uf := NULL; v_cpf := NULL;
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO public.pet_profissionais (tenant_id, filial_id, nome, funcao, comissao_percentual, ativo, crmv, crmv_uf, crf, crf_uf, cpf)
    VALUES (v_tenant, v_filial, v_nome, v_funcao, v_com, coalesce((p_dados ->> 'ativo')::boolean, true), v_crmv, v_uf, v_crf, v_crf_uf, v_cpf)
    RETURNING id INTO v_id;
  ELSE
    SELECT profile_id INTO v_profile FROM public.pet_profissionais WHERE id = v_id AND tenant_id = v_tenant FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Profissional não encontrado'; END IF;
    IF v_profile IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.user_roles r WHERE r.user_id = v_profile AND r.tenant_id = v_tenant
            AND r.role = (CASE WHEN v_funcao = 'veterinario' THEN 'veterinario' ELSE 'profissional' END)::public.app_role) THEN
      RAISE EXCEPTION 'A conta ligada não tem o perfil desta função: desfaça o vínculo da conta antes de mudar a função';
    END IF;
    UPDATE public.pet_profissionais SET filial_id = v_filial, nome = v_nome, funcao = v_funcao, comissao_percentual = v_com,
           ativo = coalesce((p_dados ->> 'ativo')::boolean, true), crmv = v_crmv, crmv_uf = v_uf, crf = v_crf, crf_uf = v_crf_uf, cpf = v_cpf
     WHERE id = v_id AND tenant_id = v_tenant;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.pet_profissional_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pet_profissional_salvar(jsonb) TO authenticated;

CREATE TABLE IF NOT EXISTS public.sngpc_medicamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id),
  produto_id uuid NOT NULL REFERENCES public.produtos(id),
  registro_ms text NOT NULL CHECK (registro_ms ~ '^[0-9]{13}$'),
  lista text NOT NULL CHECK (lista IN ('A1', 'A2', 'A3', 'B1', 'B2', 'C1', 'C2', 'C3', 'C4', 'C5')),
  unidade_medida smallint NOT NULL CHECK (unidade_medida IN (1, 2)),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sngpc_medicamentos_produto_idx ON public.sngpc_medicamentos (produto_id);
CREATE UNIQUE INDEX IF NOT EXISTS sngpc_medicamentos_registro_idx ON public.sngpc_medicamentos (tenant_id, registro_ms);

CREATE TABLE IF NOT EXISTS public.sngpc_documentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id),
  tipo text NOT NULL CHECK (tipo IN ('saldo_inicial', 'entrada', 'venda', 'perda')),
  data date NOT NULL CHECK (data <= current_date + 1),
  nf_numero bigint,
  nf_data date,
  cnpj_origem text,
  tipo_receituario smallint,
  numero_notificacao text,
  data_prescricao date,
  prescritor_nome text,
  prescritor_registro text,
  prescritor_uf text,
  comprador_nome text,
  comprador_tipo_documento smallint,
  comprador_documento text,
  comprador_orgao text,
  comprador_uf text,
  pet_id uuid REFERENCES public.pets(id),
  paciente_nome text,
  paciente_idade integer,
  paciente_unidade_idade smallint,
  paciente_sexo smallint,
  motivo_perda smallint,
  observacao text CHECK (observacao IS NULL OR length(observacao) <= 300),
  registrado_por uuid DEFAULT auth.uid(),
  registrado_nome text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  cancelado_em timestamptz,
  cancelado_por_nome text,
  cancelado_motivo text,
  CHECK ((cancelado_em IS NULL) = (cancelado_por_nome IS NULL)),
  CHECK (cancelado_em IS NULL OR length(btrim(coalesce(cancelado_motivo, ''))) > 0),
  CHECK (coalesce(CASE tipo
    WHEN 'saldo_inicial' THEN true
    WHEN 'entrada' THEN nf_numero > 0 AND nf_data IS NOT NULL AND nf_data <= data AND cnpj_origem ~ '^[0-9]{14}$'
    WHEN 'venda' THEN tipo_receituario BETWEEN 1 AND 4 AND numero_notificacao ~ '^[0-9]{1,12}$' AND data_prescricao IS NOT NULL
                      AND data_prescricao <= data AND length(btrim(coalesce(prescritor_nome, ''))) BETWEEN 1 AND 60
                      AND prescritor_registro ~ '^[0-9A-Za-z]{1,12}$'
                      AND prescritor_uf ~ '^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$'
                      AND length(btrim(coalesce(comprador_nome, ''))) BETWEEN 1 AND 60 AND comprador_tipo_documento = 1
                      AND comprador_documento ~ '^[0-9A-Za-z.-]{1,20}$' AND length(btrim(coalesce(comprador_orgao, ''))) BETWEEN 1 AND 20
                      AND comprador_uf ~ '^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$'
                      AND (paciente_nome IS NULL OR (length(btrim(paciente_nome)) BETWEEN 1 AND 60 AND paciente_idade BETWEEN 0 AND 100
                           AND paciente_unidade_idade IN (1, 2) AND paciente_sexo IN (1, 2)))
    WHEN 'perda' THEN motivo_perda BETWEEN 1 AND 9
    ELSE false END, false))
);
CREATE INDEX IF NOT EXISTS sngpc_documentos_data_idx ON public.sngpc_documentos (tenant_id, data DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS public.sngpc_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id),
  documento_id uuid NOT NULL REFERENCES public.sngpc_documentos(id),
  medicamento_id uuid NOT NULL REFERENCES public.sngpc_medicamentos(id),
  lote text NOT NULL CHECK (lote ~ '^[A-Z0-9._/-]{1,20}$'),
  validade date,
  quantidade integer NOT NULL CHECK (quantidade BETWEEN 1 AND 999),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS sngpc_itens_lote_idx ON public.sngpc_itens (tenant_id, medicamento_id, lote);
CREATE INDEX IF NOT EXISTS sngpc_itens_doc_idx ON public.sngpc_itens (documento_id);

CREATE TABLE IF NOT EXISTS public.sngpc_envios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id),
  tipo text NOT NULL CHECK (tipo IN ('movimentacao', 'inventario')),
  inicio date NOT NULL,
  fim date NOT NULL,
  farmaceutico_id uuid NOT NULL REFERENCES public.pet_profissionais(id),
  xml text NOT NULL CHECK (length(xml) BETWEEN 50 AND 5000000),
  sha256 text NOT NULL,
  situacao text NOT NULL DEFAULT 'gerado' CHECK (situacao IN ('gerado', 'transmitido', 'cancelado')),
  protocolo text CHECK (protocolo IS NULL OR length(btrim(protocolo)) BETWEEN 1 AND 80),
  transmitido_em timestamptz,
  cancelado_motivo text,
  gerado_por_nome text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (inicio <= fim),
  CHECK (tipo = 'movimentacao' OR inicio = fim),
  CHECK ((situacao = 'transmitido') = (transmitido_em IS NOT NULL AND protocolo IS NOT NULL)),
  CHECK (situacao <> 'cancelado' OR length(btrim(coalesce(cancelado_motivo, ''))) > 0)
);
CREATE INDEX IF NOT EXISTS sngpc_envios_idx ON public.sngpc_envios (tenant_id, tipo, fim DESC);

CREATE OR REPLACE FUNCTION public._sngpc_documento_guarda()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'O lançamento do SNGPC não se apaga; cancele com o motivo'; END IF;
  IF OLD.cancelado_em IS NOT NULL THEN RAISE EXCEPTION 'Lançamento cancelado não pode ser alterado'; END IF;
  IF NEW.cancelado_em IS NULL
     OR (to_jsonb(NEW) - 'cancelado_em' - 'cancelado_por_nome' - 'cancelado_motivo') IS DISTINCT FROM (to_jsonb(OLD) - 'cancelado_em' - 'cancelado_por_nome' - 'cancelado_motivo') THEN
    RAISE EXCEPTION 'O lançamento só pode ser cancelado';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_sngpc_documento_guarda ON public.sngpc_documentos;
CREATE TRIGGER trg_sngpc_documento_guarda BEFORE UPDATE OR DELETE ON public.sngpc_documentos
  FOR EACH ROW EXECUTE FUNCTION public._sngpc_documento_guarda();

CREATE OR REPLACE FUNCTION public._sngpc_item_guarda()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'O item do SNGPC não se altera nem se apaga';
END $$;
DROP TRIGGER IF EXISTS trg_sngpc_item_guarda ON public.sngpc_itens;
CREATE TRIGGER trg_sngpc_item_guarda BEFORE UPDATE OR DELETE ON public.sngpc_itens
  FOR EACH ROW EXECUTE FUNCTION public._sngpc_item_guarda();

CREATE OR REPLACE FUNCTION public._sngpc_envio_guarda()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'O envio do SNGPC não se apaga'; END IF;
  IF OLD.situacao <> 'gerado' THEN RAISE EXCEPTION 'Envio % não pode ser alterado', OLD.situacao; END IF;
  IF NEW.situacao = 'gerado'
     OR (to_jsonb(NEW) - 'situacao' - 'protocolo' - 'transmitido_em' - 'cancelado_motivo') IS DISTINCT FROM (to_jsonb(OLD) - 'situacao' - 'protocolo' - 'transmitido_em' - 'cancelado_motivo') THEN
    RAISE EXCEPTION 'O arquivo gerado não muda; só pode ser marcado como transmitido ou cancelado';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_sngpc_envio_guarda ON public.sngpc_envios;
CREATE TRIGGER trg_sngpc_envio_guarda BEFORE UPDATE OR DELETE ON public.sngpc_envios
  FOR EACH ROW EXECUTE FUNCTION public._sngpc_envio_guarda();
DROP TRIGGER IF EXISTS trg_sngpc_medicamentos_updated ON public.sngpc_medicamentos;
CREATE TRIGGER trg_sngpc_medicamentos_updated BEFORE UPDATE ON public.sngpc_medicamentos FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sngpc_medicamentos', 'sngpc_documentos', 'sngpc_itens', 'sngpc_envios'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS salao_restrito ON public.%I', t);
    EXECUTE format('CREATE POLICY salao_restrito ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()))', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public._sngpc_ator()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v text;
BEGIN
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'veterinario']);
  IF NOT public.clinica_liberada() THEN RAISE EXCEPTION 'A clínica não está liberada para esta empresa'; END IF;
  SELECT nome INTO v FROM public.profiles WHERE id = auth.uid();
  RETURN coalesce(v, 'Usuário');
END $$;
REVOKE ALL ON FUNCTION public._sngpc_ator() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._sngpc_fechado_ate()
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT max(fim) FROM public.sngpc_envios WHERE tenant_id = public.current_tenant_id() AND tipo = 'movimentacao' AND situacao = 'transmitido'
$$;
REVOKE ALL ON FUNCTION public._sngpc_fechado_ate() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._sngpc_lote_ok(p_medicamento_id uuid, p_lote text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT coalesce(min(r), 0) >= 0 FROM (
    SELECT sum(CASE WHEN d.tipo IN ('saldo_inicial', 'entrada') THEN i.quantidade ELSE -i.quantidade END)
             OVER (ORDER BY d.data, (CASE WHEN d.tipo IN ('saldo_inicial', 'entrada') THEN 0 ELSE 1 END), i.created_at, i.id) AS r
      FROM public.sngpc_itens i JOIN public.sngpc_documentos d ON d.id = i.documento_id
     WHERE i.tenant_id = public.current_tenant_id() AND i.medicamento_id = p_medicamento_id AND i.lote = p_lote AND d.cancelado_em IS NULL
  ) q
$$;
REVOKE ALL ON FUNCTION public._sngpc_lote_ok(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sngpc_medicamento_salvar(p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  a text := public._sngpc_ator();
  v_tenant uuid := public.current_tenant_id();
  v_id uuid := nullif(p_dados ->> 'id', '')::uuid;
  v_prod uuid := nullif(p_dados ->> 'produto_id', '')::uuid;
  v_reg text := regexp_replace(coalesce(p_dados ->> 'registro_ms', ''), '\D', '', 'g');
  v_lista text := upper(coalesce(p_dados ->> 'lista', ''));
  v_un smallint := nullif(p_dados ->> 'unidade_medida', '')::smallint;
  v_ativo boolean := coalesce((p_dados ->> 'ativo')::boolean, true);
BEGIN
  IF v_reg !~ '^[0-9]{13}$' THEN RAISE EXCEPTION 'O registro na Anvisa tem 13 números'; END IF;
  IF v_lista NOT IN ('A1', 'A2', 'A3', 'B1', 'B2', 'C1', 'C2', 'C3', 'C4', 'C5') THEN RAISE EXCEPTION 'Escolha a lista da Portaria 344'; END IF;
  IF v_un IS NULL OR v_un NOT IN (1, 2) THEN RAISE EXCEPTION 'Escolha a unidade: caixa ou frasco'; END IF;
  IF v_id IS NULL THEN
    IF v_prod IS NULL OR NOT EXISTS (SELECT 1 FROM public.produtos WHERE id = v_prod AND tenant_id = v_tenant) THEN RAISE EXCEPTION 'Escolha o produto do cadastro'; END IF;
    INSERT INTO public.sngpc_medicamentos (tenant_id, produto_id, registro_ms, lista, unidade_medida, ativo) VALUES (v_tenant, v_prod, v_reg, v_lista, v_un, v_ativo)
    RETURNING id INTO v_id;
  ELSE
    IF EXISTS (SELECT 1 FROM public.sngpc_itens WHERE medicamento_id = v_id)
       AND EXISTS (SELECT 1 FROM public.sngpc_medicamentos m WHERE m.id = v_id AND (m.registro_ms <> v_reg OR m.unidade_medida <> v_un)) THEN
      RAISE EXCEPTION 'Este medicamento já tem movimento: o registro e a unidade não mudam';
    END IF;
    UPDATE public.sngpc_medicamentos SET registro_ms = v_reg, lista = v_lista, unidade_medida = v_un, ativo = v_ativo WHERE id = v_id AND tenant_id = v_tenant;
    IF NOT FOUND THEN RAISE EXCEPTION 'Medicamento não encontrado'; END IF;
  END IF;
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Este produto ou este registro já está cadastrado como controlado';
END $$;
REVOKE ALL ON FUNCTION public.sngpc_medicamento_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sngpc_medicamento_salvar(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.sngpc_medicamentos()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE a text := public._sngpc_ator();
BEGIN
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', m.id, 'produto_id', m.produto_id, 'produto', p.descricao, 'registro_ms', m.registro_ms,
                  'lista', m.lista, 'unidade_medida', m.unidade_medida, 'ativo', m.ativo) ORDER BY p.descricao)
                  FROM public.sngpc_medicamentos m JOIN public.produtos p ON p.id = m.produto_id WHERE m.tenant_id = public.current_tenant_id()), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.sngpc_medicamentos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sngpc_medicamentos() TO authenticated;

CREATE OR REPLACE FUNCTION public.sngpc_registrar(p_tipo text, p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  a text := public._sngpc_ator();
  v_tenant uuid := public.current_tenant_id();
  v_data date := coalesce(nullif(p_dados ->> 'data', '')::date, current_date);
  v_fechado date := public._sngpc_fechado_ate();
  v_id uuid;
  v_pet uuid := nullif(p_dados ->> 'pet_id', '')::uuid;
  v_pac_nome text := nullif(btrim(coalesce(p_dados ->> 'paciente_nome', '')), '');
  it jsonb;
  v_med uuid; v_lote text; v_qtd integer; v_val date;
  r record;
BEGIN
  IF p_tipo NOT IN ('saldo_inicial', 'entrada', 'venda', 'perda') THEN RAISE EXCEPTION 'Tipo de lançamento inválido'; END IF;
  IF v_data > current_date THEN RAISE EXCEPTION 'A data não pode ser futura'; END IF;
  IF v_fechado IS NOT NULL AND v_data <= v_fechado THEN
    RAISE EXCEPTION 'O período até % já foi transmitido ao SNGPC: lance com data posterior', to_char(v_fechado, 'DD/MM/YYYY');
  END IF;
  IF jsonb_typeof(p_dados -> 'itens') IS DISTINCT FROM 'array' OR jsonb_array_length(p_dados -> 'itens') NOT BETWEEN 1 AND 30 THEN
    RAISE EXCEPTION 'Informe de 1 a 30 itens (medicamento, lote e quantidade)';
  END IF;
  IF v_pet IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.pets WHERE id = v_pet AND tenant_id = v_tenant) THEN RAISE EXCEPTION 'Animal não encontrado'; END IF;
  IF p_tipo = 'venda' AND v_pac_nome IS NULL AND v_pet IS NOT NULL THEN
    RAISE EXCEPTION 'Informe os dados do animal (nome, idade, sexo)';
  END IF;

  INSERT INTO public.sngpc_documentos (tenant_id, tipo, data, registrado_nome, observacao,
      nf_numero, nf_data, cnpj_origem,
      tipo_receituario, numero_notificacao, data_prescricao, prescritor_nome, prescritor_registro, prescritor_uf,
      comprador_nome, comprador_tipo_documento, comprador_documento, comprador_orgao, comprador_uf,
      pet_id, paciente_nome, paciente_idade, paciente_unidade_idade, paciente_sexo, motivo_perda)
  VALUES (v_tenant, p_tipo, v_data, a, nullif(btrim(coalesce(p_dados ->> 'observacao', '')), ''),
      CASE WHEN p_tipo = 'entrada' THEN nullif(p_dados ->> 'nf_numero', '')::bigint END,
      CASE WHEN p_tipo = 'entrada' THEN nullif(p_dados ->> 'nf_data', '')::date END,
      CASE WHEN p_tipo = 'entrada' THEN regexp_replace(coalesce(p_dados ->> 'cnpj_origem', ''), '\D', '', 'g') END,
      CASE WHEN p_tipo = 'venda' THEN nullif(p_dados ->> 'tipo_receituario', '')::smallint END,
      CASE WHEN p_tipo = 'venda' THEN nullif(btrim(coalesce(p_dados ->> 'numero_notificacao', '')), '') END,
      CASE WHEN p_tipo = 'venda' THEN nullif(p_dados ->> 'data_prescricao', '')::date END,
      CASE WHEN p_tipo = 'venda' THEN nullif(btrim(coalesce(p_dados ->> 'prescritor_nome', '')), '') END,
      CASE WHEN p_tipo = 'venda' THEN nullif(upper(regexp_replace(coalesce(p_dados ->> 'prescritor_registro', ''), '[^0-9A-Za-z]', '', 'g')), '') END,
      CASE WHEN p_tipo = 'venda' THEN nullif(upper(btrim(coalesce(p_dados ->> 'prescritor_uf', ''))), '') END,
      CASE WHEN p_tipo = 'venda' THEN nullif(btrim(coalesce(p_dados ->> 'comprador_nome', '')), '') END,
      CASE WHEN p_tipo = 'venda' THEN nullif(p_dados ->> 'comprador_tipo_documento', '')::smallint END,
      CASE WHEN p_tipo = 'venda' THEN nullif(btrim(coalesce(p_dados ->> 'comprador_documento', '')), '') END,
      CASE WHEN p_tipo = 'venda' THEN nullif(btrim(coalesce(p_dados ->> 'comprador_orgao', '')), '') END,
      CASE WHEN p_tipo = 'venda' THEN nullif(upper(btrim(coalesce(p_dados ->> 'comprador_uf', ''))), '') END,
      CASE WHEN p_tipo = 'venda' THEN v_pet END,
      CASE WHEN p_tipo = 'venda' THEN v_pac_nome END,
      CASE WHEN p_tipo = 'venda' AND v_pac_nome IS NOT NULL THEN nullif(p_dados ->> 'paciente_idade', '')::integer END,
      CASE WHEN p_tipo = 'venda' AND v_pac_nome IS NOT NULL THEN nullif(p_dados ->> 'paciente_unidade_idade', '')::smallint END,
      CASE WHEN p_tipo = 'venda' AND v_pac_nome IS NOT NULL THEN nullif(p_dados ->> 'paciente_sexo', '')::smallint END,
      CASE WHEN p_tipo = 'perda' THEN nullif(p_dados ->> 'motivo_perda', '')::smallint END)
  RETURNING id INTO v_id;

  FOR it IN SELECT * FROM jsonb_array_elements(p_dados -> 'itens') LOOP
    v_med := nullif(it ->> 'medicamento_id', '')::uuid;
    v_lote := upper(btrim(coalesce(it ->> 'lote', '')));
    v_qtd := nullif(it ->> 'quantidade', '')::integer;
    v_val := nullif(it ->> 'validade', '')::date;
    IF v_med IS NULL OR NOT EXISTS (SELECT 1 FROM public.sngpc_medicamentos WHERE id = v_med AND tenant_id = v_tenant AND (ativo OR p_tipo = 'perda')) THEN
      RAISE EXCEPTION 'Medicamento controlado não encontrado ou inativo';
    END IF;
    IF v_lote !~ '^[A-Z0-9._/-]{1,20}$' THEN RAISE EXCEPTION 'Informe o lote (letras, números, ponto, barra ou hífen; até 20)'; END IF;
    IF v_qtd IS NULL OR v_qtd NOT BETWEEN 1 AND 999 THEN RAISE EXCEPTION 'A quantidade vai de 1 a 999'; END IF;
    INSERT INTO public.sngpc_itens (tenant_id, documento_id, medicamento_id, lote, validade, quantidade)
    VALUES (v_tenant, v_id, v_med, v_lote, CASE WHEN p_tipo IN ('entrada', 'saldo_inicial') THEN v_val END, v_qtd);
  END LOOP;

  FOR r IN SELECT DISTINCT medicamento_id, lote FROM public.sngpc_itens WHERE documento_id = v_id LOOP
    IF NOT public._sngpc_lote_ok(r.medicamento_id, r.lote) THEN
      RAISE EXCEPTION 'Saldo insuficiente: o lote % ficaria negativo', r.lote;
    END IF;
  END LOOP;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.sngpc_registrar(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sngpc_registrar(text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.sngpc_cancelar(p_id uuid, p_motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  a text := public._sngpc_ator();
  d public.sngpc_documentos;
  v_fechado date := public._sngpc_fechado_ate();
  r record;
BEGIN
  IF btrim(coalesce(p_motivo, '')) = '' THEN RAISE EXCEPTION 'Informe o motivo do cancelamento'; END IF;
  SELECT * INTO d FROM public.sngpc_documentos WHERE id = p_id AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado'; END IF;
  IF d.cancelado_em IS NOT NULL THEN RAISE EXCEPTION 'Lançamento já cancelado'; END IF;
  IF v_fechado IS NOT NULL AND d.data <= v_fechado THEN
    RAISE EXCEPTION 'O período deste lançamento já foi transmitido ao SNGPC: não dá para cancelar';
  END IF;
  UPDATE public.sngpc_documentos SET cancelado_em = now(), cancelado_por_nome = a, cancelado_motivo = btrim(p_motivo) WHERE id = d.id;
  FOR r IN SELECT DISTINCT medicamento_id, lote FROM public.sngpc_itens WHERE documento_id = d.id LOOP
    IF NOT public._sngpc_lote_ok(r.medicamento_id, r.lote) THEN
      RAISE EXCEPTION 'Não dá para cancelar: o lote % ficaria com saldo negativo em alguma data', r.lote;
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.sngpc_cancelar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sngpc_cancelar(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.sngpc_saldo(p_data date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  a text := public._sngpc_ator();
  v_ate date := coalesce(p_data, current_date);
BEGIN
  RETURN coalesce((
    SELECT jsonb_agg(x ORDER BY x ->> 'produto', x ->> 'lote')
      FROM (
        SELECT jsonb_build_object('medicamento_id', m.id, 'produto', p.descricao, 'registro_ms', m.registro_ms, 'lista', m.lista,
                 'unidade_medida', m.unidade_medida, 'lote', i.lote,
                 'validade', max(i.validade) FILTER (WHERE d.tipo IN ('entrada', 'saldo_inicial')),
                 'saldo', sum(CASE WHEN d.tipo IN ('saldo_inicial', 'entrada') THEN i.quantidade ELSE -i.quantidade END)) AS x
          FROM public.sngpc_itens i
          JOIN public.sngpc_documentos d ON d.id = i.documento_id AND d.cancelado_em IS NULL AND d.data <= v_ate
          JOIN public.sngpc_medicamentos m ON m.id = i.medicamento_id
          JOIN public.produtos p ON p.id = m.produto_id
         WHERE i.tenant_id = public.current_tenant_id()
         GROUP BY m.id, p.descricao, m.registro_ms, m.lista, m.unidade_medida, i.lote
        HAVING sum(CASE WHEN d.tipo IN ('saldo_inicial', 'entrada') THEN i.quantidade ELSE -i.quantidade END) <> 0
      ) q), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.sngpc_saldo(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sngpc_saldo(date) TO authenticated;

CREATE OR REPLACE FUNCTION public.sngpc_livro(p_inicio date DEFAULT NULL, p_fim date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE a text := public._sngpc_ator();
BEGIN
  RETURN jsonb_build_object('fechado_ate', public._sngpc_fechado_ate(), 'documentos', coalesce((
    SELECT jsonb_agg(x ORDER BY (x ->> 'data') DESC, (x ->> 'created_at') DESC)
      FROM (
        SELECT jsonb_build_object('id', d.id, 'tipo', d.tipo, 'data', d.data, 'created_at', d.created_at, 'registrado_nome', d.registrado_nome,
                 'observacao', d.observacao, 'nf_numero', d.nf_numero, 'nf_data', d.nf_data, 'cnpj_origem', d.cnpj_origem,
                 'tipo_receituario', d.tipo_receituario, 'numero_notificacao', d.numero_notificacao, 'data_prescricao', d.data_prescricao,
                 'prescritor_nome', d.prescritor_nome, 'prescritor_registro', d.prescritor_registro, 'prescritor_uf', d.prescritor_uf,
                 'comprador_nome', d.comprador_nome, 'paciente_nome', d.paciente_nome, 'motivo_perda', d.motivo_perda,
                 'cancelado_em', d.cancelado_em, 'cancelado_por_nome', d.cancelado_por_nome, 'cancelado_motivo', d.cancelado_motivo,
                 'itens', (SELECT jsonb_agg(jsonb_build_object('produto', p.descricao, 'lote', i.lote, 'validade', i.validade, 'quantidade', i.quantidade,
                                   'unidade_medida', m.unidade_medida) ORDER BY i.created_at)
                             FROM public.sngpc_itens i JOIN public.sngpc_medicamentos m ON m.id = i.medicamento_id JOIN public.produtos p ON p.id = m.produto_id
                            WHERE i.documento_id = d.id)) AS x
          FROM public.sngpc_documentos d
         WHERE d.tenant_id = public.current_tenant_id() AND (p_inicio IS NULL OR d.data >= p_inicio) AND (p_fim IS NULL OR d.data <= p_fim)
         ORDER BY d.data DESC, d.created_at DESC LIMIT 300
      ) q), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.sngpc_livro(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sngpc_livro(date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.sngpc_responsaveis()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE a text := public._sngpc_ator();
BEGIN
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'crf', crf, 'crf_uf', crf_uf, 'cpf', cpf) ORDER BY nome)
                     FROM public.pet_profissionais
                    WHERE tenant_id = public.current_tenant_id() AND ativo AND funcao = 'farmaceutico' AND public._cpf_valido(cpf)), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.sngpc_responsaveis() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sngpc_responsaveis() TO authenticated;

CREATE OR REPLACE FUNCTION public._sngpc_cnpj()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v text;
BEGIN
  SELECT regexp_replace(coalesce(cnpj, ''), '\D', '', 'g') INTO v FROM public.empresas WHERE tenant_id = public.current_tenant_id() ORDER BY created_at LIMIT 1;
  IF v IS NULL OR v !~ '^[0-9]{14}$' THEN RAISE EXCEPTION 'Cadastre o CNPJ (14 números) da empresa antes de gerar o arquivo do SNGPC'; END IF;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public._sngpc_cnpj() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sngpc_periodo(p_inicio date, p_fim date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE a text := public._sngpc_ator();
BEGIN
  IF p_inicio IS NULL OR p_fim IS NULL OR p_inicio > p_fim THEN RAISE EXCEPTION 'Informe o período (início e fim)'; END IF;
  IF p_fim > current_date THEN RAISE EXCEPTION 'O período não pode terminar no futuro'; END IF;
  IF p_fim - p_inicio > 30 THEN RAISE EXCEPTION 'O período pode ter até 31 dias'; END IF;
  RETURN jsonb_build_object('cnpj', public._sngpc_cnpj(), 'inicio', p_inicio, 'fim', p_fim, 'documentos', coalesce((
    SELECT jsonb_agg(x ORDER BY (x ->> 'data'), (x ->> 'created_at'))
      FROM (
        SELECT jsonb_build_object('id', d.id, 'tipo', d.tipo, 'data', d.data, 'created_at', d.created_at,
                 'nf_numero', d.nf_numero, 'nf_data', d.nf_data, 'cnpj_origem', d.cnpj_origem,
                 'tipo_receituario', d.tipo_receituario, 'numero_notificacao', d.numero_notificacao, 'data_prescricao', d.data_prescricao,
                 'prescritor_nome', d.prescritor_nome, 'prescritor_registro', d.prescritor_registro, 'prescritor_uf', d.prescritor_uf,
                 'comprador_nome', d.comprador_nome, 'comprador_tipo_documento', d.comprador_tipo_documento, 'comprador_documento', d.comprador_documento,
                 'comprador_orgao', d.comprador_orgao, 'comprador_uf', d.comprador_uf,
                 'paciente_nome', d.paciente_nome, 'paciente_idade', d.paciente_idade, 'paciente_unidade_idade', d.paciente_unidade_idade,
                 'paciente_sexo', d.paciente_sexo, 'motivo_perda', d.motivo_perda,
                 'itens', (SELECT jsonb_agg(jsonb_build_object('registro_ms', m.registro_ms, 'lote', i.lote, 'quantidade', i.quantidade,
                                   'unidade_medida', m.unidade_medida) ORDER BY i.created_at)
                             FROM public.sngpc_itens i JOIN public.sngpc_medicamentos m ON m.id = i.medicamento_id WHERE i.documento_id = d.id)) AS x
          FROM public.sngpc_documentos d
         WHERE d.tenant_id = public.current_tenant_id() AND d.cancelado_em IS NULL AND d.tipo <> 'saldo_inicial' AND d.data BETWEEN p_inicio AND p_fim
      ) q), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.sngpc_periodo(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sngpc_periodo(date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.sngpc_inventario(p_data date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE a text := public._sngpc_ator();
BEGIN
  IF p_data IS NULL OR p_data > current_date OR p_data < current_date - 7 THEN RAISE EXCEPTION 'A data do inventário vai de 7 dias atrás até hoje'; END IF;
  RETURN jsonb_build_object('cnpj', public._sngpc_cnpj(), 'data', p_data, 'itens', coalesce((
    SELECT jsonb_agg(jsonb_build_object('registro_ms', s ->> 'registro_ms', 'lote', s ->> 'lote', 'quantidade', (s ->> 'saldo')::integer,
                     'unidade_medida', (s ->> 'unidade_medida')::integer))
      FROM jsonb_array_elements(public.sngpc_saldo(p_data)) s), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.sngpc_inventario(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sngpc_inventario(date) TO authenticated;

CREATE OR REPLACE FUNCTION public.sngpc_envio_registrar(p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  a text := public._sngpc_ator();
  v_tenant uuid := public.current_tenant_id();
  v_tipo text := coalesce(p_dados ->> 'tipo', '');
  v_ini date := nullif(p_dados ->> 'inicio', '')::date;
  v_fim date := nullif(p_dados ->> 'fim', '')::date;
  v_resp uuid := nullif(p_dados ->> 'farmaceutico_id', '')::uuid;
  v_xml text := coalesce(p_dados ->> 'xml', '');
  v_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('sngpc_envio:' || v_tenant::text, 0));
  IF v_tipo NOT IN ('movimentacao', 'inventario') THEN RAISE EXCEPTION 'Tipo de envio inválido'; END IF;
  IF v_ini IS NULL OR v_fim IS NULL OR v_ini > v_fim THEN RAISE EXCEPTION 'Informe o período'; END IF;
  IF v_fim > current_date THEN RAISE EXCEPTION 'O período não pode terminar no futuro'; END IF;
  IF v_xml NOT LIKE '<?xml%' OR length(v_xml) < 50 THEN RAISE EXCEPTION 'Arquivo XML inválido'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pet_profissionais WHERE id = v_resp AND tenant_id = v_tenant AND ativo AND funcao = 'farmaceutico' AND public._cpf_valido(cpf)) THEN
    RAISE EXCEPTION 'Escolha o farmacêutico responsável (ativo, com CRF e CPF válido)';
  END IF;
  IF v_tipo = 'movimentacao' THEN
    IF v_fim - v_ini > 30 THEN RAISE EXCEPTION 'O período pode ter até 31 dias'; END IF;
    IF EXISTS (SELECT 1 FROM public.sngpc_envios WHERE tenant_id = v_tenant AND tipo = 'movimentacao' AND situacao <> 'cancelado' AND daterange(inicio, fim, '[]') && daterange(v_ini, v_fim, '[]')) THEN
      RAISE EXCEPTION 'Já existe um arquivo gerado ou transmitido que cobre parte deste período: cancele o arquivo gerado ou escolha outro período';
    END IF;
  ELSE
    IF v_ini <> v_fim OR v_fim < current_date - 7 THEN RAISE EXCEPTION 'A data do inventário vai de 7 dias atrás até hoje'; END IF;
  END IF;
  INSERT INTO public.sngpc_envios (tenant_id, tipo, inicio, fim, farmaceutico_id, xml, sha256, gerado_por_nome)
  VALUES (v_tenant, v_tipo, v_ini, v_fim, v_resp, v_xml, encode(sha256(convert_to(v_xml, 'UTF8')), 'hex'), a)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.sngpc_envio_registrar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sngpc_envio_registrar(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.sngpc_envio_transmitir(p_id uuid, p_protocolo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE a text := public._sngpc_ator();
BEGIN
  IF btrim(coalesce(p_protocolo, '')) = '' OR length(btrim(p_protocolo)) > 80 THEN RAISE EXCEPTION 'Informe o protocolo ou o código que o SNGPC devolveu (até 80 letras)'; END IF;
  UPDATE public.sngpc_envios SET situacao = 'transmitido', protocolo = btrim(p_protocolo), transmitido_em = now()
   WHERE id = p_id AND tenant_id = public.current_tenant_id() AND situacao = 'gerado';
  IF NOT FOUND THEN RAISE EXCEPTION 'Envio não encontrado ou já resolvido'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.sngpc_envio_transmitir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sngpc_envio_transmitir(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.sngpc_envio_cancelar(p_id uuid, p_motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE a text := public._sngpc_ator();
BEGIN
  IF btrim(coalesce(p_motivo, '')) = '' THEN RAISE EXCEPTION 'Informe o motivo'; END IF;
  UPDATE public.sngpc_envios SET situacao = 'cancelado', cancelado_motivo = btrim(p_motivo)
   WHERE id = p_id AND tenant_id = public.current_tenant_id() AND situacao = 'gerado';
  IF NOT FOUND THEN RAISE EXCEPTION 'Só o arquivo gerado (ainda não transmitido) pode ser cancelado'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.sngpc_envio_cancelar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sngpc_envio_cancelar(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.sngpc_envios()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE a text := public._sngpc_ator();
BEGIN
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', e.id, 'tipo', e.tipo, 'inicio', e.inicio, 'fim', e.fim, 'situacao', e.situacao,
                  'protocolo', e.protocolo, 'transmitido_em', e.transmitido_em, 'cancelado_motivo', e.cancelado_motivo, 'sha256', e.sha256,
                  'created_at', e.created_at, 'gerado_por', e.gerado_por_nome, 'farmaceutico', p.nome) ORDER BY e.created_at DESC)
                  FROM (SELECT * FROM public.sngpc_envios WHERE tenant_id = public.current_tenant_id() ORDER BY created_at DESC LIMIT 100) e
                  JOIN public.pet_profissionais p ON p.id = e.farmaceutico_id), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.sngpc_envios() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sngpc_envios() TO authenticated;

CREATE OR REPLACE FUNCTION public.sngpc_envio_xml(p_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE a text := public._sngpc_ator(); v text;
BEGIN
  SELECT xml INTO v FROM public.sngpc_envios WHERE id = p_id AND tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Envio não encontrado'; END IF;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.sngpc_envio_xml(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sngpc_envio_xml(uuid) TO authenticated;