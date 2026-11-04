CREATE TABLE IF NOT EXISTS public.pet_internacao_prescricoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id),
  internacao_id uuid NOT NULL REFERENCES public.pet_internacoes(id),
  veterinario_id uuid NOT NULL REFERENCES public.pet_profissionais(id),
  crmv text NOT NULL,
  crmv_uf text NOT NULL,
  medicamento text NOT NULL CHECK (length(btrim(medicamento)) BETWEEN 1 AND 120),
  dose text NOT NULL CHECK (length(btrim(dose)) BETWEEN 1 AND 80),
  via text CHECK (via IS NULL OR length(btrim(via)) BETWEEN 1 AND 40),
  frequencia_horas integer CHECK (frequencia_horas BETWEEN 1 AND 48),
  dias integer CHECK (dias BETWEEN 1 AND 14),
  inicio timestamptz NOT NULL,
  observacao text CHECK (observacao IS NULL OR length(observacao) <= 300),
  situacao text NOT NULL DEFAULT 'ativa' CHECK (situacao IN ('ativa', 'suspensa')),
  suspensa_em timestamptz,
  suspensa_por uuid REFERENCES public.pet_profissionais(id),
  suspensa_motivo text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((frequencia_horas IS NULL) = (dias IS NULL)),
  CHECK (situacao = 'ativa' OR (suspensa_em IS NOT NULL AND suspensa_por IS NOT NULL AND length(btrim(coalesce(suspensa_motivo, ''))) > 0))
);
CREATE INDEX IF NOT EXISTS pet_int_presc_idx ON public.pet_internacao_prescricoes (internacao_id, created_at);

CREATE TABLE IF NOT EXISTS public.pet_internacao_execucoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id),
  prescricao_id uuid NOT NULL REFERENCES public.pet_internacao_prescricoes(id),
  internacao_id uuid NOT NULL REFERENCES public.pet_internacoes(id),
  previsto_em timestamptz NOT NULL,
  situacao text NOT NULL DEFAULT 'pendente' CHECK (situacao IN ('pendente', 'executada', 'nao_executada', 'cancelada')),
  executado_em timestamptz,
  executado_por uuid REFERENCES public.pet_profissionais(id),
  observacao text CHECK (observacao IS NULL OR length(observacao) <= 300),
  CHECK (situacao NOT IN ('executada', 'nao_executada') OR (executado_em IS NOT NULL AND executado_por IS NOT NULL)),
  CHECK (situacao <> 'nao_executada' OR length(btrim(coalesce(observacao, ''))) > 0)
);
CREATE INDEX IF NOT EXISTS pet_int_exec_mapa_idx ON public.pet_internacao_execucoes (tenant_id, situacao, previsto_em);
CREATE INDEX IF NOT EXISTS pet_int_exec_presc_idx ON public.pet_internacao_execucoes (prescricao_id, previsto_em);

CREATE TABLE IF NOT EXISTS public.pet_internacao_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id),
  internacao_id uuid NOT NULL REFERENCES public.pet_internacoes(id),
  produto_id uuid REFERENCES public.produtos(id),
  tipo text NOT NULL CHECK (tipo IN ('produto', 'servico')),
  descricao text NOT NULL CHECK (length(btrim(descricao)) BETWEEN 1 AND 200),
  quantidade numeric(14,3) NOT NULL CHECK (quantidade > 0),
  preco_unitario numeric(14,2) NOT NULL CHECK (preco_unitario >= 0),
  total numeric(14,2) NOT NULL CHECK (total >= 0),
  lancado_por uuid NOT NULL REFERENCES public.pet_profissionais(id),
  baixa_deposito_id uuid REFERENCES public.depositos(id),
  baixa_quantidade numeric(14,3),
  cancelado_em timestamptz,
  cancelado_por uuid REFERENCES public.pet_profissionais(id),
  cancelado_motivo text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((cancelado_em IS NULL) = (cancelado_por IS NULL)),
  CHECK (cancelado_em IS NULL OR length(btrim(coalesce(cancelado_motivo, ''))) > 0)
);
CREATE INDEX IF NOT EXISTS pet_int_itens_idx ON public.pet_internacao_itens (internacao_id, created_at);

