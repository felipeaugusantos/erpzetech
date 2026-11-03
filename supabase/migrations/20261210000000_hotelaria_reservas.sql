-- Hotelaria (Fase 1, migration 2): reservas, calendário de ocupação (trava de overbooking no banco), cotação, disponibilidade,
-- alterar, trocar de acomodação, cancelar, não comparecimento e interdição por período.
-- A reserva do balcão escolhe a acomodação na hora; a coluna uh_id aceita nulo para as reservas de canais (Fase 4).
-- Sinal, conta do hóspede, check-in e check-out vêm nas próximas migrations. Especificação: docs/hotelaria-fase-1.md.
-- Pode ser rodado de novo sem erro (tabelas, funções, políticas e gatilhos são refeitos). Rode antes 20261209000000_hotelaria_base.sql.

-- ============ calendário: duas ocupações da mesma acomodação não podem se cruzar ============
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
    CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;
  ELSE
    CREATE EXTENSION IF NOT EXISTS btree_gist;
  END IF;
END $$;

-- ============ ajustes no cadastro da migration anterior ============
-- Quantas pessoas a diária já inclui; o adulto além disso paga o extra da tarifa.
ALTER TABLE public.hs_tarifas ADD COLUMN IF NOT EXISTS pessoas_incluidas smallint NOT NULL DEFAULT 2;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hs_tarifas_pessoas_ck' AND conrelid = 'public.hs_tarifas'::regclass) THEN
    ALTER TABLE public.hs_tarifas ADD CONSTRAINT hs_tarifas_pessoas_ck CHECK (pessoas_incluidas BETWEEN 1 AND 20);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hs_uhs_id_filial_uk' AND conrelid = 'public.hs_uhs'::regclass) THEN
    ALTER TABLE public.hs_uhs ADD CONSTRAINT hs_uhs_id_filial_uk UNIQUE (id, filial_id);
  END IF;
END $$;

-- "Hoje" no fuso do hotel (configuração do hotel; sem configuração vale o horário de Brasília).
CREATE OR REPLACE FUNCTION public._hs_hoje(p_filial uuid) RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public AS $$
  SELECT (now() AT TIME ZONE coalesce((SELECT c.fuso FROM public.hs_config c WHERE c.filial_id = p_filial), 'America/Sao_Paulo'))::date
$$;
REVOKE ALL ON FUNCTION public._hs_hoje(uuid) FROM PUBLIC, anon, authenticated;

-- ============ tabelas ============
CREATE TABLE IF NOT EXISTS public.hs_reservas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  filial_id uuid NOT NULL,
  -- sequencial por empresa, como as comandas
  numero bigint NOT NULL,
  titular_id uuid NOT NULL,
  pagador_cliente_id uuid REFERENCES public.clientes(id),
  origem text NOT NULL DEFAULT 'balcao' CHECK (origem IN ('balcao', 'telefone', 'whatsapp', 'email', 'outro')),
  situacao text NOT NULL DEFAULT 'confirmada' CHECK (situacao IN ('pendente', 'confirmada', 'hospedada', 'finalizada', 'cancelada', 'no_show')),
  observacoes text,
  motivo_cancelamento text,
  cancelada_em timestamptz,
  chave_idempotencia uuid,
  criada_por uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hs_reservas_filial_fk FOREIGN KEY (filial_id, tenant_id) REFERENCES public.filiais (id, tenant_id),
  CONSTRAINT hs_reservas_titular_fk FOREIGN KEY (titular_id, tenant_id) REFERENCES public.hs_hospedes (id, tenant_id),
  CONSTRAINT hs_reservas_id_tenant_uk UNIQUE (id, tenant_id),
  CONSTRAINT hs_reservas_id_filial_uk UNIQUE (id, filial_id),
  CONSTRAINT hs_reservas_numero_uk UNIQUE (tenant_id, numero)
);
CREATE UNIQUE INDEX IF NOT EXISTS hs_reservas_chave_idx ON public.hs_reservas (tenant_id, chave_idempotencia) WHERE chave_idempotencia IS NOT NULL;
CREATE INDEX IF NOT EXISTS hs_reservas_filial_idx ON public.hs_reservas (filial_id, situacao, created_at DESC);
CREATE INDEX IF NOT EXISTS hs_reservas_titular_idx ON public.hs_reservas (titular_id);

-- Uma linha por quarto reservado (reserva de dois quartos = duas linhas).
CREATE TABLE IF NOT EXISTS public.hs_reserva_uhs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  filial_id uuid NOT NULL,
  reserva_id uuid NOT NULL,
  tipo_id uuid NOT NULL,
  uh_id uuid,
  entrada date NOT NULL,
  saida date NOT NULL,
  adultos integer NOT NULL DEFAULT 2 CHECK (adultos >= 1),
  criancas integer NOT NULL DEFAULT 0 CHECK (criancas >= 0),
  situacao text NOT NULL DEFAULT 'reservada' CHECK (situacao IN ('reservada', 'hospedada', 'finalizada', 'cancelada', 'no_show')),
  checkin_em timestamptz,
  checkout_em timestamptz,
  -- nulo = preço da tarifa; preenchido = total negociado pela gestão, rateado entre as noites
  valor_acordado_total numeric(14,2) CHECK (valor_acordado_total >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hs_reserva_uhs_datas_ck CHECK (saida > entrada),
  CONSTRAINT hs_reserva_uhs_filial_fk FOREIGN KEY (filial_id, tenant_id) REFERENCES public.filiais (id, tenant_id),
  -- reserva, tipo e acomodação são sempre do mesmo hotel
  CONSTRAINT hs_reserva_uhs_reserva_fk FOREIGN KEY (reserva_id, filial_id) REFERENCES public.hs_reservas (id, filial_id),
  CONSTRAINT hs_reserva_uhs_tipo_fk FOREIGN KEY (tipo_id, filial_id) REFERENCES public.hs_tipos_uh (id, filial_id),
  CONSTRAINT hs_reserva_uhs_uh_fk FOREIGN KEY (uh_id, filial_id) REFERENCES public.hs_uhs (id, filial_id),
  CONSTRAINT hs_reserva_uhs_id_tenant_uk UNIQUE (id, tenant_id),
  CONSTRAINT hs_reserva_uhs_id_filial_uk UNIQUE (id, filial_id)
);
CREATE INDEX IF NOT EXISTS hs_reserva_uhs_reserva_idx ON public.hs_reserva_uhs (reserva_id);
CREATE INDEX IF NOT EXISTS hs_reserva_uhs_uh_idx ON public.hs_reserva_uhs (uh_id, entrada, saida);
CREATE INDEX IF NOT EXISTS hs_reserva_uhs_dia_idx ON public.hs_reserva_uhs (filial_id, situacao, entrada, saida);

-- Foto do preço de cada noite no momento da reserva: mudar a tarifa depois não muda reserva já feita.
CREATE TABLE IF NOT EXISTS public.hs_diarias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  reserva_uh_id uuid NOT NULL,
  data date NOT NULL,
  valor numeric(14,2) NOT NULL CHECK (valor >= 0),
  tarifa_id uuid REFERENCES public.hs_tarifas(id) ON DELETE SET NULL,
  lancada boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hs_diarias_reserva_uh_fk FOREIGN KEY (reserva_uh_id, tenant_id) REFERENCES public.hs_reserva_uhs (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT hs_diarias_noite_uk UNIQUE (reserva_uh_id, data)
);

