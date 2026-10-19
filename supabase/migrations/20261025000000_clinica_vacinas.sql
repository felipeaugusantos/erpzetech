-- Clínica (Fase 3, PR 3): vacinas e vermífugos. A clínica mantém o catálogo (com o intervalo de reforço); o veterinário registra a aplicação
-- dentro do atendimento agendado do serviço de vacina, escolhendo o lote (baixa 1 dose do lote e do estoque); vacina feita em outro lugar
-- entra no cartão sem baixa. A aplicação não se apaga nem se reescreve: erro vira cancelamento com motivo, que devolve a dose ao lote.
-- O item cobrável é o serviço da agenda; o produto do catálogo só serve para baixar o lote e nunca vai para a venda.
-- Nenhuma tabela tem acesso direto: tudo passa por funções que exigem a clínica liberada (clinica_liberada).

-- ============ tabelas ============
CREATE TABLE IF NOT EXISTS public.pet_vacinas_catalogo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (length(btrim(nome)) > 0),
  tipo text NOT NULL CHECK (tipo IN ('vacina', 'vermifugo')),
  especie text NOT NULL DEFAULT 'todas' CHECK (especie IN ('cao', 'gato', 'todas')),
  doses_serie integer NOT NULL DEFAULT 1 CHECK (doses_serie BETWEEN 1 AND 10),
  intervalo_serie_dias integer CHECK (intervalo_serie_dias BETWEEN 1 AND 365),
  reforco_dias integer NOT NULL CHECK (reforco_dias BETWEEN 1 AND 1100),
  idade_minima_dias integer CHECK (idade_minima_dias BETWEEN 0 AND 3650),
  produto_id uuid NOT NULL REFERENCES public.produtos(id),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (doses_serie = 1 OR intervalo_serie_dias IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS pet_vacinas_catalogo_nome_idx ON public.pet_vacinas_catalogo (tenant_id, lower(btrim(nome)), especie);

CREATE TABLE IF NOT EXISTS public.pet_vacinacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id),
  pet_id uuid NOT NULL REFERENCES public.pets(id),
  catalogo_id uuid NOT NULL REFERENCES public.pet_vacinas_catalogo(id),
  -- nome e tipo como estavam quando foi aplicada
  nome text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('vacina', 'vermifugo')),
  origem text NOT NULL CHECK (origem IN ('clinica', 'outro_local')),
  dose_tipo text NOT NULL CHECK (dose_tipo IN ('serie', 'reforco')),
  dose_numero integer NOT NULL CHECK (dose_numero >= 1),
  aplicada_em date NOT NULL,
  proxima_dose_em date,
  -- só aplicação da clínica
  agendamento_id uuid REFERENCES public.pet_agendamentos(id),
  veterinario_id uuid REFERENCES public.pet_profissionais(id),
  aplicador_id uuid REFERENCES public.pet_profissionais(id),
  estoque_lote_id uuid REFERENCES public.estoque_lotes(id),
  deposito_id uuid REFERENCES public.depositos(id),
  lote text,
  validade_lote date,
  local_aplicacao text,
  -- só aplicação de outro local
  informado_por text,
  registrado_por uuid DEFAULT auth.uid(),
  observacoes text,
  situacao text NOT NULL DEFAULT 'ativa' CHECK (situacao IN ('ativa', 'cancelada')),
  cancelada_em timestamptz,
  cancelada_motivo text,
  cancelada_por uuid,
  -- relógio real (não o da transação): duas aplicações do mesmo atendimento mantêm a ordem em que foram feitas
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((situacao = 'cancelada') = (cancelada_em IS NOT NULL)),
  CHECK (origem <> 'clinica' OR (agendamento_id IS NOT NULL AND veterinario_id IS NOT NULL AND estoque_lote_id IS NOT NULL AND lote IS NOT NULL)),
  CHECK (origem <> 'outro_local' OR (informado_por IS NOT NULL AND estoque_lote_id IS NULL AND agendamento_id IS NULL))
);
CREATE INDEX IF NOT EXISTS pet_vacinacoes_pet_idx ON public.pet_vacinacoes (tenant_id, pet_id, aplicada_em DESC);
CREATE INDEX IF NOT EXISTS pet_vacinacoes_proxima_idx ON public.pet_vacinacoes (tenant_id, proxima_dose_em) WHERE situacao = 'ativa';

