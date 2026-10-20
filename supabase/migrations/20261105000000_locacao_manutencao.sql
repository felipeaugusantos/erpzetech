-- Locação: plano de manutenção por equipamento, pelo tempo de locação. Cada equipamento pode ter planos (ex.: troca de óleo a cada 60 dias
-- locados). Os dias de locação se acumulam desde a última manutenção do plano (a locação em andamento conta até hoje); ao vencer o plano,
-- o equipamento não sai para um novo cliente até a manutenção ser registrada, e o registro recomeça a contagem. Manutenção registrada não
-- se altera (corrige-se com um novo registro).

-- ============ planos e manutenções ============
CREATE TABLE IF NOT EXISTS public.locacao_planos_manutencao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id),
  equipamento_id uuid NOT NULL REFERENCES public.locacao_equipamentos(id),
  nome text NOT NULL CHECK (length(btrim(nome)) BETWEEN 2 AND 80),
  intervalo_dias integer NOT NULL CHECK (intervalo_dias BETWEEN 1 AND 3650),
  -- a contagem de dias locados começa depois desta data (a última manutenção; muda a cada manutenção registrada)
  referencia_em date NOT NULL DEFAULT current_date,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS locacao_planos_manutencao_equip_idx ON public.locacao_planos_manutencao (equipamento_id);

CREATE TABLE IF NOT EXISTS public.locacao_manutencoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id),
  equipamento_id uuid NOT NULL REFERENCES public.locacao_equipamentos(id),
  plano_id uuid REFERENCES public.locacao_planos_manutencao(id),
  tipo text NOT NULL CHECK (tipo IN ('preventiva', 'corretiva')),
  realizada_em date NOT NULL,
  descricao text NOT NULL CHECK (length(btrim(descricao)) BETWEEN 2 AND 500),
  custo numeric(14,2) NOT NULL DEFAULT 0 CHECK (custo >= 0),
  responsavel text,
  usuario_id uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS locacao_manutencoes_equip_idx ON public.locacao_manutencoes (equipamento_id, realizada_em DESC);

-- a leitura é da empresa; a escrita é só pelas funções abaixo
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['locacao_planos_manutencao', 'locacao_manutencoes'] LOOP
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

CREATE OR REPLACE FUNCTION public.locacao_manutencao_imutavel()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'A manutenção registrada não pode ser alterada nem apagada: registre uma nova para corrigir';
END $$;
REVOKE ALL ON FUNCTION public.locacao_manutencao_imutavel() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS locacao_manutencoes_imutavel ON public.locacao_manutencoes;
CREATE TRIGGER locacao_manutencoes_imutavel BEFORE UPDATE OR DELETE ON public.locacao_manutencoes
  FOR EACH ROW EXECUTE FUNCTION public.locacao_manutencao_imutavel();

-- ============ contagem dos dias locados de um plano ============
-- Soma, nas locações em andamento e devolvidas do equipamento (do contrato ou dos itens), os dias depois da última manutenção do plano.
CREATE OR REPLACE FUNCTION public._locacao_plano_dias(p_plano_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT coalesce(sum(
           CASE WHEN x.ini >= p.referencia_em THEN greatest(x.fim - x.ini, 1)
                ELSE greatest(x.fim - p.referencia_em, 0) END), 0)::integer
    FROM public.locacao_planos_manutencao p
    CROSS JOIN LATERAL (
      SELECT coalesce(l.entregue_em, l.inicio) AS ini,
             CASE WHEN l.situacao = 'devolvida' THEN coalesce(l.devolvido_em, current_date) ELSE current_date END AS fim
        FROM public.locacoes l
       WHERE l.tenant_id = p.tenant_id AND l.situacao IN ('em_andamento', 'devolvida')
         AND (l.equipamento_id = p.equipamento_id
              OR EXISTS (SELECT 1 FROM public.locacao_itens i WHERE i.locacao_id = l.id AND i.equipamento_id = p.equipamento_id))
    ) x
   WHERE p.id = p_plano_id
$$;
REVOKE ALL ON FUNCTION public._locacao_plano_dias(uuid) FROM PUBLIC, anon, authenticated;

-- ============ situação dos planos ============
-- Um item por plano ativo: dias locados acumulados, quantos faltam e a situação (em_dia, proxima = faltam 20% ou menos, vencida).
CREATE OR REPLACE FUNCTION public.locacao_manutencao_situacao(p_equipamento_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.exige_nao_salao();
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'plano_id', p.id, 'equipamento_id', p.equipamento_id, 'equipamento', e.nome, 'codigo', e.codigo,
             'nome', p.nome, 'intervalo_dias', p.intervalo_dias, 'referencia_em', p.referencia_em,
             'dias', d.dias, 'restantes', p.intervalo_dias - d.dias,
             'situacao', CASE WHEN d.dias >= p.intervalo_dias THEN 'vencida'
                              WHEN p.intervalo_dias - d.dias <= greatest(1, ceil(p.intervalo_dias * 0.2)) THEN 'proxima'
                              ELSE 'em_dia' END)
           ORDER BY (p.intervalo_dias - d.dias), e.nome, p.nome)
      FROM public.locacao_planos_manutencao p
      JOIN public.locacao_equipamentos e ON e.id = p.equipamento_id
      CROSS JOIN LATERAL (SELECT public._locacao_plano_dias(p.id) AS dias) d
     WHERE p.tenant_id = public.current_tenant_id() AND p.ativo AND e.ativo
       AND (p_equipamento_id IS NULL OR p.equipamento_id = p_equipamento_id)
  ), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.locacao_manutencao_situacao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_manutencao_situacao(uuid) TO authenticated;

