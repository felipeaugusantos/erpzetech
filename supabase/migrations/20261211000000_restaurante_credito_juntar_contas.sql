-- Restaurante: credito na mesa / conta cliente e juntar varias contas.
--
-- Credito: dinheiro recebido adiantado (consumacao minima, cartao pre-pago, entrada). Entra na mesma tabela dos
-- pagamentos da comanda, marcado como `credito`, e por isso o fechamento e a baixa parcial ja o descontam do saldo
-- sem mudar nada neles. O dinheiro entra no caixa na hora. Se o credito passar do total da conta, a gestao devolve
-- a sobra (saida no caixa, linha negativa no mesmo registro); sem isso o fechamento recusa, como ja fazia.
--
-- Juntar contas: os itens, os pagamentos e as pessoas das contas de origem passam para a conta de destino, e as
-- origens ficam canceladas com a marca de "unida". Nada e recalculado: serviço e couvert sao os da conta de destino,
-- por isso contas com percentuais diferentes so se juntam com a escolha expressa da gestao.

ALTER TABLE public.comanda_pagamentos
  ADD COLUMN IF NOT EXISTS credito boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS observacao text CHECK (observacao IS NULL OR char_length(observacao) <= 200);

-- valor negativo so existe como devolucao de credito
ALTER TABLE public.comanda_pagamentos DROP CONSTRAINT IF EXISTS comanda_pagamentos_valor_check;
ALTER TABLE public.comanda_pagamentos DROP CONSTRAINT IF EXISTS comanda_pagamentos_valor_ck;
ALTER TABLE public.comanda_pagamentos ADD CONSTRAINT comanda_pagamentos_valor_ck
  CHECK ((credito AND valor <> 0) OR (NOT credito AND valor > 0));

ALTER TABLE public.comandas ADD COLUMN IF NOT EXISTS unida_em_id uuid;

-- ===== Receber credito =====
CREATE OR REPLACE FUNCTION public.restaurante_creditar_comanda(
  p_comanda_id uuid,
  p_pagamentos jsonb,
  p_caixa_id uuid
) RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.restaurante_contexto(ARRAY['administrador', 'gestor', 'caixa']::public.app_role[]);
  v_cmd public.comandas;
  v_pag jsonb;
  v_forma public.forma_pagamento;
  v_valor numeric(14,2);
  v_total numeric(14,2) := 0;
  v_caixa_filial uuid;
BEGIN
  SELECT * INTO v_cmd FROM public.comandas WHERE id = p_comanda_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND OR v_cmd.situacao <> 'aberta' THEN RAISE EXCEPTION 'Comanda não encontrada ou já encerrada'; END IF;
  IF jsonb_typeof(coalesce(p_pagamentos, '[]'::jsonb)) <> 'array' THEN RAISE EXCEPTION 'Pagamentos em formato inválido'; END IF;

  FOR v_pag IN SELECT * FROM jsonb_array_elements(coalesce(p_pagamentos, '[]'::jsonb)) LOOP
    BEGIN
      v_forma := (v_pag ->> 'forma')::public.forma_pagamento;
      v_valor := round((v_pag ->> 'valor')::numeric, 2);
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Pagamento inválido: %', v_pag;
    END;
    IF v_forma IN ('crediario', 'boleto') THEN RAISE EXCEPTION 'Crediário e boleto não são aceitos como crédito'; END IF;
    IF v_valor IS NULL OR v_valor <= 0 THEN RAISE EXCEPTION 'Informe um valor maior que zero em cada pagamento'; END IF;
    v_total := v_total + v_valor;
  END LOOP;
  IF v_total <= 0 THEN RAISE EXCEPTION 'Informe o valor do crédito'; END IF;
  IF v_total > 100000 THEN RAISE EXCEPTION 'Crédito acima do limite de R$ 100.000,00 por lançamento'; END IF;

  IF p_caixa_id IS NULL THEN RAISE EXCEPTION 'Informe o caixa aberto para receber'; END IF;
  SELECT filial_id INTO v_caixa_filial FROM public.caixas
   WHERE id = p_caixa_id AND tenant_id = v_tenant AND situacao = 'aberto';
  IF NOT FOUND THEN RAISE EXCEPTION 'Caixa não encontrado ou já fechado'; END IF;
  IF v_cmd.filial_id IS NOT NULL AND v_caixa_filial IS DISTINCT FROM v_cmd.filial_id THEN
    RAISE EXCEPTION 'O caixa informado é de outra filial';
  END IF;

  FOR v_pag IN SELECT * FROM jsonb_array_elements(p_pagamentos) LOOP
    v_forma := (v_pag ->> 'forma')::public.forma_pagamento;
    v_valor := round((v_pag ->> 'valor')::numeric, 2);
    INSERT INTO public.comanda_pagamentos (tenant_id, comanda_id, forma, valor, pagante, usuario_id, credito)
    VALUES (v_tenant, p_comanda_id, v_forma, v_valor, nullif(btrim(v_pag ->> 'pagante'), ''), auth.uid(), true);
    PERFORM public.caixa_lancar(p_caixa_id, 'venda'::public.caixa_mov_tipo, v_valor,
                                'Comanda ' || v_cmd.numero || ' (crédito)', v_forma, NULL, NULL);
  END LOOP;
  RETURN v_total;
