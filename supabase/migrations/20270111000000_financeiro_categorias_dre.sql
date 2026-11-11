-- Categorias financeiras e DRE gerencial.
--
-- 1) financeiro_categorias: cadastro da empresa (receita ou despesa, com o grupo do DRE). Só por função
--    (financeiro_categoria_salvar); nunca apaga, só desativa. Nasce vazio; "padrão" cria um conjunto inicial.
-- 2) contas_receber e contas_pagar ganham categoria_id (o texto livre contas_pagar.categoria continua, como
--    legado e como nome mostrado). Gatilho confere que a categoria é da mesma empresa e do tipo certo.
-- 3) financeiro_dre(de, até, filial): linhas do DRE gerencial por competência —
--    vendas pela data do pedido (e custo pelo custo gravado nos itens), devoluções pela data da devolução,
--    demais receitas e despesas pelo VENCIMENTO do título e pela categoria. Pedido não entra duas vezes
--    (título gerado por pedido fica de fora das "outras receitas"), e compra de mercadoria sem categoria
--    não vira despesa (o custo já vem do CMV). Categoria do grupo "fora do DRE" não aparece.
-- 4) conta_*_parcelar passam a aceitar p_categoria_id.

-- ===== 1) categorias =====
CREATE TABLE IF NOT EXISTS public.financeiro_categorias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id),
  nome text NOT NULL,
  tipo text NOT NULL,
  grupo text NOT NULL,
  ativa boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT financeiro_categorias_tipo CHECK (tipo IN ('receita', 'despesa')),
  CONSTRAINT financeiro_categorias_nome CHECK (length(btrim(nome)) BETWEEN 2 AND 80),
  CONSTRAINT financeiro_categorias_grupo CHECK (
    (tipo = 'receita' AND grupo IN ('operacional', 'financeira', 'fora_dre'))
    OR (tipo = 'despesa' AND grupo IN ('deducao', 'custo', 'operacional', 'financeira', 'impostos_lucro', 'fora_dre')))
);
CREATE UNIQUE INDEX IF NOT EXISTS financeiro_categorias_nome_unico
  ON public.financeiro_categorias (tenant_id, tipo, lower(btrim(nome)));

