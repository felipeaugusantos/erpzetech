-- Parcelamento no banco, com vencimento mensal de verdade.
--
-- As telas de contas a pagar e a receber calculavam as parcelas no navegador e gravavam direto na tabela,
-- com vencimento a cada 30 dias (dia 10 virava dia 9, 8, 7…) e a regra de arredondamento duplicada.
-- Agora a conta nasce por função, numa transação só: vencimento no mesmo dia de cada mês (dia que não existe
-- no mês cai no último dia), centavos que sobram na última parcela, papel conferido e cadastro da mesma empresa.
-- A escrita direta de INSERT nessas duas tabelas é fechada (quem gera título já é função do banco).

-- n-ésimo vencimento (1 = o primeiro): mesmo dia do primeiro, mês a mês, contado a partir do primeiro
-- (31/01 → 28/02 → 31/03 → 30/04), nunca encadeando de uma parcela para a outra.
CREATE OR REPLACE FUNCTION public.vencimento_parcela(p_primeiro date, p_numero integer)
RETURNS date LANGUAGE sql IMMUTABLE AS $$
  SELECT (p_primeiro + make_interval(months => p_numero - 1))::date
$$;

-- valor da parcela: o total dividido, truncado em centavos; o resto vai para a última
CREATE OR REPLACE FUNCTION public.valor_parcela(p_total numeric, p_parcelas integer, p_numero integer)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_numero = p_parcelas
              THEN p_total - trunc(p_total / p_parcelas, 2) * (p_parcelas - 1)
              ELSE trunc(p_total / p_parcelas, 2) END
$$;

CREATE OR REPLACE FUNCTION public.conta_receber_parcelar(
  p_descricao text,
  p_valor numeric,
  p_parcelas integer,
  p_primeiro_vencimento date,
  p_forma public.forma_pagamento,
  p_cliente_id uuid DEFAULT NULL,
  p_observacoes text DEFAULT NULL
) RETURNS uuid[] LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_empresa uuid; v_filial uuid;
  v_ids uuid[] := '{}'; v_id uuid; i int;
BEGIN
  PERFORM public.exige_nao_salao();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem empresa vinculada'; END IF;
  IF NOT (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')
          OR public.has_role(auth.uid(), 'financeiro') OR public.has_role(auth.uid(), 'caixa')) THEN
    RAISE EXCEPTION 'Sem permissão para lançar contas a receber';
  END IF;
  IF length(btrim(coalesce(p_descricao, ''))) = 0 THEN RAISE EXCEPTION 'Informe a descrição'; END IF;
  IF p_valor IS NULL OR p_valor <= 0 THEN RAISE EXCEPTION 'Informe um valor maior que zero'; END IF;
  IF p_parcelas IS NULL OR p_parcelas < 1 OR p_parcelas > 120 THEN RAISE EXCEPTION 'Parcelas: de 1 a 120'; END IF;
  IF p_primeiro_vencimento IS NULL THEN RAISE EXCEPTION 'Informe o primeiro vencimento'; END IF;
  IF trunc(p_valor / p_parcelas, 2) < 0.01 THEN RAISE EXCEPTION 'Valor pequeno demais para % parcelas', p_parcelas; END IF;
  IF p_cliente_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.clientes WHERE id = p_cliente_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Cliente não encontrado nesta empresa';
  END IF;

  SELECT empresa_id, filial_id INTO v_empresa, v_filial FROM public.profiles WHERE id = auth.uid();

  FOR i IN 1..p_parcelas LOOP
    INSERT INTO public.contas_receber (tenant_id, empresa_id, filial_id, cliente_id, descricao, parcela, parcelas,
      vencimento, valor, forma_pagamento, observacoes)
    VALUES (v_tenant, v_empresa, v_filial, p_cliente_id, btrim(p_descricao), i, p_parcelas,
      public.vencimento_parcela(p_primeiro_vencimento, i), public.valor_parcela(round(p_valor, 2), p_parcelas, i),
      p_forma, nullif(btrim(coalesce(p_observacoes, '')), ''))
    RETURNING id INTO v_id;
    v_ids := v_ids || v_id;
  END LOOP;
  RETURN v_ids;