END;
$$;

-- ===== Devolver a sobra do credito =====
CREATE OR REPLACE FUNCTION public.restaurante_devolver_credito(
  p_comanda_id uuid,
  p_valor numeric,
  p_caixa_id uuid,
  p_motivo text,
  p_forma public.forma_pagamento DEFAULT 'dinheiro',
  p_cobrar_servico boolean DEFAULT true
) RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.restaurante_contexto(ARRAY['administrador', 'gestor']::public.app_role[]);
  v_cmd public.comandas;
  v_valor numeric(14,2) := round(p_valor, 2);
  v_subtotal numeric(14,2);
  v_bruto numeric(14,2);
  v_recebido numeric(14,2);
  v_credito numeric(14,2);
  v_sobra numeric(14,2);
  v_caixa_filial uuid;
BEGIN
  IF v_valor IS NULL OR v_valor <= 0 THEN RAISE EXCEPTION 'Informe um valor maior que zero'; END IF;
  IF coalesce(char_length(btrim(p_motivo)), 0) < 3 THEN RAISE EXCEPTION 'Informe o motivo da devolução'; END IF;
  IF p_forma IN ('crediario', 'boleto') THEN RAISE EXCEPTION 'Forma de devolução inválida'; END IF;

  SELECT * INTO v_cmd FROM public.comandas WHERE id = p_comanda_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND OR v_cmd.situacao <> 'aberta' THEN RAISE EXCEPTION 'Comanda não encontrada ou já encerrada'; END IF;

  SELECT coalesce(sum(total), 0) INTO v_subtotal
    FROM public.comanda_itens WHERE comanda_id = p_comanda_id AND situacao <> 'cancelado';
  v_bruto := v_subtotal + round(coalesce(v_cmd.pessoas, 0) * v_cmd.couvert_por_pessoa, 2)
             + CASE WHEN p_cobrar_servico THEN round(v_subtotal * v_cmd.taxa_servico_percentual / 100, 2) ELSE 0 END;
  SELECT coalesce(sum(valor), 0), coalesce(sum(valor) FILTER (WHERE credito), 0)
    INTO v_recebido, v_credito FROM public.comanda_pagamentos WHERE comanda_id = p_comanda_id;

  -- só a sobra: o que foi recebido acima do total atual da conta, e nunca mais do que o crédito lançado
  v_sobra := least(v_recebido - v_bruto, v_credito);
  IF v_valor > v_sobra THEN
    RAISE EXCEPTION 'Só é possível devolver a sobra do crédito (disponível: %)', greatest(v_sobra, 0);
  END IF;

  IF p_caixa_id IS NULL THEN RAISE EXCEPTION 'Informe o caixa aberto para devolver'; END IF;
  SELECT filial_id INTO v_caixa_filial FROM public.caixas
   WHERE id = p_caixa_id AND tenant_id = v_tenant AND situacao = 'aberto';
  IF NOT FOUND THEN RAISE EXCEPTION 'Caixa não encontrado ou já fechado'; END IF;
  IF v_cmd.filial_id IS NOT NULL AND v_caixa_filial IS DISTINCT FROM v_cmd.filial_id THEN
    RAISE EXCEPTION 'O caixa informado é de outra filial';
  END IF;

  INSERT INTO public.comanda_pagamentos (tenant_id, comanda_id, forma, valor, usuario_id, credito, observacao)
  VALUES (v_tenant, p_comanda_id, p_forma, -v_valor, auth.uid(), true, left('Devolução: ' || btrim(p_motivo), 200));
  PERFORM public.caixa_lancar(p_caixa_id, 'saida'::public.caixa_mov_tipo, v_valor,
                              'Devolução de crédito - comanda ' || v_cmd.numero, p_forma, NULL, NULL);
  RETURN v_valor;
