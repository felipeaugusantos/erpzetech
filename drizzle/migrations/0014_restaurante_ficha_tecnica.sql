-- Ficha técnica do restaurante (R2): insumos por prato, custo do prato e baixa de estoque.
--
-- * cardapio_ficha: os insumos (produtos do cadastro) que um item do cardápio, ou uma opção dele
--   (ex.: "bacon extra"), consome por unidade vendida, com a perda de preparo em percentual.
-- * restaurante_config: se o restaurante dá baixa de estoque e de qual depósito (a cozinha).
-- * Ao enviar o pedido à cozinha, os insumos saem do depósito escolhido; item sem ficha mas ligado a um
--   produto (bebida de revenda) baixa 1 unidade do produto por unidade vendida.
-- * Cancelar o item ou a comanda antes de a cozinha começar devolve os insumos ao estoque. Depois de iniciado
--   o preparo, o insumo já foi consumido e não volta.
-- O estoque do depósito vira o limite: se o depósito não permite saldo negativo, o envio é recusado quando falta insumo.

-- chaves compostas para amarrar tudo à mesma empresa
ALTER TABLE public.depositos
  ADD CONSTRAINT depositos_id_tenant_uk UNIQUE (id, tenant_id);
ALTER TABLE public.cardapio_opcoes
  ADD CONSTRAINT cardapio_opcoes_id_tenant_uk UNIQUE (id, tenant_id);

-- ===== Configuração =====
CREATE TABLE public.restaurante_config (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants (id) ON DELETE CASCADE,
  baixa_estoque boolean NOT NULL DEFAULT false,
  deposito_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT restaurante_config_deposito_fk FOREIGN KEY (deposito_id, tenant_id)
    REFERENCES public.depositos (id, tenant_id) ON DELETE SET NULL (deposito_id),
  CONSTRAINT restaurante_config_baixa_exige_deposito CHECK (NOT baixa_estoque OR deposito_id IS NOT NULL)
);