ALTER TABLE public.financeiro_categorias ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.financeiro_categorias FROM authenticated, anon;
GRANT SELECT ON public.financeiro_categorias TO authenticated;
GRANT ALL ON public.financeiro_categorias TO service_role;
CREATE POLICY financeiro_categorias_leitura ON public.financeiro_categorias FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY salao_restrito ON public.financeiro_categorias AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT NOT public.eh_salao_restrito()));
CREATE TRIGGER trg_financeiro_categorias_updated BEFORE UPDATE ON public.financeiro_categorias
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.financeiro_categoria_salvar(
  p_id uuid, p_nome text, p_tipo text, p_grupo text, p_ativa boolean DEFAULT true
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_id uuid; v_tipo_atual text;
BEGIN
  PERFORM public.exige_nao_salao();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem empresa vinculada'; END IF;
  IF NOT (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')
          OR public.has_role(auth.uid(), 'financeiro')) THEN
    RAISE EXCEPTION 'Categorias financeiras só pelo administrador, gestor ou financeiro';
  END IF;
  IF length(btrim(coalesce(p_nome, ''))) < 2 THEN RAISE EXCEPTION 'Informe o nome da categoria'; END IF;

  BEGIN
    IF p_id IS NULL THEN
      INSERT INTO public.financeiro_categorias (tenant_id, nome, tipo, grupo, ativa)
      VALUES (v_tenant, btrim(p_nome), p_tipo, p_grupo, coalesce(p_ativa, true))
      RETURNING id INTO v_id;
    ELSE
      SELECT tipo INTO v_tipo_atual FROM public.financeiro_categorias WHERE id = p_id AND tenant_id = v_tenant FOR UPDATE;
      IF v_tipo_atual IS NULL THEN RAISE EXCEPTION 'Categoria não encontrada'; END IF;
      IF v_tipo_atual <> p_tipo AND (
           EXISTS (SELECT 1 FROM public.contas_pagar WHERE categoria_id = p_id)
        OR EXISTS (SELECT 1 FROM public.contas_receber WHERE categoria_id = p_id)) THEN
        RAISE EXCEPTION 'Categoria já usada em lançamentos: não dá para trocar entre receita e despesa';
      END IF;
      UPDATE public.financeiro_categorias
         SET nome = btrim(p_nome), tipo = p_tipo, grupo = p_grupo, ativa = coalesce(p_ativa, true)
       WHERE id = p_id AND tenant_id = v_tenant
      RETURNING id INTO v_id;
    END IF;
  EXCEPTION
    WHEN unique_violation THEN RAISE EXCEPTION 'Já existe uma categoria de % com este nome', p_tipo;
    WHEN check_violation THEN RAISE EXCEPTION 'Grupo % não vale para categoria de %', p_grupo, p_tipo;
  END;
  RETURN v_id;
END $$;

-- conjunto inicial (só quando a empresa ainda não tem nenhuma categoria)
CREATE OR REPLACE FUNCTION public.financeiro_categorias_padrao()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  n integer;
BEGIN
  PERFORM public.exige_nao_salao();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem empresa vinculada'; END IF;
  IF NOT (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')
          OR public.has_role(auth.uid(), 'financeiro')) THEN
    RAISE EXCEPTION 'Categorias financeiras só pelo administrador, gestor ou financeiro';
  END IF;
  IF EXISTS (SELECT 1 FROM public.financeiro_categorias WHERE tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'A empresa já tem categorias cadastradas';
  END IF;
  INSERT INTO public.financeiro_categorias (tenant_id, nome, tipo, grupo) VALUES
    (v_tenant, 'Receitas de serviços', 'receita', 'operacional'),
    (v_tenant, 'Outras receitas', 'receita', 'operacional'),
    (v_tenant, 'Rendimentos financeiros', 'receita', 'financeira'),
    (v_tenant, 'Impostos sobre vendas', 'despesa', 'deducao'),
    (v_tenant, 'Fretes e embalagens das vendas', 'despesa', 'custo'),
    (v_tenant, 'Aluguel', 'despesa', 'operacional'),
    (v_tenant, 'Salários e encargos', 'despesa', 'operacional'),
    (v_tenant, 'Pró-labore', 'despesa', 'operacional'),
    (v_tenant, 'Comissões', 'despesa', 'operacional'),
    (v_tenant, 'Energia, água e gás', 'despesa', 'operacional'),
    (v_tenant, 'Internet e telefone', 'despesa', 'operacional'),
    (v_tenant, 'Marketing e publicidade', 'despesa', 'operacional'),
    (v_tenant, 'Contabilidade e serviços', 'despesa', 'operacional'),
    (v_tenant, 'Manutenção e limpeza', 'despesa', 'operacional'),
    (v_tenant, 'Sistemas e assinaturas', 'despesa', 'operacional'),
    (v_tenant, 'Material de escritório', 'despesa', 'operacional'),
    (v_tenant, 'Outras despesas', 'despesa', 'operacional'),
    (v_tenant, 'Tarifas bancárias', 'despesa', 'financeira'),
    (v_tenant, 'Juros e multas pagos', 'despesa', 'financeira'),
    (v_tenant, 'IRPJ e CSLL', 'despesa', 'impostos_lucro'),
    (v_tenant, 'Compra de mercadorias (estoque)', 'despesa', 'fora_dre'),
    (v_tenant, 'Investimentos e equipamentos', 'despesa', 'fora_dre'),
    (v_tenant, 'Retiradas dos sócios', 'despesa', 'fora_dre');
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- ===== 2) categoria nos títulos =====
ALTER TABLE public.contas_receber ADD COLUMN IF NOT EXISTS categoria_id uuid REFERENCES public.financeiro_categorias(id);
ALTER TABLE public.contas_pagar ADD COLUMN IF NOT EXISTS categoria_id uuid REFERENCES public.financeiro_categorias(id);
CREATE INDEX IF NOT EXISTS idx_contas_receber_categoria ON public.contas_receber (categoria_id) WHERE categoria_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contas_pagar_categoria ON public.contas_pagar (categoria_id) WHERE categoria_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.conta_categoria_valida()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c public.financeiro_categorias; v_tipo text;
BEGIN
  IF NEW.categoria_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.categoria_id IS NOT DISTINCT FROM OLD.categoria_id THEN RETURN NEW; END IF;
  v_tipo := CASE WHEN TG_TABLE_NAME = 'contas_receber' THEN 'receita' ELSE 'despesa' END;
  SELECT * INTO c FROM public.financeiro_categorias WHERE id = NEW.categoria_id;
  IF c.id IS NULL OR c.tenant_id <> NEW.tenant_id THEN RAISE EXCEPTION 'Categoria não encontrada nesta empresa'; END IF;
  IF c.tipo <> v_tipo THEN RAISE EXCEPTION 'Categoria de % não serve para conta a %', c.tipo, CASE WHEN v_tipo = 'receita' THEN 'receber' ELSE 'pagar' END; END IF;
  IF NOT c.ativa THEN RAISE EXCEPTION 'Categoria desativada'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS conta_receber_categoria_trg ON public.contas_receber;
CREATE TRIGGER conta_receber_categoria_trg BEFORE INSERT OR UPDATE ON public.contas_receber
  FOR EACH ROW EXECUTE FUNCTION public.conta_categoria_valida();
DROP TRIGGER IF EXISTS conta_pagar_categoria_trg ON public.contas_pagar;
CREATE TRIGGER conta_pagar_categoria_trg BEFORE INSERT OR UPDATE ON public.contas_pagar
  FOR EACH ROW EXECUTE FUNCTION public.conta_categoria_valida();

-- traz para categorias o texto livre que já existe em contas a pagar (cria o que falta e liga os títulos)
CREATE OR REPLACE FUNCTION public.financeiro_categorias_importar_texto()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  t record; v_cat uuid; v_nome text; v_grupo text; v_criadas int := 0; v_ligados int := 0; n int;
BEGIN
  PERFORM public.exige_nao_salao();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem empresa vinculada'; END IF;
  IF NOT (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')
          OR public.has_role(auth.uid(), 'financeiro')) THEN
    RAISE EXCEPTION 'Categorias financeiras só pelo administrador, gestor ou financeiro';
  END IF;

  FOR t IN SELECT DISTINCT btrim(categoria) AS texto FROM public.contas_pagar
            WHERE tenant_id = v_tenant AND categoria_id IS NULL AND length(btrim(coalesce(categoria, ''))) >= 2
  LOOP
    -- o que o recebimento de compra grava ("Mercadorias") é estoque, não despesa do período
    IF lower(t.texto) = 'mercadorias' THEN v_nome := 'Compra de mercadorias (estoque)'; v_grupo := 'fora_dre';
    ELSE v_nome := left(t.texto, 80); v_grupo := 'operacional'; END IF;

    SELECT id INTO v_cat FROM public.financeiro_categorias
     WHERE tenant_id = v_tenant AND tipo = 'despesa' AND lower(btrim(nome)) = lower(v_nome);
    IF v_cat IS NULL THEN
      INSERT INTO public.financeiro_categorias (tenant_id, nome, tipo, grupo) VALUES (v_tenant, v_nome, 'despesa', v_grupo)
      RETURNING id INTO v_cat;
      v_criadas := v_criadas + 1;
    END IF;
    UPDATE public.contas_pagar SET categoria_id = v_cat
     WHERE tenant_id = v_tenant AND categoria_id IS NULL AND btrim(categoria) = t.texto;
    GET DIAGNOSTICS n = ROW_COUNT;
    v_ligados := v_ligados + n;
  END LOOP;
  RETURN jsonb_build_object('categorias_criadas', v_criadas, 'titulos_ligados', v_ligados);
END $$;

-- ===== 4) parcelamento com categoria =====
DROP FUNCTION IF EXISTS public.conta_receber_parcelar(text, numeric, integer, date, public.forma_pagamento, uuid, text);
DROP FUNCTION IF EXISTS public.conta_pagar_parcelar(text, numeric, integer, date, public.forma_pagamento, uuid, text, text);

