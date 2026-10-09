-- Delivery do restaurante (R3): pedido de entrega pelo mesmo caminho da comanda.
--
-- O pedido de delivery é uma comanda com tipo 'delivery' (sem mesa): itens, envio à cozinha, baixa de estoque,
-- cancelamento, baixa parcial e fechamento são os mesmos do salão. O que muda é o cadastro da entrega
-- (cliente, telefone, endereço, forma de pagamento prevista) e o andamento: aguardando → saiu → entregue.
-- A taxa de entrega entra na conta como um item interno da comanda, então total, serviço e saldo funcionam
-- sem tratamento especial. Os campos `canal` e `codigo_externo` deixam o banco pronto para o iFood (ainda sem integração).

-- ===== Item interno do cardápio (não aparece no cardápio nem no lançamento) =====
ALTER TABLE public.cardapio_itens ADD COLUMN IF NOT EXISTS interno boolean NOT NULL DEFAULT false;

-- ===== Dados da entrega na comanda =====
ALTER TABLE public.comandas
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'salao' CHECK (tipo IN ('salao', 'delivery')),
  ADD COLUMN IF NOT EXISTS canal text NOT NULL DEFAULT 'proprio' CHECK (canal IN ('proprio', 'ifood')),
  ADD COLUMN IF NOT EXISTS codigo_externo text,
  ADD COLUMN IF NOT EXISTS entrega_telefone text,
  ADD COLUMN IF NOT EXISTS entrega_endereco text,
  ADD COLUMN IF NOT EXISTS entrega_bairro text,
  ADD COLUMN IF NOT EXISTS entrega_referencia text,
  ADD COLUMN IF NOT EXISTS entrega_pagamento text
    CHECK (entrega_pagamento IS NULL OR entrega_pagamento IN ('dinheiro', 'pix', 'cartao_credito', 'cartao_debito', 'pago_online')),
  ADD COLUMN IF NOT EXISTS entrega_troco_para numeric(14,2) CHECK (entrega_troco_para IS NULL OR entrega_troco_para >= 0),
  ADD COLUMN IF NOT EXISTS entrega_situacao text CHECK (entrega_situacao IS NULL OR entrega_situacao IN ('aguardando', 'saiu', 'entregue')),
  ADD COLUMN IF NOT EXISTS entregador text,
  ADD COLUMN IF NOT EXISTS saiu_em timestamptz,
  ADD COLUMN IF NOT EXISTS entregue_cliente_em timestamptz;

ALTER TABLE public.comandas ADD CONSTRAINT comandas_delivery_ck CHECK (
  (tipo = 'delivery' AND mesa_id IS NULL AND entrega_situacao IS NOT NULL
     AND coalesce(char_length(btrim(entrega_endereco)), 0) >= 5)
  OR (tipo = 'salao' AND entrega_situacao IS NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS comandas_canal_codigo_uk
  ON public.comandas (tenant_id, canal, codigo_externo) WHERE codigo_externo IS NOT NULL;
CREATE INDEX IF NOT EXISTS comandas_delivery_idx
  ON public.comandas (tenant_id, entrega_situacao, aberta_em DESC) WHERE tipo = 'delivery';

-- ===== Zonas de entrega (bairro → taxa) =====
CREATE TABLE public.restaurante_zonas_entrega (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (btrim(nome) <> ''),
  taxa numeric(14,2) NOT NULL DEFAULT 0 CHECK (taxa >= 0 AND taxa <= 1000),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX restaurante_zonas_nome_uk ON public.restaurante_zonas_entrega (tenant_id, lower(btrim(nome)));

ALTER TABLE public.restaurante_zonas_entrega ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.restaurante_zonas_entrega FROM PUBLIC, anon;
GRANT ALL ON public.restaurante_zonas_entrega TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.restaurante_zonas_entrega TO authenticated;
-- quem atende o delivery lê as zonas para preencher a taxa; só a gestão cadastra
CREATE POLICY restaurante_zonas_select ON public.restaurante_zonas_entrega FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.restaurante_operador());
CREATE POLICY restaurante_zonas_insert ON public.restaurante_zonas_entrega FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.restaurante_gestao());
CREATE POLICY restaurante_zonas_update ON public.restaurante_zonas_entrega FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.restaurante_gestao())
  WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY restaurante_zonas_delete ON public.restaurante_zonas_entrega FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.restaurante_gestao());