END;
$$;

-- ===== Cancelar: credito totalmente devolvido libera o cancelamento =====
-- A funcao atual (com a devolucao de insumos da ficha tecnica) e ajustada no lugar, sem reescrever o corpo.
DO $$
DECLARE
  def text := pg_get_functiondef('public.restaurante_cancelar_comanda(uuid, text)'::regprocedure);
  novo text;
BEGIN
  -- ja ajustada (migration rodada antes): nada a fazer
  IF def LIKE '%coalesce(sum(valor), 0) FROM public.comanda_pagamentos%' THEN RETURN; END IF;
  novo := replace(def,
    $q$IF EXISTS (SELECT 1 FROM public.comanda_pagamentos WHERE comanda_id = p_comanda_id) THEN$q$,
    $q$IF (SELECT coalesce(sum(valor), 0) FROM public.comanda_pagamentos WHERE comanda_id = p_comanda_id) <> 0 THEN$q$);
  novo := replace(novo,
    $q$A comanda já recebeu pagamentos (baixa parcial): feche a conta em vez de cancelar$q$,
    $q$A comanda já recebeu pagamentos ou crédito: devolva o crédito ou feche a conta em vez de cancelar$q$);
  IF novo = def OR novo NOT LIKE '%coalesce(sum(valor), 0) FROM public.comanda_pagamentos%' THEN
    RAISE EXCEPTION 'Não foi possível ajustar restaurante_cancelar_comanda ao crédito';
  END IF;
  EXECUTE novo;
END $$;