-- A aplicação só muda para ser cancelada (com motivo); nunca se apaga.
CREATE OR REPLACE FUNCTION public._clinica_vacinacao_guarda()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A aplicação de vacina não se apaga: cancele com motivo'; END IF;
  IF OLD.situacao = 'cancelada' THEN RAISE EXCEPTION 'Aplicação cancelada não muda'; END IF;
  IF NEW.situacao <> 'cancelada' OR coalesce(btrim(NEW.cancelada_motivo), '') = '' THEN
    RAISE EXCEPTION 'A aplicação só muda para ser cancelada, com motivo';
  END IF;
  IF (to_jsonb(NEW) - 'situacao' - 'cancelada_em' - 'cancelada_motivo' - 'cancelada_por')
     IS DISTINCT FROM (to_jsonb(OLD) - 'situacao' - 'cancelada_em' - 'cancelada_motivo' - 'cancelada_por') THEN
    RAISE EXCEPTION 'Os dados da aplicação não mudam';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_clinica_vacinacao_guarda ON public.pet_vacinacoes;
CREATE TRIGGER trg_clinica_vacinacao_guarda BEFORE UPDATE OR DELETE ON public.pet_vacinacoes
  FOR EACH ROW EXECUTE FUNCTION public._clinica_vacinacao_guarda();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pet_vacinas_catalogo', 'pet_vacinacoes'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('CREATE POLICY salao_restrito ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()))', t);
  END LOOP;
  EXECUTE 'CREATE TRIGGER trg_pet_vacinas_catalogo_updated BEFORE UPDATE ON public.pet_vacinas_catalogo FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()';
END $$;

-- ============ apoio ============
-- Perfil e clínica liberada, para quem consulta (gestão, veterinário e recepção).
CREATE OR REPLACE FUNCTION public._clinica_exige_leitura()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'veterinario', 'vendedor', 'caixa']);
  IF NOT public.clinica_liberada() THEN RAISE EXCEPTION 'A clínica não está liberada para esta empresa'; END IF;
END $$;
REVOKE ALL ON FUNCTION public._clinica_exige_leitura() FROM PUBLIC, anon, authenticated;

