-- Hotelaria (Fase 1, migration 3): conta do hóspede (folio) com lançamentos que nunca mudam de valor, pagamentos pelo caixa (inclui o sinal),
-- check-in com a ficha, "fechar o dia" (diária e taxa de turismo da noite, sem duplicar), estorno, transferência entre contas,
-- estender, encurtar e trocar de quarto no meio da estadia. Cancelamento e não comparecimento passam a tratar o sinal.
-- O check-out e a NFS-e vêm na migration seguinte. Especificação: docs/hotelaria-fase-1.md.
-- Pode ser rodado de novo sem erro. Rode antes 20261210000000_hotelaria_reservas.sql.

-- ============ tabelas ============
-- Uma conta principal por reserva (criada no primeiro sinal ou no check-in) e contas extras abertas pela recepção
-- (ex.: a empresa paga as diárias e o hóspede paga o resto). Em reserva de vários quartos a conta é compartilhada.
CREATE TABLE IF NOT EXISTS public.hs_folios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  filial_id uuid NOT NULL,
  reserva_id uuid NOT NULL,
  titulo text NOT NULL DEFAULT 'Conta principal' CHECK (length(btrim(titulo)) > 0),
  principal boolean NOT NULL DEFAULT false,
  situacao text NOT NULL DEFAULT 'aberto' CHECK (situacao IN ('aberto', 'fechado')),
  fechado_em timestamptz,
  caixa_id uuid REFERENCES public.caixas(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hs_folios_filial_fk FOREIGN KEY (filial_id, tenant_id) REFERENCES public.filiais (id, tenant_id),
  CONSTRAINT hs_folios_reserva_fk FOREIGN KEY (reserva_id, filial_id) REFERENCES public.hs_reservas (id, filial_id),
  CONSTRAINT hs_folios_id_tenant_uk UNIQUE (id, tenant_id),
  CONSTRAINT hs_folios_id_filial_uk UNIQUE (id, filial_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS hs_folios_principal_idx ON public.hs_folios (reserva_id) WHERE principal;
CREATE INDEX IF NOT EXISTS hs_folios_reserva_idx ON public.hs_folios (reserva_id);

-- O razão da conta. O valor de um lançamento nunca muda: corrigir é estornar (linha de sinal oposto ligada por estorna_id).
-- Diária e taxa de turismo têm uma só linha por quarto e noite, o que torna o "fechar o dia" idempotente.
CREATE TABLE IF NOT EXISTS public.hs_lancamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  filial_id uuid NOT NULL,
  folio_id uuid NOT NULL,
  reserva_uh_id uuid,
  data_competencia date NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('diaria', 'taxa_turismo', 'consumo', 'servico', 'ajuste')),
  descricao text NOT NULL CHECK (length(btrim(descricao)) > 0),
  quantidade numeric(10,3) NOT NULL CHECK (quantidade > 0),
  valor_unitario numeric(14,2) NOT NULL,
  total numeric(14,2) NOT NULL,
  produto_id uuid REFERENCES public.produtos(id),
  -- reservado para a Fase 2 (ex.: comanda do restaurante lançada no quarto)
  origem_ref text,
  estorna_id uuid REFERENCES public.hs_lancamentos(id),
  motivo text,
  criado_por uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hs_lancamentos_total_ck CHECK (total = round(quantidade * valor_unitario, 2)),
  -- só o ajuste (desconto) e o estorno têm valor negativo
  CONSTRAINT hs_lancamentos_sinal_ck CHECK (estorna_id IS NOT NULL OR tipo = 'ajuste' OR valor_unitario >= 0),
  CONSTRAINT hs_lancamentos_estorno_ck CHECK (estorna_id IS NULL OR length(btrim(coalesce(motivo, ''))) >= 3),
  CONSTRAINT hs_lancamentos_folio_fk FOREIGN KEY (folio_id, filial_id) REFERENCES public.hs_folios (id, filial_id),
  CONSTRAINT hs_lancamentos_reserva_uh_fk FOREIGN KEY (reserva_uh_id, filial_id) REFERENCES public.hs_reserva_uhs (id, filial_id),
  CONSTRAINT hs_lancamentos_filial_fk FOREIGN KEY (filial_id, tenant_id) REFERENCES public.filiais (id, tenant_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS hs_lancamentos_noite_idx ON public.hs_lancamentos (reserva_uh_id, data_competencia, tipo)
  WHERE tipo IN ('diaria', 'taxa_turismo') AND estorna_id IS NULL;
-- um lançamento só é estornado uma vez
CREATE UNIQUE INDEX IF NOT EXISTS hs_lancamentos_estorno_idx ON public.hs_lancamentos (estorna_id) WHERE estorna_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS hs_lancamentos_folio_idx ON public.hs_lancamentos (folio_id, data_competencia);

-- Dinheiro que entra (sinal, pagamento) ou sai (devolução) pelo caixa. Crediário não é aceito.
CREATE TABLE IF NOT EXISTS public.hs_pagamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  filial_id uuid NOT NULL,
  folio_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('sinal', 'pagamento', 'devolucao')),
  forma public.forma_pagamento NOT NULL CHECK (forma <> 'crediario'),
  valor numeric(14,2) NOT NULL CHECK (valor > 0),
  caixa_id uuid NOT NULL REFERENCES public.caixas(id),
  caixa_movimento_id uuid REFERENCES public.caixa_movimentos(id),
  usuario_id uuid DEFAULT auth.uid(),
  chave_idempotencia uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hs_pagamentos_folio_fk FOREIGN KEY (folio_id, filial_id) REFERENCES public.hs_folios (id, filial_id),
  CONSTRAINT hs_pagamentos_filial_fk FOREIGN KEY (filial_id, tenant_id) REFERENCES public.filiais (id, tenant_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS hs_pagamentos_chave_idx ON public.hs_pagamentos (tenant_id, chave_idempotencia) WHERE chave_idempotencia IS NOT NULL;
CREATE INDEX IF NOT EXISTS hs_pagamentos_folio_idx ON public.hs_pagamentos (folio_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['hs_folios', 'hs_lancamentos', 'hs_pagamentos'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_ler', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id())', t || '_ler', t);
    EXECUTE format('DROP POLICY IF EXISTS salao_restrito ON public.%I', t);
    EXECUTE format('CREATE POLICY salao_restrito ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()))', t);
    EXECUTE format('DROP POLICY IF EXISTS filial_restrita ON public.%I', t);
    EXECUTE format('CREATE POLICY filial_restrita ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.pode_filial(filial_id))', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_' || t || '_updated', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()', 'trg_' || t || '_updated', t);
  END LOOP;
END $$;

-- ============ rotinas internas ============
-- Saldo da conta = lançamentos − (sinais + pagamentos) + devoluções. Positivo = o hóspede deve; negativo = crédito do hóspede.
CREATE OR REPLACE FUNCTION public._hs_folio_saldo(p_folio uuid) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public AS $$
  SELECT coalesce((SELECT sum(l.total) FROM public.hs_lancamentos l WHERE l.folio_id = p_folio), 0)
       - coalesce((SELECT sum(CASE p.tipo WHEN 'devolucao' THEN -p.valor ELSE p.valor END) FROM public.hs_pagamentos p WHERE p.folio_id = p_folio), 0)
$$;
REVOKE ALL ON FUNCTION public._hs_folio_saldo(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._hs_auditar(p_filial uuid, p_entidade text, p_id uuid, p_operacao text, p_antes jsonb, p_depois jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
BEGIN
  INSERT INTO public.auditoria (tenant_id, usuario_id, entidade, entidade_id, operacao, valor_anterior, valor_novo)
  VALUES (public.current_tenant_id(), auth.uid(), p_entidade, p_id, p_operacao, p_antes, p_depois);
END $$;
REVOKE ALL ON FUNCTION public._hs_auditar(uuid, text, uuid, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._hs_folio_principal(p_reserva uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE v_id uuid; r public.hs_reservas%ROWTYPE;
BEGIN
  SELECT id INTO v_id FROM public.hs_folios WHERE reserva_id = p_reserva AND principal;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  SELECT * INTO r FROM public.hs_reservas WHERE id = p_reserva;
  PERFORM pg_advisory_xact_lock(hashtextextended('hs_folio_reserva:' || p_reserva::text, 0));
  SELECT id INTO v_id FROM public.hs_folios WHERE reserva_id = p_reserva AND principal;
  IF v_id IS NULL THEN
    INSERT INTO public.hs_folios (tenant_id, filial_id, reserva_id, titulo, principal) VALUES (r.tenant_id, r.filial_id, r.id, 'Conta principal', true)
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public._hs_folio_principal(uuid) FROM PUBLIC, anon, authenticated;

-- Lança a diária da noite (e a taxa de turismo do hotel) na conta principal. Repetir não duplica: devolve nulo quando não havia o que lançar.
CREATE OR REPLACE FUNCTION public._hs_lancar_diaria(p_ru uuid, p_data date, p_com_taxa boolean DEFAULT true) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE
  ru public.hs_reserva_uhs%ROWTYPE; d public.hs_diarias%ROWTYPE; v_folio uuid; v_numero text; v_taxa numeric; v_hosp integer; v_total numeric := 0;
BEGIN
  SELECT * INTO ru FROM public.hs_reserva_uhs WHERE id = p_ru;
  SELECT * INTO d FROM public.hs_diarias WHERE reserva_uh_id = p_ru AND data = p_data FOR UPDATE;
  IF NOT FOUND OR d.lancada THEN RETURN NULL; END IF;
  v_folio := public._hs_folio_principal(ru.reserva_id);
  SELECT coalesce(u.numero, '-') INTO v_numero FROM (SELECT 1) x LEFT JOIN public.hs_uhs u ON u.id = ru.uh_id;
  INSERT INTO public.hs_lancamentos (tenant_id, filial_id, folio_id, reserva_uh_id, data_competencia, tipo, descricao, quantidade, valor_unitario, total)
  VALUES (ru.tenant_id, ru.filial_id, v_folio, ru.id, p_data, 'diaria', 'Diária ' || to_char(p_data, 'DD/MM/YYYY') || ' — UH ' || v_numero, 1, d.valor, d.valor)
  ON CONFLICT (reserva_uh_id, data_competencia, tipo) WHERE tipo IN ('diaria', 'taxa_turismo') AND estorna_id IS NULL DO NOTHING;
  UPDATE public.hs_diarias SET lancada = true WHERE id = d.id;
  v_total := d.valor;
  SELECT c.taxa_turismo_por_hospede_noite INTO v_taxa FROM public.hs_config c WHERE c.filial_id = ru.filial_id;
  IF coalesce(v_taxa, 0) > 0 AND p_com_taxa THEN
    SELECT count(*) INTO v_hosp FROM public.hs_reserva_hospedes WHERE reserva_uh_id = p_ru;
    IF v_hosp = 0 THEN v_hosp := ru.adultos + ru.criancas; END IF;
    INSERT INTO public.hs_lancamentos (tenant_id, filial_id, folio_id, reserva_uh_id, data_competencia, tipo, descricao, quantidade, valor_unitario, total)
    VALUES (ru.tenant_id, ru.filial_id, v_folio, ru.id, p_data, 'taxa_turismo', 'Taxa de turismo ' || to_char(p_data, 'DD/MM/YYYY') || ' — UH ' || v_numero,
            v_hosp, v_taxa, round(v_hosp * v_taxa, 2))
    ON CONFLICT (reserva_uh_id, data_competencia, tipo) WHERE tipo IN ('diaria', 'taxa_turismo') AND estorna_id IS NULL DO NOTHING;
    v_total := v_total + round(v_hosp * v_taxa, 2);
  END IF;
  RETURN v_total;
END $$;
REVOKE ALL ON FUNCTION public._hs_lancar_diaria(uuid, date, boolean) FROM PUBLIC, anon, authenticated;

-- Entrada de dinheiro (ou devolução) pelo caixa do mesmo hotel. Repetir com a mesma chave devolve o mesmo pagamento.
CREATE OR REPLACE FUNCTION public._hs_registrar_pagamento(p_folio uuid, p_forma public.forma_pagamento, p_valor numeric, p_caixa uuid, p_tipo text, p_chave uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE
  f public.hs_folios%ROWTYPE; v_valor numeric := round(coalesce(p_valor, 0), 2); v_cx_filial uuid; v_num bigint; v_mov uuid; v_id uuid;
BEGIN
  SELECT * INTO f FROM public.hs_folios WHERE id = p_folio;
  IF p_chave IS NOT NULL THEN
    SELECT id INTO v_id FROM public.hs_pagamentos WHERE tenant_id = f.tenant_id AND chave_idempotencia = p_chave;
    IF FOUND THEN RETURN v_id; END IF;
  END IF;
  IF p_forma IS NULL THEN RAISE EXCEPTION 'Informe a forma de pagamento'; END IF;
  IF p_forma = 'crediario' THEN RAISE EXCEPTION 'Crediário não é aceito na conta do hóspede'; END IF;
  IF v_valor <= 0 THEN RAISE EXCEPTION 'Informe um valor maior que zero'; END IF;
  SELECT filial_id INTO v_cx_filial FROM public.caixas WHERE id = p_caixa AND tenant_id = f.tenant_id AND situacao = 'aberto';
  IF NOT FOUND THEN RAISE EXCEPTION 'Caixa não encontrado ou já fechado'; END IF;
  IF v_cx_filial IS DISTINCT FROM f.filial_id THEN RAISE EXCEPTION 'O caixa informado é de outro hotel'; END IF;
  SELECT numero INTO v_num FROM public.hs_reservas WHERE id = f.reserva_id;
  v_mov := public.caixa_lancar(p_caixa, (CASE WHEN p_tipo = 'devolucao' THEN 'saida' ELSE 'venda' END)::public.caixa_mov_tipo, v_valor,
                               'Hotel — reserva ' || v_num || CASE p_tipo WHEN 'sinal' THEN ' (sinal)' WHEN 'devolucao' THEN ' (devolução)' ELSE '' END,
                               p_forma, NULL, NULL);
  INSERT INTO public.hs_pagamentos (tenant_id, filial_id, folio_id, tipo, forma, valor, caixa_id, caixa_movimento_id, chave_idempotencia)
  VALUES (f.tenant_id, f.filial_id, p_folio, p_tipo, p_forma, v_valor, p_caixa, v_mov, p_chave)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public._hs_registrar_pagamento(uuid, public.forma_pagamento, numeric, uuid, text, uuid) FROM PUBLIC, anon, authenticated;

-- Reserva que acabou sem estadia (cancelada ou não compareceu): o crédito do hóspede é devolvido ou retido como receita (só a gestão
-- retém) e as contas quitadas fecham. Conta com saldo a receber continua aberta.
CREATE OR REPLACE FUNCTION public._hs_encerrar_sem_estadia(p_reserva uuid, p_devolver boolean, p_caixa uuid, p_forma public.forma_pagamento, p_motivo text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE
  f public.hs_folios%ROWTYPE; v_saldo numeric; v_gestao boolean := public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor');
BEGIN
  FOR f IN SELECT * FROM public.hs_folios WHERE reserva_id = p_reserva AND situacao = 'aberto' ORDER BY principal DESC, created_at LOOP
    v_saldo := public._hs_folio_saldo(f.id);
    IF v_saldo < 0 THEN
      IF p_devolver THEN
        IF p_caixa IS NULL OR p_forma IS NULL THEN RAISE EXCEPTION 'Informe o caixa e a forma de pagamento para devolver o sinal'; END IF;
        PERFORM public._hs_registrar_pagamento(f.id, p_forma, -v_saldo, p_caixa, 'devolucao', NULL);
        PERFORM public._hs_auditar(f.filial_id, 'hs_folios', f.id, 'devolucao_sinal', jsonb_build_object('credito', -v_saldo), jsonb_build_object('motivo', p_motivo));
      ELSE
        IF NOT v_gestao THEN RAISE EXCEPTION 'Há sinal recebido: só a gestão pode reter o sinal (ou devolva informando o caixa e a forma)'; END IF;
        INSERT INTO public.hs_lancamentos (tenant_id, filial_id, folio_id, data_competencia, tipo, descricao, quantidade, valor_unitario, total, motivo)
        VALUES (f.tenant_id, f.filial_id, f.id, public._hs_hoje(f.filial_id), 'servico', 'Sinal retido — ' || coalesce(p_motivo, 'sem estadia'), 1, -v_saldo, -v_saldo, p_motivo);
        PERFORM public._hs_auditar(f.filial_id, 'hs_folios', f.id, 'retencao_sinal', jsonb_build_object('credito', -v_saldo), jsonb_build_object('motivo', p_motivo));
      END IF;
    END IF;
    IF public._hs_folio_saldo(f.id) = 0 THEN
      UPDATE public.hs_folios SET situacao = 'fechado', fechado_em = now() WHERE id = f.id;
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public._hs_encerrar_sem_estadia(uuid, boolean, uuid, public.forma_pagamento, text) FROM PUBLIC, anon, authenticated;

-- ============ conta do hóspede ============
CREATE OR REPLACE FUNCTION public.hs_folio_principal(p_reserva uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE r public.hs_reservas%ROWTYPE;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._hs_exige_liberado();
  SELECT * INTO r FROM public.hs_reservas WHERE id = p_reserva AND tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Reserva não encontrada'; END IF;
  PERFORM public._hs_exige_filial(r.filial_id);
  IF NOT EXISTS (SELECT 1 FROM public.hs_folios WHERE reserva_id = r.id AND principal) AND r.situacao IN ('cancelada', 'no_show', 'finalizada') THEN
    RAISE EXCEPTION 'Esta reserva está encerrada (%)', r.situacao;
  END IF;
  RETURN public._hs_folio_principal(r.id);
END $$;
REVOKE ALL ON FUNCTION public.hs_folio_principal(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hs_folio_principal(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.hs_folio_abrir(p_reserva uuid, p_titulo text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE r public.hs_reservas%ROWTYPE; v_titulo text := btrim(coalesce(p_titulo, '')); v_id uuid;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._hs_exige_liberado();
  SELECT * INTO r FROM public.hs_reservas WHERE id = p_reserva AND tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Reserva não encontrada'; END IF;
  PERFORM public._hs_exige_filial(r.filial_id);
  IF r.situacao NOT IN ('pendente', 'confirmada', 'hospedada') THEN RAISE EXCEPTION 'Esta reserva está encerrada (%)', r.situacao; END IF;
  IF v_titulo = '' THEN RAISE EXCEPTION 'Informe o nome da conta'; END IF;
  PERFORM public._hs_folio_principal(r.id);
  IF EXISTS (SELECT 1 FROM public.hs_folios WHERE reserva_id = r.id AND lower(btrim(titulo)) = lower(v_titulo)) THEN
    RAISE EXCEPTION 'Já existe uma conta com este nome nesta reserva';
  END IF;
  INSERT INTO public.hs_folios (tenant_id, filial_id, reserva_id, titulo, principal) VALUES (r.tenant_id, r.filial_id, r.id, v_titulo, false) RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.hs_folio_abrir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hs_folio_abrir(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.hs_folio_saldo(p_folio uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE f public.hs_folios%ROWTYPE;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._hs_exige_liberado();
  SELECT * INTO f FROM public.hs_folios WHERE id = p_folio AND tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Conta não encontrada'; END IF;
  PERFORM public._hs_exige_filial(f.filial_id);
  RETURN public._hs_folio_saldo(p_folio);
END $$;
REVOKE ALL ON FUNCTION public.hs_folio_saldo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hs_folio_saldo(uuid) TO authenticated;

-- Consumo, serviço ou ajuste manual. Dados: tipo (consumo | servico | ajuste), descricao, quantidade?, valor_unitario, data_competencia?,
-- reserva_uh_id?, produto_id?. Ajuste (inclusive desconto) só pela gestão.
CREATE OR REPLACE FUNCTION public.hs_lancar(p_folio uuid, p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_gestao boolean := public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor');
  f public.hs_folios%ROWTYPE;
  v_tipo text := btrim(coalesce(p_dados ->> 'tipo', 'consumo'));
  v_desc text := btrim(coalesce(p_dados ->> 'descricao', ''));
  v_qtd numeric := coalesce(nullif(p_dados ->> 'quantidade', '')::numeric, 1);
  v_unit numeric := round(nullif(p_dados ->> 'valor_unitario', '')::numeric, 2);
  v_data date;
  v_ru uuid := nullif(p_dados ->> 'reserva_uh_id', '')::uuid;
  v_prod uuid := nullif(p_dados ->> 'produto_id', '')::uuid;
  v_id uuid;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._hs_exige_liberado();
  SELECT * INTO f FROM public.hs_folios WHERE id = p_folio AND tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Conta não encontrada'; END IF;
  PERFORM public._hs_exige_filial(f.filial_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('hs_folio:' || f.id::text, 0));
  SELECT * INTO f FROM public.hs_folios WHERE id = p_folio FOR UPDATE;
  IF f.situacao <> 'aberto' THEN RAISE EXCEPTION 'Esta conta está fechada'; END IF;
  IF v_tipo NOT IN ('consumo', 'servico', 'ajuste') THEN RAISE EXCEPTION 'Tipo de lançamento inválido (consumo, serviço ou ajuste)'; END IF;
  IF v_tipo = 'ajuste' AND NOT v_gestao THEN RAISE EXCEPTION 'Ajuste na conta só pode ser feito pela gestão'; END IF;
  IF v_desc = '' THEN RAISE EXCEPTION 'Informe a descrição do lançamento'; END IF;
  IF v_qtd <= 0 THEN RAISE EXCEPTION 'A quantidade precisa ser maior que zero'; END IF;
  IF v_unit IS NULL THEN RAISE EXCEPTION 'Informe o valor'; END IF;
  IF v_unit < 0 AND v_tipo <> 'ajuste' THEN RAISE EXCEPTION 'O valor não pode ser negativo (desconto é um ajuste da gestão)'; END IF;
  IF abs(v_unit) > 9999999 OR v_qtd > 99999 THEN RAISE EXCEPTION 'Valor ou quantidade fora do limite'; END IF;
  v_data := coalesce(nullif(p_dados ->> 'data_competencia', '')::date, public._hs_hoje(f.filial_id));
  IF v_ru IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.hs_reserva_uhs u WHERE u.id = v_ru AND u.reserva_id = f.reserva_id) THEN
    RAISE EXCEPTION 'O quarto informado não é desta reserva';
  END IF;
  IF v_prod IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.produtos p WHERE p.id = v_prod AND p.tenant_id = f.tenant_id) THEN
    RAISE EXCEPTION 'Produto não encontrado';
  END IF;
  INSERT INTO public.hs_lancamentos (tenant_id, filial_id, folio_id, reserva_uh_id, data_competencia, tipo, descricao, quantidade, valor_unitario, total, produto_id)
  VALUES (f.tenant_id, f.filial_id, f.id, v_ru, v_data, v_tipo, v_desc, v_qtd, v_unit, round(v_qtd * v_unit, 2), v_prod)
  RETURNING id INTO v_id;
  IF v_tipo = 'ajuste' THEN
    PERFORM public._hs_auditar(f.filial_id, 'hs_lancamentos', v_id, 'ajuste', NULL, jsonb_build_object('descricao', v_desc, 'total', round(v_qtd * v_unit, 2)));
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.hs_lancar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hs_lancar(uuid, jsonb) TO authenticated;

-- Estorna um lançamento: grava a linha de sinal oposto (o lançamento original nunca muda). Diária e taxa de turismo só pela gestão.
CREATE OR REPLACE FUNCTION public.hs_lancamento_estornar(p_id uuid, p_motivo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_gestao boolean := public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor');
  l public.hs_lancamentos%ROWTYPE; f public.hs_folios%ROWTYPE; v_motivo text := btrim(coalesce(p_motivo, '')); v_id uuid;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._hs_exige_liberado();
  SELECT * INTO l FROM public.hs_lancamentos WHERE id = p_id AND tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado'; END IF;
  PERFORM public._hs_exige_filial(l.filial_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('hs_folio:' || l.folio_id::text, 0));
  SELECT * INTO f FROM public.hs_folios WHERE id = l.folio_id FOR UPDATE;
  IF l.estorna_id IS NOT NULL THEN RAISE EXCEPTION 'Um estorno não pode ser estornado'; END IF;
  SELECT id INTO v_id FROM public.hs_lancamentos WHERE estorna_id = l.id;
  IF FOUND THEN RETURN jsonb_build_object('estorno_id', v_id, 'repetido', true); END IF;
  IF f.situacao <> 'aberto' THEN RAISE EXCEPTION 'Esta conta está fechada'; END IF;
  IF l.tipo IN ('diaria', 'taxa_turismo') AND NOT v_gestao THEN RAISE EXCEPTION 'Estornar diária ou taxa de turismo só pode ser feito pela gestão'; END IF;
  IF l.tipo = 'ajuste' AND NOT v_gestao THEN RAISE EXCEPTION 'Estornar ajuste só pode ser feito pela gestão'; END IF;
  IF length(v_motivo) < 3 THEN RAISE EXCEPTION 'Informe o motivo do estorno'; END IF;
  INSERT INTO public.hs_lancamentos (tenant_id, filial_id, folio_id, reserva_uh_id, data_competencia, tipo, descricao, quantidade, valor_unitario, total,
                                     produto_id, estorna_id, motivo)
  VALUES (l.tenant_id, l.filial_id, l.folio_id, l.reserva_uh_id, l.data_competencia, l.tipo, 'Estorno: ' || l.descricao, l.quantidade, -l.valor_unitario, -l.total,
          l.produto_id, l.id, v_motivo)
  RETURNING id INTO v_id;
  PERFORM public._hs_auditar(l.filial_id, 'hs_lancamentos', l.id, 'estorno', jsonb_build_object('total', l.total, 'tipo', l.tipo), jsonb_build_object('estorno_id', v_id, 'motivo', v_motivo));
  RETURN jsonb_build_object('estorno_id', v_id, 'repetido', false);
END $$;
REVOKE ALL ON FUNCTION public.hs_lancamento_estornar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hs_lancamento_estornar(uuid, text) TO authenticated;

-- Separar contas: passa lançamentos (com os estornos deles) para outra conta aberta da mesma reserva.
CREATE OR REPLACE FUNCTION public.hs_lancamento_transferir(p_ids uuid[], p_folio_destino uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  d public.hs_folios%ROWTYPE; l public.hs_lancamentos%ROWTYPE; o public.hs_folios%ROWTYPE; v_n integer := 0; v_id uuid;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._hs_exige_liberado();
  IF p_ids IS NULL OR cardinality(p_ids) = 0 OR cardinality(p_ids) > 200 THEN RAISE EXCEPTION 'Escolha de 1 a 200 lançamentos'; END IF;
  SELECT * INTO d FROM public.hs_folios WHERE id = p_folio_destino AND tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Conta de destino não encontrada'; END IF;
  PERFORM public._hs_exige_filial(d.filial_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('hs_folio_reserva:' || d.reserva_id::text, 0));
  SELECT * INTO d FROM public.hs_folios WHERE id = p_folio_destino FOR UPDATE;
  IF d.situacao <> 'aberto' THEN RAISE EXCEPTION 'A conta de destino está fechada'; END IF;
  FOREACH v_id IN ARRAY p_ids LOOP
    SELECT * INTO l FROM public.hs_lancamentos WHERE id = v_id AND tenant_id = d.tenant_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado'; END IF;
    IF l.estorna_id IS NOT NULL THEN RAISE EXCEPTION 'Estorno acompanha o lançamento original: escolha o original'; END IF;
    SELECT * INTO o FROM public.hs_folios WHERE id = l.folio_id FOR UPDATE;
    IF o.reserva_id <> d.reserva_id THEN RAISE EXCEPTION 'Só dá para transferir entre contas da mesma reserva'; END IF;
    IF o.situacao <> 'aberto' THEN RAISE EXCEPTION 'A conta de origem está fechada'; END IF;
    IF o.id = d.id THEN CONTINUE; END IF;
    UPDATE public.hs_lancamentos SET folio_id = d.id WHERE id = l.id OR estorna_id = l.id;
    PERFORM public._hs_auditar(l.filial_id, 'hs_lancamentos', l.id, 'transferencia', jsonb_build_object('folio', o.id), jsonb_build_object('folio', d.id));
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.hs_lancamento_transferir(uuid[], uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hs_lancamento_transferir(uuid[], uuid) TO authenticated;

-- Sinal, pagamento ou devolução, pelo caixa aberto do mesmo hotel. Pagamento não passa do saldo; devolução só pela gestão e até o que foi recebido.
CREATE OR REPLACE FUNCTION public.hs_pagamento_registrar(p_folio uuid, p_forma public.forma_pagamento, p_valor numeric, p_caixa uuid, p_tipo text DEFAULT 'pagamento', p_chave uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_gestao boolean := public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor');
  f public.hs_folios%ROWTYPE; r public.hs_reservas%ROWTYPE; v_valor numeric := round(coalesce(p_valor, 0), 2);
  v_saldo numeric; v_recebido numeric; v_id uuid; v_exist uuid;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._hs_exige_liberado();
  SELECT * INTO f FROM public.hs_folios WHERE id = p_folio AND tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Conta não encontrada'; END IF;
  PERFORM public._hs_exige_filial(f.filial_id);
  IF p_tipo NOT IN ('sinal', 'pagamento', 'devolucao') THEN RAISE EXCEPTION 'Tipo de pagamento inválido'; END IF;
  IF p_tipo = 'devolucao' AND NOT v_gestao THEN RAISE EXCEPTION 'Devolução de valores só pode ser feita pela gestão'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hs_folio:' || f.id::text, 0));
  IF p_chave IS NOT NULL THEN
    SELECT id INTO v_exist FROM public.hs_pagamentos WHERE tenant_id = f.tenant_id AND chave_idempotencia = p_chave;
    IF FOUND THEN
      IF (SELECT folio_id FROM public.hs_pagamentos WHERE id = v_exist) <> f.id THEN RAISE EXCEPTION 'Esta chave já foi usada em outra conta'; END IF;
      RETURN jsonb_build_object('pagamento_id', v_exist, 'saldo', public._hs_folio_saldo(f.id), 'repetido', true);
    END IF;
  END IF;
  SELECT * INTO f FROM public.hs_folios WHERE id = p_folio FOR UPDATE;
  IF f.situacao <> 'aberto' THEN RAISE EXCEPTION 'Esta conta está fechada'; END IF;
  SELECT * INTO r FROM public.hs_reservas WHERE id = f.reserva_id;
  IF v_valor <= 0 THEN RAISE EXCEPTION 'Informe um valor maior que zero'; END IF;
  v_saldo := public._hs_folio_saldo(f.id);
  IF p_tipo = 'sinal' AND r.situacao NOT IN ('pendente', 'confirmada') THEN
    RAISE EXCEPTION 'Sinal só é recebido antes da estadia (reserva %)', r.situacao;
  END IF;
  IF p_tipo = 'pagamento' AND v_valor > v_saldo THEN
    RAISE EXCEPTION 'O pagamento (%) passa do saldo da conta (%)', v_valor, greatest(v_saldo, 0);
  END IF;
  IF p_tipo = 'devolucao' THEN
    SELECT coalesce(sum(CASE tipo WHEN 'devolucao' THEN -valor ELSE valor END), 0) INTO v_recebido FROM public.hs_pagamentos WHERE folio_id = f.id;
    IF v_valor > v_recebido THEN RAISE EXCEPTION 'A devolução (%) passa do que foi recebido nesta conta (%)', v_valor, v_recebido; END IF;
    PERFORM public._hs_auditar(f.filial_id, 'hs_folios', f.id, 'devolucao', NULL, jsonb_build_object('valor', v_valor, 'forma', p_forma));
  END IF;
  v_id := public._hs_registrar_pagamento(f.id, p_forma, v_valor, p_caixa, p_tipo, p_chave);
  RETURN jsonb_build_object('pagamento_id', v_id, 'saldo', public._hs_folio_saldo(f.id), 'repetido', false);
END $$;
REVOKE ALL ON FUNCTION public.hs_pagamento_registrar(uuid, public.forma_pagamento, numeric, uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hs_pagamento_registrar(uuid, public.forma_pagamento, numeric, uuid, text, uuid) TO authenticated;

-- ============ check-in ============
-- O titular da reserva entra como hóspede principal; os acompanhantes vêm do cadastro de hóspedes. Devolve os dados da ficha de hospedagem.
-- Repetir depois de feito devolve a mesma ficha (o check-in é idempotente pelo estado do quarto).
CREATE OR REPLACE FUNCTION public.hs_checkin(p_reserva_uh uuid, p_acompanhantes uuid[] DEFAULT '{}')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  ru public.hs_reserva_uhs%ROWTYPE; r public.hs_reservas%ROWTYPE; u public.hs_uhs%ROWTYPE; t public.hs_hospedes%ROWTYPE;
  v_cfg public.hs_config%ROWTYPE; v_hoje date; v_hosp uuid; v_ids uuid[]; v_folio uuid; v_repetido boolean := false; v_ficha jsonb;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._hs_exige_liberado();
  SELECT * INTO ru FROM public.hs_reserva_uhs WHERE id = p_reserva_uh AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quarto da reserva não encontrado'; END IF;
  PERFORM public._hs_exige_filial(ru.filial_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('hs_cal:' || ru.filial_id::text, 0));
  SELECT * INTO ru FROM public.hs_reserva_uhs WHERE id = p_reserva_uh FOR UPDATE;
  SELECT * INTO r FROM public.hs_reservas WHERE id = ru.reserva_id;
  v_folio := (SELECT id FROM public.hs_folios WHERE reserva_id = r.id AND principal);

  IF ru.situacao = 'hospedada' THEN
    v_repetido := true;
  ELSE
    IF ru.situacao <> 'reservada' THEN RAISE EXCEPTION 'Só quarto reservado pode fazer check-in (situação atual: %)', ru.situacao; END IF;
    IF r.situacao = 'pendente' THEN RAISE EXCEPTION 'Confirme a reserva antes do check-in'; END IF;
    v_hoje := public._hs_hoje(ru.filial_id);
    IF v_hoje < ru.entrada THEN RAISE EXCEPTION 'A entrada é só em %: antecipe a data da reserva para fazer o check-in antes', to_char(ru.entrada, 'DD/MM/YYYY'); END IF;
    IF v_hoje >= ru.saida THEN RAISE EXCEPTION 'A saída prevista (%) já passou: ajuste as datas da reserva', to_char(ru.saida, 'DD/MM/YYYY'); END IF;
    IF ru.uh_id IS NULL THEN RAISE EXCEPTION 'Atribua uma acomodação ao quarto antes do check-in'; END IF;
    SELECT * INTO u FROM public.hs_uhs WHERE id = ru.uh_id;
    IF NOT u.ativo OR u.interditada THEN RAISE EXCEPTION 'A acomodação % está fora de venda', u.numero; END IF;
    IF u.situacao_limpeza = 'sujo' THEN RAISE EXCEPTION 'A acomodação % está suja: libere a limpeza antes do check-in', u.numero; END IF;
    IF EXISTS (SELECT 1 FROM public.hs_reserva_uhs x WHERE x.uh_id = ru.uh_id AND x.situacao = 'hospedada' AND x.id <> ru.id) THEN
      RAISE EXCEPTION 'A acomodação % ainda está ocupada por outra hospedagem: faça o check-out dela antes', u.numero;
    END IF;
    SELECT * INTO t FROM public.hs_hospedes WHERE id = r.titular_id;
    SELECT * INTO v_cfg FROM public.hs_config WHERE filial_id = ru.filial_id;
    IF coalesce(v_cfg.exige_documento_checkin, true) AND t.documento_numero IS NULL THEN
      RAISE EXCEPTION 'Informe o documento do hóspede titular (%) antes do check-in', t.nome;
    END IF;
    v_ids := ARRAY[t.id];
    FOREACH v_hosp IN ARRAY coalesce(p_acompanhantes, '{}') LOOP
      IF v_hosp = ANY (v_ids) THEN CONTINUE; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.hs_hospedes h WHERE h.id = v_hosp AND h.tenant_id = v_tenant AND h.ativo) THEN RAISE EXCEPTION 'Acompanhante não encontrado'; END IF;
      v_ids := v_ids || v_hosp;
    END LOOP;
    IF cardinality(v_ids) > ru.adultos + ru.criancas THEN
      RAISE EXCEPTION 'A reserva é para % pessoa(s) e foram informadas %', ru.adultos + ru.criancas, cardinality(v_ids);
    END IF;
    DELETE FROM public.hs_reserva_hospedes WHERE reserva_uh_id = ru.id;
    INSERT INTO public.hs_reserva_hospedes (tenant_id, reserva_uh_id, hospede_id, principal)
    SELECT v_tenant, ru.id, x, x = t.id FROM unnest(v_ids) x;
    UPDATE public.hs_reserva_uhs SET situacao = 'hospedada', checkin_em = now() WHERE id = ru.id;
    PERFORM public._hs_reserva_recalcular(ru.reserva_id);
    v_folio := public._hs_folio_principal(ru.reserva_id);
  END IF;

  SELECT * INTO u FROM public.hs_uhs WHERE id = ru.uh_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('hospede_id', h.id, 'principal', rh.principal, 'nome', h.nome, 'documento_tipo', h.documento_tipo,
           'documento_numero', h.documento_numero, 'nacionalidade', h.nacionalidade, 'data_nascimento', h.data_nascimento, 'sexo', h.sexo,
           'profissao', h.profissao, 'telefone', h.telefone, 'email', h.email, 'cidade_residencia', h.cidade_residencia,
           'estado_residencia', h.estado_residencia, 'pais_residencia', h.pais_residencia, 'procedencia', h.procedencia, 'destino', h.destino,
           'motivo_viagem', h.motivo_viagem, 'meio_transporte', h.meio_transporte) ORDER BY rh.principal DESC, h.nome), '[]'::jsonb)
    INTO v_ficha FROM public.hs_reserva_hospedes rh JOIN public.hs_hospedes h ON h.id = rh.hospede_id WHERE rh.reserva_uh_id = ru.id;
  RETURN jsonb_build_object('reserva_uh_id', ru.id, 'reserva_numero', r.numero, 'folio_id', v_folio, 'uh', u.numero,
                            'entrada', ru.entrada, 'saida', ru.saida, 'adultos', ru.adultos, 'criancas', ru.criancas,
                            'checkin_em', (SELECT checkin_em FROM public.hs_reserva_uhs WHERE id = ru.id), 'hospedes', v_ficha, 'repetido', v_repetido);
END $$;
REVOKE ALL ON FUNCTION public.hs_checkin(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hs_checkin(uuid, uuid[]) TO authenticated;

-- Acompanhantes do quarto (antes ou durante a estadia). O titular da reserva não sai.
CREATE OR REPLACE FUNCTION public.hs_reserva_hospede_adicionar(p_reserva_uh uuid, p_hospede uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE ru public.hs_reserva_uhs%ROWTYPE;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._hs_exige_liberado();
  SELECT * INTO ru FROM public.hs_reserva_uhs WHERE id = p_reserva_uh AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quarto da reserva não encontrado'; END IF;
  PERFORM public._hs_exige_filial(ru.filial_id);
  IF ru.situacao <> 'hospedada' THEN RAISE EXCEPTION 'Os hóspedes do quarto são registrados no check-in (situação atual: %)', ru.situacao; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.hs_hospedes h WHERE h.id = p_hospede AND h.tenant_id = ru.tenant_id AND h.ativo) THEN RAISE EXCEPTION 'Hóspede não encontrado'; END IF;
  IF EXISTS (SELECT 1 FROM public.hs_reserva_hospedes WHERE reserva_uh_id = ru.id AND hospede_id = p_hospede) THEN RETURN; END IF;
  IF (SELECT count(*) FROM public.hs_reserva_hospedes WHERE reserva_uh_id = ru.id) >= ru.adultos + ru.criancas THEN
    RAISE EXCEPTION 'O quarto já tem as % pessoa(s) da reserva: altere a reserva antes', ru.adultos + ru.criancas;
  END IF;
  INSERT INTO public.hs_reserva_hospedes (tenant_id, reserva_uh_id, hospede_id, principal) VALUES (ru.tenant_id, ru.id, p_hospede, false);
END $$;
REVOKE ALL ON FUNCTION public.hs_reserva_hospede_adicionar(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hs_reserva_hospede_adicionar(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.hs_reserva_hospede_remover(p_reserva_uh uuid, p_hospede uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE ru public.hs_reserva_uhs%ROWTYPE; rh public.hs_reserva_hospedes%ROWTYPE;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._hs_exige_liberado();
  SELECT * INTO ru FROM public.hs_reserva_uhs WHERE id = p_reserva_uh AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quarto da reserva não encontrado'; END IF;
  PERFORM public._hs_exige_filial(ru.filial_id);
  IF ru.situacao <> 'hospedada' THEN RAISE EXCEPTION 'Os hóspedes do quarto são registrados no check-in (situação atual: %)', ru.situacao; END IF;
  SELECT * INTO rh FROM public.hs_reserva_hospedes WHERE reserva_uh_id = ru.id AND hospede_id = p_hospede;
  IF NOT FOUND THEN RETURN; END IF;
  IF rh.principal THEN RAISE EXCEPTION 'O hóspede principal não pode sair do quarto'; END IF;
  DELETE FROM public.hs_reserva_hospedes WHERE id = rh.id;
END $$;
REVOKE ALL ON FUNCTION public.hs_reserva_hospede_remover(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hs_reserva_hospede_remover(uuid, uuid) TO authenticated;

-- ============ fechar o dia ============
-- Para cada quarto hospedado que dormiu na noite p_data (padrão: hoje): lança a diária e a taxa de turismo. Repetir não duplica.
-- Devolve também o que pede decisão: chegadas que não vieram (não comparecimento?) e saídas atrasadas (estender ou fazer o check-out?).
CREATE OR REPLACE FUNCTION public.hs_auditoria_noturna(p_filial uuid, p_data date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_hoje date; v_data date; ru record; v_n integer := 0; v_total numeric := 0; v_val numeric; v_chegadas jsonb; v_atrasadas jsonb;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._hs_exige_liberado();
  PERFORM public._hs_exige_filial(p_filial);
  v_hoje := public._hs_hoje(p_filial);
  v_data := coalesce(p_data, v_hoje);
  IF v_data > v_hoje THEN RAISE EXCEPTION 'Não dá para fechar um dia que ainda não chegou'; END IF;
  IF v_data < v_hoje - 31 THEN RAISE EXCEPTION 'Só dá para fechar os últimos 31 dias'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hs_cal:' || p_filial::text, 0));

  FOR ru IN SELECT u.id FROM public.hs_reserva_uhs u
             WHERE u.filial_id = p_filial AND u.tenant_id = public.current_tenant_id() AND u.situacao = 'hospedada'
               AND u.entrada <= v_data AND u.saida > v_data
               AND (u.checkin_em AT TIME ZONE coalesce((SELECT c.fuso FROM public.hs_config c WHERE c.filial_id = p_filial), 'America/Sao_Paulo'))::date <= v_data
             ORDER BY u.id LOOP
    v_val := public._hs_lancar_diaria(ru.id, v_data);
    IF v_val IS NOT NULL THEN
      v_n := v_n + 1; v_total := v_total + v_val;
    END IF;
  END LOOP;

  SELECT coalesce(jsonb_agg(jsonb_build_object('reserva_uh_id', u.id, 'reserva_numero', r.numero, 'titular', h.nome, 'uh', x.numero) ORDER BY r.numero), '[]'::jsonb)
    INTO v_chegadas FROM public.hs_reserva_uhs u JOIN public.hs_reservas r ON r.id = u.reserva_id JOIN public.hs_hospedes h ON h.id = r.titular_id
    LEFT JOIN public.hs_uhs x ON x.id = u.uh_id
   WHERE u.filial_id = p_filial AND u.tenant_id = public.current_tenant_id() AND u.situacao = 'reservada' AND u.entrada <= v_data AND u.saida > v_data;
  SELECT coalesce(jsonb_agg(jsonb_build_object('reserva_uh_id', u.id, 'reserva_numero', r.numero, 'titular', h.nome, 'uh', x.numero, 'saida', u.saida) ORDER BY u.saida, r.numero), '[]'::jsonb)
    INTO v_atrasadas FROM public.hs_reserva_uhs u JOIN public.hs_reservas r ON r.id = u.reserva_id JOIN public.hs_hospedes h ON h.id = r.titular_id
    LEFT JOIN public.hs_uhs x ON x.id = u.uh_id
   WHERE u.filial_id = p_filial AND u.tenant_id = public.current_tenant_id() AND u.situacao = 'hospedada' AND u.saida <= v_data;
  RETURN jsonb_build_object('data', v_data, 'quartos', v_n, 'total_lancado', v_total, 'chegadas_pendentes', v_chegadas, 'saidas_atrasadas', v_atrasadas);
END $$;
REVOKE ALL ON FUNCTION public.hs_auditoria_noturna(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hs_auditoria_noturna(uuid, date) TO authenticated;

-- ============ estadia: estender, encurtar e trocar de quarto ============
-- Estender: confere vaga nas noites novas e cota pela tarifa de hoje (ou pelo total que a gestão combinar para elas).
CREATE OR REPLACE FUNCTION public.hs_estadia_estender(p_reserva_uh uuid, p_nova_saida date, p_valor_novas_noites numeric DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_gestao boolean := public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor');
  ru public.hs_reserva_uhs%ROWTYPE; v_n integer; i integer; v_val numeric; v_tar uuid; v_min integer; v_base numeric; v_oc uuid; v_total numeric := 0;
  v_acordo numeric := round(p_valor_novas_noites, 2);
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._hs_exige_liberado();
  SELECT * INTO ru FROM public.hs_reserva_uhs WHERE id = p_reserva_uh AND tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Quarto da reserva não encontrado'; END IF;
  PERFORM public._hs_exige_filial(ru.filial_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('hs_cal:' || ru.filial_id::text, 0));
  SELECT * INTO ru FROM public.hs_reserva_uhs WHERE id = p_reserva_uh FOR UPDATE;
  IF ru.situacao <> 'hospedada' THEN RAISE EXCEPTION 'Só dá para estender a estadia de quarto hospedado (situação atual: %)', ru.situacao; END IF;
  IF p_nova_saida IS NULL OR p_nova_saida <= ru.saida THEN RAISE EXCEPTION 'A nova saída precisa ser depois da saída atual (%)', to_char(ru.saida, 'DD/MM/YYYY'); END IF;
  IF p_nova_saida - ru.entrada > 365 THEN RAISE EXCEPTION 'A estadia não pode passar de 365 noites'; END IF;
  IF v_acordo IS NOT NULL AND NOT v_gestao THEN RAISE EXCEPTION 'O valor combinado das noites novas só pode ser dado pela gestão'; END IF;
  IF v_acordo IS NOT NULL AND v_acordo < 0 THEN RAISE EXCEPTION 'O valor não pode ser negativo'; END IF;
  IF EXISTS (SELECT 1 FROM public.hs_ocupacoes o WHERE o.uh_id = ru.uh_id AND o.reserva_uh_id IS DISTINCT FROM ru.id
                AND o.periodo && daterange(ru.saida, p_nova_saida, '[)')) THEN
    RAISE EXCEPTION 'A acomodação não está livre de % a %', to_char(ru.saida, 'DD/MM/YYYY'), to_char(p_nova_saida, 'DD/MM/YYYY');
  END IF;
  v_n := p_nova_saida - ru.saida;
  v_base := CASE WHEN v_acordo IS NOT NULL THEN trunc(v_acordo / v_n, 2) END;
  FOR i IN 0 .. v_n - 1 LOOP
    IF v_acordo IS NOT NULL THEN
      v_val := CASE WHEN i = v_n - 1 THEN v_acordo - v_base * (v_n - 1) ELSE v_base END; v_tar := NULL;
    ELSE
      SELECT x.o_valor, x.o_tarifa, x.o_minimo INTO v_val, v_tar, v_min FROM public._hs_preco_noite(ru.tipo_id, ru.saida + i, ru.adultos, ru.criancas) x;
    END IF;
    INSERT INTO public.hs_diarias (tenant_id, reserva_uh_id, data, valor, tarifa_id) VALUES (ru.tenant_id, ru.id, ru.saida + i, v_val, v_tar);
    v_total := v_total + v_val;
  END LOOP;
  SELECT id INTO v_oc FROM public.hs_ocupacoes WHERE reserva_uh_id = ru.id AND uh_id = ru.uh_id ORDER BY lower(periodo) DESC LIMIT 1;
  BEGIN
    UPDATE public.hs_ocupacoes SET periodo = daterange(lower(periodo), p_nova_saida, '[)') WHERE id = v_oc;
  EXCEPTION WHEN exclusion_violation THEN
    RAISE EXCEPTION 'A acomodação acabou de ser reservada para este período';
  END;
  UPDATE public.hs_reserva_uhs SET saida = p_nova_saida WHERE id = ru.id;
  RETURN jsonb_build_object('reserva_uh_id', ru.id, 'noites_novas', v_n, 'valor_novas_noites', v_total);
END $$;
REVOKE ALL ON FUNCTION public.hs_estadia_estender(uuid, date, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hs_estadia_estender(uuid, date, numeric) TO authenticated;

-- Encurtar: tira as noites que sobram (nenhuma delas pode já estar lançada na conta). O check-out antecipado é da migration seguinte.
CREATE OR REPLACE FUNCTION public.hs_estadia_encurtar(p_reserva_uh uuid, p_nova_saida date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE ru public.hs_reserva_uhs%ROWTYPE; v_hoje date; v_removidas integer;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._hs_exige_liberado();
  SELECT * INTO ru FROM public.hs_reserva_uhs WHERE id = p_reserva_uh AND tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Quarto da reserva não encontrado'; END IF;
  PERFORM public._hs_exige_filial(ru.filial_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('hs_cal:' || ru.filial_id::text, 0));
  SELECT * INTO ru FROM public.hs_reserva_uhs WHERE id = p_reserva_uh FOR UPDATE;
  IF ru.situacao <> 'hospedada' THEN RAISE EXCEPTION 'Só dá para encurtar a estadia de quarto hospedado (situação atual: %)', ru.situacao; END IF;
  v_hoje := public._hs_hoje(ru.filial_id);
  IF p_nova_saida IS NULL OR p_nova_saida >= ru.saida THEN RAISE EXCEPTION 'A nova saída precisa ser antes da saída atual (%)', to_char(ru.saida, 'DD/MM/YYYY'); END IF;
  IF p_nova_saida <= ru.entrada THEN RAISE EXCEPTION 'A nova saída precisa ser depois da entrada (%)', to_char(ru.entrada, 'DD/MM/YYYY'); END IF;
  IF p_nova_saida < v_hoje THEN RAISE EXCEPTION 'A nova saída não pode ficar no passado'; END IF;
  IF EXISTS (SELECT 1 FROM public.hs_diarias d WHERE d.reserva_uh_id = ru.id AND d.data >= p_nova_saida AND d.lancada) THEN
    RAISE EXCEPTION 'A noite de % já foi lançada na conta: estorne a diária antes (gestão)',
      to_char((SELECT min(d.data) FROM public.hs_diarias d WHERE d.reserva_uh_id = ru.id AND d.data >= p_nova_saida AND d.lancada), 'DD/MM/YYYY');
  END IF;
  DELETE FROM public.hs_diarias WHERE reserva_uh_id = ru.id AND data >= p_nova_saida;
  GET DIAGNOSTICS v_removidas = ROW_COUNT;
  DELETE FROM public.hs_ocupacoes WHERE reserva_uh_id = ru.id AND lower(periodo) >= p_nova_saida;
  UPDATE public.hs_ocupacoes SET periodo = daterange(lower(periodo), p_nova_saida, '[)') WHERE reserva_uh_id = ru.id AND upper(periodo) > p_nova_saida;
  UPDATE public.hs_reserva_uhs SET saida = p_nova_saida WHERE id = ru.id;
  RETURN jsonb_build_object('reserva_uh_id', ru.id, 'noites_removidas', v_removidas);
END $$;
REVOKE ALL ON FUNCTION public.hs_estadia_encurtar(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hs_estadia_encurtar(uuid, date) TO authenticated;

-- Troca de quarto no meio da estadia, a partir de hoje: a acomodação antiga fica suja e as noites ainda não lançadas passam a valer pelo
-- tipo novo (manter o preço combinado é decisão da gestão). A ocupação antiga termina hoje e a nova vai até a saída.
CREATE OR REPLACE FUNCTION public.hs_estadia_trocar_uh(p_reserva_uh uuid, p_nova_uh uuid, p_motivo text, p_manter_preco boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_gestao boolean := public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor');
  ru public.hs_reserva_uhs%ROWTYPE; v_uh public.hs_uhs%ROWTYPE; v_antiga uuid; v_motivo text := btrim(coalesce(p_motivo, ''));
  v_hoje date; v_oc public.hs_ocupacoes%ROWTYPE; i integer; v_val numeric; v_tar uuid; v_min integer; v_tipo_antigo uuid;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._hs_exige_liberado();
  SELECT * INTO ru FROM public.hs_reserva_uhs WHERE id = p_reserva_uh AND tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Quarto da reserva não encontrado'; END IF;
  PERFORM public._hs_exige_filial(ru.filial_id);
  IF coalesce(p_manter_preco, false) AND NOT v_gestao THEN RAISE EXCEPTION 'Manter o preço na troca de tipo só pode ser decidido pela gestão'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hs_cal:' || ru.filial_id::text, 0));
  SELECT * INTO ru FROM public.hs_reserva_uhs WHERE id = p_reserva_uh FOR UPDATE;
  IF ru.situacao <> 'hospedada' THEN RAISE EXCEPTION 'Só dá para trocar o quarto no meio da estadia de quarto hospedado (situação atual: %)', ru.situacao; END IF;
  IF ru.uh_id = p_nova_uh THEN RETURN jsonb_build_object('reserva_uh_id', ru.id, 'repetido', true); END IF;
  IF length(v_motivo) < 3 THEN RAISE EXCEPTION 'Informe o motivo da troca de quarto'; END IF;
  v_hoje := public._hs_hoje(ru.filial_id);
  IF v_hoje >= ru.saida THEN RAISE EXCEPTION 'A estadia vence hoje ou já venceu: estenda a saída antes de trocar de quarto'; END IF;

  SELECT u.* INTO v_uh FROM public.hs_uhs u JOIN public.hs_tipos_uh t ON t.id = u.tipo_id
   WHERE u.id = p_nova_uh AND u.tenant_id = ru.tenant_id AND u.filial_id = ru.filial_id AND u.ativo AND NOT u.interditada AND t.ativo;
  IF NOT FOUND THEN RAISE EXCEPTION 'Escolha uma acomodação disponível para venda'; END IF;
  IF v_uh.situacao_limpeza = 'sujo' THEN RAISE EXCEPTION 'A acomodação % está suja: libere a limpeza antes', v_uh.numero; END IF;
  IF EXISTS (SELECT 1 FROM public.hs_reserva_uhs x WHERE x.uh_id = v_uh.id AND x.situacao = 'hospedada') THEN
    RAISE EXCEPTION 'A acomodação % está ocupada por outra hospedagem', v_uh.numero;
  END IF;
  PERFORM public._hs_exige_capacidade(v_uh.tipo_id, ru.adultos, ru.criancas);
  IF EXISTS (SELECT 1 FROM public.hs_ocupacoes o WHERE o.uh_id = v_uh.id AND o.periodo && daterange(v_hoje, ru.saida, '[)')) THEN
    RAISE EXCEPTION 'A acomodação % não está livre de % a %', v_uh.numero, to_char(v_hoje, 'DD/MM/YYYY'), to_char(ru.saida, 'DD/MM/YYYY');
  END IF;

  v_antiga := ru.uh_id; v_tipo_antigo := ru.tipo_id;
  SELECT * INTO v_oc FROM public.hs_ocupacoes WHERE reserva_uh_id = ru.id AND uh_id = ru.uh_id ORDER BY lower(periodo) DESC LIMIT 1;
  BEGIN
    IF lower(v_oc.periodo) >= v_hoje THEN
      UPDATE public.hs_ocupacoes SET uh_id = v_uh.id WHERE id = v_oc.id;
    ELSE
      UPDATE public.hs_ocupacoes SET periodo = daterange(lower(periodo), v_hoje, '[)') WHERE id = v_oc.id;
      INSERT INTO public.hs_ocupacoes (tenant_id, filial_id, uh_id, periodo, origem, reserva_uh_id)
      VALUES (ru.tenant_id, ru.filial_id, v_uh.id, daterange(v_hoje, ru.saida, '[)'), 'reserva', ru.id);
    END IF;
  EXCEPTION WHEN exclusion_violation THEN
    RAISE EXCEPTION 'A acomodação % acabou de ser reservada para este período', v_uh.numero;
  END;
  UPDATE public.hs_uhs SET situacao_limpeza = 'sujo' WHERE id = v_antiga;
  UPDATE public.hs_reserva_uhs SET uh_id = v_uh.id, tipo_id = v_uh.tipo_id WHERE id = ru.id;
  IF v_uh.tipo_id IS DISTINCT FROM v_tipo_antigo AND NOT coalesce(p_manter_preco, false) THEN
    DELETE FROM public.hs_diarias WHERE reserva_uh_id = ru.id AND data >= v_hoje AND NOT lancada;
    FOR i IN 0 .. (ru.saida - v_hoje) - 1 LOOP
      IF NOT EXISTS (SELECT 1 FROM public.hs_diarias WHERE reserva_uh_id = ru.id AND data = v_hoje + i) THEN
        SELECT x.o_valor, x.o_tarifa, x.o_minimo INTO v_val, v_tar, v_min FROM public._hs_preco_noite(v_uh.tipo_id, v_hoje + i, ru.adultos, ru.criancas) x;
        INSERT INTO public.hs_diarias (tenant_id, reserva_uh_id, data, valor, tarifa_id) VALUES (ru.tenant_id, ru.id, v_hoje + i, v_val, v_tar);
      END IF;
    END LOOP;
  END IF;
  PERFORM public._hs_auditar(ru.filial_id, 'hs_reserva_uhs', ru.id, 'troca_de_quarto', jsonb_build_object('uh_id', v_antiga, 'tipo_id', v_tipo_antigo),
                             jsonb_build_object('uh_id', v_uh.id, 'tipo_id', v_uh.tipo_id, 'motivo', v_motivo, 'manteve_preco', coalesce(p_manter_preco, false)));
  RETURN jsonb_build_object('reserva_uh_id', ru.id, 'repetido', false, 'uh', v_uh.numero,
    'total_diarias', (SELECT coalesce(sum(valor), 0) FROM public.hs_diarias WHERE reserva_uh_id = ru.id));
END $$;
REVOKE ALL ON FUNCTION public.hs_estadia_trocar_uh(uuid, uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hs_estadia_trocar_uh(uuid, uuid, text, boolean) TO authenticated;

-- ============ cancelamento e não comparecimento passam a tratar o sinal ============
DROP FUNCTION IF EXISTS public.hs_reserva_cancelar(uuid, text, boolean);
DROP FUNCTION IF EXISTS public.hs_reserva_uh_cancelar(uuid, text);
DROP FUNCTION IF EXISTS public.hs_reserva_no_show(uuid);

-- Sinal recebido: por padrão é devolvido (informe o caixa e a forma); reter o sinal (p_devolver_sinal = false) é decisão da gestão.
CREATE OR REPLACE FUNCTION public.hs_reserva_uh_cancelar(p_reserva_uh uuid, p_motivo text, p_devolver_sinal boolean DEFAULT true,
                                                         p_caixa uuid DEFAULT NULL, p_forma public.forma_pagamento DEFAULT NULL)
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
  IF (SELECT situacao FROM public.hs_reservas WHERE id = ru.reserva_id) = 'cancelada' THEN
    UPDATE public.hs_reservas SET motivo_cancelamento = v_motivo, cancelada_em = now() WHERE id = ru.reserva_id;
    PERFORM public._hs_encerrar_sem_estadia(ru.reserva_id, coalesce(p_devolver_sinal, true), p_caixa, p_forma, v_motivo);
  END IF;
  RETURN jsonb_build_object('reserva_uh_id', ru.id, 'repetido', false);
END $$;
REVOKE ALL ON FUNCTION public.hs_reserva_uh_cancelar(uuid, text, boolean, uuid, public.forma_pagamento) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hs_reserva_uh_cancelar(uuid, text, boolean, uuid, public.forma_pagamento) TO authenticated;

CREATE OR REPLACE FUNCTION public.hs_reserva_cancelar(p_id uuid, p_motivo text, p_devolver_sinal boolean DEFAULT true,
                                                      p_caixa uuid DEFAULT NULL, p_forma public.forma_pagamento DEFAULT NULL)
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
  PERFORM public._hs_encerrar_sem_estadia(r.id, coalesce(p_devolver_sinal, true), p_caixa, p_forma, v_motivo);
  RETURN jsonb_build_object('reserva_id', r.id, 'repetido', false);
END $$;
REVOKE ALL ON FUNCTION public.hs_reserva_cancelar(uuid, text, boolean, uuid, public.forma_pagamento) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hs_reserva_cancelar(uuid, text, boolean, uuid, public.forma_pagamento) TO authenticated;

-- Não compareceu: só a partir do dia da entrada (no próprio dia, só a gestão). Cobrar a primeira diária é da gestão. Com sinal recebido,
-- o padrão é reter (só a gestão); a recepção precisa devolver informando o caixa e a forma.
CREATE OR REPLACE FUNCTION public.hs_reserva_no_show(p_reserva_uh uuid, p_cobrar_diaria boolean DEFAULT false, p_devolver_sinal boolean DEFAULT false,
                                                     p_caixa uuid DEFAULT NULL, p_forma public.forma_pagamento DEFAULT NULL)
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
  IF coalesce(p_cobrar_diaria, false) AND NOT v_gestao THEN RAISE EXCEPTION 'Cobrar a primeira diária do não comparecimento só pode ser decidido pela gestão'; END IF;
  DELETE FROM public.hs_ocupacoes WHERE reserva_uh_id = ru.id;
  UPDATE public.hs_reserva_uhs SET situacao = 'no_show' WHERE id = ru.id;
  IF coalesce(p_cobrar_diaria, false) THEN PERFORM public._hs_lancar_diaria(ru.id, ru.entrada, false); END IF;
  PERFORM public._hs_reserva_recalcular(ru.reserva_id);
  IF (SELECT situacao FROM public.hs_reservas WHERE id = ru.reserva_id) IN ('no_show', 'cancelada') THEN
    PERFORM public._hs_encerrar_sem_estadia(ru.reserva_id, coalesce(p_devolver_sinal, false), p_caixa, p_forma, 'Não comparecimento');
  END IF;
  RETURN jsonb_build_object('reserva_uh_id', ru.id, 'repetido', false);
END $$;
REVOKE ALL ON FUNCTION public.hs_reserva_no_show(uuid, boolean, boolean, uuid, public.forma_pagamento) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hs_reserva_no_show(uuid, boolean, boolean, uuid, public.forma_pagamento) TO authenticated;
