-- Baixa parcial da comanda: quando alguém da mesa vai embora, paga a sua parte e a mesa continua aberta.
--
-- Duas formas de baixar:
--   * por itens: o caixa escolhe os itens já entregues (e quantas unidades de cada) e quantas pessoas saem;
--     o valor devido é calculado aqui (itens + serviço proporcional + couvert das pessoas que saem);
--   * por valor: um valor livre, até o saldo da conta (ex.: dividir igualmente entre os que saem).
-- O que já foi recebido entra na conta: o fechamento final cobra só o saldo. Item pago não pode ser
-- cancelado, e comanda com pagamento recebido não pode ser cancelada (o dinheiro já está no caixa).

ALTER TABLE public.comanda_itens
  ADD COLUMN IF NOT EXISTS pago_em timestamptz,
  ADD COLUMN IF NOT EXISTS pagante text;

ALTER TABLE public.comanda_pagamentos
  ADD COLUMN IF NOT EXISTS parcial boolean NOT NULL DEFAULT false;

ALTER TABLE public.comandas
  ADD COLUMN IF NOT EXISTS pessoas_pagas integer NOT NULL DEFAULT 0 CHECK (pessoas_pagas >= 0);

-- ===== Receber uma parte da conta =====
CREATE OR REPLACE FUNCTION public.restaurante_receber_parcial(
  p_comanda_id uuid,
  p_pagamentos jsonb,
  p_caixa_id uuid,
  p_itens jsonb DEFAULT '[]'::jsonb,
  p_pessoas integer DEFAULT 0,
  p_cobrar_servico boolean DEFAULT true,
  p_pagante text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.restaurante_contexto(ARRAY['administrador', 'gestor', 'caixa']::public.app_role[]);
  v_cmd public.comandas;
  v_el jsonb;
  v_id uuid;
  v_item public.comanda_itens;
  v_qtd numeric(10,3);
  v_ids uuid[] := '{}';
  v_modo_itens boolean;
  v_valor_itens numeric(14,2) := 0;
  v_servico numeric(14,2) := 0;
  v_couvert numeric(14,2) := 0;
  v_base_antes numeric(14,2) := 0;
  v_devido numeric(14,2);
  v_pag jsonb;
  v_forma public.forma_pagamento;
  v_valor numeric(14,2);
  v_pago numeric(14,2) := 0;
  v_caixa_filial uuid;
  v_subtotal numeric(14,2);
  v_bruto numeric(14,2);
  v_ja_pago numeric(14,2);
  v_saldo numeric(14,2);
  v_pagante text := nullif(btrim(p_pagante), '');
BEGIN
  SELECT * INTO v_cmd FROM public.comandas WHERE id = p_comanda_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND OR v_cmd.situacao <> 'aberta' THEN RAISE EXCEPTION 'Comanda não encontrada ou já encerrada'; END IF;

  p_pessoas := coalesce(p_pessoas, 0);
  IF p_pessoas < 0 THEN RAISE EXCEPTION 'Quantidade de pessoas inválida'; END IF;
  IF p_pessoas > coalesce(v_cmd.pessoas, 0) - v_cmd.pessoas_pagas THEN
    RAISE EXCEPTION 'Só há % pessoa(s) com couvert ainda não pago', greatest(coalesce(v_cmd.pessoas, 0) - v_cmd.pessoas_pagas, 0);
  END IF;
  IF jsonb_typeof(coalesce(p_itens, '[]'::jsonb)) <> 'array' THEN RAISE EXCEPTION 'Itens em formato inválido'; END IF;
  IF jsonb_typeof(coalesce(p_pagamentos, '[]'::jsonb)) <> 'array' THEN RAISE EXCEPTION 'Pagamentos em formato inválido'; END IF;

  -- quem pagou: o nome informado ou o do primeiro pagamento
  v_pagante := coalesce(v_pagante, nullif(btrim(coalesce(p_pagamentos, '[]'::jsonb) -> 0 ->> 'pagante'), ''));

  v_modo_itens := jsonb_array_length(coalesce(p_itens, '[]'::jsonb)) > 0 OR p_pessoas > 0;

  IF v_modo_itens THEN
    -- itens já pagos em baixas anteriores: base do serviço acumulado
    SELECT coalesce(sum(total), 0) INTO v_base_antes
      FROM public.comanda_itens WHERE comanda_id = p_comanda_id AND pago_em IS NOT NULL AND situacao <> 'cancelado';

    FOR v_el IN SELECT * FROM jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) LOOP
      BEGIN
        v_id := (v_el ->> 'id')::uuid;
        v_qtd := nullif(v_el ->> 'quantidade', '')::numeric;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Item inválido: %', v_el;
      END;
      IF v_id = ANY (v_ids) THEN RAISE EXCEPTION 'O mesmo item aparece duas vezes na baixa'; END IF;
      v_ids := v_ids || v_id;

      SELECT * INTO v_item FROM public.comanda_itens
       WHERE id = v_id AND comanda_id = p_comanda_id AND tenant_id = v_tenant FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Item não encontrado nesta comanda'; END IF;
      IF v_item.situacao <> 'entregue' THEN
        RAISE EXCEPTION 'Só itens já entregues podem ser pagos: %', v_item.nome;
      END IF;
      IF v_item.pago_em IS NOT NULL THEN RAISE EXCEPTION 'O item % já foi pago', v_item.nome; END IF;
      v_qtd := coalesce(v_qtd, v_item.quantidade);
      IF v_qtd <= 0 OR v_qtd > v_item.quantidade THEN
        RAISE EXCEPTION 'Quantidade inválida para %', v_item.nome;
      END IF;

      IF v_qtd = v_item.quantidade THEN
        UPDATE public.comanda_itens SET pago_em = now(), pagante = v_pagante WHERE id = v_item.id;
        v_valor_itens := v_valor_itens + v_item.total;
      ELSE
        -- pagou só parte das unidades: o restante segue na conta e a parte paga vira uma linha própria
        UPDATE public.comanda_itens
           SET quantidade = v_item.quantidade - v_qtd,
               total = round((v_item.quantidade - v_qtd) * v_item.preco_unitario, 2)
         WHERE id = v_item.id;
        INSERT INTO public.comanda_itens (tenant_id, comanda_id, cardapio_item_id, nome, estacao, opcoes, quantidade,
                                          preco_unitario, total, observacao, situacao, lancado_por, enviado_em,
                                          pronto_em, entregue_em, created_at, pago_em, pagante)
        VALUES (v_item.tenant_id, v_item.comanda_id, v_item.cardapio_item_id, v_item.nome, v_item.estacao,
                v_item.opcoes, v_qtd, v_item.preco_unitario, round(v_qtd * v_item.preco_unitario, 2),
                v_item.observacao, 'entregue', v_item.lancado_por, v_item.enviado_em, v_item.pronto_em,
                v_item.entregue_em, v_item.created_at, now(), v_pagante);
        v_valor_itens := v_valor_itens + round(v_qtd * v_item.preco_unitario, 2);
      END IF;
    END LOOP;

    -- serviço acumulado: cada baixa leva a diferença entre o serviço do total pago até agora e o do total pago
    -- antes, então a soma das baixas é exatamente o serviço calculado uma vez sobre todos os itens
    IF p_cobrar_servico THEN
      v_servico := round((v_base_antes + v_valor_itens) * v_cmd.taxa_servico_percentual / 100, 2)
                   - round(v_base_antes * v_cmd.taxa_servico_percentual / 100, 2);
    END IF;
    v_couvert := round(p_pessoas * v_cmd.couvert_por_pessoa, 2);
    v_devido := v_valor_itens + v_servico + v_couvert;
    IF v_devido <= 0 THEN RAISE EXCEPTION 'Não há valor a receber nesta baixa'; END IF;
  END IF;

  FOR v_pag IN SELECT * FROM jsonb_array_elements(coalesce(p_pagamentos, '[]'::jsonb)) LOOP
    BEGIN
      v_forma := (v_pag ->> 'forma')::public.forma_pagamento;
      v_valor := round((v_pag ->> 'valor')::numeric, 2);
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Pagamento inválido: %', v_pag;
    END;
    IF v_forma IN ('crediario', 'boleto') THEN RAISE EXCEPTION 'Crediário e boleto não são aceitos na comanda'; END IF;
    IF v_valor IS NULL OR v_valor <= 0 THEN RAISE EXCEPTION 'Informe um valor maior que zero em cada pagamento'; END IF;
    v_pago := v_pago + v_valor;
  END LOOP;
  IF v_pago <= 0 THEN RAISE EXCEPTION 'Informe o pagamento'; END IF;
  IF v_modo_itens AND v_pago <> v_devido THEN
    RAISE EXCEPTION 'Os pagamentos (%) não fecham o valor desta baixa (%)', v_pago, v_devido;
  END IF;

  -- nunca receber mais do que a conta ainda deve
  SELECT coalesce(sum(total), 0) INTO v_subtotal
    FROM public.comanda_itens WHERE comanda_id = p_comanda_id AND situacao <> 'cancelado';
  v_bruto := v_subtotal + round(coalesce(v_cmd.pessoas, 0) * v_cmd.couvert_por_pessoa, 2)
             + CASE WHEN p_cobrar_servico THEN round(v_subtotal * v_cmd.taxa_servico_percentual / 100, 2) ELSE 0 END;
  SELECT coalesce(sum(valor), 0) INTO v_ja_pago FROM public.comanda_pagamentos WHERE comanda_id = p_comanda_id;
  v_saldo := v_bruto - v_ja_pago;
  IF v_pago > v_saldo THEN
    RAISE EXCEPTION 'O valor recebido (%) passa do saldo da conta (%)', v_pago, v_saldo;
  END IF;

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
    INSERT INTO public.comanda_pagamentos (tenant_id, comanda_id, forma, valor, pagante, usuario_id, parcial)
    VALUES (v_tenant, p_comanda_id, v_forma, v_valor,
            coalesce(nullif(btrim(v_pag ->> 'pagante'), ''), v_pagante), auth.uid(), true);
    PERFORM public.caixa_lancar(p_caixa_id, 'venda'::public.caixa_mov_tipo, v_valor,
                                'Comanda ' || v_cmd.numero || ' (parcial)', v_forma, NULL, NULL);
  END LOOP;

  UPDATE public.comandas SET pessoas_pagas = pessoas_pagas + p_pessoas WHERE id = p_comanda_id;

  RETURN jsonb_build_object('recebido', v_pago, 'saldo', v_saldo - v_pago, 'itens', v_valor_itens,
                            'servico', v_servico, 'couvert', v_couvert);
