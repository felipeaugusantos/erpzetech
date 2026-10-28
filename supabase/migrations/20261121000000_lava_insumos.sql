-- Lava rápido (Fase 2, etapa 3): insumos no estoque por serviço (shampoo, cera, pano...).
-- Cada serviço pode ter uma "receita" de insumos. Ao entregar a ordem o sistema dá baixa no estoque do depósito escolhido.
-- A baixa NUNCA trava a entrega nem a cobrança (o cliente já pagou no balcão): se faltar saldo ou der erro, a ordem é entregue,
-- a falha fica registrada com o motivo e dá para tentar de novo depois de repor o estoque. Cada insumo baixa uma vez por item.
-- Venda cancelada não estorna: a lavagem foi feita, o insumo foi gasto.

-- Esta migration usa a cobertura de planos e fidelidade: rode antes a 20261119000000_lava_planos_fidelidade.sql.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'lr_ordem_itens' AND column_name = 'cobertura') THEN
    RAISE EXCEPTION 'Rode antes a migration 20261119000000_lava_planos_fidelidade.sql (falta a coluna lr_ordem_itens.cobertura)';
  END IF;
END $$;

-- Uma linha por empresa. Sem linha ou desligado: nada é baixado.
CREATE TABLE IF NOT EXISTS public.lr_insumo_config (
  tenant_id uuid PRIMARY KEY DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  deposito_id uuid NOT NULL REFERENCES public.depositos(id),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lr_servico_insumos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  servico_id uuid NOT NULL REFERENCES public.lr_servicos(id) ON DELETE CASCADE,
  produto_id uuid NOT NULL REFERENCES public.produtos(id),
  quantidade numeric(14,3) NOT NULL CHECK (quantidade > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS lr_servico_insumos_idx ON public.lr_servico_insumos (servico_id, produto_id);

CREATE TABLE IF NOT EXISTS public.lr_insumo_baixas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  ordem_id uuid NOT NULL REFERENCES public.lr_ordens(id),
  item_id uuid NOT NULL REFERENCES public.lr_ordem_itens(id) ON DELETE CASCADE,
  produto_id uuid NOT NULL REFERENCES public.produtos(id),
  deposito_id uuid NOT NULL REFERENCES public.depositos(id),
  quantidade numeric(14,3) NOT NULL CHECK (quantidade > 0),
  situacao text NOT NULL CHECK (situacao IN ('baixado', 'falhou')),
  erro text,
  baixado_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS lr_insumo_baixas_item_idx ON public.lr_insumo_baixas (item_id, produto_id);
CREATE INDEX IF NOT EXISTS lr_insumo_baixas_situacao_idx ON public.lr_insumo_baixas (tenant_id, situacao, created_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['lr_insumo_config', 'lr_servico_insumos', 'lr_insumo_baixas'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id())', t || '_ler', t);
    EXECUTE format('CREATE POLICY salao_restrito ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.eh_salao_restrito()))', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()', 'trg_' || t || '_updated', t);
  END LOOP;
END $$;

-- ============ cadastros (administrador e gestor) ============
CREATE OR REPLACE FUNCTION public.lr_insumo_config_salvar(p_deposito_id uuid, p_ativo boolean DEFAULT true)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_tenant uuid := public.current_tenant_id();
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  PERFORM public._lr_exige_liberado();
  IF p_deposito_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.depositos d WHERE d.id = p_deposito_id AND d.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Escolha o depósito dos insumos';
  END IF;
  INSERT INTO public.lr_insumo_config (tenant_id, deposito_id, ativo) VALUES (v_tenant, p_deposito_id, coalesce(p_ativo, true))
  ON CONFLICT (tenant_id) DO UPDATE SET deposito_id = EXCLUDED.deposito_id, ativo = EXCLUDED.ativo;
END $$;
REVOKE ALL ON FUNCTION public.lr_insumo_config_salvar(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_insumo_config_salvar(uuid, boolean) TO authenticated;

-- Insumo de um serviço: grava ou atualiza a quantidade gasta por lavagem.
CREATE OR REPLACE FUNCTION public.lr_servico_insumo_salvar(p_servico_id uuid, p_produto_id uuid, p_quantidade numeric)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_id uuid;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  PERFORM public._lr_exige_liberado();
  IF p_quantidade IS NULL OR p_quantidade <= 0 THEN RAISE EXCEPTION 'Informe uma quantidade maior que zero'; END IF;
  PERFORM 1 FROM public.lr_servicos WHERE id = p_servico_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Serviço não encontrado'; END IF;
  PERFORM 1 FROM public.produtos WHERE id = p_produto_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Produto não encontrado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.produtos WHERE id = p_produto_id AND tenant_id = v_tenant AND controla_estoque) THEN
    RAISE EXCEPTION 'O insumo precisa ser um produto com controle de estoque';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('lr_insumo:' || p_servico_id::text, 0));
  SELECT id INTO v_id FROM public.lr_servico_insumos WHERE servico_id = p_servico_id AND produto_id = p_produto_id;
  IF v_id IS NULL THEN
    INSERT INTO public.lr_servico_insumos (tenant_id, servico_id, produto_id, quantidade) VALUES (v_tenant, p_servico_id, p_produto_id, round(p_quantidade, 3))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.lr_servico_insumos SET quantidade = round(p_quantidade, 3) WHERE id = v_id;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.lr_servico_insumo_salvar(uuid, uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_servico_insumo_salvar(uuid, uuid, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.lr_servico_insumo_remover(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor']);
  PERFORM public._lr_exige_liberado();
  DELETE FROM public.lr_servico_insumos WHERE id = p_id AND tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Insumo não encontrado'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.lr_servico_insumo_remover(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_servico_insumo_remover(uuid) TO authenticated;

-- ============ baixa ============
-- Interna: chamada na entrega da ordem. Cada insumo roda numa subtransação: o erro de um não desfaz a entrega nem os outros.
CREATE OR REPLACE FUNCTION public._lr_baixar_insumos(p_ordem_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  c public.lr_insumo_config%ROWTYPE;
  r record;
  v_ja text;
BEGIN
  SELECT * INTO c FROM public.lr_insumo_config WHERE tenant_id = v_tenant AND ativo;
  IF NOT FOUND THEN RETURN; END IF;
  FOR r IN SELECT i.id AS item_id, si.produto_id, si.quantidade
             FROM public.lr_ordem_itens i
             JOIN public.lr_servico_insumos si ON si.servico_id = i.servico_id AND si.tenant_id = v_tenant
            WHERE i.ordem_id = p_ordem_id AND i.tenant_id = v_tenant LOOP
    SELECT situacao INTO v_ja FROM public.lr_insumo_baixas WHERE item_id = r.item_id AND produto_id = r.produto_id;
    -- já baixado antes (entrega repetida depois de venda cancelada): não gasta duas vezes
    IF v_ja = 'baixado' THEN CONTINUE; END IF;
    BEGIN
      PERFORM public.registrar_movimentacao_interno(r.produto_id, c.deposito_id, 'saida'::mov_tipo, r.quantidade,
                                                    'Insumo do lava rápido', 'LR-' || upper(left(p_ordem_id::text, 8)));
      INSERT INTO public.lr_insumo_baixas (tenant_id, ordem_id, item_id, produto_id, deposito_id, quantidade, situacao, baixado_em)
      VALUES (v_tenant, p_ordem_id, r.item_id, r.produto_id, c.deposito_id, r.quantidade, 'baixado', now())
      ON CONFLICT (item_id, produto_id) DO UPDATE SET situacao = 'baixado', erro = NULL, baixado_em = now(), deposito_id = EXCLUDED.deposito_id, quantidade = EXCLUDED.quantidade;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.lr_insumo_baixas (tenant_id, ordem_id, item_id, produto_id, deposito_id, quantidade, situacao, erro)
      VALUES (v_tenant, p_ordem_id, r.item_id, r.produto_id, c.deposito_id, r.quantidade, 'falhou', left(SQLERRM, 300))
      ON CONFLICT (item_id, produto_id) DO UPDATE SET situacao = 'falhou', erro = left(SQLERRM, 300);
    END;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public._lr_baixar_insumos(uuid) FROM PUBLIC, anon, authenticated;

-- Tentar de novo uma baixa que falhou (depois de repor o estoque).
CREATE OR REPLACE FUNCTION public.lr_insumo_baixa_refazer(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  b public.lr_insumo_baixas%ROWTYPE;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'estoquista']);
  PERFORM public._lr_exige_liberado();
  SELECT * INTO b FROM public.lr_insumo_baixas WHERE id = p_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Baixa não encontrada'; END IF;
  IF b.situacao <> 'falhou' THEN RAISE EXCEPTION 'Esta baixa já foi feita'; END IF;
  -- aqui o erro volta para quem pediu (o estoque ainda não cobre, por exemplo) e a baixa continua como falhou
  PERFORM public.registrar_movimentacao_interno(b.produto_id, b.deposito_id, 'saida'::mov_tipo, b.quantidade,
                                                'Insumo do lava rápido', 'LR-' || upper(left(b.ordem_id::text, 8)));
  UPDATE public.lr_insumo_baixas SET situacao = 'baixado', erro = NULL, baixado_em = now() WHERE id = b.id;
END $$;
REVOKE ALL ON FUNCTION public.lr_insumo_baixa_refazer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_insumo_baixa_refazer(uuid) TO authenticated;

-- Entregar: depois de marcar a ordem como entregue (com ou sem venda), baixa os insumos.
-- A função inteira é recriada aqui (igual à de 20261119, mais a baixa), sem depender do texto da versão que está no banco.
CREATE OR REPLACE FUNCTION public.lr_ordem_retirar(p_ordem_id uuid, p_pedido_id uuid DEFAULT NULL, p_chave uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  o public.lr_ordens%ROWTYPE;
  lv public.lr_lavadores%ROWTYPE;
  v_ped public.pedidos%ROWTYPE;
  v_pedido uuid := p_pedido_id;
  r record;
  v_cobrados integer;
  v_bruto numeric; v_liquido numeric; v_valor numeric; v_nfe uuid;
BEGIN
  PERFORM public.exige_nao_salao();
  PERFORM public.exige_papel(ARRAY['administrador', 'gestor', 'vendedor', 'caixa']);
  PERFORM public._lr_exige_liberado();
  SELECT * INTO o FROM public.lr_ordens WHERE id = p_ordem_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ordem não encontrada'; END IF;
  SELECT count(*)::int INTO v_cobrados FROM public.lr_ordem_itens WHERE ordem_id = o.id AND cobertura IS NULL;

  IF o.situacao = 'entregue' THEN
    -- repetir a chamada (resposta perdida) devolve o mesmo resultado
    IF v_cobrados = 0 THEN
      RETURN jsonb_build_object('pedido_id', NULL, 'nfe_id', NULL, 'comissao', 0, 'repetido', true);
    END IF;
    IF o.venda_id IS NOT NULL AND (o.venda_id = p_pedido_id OR p_pedido_id IS NULL) THEN
      RETURN jsonb_build_object('pedido_id', o.venda_id,
        'nfe_id', (SELECT id FROM public.nfe WHERE pedido_id = o.venda_id AND modelo = 'nfse' AND situacao <> 'cancelada' LIMIT 1), 'repetido', true);
    END IF;
  END IF;
  IF o.situacao <> 'pronto' THEN RAISE EXCEPTION 'Só dá para entregar e cobrar ordem pronta (situação atual: %)', o.situacao; END IF;

  IF v_cobrados = 0 THEN
    UPDATE public.lr_ordens SET situacao = 'entregue', entregue_em = now() WHERE id = o.id;
    PERFORM public._lr_baixar_insumos(o.id);
    RETURN jsonb_build_object('pedido_id', NULL, 'nfe_id', NULL, 'comissao', 0, 'repetido', false);
  END IF;

  IF v_pedido IS NULL AND p_chave IS NOT NULL THEN
    SELECT id INTO v_pedido FROM public.pedidos WHERE tenant_id = v_tenant AND chave_idempotencia = p_chave;
  END IF;
  IF v_pedido IS NULL THEN RAISE EXCEPTION 'Informe a venda do caixa'; END IF;
  SELECT * INTO v_ped FROM public.pedidos WHERE id = v_pedido AND tenant_id = v_tenant;
  IF NOT FOUND OR NOT public.pode_filial(v_ped.filial_id) THEN RAISE EXCEPTION 'Venda não encontrada'; END IF;
  IF v_ped.situacao = 'cancelado' THEN RAISE EXCEPTION 'Esta venda está cancelada'; END IF;
  IF coalesce(v_ped.origem, '') <> 'pdv' THEN RAISE EXCEPTION 'A cobrança do lava rápido é feita na frente de caixa'; END IF;
  IF EXISTS (SELECT 1 FROM public.lr_ordens x WHERE x.venda_id = v_pedido AND x.id <> o.id) THEN
    RAISE EXCEPTION 'Esta venda já cobrou outra ordem';
  END IF;

  -- a venda precisa ter cada serviço cobrado da ordem, pelo valor combinado
  FOR r IN SELECT i.servico_id, i.preco_aplicado, s.produto_id, s.nome
             FROM public.lr_ordem_itens i JOIN public.lr_servicos s ON s.id = i.servico_id
            WHERE i.ordem_id = o.id AND i.cobertura IS NULL LOOP
    IF NOT EXISTS (SELECT 1 FROM public.pedido_itens pi WHERE pi.pedido_id = v_pedido AND pi.produto_id = r.produto_id
                    AND pi.preco_unitario = r.preco_aplicado AND pi.quantidade >= 1) THEN
      RAISE EXCEPTION 'A venda não traz o serviço "%" pelo valor combinado (%)', r.nome, r.preco_aplicado;
    END IF;
  END LOOP;

  SELECT coalesce(sum(preco_aplicado), 0) INTO v_bruto FROM public.lr_ordem_itens WHERE ordem_id = o.id AND cobertura IS NULL;
  -- o desconto da venda reparte-se por igual entre todos os itens: o serviço fica com a parte proporcional
  v_liquido := CASE WHEN coalesce(v_ped.subtotal, 0) > 0 THEN round(v_bruto * v_ped.total / v_ped.subtotal, 2) ELSE v_bruto END;

  UPDATE public.lr_ordens SET situacao = 'entregue', venda_id = v_pedido, entregue_em = now() WHERE id = o.id;
  PERFORM public._lr_baixar_insumos(o.id);

  IF o.lavador_id IS NOT NULL THEN
    SELECT * INTO lv FROM public.lr_lavadores WHERE id = o.lavador_id;
    v_valor := round(v_liquido * lv.comissao_percentual / 100, 2);
    IF v_valor > 0 THEN
      INSERT INTO public.lr_comissoes (tenant_id, lavador_id, ordem_id, pedido_id, base, percentual, valor)
      VALUES (v_tenant, o.lavador_id, o.id, v_pedido, v_liquido, lv.comissao_percentual, v_valor)
      -- cobrar de novo depois de uma venda cancelada reativa a comissão cancelada (uma por ordem)
      ON CONFLICT (ordem_id) DO UPDATE
         SET pedido_id = EXCLUDED.pedido_id, base = EXCLUDED.base, percentual = EXCLUDED.percentual, valor = EXCLUDED.valor,
             situacao = 'a_aprovar', aprovada_em = NULL, aprovada_por = NULL
       WHERE public.lr_comissoes.situacao = 'cancelada';
    END IF;
  END IF;

  v_nfe := public._lr_nfse_rascunho(o.id, v_pedido, v_liquido);
  RETURN jsonb_build_object('pedido_id', v_pedido, 'nfe_id', v_nfe, 'comissao', coalesce(v_valor, 0), 'repetido', false);
END $$;
REVOKE ALL ON FUNCTION public.lr_ordem_retirar(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lr_ordem_retirar(uuid, uuid, uuid) TO authenticated;
