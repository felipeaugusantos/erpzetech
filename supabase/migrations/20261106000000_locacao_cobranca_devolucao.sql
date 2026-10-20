-- Locação: a devolução passa a cobrar a locação. Antes, a locação criada pela tela de locações só gerava conta a receber quando alguém clicava em
-- "Cobrar", e a devolução com atraso aumentava o valor sem gerar nada. Agora, ao devolver: locação ainda não cobrada gera as contas a receber pelo
-- valor final (dias reais), com a forma de pagamento escolhida (à vista entra no caixa aberto); locação já cobrada e devolvida depois do prazo gera
-- uma conta só com os dias a mais. Locação do balcão (cobrada na hora) e devolvida no prazo não gera nada de novo.

DROP FUNCTION IF EXISTS public.locacao_devolver_vistoriada(uuid, date, text, jsonb, date);

CREATE OR REPLACE FUNCTION public.locacao_devolver_vistoriada(
  p_locacao_id uuid,
  p_data date DEFAULT current_date,
  p_observacao text DEFAULT NULL,
  p_vistorias jsonb DEFAULT '[]'::jsonb,
  p_vencimento date DEFAULT current_date,
  p_forma public.forma_pagamento DEFAULT NULL,
  p_parcelas integer DEFAULT 1,
  p_caixa_id uuid DEFAULT NULL
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
  v_cobranca uuid;
  v_conta_extras uuid;
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

  -- cobrança da locação no ato da devolução, pelo valor final dos dias reais:
  -- ainda não cobrada: gera as contas a receber (à vista entra no caixa aberto); já cobrada e devolvida com atraso: cobra só os dias a mais
  IF coalesce(v_loc.valor_faturado, 0) <= 0 THEN
    IF v_total > 0 THEN
      IF p_forma IS NULL THEN RAISE EXCEPTION 'Informe como a locação será cobrada (forma de pagamento)'; END IF;
      v_cobranca := public.locacao_faturar(v_loc.id, p_forma, greatest(coalesce(p_parcelas, 1), 1), coalesce(p_vencimento, current_date), p_caixa_id);
    END IF;
  ELSIF v_extras > 0 THEN
    INSERT INTO public.contas_receber (tenant_id, empresa_id, filial_id, cliente_id, descricao, parcela, parcelas, vencimento, valor, forma_pagamento, observacoes)
    VALUES (v_tenant, v_loc.empresa_id, v_loc.filial_id, v_loc.cliente_id, 'Dias a mais da locação nº ' || v_loc.numero, 1, 1,
            coalesce(p_vencimento, current_date), v_extras, p_forma, 'Devolução depois do prazo: ' || (v_dias - v_loc.dias) || ' dia(s) a mais')
    RETURNING id INTO v_conta_extras;
    UPDATE public.locacoes SET valor_faturado = coalesce(valor_faturado, 0) + v_extras WHERE id = v_loc.id;
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
                            'caucao_abatida', v_abatida, 'a_cobrar', v_cobrar, 'caucao_a_devolver', v_devolver, 'conta_receber_id', v_conta,
                            'locacao_conta_receber_id', v_cobranca, 'extras_conta_receber_id', v_conta_extras, 'valor_extras', v_extras);
END $$;
REVOKE ALL ON FUNCTION public.locacao_devolver_vistoriada(uuid, date, text, jsonb, date, public.forma_pagamento, integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_devolver_vistoriada(uuid, date, text, jsonb, date, public.forma_pagamento, integer, uuid) TO authenticated;
