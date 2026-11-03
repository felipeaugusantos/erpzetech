-- Hotelaria (Fase 1, migration 1): módulo, configuração por hotel, tipos de acomodação, acomodações (UH), tarifas e hóspedes.
-- Hotel = filial. Escrita só por funções (papel + trava do salão + módulo liberado + acesso à filial). Reservas, conta do hóspede,
-- check-in/out e NFS-e vêm nas migrations seguintes. Especificação: docs/hotelaria-fase-1.md.
-- Pode ser rodado de novo sem erro (tabelas, funções, políticas e gatilhos são refeitos).

-- ============ módulo "hotelaria" nas escolhas da empresa ============
ALTER TABLE public.empresas DROP CONSTRAINT IF EXISTS empresas_modulos_sem_cnpj_validos;
ALTER TABLE public.empresas ADD CONSTRAINT empresas_modulos_sem_cnpj_validos
  CHECK (modulos_sem_cnpj <@ ARRAY['assistencia','locacao','restaurante','petshop','clinica','lavarapido','hotelaria']::text[]);

DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.empresa_modulos_liberados'::regclass AND contype = 'c' LOOP
    EXECUTE format('ALTER TABLE public.empresa_modulos_liberados DROP CONSTRAINT %I', c.conname);
  END LOOP;
  ALTER TABLE public.empresa_modulos_liberados ADD CONSTRAINT empresa_modulos_liberados_modulo_check
    CHECK (modulo IN ('assistencia','locacao','restaurante','petshop','clinica','obras','lavarapido','manufatura','hotelaria'));
END $$;

-- Mesma regra de src/lib/cnae-regras.ts: ramo Hotelaria, liberação explícita, escolha manual sem CNPJ ou CNAE 55.10-8 / 55.90-6.
CREATE OR REPLACE FUNCTION public.hotelaria_liberada() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public AS $function$
 SELECT EXISTS (SELECT 1 FROM public.empresas e WHERE e.tenant_id = public.current_tenant_id() AND (
 e.ramo_atividade = 'hotelaria'
 OR EXISTS (SELECT 1 FROM public.empresa_modulos_liberados m WHERE m.empresa_id = e.id AND m.modulo = 'hotelaria')
 OR (length(regexp_replace(coalesce(e.cnpj,''), '[^0-9A-Za-z]','','g')) < 14 AND 'hotelaria' = ANY(e.modulos_sem_cnpj))
 OR EXISTS (SELECT 1 FROM unnest(regexp_split_to_array(coalesce(e.cnae,'') || ',' || coalesce(e.cnae_secundarios,''), '[,;\n|]+')) c
             WHERE regexp_replace(c,'\D','','g') LIKE '5510%' OR regexp_replace(c,'\D','','g') LIKE '5590%')))
$function$;
REVOKE ALL ON FUNCTION public.hotelaria_liberada() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hotelaria_liberada() TO authenticated;

CREATE OR REPLACE FUNCTION public._hs_exige_liberado() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
BEGIN
  IF NOT public.hotelaria_liberada() THEN RAISE EXCEPTION 'O módulo Hotelaria não está liberado para esta empresa'; END IF;
END $$;
REVOKE ALL ON FUNCTION public._hs_exige_liberado() FROM PUBLIC, anon, authenticated;