-- ===== Ficha técnica =====
CREATE TABLE public.cardapio_ficha (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  item_id uuid,
  opcao_id uuid,
  produto_id uuid NOT NULL,
  -- por unidade vendida, na unidade de estoque do insumo (ex.: 0,150 kg)
  quantidade numeric(14,4) NOT NULL CHECK (quantidade > 0),
  -- perda de preparo: o consumo real é a quantidade ÷ (1 − perda)
  perda_percentual numeric(5,2) NOT NULL DEFAULT 0 CHECK (perda_percentual >= 0 AND perda_percentual < 90),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cardapio_ficha_alvo_ck CHECK ((item_id IS NULL) <> (opcao_id IS NULL)),
  CONSTRAINT cardapio_ficha_item_fk FOREIGN KEY (item_id, tenant_id)
    REFERENCES public.cardapio_itens (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT cardapio_ficha_opcao_fk FOREIGN KEY (opcao_id, tenant_id)
    REFERENCES public.cardapio_opcoes (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT cardapio_ficha_produto_fk FOREIGN KEY (produto_id, tenant_id)
    REFERENCES public.produtos (id, tenant_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX cardapio_ficha_item_uk ON public.cardapio_ficha (item_id, produto_id) WHERE item_id IS NOT NULL;
CREATE UNIQUE INDEX cardapio_ficha_opcao_uk ON public.cardapio_ficha (opcao_id, produto_id) WHERE opcao_id IS NOT NULL;
CREATE INDEX cardapio_ficha_produto_idx ON public.cardapio_ficha (produto_id);

-- ===== Permissões: só a gestão lê e altera; cliente do salão não vê nada disto =====
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['restaurante_config', 'cardapio_ficha']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format($f$CREATE POLICY "%1$s_select" ON public.%1$I FOR SELECT TO authenticated
      USING (tenant_id = public.current_tenant_id() AND public.restaurante_gestao())$f$, t);
    EXECUTE format($f$CREATE POLICY "%1$s_insert" ON public.%1$I FOR INSERT TO authenticated
      WITH CHECK (tenant_id = public.current_tenant_id() AND public.restaurante_gestao())$f$, t);
    EXECUTE format($f$CREATE POLICY "%1$s_update" ON public.%1$I FOR UPDATE TO authenticated
      USING (tenant_id = public.current_tenant_id() AND public.restaurante_gestao())
      WITH CHECK (tenant_id = public.current_tenant_id())$f$, t);
    EXECUTE format($f$CREATE POLICY "%1$s_delete" ON public.%1$I FOR DELETE TO authenticated
      USING (tenant_id = public.current_tenant_id() AND public.restaurante_gestao())$f$, t);
    -- como em toda tabela fora da lista liberada do salão (garçom e cozinha puros)
    EXECUTE format($f$CREATE POLICY salao_restrito ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
      USING ((SELECT NOT public.eh_salao_restrito()))$f$, t);
  END LOOP;
END $$;

-- ===== Movimento de insumos (interno: não é chamável pelo cliente) =====
CREATE OR REPLACE FUNCTION public.restaurante_movimentar_insumos(p_item_ids uuid[], p_sentido text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_cfg public.restaurante_config;
  v_neg boolean;
  r record;
  v_unidade text;
  v_nome text;
  v_custo_prod numeric;
  v_qtd numeric;
  v_res numeric;
  v_custo numeric;
  v_novo numeric;
BEGIN
  IF p_sentido NOT IN ('saida', 'entrada') THEN RAISE EXCEPTION 'Sentido de movimento inválido'; END IF;
  IF p_item_ids IS NULL OR cardinality(p_item_ids) = 0 THEN RETURN; END IF;

  SELECT tenant_id INTO v_tenant FROM public.comanda_itens WHERE id = p_item_ids[1];
  SELECT * INTO v_cfg FROM public.restaurante_config WHERE tenant_id = v_tenant;
  IF NOT FOUND OR NOT v_cfg.baixa_estoque OR v_cfg.deposito_id IS NULL THEN RETURN; END IF;
  SELECT permite_negativo INTO v_neg FROM public.depositos WHERE id = v_cfg.deposito_id AND tenant_id = v_tenant;

  FOR r IN
    WITH itens AS (
      SELECT i.quantidade, i.cardapio_item_id, i.opcoes, c.numero
        FROM public.comanda_itens i JOIN public.comandas c ON c.id = i.comanda_id
       WHERE i.id = ANY (p_item_ids) AND i.tenant_id = v_tenant
    ), consumo AS (
      -- insumos do prato
      SELECT it.numero, f.produto_id, it.quantidade * f.quantidade * 100 / (100 - f.perda_percentual) AS q
        FROM itens it JOIN public.cardapio_ficha f ON f.item_id = it.cardapio_item_id AND f.tenant_id = v_tenant
      UNION ALL
      -- insumos das opções escolhidas (a comanda guarda o id da opção)
      SELECT it.numero, f.produto_id, it.quantidade * f.quantidade * 100 / (100 - f.perda_percentual)
        FROM itens it
        CROSS JOIN LATERAL jsonb_array_elements(coalesce(it.opcoes, '[]'::jsonb)) o
        JOIN public.cardapio_ficha f ON f.opcao_id::text = (o ->> 'id') AND f.tenant_id = v_tenant
      UNION ALL
      -- bebida de revenda: item ligado a um produto e sem ficha baixa 1 unidade por unidade vendida
      SELECT it.numero, ci.produto_id, it.quantidade
        FROM itens it JOIN public.cardapio_itens ci ON ci.id = it.cardapio_item_id AND ci.tenant_id = v_tenant
       WHERE ci.produto_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.cardapio_ficha f WHERE f.item_id = ci.id)
    )
    SELECT produto_id, round(sum(q), 3) AS qtd, min(numero) AS numero FROM consumo GROUP BY produto_id
  LOOP
    CONTINUE WHEN r.qtd <= 0;

    SELECT p.unidade, p.descricao, p.custo INTO v_unidade, v_nome, v_custo_prod
      FROM public.produtos p WHERE p.id = r.produto_id AND p.tenant_id = v_tenant;

    INSERT INTO public.estoques (tenant_id, produto_id, deposito_id, quantidade, reservado)
    VALUES (v_tenant, r.produto_id, v_cfg.deposito_id, 0, 0)
    ON CONFLICT (produto_id, deposito_id) DO NOTHING;

    SELECT quantidade, reservado, custo_medio INTO v_qtd, v_res, v_custo FROM public.estoques
     WHERE produto_id = r.produto_id AND deposito_id = v_cfg.deposito_id FOR UPDATE;
    IF coalesce(v_custo, 0) <= 0 THEN v_custo := coalesce(v_custo_prod, 0); END IF;

    IF p_sentido = 'saida' THEN
      IF r.qtd > v_qtd - v_res AND NOT coalesce(v_neg, false) THEN
        RAISE EXCEPTION 'Estoque insuficiente de % no depósito do restaurante (disponível: %, necessário: %)',
          v_nome, v_qtd - v_res, r.qtd;
      END IF;
      v_novo := v_qtd - r.qtd;
    ELSE
      v_novo := v_qtd + r.qtd;
    END IF;

    UPDATE public.estoques SET quantidade = v_novo, updated_at = now()
     WHERE produto_id = r.produto_id AND deposito_id = v_cfg.deposito_id;

    INSERT INTO public.estoque_movimentacoes
      (tenant_id, produto_id, deposito_id, tipo, quantidade, saldo_anterior, saldo_posterior, unidade,
       documento, motivo, usuario_id, custo_unitario, valor_total)
    VALUES (v_tenant, r.produto_id, v_cfg.deposito_id, p_sentido::public.mov_tipo, r.qtd, v_qtd, v_novo, v_unidade,
       'COMANDA-' || r.numero,
       CASE WHEN p_sentido = 'saida' THEN 'Baixa pela ficha técnica (pedido enviado à cozinha)'
            ELSE 'Devolução: item cancelado antes do preparo' END,
       auth.uid(), round(v_custo, 4), round(r.qtd * v_custo, 2));
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.restaurante_movimentar_insumos(uuid[], text) FROM PUBLIC, anon, authenticated;

-- ===== A comanda passa a guardar o id da opção escolhida (para achar a ficha dela) =====
DO $$
DECLARE
  def text := pg_get_functiondef('public.restaurante_lancar_item(uuid, uuid, numeric, uuid[], text)'::regprocedure);
  novo text;
BEGIN
  novo := replace(def, $q$jsonb_build_object('nome', op.nome, 'preco_adicional', op.preco_adicional)$q$,
                       $q$jsonb_build_object('id', op.id, 'nome', op.nome, 'preco_adicional', op.preco_adicional)$q$);
  IF novo = def THEN RAISE EXCEPTION 'Não foi possível gravar o id da opção em restaurante_lancar_item'; END IF;
  EXECUTE novo;
END $$;

-- ===== Enviar à cozinha: baixa os insumos dos itens enviados =====
DO $$
DECLARE
  def text := pg_get_functiondef('public.restaurante_enviar_cozinha(uuid)'::regprocedure);
  novo text;
BEGIN
  novo := replace(def, $q$  v_qtd integer;
BEGIN$q$, $q$  v_qtd integer;
  v_ids uuid[];
BEGIN$q$);
  novo := replace(novo, $q$  UPDATE public.comanda_itens
     SET situacao = CASE WHEN estacao = 'nenhuma' THEN 'entregue' ELSE 'enviado' END,
         enviado_em = now(),
         entregue_em = CASE WHEN estacao = 'nenhuma' THEN now() ELSE NULL END
   WHERE comanda_id = p_comanda_id AND tenant_id = v_tenant AND situacao = 'pendente';
  GET DIAGNOSTICS v_qtd = ROW_COUNT;
  RETURN v_qtd;$q$, $q$  WITH enviados AS (
    UPDATE public.comanda_itens
       SET situacao = CASE WHEN estacao = 'nenhuma' THEN 'entregue' ELSE 'enviado' END,
           enviado_em = now(),
           entregue_em = CASE WHEN estacao = 'nenhuma' THEN now() ELSE NULL END
     WHERE comanda_id = p_comanda_id AND tenant_id = v_tenant AND situacao = 'pendente'
     RETURNING id
  )
  SELECT array_agg(id) INTO v_ids FROM enviados;
  v_qtd := coalesce(cardinality(v_ids), 0);
  -- os insumos saem do estoque no envio (se faltar e o depósito não permitir saldo negativo, o envio é recusado)
  PERFORM public.restaurante_movimentar_insumos(v_ids, 'saida');
  RETURN v_qtd;$q$);
  IF novo = def OR novo NOT LIKE '%restaurante_movimentar_insumos%' OR novo NOT LIKE '%v_ids uuid[]%' THEN
    RAISE EXCEPTION 'Não foi possível ligar restaurante_enviar_cozinha à ficha técnica';
  END IF;
  EXECUTE novo;
END $$;

-- ===== Cancelar item e comanda: devolve os insumos se a cozinha ainda não começou =====
DO $$
DECLARE
  def text := pg_get_functiondef('public.restaurante_cancelar_item(uuid, text)'::regprocedure);
  novo text;
BEGIN
  novo := replace(def, $q$         motivo_cancelamento = nullif(btrim(p_motivo), '')
   WHERE id = p_item_id;
END;$q$, $q$         motivo_cancelamento = nullif(btrim(p_motivo), '')
   WHERE id = p_item_id;

  -- ainda na fila da cozinha: os insumos voltam ao estoque (depois de iniciado o preparo, já foram consumidos)
  IF v_atual = 'enviado' THEN
    PERFORM public.restaurante_movimentar_insumos(ARRAY[p_item_id], 'entrada');
  END IF;
END;$q$);
  IF novo = def THEN RAISE EXCEPTION 'Não foi possível ligar restaurante_cancelar_item à ficha técnica'; END IF;
  EXECUTE novo;
END $$;

DO $$
DECLARE
  def text := pg_get_functiondef('public.restaurante_cancelar_comanda(uuid, text)'::regprocedure);
  novo text;
BEGIN
  novo := replace(def, $q$  v_tenant uuid := public.restaurante_contexto(ARRAY['administrador', 'gestor']::public.app_role[]);
BEGIN$q$, $q$  v_tenant uuid := public.restaurante_contexto(ARRAY['administrador', 'gestor']::public.app_role[]);
  v_devolver uuid[];
BEGIN$q$);
  novo := replace(novo, $q$  UPDATE public.comanda_itens
     SET situacao = 'cancelado', cancelado_em = now(), cancelado_por = auth.uid(), motivo_cancelamento = btrim(p_motivo)$q$,
    $q$  -- itens ainda na fila da cozinha devolvem os insumos ao estoque
  SELECT array_agg(id) INTO v_devolver FROM public.comanda_itens WHERE comanda_id = p_comanda_id AND situacao = 'enviado';

  UPDATE public.comanda_itens
     SET situacao = 'cancelado', cancelado_em = now(), cancelado_por = auth.uid(), motivo_cancelamento = btrim(p_motivo)$q$);
  novo := replace(novo, $q$     SET situacao = 'cancelada', motivo_cancelamento = btrim(p_motivo), fechada_em = now(), fechada_por = auth.uid()
   WHERE id = p_comanda_id;
END;$q$, $q$     SET situacao = 'cancelada', motivo_cancelamento = btrim(p_motivo), fechada_em = now(), fechada_por = auth.uid()
   WHERE id = p_comanda_id;

  PERFORM public.restaurante_movimentar_insumos(v_devolver, 'entrada');
END;$q$);
  IF novo = def OR novo NOT LIKE '%v_devolver uuid[]%' OR novo NOT LIKE '%movimentar_insumos(v_devolver%' OR novo NOT LIKE '%SELECT array_agg(id) INTO v_devolver%' THEN
    RAISE EXCEPTION 'Não foi possível ligar restaurante_cancelar_comanda à ficha técnica';
  END IF;
  EXECUTE novo;
END $$;