CREATE OR REPLACE FUNCTION public.conta_receber_parcelar(
  p_descricao text,
  p_valor numeric,
  p_parcelas integer,
  p_primeiro_vencimento date,
  p_forma public.forma_pagamento,
  p_cliente_id uuid DEFAULT NULL,
  p_observacoes text DEFAULT NULL,
  p_categoria_id uuid DEFAULT NULL
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
      vencimento, valor, forma_pagamento, observacoes, categoria_id)
    VALUES (v_tenant, v_empresa, v_filial, p_cliente_id, btrim(p_descricao), i, p_parcelas,
      public.vencimento_parcela(p_primeiro_vencimento, i), public.valor_parcela(round(p_valor, 2), p_parcelas, i),
      p_forma, nullif(btrim(coalesce(p_observacoes, '')), ''), p_categoria_id)
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
  p_observacoes text DEFAULT NULL,
  p_categoria_id uuid DEFAULT NULL
) RETURNS uuid[] LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_empresa uuid; v_filial uuid;
  v_ids uuid[] := '{}'; v_id uuid; i int;
  v_cat_nome text := nullif(btrim(coalesce(p_categoria, '')), '');
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
  -- a categoria escolhida dá o nome mostrado no texto legado
  IF p_categoria_id IS NOT NULL THEN
    SELECT nome INTO v_cat_nome FROM public.financeiro_categorias
     WHERE id = p_categoria_id AND tenant_id = v_tenant AND tipo = 'despesa' AND ativa;
    IF v_cat_nome IS NULL THEN RAISE EXCEPTION 'Categoria de despesa não encontrada nesta empresa'; END IF;
  END IF;

  SELECT empresa_id, filial_id INTO v_empresa, v_filial FROM public.profiles WHERE id = auth.uid();

  FOR i IN 1..p_parcelas LOOP
    INSERT INTO public.contas_pagar (tenant_id, empresa_id, filial_id, fornecedor_id, descricao, categoria, categoria_id,
      parcela, parcelas, vencimento, valor, forma_pagamento, observacoes)
    VALUES (v_tenant, v_empresa, v_filial, p_fornecedor_id, btrim(p_descricao), v_cat_nome, p_categoria_id,
      i, p_parcelas, public.vencimento_parcela(p_primeiro_vencimento, i),
      public.valor_parcela(round(p_valor, 2), p_parcelas, i), p_forma,
      nullif(btrim(coalesce(p_observacoes, '')), ''))
    RETURNING id INTO v_id;
    v_ids := v_ids || v_id;
  END LOOP;
  RETURN v_ids;