-- ===== Juntar contas =====
CREATE OR REPLACE FUNCTION public.restaurante_juntar_comandas(
  p_destino uuid,
  p_origens uuid[],
  p_usar_taxas_destino boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.restaurante_contexto(ARRAY['administrador', 'gestor', 'garcom', 'caixa']::public.app_role[]);
  v_origens uuid[];
  v_dest public.comandas;
  v_o public.comandas;
  v_pessoas integer;
  v_pagas integer;
  v_itens integer;
  v_pags integer;
  v_diferentes boolean := false;
BEGIN
  IF p_destino IS NULL OR p_origens IS NULL OR cardinality(p_origens) = 0 THEN
    RAISE EXCEPTION 'Escolha as contas que serão juntadas';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_origens) x WHERE x IS NULL) THEN RAISE EXCEPTION 'Conta inválida na lista'; END IF;
  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_origens FROM unnest(p_origens) x;
  IF p_destino = ANY (v_origens) THEN RAISE EXCEPTION 'A conta de destino não pode ser uma das juntadas'; END IF;
  IF cardinality(v_origens) > 20 THEN RAISE EXCEPTION 'Junte no máximo 20 contas por vez'; END IF;
  IF p_usar_taxas_destino AND NOT public.restaurante_gestao() THEN
    RAISE EXCEPTION 'Usar o serviço e o couvert da conta de destino é decisão da gestão';
  END IF;

  -- trava todas na mesma ordem (evita impasse entre duas junções simultâneas)
  PERFORM 1 FROM public.comandas
   WHERE tenant_id = v_tenant AND id = ANY (v_origens || p_destino) ORDER BY id FOR UPDATE;
  SELECT * INTO v_dest FROM public.comandas WHERE id = p_destino AND tenant_id = v_tenant;
  IF NOT FOUND OR v_dest.situacao <> 'aberta' THEN RAISE EXCEPTION 'Conta de destino não encontrada ou já encerrada'; END IF;
  IF v_dest.tipo <> 'salao' THEN RAISE EXCEPTION 'Só contas do salão podem ser juntadas (delivery não)'; END IF;

  v_pessoas := coalesce(v_dest.pessoas, 0);
  v_pagas := v_dest.pessoas_pagas;
  FOR v_o IN SELECT * FROM public.comandas WHERE id = ANY (v_origens) AND tenant_id = v_tenant ORDER BY id LOOP
    IF v_o.situacao <> 'aberta' THEN RAISE EXCEPTION 'A conta % já foi encerrada', v_o.numero; END IF;
    IF v_o.tipo <> 'salao' THEN RAISE EXCEPTION 'A conta % é delivery e não pode ser juntada', v_o.numero; END IF;
    IF v_o.filial_id IS DISTINCT FROM v_dest.filial_id THEN
      RAISE EXCEPTION 'A conta % é de outra filial', v_o.numero;
    END IF;
    IF v_o.couvert_por_pessoa <> v_dest.couvert_por_pessoa
       OR v_o.taxa_servico_percentual <> v_dest.taxa_servico_percentual THEN
      v_diferentes := true;
      IF NOT p_usar_taxas_destino THEN
        RAISE EXCEPTION 'A conta % tem serviço/couvert diferentes da conta de destino: a gestão precisa autorizar o uso dos da conta de destino', v_o.numero;
      END IF;
    END IF;
    v_pessoas := v_pessoas + coalesce(v_o.pessoas, 0);
    v_pagas := v_pagas + v_o.pessoas_pagas;
  END LOOP;
  IF (SELECT count(*) FROM public.comandas WHERE id = ANY (v_origens) AND tenant_id = v_tenant) <> cardinality(v_origens) THEN
    RAISE EXCEPTION 'Alguma das contas escolhidas não foi encontrada';
  END IF;

  UPDATE public.comanda_itens SET comanda_id = p_destino WHERE comanda_id = ANY (v_origens) AND tenant_id = v_tenant;
  GET DIAGNOSTICS v_itens = ROW_COUNT;
  UPDATE public.comanda_pagamentos SET comanda_id = p_destino WHERE comanda_id = ANY (v_origens) AND tenant_id = v_tenant;
  GET DIAGNOSTICS v_pags = ROW_COUNT;

  UPDATE public.comandas
     SET pessoas = nullif(v_pessoas, 0), pessoas_pagas = v_pagas
   WHERE id = p_destino;
  UPDATE public.comandas
     SET situacao = 'cancelada', unida_em_id = p_destino,
         motivo_cancelamento = 'Unida à comanda ' || v_dest.numero,
         fechada_em = now(), fechada_por = auth.uid()
   WHERE id = ANY (v_origens) AND tenant_id = v_tenant;

  RETURN jsonb_build_object('unidas', cardinality(v_origens), 'itens', v_itens, 'pagamentos', v_pags,
                            'taxas_do_destino', v_diferentes);
END;
$$;

REVOKE ALL ON FUNCTION public.restaurante_creditar_comanda(uuid, jsonb, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.restaurante_devolver_credito(uuid, numeric, uuid, text, public.forma_pagamento, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.restaurante_juntar_comandas(uuid, uuid[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restaurante_creditar_comanda(uuid, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restaurante_devolver_credito(uuid, numeric, uuid, text, public.forma_pagamento, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restaurante_juntar_comandas(uuid, uuid[], boolean) TO authenticated;