-- O calendário único: reserva e bloqueio moram aqui. O banco recusa duas ocupações da mesma acomodação que se cruzam,
-- mesmo com duas pessoas reservando ao mesmo tempo. Período [entrada, saída): a saída de um é a entrada do próximo.
CREATE TABLE IF NOT EXISTS public.hs_ocupacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  filial_id uuid NOT NULL,
  uh_id uuid NOT NULL,
  periodo daterange NOT NULL,
  origem text NOT NULL CHECK (origem IN ('reserva', 'bloqueio')),
  reserva_uh_id uuid,
  motivo text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hs_ocupacoes_periodo_ck CHECK (NOT isempty(periodo) AND NOT lower_inf(periodo) AND NOT upper_inf(periodo)),
  CONSTRAINT hs_ocupacoes_origem_ck CHECK ((origem = 'reserva') = (reserva_uh_id IS NOT NULL)),
  CONSTRAINT hs_ocupacoes_motivo_ck CHECK (origem <> 'bloqueio' OR length(btrim(coalesce(motivo, ''))) > 0),
  CONSTRAINT hs_ocupacoes_filial_fk FOREIGN KEY (filial_id, tenant_id) REFERENCES public.filiais (id, tenant_id),
  CONSTRAINT hs_ocupacoes_uh_fk FOREIGN KEY (uh_id, filial_id) REFERENCES public.hs_uhs (id, filial_id),
  CONSTRAINT hs_ocupacoes_reserva_uh_fk FOREIGN KEY (reserva_uh_id, filial_id) REFERENCES public.hs_reserva_uhs (id, filial_id),
  CONSTRAINT hs_ocupacoes_sem_cruzar EXCLUDE USING gist (uh_id WITH =, periodo WITH &&)
);
CREATE INDEX IF NOT EXISTS hs_ocupacoes_reserva_uh_idx ON public.hs_ocupacoes (reserva_uh_id);
CREATE INDEX IF NOT EXISTS hs_ocupacoes_filial_idx ON public.hs_ocupacoes (filial_id, origem);

