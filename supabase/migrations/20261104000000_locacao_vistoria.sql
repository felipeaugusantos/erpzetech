-- Locação: vistoria na devolução. Ao devolver, cada equipamento é vistoriado; o dano encontrado vira custo para o cliente: sai primeiro da
-- caução e a diferença vira uma conta a receber (o que sobrar da caução é o valor a devolver ao cliente). Equipamento com dano vai para
-- "manutenção" e perda total tira o equipamento de uso. A vistoria não se altera depois de registrada.

-- ============ vistoria e avarias ============
CREATE TABLE IF NOT EXISTS public.locacao_vistorias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id),
  locacao_id uuid NOT NULL REFERENCES public.locacoes(id),
  equipamento_id uuid NOT NULL REFERENCES public.locacao_equipamentos(id),
  usuario_id uuid NOT NULL DEFAULT auth.uid(),
  realizada_em timestamptz NOT NULL DEFAULT now(),
  situacao text NOT NULL CHECK (situacao IN ('sem_avarias', 'com_avarias')),
  observacoes text,
  valor_avarias numeric(14,2) NOT NULL DEFAULT 0 CHECK (valor_avarias >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (locacao_id, equipamento_id)
);
CREATE INDEX IF NOT EXISTS locacao_vistorias_loc_idx ON public.locacao_vistorias (locacao_id);

CREATE TABLE IF NOT EXISTS public.locacao_vistoria_avarias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id),
  vistoria_id uuid NOT NULL REFERENCES public.locacao_vistorias(id),
  descricao text NOT NULL CHECK (length(btrim(descricao)) BETWEEN 1 AND 200),
  valor numeric(14,2) NOT NULL CHECK (valor >= 0),
  perda_total boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS locacao_vistoria_avarias_vist_idx ON public.locacao_vistoria_avarias (vistoria_id);

-- acerto da devolução na própria locação
ALTER TABLE public.locacoes
  ADD COLUMN IF NOT EXISTS vistoria_em timestamptz,
  ADD COLUMN IF NOT EXISTS valor_avarias numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS caucao_abatida numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS caucao_devolver numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avarias_conta_receber_id uuid REFERENCES public.contas_receber(id);