CREATE OR REPLACE FUNCTION public._int_prescricao_guarda()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A prescrição não se apaga'; END IF;
  IF OLD.situacao <> 'ativa' THEN RAISE EXCEPTION 'Prescrição suspensa não pode ser alterada'; END IF;
  IF NEW.situacao <> 'suspensa' OR NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.internacao_id IS DISTINCT FROM OLD.internacao_id OR NEW.veterinario_id IS DISTINCT FROM OLD.veterinario_id
     OR NEW.crmv IS DISTINCT FROM OLD.crmv OR NEW.crmv_uf IS DISTINCT FROM OLD.crmv_uf OR NEW.medicamento IS DISTINCT FROM OLD.medicamento
     OR NEW.dose IS DISTINCT FROM OLD.dose OR NEW.via IS DISTINCT FROM OLD.via OR NEW.frequencia_horas IS DISTINCT FROM OLD.frequencia_horas
     OR NEW.dias IS DISTINCT FROM OLD.dias OR NEW.inicio IS DISTINCT FROM OLD.inicio OR NEW.observacao IS DISTINCT FROM OLD.observacao THEN
    RAISE EXCEPTION 'A prescrição só pode ser suspensa; para mudar, suspenda e prescreva de novo';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_int_prescricao_guarda ON public.pet_internacao_prescricoes;
CREATE TRIGGER trg_int_prescricao_guarda BEFORE UPDATE OR DELETE ON public.pet_internacao_prescricoes
  FOR EACH ROW EXECUTE FUNCTION public._int_prescricao_guarda();

CREATE OR REPLACE FUNCTION public._int_execucao_guarda()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A execução não se apaga'; END IF;
  IF OLD.situacao <> 'pendente' THEN RAISE EXCEPTION 'Dose já resolvida não pode ser alterada'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.prescricao_id IS DISTINCT FROM OLD.prescricao_id
     OR NEW.internacao_id IS DISTINCT FROM OLD.internacao_id OR NEW.previsto_em IS DISTINCT FROM OLD.previsto_em THEN
    RAISE EXCEPTION 'Estes dados da dose não mudam';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_int_execucao_guarda ON public.pet_internacao_execucoes;
CREATE TRIGGER trg_int_execucao_guarda BEFORE UPDATE OR DELETE ON public.pet_internacao_execucoes
  FOR EACH ROW EXECUTE FUNCTION public._int_execucao_guarda();

CREATE OR REPLACE FUNCTION public._int_item_guarda()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'O item não se apaga; cancele com o motivo'; END IF;
  IF OLD.cancelado_em IS NOT NULL THEN RAISE EXCEPTION 'Item cancelado não pode ser alterado'; END IF;
  IF NEW.cancelado_em IS NULL OR NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.internacao_id IS DISTINCT FROM OLD.internacao_id OR NEW.produto_id IS DISTINCT FROM OLD.produto_id OR NEW.tipo IS DISTINCT FROM OLD.tipo
     OR NEW.descricao IS DISTINCT FROM OLD.descricao OR NEW.quantidade IS DISTINCT FROM OLD.quantidade
     OR NEW.preco_unitario IS DISTINCT FROM OLD.preco_unitario OR NEW.total IS DISTINCT FROM OLD.total
     OR NEW.lancado_por IS DISTINCT FROM OLD.lancado_por THEN
    RAISE EXCEPTION 'O item só pode ser cancelado';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_int_item_guarda ON public.pet_internacao_itens;