END $$;

-- ===== 3) DRE =====
-- secao: vendas | devolucoes | cmv | receita_outras | receita_financeira |
--        despesa_deducao | despesa_custo | despesa_operacional | despesa_financeira | despesa_impostos_lucro
CREATE OR REPLACE FUNCTION public.financeiro_dre(p_de date, p_ate date, p_filial_id uuid DEFAULT NULL)
RETURNS TABLE (secao text, categoria_id uuid, categoria text, valor numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant uuid := public.current_tenant_id();
BEGIN
  PERFORM public.exige_nao_salao();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem empresa vinculada'; END IF;
  IF NOT (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'gestor')
          OR public.has_role(auth.uid(), 'financeiro')) THEN
    RAISE EXCEPTION 'O DRE só pelo administrador, gestor ou financeiro';
  END IF;
  IF p_de IS NULL OR p_ate IS NULL OR p_ate < p_de THEN RAISE EXCEPTION 'Período inválido'; END IF;
  IF p_ate - p_de > 1830 THEN RAISE EXCEPTION 'Período grande demais: no máximo 5 anos'; END IF;

  -- vendas (pedido que já saiu do rascunho/aguardando pagamento e não foi cancelado), pela data da venda
  RETURN QUERY
  SELECT 'vendas'::text, NULL::uuid, 'Vendas de mercadorias e serviços'::text, coalesce(sum(p.total), 0)
    FROM public.pedidos p
   WHERE p.tenant_id = v_tenant AND p.situacao NOT IN ('rascunho', 'aguardando_pagamento', 'cancelado')
     AND (p.created_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_de AND p_ate
     AND (p_filial_id IS NULL OR p.filial_id = p_filial_id) AND public.pode_filial(p.filial_id)
  HAVING coalesce(sum(p.total), 0) <> 0;

  RETURN QUERY
  SELECT 'devolucoes'::text, NULL::uuid, 'Devoluções de vendas'::text, coalesce(sum(d.valor_total), 0)
    FROM public.devolucoes d
   WHERE d.tenant_id = v_tenant
     AND (d.created_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_de AND p_ate
     AND (p_filial_id IS NULL OR d.filial_id = p_filial_id) AND public.pode_filial(d.filial_id)
  HAVING coalesce(sum(d.valor_total), 0) <> 0;

  RETURN QUERY
  SELECT 'cmv'::text, NULL::uuid, 'Custo das mercadorias vendidas'::text,
         coalesce(sum(i.quantidade * coalesce(i.custo_unitario, 0)), 0)
    FROM public.pedido_itens i JOIN public.pedidos p ON p.id = i.pedido_id
   WHERE p.tenant_id = v_tenant AND p.situacao NOT IN ('rascunho', 'aguardando_pagamento', 'cancelado')
     AND (p.created_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_de AND p_ate
     AND (p_filial_id IS NULL OR p.filial_id = p_filial_id) AND public.pode_filial(p.filial_id)
  HAVING coalesce(sum(i.quantidade * coalesce(i.custo_unitario, 0)), 0) <> 0;

  -- outras receitas: títulos sem pedido (o pedido já está em "vendas"), pelo vencimento
  RETURN QUERY
  SELECT CASE WHEN c.grupo = 'financeira' THEN 'receita_financeira' ELSE 'receita_outras' END,
         c.id, coalesce(c.nome, 'Sem categoria')::text, sum(r.valor)
    FROM public.contas_receber r LEFT JOIN public.financeiro_categorias c ON c.id = r.categoria_id
   WHERE r.tenant_id = v_tenant AND r.pedido_id IS NULL AND r.situacao <> 'cancelado'
     AND r.vencimento BETWEEN p_de AND p_ate AND coalesce(c.grupo, 'operacional') <> 'fora_dre'
     AND (p_filial_id IS NULL OR r.filial_id = p_filial_id) AND public.pode_filial(r.filial_id)
   GROUP BY c.id, c.nome, c.grupo;

  -- despesas pelo vencimento; compra de mercadoria sem categoria é estoque (o custo vem do CMV)
  RETURN QUERY
  SELECT CASE c.grupo WHEN 'deducao' THEN 'despesa_deducao' WHEN 'custo' THEN 'despesa_custo'
                      WHEN 'financeira' THEN 'despesa_financeira' WHEN 'impostos_lucro' THEN 'despesa_impostos_lucro'
                      ELSE 'despesa_operacional' END,
         c.id, coalesce(c.nome, 'Sem categoria')::text, sum(a.valor)
    FROM public.contas_pagar a LEFT JOIN public.financeiro_categorias c ON c.id = a.categoria_id
   WHERE a.tenant_id = v_tenant AND a.situacao <> 'cancelado'
     AND a.vencimento BETWEEN p_de AND p_ate AND coalesce(c.grupo, 'operacional') <> 'fora_dre'
     AND NOT (a.categoria_id IS NULL AND a.compra_id IS NOT NULL)
     AND (p_filial_id IS NULL OR a.filial_id = p_filial_id) AND public.pode_filial(a.filial_id)
   GROUP BY c.id, c.nome, c.grupo;
END $$;

REVOKE ALL ON FUNCTION public.financeiro_categoria_salvar(uuid, text, text, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.financeiro_categorias_padrao() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.financeiro_categorias_importar_texto() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.financeiro_dre(date, date, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.conta_receber_parcelar(text, numeric, integer, date, public.forma_pagamento, uuid, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.conta_pagar_parcelar(text, numeric, integer, date, public.forma_pagamento, uuid, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.financeiro_categoria_salvar(uuid, text, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.financeiro_categorias_padrao() TO authenticated;
GRANT EXECUTE ON FUNCTION public.financeiro_categorias_importar_texto() TO authenticated;
GRANT EXECUTE ON FUNCTION public.financeiro_dre(date, date, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.conta_receber_parcelar(text, numeric, integer, date, public.forma_pagamento, uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.conta_pagar_parcelar(text, numeric, integer, date, public.forma_pagamento, uuid, text, text, uuid) TO authenticated;