-- A baixa de estoque da dose. O veterinário é um perfil restrito (como o garçom), e o movimento de estoque recusa perfil restrito:
-- aqui a função da clínica, que já conferiu perfil, clínica liberada e lote, liga um aviso só desta transação para o movimento aceitar.
-- Quem chama o movimento por fora (a função pública de estoque) continua barrado pela própria trava dela, então o aviso não abre nada.
DO $$
DECLARE
  def text;
  nova text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'registrar_movimentacao_interno';
  IF def IS NULL THEN RAISE EXCEPTION 'registrar_movimentacao_interno não encontrada'; END IF;
  IF position('app.clinica_baixa' IN def) > 0 THEN RETURN; END IF;
  nova := replace(def, E'  PERFORM public.exige_nao_salao();\n',
    E'  IF coalesce(current_setting(''app.clinica_baixa'', true), '''') <> ''on'' THEN PERFORM public.exige_nao_salao(); END IF;\n');
  IF nova = def THEN RAISE EXCEPTION 'registrar_movimentacao_interno: trecho esperado não encontrado'; END IF;
  EXECUTE nova;
END $$;

CREATE OR REPLACE FUNCTION public._clinica_movimentar_dose(p_produto_id uuid, p_deposito_id uuid, p_tipo public.mov_tipo, p_motivo text, p_documento text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM set_config('app.clinica_baixa', 'on', true);
  PERFORM public.registrar_movimentacao_interno(p_produto_id, p_deposito_id, p_tipo, 1, p_motivo, p_documento);
  PERFORM set_config('app.clinica_baixa', 'off', true);
END $$;
REVOKE ALL ON FUNCTION public._clinica_movimentar_dose(uuid, uuid, public.mov_tipo, text, text) FROM PUBLIC, anon, authenticated;

-- Qual é a próxima dose do pet para um item do catálogo: ainda na série, ou reforço.
CREATE OR REPLACE FUNCTION public._clinica_proxima_dose(p_pet_id uuid, p_catalogo_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE WHEN n < c.doses_serie THEN jsonb_build_object('dose_tipo', 'serie', 'dose_numero', n + 1)
              ELSE jsonb_build_object('dose_tipo', 'reforco', 'dose_numero', n - c.doses_serie + 1) END
    FROM public.pet_vacinas_catalogo c,
         LATERAL (SELECT count(*)::int AS n FROM public.pet_vacinacoes v WHERE v.pet_id = p_pet_id AND v.catalogo_id = c.id AND v.situacao = 'ativa') q
   WHERE c.id = p_catalogo_id
$$;
REVOKE ALL ON FUNCTION public._clinica_proxima_dose(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ============ catálogo ============
CREATE OR REPLACE FUNCTION public.clinica_vacinas_catalogo()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public._clinica_exige_leitura();
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.nome, 'tipo', c.tipo, 'especie', c.especie, 'doses_serie', c.doses_serie,
             'intervalo_serie_dias', c.intervalo_serie_dias, 'reforco_dias', c.reforco_dias, 'idade_minima_dias', c.idade_minima_dias,
             'produto_id', c.produto_id, 'produto', p.descricao, 'ativo', c.ativo) ORDER BY c.nome)
      FROM public.pet_vacinas_catalogo c JOIN public.produtos p ON p.id = c.produto_id
     WHERE c.tenant_id = public.current_tenant_id()
  ), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.clinica_vacinas_catalogo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_vacinas_catalogo() TO authenticated;

-- A clínica edita o catálogo: gestão e veterinário. O produto precisa controlar estoque (a dose baixa o lote).
CREATE OR REPLACE FUNCTION public.clinica_vacina_catalogo_salvar(p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_id uuid := nullif(p_dados ->> 'id', '')::uuid;
  v_nome text := btrim(coalesce(p_dados ->> 'nome', ''));
  v_tipo text := coalesce(nullif(p_dados ->> 'tipo', ''), 'vacina');
  v_especie text := coalesce(nullif(p_dados ->> 'especie', ''), 'todas');
  v_doses integer;
  v_inter integer;
  v_reforco integer;
  v_idade integer;
  v_prod uuid := nullif(p_dados ->> 'produto_id', '')::uuid;
  v_ativo boolean := coalesce((p_dados ->> 'ativo')::boolean, true);
BEGIN
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'veterinario']);
  IF NOT public.clinica_liberada() THEN RAISE EXCEPTION 'A clínica não está liberada para esta empresa'; END IF;
  BEGIN
    v_doses := coalesce(nullif(p_dados ->> 'doses_serie', '')::integer, 1);
    v_inter := nullif(p_dados ->> 'intervalo_serie_dias', '')::integer;
    v_reforco := nullif(p_dados ->> 'reforco_dias', '')::integer;
    v_idade := nullif(p_dados ->> 'idade_minima_dias', '')::integer;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Confira os números do catálogo';
  END;
  IF v_nome = '' THEN RAISE EXCEPTION 'Informe o nome'; END IF;
  IF v_tipo NOT IN ('vacina', 'vermifugo') THEN RAISE EXCEPTION 'Tipo inválido'; END IF;
  IF v_especie NOT IN ('cao', 'gato', 'todas') THEN RAISE EXCEPTION 'Espécie inválida'; END IF;
  IF v_doses < 1 OR v_doses > 10 THEN RAISE EXCEPTION 'A série tem de 1 a 10 doses'; END IF;
  IF v_doses > 1 AND (v_inter IS NULL OR v_inter < 1 OR v_inter > 365) THEN RAISE EXCEPTION 'Informe o intervalo entre as doses da série (1 a 365 dias)'; END IF;
  IF v_doses = 1 THEN v_inter := NULL; END IF;
  IF v_reforco IS NULL OR v_reforco < 1 OR v_reforco > 1100 THEN RAISE EXCEPTION 'Informe o intervalo do reforço em dias (1 a 1100)'; END IF;
  IF v_idade IS NOT NULL AND (v_idade < 0 OR v_idade > 3650) THEN RAISE EXCEPTION 'Idade mínima inválida'; END IF;
  PERFORM 1 FROM public.produtos WHERE id = v_prod AND tenant_id = v_tenant AND controla_estoque;
  IF NOT FOUND THEN RAISE EXCEPTION 'Escolha o produto da dose (um produto de estoque desta empresa)'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('clinica_vacina:' || v_tenant::text, 0));
  IF EXISTS (SELECT 1 FROM public.pet_vacinas_catalogo c WHERE c.tenant_id = v_tenant AND lower(btrim(c.nome)) = lower(v_nome)
                AND c.especie = v_especie AND c.id IS DISTINCT FROM v_id) THEN
    RAISE EXCEPTION 'Já existe um item com este nome para esta espécie';
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO public.pet_vacinas_catalogo (tenant_id, nome, tipo, especie, doses_serie, intervalo_serie_dias, reforco_dias, idade_minima_dias, produto_id, ativo)
    VALUES (v_tenant, v_nome, v_tipo, v_especie, v_doses, v_inter, v_reforco, v_idade, v_prod, v_ativo) RETURNING id INTO v_id;
  ELSE
    -- aplicações antigas guardam nome e tipo como foram feitas; mudar o catálogo vale para as próximas
    UPDATE public.pet_vacinas_catalogo SET nome = v_nome, tipo = v_tipo, especie = v_especie, doses_serie = v_doses, intervalo_serie_dias = v_inter,
           reforco_dias = v_reforco, idade_minima_dias = v_idade, produto_id = v_prod, ativo = v_ativo
     WHERE id = v_id AND tenant_id = v_tenant;
    IF NOT FOUND THEN RAISE EXCEPTION 'Item do catálogo não encontrado'; END IF;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.clinica_vacina_catalogo_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_vacina_catalogo_salvar(jsonb) TO authenticated;

-- ============ apoio do veterinário na aplicação ============
-- Lotes com saldo e dentro da validade do produto do item (o veterinário não lê o estoque direto).
CREATE OR REPLACE FUNCTION public.clinica_lotes_vacina(p_catalogo_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  PERFORM public._clinica_vet();
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', l.id, 'lote', l.lote, 'validade', l.validade, 'quantidade', l.quantidade,
                                         'deposito', d.nome, 'deposito_id', l.deposito_id) ORDER BY l.validade NULLS LAST, l.lote)
      FROM public.pet_vacinas_catalogo c
      JOIN public.estoque_lotes l ON l.produto_id = c.produto_id AND l.tenant_id = c.tenant_id
      JOIN public.depositos d ON d.id = l.deposito_id
     WHERE c.id = p_catalogo_id AND c.tenant_id = public.current_tenant_id()
       AND l.quantidade >= 1 AND (l.validade IS NULL OR l.validade >= v_hoje)
  ), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.clinica_lotes_vacina(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_lotes_vacina(uuid) TO authenticated;

-- Quem pode ser o aplicador sob a responsabilidade do veterinário.
CREATE OR REPLACE FUNCTION public.clinica_aplicadores()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public._clinica_vet();
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.nome, 'funcao', p.funcao) ORDER BY p.nome)
                     FROM public.pet_profissionais p
                    WHERE p.tenant_id = public.current_tenant_id() AND p.ativo AND p.funcao IN ('veterinario', 'auxiliar')), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.clinica_aplicadores() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_aplicadores() TO authenticated;

-- ============ aplicar (dentro do atendimento agendado do serviço de vacina) ============
-- p_dados: catalogo_id, estoque_lote_id, aplicada_em (opcional, padrão hoje), aplicador_id (opcional), local_aplicacao, observacoes,
-- proxima_dose_em (opcional: se vier vazio fica sem próxima dose; se não vier, calcula). Devolve a aplicação e avisos que não bloqueiam.
CREATE OR REPLACE FUNCTION public.clinica_vacina_aplicar(p_agendamento_id uuid, p_dados jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_vet uuid := public._clinica_vet();
  v_tenant uuid := public.current_tenant_id();
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  ag public.pet_agendamentos%ROWTYPE;
  c public.pet_vacinas_catalogo%ROWTYPE;
  pt public.pets%ROWTYPE;
  l public.estoque_lotes%ROWTYPE;
  v_cat uuid := nullif(p_dados ->> 'catalogo_id', '')::uuid;
  v_lote uuid := nullif(p_dados ->> 'estoque_lote_id', '')::uuid;
  v_aplicador uuid := nullif(p_dados ->> 'aplicador_id', '')::uuid;
  v_em date := coalesce(nullif(p_dados ->> 'aplicada_em', '')::date, v_hoje);
  v_prox date;
  v_dose jsonb;
  v_avisos jsonb := '[]'::jsonb;
  v_id uuid;
  v_idade integer;
  v_depois integer;
BEGIN
  SELECT * INTO ag FROM public.pet_agendamentos WHERE id = p_agendamento_id AND tenant_id = v_tenant AND profissional_id = v_vet FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Atendimento não encontrado na sua agenda'; END IF;
  IF ag.situacao NOT IN ('agendado', 'confirmado', 'em_atendimento') THEN
    RAISE EXCEPTION 'Este atendimento está "%": não dá para registrar vacina', ag.situacao;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pet_agendamento_itens i JOIN public.pet_servicos s ON s.id = i.servico_id
                  WHERE i.agendamento_id = ag.id AND s.categoria = 'vacina') THEN
    RAISE EXCEPTION 'Este agendamento não tem serviço de vacina';
  END IF;
  IF v_em > v_hoje THEN RAISE EXCEPTION 'A aplicação não pode ser no futuro'; END IF;
  IF v_em < v_hoje - 7 THEN RAISE EXCEPTION 'Para vacina de outra data use o registro de vacina aplicada em outro local'; END IF;

  SELECT * INTO c FROM public.pet_vacinas_catalogo WHERE id = v_cat AND tenant_id = v_tenant AND ativo;
  IF NOT FOUND THEN RAISE EXCEPTION 'Escolha a vacina ou o vermífugo do catálogo'; END IF;
  SELECT * INTO pt FROM public.pets WHERE id = ag.pet_id;
  IF c.especie <> 'todas' AND c.especie <> pt.especie THEN RAISE EXCEPTION '% não é indicada para esta espécie', c.nome; END IF;

  IF v_aplicador IS NOT NULL THEN
    PERFORM 1 FROM public.pet_profissionais WHERE id = v_aplicador AND tenant_id = v_tenant AND ativo AND funcao IN ('veterinario', 'auxiliar');
    IF NOT FOUND THEN RAISE EXCEPTION 'Aplicador não encontrado (veterinário ou auxiliar ativo)'; END IF;
  END IF;

  -- o lote precisa ser do produto do item, ter dose e estar na validade; trava o lote antes de baixar
  SELECT * INTO l FROM public.estoque_lotes WHERE id = v_lote AND tenant_id = v_tenant AND produto_id = c.produto_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Escolha um lote deste produto'; END IF;
  IF l.validade IS NOT NULL AND l.validade < v_em THEN RAISE EXCEPTION 'O lote % está vencido', l.lote; END IF;
  IF l.quantidade < 1 THEN RAISE EXCEPTION 'O lote % não tem saldo', l.lote; END IF;

  v_dose := public._clinica_proxima_dose(pt.id, c.id);
  -- ainda na série: a próxima é a seguinte da série; a última dose da série (e as de reforço) já agenda o reforço
  IF v_dose ->> 'dose_tipo' = 'serie' AND (v_dose ->> 'dose_numero')::int < c.doses_serie THEN v_prox := v_em + c.intervalo_serie_dias;
  ELSE v_prox := v_em + c.reforco_dias; END IF;
  IF p_dados ? 'proxima_dose_em' THEN
    BEGIN
      v_prox := nullif(btrim(coalesce(p_dados ->> 'proxima_dose_em', '')), '')::date;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
      RAISE EXCEPTION 'Data da próxima dose inválida';
    END;
    IF v_prox IS NOT NULL AND v_prox <= v_em THEN RAISE EXCEPTION 'A próxima dose precisa ser depois da aplicação'; END IF;
  END IF;

  -- avisos que não bloqueiam: idade mínima e dose repetida no mesmo dia
  IF c.idade_minima_dias IS NOT NULL AND pt.nascimento IS NOT NULL THEN
    v_idade := v_em - pt.nascimento;
    IF v_idade < c.idade_minima_dias THEN
      v_avisos := v_avisos || to_jsonb(format('O pet tem %s dias e a idade mínima do item é %s dias: confirme a indicação.', v_idade, c.idade_minima_dias));
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.pet_vacinacoes v WHERE v.pet_id = pt.id AND v.catalogo_id = c.id AND v.situacao = 'ativa' AND v.aplicada_em = v_em) THEN
    v_avisos := v_avisos || to_jsonb('Já existe uma aplicação deste item para o pet nesta data.'::text);
  END IF;

  -- baixa 1 dose do lote e do estoque
  UPDATE public.estoque_lotes SET quantidade = quantidade - 1, updated_at = now() WHERE id = l.id;
  INSERT INTO public.estoque_lote_movimentos (tenant_id, lote_id, tipo, quantidade, saldo_posterior, documento, motivo)
  VALUES (v_tenant, l.id, 'saida', 1, l.quantidade - 1, 'Vacinação ' || pt.nome, 'Aplicação na clínica');
  PERFORM public._clinica_movimentar_dose(c.produto_id, l.deposito_id, 'saida'::public.mov_tipo, 'Aplicação na clínica', 'Vacinação ' || pt.nome);

  INSERT INTO public.pet_vacinacoes (tenant_id, pet_id, catalogo_id, nome, tipo, origem, dose_tipo, dose_numero, aplicada_em, proxima_dose_em,
      agendamento_id, veterinario_id, aplicador_id, estoque_lote_id, deposito_id, lote, validade_lote, local_aplicacao, observacoes)
  VALUES (v_tenant, pt.id, c.id, c.nome, c.tipo, 'clinica', v_dose ->> 'dose_tipo', (v_dose ->> 'dose_numero')::int, v_em, v_prox,
      ag.id, v_vet, coalesce(v_aplicador, v_vet), l.id, l.deposito_id, l.lote, l.validade,
      nullif(btrim(coalesce(p_dados ->> 'local_aplicacao', '')), ''), nullif(btrim(coalesce(p_dados ->> 'observacoes', '')), ''))
  RETURNING id INTO v_id;

  IF ag.situacao <> 'em_atendimento' THEN UPDATE public.pet_agendamentos SET situacao = 'em_atendimento' WHERE id = ag.id; END IF;
  INSERT INTO public.clinica_acessos (tenant_id, pet_id, acao) VALUES (v_tenant, pt.id, 'vacinacao');
  RETURN jsonb_build_object('id', v_id, 'dose_tipo', v_dose ->> 'dose_tipo', 'dose_numero', (v_dose ->> 'dose_numero')::int,
                            'proxima_dose_em', v_prox, 'avisos', v_avisos);
END $$;
REVOKE ALL ON FUNCTION public.clinica_vacina_aplicar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_vacina_aplicar(uuid, jsonb) TO authenticated;

-- ============ aplicada em outro local: entra no cartão sem baixa de estoque ============
CREATE OR REPLACE FUNCTION public.clinica_vacina_registrar_externa(p_pet_id uuid, p_dados jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_vet uuid := public._clinica_vet();
  v_tenant uuid := public.current_tenant_id();
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  pt public.pets%ROWTYPE;
  c public.pet_vacinas_catalogo%ROWTYPE;
  v_em date;
  v_prox date;
  v_dose jsonb;
  v_informado text := nullif(btrim(coalesce(p_dados ->> 'informado_por', '')), '');
  v_id uuid;
BEGIN
  SELECT * INTO pt FROM public.pets WHERE id = p_pet_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paciente não encontrado'; END IF;
  SELECT * INTO c FROM public.pet_vacinas_catalogo WHERE id = nullif(p_dados ->> 'catalogo_id', '')::uuid AND tenant_id = v_tenant AND ativo;
  IF NOT FOUND THEN RAISE EXCEPTION 'Escolha a vacina ou o vermífugo do catálogo'; END IF;
  IF v_informado IS NULL THEN RAISE EXCEPTION 'Informe quem passou a informação (tutor, carteira, outra clínica)'; END IF;
  BEGIN
    v_em := (p_dados ->> 'aplicada_em')::date;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'Data da aplicação inválida';
  END;
  IF v_em IS NULL THEN RAISE EXCEPTION 'Informe a data da aplicação'; END IF;
  IF v_em > v_hoje THEN RAISE EXCEPTION 'A aplicação não pode ser no futuro'; END IF;
  IF pt.nascimento IS NOT NULL AND v_em < pt.nascimento THEN RAISE EXCEPTION 'A aplicação é anterior ao nascimento do pet'; END IF;

  v_dose := public._clinica_proxima_dose(pt.id, c.id);
  IF v_dose ->> 'dose_tipo' = 'serie' AND (v_dose ->> 'dose_numero')::int < c.doses_serie THEN v_prox := v_em + c.intervalo_serie_dias;
  ELSE v_prox := v_em + c.reforco_dias; END IF;
  IF p_dados ? 'proxima_dose_em' THEN
    BEGIN
      v_prox := nullif(btrim(coalesce(p_dados ->> 'proxima_dose_em', '')), '')::date;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
      RAISE EXCEPTION 'Data da próxima dose inválida';
    END;
    IF v_prox IS NOT NULL AND v_prox <= v_em THEN RAISE EXCEPTION 'A próxima dose precisa ser depois da aplicação'; END IF;
  END IF;

  INSERT INTO public.pet_vacinacoes (tenant_id, pet_id, catalogo_id, nome, tipo, origem, dose_tipo, dose_numero, aplicada_em, proxima_dose_em,
      lote, informado_por, observacoes)
  VALUES (v_tenant, pt.id, c.id, c.nome, c.tipo, 'outro_local', v_dose ->> 'dose_tipo', (v_dose ->> 'dose_numero')::int, v_em, v_prox,
      nullif(btrim(coalesce(p_dados ->> 'lote', '')), ''), v_informado, nullif(btrim(coalesce(p_dados ->> 'observacoes', '')), ''))
  RETURNING id INTO v_id;
  INSERT INTO public.clinica_acessos (tenant_id, pet_id, acao) VALUES (v_tenant, pt.id, 'vacinacao');
  RETURN jsonb_build_object('id', v_id, 'dose_tipo', v_dose ->> 'dose_tipo', 'dose_numero', (v_dose ->> 'dose_numero')::int, 'proxima_dose_em', v_prox);
END $$;
REVOKE ALL ON FUNCTION public.clinica_vacina_registrar_externa(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_vacina_registrar_externa(uuid, jsonb) TO authenticated;

-- ============ cancelar (erro de registro): devolve a dose ao lote e ao estoque ============
CREATE OR REPLACE FUNCTION public.clinica_vacina_cancelar(p_id uuid, p_motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_vet uuid := public._clinica_vet();
  v_tenant uuid := public.current_tenant_id();
  v_motivo text := btrim(coalesce(p_motivo, ''));
  a public.pet_vacinacoes%ROWTYPE;
  l public.estoque_lotes%ROWTYPE;
BEGIN
  IF v_motivo = '' THEN RAISE EXCEPTION 'Informe o motivo do cancelamento'; END IF;
  SELECT * INTO a FROM public.pet_vacinacoes WHERE id = p_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Aplicação não encontrada'; END IF;
  IF a.situacao <> 'ativa' THEN RAISE EXCEPTION 'Esta aplicação já está cancelada'; END IF;
  IF a.origem = 'clinica' THEN
    SELECT * INTO l FROM public.estoque_lotes WHERE id = a.estoque_lote_id FOR UPDATE;
    UPDATE public.estoque_lotes SET quantidade = quantidade + 1, updated_at = now() WHERE id = l.id;
    INSERT INTO public.estoque_lote_movimentos (tenant_id, lote_id, tipo, quantidade, saldo_posterior, documento, motivo)
    VALUES (v_tenant, l.id, 'entrada', 1, l.quantidade + 1, 'Cancelamento de vacinação', v_motivo);
    PERFORM public._clinica_movimentar_dose(l.produto_id, a.deposito_id, 'entrada'::public.mov_tipo, 'Cancelamento de vacinação: ' || v_motivo, 'Cancelamento de vacinação');
  END IF;
  UPDATE public.pet_vacinacoes SET situacao = 'cancelada', cancelada_em = now(), cancelada_motivo = v_motivo, cancelada_por = auth.uid() WHERE id = a.id;
  INSERT INTO public.clinica_acessos (tenant_id, pet_id, acao) VALUES (v_tenant, a.pet_id, 'vacinacao');
END $$;
REVOKE ALL ON FUNCTION public.clinica_vacina_cancelar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_vacina_cancelar(uuid, text) TO authenticated;

-- ============ cartão de vacinação ============
-- Documento do pet, sem texto do prontuário: gestão, veterinário e recepção leem e imprimem.
CREATE OR REPLACE FUNCTION public.clinica_cartao_vacinacao(p_pet_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  pt public.pets%ROWTYPE;
  v_tutor text;
  v_clinica text;
BEGIN
  PERFORM public._clinica_exige_leitura();
  SELECT * INTO pt FROM public.pets WHERE id = p_pet_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paciente não encontrado'; END IF;
  SELECT nome INTO v_tutor FROM public.clientes WHERE id = pt.cliente_id;
  SELECT coalesce(nullif(e.nome_fantasia, ''), e.razao_social) INTO v_clinica FROM public.empresas e WHERE e.tenant_id = v_tenant ORDER BY e.created_at LIMIT 1;
  RETURN jsonb_build_object(
    'clinica', v_clinica,
    'pet', jsonb_build_object('id', pt.id, 'nome', pt.nome, 'especie', pt.especie, 'raca', pt.raca, 'sexo', pt.sexo, 'nascimento', pt.nascimento),
    'tutor', v_tutor,
    'aplicacoes', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', v.id, 'nome', v.nome, 'tipo', v.tipo, 'origem', v.origem, 'dose_tipo', v.dose_tipo,
               'dose_numero', v.dose_numero, 'aplicada_em', v.aplicada_em, 'proxima_dose_em', v.proxima_dose_em, 'lote', v.lote,
               'validade_lote', v.validade_lote, 'informado_por', v.informado_por,
               'veterinario', vet.nome, 'crmv', vet.crmv, 'crmv_uf', vet.crmv_uf, 'aplicador', ap.nome) ORDER BY v.aplicada_em DESC, v.created_at DESC)
        FROM public.pet_vacinacoes v
        LEFT JOIN public.pet_profissionais vet ON vet.id = v.veterinario_id
        LEFT JOIN public.pet_profissionais ap ON ap.id = v.aplicador_id
       WHERE v.pet_id = pt.id AND v.tenant_id = v_tenant AND v.situacao = 'ativa'), '[]'::jsonb),
    -- próxima dose de cada item: a da aplicação mais recente
    'proximas', coalesce((
      SELECT jsonb_agg(jsonb_build_object('nome', x.nome, 'tipo', x.tipo, 'proxima_dose_em', x.proxima_dose_em) ORDER BY x.proxima_dose_em)
        FROM (SELECT DISTINCT ON (v.catalogo_id) v.nome, v.tipo, v.proxima_dose_em
                FROM public.pet_vacinacoes v
               WHERE v.pet_id = pt.id AND v.tenant_id = v_tenant AND v.situacao = 'ativa'
               ORDER BY v.catalogo_id, v.aplicada_em DESC, v.created_at DESC) x
       WHERE x.proxima_dose_em IS NOT NULL), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.clinica_cartao_vacinacao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinica_cartao_vacinacao(uuid) TO authenticated;

-- ============ auditoria: a ação "vacinacao" ============
ALTER TABLE public.clinica_acessos DROP CONSTRAINT IF EXISTS clinica_acessos_acao_check;
ALTER TABLE public.clinica_acessos ADD CONSTRAINT clinica_acessos_acao_check CHECK (acao IN ('historico', 'atendimento', 'alergias', 'vacinacao'));

-- ============ a agenda do veterinário informa o paciente (para abrir as vacinas dele) ============
DO $$
DECLARE
  def text;
  nova text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'pet_minha_agenda';
  IF def IS NULL THEN RAISE EXCEPTION 'pet_minha_agenda não encontrada'; END IF;
  IF position('''id'', pt.id' IN def) > 0 THEN RETURN; END IF;
  nova := replace(def, '''pet'', jsonb_build_object(''nome'', pt.nome,', '''pet'', jsonb_build_object(''id'', pt.id, ''nome'', pt.nome,');
  IF nova = def THEN RAISE EXCEPTION 'pet_minha_agenda: trecho do paciente não encontrado'; END IF;
  EXECUTE nova;
END $$;