-- ============ criar e editar o plano ============
-- p_dados: id (para editar), equipamento_id, nome, intervalo_dias, referencia_em (última manutenção; padrão hoje), ativo.
CREATE OR REPLACE FUNCTION public.locacao_plano_salvar(p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_id uuid;
  v_eq uuid;
  v_nome text := btrim(coalesce(p_dados ->> 'nome', ''));
  v_int integer;
  v_ref date;
  v_ativo boolean;
  pl public.locacao_planos_manutencao%ROWTYPE;
BEGIN
  PERFORM public.exige_nao_salao();
  BEGIN
    v_id := nullif(btrim(coalesce(p_dados ->> 'id', '')), '')::uuid;
    v_eq := nullif(btrim(coalesce(p_dados ->> 'equipamento_id', '')), '')::uuid;
    v_int := (p_dados ->> 'intervalo_dias')::integer;
    v_ref := coalesce(nullif(btrim(coalesce(p_dados ->> 'referencia_em', '')), '')::date, current_date);
    v_ativo := coalesce((p_dados ->> 'ativo')::boolean, true);
  EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'Confira o intervalo, a data e os identificadores do plano';
  END;
  IF length(v_nome) NOT BETWEEN 2 AND 80 THEN RAISE EXCEPTION 'Dê um nome ao plano (de 2 a 80 letras)'; END IF;
  IF v_int IS NULL OR v_int NOT BETWEEN 1 AND 3650 THEN RAISE EXCEPTION 'O intervalo precisa ser de 1 a 3650 dias de locação'; END IF;
  IF v_ref > current_date THEN RAISE EXCEPTION 'A data da última manutenção não pode ser no futuro'; END IF;

  IF v_id IS NULL THEN
    PERFORM 1 FROM public.locacao_equipamentos WHERE id = v_eq AND tenant_id = v_tenant;
    IF NOT FOUND THEN RAISE EXCEPTION 'Equipamento não encontrado'; END IF;
    IF EXISTS (SELECT 1 FROM public.locacao_planos_manutencao WHERE equipamento_id = v_eq AND lower(btrim(nome)) = lower(v_nome) AND ativo) THEN
      RAISE EXCEPTION 'Este equipamento já tem um plano ativo com esse nome';
    END IF;
    INSERT INTO public.locacao_planos_manutencao (tenant_id, equipamento_id, nome, intervalo_dias, referencia_em, ativo)
    VALUES (v_tenant, v_eq, v_nome, v_int, v_ref, v_ativo) RETURNING id INTO v_id;
  ELSE
    SELECT * INTO pl FROM public.locacao_planos_manutencao WHERE id = v_id AND tenant_id = v_tenant FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Plano não encontrado'; END IF;
    IF v_ativo AND EXISTS (SELECT 1 FROM public.locacao_planos_manutencao WHERE equipamento_id = pl.equipamento_id AND id <> pl.id AND lower(btrim(nome)) = lower(v_nome) AND ativo) THEN
      RAISE EXCEPTION 'Este equipamento já tem um plano ativo com esse nome';
    END IF;
    -- a data de referência só é mexida à mão quando vem no pedido; manutenção registrada a atualiza sozinha
    UPDATE public.locacao_planos_manutencao
       SET nome = v_nome, intervalo_dias = v_int, ativo = v_ativo, updated_at = now(),
           referencia_em = CASE WHEN p_dados ? 'referencia_em' THEN v_ref ELSE referencia_em END
     WHERE id = pl.id;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.locacao_plano_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_plano_salvar(jsonb) TO authenticated;

-- ============ registrar a manutenção ============
-- p_dados: equipamento_id, plano_id (opcional: recomeça a contagem desse plano), tipo (preventiva ou corretiva), realizada_em, descricao, custo,
-- responsavel, liberar (tira o equipamento de "manutenção", padrão: sim para corretiva).
CREATE OR REPLACE FUNCTION public.locacao_manutencao_registrar(p_dados jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_eq uuid;
  v_plano uuid;
  v_tipo text := coalesce(nullif(btrim(coalesce(p_dados ->> 'tipo', '')), ''), 'preventiva');
  v_em date;
  v_desc text := btrim(coalesce(p_dados ->> 'descricao', ''));
  v_custo numeric;
  v_resp text := nullif(btrim(coalesce(p_dados ->> 'responsavel', '')), '');
  v_liberar boolean;
  v_id uuid;
  e public.locacao_equipamentos%ROWTYPE;
  pl public.locacao_planos_manutencao%ROWTYPE;
BEGIN
  PERFORM public.exige_nao_salao();
  BEGIN
    v_eq := nullif(btrim(coalesce(p_dados ->> 'equipamento_id', '')), '')::uuid;
    v_plano := nullif(btrim(coalesce(p_dados ->> 'plano_id', '')), '')::uuid;
    v_em := coalesce(nullif(btrim(coalesce(p_dados ->> 'realizada_em', '')), '')::date, current_date);
    v_custo := coalesce(nullif(replace(btrim(coalesce(p_dados ->> 'custo', '')), ',', '.'), '')::numeric, 0);
    v_liberar := coalesce((p_dados ->> 'liberar')::boolean, v_tipo = 'corretiva');
  EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'Confira a data, o custo e os identificadores da manutenção';
  END;
  IF v_tipo NOT IN ('preventiva', 'corretiva') THEN RAISE EXCEPTION 'Tipo de manutenção inválido: preventiva ou corretiva'; END IF;
  IF length(v_desc) NOT BETWEEN 2 AND 500 THEN RAISE EXCEPTION 'Descreva o que foi feito (de 2 a 500 letras)'; END IF;
  IF v_custo < 0 OR v_custo >= 1000000000 THEN RAISE EXCEPTION 'O custo precisa estar entre zero e 999.999.999'; END IF;
  IF v_em > current_date THEN RAISE EXCEPTION 'A data da manutenção não pode ser no futuro'; END IF;
  IF length(coalesce(v_resp, '')) > 120 THEN RAISE EXCEPTION 'O responsável passa de 120 letras'; END IF;

  SELECT * INTO e FROM public.locacao_equipamentos WHERE id = v_eq AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Equipamento não encontrado'; END IF;
  IF v_plano IS NOT NULL THEN
    SELECT * INTO pl FROM public.locacao_planos_manutencao WHERE id = v_plano AND tenant_id = v_tenant AND equipamento_id = e.id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Plano não encontrado neste equipamento'; END IF;
    IF v_em < pl.referencia_em THEN RAISE EXCEPTION 'A manutenção não pode ser anterior à última registrada neste plano (%)', to_char(pl.referencia_em, 'DD/MM/YYYY'); END IF;
  END IF;
  IF e.situacao = 'locado' THEN RAISE EXCEPTION 'O equipamento está locado: registre a manutenção depois da devolução'; END IF;

  INSERT INTO public.locacao_manutencoes (tenant_id, equipamento_id, plano_id, tipo, realizada_em, descricao, custo, responsavel)
  VALUES (v_tenant, e.id, v_plano, v_tipo, v_em, v_desc, round(v_custo, 2), v_resp) RETURNING id INTO v_id;

  -- recomeça a contagem do plano e soma o custo ao do equipamento
  IF v_plano IS NOT NULL THEN
    UPDATE public.locacao_planos_manutencao SET referencia_em = v_em, updated_at = now() WHERE id = v_plano;
  END IF;
  UPDATE public.locacao_equipamentos
     SET custo_manutencao = coalesce(custo_manutencao, 0) + round(v_custo, 2),
         situacao = CASE WHEN v_liberar AND ativo AND situacao = 'manutencao' THEN 'disponivel' ELSE situacao END,
         updated_at = now()
   WHERE id = e.id;

  RETURN jsonb_build_object('manutencao_id', v_id, 'liberado', v_liberar AND e.ativo AND e.situacao = 'manutencao');
END $$;
REVOKE ALL ON FUNCTION public.locacao_manutencao_registrar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_manutencao_registrar(jsonb) TO authenticated;

-- ============ equipamento com manutenção vencida não sai para o cliente ============
-- Substitui a regra da vistoria: além de manutenção e fora de uso, plano de manutenção vencido também impede pôr a locação em andamento.
CREATE OR REPLACE FUNCTION public.locacao_equipamento_apto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_nome text;
  v_plano text;
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
  SELECT e.nome || ' (' || p.nome || ')' INTO v_plano
    FROM public.locacao_planos_manutencao p
    JOIN public.locacao_equipamentos e ON e.id = p.equipamento_id
   WHERE p.ativo AND e.ativo
     AND (p.equipamento_id = NEW.equipamento_id OR p.equipamento_id IN (SELECT i.equipamento_id FROM public.locacao_itens i WHERE i.locacao_id = NEW.id))
     AND public._locacao_plano_dias(p.id) >= p.intervalo_dias
   LIMIT 1;
  IF v_plano IS NOT NULL THEN
    RAISE EXCEPTION 'Manutenção vencida: %. Registre a manutenção antes de entregar o equipamento', v_plano;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.locacao_equipamento_apto() FROM PUBLIC, anon, authenticated;