END;
$$;

REVOKE ALL ON FUNCTION public.restaurante_receber_parcial(uuid, jsonb, uuid, jsonb, integer, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restaurante_receber_parcial(uuid, jsonb, uuid, jsonb, integer, boolean, text) TO authenticated;

-- ===== Fechamento: cobra só o saldo =====
CREATE OR REPLACE FUNCTION public.restaurante_fechar_comanda(p_comanda_id uuid, p_pagamentos jsonb DEFAULT '[]'::jsonb, p_caixa_id uuid DEFAULT NULL::uuid, p_desconto numeric DEFAULT 0, p_cobrar_servico boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.restaurante_contexto(ARRAY['administrador', 'gestor', 'caixa']::public.app_role[]);
  v_cmd public.comandas;
  v_subtotal numeric(14,2);
  v_couvert numeric(14,2);
  v_servico numeric(14,2);
  v_bruto numeric(14,2);
  v_total numeric(14,2);
  v_pago numeric(14,2) := 0;
  v_pag jsonb;
  v_forma public.forma_pagamento;
  v_valor numeric(14,2);
  v_caixa_filial uuid;
  v_pago_antes numeric(14,2);
  v_restante numeric(14,2);
BEGIN
  SELECT * INTO v_cmd FROM public.comandas WHERE id = p_comanda_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND OR v_cmd.situacao <> 'aberta' THEN RAISE EXCEPTION 'Comanda não encontrada ou já encerrada'; END IF;

  -- depois de fechada, a comanda não aceita mais andamento: nenhum item pode ficar pelo caminho
  IF EXISTS (SELECT 1 FROM public.comanda_itens WHERE comanda_id = p_comanda_id AND situacao = 'pendente') THEN
    RAISE EXCEPTION 'Há itens ainda não enviados à cozinha: envie ou cancele antes de fechar';
  END IF;
  IF EXISTS (SELECT 1 FROM public.comanda_itens
              WHERE comanda_id = p_comanda_id AND situacao IN ('enviado', 'preparando', 'pronto')) THEN
    RAISE EXCEPTION 'Há itens ainda não entregues à mesa: entregue ou cancele antes de fechar';
  END IF;

  p_desconto := coalesce(p_desconto, 0);
  IF p_desconto < 0 THEN RAISE EXCEPTION 'Desconto inválido'; END IF;
  IF p_desconto > 0 AND NOT public.restaurante_gestao() THEN
    RAISE EXCEPTION 'Desconto só pode ser dado pela gestão';
  END IF;

  SELECT coalesce(sum(total), 0) INTO v_subtotal
    FROM public.comanda_itens WHERE comanda_id = p_comanda_id AND situacao <> 'cancelado';
  v_couvert := round(coalesce(v_cmd.pessoas, 0) * v_cmd.couvert_por_pessoa, 2);
  v_servico := CASE WHEN p_cobrar_servico THEN round(v_subtotal * v_cmd.taxa_servico_percentual / 100, 2) ELSE 0 END;
  v_bruto := v_subtotal + v_couvert + v_servico;
  IF p_desconto > v_bruto THEN RAISE EXCEPTION 'O desconto não pode passar do total da conta'; END IF;
  v_total := v_bruto - p_desconto;

  -- o que já foi recebido em baixas parciais entra na conta: aqui se paga só o saldo
  SELECT coalesce(sum(valor), 0) INTO v_pago_antes FROM public.comanda_pagamentos WHERE comanda_id = p_comanda_id;
  v_restante := v_total - v_pago_antes;
  IF v_restante < 0 THEN
    RAISE EXCEPTION 'Os pagamentos já recebidos (%) passam do total da conta (%)', v_pago_antes, v_total;
  END IF;

  IF jsonb_typeof(coalesce(p_pagamentos, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Pagamentos em formato inválido';
  END IF;

  FOR v_pag IN SELECT * FROM jsonb_array_elements(coalesce(p_pagamentos, '[]'::jsonb)) LOOP
    BEGIN
      v_forma := (v_pag ->> 'forma')::public.forma_pagamento;
      v_valor := round((v_pag ->> 'valor')::numeric, 2);
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Pagamento inválido: %', v_pag;
    END;
    IF v_forma IN ('crediario', 'boleto') THEN RAISE EXCEPTION 'Crediário e boleto não são aceitos na comanda'; END IF;
    IF v_valor IS NULL OR v_valor <= 0 THEN RAISE EXCEPTION 'Informe um valor maior que zero em cada pagamento'; END IF;
    v_pago := v_pago + v_valor;
  END LOOP;

  IF v_pago <> v_restante THEN
    RAISE EXCEPTION 'Os pagamentos (%) não fecham o saldo da conta (%)', v_pago, v_restante;
  END IF;

  IF v_restante > 0 THEN
    IF p_caixa_id IS NULL THEN RAISE EXCEPTION 'Informe o caixa aberto para receber a conta'; END IF;
    SELECT filial_id INTO v_caixa_filial FROM public.caixas
     WHERE id = p_caixa_id AND tenant_id = v_tenant AND situacao = 'aberto';
    IF NOT FOUND THEN RAISE EXCEPTION 'Caixa não encontrado ou já fechado'; END IF;
    -- o dinheiro entra no caixa da mesma filial da comanda (comanda sem filial aceita qualquer caixa da empresa)
    IF v_cmd.filial_id IS NOT NULL AND v_caixa_filial IS DISTINCT FROM v_cmd.filial_id THEN
      RAISE EXCEPTION 'O caixa informado é de outra filial';
    END IF;

    FOR v_pag IN SELECT * FROM jsonb_array_elements(p_pagamentos) LOOP
      v_forma := (v_pag ->> 'forma')::public.forma_pagamento;
      v_valor := round((v_pag ->> 'valor')::numeric, 2);
      INSERT INTO public.comanda_pagamentos (tenant_id, comanda_id, forma, valor, pagante, usuario_id)
      VALUES (v_tenant, p_comanda_id, v_forma, v_valor, nullif(btrim(v_pag ->> 'pagante'), ''), auth.uid());
      PERFORM public.caixa_lancar(p_caixa_id, 'venda'::public.caixa_mov_tipo, v_valor,
                                  'Comanda ' || v_cmd.numero, v_forma, NULL, NULL);
    END LOOP;
  END IF;

  UPDATE public.comandas
     SET situacao = 'fechada', subtotal = v_subtotal, couvert = v_couvert, taxa_servico = v_servico,
         desconto = p_desconto, total = v_total, caixa_id = p_caixa_id,
         fechada_em = now(), fechada_por = auth.uid()
   WHERE id = p_comanda_id;

  RETURN jsonb_build_object('subtotal', v_subtotal, 'couvert', v_couvert, 'taxa_servico', v_servico,
                            'desconto', p_desconto, 'total', v_total,
                            'recebido_antes', v_pago_antes, 'restante', v_restante);
END;
$function$;

-- ===== Item pago e comanda com recebimento não são cancelados =====
CREATE OR REPLACE FUNCTION public.restaurante_cancelar_item(p_item_id uuid, p_motivo text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.restaurante_contexto(ARRAY['administrador', 'gestor', 'garcom', 'caixa']::public.app_role[]);
  v_atual text;
  v_pago_em timestamptz;
  v_comanda_id uuid;
  v_cmd public.comandas;
  v_recebido numeric(14,2);
  v_subtotal_depois numeric(14,2);
  v_bruto_depois numeric(14,2);
BEGIN
  SELECT i.situacao, i.pago_em, i.comanda_id INTO v_atual, v_pago_em, v_comanda_id
    FROM public.comanda_itens i JOIN public.comandas c ON c.id = i.comanda_id
   WHERE i.id = p_item_id AND i.tenant_id = v_tenant AND c.situacao = 'aberta'
   FOR UPDATE OF i;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item não encontrado ou comanda já encerrada'; END IF;
  IF v_atual = 'cancelado' THEN RAISE EXCEPTION 'Item já cancelado'; END IF;
  IF v_pago_em IS NOT NULL THEN RAISE EXCEPTION 'Item já pago em baixa parcial: não pode ser cancelado'; END IF;

  -- depois de uma baixa (por itens ou por valor), o cancelamento não pode deixar a conta abaixo do que já foi
  -- recebido: o fechamento ficaria impossível e não há estorno
  SELECT coalesce(sum(valor), 0) INTO v_recebido FROM public.comanda_pagamentos WHERE comanda_id = v_comanda_id;
  IF v_recebido > 0 THEN
    SELECT * INTO v_cmd FROM public.comandas WHERE id = v_comanda_id;
    SELECT coalesce(sum(total), 0) INTO v_subtotal_depois
      FROM public.comanda_itens WHERE comanda_id = v_comanda_id AND situacao <> 'cancelado' AND id <> p_item_id;
    v_bruto_depois := v_subtotal_depois + round(coalesce(v_cmd.pessoas, 0) * v_cmd.couvert_por_pessoa, 2)
                      + round(v_subtotal_depois * v_cmd.taxa_servico_percentual / 100, 2);
    IF v_recebido > v_bruto_depois THEN
      RAISE EXCEPTION 'O cancelamento deixaria a conta (%) abaixo do que já foi recebido (%)', v_bruto_depois, v_recebido;
    END IF;
  END IF;

  IF v_atual <> 'pendente' THEN
    IF NOT public.restaurante_gestao() THEN
      RAISE EXCEPTION 'Item já enviado à cozinha: o cancelamento é feito pela gestão';
    END IF;
    IF coalesce(char_length(btrim(p_motivo)), 0) < 3 THEN
      RAISE EXCEPTION 'Informe o motivo do cancelamento';
    END IF;
  END IF;

  UPDATE public.comanda_itens
     SET situacao = 'cancelado', cancelado_em = now(), cancelado_por = auth.uid(),
         motivo_cancelamento = nullif(btrim(p_motivo), '')
   WHERE id = p_item_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.restaurante_cancelar_comanda(p_comanda_id uuid, p_motivo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.restaurante_contexto(ARRAY['administrador', 'gestor']::public.app_role[]);
BEGIN
  IF coalesce(char_length(btrim(p_motivo)), 0) < 3 THEN RAISE EXCEPTION 'Informe o motivo do cancelamento'; END IF;
  PERFORM 1 FROM public.comandas WHERE id = p_comanda_id AND tenant_id = v_tenant AND situacao = 'aberta' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Comanda não encontrada ou já encerrada'; END IF;

  IF EXISTS (SELECT 1 FROM public.comanda_pagamentos WHERE comanda_id = p_comanda_id) THEN
    RAISE EXCEPTION 'A comanda já recebeu pagamentos (baixa parcial): feche a conta em vez de cancelar';
  END IF;

  UPDATE public.comanda_itens
     SET situacao = 'cancelado', cancelado_em = now(), cancelado_por = auth.uid(), motivo_cancelamento = btrim(p_motivo)
   WHERE comanda_id = p_comanda_id AND situacao <> 'cancelado';
  UPDATE public.comandas
     SET situacao = 'cancelada', motivo_cancelamento = btrim(p_motivo), fechada_em = now(), fechada_por = auth.uid()
   WHERE id = p_comanda_id;
END;
$function$;