END $$;

CREATE OR REPLACE FUNCTION public.conta_pagar_parcelar(
  p_descricao text,
  p_valor numeric,
  p_parcelas integer,
  p_primeiro_vencimento date,
  p_forma public.forma_pagamento,
  p_fornecedor_id uuid DEFAULT NULL,
  p_categoria text DEFAULT NULL,
  p_observacoes text DEFAULT NULL
) RETURNS uuid[] LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_empresa uuid; v_filial uuid;
  v_ids uuid[] := '{}'; v_id uuid; i int;
BEGIN
  PERFORM public.exige_nao_salao();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem empresa vinculada'; END IF;
  IF NOT (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')
          OR public.has_role(auth.uid(), 'financeiro') OR public.has_role(auth.uid(), 'caixa')
          OR public.has_role(auth.uid(), 'comprador')) THEN
    RAISE EXCEPTION 'Sem permissão para lançar contas a pagar';
  END IF;
  IF length(btrim(coalesce(p_descricao, ''))) = 0 THEN RAISE EXCEPTION 'Informe a descrição'; END IF;
  IF p_valor IS NULL OR p_valor <= 0 THEN RAISE EXCEPTION 'Informe um valor maior que zero'; END IF;
  IF p_parcelas IS NULL OR p_parcelas < 1 OR p_parcelas > 120 THEN RAISE EXCEPTION 'Parcelas: de 1 a 120'; END IF;
  IF p_primeiro_vencimento IS NULL THEN RAISE EXCEPTION 'Informe o primeiro vencimento'; END IF;
  IF trunc(p_valor / p_parcelas, 2) < 0.01 THEN RAISE EXCEPTION 'Valor pequeno demais para % parcelas', p_parcelas; END IF;
  IF p_fornecedor_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.fornecedores WHERE id = p_fornecedor_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Fornecedor não encontrado nesta empresa';
  END IF;

  SELECT empresa_id, filial_id INTO v_empresa, v_filial FROM public.profiles WHERE id = auth.uid();

  FOR i IN 1..p_parcelas LOOP
    INSERT INTO public.contas_pagar (tenant_id, empresa_id, filial_id, fornecedor_id, descricao, categoria, parcela, parcelas,
      vencimento, valor, forma_pagamento, observacoes)
    VALUES (v_tenant, v_empresa, v_filial, p_fornecedor_id, btrim(p_descricao), nullif(btrim(coalesce(p_categoria, '')), ''),
      i, p_parcelas, public.vencimento_parcela(p_primeiro_vencimento, i),
      public.valor_parcela(round(p_valor, 2), p_parcelas, i), p_forma,
      nullif(btrim(coalesce(p_observacoes, '')), ''))
    RETURNING id INTO v_id;
    v_ids := v_ids || v_id;
  END LOOP;
  RETURN v_ids;
END $$;

REVOKE ALL ON FUNCTION public.conta_receber_parcelar(text, numeric, integer, date, public.forma_pagamento, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.conta_pagar_parcelar(text, numeric, integer, date, public.forma_pagamento, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_receber_parcelar(text, numeric, integer, date, public.forma_pagamento, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.conta_pagar_parcelar(text, numeric, integer, date, public.forma_pagamento, uuid, text, text) TO authenticated;

-- título só nasce por função (parcelamento, pedido, compra, locação, nota…)
DROP POLICY IF EXISTS contas_receber_insere ON public.contas_receber;
DROP POLICY IF EXISTS contas_pagar_insere ON public.contas_pagar;
REVOKE INSERT ON public.contas_receber, public.contas_pagar FROM authenticated, anon;