-- ===== Item interno "Taxa de entrega" (um por empresa, criado quando precisa) =====
CREATE OR REPLACE FUNCTION public.restaurante_item_taxa_entrega(p_tenant uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.cardapio_itens WHERE tenant_id = p_tenant AND interno AND nome = 'Taxa de entrega' LIMIT 1;
  IF v_id IS NULL THEN
    -- inativo: o lançamento normal de itens recusa, então só o delivery coloca a taxa na conta
    INSERT INTO public.cardapio_itens (tenant_id, nome, preco, estacao, ativo, interno)
    VALUES (p_tenant, 'Taxa de entrega', 0, 'nenhuma', false, true) RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.restaurante_item_taxa_entrega(uuid) FROM PUBLIC, anon, authenticated;

-- ===== Abrir o pedido de delivery =====
CREATE OR REPLACE FUNCTION public.restaurante_abrir_delivery(
  p_cliente text,
  p_telefone text,
  p_endereco text,
  p_bairro text DEFAULT NULL,
  p_referencia text DEFAULT NULL,
  p_taxa numeric DEFAULT 0,
  p_pagamento text DEFAULT NULL,
  p_troco_para numeric DEFAULT NULL,
  p_observacao text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.restaurante_contexto(ARRAY['administrador', 'gestor', 'garcom', 'caixa']::public.app_role[]);
  v_id uuid;
  v_taxa numeric(14,2) := round(coalesce(p_taxa, 0), 2);
  v_fone text := nullif(btrim(p_telefone), '');
BEGIN
  IF coalesce(char_length(btrim(p_cliente)), 0) < 2 THEN RAISE EXCEPTION 'Informe o nome do cliente'; END IF;
  IF coalesce(char_length(btrim(p_endereco)), 0) < 5 THEN RAISE EXCEPTION 'Informe o endereço de entrega'; END IF;
  IF v_fone IS NOT NULL AND char_length(regexp_replace(v_fone, '\D', '', 'g')) < 8 THEN
    RAISE EXCEPTION 'Telefone inválido';
  END IF;
  IF v_taxa < 0 OR v_taxa > 1000 THEN RAISE EXCEPTION 'Taxa de entrega inválida'; END IF;
  IF p_pagamento IS NOT NULL AND p_pagamento NOT IN ('dinheiro', 'pix', 'cartao_credito', 'cartao_debito', 'pago_online') THEN
    RAISE EXCEPTION 'Forma de pagamento inválida';
  END IF;
  IF p_troco_para IS NOT NULL AND p_troco_para < 0 THEN RAISE EXCEPTION 'Valor do troco inválido'; END IF;

  -- mesma numeração e filial das demais comandas; sem serviço nem couvert
  v_id := public.restaurante_abrir_comanda(NULL, NULL, p_cliente, 0, 0);
  UPDATE public.comandas
     SET tipo = 'delivery', entrega_situacao = 'aguardando',
         entrega_telefone = v_fone,
         entrega_endereco = btrim(p_endereco),
         entrega_bairro = nullif(btrim(p_bairro), ''),
         entrega_referencia = nullif(btrim(p_referencia), ''),
         entrega_pagamento = p_pagamento,
         entrega_troco_para = p_troco_para,
         observacao = nullif(btrim(p_observacao), '')
   WHERE id = v_id;

  IF v_taxa > 0 THEN
    INSERT INTO public.comanda_itens (tenant_id, comanda_id, cardapio_item_id, nome, estacao, opcoes, quantidade,
                                      preco_unitario, total, situacao, lancado_por, enviado_em, entregue_em)
    VALUES (v_tenant, v_id, public.restaurante_item_taxa_entrega(v_tenant), 'Taxa de entrega', 'nenhuma', '[]'::jsonb,
            1, v_taxa, v_taxa, 'entregue', auth.uid(), now(), now());
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.restaurante_abrir_delivery(text, text, text, text, text, numeric, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restaurante_abrir_delivery(text, text, text, text, text, numeric, text, numeric, text) TO authenticated;

-- ===== Ajustar a taxa de entrega (antes de qualquer recebimento) =====
CREATE OR REPLACE FUNCTION public.restaurante_delivery_taxa(p_comanda_id uuid, p_taxa numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.restaurante_contexto(ARRAY['administrador', 'gestor', 'garcom', 'caixa']::public.app_role[]);
  v_taxa numeric(14,2) := round(coalesce(p_taxa, -1), 2);
  v_cmd public.comandas;
  v_item uuid := public.restaurante_item_taxa_entrega(v_tenant);
BEGIN
  IF v_taxa < 0 OR v_taxa > 1000 THEN RAISE EXCEPTION 'Taxa de entrega inválida'; END IF;
  SELECT * INTO v_cmd FROM public.comandas WHERE id = p_comanda_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND OR v_cmd.tipo <> 'delivery' OR v_cmd.situacao <> 'aberta' THEN
    RAISE EXCEPTION 'Pedido de delivery não encontrado ou já encerrado';
  END IF;
  IF EXISTS (SELECT 1 FROM public.comanda_pagamentos WHERE comanda_id = p_comanda_id) THEN
    RAISE EXCEPTION 'O pedido já recebeu pagamento: a taxa não pode mais mudar';
  END IF;

  UPDATE public.comanda_itens SET preco_unitario = v_taxa, total = v_taxa
   WHERE comanda_id = p_comanda_id AND cardapio_item_id = v_item AND situacao <> 'cancelado';
  IF NOT FOUND AND v_taxa > 0 THEN
    INSERT INTO public.comanda_itens (tenant_id, comanda_id, cardapio_item_id, nome, estacao, opcoes, quantidade,
                                      preco_unitario, total, situacao, lancado_por, enviado_em, entregue_em)
    VALUES (v_tenant, p_comanda_id, v_item, 'Taxa de entrega', 'nenhuma', '[]'::jsonb, 1, v_taxa, v_taxa,
            'entregue', auth.uid(), now(), now());
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.restaurante_delivery_taxa(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restaurante_delivery_taxa(uuid, numeric) TO authenticated;

-- ===== Andamento da entrega: aguardando → saiu → entregue =====
CREATE OR REPLACE FUNCTION public.restaurante_delivery_avancar(
  p_comanda_id uuid,
  p_situacao text,
  p_entregador text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.restaurante_contexto(ARRAY['administrador', 'gestor', 'garcom', 'caixa']::public.app_role[]);
  v_cmd public.comandas;
BEGIN
  SELECT * INTO v_cmd FROM public.comandas WHERE id = p_comanda_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND OR v_cmd.tipo <> 'delivery' OR v_cmd.situacao = 'cancelada' THEN
    RAISE EXCEPTION 'Pedido de delivery não encontrado ou cancelado';
  END IF;

  IF p_situacao = 'saiu' THEN
    IF v_cmd.entrega_situacao <> 'aguardando' THEN RAISE EXCEPTION 'O pedido não está aguardando a saída'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.comanda_itens WHERE comanda_id = p_comanda_id AND situacao <> 'cancelado') THEN
      RAISE EXCEPTION 'O pedido não tem itens';
    END IF;
    IF EXISTS (SELECT 1 FROM public.comanda_itens
                WHERE comanda_id = p_comanda_id AND situacao IN ('pendente', 'enviado', 'preparando')) THEN
      RAISE EXCEPTION 'Há itens que ainda não ficaram prontos na cozinha';
    END IF;
    -- o pedido pronto sai com o entregador: os itens prontos passam a entregues
    UPDATE public.comanda_itens SET situacao = 'entregue', entregue_em = now()
     WHERE comanda_id = p_comanda_id AND situacao = 'pronto';
    UPDATE public.comandas
       SET entrega_situacao = 'saiu', saiu_em = now(), entregador = nullif(btrim(p_entregador), '')
     WHERE id = p_comanda_id;

  ELSIF p_situacao = 'entregue' THEN
    IF v_cmd.entrega_situacao <> 'saiu' THEN RAISE EXCEPTION 'O pedido ainda não saiu para entrega'; END IF;
    UPDATE public.comandas SET entrega_situacao = 'entregue', entregue_cliente_em = now() WHERE id = p_comanda_id;

  ELSIF p_situacao = 'aguardando' THEN
    -- o entregador voltou sem entregar
    IF v_cmd.entrega_situacao <> 'saiu' THEN RAISE EXCEPTION 'Só um pedido que saiu pode voltar'; END IF;
    UPDATE public.comandas SET entrega_situacao = 'aguardando', saiu_em = NULL, entregador = NULL WHERE id = p_comanda_id;

  ELSE
    RAISE EXCEPTION 'Situação de entrega inválida';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.restaurante_delivery_avancar(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restaurante_delivery_avancar(uuid, text, text) TO authenticated;