-- Hóspedes do quarto (o titular e os acompanhantes); a gravação é do check-in.
CREATE TABLE IF NOT EXISTS public.hs_reserva_hospedes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  reserva_uh_id uuid NOT NULL,
  hospede_id uuid NOT NULL,
  principal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hs_reserva_hospedes_reserva_uh_fk FOREIGN KEY (reserva_uh_id, tenant_id) REFERENCES public.hs_reserva_uhs (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT hs_reserva_hospedes_hospede_fk FOREIGN KEY (hospede_id, tenant_id) REFERENCES public.hs_hospedes (id, tenant_id),
  CONSTRAINT hs_reserva_hospedes_uk UNIQUE (reserva_uh_id, hospede_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS hs_reserva_hospedes_principal_idx ON public.hs_reserva_hospedes (reserva_uh_id) WHERE principal;
CREATE INDEX IF NOT EXISTS hs_reserva_hospedes_hospede_idx ON public.hs_reserva_hospedes (hospede_id);

-- ============ acesso: leitura da empresa (e do hotel), escrita só pelas funções ============
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['hs_reservas', 'hs_reserva_uhs', 'hs_diarias', 'hs_ocupacoes', 'hs_reserva_hospedes'] LOOP
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
  FOREACH t IN ARRAY ARRAY['hs_reservas', 'hs_reserva_uhs', 'hs_ocupacoes'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS filial_restrita ON public.%I', t);
    EXECUTE format('CREATE POLICY filial_restrita ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.pode_filial(filial_id))', t);
  END LOOP;
  -- filhas: herdam o hotel do quarto da reserva (a consulta já passa pela política do pai)
  FOREACH t IN ARRAY ARRAY['hs_diarias', 'hs_reserva_hospedes'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS filial_restrita ON public.%I', t);
    EXECUTE format($f$CREATE POLICY filial_restrita ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
      USING (public.filial_irrestrita() OR reserva_uh_id IN (SELECT id FROM public.hs_reserva_uhs))$f$, t);
  END LOOP;
END $$;

-- ============ preço da noite ============
-- Diária da tarifa + adulto além das pessoas incluídas × extra + crianças × valor da criança.
-- Espelho de precoDaNoite em src/lib/hotelaria.ts. Sem tarifa para a noite, a venda é recusada (nunca há preço implícito).
CREATE OR REPLACE FUNCTION public._hs_preco_noite(p_tipo uuid, p_noite date, p_adultos integer, p_criancas integer,
                                                  OUT o_valor numeric, OUT o_tarifa uuid, OUT o_minimo integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE t public.hs_tarifas%ROWTYPE;
BEGIN
  o_tarifa := public._hs_tarifa(p_tipo, p_noite);
  IF o_tarifa IS NULL THEN RAISE EXCEPTION 'Sem tarifa para a noite de %', to_char(p_noite, 'DD/MM/YYYY'); END IF;
  SELECT * INTO t FROM public.hs_tarifas WHERE id = o_tarifa;
  o_valor := t.valor_diaria + greatest(p_adultos - t.pessoas_incluidas, 0) * t.valor_adulto_extra + p_criancas * t.valor_crianca;
  o_minimo := t.minimo_noites;
END $$;
REVOKE ALL ON FUNCTION public._hs_preco_noite(uuid, date, integer, integer) FROM PUBLIC, anon, authenticated;

-- O mínimo de noites é o da tarifa da noite de chegada.
CREATE OR REPLACE FUNCTION public._hs_exige_minimo(p_tipo uuid, p_entrada date, p_noites integer) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_min integer;
BEGIN
  SELECT f.minimo_noites INTO v_min FROM public.hs_tarifas f WHERE f.id = public._hs_tarifa(p_tipo, p_entrada);
  IF v_min IS NOT NULL AND p_noites < v_min THEN RAISE EXCEPTION 'A tarifa exige no mínimo % noite(s)', v_min; END IF;
END $$;
REVOKE ALL ON FUNCTION public._hs_exige_minimo(uuid, date, integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._hs_precificar(p_tipo uuid, p_entrada date, p_saida date, p_adultos integer, p_criancas integer)
RETURNS TABLE (noite date, valor numeric, tarifa_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_n integer := p_saida - p_entrada; v_val numeric; v_tar uuid; v_min integer; v_primeira boolean := true; i integer;
BEGIN
  IF p_saida <= p_entrada THEN RAISE EXCEPTION 'A saída precisa ser depois da entrada'; END IF;
  IF v_n > 365 THEN RAISE EXCEPTION 'A estadia não pode passar de 365 noites'; END IF;
  FOR i IN 0 .. v_n - 1 LOOP
    SELECT x.o_valor, x.o_tarifa, x.o_minimo INTO v_val, v_tar, v_min FROM public._hs_preco_noite(p_tipo, p_entrada + i, p_adultos, p_criancas) x;
    IF v_primeira THEN
      IF v_n < v_min THEN RAISE EXCEPTION 'A tarifa exige no mínimo % noite(s)', v_min; END IF;
      v_primeira := false;
    END IF;
    noite := p_entrada + i; valor := v_val; tarifa_id := v_tar;
    RETURN NEXT;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public._hs_precificar(uuid, date, date, integer, integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._hs_exige_capacidade(p_tipo uuid, p_adultos integer, p_criancas integer) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE t public.hs_tipos_uh%ROWTYPE;
BEGIN
  IF p_adultos IS NULL OR p_adultos < 1 THEN RAISE EXCEPTION 'Informe ao menos um adulto'; END IF;
  IF p_criancas IS NULL OR p_criancas < 0 THEN RAISE EXCEPTION 'Quantidade de crianças inválida'; END IF;
  SELECT * INTO t FROM public.hs_tipos_uh WHERE id = p_tipo;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tipo de acomodação não encontrado'; END IF;
  IF p_adultos > t.capacidade_adultos OR p_criancas > t.capacidade_criancas THEN
    RAISE EXCEPTION 'O tipo "%" comporta no máximo % adulto(s) e % criança(s)', t.nome, t.capacidade_adultos, t.capacidade_criancas;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._hs_exige_capacidade(uuid, integer, integer) FROM PUBLIC, anon, authenticated;

-- Grava as diárias do quarto. Total acordado: rateado entre as noites (a sobra de centavos vai para a última).
-- Preservar: mantém o preço das noites que continuam e só cota as novas (mexer na data não reprecifica o resto).
CREATE OR REPLACE FUNCTION public._hs_gravar_diarias(p_ru uuid, p_preservar boolean) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE ru public.hs_reserva_uhs%ROWTYPE; v_n integer; i integer; v_base numeric; v_val numeric; v_tar uuid; v_min integer;
BEGIN
  SELECT * INTO ru FROM public.hs_reserva_uhs WHERE id = p_ru;
  IF EXISTS (SELECT 1 FROM public.hs_diarias WHERE reserva_uh_id = p_ru AND lancada) THEN
    RAISE EXCEPTION 'Há diárias já lançadas neste quarto';
  END IF;
  v_n := ru.saida - ru.entrada;
  IF v_n > 365 THEN RAISE EXCEPTION 'A estadia não pode passar de 365 noites'; END IF;
  IF ru.valor_acordado_total IS NOT NULL THEN
    DELETE FROM public.hs_diarias WHERE reserva_uh_id = p_ru;
    v_base := trunc(ru.valor_acordado_total / v_n, 2);
    FOR i IN 0 .. v_n - 1 LOOP
      INSERT INTO public.hs_diarias (tenant_id, reserva_uh_id, data, valor, tarifa_id)
      VALUES (ru.tenant_id, p_ru, ru.entrada + i, CASE WHEN i = v_n - 1 THEN ru.valor_acordado_total - v_base * (v_n - 1) ELSE v_base END, NULL);
    END LOOP;
  ELSIF p_preservar THEN
    DELETE FROM public.hs_diarias WHERE reserva_uh_id = p_ru AND NOT (data >= ru.entrada AND data < ru.saida);
    PERFORM public._hs_exige_minimo(ru.tipo_id, ru.entrada, v_n);
    FOR i IN 0 .. v_n - 1 LOOP
      IF NOT EXISTS (SELECT 1 FROM public.hs_diarias WHERE reserva_uh_id = p_ru AND data = ru.entrada + i) THEN
        SELECT x.o_valor, x.o_tarifa, x.o_minimo INTO v_val, v_tar, v_min FROM public._hs_preco_noite(ru.tipo_id, ru.entrada + i, ru.adultos, ru.criancas) x;
        INSERT INTO public.hs_diarias (tenant_id, reserva_uh_id, data, valor, tarifa_id) VALUES (ru.tenant_id, p_ru, ru.entrada + i, v_val, v_tar);
      END IF;
    END LOOP;
  ELSE
    DELETE FROM public.hs_diarias WHERE reserva_uh_id = p_ru;
    INSERT INTO public.hs_diarias (tenant_id, reserva_uh_id, data, valor, tarifa_id)
    SELECT ru.tenant_id, p_ru, p.noite, p.valor, p.tarifa_id FROM public._hs_precificar(ru.tipo_id, ru.entrada, ru.saida, ru.adultos, ru.criancas) p;
  END IF;
  RETURN (SELECT coalesce(sum(valor), 0) FROM public.hs_diarias WHERE reserva_uh_id = p_ru);
END $$;
REVOKE ALL ON FUNCTION public._hs_gravar_diarias(uuid, boolean) FROM PUBLIC, anon, authenticated;

-- A situação da reserva é derivada dos quartos; as funções chamam isto depois de mexer neles.
CREATE OR REPLACE FUNCTION public._hs_reserva_recalcular(p_reserva uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE public.hs_reservas r SET situacao = CASE
      WHEN EXISTS (SELECT 1 FROM public.hs_reserva_uhs u WHERE u.reserva_id = r.id AND u.situacao = 'hospedada') THEN 'hospedada'
      WHEN EXISTS (SELECT 1 FROM public.hs_reserva_uhs u WHERE u.reserva_id = r.id AND u.situacao = 'reservada')
        THEN CASE WHEN r.situacao = 'pendente' THEN 'pendente' ELSE 'confirmada' END
      WHEN NOT EXISTS (SELECT 1 FROM public.hs_reserva_uhs u WHERE u.reserva_id = r.id AND u.situacao <> 'cancelada') THEN 'cancelada'
      WHEN NOT EXISTS (SELECT 1 FROM public.hs_reserva_uhs u WHERE u.reserva_id = r.id AND u.situacao NOT IN ('cancelada', 'no_show')) THEN 'no_show'
      ELSE 'finalizada' END
   WHERE r.id = p_reserva;
END $$;
REVOKE ALL ON FUNCTION public._hs_reserva_recalcular(uuid) FROM PUBLIC, anon, authenticated;

-- ============ reforço das funções da migration anterior ============
-- Tarifa com "pessoas incluídas".
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
  v_incl integer := coalesce(nullif(p_dados ->> 'pessoas_incluidas', '')::integer, 2);
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
  IF v_incl < 1 OR v_incl > 20 THEN RAISE EXCEPTION 'As pessoas incluídas na diária precisam ficar entre 1 e 20'; END IF;
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
                                   valor_crianca, minimo_noites, pessoas_incluidas, prioridade, ativo)
    VALUES (v_tenant, v_tipo, v_nome, v_de, v_ate, v_dias, v_diaria, v_adulto, v_crianca, v_min, v_incl, v_prio, v_ativo)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.hs_tarifas SET nome = v_nome, vigencia_de = v_de, vigencia_ate = v_ate, dias_semana = v_dias, valor_diaria = v_diaria,
           valor_adulto_extra = v_adulto, valor_crianca = v_crianca, minimo_noites = v_min, pessoas_incluidas = v_incl,
           prioridade = v_prio, ativo = v_ativo
     WHERE id = v_id AND tenant_id = v_tenant AND tipo_id = v_tipo;
    IF NOT FOUND THEN RAISE EXCEPTION 'Tarifa não encontrada'; END IF;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.hs_tarifa_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hs_tarifa_salvar(jsonb) TO authenticated;

-- Acomodação: mudar o tipo, inativar ou interditar com reserva a partir de hoje passa a ser recusado.
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
  PERFORM pg_advisory_xact_lock(hashtextextended('hs_cal:' || v_filial::text, 0));
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
    IF (v_atual.tipo_id IS DISTINCT FROM v_tipo OR (v_atual.ativo AND NOT v_ativo) OR (NOT v_atual.interditada AND v_inter))
       AND EXISTS (SELECT 1 FROM public.hs_ocupacoes o WHERE o.uh_id = v_id AND o.origem = 'reserva' AND upper(o.periodo) > public._hs_hoje(v_filial)) THEN
      RAISE EXCEPTION 'Esta acomodação tem reserva a partir de hoje: remaneje as reservas antes';
    END IF;
    UPDATE public.hs_uhs SET tipo_id = v_tipo, numero = v_numero, andar = nullif(btrim(p_dados ->> 'andar'), ''),
           interditada = v_inter, motivo_interdicao = CASE WHEN v_inter THEN v_motivo END, ativo = v_ativo
     WHERE id = v_id AND tenant_id = v_tenant;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.hs_uh_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hs_uh_salvar(jsonb) TO authenticated;

-- ============ consultas: cotação e disponibilidade ============
CREATE OR REPLACE FUNCTION public.hs_cotar(p_filial uuid, p_tipo uuid, p_entrada date, p_saida date, p_adultos integer DEFAULT 2, p_criancas integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_r jsonb;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._hs_exige_liberado();
  PERFORM public._hs_exige_filial(p_filial);
  IF p_entrada IS NULL OR p_saida IS NULL THEN RAISE EXCEPTION 'Informe a entrada e a saída'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.hs_tipos_uh t WHERE t.id = p_tipo AND t.filial_id = p_filial AND t.tenant_id = public.current_tenant_id() AND t.ativo) THEN
    RAISE EXCEPTION 'Tipo de acomodação não encontrado';
  END IF;
  PERFORM public._hs_exige_capacidade(p_tipo, p_adultos, p_criancas);
  SELECT jsonb_build_object('quantidade', count(*), 'total', sum(p.valor),
           'noites', jsonb_agg(jsonb_build_object('data', p.noite, 'valor', p.valor, 'tarifa_id', p.tarifa_id) ORDER BY p.noite))
    INTO v_r FROM public._hs_precificar(p_tipo, p_entrada, p_saida, p_adultos, p_criancas) p;
  RETURN v_r;
END $$;
REVOKE ALL ON FUNCTION public.hs_cotar(uuid, uuid, date, date, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hs_cotar(uuid, uuid, date, date, integer, integer) TO authenticated;

-- Por tipo: acomodações vendáveis, bloqueadas e ocupadas no período e o que sobra. Conservador: uma acomodação com qualquer noite
-- ocupada no período não conta como livre, e cada reserva do tipo ainda sem acomodação tira uma da conta.
CREATE OR REPLACE FUNCTION public.hs_disponibilidade(p_filial uuid, p_entrada date, p_saida date, p_adultos integer DEFAULT 2, p_criancas integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_per daterange;
  r record;
  v_out jsonb := '[]'::jsonb;
  v_total integer; v_bloq integer; v_ocup integer; v_sem integer; v_disp integer;
  v_preco numeric; v_erro text;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._hs_exige_liberado();
  PERFORM public._hs_exige_filial(p_filial);
  IF p_entrada IS NULL OR p_saida IS NULL OR p_saida <= p_entrada THEN RAISE EXCEPTION 'A saída precisa ser depois da entrada'; END IF;
  v_per := daterange(p_entrada, p_saida, '[)');
  FOR r IN SELECT t.id, t.nome, t.capacidade_adultos, t.capacidade_criancas FROM public.hs_tipos_uh t
            WHERE t.filial_id = p_filial AND t.tenant_id = v_tenant AND t.ativo ORDER BY t.nome LOOP
    SELECT count(*),
           count(*) FILTER (WHERE b),
           count(*) FILTER (WHERE o AND NOT b)
      INTO v_total, v_bloq, v_ocup
      FROM (SELECT EXISTS (SELECT 1 FROM public.hs_ocupacoes x WHERE x.uh_id = u.id AND x.origem = 'bloqueio' AND x.periodo && v_per) AS b,
                   EXISTS (SELECT 1 FROM public.hs_ocupacoes x WHERE x.uh_id = u.id AND x.origem = 'reserva' AND x.periodo && v_per) AS o
              FROM public.hs_uhs u WHERE u.tipo_id = r.id AND u.ativo AND NOT u.interditada) z;
    SELECT count(*) INTO v_sem FROM public.hs_reserva_uhs ru
     WHERE ru.tipo_id = r.id AND ru.uh_id IS NULL AND ru.situacao = 'reservada' AND ru.entrada < p_saida AND ru.saida > p_entrada;
    v_disp := greatest(v_total - v_bloq - v_ocup - v_sem, 0);
    v_preco := NULL; v_erro := NULL;
    IF p_adultos <= r.capacidade_adultos AND p_criancas <= r.capacidade_criancas THEN
      BEGIN
        SELECT sum(p.valor) INTO v_preco FROM public._hs_precificar(r.id, p_entrada, p_saida, p_adultos, p_criancas) p;
      EXCEPTION WHEN OTHERS THEN
        v_erro := SQLERRM;
      END;
    ELSE
      v_erro := 'Acima da capacidade do tipo';
    END IF;
    v_out := v_out || jsonb_build_object('tipo_id', r.id, 'nome', r.nome, 'total', v_total, 'bloqueadas', v_bloq, 'ocupadas', v_ocup,
                                         'sem_acomodacao', v_sem, 'disponiveis', v_disp, 'preco_total', v_preco, 'motivo_sem_preco', v_erro);
  END LOOP;
  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.hs_disponibilidade(uuid, date, date, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hs_disponibilidade(uuid, date, date, integer, integer) TO authenticated;

-- Acomodações livres em todo o período (para escolher o quarto na reserva).
CREATE OR REPLACE FUNCTION public.hs_uhs_livres(p_filial uuid, p_entrada date, p_saida date, p_tipo uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_r jsonb;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._hs_exige_liberado();
  PERFORM public._hs_exige_filial(p_filial);
  IF p_entrada IS NULL OR p_saida IS NULL OR p_saida <= p_entrada THEN RAISE EXCEPTION 'A saída precisa ser depois da entrada'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'numero', u.numero, 'andar', u.andar, 'tipo_id', t.id, 'tipo', t.nome,
                                               'situacao_limpeza', u.situacao_limpeza) ORDER BY u.numero), '[]'::jsonb)
    INTO v_r
    FROM public.hs_uhs u JOIN public.hs_tipos_uh t ON t.id = u.tipo_id
   WHERE u.filial_id = p_filial AND u.tenant_id = public.current_tenant_id() AND u.ativo AND NOT u.interditada AND t.ativo
     AND (p_tipo IS NULL OR u.tipo_id = p_tipo)
     AND NOT EXISTS (SELECT 1 FROM public.hs_ocupacoes o WHERE o.uh_id = u.id AND o.periodo && daterange(p_entrada, p_saida, '[)'));
  RETURN v_r;
END $$;
REVOKE ALL ON FUNCTION public.hs_uhs_livres(uuid, date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hs_uhs_livres(uuid, date, date, uuid) TO authenticated;

-- ============ reservas ============
-- Dados: filial_id, titular_id, pagador_cliente_id?, origem?, situacao? (pendente | confirmada), observacoes?,
--        quartos: [{ uh_id, entrada, saida, adultos, criancas?, valor_acordado_total? }].
-- Atômica: se um quarto falha, nada é gravado. Repetir a chamada com a mesma chave devolve a mesma reserva.
CREATE OR REPLACE FUNCTION public.hs_reserva_criar(p_dados jsonb, p_chave uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_filial uuid := nullif(p_dados ->> 'filial_id', '')::uuid;
  v_titular uuid := nullif(p_dados ->> 'titular_id', '')::uuid;
  v_pagador uuid := nullif(p_dados ->> 'pagador_cliente_id', '')::uuid;
  v_origem text := coalesce(nullif(btrim(p_dados ->> 'origem'), ''), 'balcao');
  v_sit text := coalesce(nullif(btrim(p_dados ->> 'situacao'), ''), 'confirmada');
  v_gestao boolean := public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor');
  v_hoje date;
  q jsonb; v_uh public.hs_uhs%ROWTYPE;
  v_entrada date; v_saida date; v_ad integer; v_cr integer; v_acordo numeric;
  v_res uuid; v_numero bigint; v_ru uuid; v_exist public.hs_reservas%ROWTYPE; v_qtd integer := 0;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._hs_exige_liberado();
  PERFORM public._hs_exige_filial(v_filial);
  IF v_origem NOT IN ('balcao', 'telefone', 'whatsapp', 'email', 'outro') THEN RAISE EXCEPTION 'Origem da reserva inválida'; END IF;
  IF v_sit NOT IN ('pendente', 'confirmada') THEN RAISE EXCEPTION 'A reserva nasce pendente ou confirmada'; END IF;
  IF jsonb_typeof(p_dados -> 'quartos') IS DISTINCT FROM 'array' OR jsonb_array_length(p_dados -> 'quartos') NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'Informe de 1 a 20 quartos';
  END IF;
  IF v_titular IS NULL OR NOT EXISTS (SELECT 1 FROM public.hs_hospedes h WHERE h.id = v_titular AND h.tenant_id = v_tenant AND h.ativo) THEN
    RAISE EXCEPTION 'Escolha o hóspede titular';
  END IF;
  IF v_pagador IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.clientes c WHERE c.id = v_pagador AND c.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Cliente pagador não encontrado';
  END IF;

  -- um calendário por hotel: quem reserva ou mexe no calendário espera a vez (a restrição do banco é a última barreira)
  PERFORM pg_advisory_xact_lock(hashtextextended('hs_cal:' || v_filial::text, 0));
  IF p_chave IS NOT NULL THEN
    SELECT * INTO v_exist FROM public.hs_reservas WHERE tenant_id = v_tenant AND chave_idempotencia = p_chave;
    IF FOUND THEN
      RETURN jsonb_build_object('reserva_id', v_exist.id, 'numero', v_exist.numero, 'repetido', true,
        'total', (SELECT coalesce(sum(d.valor), 0) FROM public.hs_diarias d JOIN public.hs_reserva_uhs ru ON ru.id = d.reserva_uh_id WHERE ru.reserva_id = v_exist.id));
    END IF;
  END IF;

  v_hoje := public._hs_hoje(v_filial);
  PERFORM pg_advisory_xact_lock(hashtextextended('hs_num:' || v_tenant::text, 0));
  SELECT coalesce(max(numero), 0) + 1 INTO v_numero FROM public.hs_reservas WHERE tenant_id = v_tenant;
  INSERT INTO public.hs_reservas (tenant_id, filial_id, numero, titular_id, pagador_cliente_id, origem, situacao, observacoes, chave_idempotencia)
  VALUES (v_tenant, v_filial, v_numero, v_titular, v_pagador, v_origem, v_sit, nullif(btrim(p_dados ->> 'observacoes'), ''), p_chave)
  RETURNING id INTO v_res;

  FOR q IN SELECT e FROM jsonb_array_elements(p_dados -> 'quartos') e LOOP
    v_entrada := nullif(q ->> 'entrada', '')::date;
    v_saida := nullif(q ->> 'saida', '')::date;
    v_ad := coalesce(nullif(q ->> 'adultos', '')::integer, 2);
    v_cr := coalesce(nullif(q ->> 'criancas', '')::integer, 0);
    v_acordo := nullif(q ->> 'valor_acordado_total', '')::numeric;
    IF v_entrada IS NULL OR v_saida IS NULL THEN RAISE EXCEPTION 'Informe a entrada e a saída de cada quarto'; END IF;
    IF v_saida <= v_entrada THEN RAISE EXCEPTION 'A saída precisa ser depois da entrada'; END IF;
    IF v_saida - v_entrada > 365 THEN RAISE EXCEPTION 'A estadia não pode passar de 365 noites'; END IF;
    IF v_entrada < v_hoje AND NOT v_gestao THEN RAISE EXCEPTION 'A entrada já passou: só a gestão registra reserva com data passada'; END IF;
    IF v_acordo IS NOT NULL AND NOT v_gestao THEN RAISE EXCEPTION 'O valor acordado só pode ser dado pela gestão'; END IF;
    IF v_acordo IS NOT NULL AND v_acordo < 0 THEN RAISE EXCEPTION 'O valor acordado não pode ser negativo'; END IF;

    SELECT u.* INTO v_uh FROM public.hs_uhs u JOIN public.hs_tipos_uh t ON t.id = u.tipo_id
     WHERE u.id = nullif(q ->> 'uh_id', '')::uuid AND u.tenant_id = v_tenant AND u.filial_id = v_filial AND u.ativo AND NOT u.interditada AND t.ativo;
    IF NOT FOUND THEN RAISE EXCEPTION 'Escolha uma acomodação disponível para venda'; END IF;
    IF nullif(q ->> 'tipo_id', '') IS NOT NULL AND (q ->> 'tipo_id')::uuid IS DISTINCT FROM v_uh.tipo_id THEN
      RAISE EXCEPTION 'A acomodação % não é do tipo escolhido', v_uh.numero;
    END IF;
    PERFORM public._hs_exige_capacidade(v_uh.tipo_id, v_ad, v_cr);
    IF EXISTS (SELECT 1 FROM public.hs_ocupacoes o WHERE o.uh_id = v_uh.id AND o.periodo && daterange(v_entrada, v_saida, '[)')) THEN
      RAISE EXCEPTION 'A acomodação % não está livre de % a %', v_uh.numero, to_char(v_entrada, 'DD/MM/YYYY'), to_char(v_saida, 'DD/MM/YYYY');
    END IF;

    INSERT INTO public.hs_reserva_uhs (tenant_id, filial_id, reserva_id, tipo_id, uh_id, entrada, saida, adultos, criancas, valor_acordado_total)
    VALUES (v_tenant, v_filial, v_res, v_uh.tipo_id, v_uh.id, v_entrada, v_saida, v_ad, v_cr, round(v_acordo, 2))
    RETURNING id INTO v_ru;
    PERFORM public._hs_gravar_diarias(v_ru, false);
    BEGIN
      INSERT INTO public.hs_ocupacoes (tenant_id, filial_id, uh_id, periodo, origem, reserva_uh_id)
      VALUES (v_tenant, v_filial, v_uh.id, daterange(v_entrada, v_saida, '[)'), 'reserva', v_ru);
    EXCEPTION WHEN exclusion_violation THEN
      RAISE EXCEPTION 'A acomodação % acabou de ser reservada para este período', v_uh.numero;
    END;
    v_qtd := v_qtd + 1;
  END LOOP;

  RETURN jsonb_build_object('reserva_id', v_res, 'numero', v_numero, 'quartos', v_qtd, 'repetido', false,
    'total', (SELECT coalesce(sum(d.valor), 0) FROM public.hs_diarias d JOIN public.hs_reserva_uhs ru ON ru.id = d.reserva_uh_id WHERE ru.reserva_id = v_res));
END $$;
REVOKE ALL ON FUNCTION public.hs_reserva_criar(jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hs_reserva_criar(jsonb, uuid) TO authenticated;

-- Dados da reserva (não dos quartos): titular, pagador, origem e observações.
CREATE OR REPLACE FUNCTION public.hs_reserva_alterar(p_id uuid, p_dados jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  r public.hs_reservas%ROWTYPE;
  v_titular uuid; v_pagador uuid; v_origem text; v_obs text;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._hs_exige_liberado();
  SELECT * INTO r FROM public.hs_reservas WHERE id = p_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reserva não encontrada'; END IF;
  PERFORM public._hs_exige_filial(r.filial_id);
  IF r.situacao IN ('cancelada', 'finalizada', 'no_show') THEN RAISE EXCEPTION 'Esta reserva está encerrada (%)', r.situacao; END IF;
  v_titular := CASE WHEN p_dados ? 'titular_id' THEN nullif(p_dados ->> 'titular_id', '')::uuid ELSE r.titular_id END;
  v_pagador := CASE WHEN p_dados ? 'pagador_cliente_id' THEN nullif(p_dados ->> 'pagador_cliente_id', '')::uuid ELSE r.pagador_cliente_id END;
  v_origem := CASE WHEN p_dados ? 'origem' THEN btrim(p_dados ->> 'origem') ELSE r.origem END;
  v_obs := CASE WHEN p_dados ? 'observacoes' THEN nullif(btrim(p_dados ->> 'observacoes'), '') ELSE r.observacoes END;
  IF v_titular IS NULL OR NOT EXISTS (SELECT 1 FROM public.hs_hospedes h WHERE h.id = v_titular AND h.tenant_id = v_tenant AND h.ativo) THEN
    RAISE EXCEPTION 'Escolha o hóspede titular';
  END IF;
  IF v_pagador IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.clientes c WHERE c.id = v_pagador AND c.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Cliente pagador não encontrado';
  END IF;
  IF v_origem NOT IN ('balcao', 'telefone', 'whatsapp', 'email', 'outro') THEN RAISE EXCEPTION 'Origem da reserva inválida'; END IF;
  UPDATE public.hs_reservas SET titular_id = v_titular, pagador_cliente_id = v_pagador, origem = v_origem, observacoes = v_obs WHERE id = p_id;
END $$;
REVOKE ALL ON FUNCTION public.hs_reserva_alterar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hs_reserva_alterar(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.hs_reserva_confirmar(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE r public.hs_reservas%ROWTYPE;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._hs_exige_liberado();
  SELECT * INTO r FROM public.hs_reservas WHERE id = p_id AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reserva não encontrada'; END IF;
  PERFORM public._hs_exige_filial(r.filial_id);
  IF r.situacao = 'confirmada' THEN RETURN; END IF;
  IF r.situacao <> 'pendente' THEN RAISE EXCEPTION 'Só reserva pendente pode ser confirmada (situação atual: %)', r.situacao; END IF;
  UPDATE public.hs_reservas SET situacao = 'confirmada' WHERE id = p_id;
END $$;
REVOKE ALL ON FUNCTION public.hs_reserva_confirmar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hs_reserva_confirmar(uuid) TO authenticated;

-- Muda datas, pessoas ou o total acordado de um quarto que ainda não foi ocupado. Dados (todos opcionais): entrada, saida, adultos,
-- criancas, valor_acordado_total (presente e vazio = voltar para a tarifa). Mexer só nas datas mantém o preço das noites que continuam
-- e cota as novas; mudar as pessoas recota todas.
CREATE OR REPLACE FUNCTION public.hs_reserva_uh_alterar(p_reserva_uh uuid, p_dados jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_gestao boolean := public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor');
  ru public.hs_reserva_uhs%ROWTYPE;
  v_entrada date; v_saida date; v_ad integer; v_cr integer; v_acordo numeric; v_hoje date; v_total numeric;
  v_tem_acordo boolean := p_dados ? 'valor_acordado_total';
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._hs_exige_liberado();
  SELECT * INTO ru FROM public.hs_reserva_uhs WHERE id = p_reserva_uh AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quarto da reserva não encontrado'; END IF;
  PERFORM public._hs_exige_filial(ru.filial_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('hs_cal:' || ru.filial_id::text, 0));
  SELECT * INTO ru FROM public.hs_reserva_uhs WHERE id = p_reserva_uh FOR UPDATE;
  IF ru.situacao <> 'reservada' THEN RAISE EXCEPTION 'Só dá para alterar quarto ainda não ocupado (situação atual: %)', ru.situacao; END IF;

  v_hoje := public._hs_hoje(ru.filial_id);
  v_entrada := coalesce(nullif(p_dados ->> 'entrada', '')::date, ru.entrada);
  v_saida := coalesce(nullif(p_dados ->> 'saida', '')::date, ru.saida);
  v_ad := coalesce(nullif(p_dados ->> 'adultos', '')::integer, ru.adultos);
  v_cr := coalesce(nullif(p_dados ->> 'criancas', '')::integer, ru.criancas);
  v_acordo := CASE WHEN v_tem_acordo THEN round(nullif(p_dados ->> 'valor_acordado_total', '')::numeric, 2) ELSE ru.valor_acordado_total END;

  IF v_saida <= v_entrada THEN RAISE EXCEPTION 'A saída precisa ser depois da entrada'; END IF;
  IF v_saida - v_entrada > 365 THEN RAISE EXCEPTION 'A estadia não pode passar de 365 noites'; END IF;
  IF v_entrada < v_hoje AND v_entrada IS DISTINCT FROM ru.entrada AND NOT v_gestao THEN
    RAISE EXCEPTION 'A entrada já passou: só a gestão registra data passada';
  END IF;
  IF v_acordo IS NOT NULL AND v_acordo IS DISTINCT FROM ru.valor_acordado_total AND NOT v_gestao THEN
    RAISE EXCEPTION 'O valor acordado só pode ser dado pela gestão';
  END IF;
  IF v_acordo IS NOT NULL AND v_acordo < 0 THEN RAISE EXCEPTION 'O valor acordado não pode ser negativo'; END IF;
  IF ru.valor_acordado_total IS NOT NULL AND NOT v_tem_acordo AND (v_saida - v_entrada) <> (ru.saida - ru.entrada) THEN
    RAISE EXCEPTION 'Este quarto tem valor acordado: informe o novo valor acordado ou volte para a tarifa';
  END IF;
  PERFORM public._hs_exige_capacidade(ru.tipo_id, v_ad, v_cr);
  IF EXISTS (SELECT 1 FROM public.hs_ocupacoes o WHERE o.uh_id = ru.uh_id AND o.reserva_uh_id IS DISTINCT FROM ru.id
                AND o.periodo && daterange(v_entrada, v_saida, '[)')) THEN
    RAISE EXCEPTION 'A acomodação não está livre de % a %', to_char(v_entrada, 'DD/MM/YYYY'), to_char(v_saida, 'DD/MM/YYYY');
  END IF;

  BEGIN
    UPDATE public.hs_ocupacoes SET periodo = daterange(v_entrada, v_saida, '[)') WHERE reserva_uh_id = ru.id;
  EXCEPTION WHEN exclusion_violation THEN
    RAISE EXCEPTION 'A acomodação acabou de ser reservada para este período';
  END;
  UPDATE public.hs_reserva_uhs SET entrada = v_entrada, saida = v_saida, adultos = v_ad, criancas = v_cr, valor_acordado_total = v_acordo WHERE id = ru.id;
  v_total := public._hs_gravar_diarias(ru.id, v_ad = ru.adultos AND v_cr = ru.criancas AND ru.valor_acordado_total IS NULL AND v_acordo IS NULL);
  RETURN jsonb_build_object('reserva_uh_id', ru.id, 'total', v_total);
END $$;
REVOKE ALL ON FUNCTION public.hs_reserva_uh_alterar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hs_reserva_uh_alterar(uuid, jsonb) TO authenticated;

-- Troca a acomodação de um quarto ainda não ocupado (upgrade, downgrade, remanejamento). Mudando de tipo, as noites são recotadas
-- pelo tipo novo; manter o preço combinado (cortesia de upgrade) é decisão da gestão. A troca no meio da estadia é da migration de check-in.
CREATE OR REPLACE FUNCTION public.hs_reserva_uh_atribuir(p_reserva_uh uuid, p_uh uuid, p_manter_preco boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  ru public.hs_reserva_uhs%ROWTYPE;
  v_uh public.hs_uhs%ROWTYPE;
  v_total numeric;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._hs_exige_liberado();
  SELECT * INTO ru FROM public.hs_reserva_uhs WHERE id = p_reserva_uh AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quarto da reserva não encontrado'; END IF;
  PERFORM public._hs_exige_filial(ru.filial_id);
  IF coalesce(p_manter_preco, false) AND NOT (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')) THEN
    RAISE EXCEPTION 'Manter o preço na troca de tipo só pode ser decidido pela gestão';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hs_cal:' || ru.filial_id::text, 0));
  SELECT * INTO ru FROM public.hs_reserva_uhs WHERE id = p_reserva_uh FOR UPDATE;
  IF ru.situacao <> 'reservada' THEN RAISE EXCEPTION 'Só dá para trocar a acomodação de quarto ainda não ocupado (situação atual: %)', ru.situacao; END IF;
  IF ru.uh_id = p_uh THEN RETURN jsonb_build_object('reserva_uh_id', ru.id, 'repetido', true); END IF;

  SELECT u.* INTO v_uh FROM public.hs_uhs u JOIN public.hs_tipos_uh t ON t.id = u.tipo_id
   WHERE u.id = p_uh AND u.tenant_id = v_tenant AND u.filial_id = ru.filial_id AND u.ativo AND NOT u.interditada AND t.ativo;
  IF NOT FOUND THEN RAISE EXCEPTION 'Escolha uma acomodação disponível para venda'; END IF;
  PERFORM public._hs_exige_capacidade(v_uh.tipo_id, ru.adultos, ru.criancas);
  IF EXISTS (SELECT 1 FROM public.hs_ocupacoes o WHERE o.uh_id = v_uh.id AND o.periodo && daterange(ru.entrada, ru.saida, '[)')) THEN
    RAISE EXCEPTION 'A acomodação % não está livre de % a %', v_uh.numero, to_char(ru.entrada, 'DD/MM/YYYY'), to_char(ru.saida, 'DD/MM/YYYY');
  END IF;
  BEGIN
    UPDATE public.hs_ocupacoes SET uh_id = v_uh.id WHERE reserva_uh_id = ru.id;
  EXCEPTION WHEN exclusion_violation THEN
    RAISE EXCEPTION 'A acomodação % acabou de ser reservada para este período', v_uh.numero;
  END;
  UPDATE public.hs_reserva_uhs SET uh_id = v_uh.id, tipo_id = v_uh.tipo_id WHERE id = ru.id;
  IF v_uh.tipo_id IS DISTINCT FROM ru.tipo_id AND NOT coalesce(p_manter_preco, false) THEN
    v_total := public._hs_gravar_diarias(ru.id, false);
  ELSE
    v_total := (SELECT coalesce(sum(valor), 0) FROM public.hs_diarias WHERE reserva_uh_id = ru.id);
  END IF;
  RETURN jsonb_build_object('reserva_uh_id', ru.id, 'total', v_total, 'repetido', false);
END $$;
REVOKE ALL ON FUNCTION public.hs_reserva_uh_atribuir(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hs_reserva_uh_atribuir(uuid, uuid, boolean) TO authenticated;

-- ============ cancelar e não comparecimento ============
-- Cancela um quarto ainda não ocupado e libera a acomodação. O sinal já recebido é tratado pela migration da conta do hóspede.
CREATE OR REPLACE FUNCTION public.hs_reserva_uh_cancelar(p_reserva_uh uuid, p_motivo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  ru public.hs_reserva_uhs%ROWTYPE;
  v_motivo text := btrim(coalesce(p_motivo, ''));
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._hs_exige_liberado();
  SELECT * INTO ru FROM public.hs_reserva_uhs WHERE id = p_reserva_uh AND tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Quarto da reserva não encontrado'; END IF;
  PERFORM public._hs_exige_filial(ru.filial_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('hs_cal:' || ru.filial_id::text, 0));
  SELECT * INTO ru FROM public.hs_reserva_uhs WHERE id = p_reserva_uh FOR UPDATE;
  IF ru.situacao = 'cancelada' THEN RETURN jsonb_build_object('reserva_uh_id', ru.id, 'repetido', true); END IF;
  IF ru.situacao <> 'reservada' THEN RAISE EXCEPTION 'Só dá para cancelar quarto ainda não ocupado (situação atual: %)', ru.situacao; END IF;
  IF length(v_motivo) < 3 THEN RAISE EXCEPTION 'Informe o motivo do cancelamento'; END IF;
  DELETE FROM public.hs_ocupacoes WHERE reserva_uh_id = ru.id;
  UPDATE public.hs_reserva_uhs SET situacao = 'cancelada' WHERE id = ru.id;
  PERFORM public._hs_reserva_recalcular(ru.reserva_id);
  UPDATE public.hs_reservas SET motivo_cancelamento = v_motivo, cancelada_em = now() WHERE id = ru.reserva_id AND situacao = 'cancelada';
  RETURN jsonb_build_object('reserva_uh_id', ru.id, 'repetido', false);
END $$;
REVOKE ALL ON FUNCTION public.hs_reserva_uh_cancelar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hs_reserva_uh_cancelar(uuid, text) TO authenticated;

-- Cancela a reserva toda. Quarto já hospedado não cancela (check-out antecipado). p_devolver_sinal vale quando houver sinal recebido:
-- a conta do hóspede (migration seguinte) reescreve esta função para tratá-lo; por ora o parâmetro só reserva o lugar.
CREATE OR REPLACE FUNCTION public.hs_reserva_cancelar(p_id uuid, p_motivo text, p_devolver_sinal boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r public.hs_reservas%ROWTYPE;
  v_motivo text := btrim(coalesce(p_motivo, ''));
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._hs_exige_liberado();
  SELECT * INTO r FROM public.hs_reservas WHERE id = p_id AND tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Reserva não encontrada'; END IF;
  PERFORM public._hs_exige_filial(r.filial_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('hs_cal:' || r.filial_id::text, 0));
  SELECT * INTO r FROM public.hs_reservas WHERE id = p_id FOR UPDATE;
  IF r.situacao = 'cancelada' THEN RETURN jsonb_build_object('reserva_id', r.id, 'repetido', true); END IF;
  IF EXISTS (SELECT 1 FROM public.hs_reserva_uhs u WHERE u.reserva_id = r.id AND u.situacao NOT IN ('reservada', 'cancelada')) THEN
    RAISE EXCEPTION 'Esta reserva já tem quarto ocupado ou encerrado: cancele só os quartos que ainda não foram ocupados';
  END IF;
  IF length(v_motivo) < 3 THEN RAISE EXCEPTION 'Informe o motivo do cancelamento'; END IF;
  DELETE FROM public.hs_ocupacoes WHERE reserva_uh_id IN (SELECT id FROM public.hs_reserva_uhs WHERE reserva_id = r.id);
  UPDATE public.hs_reserva_uhs SET situacao = 'cancelada' WHERE reserva_id = r.id AND situacao = 'reservada';
  PERFORM public._hs_reserva_recalcular(r.id);
  UPDATE public.hs_reservas SET motivo_cancelamento = v_motivo, cancelada_em = now() WHERE id = r.id;
  RETURN jsonb_build_object('reserva_id', r.id, 'repetido', false);
END $$;
REVOKE ALL ON FUNCTION public.hs_reserva_cancelar(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hs_reserva_cancelar(uuid, text, boolean) TO authenticated;

-- Não compareceu: só a partir do dia da entrada, e no próprio dia só a gestão (o hóspede ainda pode chegar). Libera a acomodação.
-- Cobrar a primeira diária é decisão da gestão (lançamento na conta, na migration seguinte).
CREATE OR REPLACE FUNCTION public.hs_reserva_no_show(p_reserva_uh uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  ru public.hs_reserva_uhs%ROWTYPE;
  v_hoje date;
  v_gestao boolean := public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor');
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._hs_exige_liberado();
  SELECT * INTO ru FROM public.hs_reserva_uhs WHERE id = p_reserva_uh AND tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Quarto da reserva não encontrado'; END IF;
  PERFORM public._hs_exige_filial(ru.filial_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('hs_cal:' || ru.filial_id::text, 0));
  SELECT * INTO ru FROM public.hs_reserva_uhs WHERE id = p_reserva_uh FOR UPDATE;
  IF ru.situacao = 'no_show' THEN RETURN jsonb_build_object('reserva_uh_id', ru.id, 'repetido', true); END IF;
  IF ru.situacao <> 'reservada' THEN RAISE EXCEPTION 'Só quarto reservado e não ocupado pode ser marcado como não comparecimento (situação atual: %)', ru.situacao; END IF;
  v_hoje := public._hs_hoje(ru.filial_id);
  IF v_hoje < ru.entrada THEN RAISE EXCEPTION 'A entrada é só em %', to_char(ru.entrada, 'DD/MM/YYYY'); END IF;
  IF v_hoje = ru.entrada AND NOT v_gestao THEN RAISE EXCEPTION 'No dia da entrada o não comparecimento só pode ser marcado pela gestão'; END IF;
  DELETE FROM public.hs_ocupacoes WHERE reserva_uh_id = ru.id;
  UPDATE public.hs_reserva_uhs SET situacao = 'no_show' WHERE id = ru.id;
  PERFORM public._hs_reserva_recalcular(ru.reserva_id);
  RETURN jsonb_build_object('reserva_uh_id', ru.id, 'repetido', false);
END $$;
REVOKE ALL ON FUNCTION public.hs_reserva_no_show(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hs_reserva_no_show(uuid) TO authenticated;

-- ============ interdição por período ============
-- Tira a acomodação de venda de p_de até p_ate (a data de volta, que já fica livre). Recusa se houver reserva no período.
CREATE OR REPLACE FUNCTION public.hs_uh_interditar(p_uh uuid, p_de date, p_ate date, p_motivo text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uh public.hs_uhs%ROWTYPE;
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_id uuid;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  PERFORM public._hs_exige_liberado();
  SELECT * INTO v_uh FROM public.hs_uhs WHERE id = p_uh AND tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Acomodação não encontrada'; END IF;
  PERFORM public._hs_exige_filial(v_uh.filial_id);
  IF v_motivo = '' THEN RAISE EXCEPTION 'Informe o motivo da interdição'; END IF;
  IF p_de IS NULL OR p_ate IS NULL OR p_ate <= p_de THEN RAISE EXCEPTION 'A data de volta precisa ser depois do início'; END IF;
  IF p_ate <= public._hs_hoje(v_uh.filial_id) THEN RAISE EXCEPTION 'A data de volta precisa ser depois de hoje'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hs_cal:' || v_uh.filial_id::text, 0));
  IF EXISTS (SELECT 1 FROM public.hs_ocupacoes o WHERE o.uh_id = p_uh AND o.origem = 'reserva' AND o.periodo && daterange(p_de, p_ate, '[)')) THEN
    RAISE EXCEPTION 'Há reserva nesta acomodação no período: remaneje a reserva antes';
  END IF;
  IF EXISTS (SELECT 1 FROM public.hs_ocupacoes o WHERE o.uh_id = p_uh AND o.origem = 'bloqueio' AND o.periodo && daterange(p_de, p_ate, '[)')) THEN
    RAISE EXCEPTION 'Já existe bloqueio nesta acomodação no período';
  END IF;
  BEGIN
    INSERT INTO public.hs_ocupacoes (tenant_id, filial_id, uh_id, periodo, origem, motivo)
    VALUES (v_uh.tenant_id, v_uh.filial_id, p_uh, daterange(p_de, p_ate, '[)'), 'bloqueio', v_motivo)
    RETURNING id INTO v_id;
  EXCEPTION WHEN exclusion_violation THEN
    RAISE EXCEPTION 'A acomodação acabou de ser reservada ou bloqueada neste período';
  END;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.hs_uh_interditar(uuid, date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hs_uh_interditar(uuid, date, date, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.hs_bloqueio_remover(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE o public.hs_ocupacoes%ROWTYPE;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  PERFORM public._hs_exige_liberado();
  SELECT * INTO o FROM public.hs_ocupacoes WHERE id = p_id AND tenant_id = public.current_tenant_id() AND origem = 'bloqueio';
  IF NOT FOUND THEN RAISE EXCEPTION 'Bloqueio não encontrado'; END IF;
  PERFORM public._hs_exige_filial(o.filial_id);
  DELETE FROM public.hs_ocupacoes WHERE id = p_id;
END $$;
REVOKE ALL ON FUNCTION public.hs_bloqueio_remover(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hs_bloqueio_remover(uuid) TO authenticated;