CREATE TRIGGER trg_int_item_guarda BEFORE UPDATE OR DELETE ON public.pet_internacao_itens
  FOR EACH ROW EXECUTE FUNCTION public._int_item_guarda();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pet_internacao_prescricoes', 'pet_internacao_execucoes', 'pet_internacao_itens'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS salao_restrito ON public.%I', t);
    EXECUTE format('CREATE POLICY salao_restrito ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()))', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public._internacao_movimentar(p_produto_id uuid, p_deposito_id uuid, p_tipo public.mov_tipo, p_quantidade numeric, p_motivo text, p_documento text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM set_config('app.clinica_baixa', 'on', true);
  PERFORM public.registrar_movimentacao_interno(p_produto_id, p_deposito_id, p_tipo, p_quantidade, p_motivo, p_documento);
  PERFORM set_config('app.clinica_baixa', 'off', true);
END $$;
REVOKE ALL ON FUNCTION public._internacao_movimentar(uuid, uuid, public.mov_tipo, numeric, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.clinica_internacao_prescrever(p_id uuid, p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  a jsonb := public._internacao_ator(true);
  i public.pet_internacoes;
  v_med text := btrim(coalesce(p_dados ->> 'medicamento', ''));
  v_dose text := btrim(coalesce(p_dados ->> 'dose', ''));
  v_via text := nullif(btrim(coalesce(p_dados ->> 'via', '')), '');
  v_freq integer := nullif(p_dados ->> 'frequencia_horas', '')::integer;
  v_dias integer := nullif(p_dados ->> 'dias', '')::integer;
  v_ini timestamptz := coalesce(nullif(p_dados ->> 'inicio', '')::timestamptz, now());
  v_obs text := nullif(btrim(coalesce(p_dados ->> 'observacao', '')), '');
  v_n integer;
  v_id uuid;
BEGIN
  IF v_med = '' OR length(v_med) > 120 THEN RAISE EXCEPTION 'Informe o medicamento (até 120 letras)'; END IF;
  IF v_dose = '' OR length(v_dose) > 80 THEN RAISE EXCEPTION 'Informe a dose (até 80 letras)'; END IF;
  IF v_via IS NOT NULL AND length(v_via) > 40 THEN RAISE EXCEPTION 'A via aceita até 40 letras'; END IF;
  IF v_obs IS NOT NULL AND length(v_obs) > 300 THEN RAISE EXCEPTION 'A observação aceita até 300 letras'; END IF;
  IF (v_freq IS NULL) <> (v_dias IS NULL) THEN
    RAISE EXCEPTION 'Informe a frequência e a duração, ou deixe as duas vazias para dose única';
  END IF;
  IF v_freq IS NOT NULL AND (v_freq NOT BETWEEN 1 AND 48 OR v_dias NOT BETWEEN 1 AND 14) THEN
    RAISE EXCEPTION 'A frequência vai de 1 a 48 horas e a duração de 1 a 14 dias';
  END IF;
  i := public._internacao_aberta(p_id);
  IF v_ini < i.admitido_em THEN RAISE EXCEPTION 'O início não pode ser anterior à admissão'; END IF;
  IF v_ini > now() + interval '24 hours' THEN RAISE EXCEPTION 'O início pode ser até 24 horas à frente'; END IF;
  v_n := CASE WHEN v_freq IS NULL THEN 1 ELSE greatest(1, floor(v_dias * 24.0 / v_freq))::integer END;

  INSERT INTO public.pet_internacao_prescricoes (tenant_id, internacao_id, veterinario_id, crmv, crmv_uf, medicamento, dose, via, frequencia_horas, dias, inicio, observacao)
  VALUES (i.tenant_id, i.id, (a ->> 'id')::uuid, a ->> 'crmv', a ->> 'crmv_uf', v_med, v_dose, v_via, v_freq, v_dias, v_ini, v_obs)
  RETURNING id INTO v_id;
  INSERT INTO public.pet_internacao_execucoes (tenant_id, prescricao_id, internacao_id, previsto_em)
  SELECT i.tenant_id, v_id, i.id, v_ini + (g * coalesce(v_freq, 0)) * interval '1 hour' FROM generate_series(0, v_n - 1) g;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.clinica_internacao_prescrever(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_internacao_prescrever(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.clinica_prescricao_suspender(p_prescricao_id uuid, p_motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  a jsonb := public._internacao_ator(true);
  p public.pet_internacao_prescricoes;
BEGIN
  IF btrim(coalesce(p_motivo, '')) = '' THEN RAISE EXCEPTION 'Informe o motivo da suspensão'; END IF;
  SELECT * INTO p FROM public.pet_internacao_prescricoes WHERE id = p_prescricao_id AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Prescrição não encontrada'; END IF;
  PERFORM public._internacao_aberta(p.internacao_id);
  IF p.situacao <> 'ativa' THEN RAISE EXCEPTION 'Prescrição já suspensa'; END IF;
  UPDATE public.pet_internacao_prescricoes SET situacao = 'suspensa', suspensa_em = now(), suspensa_por = (a ->> 'id')::uuid, suspensa_motivo = btrim(p_motivo)
   WHERE id = p.id;
  UPDATE public.pet_internacao_execucoes SET situacao = 'cancelada' WHERE prescricao_id = p.id AND situacao = 'pendente';
END $$;
REVOKE ALL ON FUNCTION public.clinica_prescricao_suspender(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_prescricao_suspender(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.clinica_execucao_registrar(p_id uuid, p_situacao text, p_obs text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  a jsonb := public._internacao_ator(false);
  e public.pet_internacao_execucoes;
BEGIN
  IF p_situacao NOT IN ('executada', 'nao_executada') THEN RAISE EXCEPTION 'Informe executada ou não executada'; END IF;
  IF p_situacao = 'nao_executada' AND btrim(coalesce(p_obs, '')) = '' THEN RAISE EXCEPTION 'Informe por que a dose não foi feita'; END IF;
  IF length(coalesce(p_obs, '')) > 300 THEN RAISE EXCEPTION 'A observação aceita até 300 letras'; END IF;
  SELECT * INTO e FROM public.pet_internacao_execucoes WHERE id = p_id AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dose não encontrada'; END IF;
  PERFORM public._internacao_aberta(e.internacao_id);
  IF e.situacao <> 'pendente' THEN RAISE EXCEPTION 'Esta dose já foi resolvida'; END IF;
  IF p_situacao = 'executada' AND e.previsto_em > now() + interval '2 hours' THEN
    RAISE EXCEPTION 'Ainda é cedo: a dose só pode ser registrada a partir de 2 horas antes do horário';
  END IF;
  UPDATE public.pet_internacao_execucoes SET situacao = p_situacao, executado_em = now(), executado_por = (a ->> 'id')::uuid,
         observacao = nullif(btrim(coalesce(p_obs, '')), '')
   WHERE id = e.id;
END $$;
REVOKE ALL ON FUNCTION public.clinica_execucao_registrar(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_execucao_registrar(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.clinica_execucoes_mapa(p_horas integer DEFAULT 12)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  a jsonb := public._internacao_ator(false);
  v_tenant uuid := public.current_tenant_id();
BEGIN
  IF p_horas IS NULL OR p_horas < 1 OR p_horas > 72 THEN RAISE EXCEPTION 'O mapa mostra de 1 a 72 horas à frente'; END IF;
  RETURN jsonb_build_object('agora', now(), 'itens', coalesce((
    SELECT jsonb_agg(x ORDER BY x ->> 'previsto_em')
      FROM (
        SELECT jsonb_build_object(
                 'id', e.id, 'previsto_em', e.previsto_em, 'situacao', e.situacao, 'executado_em', e.executado_em,
                 'executado_por', ex.nome, 'observacao', e.observacao,
                 'medicamento', p.medicamento, 'dose', p.dose, 'via', p.via, 'prescricao_observacao', p.observacao,
                 'internacao_id', i.id, 'pet', jsonb_build_object('id', pt.id, 'nome', pt.nome, 'alergias', pt.alergias), 'box', b.nome) AS x
          FROM public.pet_internacao_execucoes e
          JOIN public.pet_internacao_prescricoes p ON p.id = e.prescricao_id
          JOIN public.pet_internacoes i ON i.id = e.internacao_id AND i.situacao = 'internado'
          JOIN public.pets pt ON pt.id = i.pet_id
          JOIN public.pet_boxes b ON b.id = i.box_id
          LEFT JOIN public.pet_profissionais ex ON ex.id = e.executado_por
         WHERE e.tenant_id = v_tenant
           AND ((e.situacao = 'pendente' AND e.previsto_em <= now() + make_interval(hours => p_horas))
                OR (e.situacao IN ('executada', 'nao_executada') AND e.executado_em >= now() - interval '4 hours'))
         ORDER BY e.previsto_em LIMIT 600
      ) q), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.clinica_execucoes_mapa(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_execucoes_mapa(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.clinica_internacao_catalogo(p_busca text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  a jsonb := public._internacao_ator(false);
  v_busca text := btrim(coalesce(p_busca, ''));
BEGIN
  IF length(v_busca) < 2 THEN RAISE EXCEPTION 'Digite ao menos 2 letras do produto ou serviço'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', pr.id, 'descricao', pr.descricao, 'preco_venda', pr.preco_venda, 'controla_estoque', pr.controla_estoque) ORDER BY pr.descricao)
      FROM (SELECT * FROM public.produtos WHERE tenant_id = public.current_tenant_id() AND ativo AND descricao ILIKE '%' || v_busca || '%' ORDER BY descricao LIMIT 30) pr
  ), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.clinica_internacao_catalogo(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_internacao_catalogo(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.clinica_internacao_item_lancar(p_id uuid, p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  a jsonb := public._internacao_ator(false);
  i public.pet_internacoes;
  v_prod uuid := nullif(p_dados ->> 'produto_id', '')::uuid;
  v_desc text := btrim(coalesce(p_dados ->> 'descricao', ''));
  v_qtd numeric := coalesce(nullif(p_dados ->> 'quantidade', '')::numeric, 1);
  v_preco numeric := nullif(p_dados ->> 'preco', '')::numeric;
  v_dep uuid := nullif(p_dados ->> 'deposito_id', '')::uuid;
  v_tipo text := 'servico';
  v_baixa_dep uuid;
  pr public.produtos%ROWTYPE;
  v_id uuid;
BEGIN
  IF v_qtd <= 0 OR v_qtd > 100000 THEN RAISE EXCEPTION 'A quantidade precisa ser maior que zero'; END IF;
  IF v_preco IS NOT NULL AND v_preco < 0 THEN RAISE EXCEPTION 'O preço não pode ser negativo'; END IF;
  i := public._internacao_aberta(p_id);
  IF v_prod IS NOT NULL THEN
    SELECT * INTO pr FROM public.produtos WHERE id = v_prod AND tenant_id = i.tenant_id AND ativo;
    IF NOT FOUND THEN RAISE EXCEPTION 'Produto ou serviço não encontrado'; END IF;
    IF v_desc = '' THEN v_desc := pr.descricao; END IF;
    v_preco := coalesce(v_preco, pr.preco_venda, 0);
    IF pr.controla_estoque THEN
      v_tipo := 'produto';
      IF v_dep IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.depositos WHERE id = v_dep AND tenant_id = i.tenant_id) THEN RAISE EXCEPTION 'Depósito não encontrado'; END IF;
      v_baixa_dep := coalesce(v_dep, (SELECT d.id FROM public.depositos d WHERE d.tenant_id = i.tenant_id AND d.ativo ORDER BY d.created_at LIMIT 1));
      IF v_baixa_dep IS NULL THEN RAISE EXCEPTION 'Cadastre um depósito para dar baixa nos produtos'; END IF;
    END IF;
  ELSE
    v_preco := coalesce(v_preco, 0);
  END IF;
  IF v_desc = '' OR length(v_desc) > 200 THEN RAISE EXCEPTION 'Informe o produto ou o serviço (até 200 letras)'; END IF;
  IF v_baixa_dep IS NOT NULL THEN
    PERFORM public._internacao_movimentar(v_prod, v_baixa_dep, 'saida'::public.mov_tipo, v_qtd, 'Material usado na internação', 'INT ' || left(i.id::text, 8));
  END IF;
  INSERT INTO public.pet_internacao_itens (tenant_id, internacao_id, produto_id, tipo, descricao, quantidade, preco_unitario, total, lancado_por, baixa_deposito_id, baixa_quantidade)
  VALUES (i.tenant_id, i.id, v_prod, v_tipo, v_desc, v_qtd, v_preco, round(v_qtd * v_preco, 2), (a ->> 'id')::uuid, v_baixa_dep, CASE WHEN v_baixa_dep IS NOT NULL THEN v_qtd END)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.clinica_internacao_item_lancar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_internacao_item_lancar(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.clinica_internacao_item_cancelar(p_item_id uuid, p_motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  a jsonb := public._internacao_ator(true);
  it public.pet_internacao_itens;
BEGIN
  IF btrim(coalesce(p_motivo, '')) = '' THEN RAISE EXCEPTION 'Informe o motivo do cancelamento'; END IF;
  SELECT * INTO it FROM public.pet_internacao_itens WHERE id = p_item_id AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item não encontrado'; END IF;
  PERFORM public._internacao_aberta(it.internacao_id);
  IF it.cancelado_em IS NOT NULL THEN RAISE EXCEPTION 'Item já cancelado'; END IF;
  IF it.baixa_deposito_id IS NOT NULL THEN
    PERFORM public._internacao_movimentar(it.produto_id, it.baixa_deposito_id, 'entrada'::public.mov_tipo, it.baixa_quantidade, 'Estorno de material da internação', 'INT ' || left(it.internacao_id::text, 8));
  END IF;
  UPDATE public.pet_internacao_itens SET cancelado_em = now(), cancelado_por = (a ->> 'id')::uuid, cancelado_motivo = btrim(p_motivo),
         baixa_deposito_id = NULL, baixa_quantidade = NULL
   WHERE id = it.id;
END $$;
REVOKE ALL ON FUNCTION public.clinica_internacao_item_cancelar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_internacao_item_cancelar(uuid, text) TO authenticated;

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
  UPDATE public.pet_internacao_execucoes SET situacao = 'cancelada' WHERE internacao_id = i.id AND situacao = 'pendente';
  IF p_tipo = 'obito' THEN
    UPDATE public.pets SET ativo = false, obito_em = (v_quando AT TIME ZONE 'America/Sao_Paulo')::date WHERE id = i.pet_id AND tenant_id = i.tenant_id;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.clinica_internacao_encerrar(uuid, text, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_internacao_encerrar(uuid, text, text, timestamptz) TO authenticated;

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
    'prescricoes', coalesce((SELECT jsonb_agg(jsonb_build_object(
                  'id', pr.id, 'medicamento', pr.medicamento, 'dose', pr.dose, 'via', pr.via, 'frequencia_horas', pr.frequencia_horas, 'dias', pr.dias,
                  'inicio', pr.inicio, 'observacao', pr.observacao, 'situacao', pr.situacao, 'suspensa_em', pr.suspensa_em, 'suspensa_motivo', pr.suspensa_motivo,
                  'veterinario', pv.nome, 'crmv', pr.crmv, 'crmv_uf', pr.crmv_uf,
                  'execucoes', coalesce((SELECT jsonb_agg(jsonb_build_object('id', e.id, 'previsto_em', e.previsto_em, 'situacao', e.situacao, 'executado_em', e.executado_em,
                                'executado_por', ex.nome, 'observacao', e.observacao) ORDER BY e.previsto_em)
                                FROM public.pet_internacao_execucoes e LEFT JOIN public.pet_profissionais ex ON ex.id = e.executado_por
                               WHERE e.prescricao_id = pr.id), '[]'::jsonb)) ORDER BY pr.created_at DESC)
                  FROM public.pet_internacao_prescricoes pr JOIN public.pet_profissionais pv ON pv.id = pr.veterinario_id WHERE pr.internacao_id = i.id), '[]'::jsonb),
    'itens', coalesce((SELECT jsonb_agg(jsonb_build_object('id', it.id, 'tipo', it.tipo, 'descricao', it.descricao, 'quantidade', it.quantidade,
                  'preco_unitario', it.preco_unitario, 'total', it.total, 'lancado_por', lp.nome, 'created_at', it.created_at,
                  'cancelado_em', it.cancelado_em, 'cancelado_motivo', it.cancelado_motivo) ORDER BY it.created_at)
                  FROM public.pet_internacao_itens it JOIN public.pet_profissionais lp ON lp.id = it.lancado_por WHERE it.internacao_id = i.id), '[]'::jsonb),
    'total_itens', coalesce((SELECT sum(it.total) FROM public.pet_internacao_itens it WHERE it.internacao_id = i.id AND it.cancelado_em IS NULL), 0),
    'sou_veterinario', v_vet);
END $$;
REVOKE ALL ON FUNCTION public.clinica_internacao_obter(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_internacao_obter(uuid) TO authenticated;