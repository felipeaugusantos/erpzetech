-- Manufatura (fase 2, parte 1): roteiro de etapas da marcenaria, apontamento por etapa e custo de mão de obra por hora.
-- Etapa tem custo por hora; ao liberar a ordem, as etapas ativas da empresa viram o roteiro da ordem (cópia, com o custo de hoje).
-- Apontar com etapa e minutos soma minutos x custo por hora ao custo real e ao custo do acabado (linha padrão). Sem etapa, os minutos
-- só ficam registrados. Custo real em produção = insumos + mão de obra apontada; ao concluir soma também a mão de obra manual da ordem.
-- Pode ser rodado de novo sem erro. Escrita só por funções; o custo por hora só aparece para administrador e gestor.

-- ============ tabelas ============
CREATE TABLE IF NOT EXISTS public.mf_etapas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (length(btrim(nome)) > 0),
  ordem integer NOT NULL DEFAULT 0,
  custo_hora numeric(14,2) NOT NULL DEFAULT 0 CHECK (custo_hora >= 0),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS mf_etapas_nome_idx ON public.mf_etapas (tenant_id, nome);

CREATE TABLE IF NOT EXISTS public.mf_ordem_etapas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  ordem_id uuid NOT NULL REFERENCES public.mf_ordens(id) ON DELETE CASCADE,
  nome text NOT NULL,
  ordem integer NOT NULL DEFAULT 0,
  custo_hora numeric(14,2) NOT NULL DEFAULT 0 CHECK (custo_hora >= 0),
  minutos_apontados integer NOT NULL DEFAULT 0 CHECK (minutos_apontados >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS mf_ordem_etapas_nome_idx ON public.mf_ordem_etapas (ordem_id, nome);

ALTER TABLE public.mf_apontamentos ADD COLUMN IF NOT EXISTS ordem_etapa_id uuid REFERENCES public.mf_ordem_etapas(id);
ALTER TABLE public.mf_ordens ADD COLUMN IF NOT EXISTS custo_mao_obra_apontada numeric(14,2) NOT NULL DEFAULT 0 CHECK (custo_mao_obra_apontada >= 0);

-- ============ acesso: leitura só da gestão (tem custo por hora), escrita só pelas funções ============
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['mf_etapas', 'mf_ordem_etapas'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_ler', t);
    EXECUTE format('DROP POLICY IF EXISTS salao_restrito ON public.%I', t);
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
      USING (tenant_id = public.current_tenant_id()
             AND (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')))$p$, t || '_ler', t);
    EXECUTE format('CREATE POLICY salao_restrito ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()))', t);
  END LOOP;
  EXECUTE 'DROP TRIGGER IF EXISTS trg_mf_etapas_updated ON public.mf_etapas';
  EXECUTE 'CREATE TRIGGER trg_mf_etapas_updated BEFORE UPDATE ON public.mf_etapas FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()';
END $$;

-- ============ roteiro-padrão da empresa ============
-- Cria (sem id) ou edita uma etapa: nome, ordem, custo_hora, ativo.
CREATE OR REPLACE FUNCTION public.mf_etapa_salvar(p_dados jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_id uuid := nullif(p_dados ->> 'id', '')::uuid;
  v_nome text := btrim(coalesce(p_dados ->> 'nome', ''));
  v_ordem integer := coalesce(nullif(p_dados ->> 'ordem', '')::integer, 0);
  v_custo numeric := coalesce(nullif(p_dados ->> 'custo_hora', '')::numeric, 0);
  v_ativo boolean := coalesce((p_dados ->> 'ativo')::boolean, true);
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  PERFORM public._mf_exige_liberado();
  IF v_nome = '' THEN RAISE EXCEPTION 'Informe o nome da etapa'; END IF;
  IF v_custo < 0 THEN RAISE EXCEPTION 'O custo por hora não pode ser negativo'; END IF;
  IF v_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.mf_etapas WHERE tenant_id = v_tenant AND nome = v_nome) THEN RAISE EXCEPTION 'Já existe uma etapa com esse nome'; END IF;
    INSERT INTO public.mf_etapas (tenant_id, nome, ordem, custo_hora, ativo) VALUES (v_tenant, v_nome, v_ordem, v_custo, v_ativo) RETURNING id INTO v_id;
  ELSE
    IF EXISTS (SELECT 1 FROM public.mf_etapas WHERE tenant_id = v_tenant AND nome = v_nome AND id <> v_id) THEN RAISE EXCEPTION 'Já existe uma etapa com esse nome'; END IF;
    UPDATE public.mf_etapas SET nome = v_nome, ordem = v_ordem, custo_hora = v_custo, ativo = v_ativo WHERE id = v_id AND tenant_id = v_tenant;
    IF NOT FOUND THEN RAISE EXCEPTION 'Etapa não encontrada'; END IF;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.mf_etapa_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mf_etapa_salvar(jsonb) TO authenticated;

-- Cria as etapas de marcenaria se a empresa ainda não tem nenhuma (custo por hora zerado: a gestão informa depois).
CREATE OR REPLACE FUNCTION public.mf_etapas_iniciais() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_n integer;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  PERFORM public._mf_exige_liberado();
  PERFORM pg_advisory_xact_lock(hashtextextended('mf_etapas:' || v_tenant::text, 0));
  IF EXISTS (SELECT 1 FROM public.mf_etapas WHERE tenant_id = v_tenant) THEN RETURN 0; END IF;
  INSERT INTO public.mf_etapas (tenant_id, nome, ordem)
  VALUES (v_tenant, 'Corte', 10), (v_tenant, 'Furação e usinagem', 20), (v_tenant, 'Montagem', 30),
         (v_tenant, 'Pintura ou acabamento', 40), (v_tenant, 'Embalagem', 50);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.mf_etapas_iniciais() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mf_etapas_iniciais() TO authenticated;

-- ============ funções que mudam ============
-- A assinatura de mf_ordem_apontar ganha p_etapa_id (opcional); a antiga sai para não haver duas versões ambíguas.
DROP FUNCTION IF EXISTS public.mf_ordem_apontar(uuid, numeric, numeric, integer, text);

CREATE OR REPLACE FUNCTION public.mf_ordem_liberar(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  o public.mf_ordens;
  r record;
  v_neg boolean; v_qtd numeric; v_res numeric; v_nome text;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  PERFORM public._mf_exige_liberado();
  SELECT * INTO o FROM public.mf_ordens WHERE id = p_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ordem de produção não encontrada'; END IF;
  IF o.situacao <> 'planejada' THEN RAISE EXCEPTION 'Só a ordem planejada pode ser liberada'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.mf_ordem_insumos WHERE ordem_id = p_id) THEN RAISE EXCEPTION 'Inclua ao menos um insumo antes de liberar'; END IF;
  SELECT permite_negativo INTO v_neg FROM public.depositos WHERE id = o.deposito_insumos_id AND tenant_id = v_tenant;

  -- recalcula o custo padrão com o custo de hoje e reserva em ordem fixa (evita impasse entre ordens)
  FOR r IN SELECT oi.* FROM public.mf_ordem_insumos oi WHERE oi.ordem_id = p_id ORDER BY oi.insumo_id LOOP
    INSERT INTO public.estoques (tenant_id, produto_id, deposito_id, quantidade, reservado)
    VALUES (v_tenant, r.insumo_id, o.deposito_insumos_id, 0, 0) ON CONFLICT (produto_id, deposito_id) DO NOTHING;
    SELECT quantidade, reservado INTO v_qtd, v_res FROM public.estoques
     WHERE produto_id = r.insumo_id AND deposito_id = o.deposito_insumos_id AND tenant_id = v_tenant FOR UPDATE;
    IF r.quantidade_planejada > v_qtd - v_res AND NOT coalesce(v_neg, false) THEN
      SELECT descricao INTO v_nome FROM public.produtos WHERE id = r.insumo_id;
      RAISE EXCEPTION 'Estoque insuficiente de % para liberar a ordem (disponível: %, necessário: %)', v_nome, v_qtd - v_res, r.quantidade_planejada;
    END IF;
    UPDATE public.estoques SET reservado = reservado + r.quantidade_planejada, updated_at = now()
     WHERE produto_id = r.insumo_id AND deposito_id = o.deposito_insumos_id AND tenant_id = v_tenant;
    UPDATE public.mf_ordem_insumos
       SET quantidade_reservada = r.quantidade_planejada,
           custo_unitario_padrao = round(coalesce(public._mf_custo(r.insumo_id, o.deposito_insumos_id), 0), 4)
     WHERE id = r.id;
  END LOOP;
  -- roteiro: copia as etapas ativas da empresa para a ordem (com o custo por hora de hoje); depois da liberação não muda
  INSERT INTO public.mf_ordem_etapas (tenant_id, ordem_id, nome, ordem, custo_hora)
  SELECT v_tenant, p_id, e.nome, e.ordem, e.custo_hora FROM public.mf_etapas e
   WHERE e.tenant_id = v_tenant AND e.ativo
     AND NOT EXISTS (SELECT 1 FROM public.mf_ordem_etapas x WHERE x.ordem_id = p_id);
  UPDATE public.mf_ordens
     SET situacao = 'liberada', liberada_em = now(),
         custo_padrao = round(coalesce((SELECT sum(quantidade_planejada * custo_unitario_padrao) FROM public.mf_ordem_insumos WHERE ordem_id = p_id), 0) + mao_de_obra, 2)
   WHERE id = p_id;
END $$;
REVOKE ALL ON FUNCTION public.mf_ordem_liberar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mf_ordem_liberar(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mf_ordem_apontar(p_ordem_id uuid, p_boa numeric, p_refugo numeric, p_minutos integer, p_chave text, p_etapa_id uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_chave text := btrim(coalesce(p_chave, ''));
  v_boa numeric := coalesce(p_boa, 0);
  v_ref numeric := coalesce(p_refugo, 0);
  o public.mf_ordens;
  v_ap uuid; v_ap_ordem uuid;
  r record;
  v_neg boolean; v_qtd numeric; v_res numeric; v_custo_est numeric; v_custo_prod numeric; v_custo numeric;
  v_alvo numeric; v_consumo numeric; v_da_reserva numeric; v_extra numeric; v_unidade text; v_nome text;
  v_custo_total numeric := 0; v_mao_ap numeric := 0; v_oe public.mf_ordem_etapas; v_pool numeric; v_novo_saldo numeric; v_saldo_ant numeric; v_cu numeric; v_qtd_dest numeric;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'producao']);
  PERFORM public._mf_exige_liberado();
  IF v_chave = '' THEN RAISE EXCEPTION 'Informe a chave do apontamento'; END IF;
  IF v_boa < 0 OR v_ref < 0 OR v_boa + v_ref <= 0 THEN RAISE EXCEPTION 'Informe a quantidade produzida ou o refugo'; END IF;
  IF p_minutos IS NOT NULL AND p_minutos < 0 THEN RAISE EXCEPTION 'Os minutos não podem ser negativos'; END IF;

  -- trava a ordem antes de olhar a chave: duas chamadas iguais ao mesmo tempo ficam em fila
  SELECT * INTO o FROM public.mf_ordens WHERE id = p_ordem_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ordem de produção não encontrada'; END IF;
  SELECT id, ordem_id INTO v_ap, v_ap_ordem FROM public.mf_apontamentos WHERE tenant_id = v_tenant AND chave_idempotente = v_chave;
  IF FOUND THEN
    IF v_ap_ordem <> p_ordem_id THEN RAISE EXCEPTION 'Esta chave já foi usada em outra ordem'; END IF;
    RETURN v_ap;
  END IF;
  IF o.situacao NOT IN ('liberada', 'em_producao') THEN RAISE EXCEPTION 'Só a ordem liberada ou em produção recebe apontamento'; END IF;
  SELECT permite_negativo INTO v_neg FROM public.depositos WHERE id = o.deposito_insumos_id AND tenant_id = v_tenant;

  IF p_etapa_id IS NOT NULL THEN
    SELECT * INTO v_oe FROM public.mf_ordem_etapas WHERE id = p_etapa_id AND ordem_id = p_ordem_id AND tenant_id = v_tenant FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'A etapa não pertence a esta ordem'; END IF;
  END IF;

  INSERT INTO public.mf_apontamentos (tenant_id, ordem_id, ordem_etapa_id, quantidade_boa, refugo, minutos, chave_idempotente, usuario_id)
  VALUES (v_tenant, p_ordem_id, p_etapa_id, v_boa, v_ref, p_minutos, v_chave, auth.uid()) RETURNING id INTO v_ap;

  FOR r IN SELECT oi.* FROM public.mf_ordem_insumos oi WHERE oi.ordem_id = p_ordem_id ORDER BY oi.insumo_id LOOP
    -- consumo acumulado esperado menos o já consumido: o arredondamento não acumula erro entre apontamentos
    v_alvo := round(r.quantidade_base * 100 / (100 - r.perda_percentual) * (o.quantidade_produzida + v_boa + o.quantidade_refugo + v_ref), 3);
    v_consumo := v_alvo - r.quantidade_consumida;
    CONTINUE WHEN v_consumo <= 0;

    SELECT p.unidade, p.descricao, p.custo INTO v_unidade, v_nome, v_custo_prod FROM public.produtos p WHERE p.id = r.insumo_id AND p.tenant_id = v_tenant;
    INSERT INTO public.estoques (tenant_id, produto_id, deposito_id, quantidade, reservado)
    VALUES (v_tenant, r.insumo_id, o.deposito_insumos_id, 0, 0) ON CONFLICT (produto_id, deposito_id) DO NOTHING;
    SELECT quantidade, reservado, custo_medio INTO v_qtd, v_res, v_custo_est FROM public.estoques
     WHERE produto_id = r.insumo_id AND deposito_id = o.deposito_insumos_id AND tenant_id = v_tenant FOR UPDATE;
    v_custo := CASE WHEN coalesce(v_custo_est, 0) > 0 THEN v_custo_est ELSE coalesce(v_custo_prod, 0) END;

    v_da_reserva := least(v_consumo, r.quantidade_reservada);
    v_extra := v_consumo - v_da_reserva;
    -- o que passa da reserva da própria ordem precisa estar livre (sem reserva de outras ordens ou pedidos)
    IF v_extra > v_qtd - v_res AND NOT coalesce(v_neg, false) THEN
      RAISE EXCEPTION 'Estoque insuficiente de % no depósito dos insumos (disponível: %, necessário: %)', v_nome, v_qtd - v_res + v_da_reserva, v_consumo;
    END IF;
    UPDATE public.estoques SET quantidade = quantidade - v_consumo, reservado = greatest(reservado - v_da_reserva, 0), updated_at = now()
     WHERE produto_id = r.insumo_id AND deposito_id = o.deposito_insumos_id AND tenant_id = v_tenant;
    INSERT INTO public.estoque_movimentacoes (tenant_id, produto_id, deposito_id, tipo, quantidade, saldo_anterior, saldo_posterior, unidade,
                                              documento, motivo, usuario_id, custo_unitario, valor_total)
    VALUES (v_tenant, r.insumo_id, o.deposito_insumos_id, 'saida', v_consumo, v_qtd, v_qtd - v_consumo, v_unidade,
            'OP-' || o.numero, 'Consumo de insumo na ordem de produção', auth.uid(), round(v_custo, 4), round(v_consumo * v_custo, 2));
    UPDATE public.mf_ordem_insumos
       SET quantidade_consumida = quantidade_consumida + v_consumo,
           quantidade_reservada = quantidade_reservada - v_da_reserva,
           custo_consumido = custo_consumido + round(v_consumo * v_custo, 2)
     WHERE id = r.id;
    v_custo_total := v_custo_total + round(v_consumo * v_custo, 2);
  END LOOP;

  -- mão de obra da etapa: minutos x custo por hora da etapa na liberação da ordem
  IF p_etapa_id IS NOT NULL AND coalesce(p_minutos, 0) > 0 THEN
    v_mao_ap := round(p_minutos * v_oe.custo_hora / 60, 2);
    UPDATE public.mf_ordem_etapas SET minutos_apontados = minutos_apontados + p_minutos WHERE id = p_etapa_id;
  END IF;

  -- custo a alocar: o que foi consumido e ainda não entrou no valor das peças boas (refugo apontado antes ou sozinho fica na fila);
  -- assim o custo do acabado não depende de como a produção agrupa os apontamentos
  v_pool := o.custo_a_alocar + v_custo_total + v_mao_ap;

  -- linha padrão: o acabado entra no estoque; o custo a alocar (insumos desta rodada e o que sobrou de antes) vai para as peças boas
  IF o.entrada_estoque AND v_boa > 0 THEN
    INSERT INTO public.estoques (tenant_id, produto_id, deposito_id, quantidade, reservado)
    VALUES (v_tenant, o.produto_id, o.deposito_destino_id, 0, 0) ON CONFLICT (produto_id, deposito_id) DO NOTHING;
    SELECT quantidade INTO v_saldo_ant FROM public.estoques
     WHERE produto_id = o.produto_id AND deposito_id = o.deposito_destino_id AND tenant_id = v_tenant FOR UPDATE;
    v_novo_saldo := v_saldo_ant + v_boa;
    UPDATE public.estoques SET quantidade = v_novo_saldo, updated_at = now()
     WHERE produto_id = o.produto_id AND deposito_id = o.deposito_destino_id AND tenant_id = v_tenant;
    v_cu := round(v_pool / v_boa, 4);
    v_pool := greatest(v_pool - round(v_boa * v_cu, 2), 0);
    SELECT unidade INTO v_unidade FROM public.produtos WHERE id = o.produto_id AND tenant_id = v_tenant;
    INSERT INTO public.estoque_movimentacoes (tenant_id, produto_id, deposito_id, tipo, quantidade, saldo_anterior, saldo_posterior, unidade,
                                              documento, motivo, usuario_id, custo_unitario, valor_total)
    VALUES (v_tenant, o.produto_id, o.deposito_destino_id, 'entrada', v_boa, v_saldo_ant, v_novo_saldo, v_unidade,
            'OP-' || o.numero, 'Entrada do produto acabado pela ordem de produção', auth.uid(), v_cu, round(v_boa * v_cu, 2));
    PERFORM public.atualizar_custo_medio(o.produto_id, o.deposito_destino_id, v_boa, v_cu);
  END IF;

  UPDATE public.mf_ordens
     SET quantidade_produzida = quantidade_produzida + v_boa, quantidade_refugo = quantidade_refugo + v_ref,
         custo_real = round(custo_real + v_custo_total + v_mao_ap, 2),
         custo_mao_obra_apontada = round(custo_mao_obra_apontada + v_mao_ap, 2),
         custo_a_alocar = CASE WHEN o.entrada_estoque THEN round(v_pool, 2) ELSE 0 END,
         situacao = 'em_producao'
   WHERE id = p_ordem_id;
  RETURN v_ap;
END $$;
REVOKE ALL ON FUNCTION public.mf_ordem_apontar(uuid, numeric, numeric, integer, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mf_ordem_apontar(uuid, numeric, numeric, integer, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mf_ordem_concluir(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  o public.mf_ordens;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  PERFORM public._mf_exige_liberado();
  SELECT * INTO o FROM public.mf_ordens WHERE id = p_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ordem de produção não encontrada'; END IF;
  IF o.situacao <> 'em_producao' THEN RAISE EXCEPTION 'Só a ordem em produção pode ser concluída'; END IF;
  PERFORM public._mf_soltar_reserva(p_id);
  UPDATE public.mf_ordens
     SET situacao = 'concluida', concluida_em = now(),
         custo_real = round(coalesce((SELECT sum(custo_consumido) FROM public.mf_ordem_insumos WHERE ordem_id = p_id), 0) + custo_mao_obra_apontada + mao_de_obra, 2)
   WHERE id = p_id;
END $$;
REVOKE ALL ON FUNCTION public.mf_ordem_concluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mf_ordem_concluir(uuid) TO authenticated;

-- ============ leitura da produção (sem custo): etapas da ordem e minutos ============
CREATE OR REPLACE FUNCTION public.mf_ordem_etapas_producao(p_ordem_id uuid)
RETURNS TABLE (id uuid, nome text, ordem integer, minutos_apontados integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'producao']);
  PERFORM public._mf_exige_liberado();
  RETURN QUERY
  SELECT e.id, e.nome, e.ordem, e.minutos_apontados FROM public.mf_ordem_etapas e
   WHERE e.ordem_id = p_ordem_id AND e.tenant_id = public.current_tenant_id() ORDER BY e.ordem, e.nome;
END $$;
REVOKE ALL ON FUNCTION public.mf_ordem_etapas_producao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mf_ordem_etapas_producao(uuid) TO authenticated;