-- a leitura é da empresa; a escrita é só pela função da devolução
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['locacao_vistorias', 'locacao_vistoria_avarias'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_leitura ON public.%I', t);
    EXECUTE format('CREATE POLICY tenant_leitura ON public.%I FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id())', t);
    EXECUTE format('DROP POLICY IF EXISTS salao_restrito ON public.%I', t);
    EXECUTE format('CREATE POLICY salao_restrito ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()))', t);
  END LOOP;
END $$;

-- vistoria registrada não muda nem some (nem para o dono do banco)
CREATE OR REPLACE FUNCTION public.locacao_vistoria_imutavel()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'A vistoria já registrada não pode ser alterada nem apagada';
END $$;
REVOKE ALL ON FUNCTION public.locacao_vistoria_imutavel() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS locacao_vistorias_imutavel ON public.locacao_vistorias;
CREATE TRIGGER locacao_vistorias_imutavel BEFORE UPDATE OR DELETE ON public.locacao_vistorias
  FOR EACH ROW EXECUTE FUNCTION public.locacao_vistoria_imutavel();
DROP TRIGGER IF EXISTS locacao_vistoria_avarias_imutavel ON public.locacao_vistoria_avarias;
CREATE TRIGGER locacao_vistoria_avarias_imutavel BEFORE UPDATE OR DELETE ON public.locacao_vistoria_avarias
  FOR EACH ROW EXECUTE FUNCTION public.locacao_vistoria_imutavel();

-- ============ devolução com vistoria ============
-- p_vistorias: um item por equipamento da locação: {equipamento_id, observacoes, avarias: [{descricao, valor, perda_total}]}.
-- Sem avarias = vistoria sem dano. Todos os equipamentos da locação precisam ser vistoriados.
CREATE OR REPLACE FUNCTION public.locacao_devolver_vistoriada(
  p_locacao_id uuid,
  p_data date DEFAULT current_date,
  p_observacao text DEFAULT NULL,
  p_vistorias jsonb DEFAULT '[]'::jsonb,
  p_vencimento date DEFAULT current_date
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_loc public.locacoes%ROWTYPE;
  v_esperados uuid[];
  v_vistos uuid[] := ARRAY[]::uuid[];
  v_dias integer;
  v_extras numeric := 0;
  v_total numeric;
  it jsonb;
  av jsonb;
  v_eq uuid;
  v_vid uuid;
  v_valor numeric;
  v_soma_vist numeric;
  v_avarias numeric := 0;
  v_abatida numeric;
  v_cobrar numeric;
  v_devolver numeric;
  v_caucao numeric;
  v_conta uuid;
  v_com_avaria boolean;
BEGIN
  PERFORM public.exige_nao_salao();
  SELECT * INTO v_loc FROM public.locacoes WHERE id = p_locacao_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Locação não encontrada'; END IF;
  IF v_loc.situacao = 'devolvida' THEN RAISE EXCEPTION 'Locação já devolvida'; END IF;
  IF v_loc.situacao <> 'em_andamento' THEN RAISE EXCEPTION 'Só a locação em andamento é devolvida'; END IF;
  IF p_data IS NULL OR p_data > current_date THEN RAISE EXCEPTION 'A data da devolução não pode ser no futuro'; END IF;
  IF p_data < coalesce(v_loc.entregue_em, v_loc.inicio) THEN RAISE EXCEPTION 'A devolução não pode ser antes da entrega'; END IF;
  IF p_vistorias IS NULL OR jsonb_typeof(p_vistorias) <> 'array' THEN RAISE EXCEPTION 'Informe a vistoria dos equipamentos'; END IF;

  SELECT coalesce(array_agg(DISTINCT equipamento_id), ARRAY[]::uuid[]) INTO v_esperados FROM public.locacao_itens WHERE locacao_id = v_loc.id;
  IF cardinality(v_esperados) = 0 THEN v_esperados := ARRAY[v_loc.equipamento_id]; END IF;

  v_dias := greatest(p_data - coalesce(v_loc.entregue_em, v_loc.inicio), 1);
  IF v_dias > v_loc.dias THEN v_extras := (v_dias - v_loc.dias) * v_loc.valor_diaria; END IF;
  v_total := v_loc.valor_diaria * greatest(v_dias, v_loc.dias);

  FOR it IN SELECT * FROM jsonb_array_elements(p_vistorias) LOOP
    BEGIN
      v_eq := (it ->> 'equipamento_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Equipamento da vistoria inválido';
    END;
    IF v_eq IS NULL OR NOT (v_eq = ANY (v_esperados)) THEN RAISE EXCEPTION 'A vistoria tem um equipamento que não é desta locação'; END IF;
    IF v_eq = ANY (v_vistos) THEN RAISE EXCEPTION 'Equipamento vistoriado duas vezes'; END IF;
    v_vistos := v_vistos || v_eq;
    IF it ? 'avarias' AND jsonb_typeof(it -> 'avarias') <> 'array' THEN RAISE EXCEPTION 'Avarias em formato inválido'; END IF;
    IF length(coalesce(it ->> 'observacoes', '')) > 1000 THEN RAISE EXCEPTION 'A observação da vistoria passa de 1000 letras'; END IF;
    v_com_avaria := jsonb_array_length(coalesce(it -> 'avarias', '[]'::jsonb)) > 0;

    -- confere cada avaria e soma antes de gravar: a vistoria nasce já com o total (depois ela não muda)
    v_soma_vist := 0;
    FOR av IN SELECT * FROM jsonb_array_elements(coalesce(it -> 'avarias', '[]'::jsonb)) LOOP
      BEGIN
        v_valor := round(replace(btrim(coalesce(av ->> 'valor', '')), ',', '.')::numeric, 2);
      EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION 'Confira o valor da avaria';
      END;
      IF v_valor IS NULL OR v_valor < 0 OR v_valor >= 1000000000 THEN RAISE EXCEPTION 'O valor da avaria precisa estar entre zero e 999.999.999'; END IF;
      IF length(btrim(coalesce(av ->> 'descricao', ''))) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Descreva cada avaria (até 200 letras)'; END IF;
      v_soma_vist := v_soma_vist + v_valor;
    END LOOP;

    INSERT INTO public.locacao_vistorias (tenant_id, locacao_id, equipamento_id, situacao, observacoes, valor_avarias)
    VALUES (v_tenant, v_loc.id, v_eq, CASE WHEN v_com_avaria THEN 'com_avarias' ELSE 'sem_avarias' END,
            nullif(btrim(coalesce(it ->> 'observacoes', '')), ''), v_soma_vist)
    RETURNING id INTO v_vid;

    FOR av IN SELECT * FROM jsonb_array_elements(coalesce(it -> 'avarias', '[]'::jsonb)) LOOP
      INSERT INTO public.locacao_vistoria_avarias (tenant_id, vistoria_id, descricao, valor, perda_total)
      VALUES (v_tenant, v_vid, btrim(av ->> 'descricao'), round(replace(btrim(av ->> 'valor'), ',', '.')::numeric, 2),
              coalesce((av ->> 'perda_total')::boolean, false));
    END LOOP;
    v_avarias := v_avarias + v_soma_vist;
  END LOOP;

  IF cardinality(v_vistos) <> cardinality(v_esperados) THEN RAISE EXCEPTION 'Faça a vistoria de todos os equipamentos da locação'; END IF;

  -- caução negativa (a coluna permite) não pode virar cobrança indevida: conta como zero
  v_caucao := greatest(coalesce(v_loc.caucao, 0), 0);
  v_abatida := least(v_caucao, v_avarias);
  v_cobrar := v_avarias - v_abatida;
  v_devolver := v_caucao - v_abatida;

  UPDATE public.locacoes
     SET situacao = 'devolvida', devolvido_em = p_data, dias_reais = v_dias, valor_extras = v_extras, valor_total = v_total,
         observacao_devolucao = nullif(btrim(coalesce(p_observacao, '')), ''),
         vistoria_em = now(), valor_avarias = v_avarias, caucao_abatida = v_abatida, caucao_devolver = v_devolver
   WHERE id = v_loc.id;

  IF v_cobrar > 0 THEN
    INSERT INTO public.contas_receber (tenant_id, empresa_id, filial_id, cliente_id, descricao, parcela, parcelas, vencimento, valor, observacoes)
    VALUES (v_tenant, v_loc.empresa_id, v_loc.filial_id, v_loc.cliente_id, 'Avarias da locação nº ' || v_loc.numero, 1, 1,
            coalesce(p_vencimento, current_date), v_cobrar, 'Cobrança de avarias encontradas na vistoria de devolução')
    RETURNING id INTO v_conta;
    UPDATE public.locacoes SET avarias_conta_receber_id = v_conta WHERE id = v_loc.id;
  END IF;

  -- equipamento sem dano volta a ficar disponível (a regra antiga só liberava o primeiro equipamento do contrato), a não ser que outra locação em andamento o esteja usando
  UPDATE public.locacao_equipamentos e
     SET situacao = 'disponivel', updated_at = now()
   WHERE e.tenant_id = v_tenant AND e.id = ANY (v_esperados) AND e.situacao = 'locado'
     AND NOT EXISTS (SELECT 1 FROM public.locacao_vistorias v WHERE v.locacao_id = v_loc.id AND v.equipamento_id = e.id AND v.situacao = 'com_avarias')
     AND NOT EXISTS (SELECT 1 FROM public.locacoes l
                      WHERE l.id <> v_loc.id AND l.situacao = 'em_andamento'
                        AND (l.equipamento_id = e.id OR EXISTS (SELECT 1 FROM public.locacao_itens i WHERE i.locacao_id = l.id AND i.equipamento_id = e.id)));

  -- equipamento com dano vai para manutenção; perda total tira o equipamento de uso
  UPDATE public.locacao_equipamentos e
     SET situacao = 'manutencao', updated_at = now(),
         ativo = e.ativo AND NOT EXISTS (
           SELECT 1 FROM public.locacao_vistorias v JOIN public.locacao_vistoria_avarias a ON a.vistoria_id = v.id
            WHERE v.locacao_id = v_loc.id AND v.equipamento_id = e.id AND a.perda_total)
   WHERE e.tenant_id = v_tenant
     AND e.id IN (SELECT equipamento_id FROM public.locacao_vistorias WHERE locacao_id = v_loc.id AND situacao = 'com_avarias');

  RETURN jsonb_build_object('locacao_id', v_loc.id, 'dias', v_dias, 'valor_total', v_total, 'valor_avarias', v_avarias,
                            'caucao_abatida', v_abatida, 'a_cobrar', v_cobrar, 'caucao_a_devolver', v_devolver, 'conta_receber_id', v_conta);
END $$;
REVOKE ALL ON FUNCTION public.locacao_devolver_vistoriada(uuid, date, text, jsonb, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_devolver_vistoriada(uuid, date, text, jsonb, date) TO authenticated;

-- a devolução sem vistoria deixa de existir: a tela e qualquer chamada passam pela função acima
REVOKE EXECUTE ON FUNCTION public.locacao_devolver(uuid, date, text, numeric) FROM authenticated;

-- ============ equipamento em manutenção ou fora de uso não sai para o cliente ============
-- Vale para qualquer caminho que ponha a locação em andamento (entregar, balcão, ajuste direto): a reserva futura de um equipamento que
-- voltou danificado fica parada até o reparo ser registrado ou o equipamento ser trocado.
CREATE OR REPLACE FUNCTION public.locacao_equipamento_apto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_nome text;
BEGIN
  IF NEW.situacao <> 'em_andamento' OR (TG_OP = 'UPDATE' AND OLD.situacao = 'em_andamento') THEN RETURN NEW; END IF;
  SELECT e.nome INTO v_nome
    FROM public.locacao_equipamentos e
   WHERE (e.id = NEW.equipamento_id OR e.id IN (SELECT i.equipamento_id FROM public.locacao_itens i WHERE i.locacao_id = NEW.id))
     AND (e.situacao = 'manutencao' OR NOT e.ativo)
   LIMIT 1;
  IF v_nome IS NOT NULL THEN
    RAISE EXCEPTION 'O equipamento "%" está em manutenção ou fora de uso e não pode ser entregue', v_nome;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.locacao_equipamento_apto() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS locacoes_equipamento_apto ON public.locacoes;
CREATE TRIGGER locacoes_equipamento_apto BEFORE INSERT OR UPDATE OF situacao ON public.locacoes
  FOR EACH ROW EXECUTE FUNCTION public.locacao_equipamento_apto();