-- A filial precisa ser da empresa e o usuário precisa ter acesso a ela.
CREATE OR REPLACE FUNCTION public._hs_exige_filial(p_filial uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
BEGIN
  IF p_filial IS NULL OR NOT EXISTS (SELECT 1 FROM public.filiais f WHERE f.id = p_filial AND f.tenant_id = public.current_tenant_id())
     OR NOT public.pode_filial(p_filial) THEN
    RAISE EXCEPTION 'Hotel (filial) não encontrado';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._hs_exige_filial(uuid) FROM PUBLIC, anon, authenticated;

-- CPF com os dois dígitos verificadores corretos (espelho de cpfValido em src/lib/nfce-consumidor.ts).
CREATE OR REPLACE FUNCTION public._hs_cpf_valido(p_cpf text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE c text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g'); soma integer; dv integer; t integer; i integer;
BEGIN
  IF length(c) <> 11 OR c ~ '^(\d)\1{10}$' THEN RETURN false; END IF;
  FOREACH t IN ARRAY ARRAY[9, 10] LOOP
    soma := 0;
    FOR i IN 1..t LOOP soma := soma + substr(c, i, 1)::integer * (t + 2 - i); END LOOP;
    dv := ((soma * 10) % 11) % 10;
    IF dv <> substr(c, t + 1, 1)::integer THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public._hs_cpf_valido(text) FROM PUBLIC, anon, authenticated;

-- ============ tabelas ============
-- Chave composta para os cadastros apontarem só para a mesma empresa (filiais já tem filiais_id_tenant_uk).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'filiais_id_tenant_uk' AND conrelid = 'public.filiais'::regclass) THEN
    ALTER TABLE public.filiais ADD CONSTRAINT filiais_id_tenant_uk UNIQUE (id, tenant_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.hs_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  filial_id uuid NOT NULL,
  checkin_hora time NOT NULL DEFAULT '14:00',
  checkout_hora time NOT NULL DEFAULT '12:00',
  -- 0 = não cobra taxa de turismo
  taxa_turismo_por_hospede_noite numeric(14,2) NOT NULL DEFAULT 0 CHECK (taxa_turismo_por_hospede_noite >= 0),
  cobra_diaria_no_checkout_tardio boolean NOT NULL DEFAULT false,
  exige_documento_checkin boolean NOT NULL DEFAULT true,
  fuso text NOT NULL DEFAULT 'America/Sao_Paulo',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hs_config_filial_fk FOREIGN KEY (filial_id, tenant_id) REFERENCES public.filiais (id, tenant_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS hs_config_filial_idx ON public.hs_config (filial_id);

CREATE TABLE IF NOT EXISTS public.hs_tipos_uh (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  filial_id uuid NOT NULL,
  nome text NOT NULL CHECK (length(btrim(nome)) > 0),
  descricao text,
  capacidade_adultos integer NOT NULL DEFAULT 2 CHECK (capacidade_adultos BETWEEN 1 AND 20),
  capacidade_criancas integer NOT NULL DEFAULT 0 CHECK (capacidade_criancas BETWEEN 0 AND 20),
  comodidades text[] NOT NULL DEFAULT '{}',
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hs_tipos_uh_filial_fk FOREIGN KEY (filial_id, tenant_id) REFERENCES public.filiais (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT hs_tipos_uh_id_tenant_uk UNIQUE (id, tenant_id),
  CONSTRAINT hs_tipos_uh_id_filial_uk UNIQUE (id, filial_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS hs_tipos_uh_nome_idx ON public.hs_tipos_uh (filial_id, lower(btrim(nome)));

-- A unidade física (quarto, chalé, apartamento). Interditada = fora de venda sem data para voltar (com período vem na migration de reservas).
CREATE TABLE IF NOT EXISTS public.hs_uhs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  filial_id uuid NOT NULL,
  tipo_id uuid NOT NULL,
  numero text NOT NULL CHECK (length(btrim(numero)) BETWEEN 1 AND 20),
  andar text,
  -- Fase 1 alterna só limpo/sujo; a governança completa vem na Fase 2
  situacao_limpeza text NOT NULL DEFAULT 'limpo' CHECK (situacao_limpeza IN ('limpo', 'sujo', 'inspecionado')),
  interditada boolean NOT NULL DEFAULT false,
  motivo_interdicao text,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hs_uhs_filial_fk FOREIGN KEY (filial_id, tenant_id) REFERENCES public.filiais (id, tenant_id) ON DELETE CASCADE,
  -- a UH é sempre do mesmo hotel do seu tipo
  CONSTRAINT hs_uhs_tipo_fk FOREIGN KEY (tipo_id, filial_id) REFERENCES public.hs_tipos_uh (id, filial_id),
  CONSTRAINT hs_uhs_id_tenant_uk UNIQUE (id, tenant_id),
  CONSTRAINT hs_uhs_interdicao_ck CHECK (NOT interditada OR length(btrim(coalesce(motivo_interdicao, ''))) > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS hs_uhs_numero_idx ON public.hs_uhs (filial_id, lower(btrim(numero)));
CREATE INDEX IF NOT EXISTS hs_uhs_tipo_idx ON public.hs_uhs (tipo_id);

-- Entre as tarifas que cobrem a noite (vigência + dia da semana) vence a de maior prioridade; empate: menor vigência.
CREATE TABLE IF NOT EXISTS public.hs_tarifas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  tipo_id uuid NOT NULL,
  nome text NOT NULL CHECK (length(btrim(nome)) > 0),
  vigencia_de date NOT NULL,
  vigencia_ate date NOT NULL,
  -- 0 = domingo … 6 = sábado (igual a extract(dow)); vazio = todos os dias
  dias_semana smallint[] NOT NULL DEFAULT '{}',
  valor_diaria numeric(14,2) NOT NULL CHECK (valor_diaria >= 0),
  valor_adulto_extra numeric(14,2) NOT NULL DEFAULT 0 CHECK (valor_adulto_extra >= 0),
  valor_crianca numeric(14,2) NOT NULL DEFAULT 0 CHECK (valor_crianca >= 0),
  minimo_noites integer NOT NULL DEFAULT 1 CHECK (minimo_noites >= 1),
  prioridade smallint NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hs_tarifas_tipo_fk FOREIGN KEY (tipo_id, tenant_id) REFERENCES public.hs_tipos_uh (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT hs_tarifas_vigencia_ck CHECK (vigencia_ate >= vigencia_de),
  CONSTRAINT hs_tarifas_dias_ck CHECK (dias_semana <@ ARRAY[0,1,2,3,4,5,6]::smallint[])
);
CREATE INDEX IF NOT EXISTS hs_tarifas_tipo_idx ON public.hs_tarifas (tipo_id, vigencia_de, vigencia_ate);

-- A pessoa hospedada, com os campos da ficha nacional (FNRH). O faturamento é que exige CPF/CNPJ (pelo cliente), não o hóspede.
CREATE TABLE IF NOT EXISTS public.hs_hospedes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (length(btrim(nome)) > 0),
  documento_tipo text CHECK (documento_tipo IN ('cpf', 'rg', 'cnh', 'passaporte', 'outro')),
  -- guardado sem pontuação (CPF só dígitos; os demais em maiúsculas, letras e números)
  documento_numero text,
  nacionalidade text NOT NULL DEFAULT 'Brasileira',
  data_nascimento date,
  sexo text CHECK (sexo IN ('F', 'M', 'O')),
  profissao text,
  telefone text,
  email text,
  cidade_residencia text,
  estado_residencia text,
  pais_residencia text NOT NULL DEFAULT 'Brasil',
  procedencia text,
  destino text,
  motivo_viagem text CHECK (motivo_viagem IN ('lazer', 'negocios', 'congresso', 'parentes', 'estudos', 'saude', 'religiao', 'compras', 'outro')),
  meio_transporte text CHECK (meio_transporte IN ('aviao', 'automovel', 'onibus', 'navio', 'trem', 'outro')),
  observacoes text,
  cliente_id uuid REFERENCES public.clientes(id),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hs_hospedes_id_tenant_uk UNIQUE (id, tenant_id),
  CONSTRAINT hs_hospedes_documento_ck CHECK ((documento_tipo IS NULL) = (documento_numero IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS hs_hospedes_documento_idx ON public.hs_hospedes (tenant_id, documento_tipo, documento_numero)
  WHERE documento_numero IS NOT NULL;
CREATE INDEX IF NOT EXISTS hs_hospedes_nome_idx ON public.hs_hospedes (tenant_id, lower(nome));

-- ============ acesso: leitura da empresa (e do hotel), escrita só pelas funções ============
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['hs_config', 'hs_tipos_uh', 'hs_uhs', 'hs_tarifas', 'hs_hospedes'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_ler', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id())', t || '_ler', t);
    EXECUTE format('DROP POLICY IF EXISTS salao_restrito ON public.%I', t);
    EXECUTE format('CREATE POLICY salao_restrito ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()))', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_' || t || '_updated', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()', 'trg_' || t || '_updated', t);
  END LOOP;
  -- quem só acessa uma filial só enxerga o cadastro do próprio hotel
  FOREACH t IN ARRAY ARRAY['hs_config', 'hs_tipos_uh', 'hs_uhs'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS filial_restrita ON public.%I', t);
    EXECUTE format('CREATE POLICY filial_restrita ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.pode_filial(filial_id))', t);
  END LOOP;
  DROP POLICY IF EXISTS filial_restrita ON public.hs_tarifas;
  CREATE POLICY filial_restrita ON public.hs_tarifas AS RESTRICTIVE FOR ALL TO authenticated
    USING (public.filial_irrestrita() OR tipo_id IN (SELECT id FROM public.hs_tipos_uh));
END $$;

-- ============ configuração do hotel ============
CREATE OR REPLACE FUNCTION public.hs_config_salvar(p_filial uuid, p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_in time := coalesce(nullif(p_dados ->> 'checkin_hora', '')::time, '14:00');
  v_out time := coalesce(nullif(p_dados ->> 'checkout_hora', '')::time, '12:00');
  v_taxa numeric := round(coalesce(nullif(p_dados ->> 'taxa_turismo_por_hospede_noite', '')::numeric, 0), 2);
  v_tardio boolean := coalesce((p_dados ->> 'cobra_diaria_no_checkout_tardio')::boolean, false);
  v_doc boolean := coalesce((p_dados ->> 'exige_documento_checkin')::boolean, true);
  v_fuso text := coalesce(nullif(btrim(p_dados ->> 'fuso'), ''), 'America/Sao_Paulo');
  v_id uuid;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  PERFORM public._hs_exige_liberado();
  PERFORM public._hs_exige_filial(p_filial);
  IF v_taxa < 0 THEN RAISE EXCEPTION 'A taxa de turismo não pode ser negativa'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_fuso) THEN RAISE EXCEPTION 'Fuso horário inválido'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hs_config:' || p_filial::text, 0));
  INSERT INTO public.hs_config (tenant_id, filial_id, checkin_hora, checkout_hora, taxa_turismo_por_hospede_noite,
                                cobra_diaria_no_checkout_tardio, exige_documento_checkin, fuso)
  VALUES (v_tenant, p_filial, v_in, v_out, v_taxa, v_tardio, v_doc, v_fuso)
  ON CONFLICT (filial_id) DO UPDATE
     SET checkin_hora = EXCLUDED.checkin_hora, checkout_hora = EXCLUDED.checkout_hora,
         taxa_turismo_por_hospede_noite = EXCLUDED.taxa_turismo_por_hospede_noite,
         cobra_diaria_no_checkout_tardio = EXCLUDED.cobra_diaria_no_checkout_tardio,
         exige_documento_checkin = EXCLUDED.exige_documento_checkin, fuso = EXCLUDED.fuso
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.hs_config_salvar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hs_config_salvar(uuid, jsonb) TO authenticated;

-- ============ tipos de acomodação ============
CREATE OR REPLACE FUNCTION public.hs_tipo_uh_salvar(p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_id uuid := nullif(p_dados ->> 'id', '')::uuid;
  v_filial uuid := nullif(p_dados ->> 'filial_id', '')::uuid;
  v_nome text := btrim(coalesce(p_dados ->> 'nome', ''));
  v_ad integer := coalesce(nullif(p_dados ->> 'capacidade_adultos', '')::integer, 2);
  v_cr integer := coalesce(nullif(p_dados ->> 'capacidade_criancas', '')::integer, 0);
  v_ativo boolean := coalesce((p_dados ->> 'ativo')::boolean, true);
  v_como text[] := '{}';
  v_filial_atual uuid;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  PERFORM public._hs_exige_liberado();
  IF v_nome = '' THEN RAISE EXCEPTION 'Informe o nome do tipo de acomodação'; END IF;
  IF v_ad < 1 OR v_ad > 20 THEN RAISE EXCEPTION 'A capacidade de adultos precisa ficar entre 1 e 20'; END IF;
  IF v_cr < 0 OR v_cr > 20 THEN RAISE EXCEPTION 'A capacidade de crianças precisa ficar entre 0 e 20'; END IF;
  IF jsonb_typeof(p_dados -> 'comodidades') = 'array' THEN
    SELECT coalesce(array_agg(DISTINCT btrim(x)) FILTER (WHERE btrim(x) <> ''), '{}') INTO v_como FROM jsonb_array_elements_text(p_dados -> 'comodidades') x;
  END IF;

  IF v_id IS NOT NULL THEN
    SELECT filial_id INTO v_filial_atual FROM public.hs_tipos_uh WHERE id = v_id AND tenant_id = v_tenant;
    IF NOT FOUND THEN RAISE EXCEPTION 'Tipo de acomodação não encontrado'; END IF;
    IF v_filial IS NOT NULL AND v_filial IS DISTINCT FROM v_filial_atual THEN RAISE EXCEPTION 'Não dá para mudar o hotel de um tipo já criado'; END IF;
    v_filial := v_filial_atual;
  END IF;
  PERFORM public._hs_exige_filial(v_filial);
  PERFORM pg_advisory_xact_lock(hashtextextended('hs_tipo:' || v_filial::text, 0));
  IF EXISTS (SELECT 1 FROM public.hs_tipos_uh x WHERE x.filial_id = v_filial AND lower(btrim(x.nome)) = lower(v_nome) AND x.id IS DISTINCT FROM v_id) THEN
    RAISE EXCEPTION 'Já existe um tipo com este nome neste hotel';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.hs_tipos_uh (tenant_id, filial_id, nome, descricao, capacidade_adultos, capacidade_criancas, comodidades, ativo)
    VALUES (v_tenant, v_filial, v_nome, nullif(btrim(p_dados ->> 'descricao'), ''), v_ad, v_cr, v_como, v_ativo)
    RETURNING id INTO v_id;
  ELSE
    -- inativar um tipo que ainda tem acomodação ativa deixaria a UH sem preço nem venda: a gestão inativa as UHs antes
    IF NOT v_ativo AND EXISTS (SELECT 1 FROM public.hs_uhs u WHERE u.tipo_id = v_id AND u.ativo) THEN
      RAISE EXCEPTION 'Inative as acomodações deste tipo antes de inativar o tipo';
    END IF;
    UPDATE public.hs_tipos_uh SET nome = v_nome, descricao = nullif(btrim(p_dados ->> 'descricao'), ''),
           capacidade_adultos = v_ad, capacidade_criancas = v_cr, comodidades = v_como, ativo = v_ativo
     WHERE id = v_id AND tenant_id = v_tenant;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.hs_tipo_uh_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hs_tipo_uh_salvar(jsonb) TO authenticated;

-- ============ acomodações (UH) ============
CREATE OR REPLACE FUNCTION public.hs_uh_salvar(p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_id uuid := nullif(p_dados ->> 'id', '')::uuid;
  v_tipo uuid := nullif(p_dados ->> 'tipo_id', '')::uuid;
  v_numero text := btrim(coalesce(p_dados ->> 'numero', ''));
  v_inter boolean := coalesce((p_dados ->> 'interditada')::boolean, false);
  v_motivo text := nullif(btrim(p_dados ->> 'motivo_interdicao'), '');
  v_ativo boolean := coalesce((p_dados ->> 'ativo')::boolean, true);
  v_filial uuid;
  v_tipo_ativo boolean;
  v_atual public.hs_uhs%ROWTYPE;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  PERFORM public._hs_exige_liberado();
  IF v_numero = '' THEN RAISE EXCEPTION 'Informe o número ou nome da acomodação'; END IF;
  IF length(v_numero) > 20 THEN RAISE EXCEPTION 'O número da acomodação aceita até 20 caracteres'; END IF;
  IF v_inter AND v_motivo IS NULL THEN RAISE EXCEPTION 'Informe o motivo da interdição'; END IF;

  SELECT t.filial_id, t.ativo INTO v_filial, v_tipo_ativo FROM public.hs_tipos_uh t WHERE t.id = v_tipo AND t.tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Escolha o tipo de acomodação'; END IF;
  PERFORM public._hs_exige_filial(v_filial);
  IF v_ativo AND NOT v_tipo_ativo THEN RAISE EXCEPTION 'Este tipo de acomodação está inativo'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hs_uh:' || v_filial::text, 0));
  IF EXISTS (SELECT 1 FROM public.hs_uhs x WHERE x.filial_id = v_filial AND lower(btrim(x.numero)) = lower(v_numero) AND x.id IS DISTINCT FROM v_id) THEN
    RAISE EXCEPTION 'Já existe uma acomodação com este número neste hotel';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.hs_uhs (tenant_id, filial_id, tipo_id, numero, andar, interditada, motivo_interdicao, ativo)
    VALUES (v_tenant, v_filial, v_tipo, v_numero, nullif(btrim(p_dados ->> 'andar'), ''), v_inter, CASE WHEN v_inter THEN v_motivo END, v_ativo)
    RETURNING id INTO v_id;
  ELSE
    SELECT * INTO v_atual FROM public.hs_uhs WHERE id = v_id AND tenant_id = v_tenant FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Acomodação não encontrada'; END IF;
    IF v_atual.filial_id IS DISTINCT FROM v_filial THEN RAISE EXCEPTION 'Não dá para trocar a acomodação de hotel'; END IF;
    -- a migration de reservas reforça esta função: mudar o tipo ou inativar com reserva futura passa a ser recusado
    UPDATE public.hs_uhs SET tipo_id = v_tipo, numero = v_numero, andar = nullif(btrim(p_dados ->> 'andar'), ''),
           interditada = v_inter, motivo_interdicao = CASE WHEN v_inter THEN v_motivo END, ativo = v_ativo
     WHERE id = v_id AND tenant_id = v_tenant;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.hs_uh_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hs_uh_salvar(jsonb) TO authenticated;

-- ============ tarifas ============
CREATE OR REPLACE FUNCTION public.hs_tarifa_salvar(p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_id uuid := nullif(p_dados ->> 'id', '')::uuid;
  v_tipo uuid := nullif(p_dados ->> 'tipo_id', '')::uuid;
  v_nome text := btrim(coalesce(p_dados ->> 'nome', ''));
  v_de date := nullif(p_dados ->> 'vigencia_de', '')::date;
  v_ate date := nullif(p_dados ->> 'vigencia_ate', '')::date;
  v_diaria numeric := round(coalesce(nullif(p_dados ->> 'valor_diaria', '')::numeric, -1), 2);
  v_adulto numeric := round(coalesce(nullif(p_dados ->> 'valor_adulto_extra', '')::numeric, 0), 2);
  v_crianca numeric := round(coalesce(nullif(p_dados ->> 'valor_crianca', '')::numeric, 0), 2);
  v_min integer := coalesce(nullif(p_dados ->> 'minimo_noites', '')::integer, 1);
  v_prio smallint := coalesce(nullif(p_dados ->> 'prioridade', '')::smallint, 0);
  v_ativo boolean := coalesce((p_dados ->> 'ativo')::boolean, true);
  v_dias smallint[] := '{}';
  v_filial uuid;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  PERFORM public._hs_exige_liberado();
  IF v_nome = '' THEN RAISE EXCEPTION 'Informe o nome da tarifa'; END IF;
  IF v_de IS NULL OR v_ate IS NULL THEN RAISE EXCEPTION 'Informe o início e o fim da vigência'; END IF;
  IF v_ate < v_de THEN RAISE EXCEPTION 'O fim da vigência não pode ser antes do início'; END IF;
  IF v_diaria < 0 THEN RAISE EXCEPTION 'Informe o valor da diária'; END IF;
  IF v_adulto < 0 OR v_crianca < 0 THEN RAISE EXCEPTION 'Os valores extras não podem ser negativos'; END IF;
  IF v_min < 1 THEN RAISE EXCEPTION 'O mínimo de noites é 1'; END IF;
  IF jsonb_typeof(p_dados -> 'dias_semana') = 'array' THEN
    SELECT coalesce(array_agg(DISTINCT x::smallint ORDER BY x::smallint), '{}') INTO v_dias FROM jsonb_array_elements_text(p_dados -> 'dias_semana') x;
    IF NOT (v_dias <@ ARRAY[0,1,2,3,4,5,6]::smallint[]) THEN RAISE EXCEPTION 'Dia da semana inválido (use 0 = domingo até 6 = sábado)'; END IF;
  END IF;

  SELECT t.filial_id INTO v_filial FROM public.hs_tipos_uh t WHERE t.id = v_tipo AND t.tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Escolha o tipo de acomodação'; END IF;
  PERFORM public._hs_exige_filial(v_filial);
  PERFORM pg_advisory_xact_lock(hashtextextended('hs_tarifa:' || v_tipo::text, 0));

  IF v_id IS NULL THEN
    INSERT INTO public.hs_tarifas (tenant_id, tipo_id, nome, vigencia_de, vigencia_ate, dias_semana, valor_diaria, valor_adulto_extra,
                                   valor_crianca, minimo_noites, prioridade, ativo)
    VALUES (v_tenant, v_tipo, v_nome, v_de, v_ate, v_dias, v_diaria, v_adulto, v_crianca, v_min, v_prio, v_ativo)
    RETURNING id INTO v_id;
  ELSE
    -- o tipo da tarifa não muda: reserva e simulador dependem dele
    UPDATE public.hs_tarifas SET nome = v_nome, vigencia_de = v_de, vigencia_ate = v_ate, dias_semana = v_dias, valor_diaria = v_diaria,
           valor_adulto_extra = v_adulto, valor_crianca = v_crianca, minimo_noites = v_min, prioridade = v_prio, ativo = v_ativo
     WHERE id = v_id AND tenant_id = v_tenant AND tipo_id = v_tipo;
    IF NOT FOUND THEN RAISE EXCEPTION 'Tarifa não encontrada'; END IF;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.hs_tarifa_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hs_tarifa_salvar(jsonb) TO authenticated;

-- Remover não altera reservas já feitas (elas guardam o preço de cada noite em hs_diarias, na migration de reservas).
CREATE OR REPLACE FUNCTION public.hs_tarifa_remover(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_filial uuid;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  PERFORM public._hs_exige_liberado();
  SELECT t.filial_id INTO v_filial FROM public.hs_tarifas f JOIN public.hs_tipos_uh t ON t.id = f.tipo_id
   WHERE f.id = p_id AND f.tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Tarifa não encontrada'; END IF;
  PERFORM public._hs_exige_filial(v_filial);
  DELETE FROM public.hs_tarifas WHERE id = p_id AND tenant_id = public.current_tenant_id();
END $$;
REVOKE ALL ON FUNCTION public.hs_tarifa_remover(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hs_tarifa_remover(uuid) TO authenticated;

-- Tarifa que vale para a noite: espelho de escolherTarifa em src/lib/hotelaria.ts.
-- Maior prioridade; empate: menor vigência (menos dias), depois a que começou mais tarde, depois o id (resultado sempre o mesmo).
CREATE OR REPLACE FUNCTION public._hs_tarifa(p_tipo uuid, p_noite date)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT f.id FROM public.hs_tarifas f
   WHERE f.tipo_id = p_tipo AND f.ativo AND p_noite BETWEEN f.vigencia_de AND f.vigencia_ate
     AND (cardinality(f.dias_semana) = 0 OR extract(dow FROM p_noite)::smallint = ANY (f.dias_semana))
   ORDER BY f.prioridade DESC, (f.vigencia_ate - f.vigencia_de) ASC, f.vigencia_de DESC, f.id
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION public._hs_tarifa(uuid, date) FROM PUBLIC, anon, authenticated;

-- ============ hóspedes ============
-- A recepção também cadastra. Documento CPF é conferido pelos dígitos; os demais só pela duplicidade.
CREATE OR REPLACE FUNCTION public.hs_hospede_salvar(p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_id uuid := nullif(p_dados ->> 'id', '')::uuid;
  v_nome text := btrim(coalesce(p_dados ->> 'nome', ''));
  v_dtipo text := nullif(btrim(p_dados ->> 'documento_tipo'), '');
  v_dnum text := nullif(btrim(p_dados ->> 'documento_numero'), '');
  v_nasc date := nullif(p_dados ->> 'data_nascimento', '')::date;
  v_sexo text := nullif(btrim(p_dados ->> 'sexo'), '');
  v_motivo text := nullif(btrim(p_dados ->> 'motivo_viagem'), '');
  v_meio text := nullif(btrim(p_dados ->> 'meio_transporte'), '');
  v_cliente uuid := nullif(p_dados ->> 'cliente_id', '')::uuid;
  v_email text := nullif(btrim(p_dados ->> 'email'), '');
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._hs_exige_liberado();
  IF v_nome = '' THEN RAISE EXCEPTION 'Informe o nome do hóspede'; END IF;
  IF (v_dtipo IS NULL) <> (v_dnum IS NULL) THEN RAISE EXCEPTION 'Informe o tipo e o número do documento (ou deixe os dois em branco)'; END IF;
  IF v_dtipo IS NOT NULL THEN
    IF v_dtipo NOT IN ('cpf', 'rg', 'cnh', 'passaporte', 'outro') THEN RAISE EXCEPTION 'Tipo de documento inválido'; END IF;
    IF v_dtipo = 'cpf' THEN
      v_dnum := regexp_replace(v_dnum, '\D', '', 'g');
      IF NOT public._hs_cpf_valido(v_dnum) THEN RAISE EXCEPTION 'CPF inválido. Confira os números'; END IF;
    ELSE
      v_dnum := upper(regexp_replace(v_dnum, '[^0-9A-Za-z]', '', 'g'));
      IF length(v_dnum) < 3 THEN RAISE EXCEPTION 'Número do documento muito curto'; END IF;
    END IF;
    IF EXISTS (SELECT 1 FROM public.hs_hospedes x WHERE x.tenant_id = v_tenant AND x.documento_tipo = v_dtipo AND x.documento_numero = v_dnum
                  AND x.id IS DISTINCT FROM v_id) THEN
      RAISE EXCEPTION 'Já existe um hóspede com este documento';
    END IF;
  END IF;
  IF v_nasc IS NOT NULL AND (v_nasc > current_date OR v_nasc < date '1900-01-01') THEN RAISE EXCEPTION 'Data de nascimento inválida'; END IF;
  IF v_sexo IS NOT NULL AND v_sexo NOT IN ('F', 'M', 'O') THEN RAISE EXCEPTION 'Sexo inválido (F, M ou O)'; END IF;
  IF v_motivo IS NOT NULL AND v_motivo NOT IN ('lazer', 'negocios', 'congresso', 'parentes', 'estudos', 'saude', 'religiao', 'compras', 'outro') THEN
    RAISE EXCEPTION 'Motivo da viagem inválido';
  END IF;
  IF v_meio IS NOT NULL AND v_meio NOT IN ('aviao', 'automovel', 'onibus', 'navio', 'trem', 'outro') THEN RAISE EXCEPTION 'Meio de transporte inválido'; END IF;
  IF v_email IS NOT NULL AND v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'E-mail inválido'; END IF;
  IF v_cliente IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.clientes c WHERE c.id = v_cliente AND c.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Cliente não encontrado';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.hs_hospedes (tenant_id, nome, documento_tipo, documento_numero, nacionalidade, data_nascimento, sexo, profissao, telefone, email,
                                    cidade_residencia, estado_residencia, pais_residencia, procedencia, destino, motivo_viagem, meio_transporte,
                                    observacoes, cliente_id, ativo)
    VALUES (v_tenant, v_nome, v_dtipo, v_dnum, coalesce(nullif(btrim(p_dados ->> 'nacionalidade'), ''), 'Brasileira'), v_nasc, v_sexo,
            nullif(btrim(p_dados ->> 'profissao'), ''), nullif(btrim(p_dados ->> 'telefone'), ''), v_email,
            nullif(btrim(p_dados ->> 'cidade_residencia'), ''), upper(nullif(btrim(p_dados ->> 'estado_residencia'), '')),
            coalesce(nullif(btrim(p_dados ->> 'pais_residencia'), ''), 'Brasil'), nullif(btrim(p_dados ->> 'procedencia'), ''),
            nullif(btrim(p_dados ->> 'destino'), ''), v_motivo, v_meio, nullif(btrim(p_dados ->> 'observacoes'), ''), v_cliente,
            coalesce((p_dados ->> 'ativo')::boolean, true))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.hs_hospedes SET nome = v_nome, documento_tipo = v_dtipo, documento_numero = v_dnum,
           nacionalidade = coalesce(nullif(btrim(p_dados ->> 'nacionalidade'), ''), 'Brasileira'), data_nascimento = v_nasc, sexo = v_sexo,
           profissao = nullif(btrim(p_dados ->> 'profissao'), ''), telefone = nullif(btrim(p_dados ->> 'telefone'), ''), email = v_email,
           cidade_residencia = nullif(btrim(p_dados ->> 'cidade_residencia'), ''),
           estado_residencia = upper(nullif(btrim(p_dados ->> 'estado_residencia'), '')),
           pais_residencia = coalesce(nullif(btrim(p_dados ->> 'pais_residencia'), ''), 'Brasil'),
           procedencia = nullif(btrim(p_dados ->> 'procedencia'), ''), destino = nullif(btrim(p_dados ->> 'destino'), ''),
           motivo_viagem = v_motivo, meio_transporte = v_meio, observacoes = nullif(btrim(p_dados ->> 'observacoes'), ''),
           cliente_id = v_cliente, ativo = coalesce((p_dados ->> 'ativo')::boolean, true)
     WHERE id = v_id AND tenant_id = v_tenant;
    IF NOT FOUND THEN RAISE EXCEPTION 'Hóspede não encontrado'; END IF;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.hs_hospede_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hs_hospede_salvar(jsonb) TO authenticated;
